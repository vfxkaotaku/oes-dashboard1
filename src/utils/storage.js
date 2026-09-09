/**
 * OES Solar Cloud - Multi-Device Registry & Historical Data Storage
 * Integrated with 10-Day IndexedDB Telemetry Storage Engine
 * NO DEMO / SIMULATED READINGS
 */

import { 
  recordReading as recordReadingDB, 
  getHistoricalAnalyticsDB, 
  get10DayDailySummaries, 
  export10DayCSV 
} from './telemetryDB';

export { getHistoricalAnalyticsDB, get10DayDailySummaries, export10DayCSV };

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
    const isUserEdit = deviceData._userEdit === true;
    if (isUserEdit) {
      devices[idx] = {
        ...devices[idx],
        ...deviceData,
        last_seen: new Date().toISOString()
      };
      delete devices[idx]._userEdit;
    } else {
      devices[idx] = {
        ...devices[idx],
        status: deviceData.status || devices[idx].status || 'online',
        last_seen: deviceData.last_seen || new Date().toISOString()
      };
    }
  } else {
    devices.unshift({
      serial_number: serial,
      client_name: deviceData.client_name || deviceData.plant || `Site ${serial}`,
      site_name: deviceData.site_name || 'Solar Site',
      location: deviceData.location || 'Unknown Location',
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
  try {
    const bl = JSON.parse(localStorage.getItem('oes_deleted_serials') || '[]');
    if (!bl.includes(serial)) bl.push(serial);
    localStorage.setItem('oes_deleted_serials', JSON.stringify(bl));
  } catch(e) {}
  return devices;
}

export function isDeviceBlacklisted(serial) {
  try {
    const bl = JSON.parse(localStorage.getItem('oes_deleted_serials') || '[]');
    return bl.includes(serial);
  } catch(e) { return false; }
}

export function getDeviceBySerial(serial) {
  const devices = getDevices();
  return devices.find(d => d.serial_number === serial) || {
    serial_number: serial,
    client_name: 'Solar Plant',
    site_name: 'Solar Site',
    location: '',
    inverter_model: 'Solar Inverter',
    capacity_kw: 50,
    status: 'offline',
    last_seen: null
  };
}

export function saveLastLiveData(serial, data) {
  try {
    if (!serial || !data) return;
    localStorage.setItem('oes_live_' + serial, JSON.stringify(data));
  } catch (e) {}
}

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

    // 1. Record into 10-Day Persistent IndexedDB
    recordReadingDB(serial, liveData);

    // 2. Keep fast local storage buffer (up to 200 samples)
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
      ac_v: liveData.ac_v || (liveData.inv && liveData.inv[0] ? liveData.inv[0].ac_v : 0),
      pv_v: liveData.pv_v || (liveData.inv && liveData.inv[0] ? liveData.inv[0].pv_v : 0),
      temp: liveData.temp || (liveData.inv && liveData.inv[0] ? liveData.inv[0].temp : 0)
    });

    if (history.length > 200) history.shift();
    localStorage.setItem(key, JSON.stringify(history));
  } catch (e) {}
}

/**
 * Initial empty template - no fake curves or random numbers
 */
export function getHistoricalAnalytics(serial, period = '10days', capacityKw = 50) {
  const now = new Date();
  
  if (period === 'today' || period === 'yesterday') {
    const hours = ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];
    const currentHour = now.getHours();
    
    return hours.map((h, idx) => {
      const hourNum = 6 + idx;
      if (period === 'today' && hourNum > currentHour) {
        return { time: h, power: null, energy: null };
      }
      return { time: h, power: 0, energy: 0 };
    });
  }

  if (period === '10days' || period === '7days') {
    const count = period === '10days' ? 10 : 7;
    return Array.from({ length: count }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (count - 1 - i));
      const label = d.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
      const day = d.toLocaleDateString('en-US', { weekday: 'short' });
      return { time: label, day, energy: 0, power: 0, specificYield: 0 };
    });
  }

  if (period === '30days') {
    return Array.from({ length: 30 }, (_, i) => {
      const d = new Date(); 
      d.setDate(d.getDate() - (29 - i));
      const label = d.getDate() + '/' + (d.getMonth() + 1);
      return { time: label, energy: 0, power: 0 };
    });
  }

  return [];
}
