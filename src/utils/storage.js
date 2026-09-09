/**
 * OES Solar Cloud - Multi-Device Registry & Historical Data Storage
 * Integrated with 10-Day IndexedDB & Firebase Firestore Cloud Storage
 */

import { 
  recordReading as recordReadingDB, 
  getHistoricalAnalyticsDB as getHistoricalAnalyticsIndexedDB, 
  get10DayDailySummaries as get10DayDailySummariesIndexedDB, 
  export10DayCSV 
} from './telemetryDB';

import {
  recordDailyPeakFirestore,
  get10DayPeaksFirestore,
  isFirebaseConfigured,
  getFirebaseConfig,
  saveFirebaseConfig
} from './firebase';

export { 
  export10DayCSV, 
  isFirebaseConfigured, 
  getFirebaseConfig, 
  saveFirebaseConfig 
};

const DEVICES_KEY = 'oes_cloud_devices_v5';
const TELEMETRY_KEY_PREFIX = 'oes_telemetry_';

export const DEFAULT_DEVICES = [];

/**
 * Perform one-time migration to clean slate v5:
 * Wipes prior test/demo devices and cached telemetry so user starts fresh with 0 devices.
 */
export function performFreshStartMigration() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (!localStorage.getItem('oes_v5_clean_slate')) {
      const legacyKeys = [
        'oes_cloud_devices_v4',
        'oes_cloud_devices_v3',
        'oes_cloud_devices_v2',
        'oes_cloud_devices',
        'oes_devices'
      ];
      legacyKeys.forEach(k => localStorage.removeItem(k));

      // Remove cached live & telemetry items from earlier test runs
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('oes_live_') || k.startsWith('oes_telemetry_'))) {
          toRemove.push(k);
        }
      }
      toRemove.forEach(k => localStorage.removeItem(k));

      // Set fresh empty device registry
      localStorage.setItem(DEVICES_KEY, JSON.stringify([]));

      // Blacklist known test serials so stale MQTT retained broker messages don't re-add them
      const blacklist = ['OES-DL-D07A', 'DEMO-SITE-01', 'OES-DEMO-01'];
      localStorage.setItem('oes_deleted_serials', JSON.stringify(blacklist));

      // Clear local IndexedDB telemetry if present
      if (window.indexedDB) {
        window.indexedDB.deleteDatabase('OES_TelemetryDB');
      }

      localStorage.setItem('oes_v5_clean_slate', 'true');
    }
  } catch (e) {
    console.warn('Fresh start migration error:', e);
  }
}

// Run immediately on script load
performFreshStartMigration();

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
      client_name: deviceData.client_name || deviceData.plant || Site ,
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
    localStorage.removeItem('oes_live_' + serial);
    localStorage.removeItem('oes_telemetry_' + serial);
  } catch(e) {}
  return devices;
}

export function unblacklistDevice(serial) {
  try {
    const bl = JSON.parse(localStorage.getItem('oes_deleted_serials') || '[]');
    const next = bl.filter(s => s !== serial);
    localStorage.setItem('oes_deleted_serials', JSON.stringify(next));
  } catch(e) {}
}

export function isDeviceBlacklisted(serial) {
  try {
    const bl = JSON.parse(localStorage.getItem('oes_deleted_serials') || '[]');
    return bl.includes(serial);
  } catch(e) { return false; }
}

export function resetAllFleetData() {
  try {
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (
        k.startsWith('oes_cloud_devices') ||
        k.startsWith('oes_live_') ||
        k.startsWith('oes_telemetry_') ||
        k === 'oes_devices' ||
        k === 'oes_v5_clean_slate'
      )) {
        toRemove.push(k);
      }
    }
    toRemove.forEach(k => localStorage.removeItem(k));
    localStorage.setItem(DEVICES_KEY, JSON.stringify([]));
    localStorage.setItem('oes_deleted_serials', JSON.stringify(['OES-DL-D07A', 'DEMO-SITE-01', 'OES-DEMO-01']));
    localStorage.setItem('oes_v5_clean_slate', 'true');
    
    if (window.indexedDB) {
      window.indexedDB.deleteDatabase('OES_TelemetryDB');
    }
  } catch (e) {
    console.error('Reset all fleet data failed:', e);
  }
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

/**
 * Record live telemetry:
 * 1. Saves to local browser IndexedDB
 * 2. Saves to Firebase Firestore (if configured)
 * 3. Keeps latest 200 in fast localStorage
 */
export function recordDeviceTelemetry(serial, liveData) {
  try {
    if (!serial || !liveData) return;

    // 1. Local IndexedDB (10-day peak store)
    recordReadingDB(serial, liveData);

    // 2. Cloud Firebase Firestore (10-day peak store across all devices)
    if (isFirebaseConfigured()) {
      recordDailyPeakFirestore(serial, liveData);
    }

    // 3. Fast localStorage ring buffer
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
 * Unified 10-day daily summaries:
 * Fetches from Firebase Firestore if configured; falls back to local IndexedDB
 */
export async function get10DayDailySummaries(serial, capacityKw = 50) {
  if (isFirebaseConfigured()) {
    const cloudSummaries = await get10DayPeaksFirestore(serial, capacityKw);
    if (cloudSummaries && cloudSummaries.length > 0 && cloudSummaries.some(s => s.hasData)) {
      return cloudSummaries;
    }
  }
  return await get10DayDailySummariesIndexedDB(serial, capacityKw);
}

/**
 * Unified historical analytics for chart:
 * Bridges Firestore and IndexedDB
 */
export async function getHistoricalAnalyticsDB(serial, period = '10days', capacityKw = 50) {
  const summaries = await get10DayDailySummaries(serial, capacityKw);

  if (period === '10days') {
    return summaries.map(s => ({
      time: s.formattedDate,
      fullDate: s.dateStr,
      day: s.dayName,
      energy: s.totalKwh,
      power: s.peakKw,
      peakTime: s.peakTime,
      specificYield: s.specificYield,
      isToday: s.isToday,
      hasData: s.hasData
    }));
  }

  if (period === '7days') {
    return summaries.slice(3).map(s => ({
      time: s.dayName + ' ' + s.formattedDate,
      energy: s.totalKwh,
      power: s.peakKw,
      hasData: s.hasData
    }));
  }

  if (period === 'today') {
    const todaySummary = summaries[summaries.length - 1];
    return [
      { time: 'Peak Power', power: todaySummary?.peakKw || 0, energy: null, day: todaySummary?.peakTime || '' },
      { time: 'Today Yield', power: null, energy: todaySummary?.totalKwh || 0, day: 'Total' }
    ];
  }

  if (period === 'yesterday') {
    const yestSummary = summaries[summaries.length - 2];
    return [
      { time: 'Peak Power', power: yestSummary?.peakKw || 0, energy: null, day: yestSummary?.peakTime || '' },
      { time: 'Daily Yield', power: null, energy: yestSummary?.totalKwh || 0, day: 'Total' }
    ];
  }

  if (period === '30days') {
    const map = {};
    summaries.forEach(s => { map[s.dateStr] = s; });

    return Array.from({ length: 30 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (29 - i));
      const dateStr = d.toISOString().split('T')[0];
      const label = d.getDate() + '/' + (d.getMonth() + 1);

      if (map[dateStr]) {
        return { 
          time: label, 
          energy: map[dateStr].totalKwh, 
          power: map[dateStr].peakKw,
          hasData: map[dateStr].hasData
        };
      }
      return { time: label, energy: 0, power: 0, hasData: false };
    });
  }

  return [];
}

/**
 * Initial empty template - zero fake curves
 */
export function getHistoricalAnalytics(serial, period = '10days', capacityKw = 50) {
  const now = new Date();
  
  if (period === 'today' || period === 'yesterday') {
    return [
      { time: 'Peak Power', power: 0, energy: null },
      { time: 'Yield', power: null, energy: 0 }
    ];
  }

  if (period === '10days' || period === '7days') {
    const count = period === '10days' ? 10 : 7;
    return Array.from({ length: count }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (count - 1 - i));
      const label = d.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
      const day = d.toLocaleDateString('en-US', { weekday: 'short' });
      return { time: label, day, energy: 0, power: 0, specificYield: 0, hasData: false };
    });
  }

  if (period === '30days') {
    return Array.from({ length: 30 }, (_, i) => {
      const d = new Date(); 
      d.setDate(d.getDate() - (29 - i));
      const label = d.getDate() + '/' + (d.getMonth() + 1);
      return { time: label, energy: 0, power: 0, hasData: false };
    });
  }

  return [];
}
