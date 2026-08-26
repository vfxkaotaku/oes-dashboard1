/**
 * OES Solar Simulation Engine
 * Huawei SUN2000 40kW x 2 - Realistic Plant Simulation
 *
 * Data flows:
 *   Strings -> MPPT -> Inverter DC Input -> AC Conversion -> AC Grid Output
 *
 * Units:
 *   Power  -> stored in Watts (W) internally (matches ESP32 firmware format)
 *   Energy -> stored in kWh
 *   Voltage -> V, Current -> A, Frequency -> Hz, Temperature -> Celsius
 */

// Constants
const INV_RATED_KW = 40;
const NUM_INV = 2;
const STRINGS_PER_MPPT = 2;
const MPPTS_PER_INV = 2;
const TOTAL_STRINGS = MPPTS_PER_INV * STRINGS_PER_MPPT; // 4 per inverter

const PEAK_SOLAR_FACTOR = 0.94;
const AC_EFFICIENCY = 0.975;
const SLOW_DRIFT = 0.018;

const STR_VMPP = 580;
const AC_VPHASE = 231;
const AC_FNOM = 50.0;

// State
let _initialized = false;
let _lastUpdateMs = 0;
let _energyAccum = [0, 0];
let _energyLifetime = [1045.2, 980.5];
let _pvFactor = [0.92, 0.89];
let _strOffsets = null;

function _initStrOffsets() {
  if (_strOffsets) return;
  _strOffsets = [];
  for (let i = 0; i < NUM_INV; i++) {
    const invOffsets = [];
    for (let s = 0; s < TOTAL_STRINGS; s++) {
      invOffsets.push(1.0 + (Math.random() * 0.08 - 0.04));
    }
    _strOffsets.push(invOffsets);
  }
}

function _solarFactor() {
  const now = new Date();
  const hour = now.getHours() + now.getMinutes() / 60;
  if (hour < 6 || hour > 18.5) return 0;
  const solarNoon = 12.25;
  const halfDay = 6.25;
  const angle = ((hour - solarNoon) / halfDay) * (Math.PI / 2);
  return Math.pow(Math.cos(angle), 1.5);
}

function _drift(current, target, speed = 0.12) {
  return current + (target - current) * speed;
}

function _clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export function getSimulationTelemetry() {
  _initStrOffsets();

  const nowMs = Date.now();
  const dtHours = _initialized
    ? Math.min((nowMs - _lastUpdateMs) / 3600000, 1 / 60)
    : 0;

  _lastUpdateMs = nowMs;
  _initialized = true;

  const irr = _solarFactor();
  const invData = [];

  for (let invIdx = 0; invIdx < NUM_INV; invIdx++) {
    const targetFactor = irr * PEAK_SOLAR_FACTOR;
    const randomWalk = (Math.random() - 0.5) * SLOW_DRIFT;
    const driftedTarget = _clamp(targetFactor + randomWalk, 0, PEAK_SOLAR_FACTOR);
    _pvFactor[invIdx] = _drift(_pvFactor[invIdx], driftedTarget);
    _pvFactor[invIdx] = _clamp(_pvFactor[invIdx], 0, PEAK_SOLAR_FACTOR);

    const pvFactorNow = _pvFactor[invIdx];
    const pvWTotal = pvFactorNow * INV_RATED_KW * 1000;
    const acWTotal = pvWTotal * AC_EFFICIENCY;

    const acV = AC_VPHASE + (Math.random() - 0.5) * 3;
    const acA = acV > 0 ? (acWTotal / acV) / 1.732 : 0;
    const freq = AC_FNOM + (Math.random() - 0.5) * 0.08;
    const temp = 38 + pvFactorNow * 10 + (Math.random() - 0.5) * 2;

    const mppt1Share = 0.51 + Math.random() * 0.02;
    const mppt2Share = 1 - mppt1Share;

    const mppts = [];

    for (let mpptIdx = 0; mpptIdx < MPPTS_PER_INV; mpptIdx++) {
      const mpptShare = mpptIdx === 0 ? mppt1Share : mppt2Share;
      const mpptPvW = pvWTotal * mpptShare;
      const mpptV = STR_VMPP + (Math.random() - 0.5) * 15 + pvFactorNow * 20;

      const strings = [];
      let strPwrSum = 0;

      for (let strIdx = 0; strIdx < STRINGS_PER_MPPT; strIdx++) {
        const globalStrIdx = mpptIdx * STRINGS_PER_MPPT + strIdx;
        const offset = _strOffsets[invIdx][globalStrIdx];
        const rawStrW = (mpptPvW / STRINGS_PER_MPPT) * offset;
        strPwrSum += rawStrW;
        strings.push({ _rawW: rawStrW });
      }

      const strings_normalized = strings.map((s, si) => {
        const strW = (s._rawW / strPwrSum) * mpptPvW;
        const strI = mpptV > 0 ? strW / mpptV : 0;
        const strLabel = `MPPT${mpptIdx + 1} Str${si + 1}`;
        return {
          label: strLabel,
          v: parseFloat(mpptV.toFixed(1)),
          a: parseFloat(strI.toFixed(2)),
          w: parseFloat(strW.toFixed(0)),
        };
      });

      mppts.push({
        label: `MPPT ${mpptIdx + 1}`,
        v: parseFloat(mpptV.toFixed(1)),
        w: parseFloat(mpptPvW.toFixed(0)),
        strings: strings_normalized,
      });
    }

    const pvV = mppts.reduce((s, m) => s + m.v, 0) / MPPTS_PER_INV;
    const pvA = pvV > 0 ? pvWTotal / pvV : 0;

    if (dtHours > 0 && acWTotal > 0) {
      _energyAccum[invIdx] += (acWTotal / 1000) * dtHours;
      _energyLifetime[invIdx] += (acWTotal / 1000) * dtHours;
    }

    const status = acWTotal > 100 ? 2 : 0;

    invData.push({
      addr: invIdx + 1,
      online: 1,
      status: status,
      pv_v: parseFloat(pvV.toFixed(1)),
      pv_a: parseFloat(pvA.toFixed(2)),
      pv_w: parseFloat(pvWTotal.toFixed(0)),
      ac_v: parseFloat(acV.toFixed(1)),
      ac_a: parseFloat(acA.toFixed(2)),
      ac_w: parseFloat(acWTotal.toFixed(0)),
      freq: parseFloat(freq.toFixed(2)),
      temp: parseFloat(temp.toFixed(1)),
      e_day: parseFloat(_energyAccum[invIdx].toFixed(2)),
      e_tot: parseFloat(_energyLifetime[invIdx].toFixed(1)),
      mppt: mppts,
    });
  }

  return {
    device_id: 'SIM',
    device_name: 'OES Simulation',
    plant: 'Huawei SUN2000 80kW Plant',
    timestamp: Math.floor(nowMs / 1000),
    inv: invData,
  };
}

export function getPlantSummary(payload) {
  const invs = payload?.inv ?? [];
  if (invs.length === 0) return null;
  return {
    totalPvW: invs.reduce((s, i) => s + (parseFloat(i.pv_w) || 0), 0),
    totalAcW: invs.reduce((s, i) => s + (parseFloat(i.ac_w) || 0), 0),
    totalEDay: invs.reduce((s, i) => s + (parseFloat(i.e_day) || 0), 0),
    totalETot: invs.reduce((s, i) => s + (parseFloat(i.e_tot) || 0), 0),
    avgTemp: invs.reduce((s, i) => s + (parseFloat(i.temp) || 0), 0) / invs.length,
    avgFreq: invs.reduce((s, i) => s + (parseFloat(i.freq) || 0), 0) / invs.length,
    numInv: invs.length,
  };
}

export function resetDailyEnergy() {
  _energyAccum = [0, 0];
}

export function isSolarActive() {
  return _solarFactor() > 0.01;
}

export function getSolarFactor() {
  return _solarFactor();
}