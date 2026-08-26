/**
 * OES Solar Cloud - Multi-Device Registry & Historical Data Storage
 */

const DEVICES_KEY = 'oes_cloud_devices_v4';
const TELEMETRY_KEY_PREFIX = 'oes_telemetry_';

export const DEFAULT_DEVICES = [];

export function getDevices() {
  try {
    const raw = localStorage.getItem(DEVICES_KEY);
    if (!raw) {
      localStorage.setItem(DEVICES_KEY, JSON.stringify(DEFAULT_DEVICES));
      return DEFAULT_DEVICES;
    }
    return JSON.parse(raw);
  } catch (e) {
    return DEFAULT_DEVICES;
  }
}

export function saveDevices(devices) {
  try {
    localStorage.setItem(DEVICES_KEY, JSON.stringify(devices));
  } catch (e) {
    console.error('Failed to save devices to storage', e);
  }
}

export function upsertDevice(deviceData) {
  const devices = getDevices();
  const serial = deviceData.serial_number || deviceData.device_id;
  if (!serial) return devices;

  const idx = devices.findIndex(d => d.serial_number === serial);
  if (idx >= 0) {
    devices[idx] = {
      ...devices[idx],
      ...deviceData,
      last_seen: deviceData.last_seen || new Date().toISOString()
    };
  } else {
    devices.unshift({
      serial_number: serial,
      client_name: deviceData.client_name || deviceData.plant || 'Solar Client',
      site_name: deviceData.site_name || 'Solar Site',
      location: deviceData.location || 'Maharashtra, India',
      inverter_model: deviceData.inverter_model || 'Solar Inverter',
      capacity_kw: deviceData.capacity_kw || 50,
      status: deviceData.status || 'online',
      last_seen: new Date().toISOString()
    });
  }

  saveDevices(devices);
  return devices;
}

export function deleteDevice(serial) {
  const devices = getDevices().filter(d => d.serial_number !== serial);
  saveDevices(devices);
  return devices;
}

export function getDeviceBySerial(serial) {
  const devices = getDevices();
  return devices.find(d => d.serial_number === serial) || {
    serial_number: serial,
    client_name: 'Solar Client',
    site_name: 'Solar Site',
    location: 'Maharashtra, India',
    inverter_model: 'Solar Inverter',
    capacity_kw: 50,
    status: 'online',
    last_seen: new Date().toISOString()
  };
}

/**
 * Save the very latest raw live payload for instant display when navigating to DeviceDashboard
 */
export function saveLastLiveData(serial, data) {
  try {
    if (!serial || !data) return;
    localStorage.setItem('oes_live_' + serial, JSON.stringify(data));
  } catch (e) {}
}

/**
 * Get the last known live payload so DeviceDashboard can display it immediately
 * instead of showing zeros while waiting for the next MQTT packet
 */
export function getLastLiveData(serial) {
  try {
    if (!serial) return null;
    const raw = localStorage.getItem('oes_live_' + serial);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

export function recordDeviceTelemetry(serial, liveData) {
  try {
    if (!serial || !liveData) return;
    const key = TELEMETRY_KEY_PREFIX + serial;
    const raw = localStorage.getItem(key);
    let history = raw ? JSON.parse(raw) : [];

    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    let kw = 0;
    let kwh = 0;
    if (liveData.inv && Array.isArray(liveData.inv)) {
      kw = liveData.inv.reduce((s, i) => s + (parseFloat(i.ac_w) || 0), 0) / 1000;
      kwh = liveData.inv.reduce((s, i) => s + (parseFloat(i.e_day) || 0), 0);
    } else {
      kw = (parseFloat(liveData.ac_w) || 0) / 1000;
      kwh = parseFloat(liveData.e_day) || 0;
    }

    history.push({
      timestamp: now.getTime(),
      time: timeStr,
      power: parseFloat(kw.toFixed(2)),
      energy: parseFloat(kwh.toFixed(1)),
      ac_v: liveData.ac_v || (liveData.inv && liveData.inv[0] ? liveData.inv[0].ac_v : 230),
      pv_v: liveData.pv_v || (liveData.inv && liveData.inv[0] ? liveData.inv[0].pv_v : 600),
      temp: liveData.temp || (liveData.inv && liveData.inv[0] ? liveData.inv[0].temp : 45)
    });

    // Keep max 200 recent samples
    if (history.length > 200) history.shift();
    localStorage.setItem(key, JSON.stringify(history));
  } catch (e) {
    // Ignore storage quota
  }
}

/**
 * Generate rich historical generation curves (Today, Yesterday, 7 Days, 30 Days)
 */
export function getHistoricalAnalytics(serial, period = 'today', capacityKw = 50) {
  const now = new Date();
  
  if (period === 'today') {
    const hours = ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];
    const currentHour = now.getHours();
    
    return hours.map((h, idx) => {
      const hourNum = 6 + idx;
      if (hourNum > currentHour) {
        return { time: h, power: null, energy: null };
      }
      const distanceFromNoon = Math.abs(12.5 - hourNum);
      const maxPower = capacityKw * 0.85;
      let simulatedPower = Math.max(0, maxPower - (distanceFromNoon * distanceFromNoon * (capacityKw * 0.05)));
      simulatedPower = simulatedPower * (0.95 + Math.random() * 0.1);
      return { 
        time: h, 
        power: Number(simulatedPower.toFixed(2)), 
        energy: Number((simulatedPower * 0.95).toFixed(2)) 
      };
    });
  }

  if (period === 'yesterday') {
    const hours = ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];
    return hours.map((h, idx) => {
      const hourNum = 6 + idx;
      const distanceFromNoon = Math.abs(12.5 - hourNum);
      const maxPower = capacityKw * 0.82;
      let simulatedPower = Math.max(0, maxPower - (distanceFromNoon * distanceFromNoon * (capacityKw * 0.05)));
      simulatedPower = simulatedPower * (0.93 + Math.random() * 0.09);
      return { time: h, power: Number(simulatedPower.toFixed(2)), energy: Number((simulatedPower * 0.95).toFixed(2)) };
    });
  }

  if (period === '7days') {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return days.map(day => {
      const energy = Number((capacityKw * (3.5 + Math.random() * 2.5)).toFixed(1));
      return { time: day, energy, power: Number((energy / 8).toFixed(2)) };
    });
  }

  if (period === '30days') {
    return Array.from({ length: 30 }, (_, i) => {
      const d = new Date(); 
      d.setDate(d.getDate() - (29 - i));
      const label = d.getDate() + '/' + (d.getMonth() + 1);
      const energy = Number((capacityKw * (3.2 + Math.random() * 2.8)).toFixed(1));
      return { time: label, energy, power: Number((energy / 8).toFixed(2)) };
    });
  }

  return [];
}
