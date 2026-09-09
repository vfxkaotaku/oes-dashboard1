/**
 * OES Solar Cloud - 10-Day Persistent Telemetry Storage Engine (IndexedDB)
 * Stores granular telemetry readings, calculates 10-day generation curves,
 * and enables raw CSV data export with automatic 10-day rolling prune.
 * NO DEMO / SIMULATED READINGS: Only actual received telemetry is stored and displayed.
 */

const DB_NAME = 'OES_TelemetryDB';
const DB_VERSION = 1;
const STORE_READINGS = 'readings';

// In-memory throttle cache to prevent recording every 200ms
const lastRecordTime = {};

/**
 * Open or initialize the IndexedDB database
 */
function openDB() {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      resolve(null);
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_READINGS)) {
        const store = db.createObjectStore(STORE_READINGS, { keyPath: 'id', autoIncrement: true });
        store.createIndex('serial', 'serial', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('serial_time', ['serial', 'timestamp'], { unique: false });
        store.createIndex('dateStr', 'dateStr', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      console.warn('Failed to open OES_TelemetryDB', request.error);
      resolve(null);
    };
  });
}

/**
 * Record a live telemetry packet into IndexedDB
 * Prunes records older than 10 days automatically
 */
export async function recordReading(serial, liveData) {
  try {
    if (!serial || !liveData) return;

    const now = Date.now();
    // Throttle: Record at most once every 30 seconds per serial unless first reading
    if (lastRecordTime[serial] && (now - lastRecordTime[serial]) < 30000) {
      return;
    }
    lastRecordTime[serial] = now;

    const db = await openDB();
    if (!db) return;

    const nowDate = new Date(now);
    const dateStr = nowDate.toISOString().split('T')[0]; // YYYY-MM-DD
    const timeStr = nowDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

    let kw = 0;
    let kwh = 0;
    let invertersSummary = [];

    if (liveData.inv && Array.isArray(liveData.inv)) {
      kw = liveData.inv.reduce((s, i) => s + (parseFloat(i.ac_w) || 0), 0) / 1000;
      kwh = liveData.inv.reduce((s, i) => s + (parseFloat(i.e_day) || 0), 0);
      invertersSummary = liveData.inv.map(i => {
        const strings = [];
        for (let s = 1; s <= 16; s++) {
          const vKey = 'str' + s + '_v';
          const aKey = 'str' + s + '_a';
          if (i[vKey] !== undefined || i[aKey] !== undefined) {
            strings.push({
              id: s,
              v: parseFloat(i[vKey]) || 0,
              a: parseFloat(i[aKey]) || 0,
              w: ((parseFloat(i[vKey]) || 0) * (parseFloat(i[aKey]) || 0))
            });
          }
        }
        return {
          addr: i.addr || 1,
          ac_w: parseFloat(i.ac_w) || 0,
          ac_v: parseFloat(i.ac_v) || 0,
          ac_a: parseFloat(i.ac_a) || 0,
          pv_w: parseFloat(i.pv_w) || 0,
          pv_v: parseFloat(i.pv_v) || 0,
          e_day: parseFloat(i.e_day) || 0,
          temp: parseFloat(i.temp) || 0,
          strings
        };
      });
    } else {
      kw = (parseFloat(liveData.ac_w) || 0) / 1000;
      kwh = parseFloat(liveData.e_day) || 0;
    }

    const entry = {
      serial,
      timestamp: now,
      dateStr,
      timeStr,
      powerKw: Number(kw.toFixed(2)),
      energyKwh: Number(kwh.toFixed(2)),
      ac_v: liveData.ac_v || (invertersSummary[0]?.ac_v) || 0,
      ac_a: liveData.ac_a || (invertersSummary[0]?.ac_a) || 0,
      pv_v: liveData.pv_v || (invertersSummary[0]?.pv_v) || 0,
      temp: liveData.temp || (invertersSummary[0]?.temp) || 0,
      freq: liveData.freq || 0,
      inverters: invertersSummary
    };

    const tx = db.transaction(STORE_READINGS, 'readwrite');
    const store = tx.objectStore(STORE_READINGS);
    store.add(entry);

    // Auto-prune readings older than 10 days (10 * 24 * 60 * 60 * 1000 ms)
    const cutoff = now - (10 * 24 * 60 * 60 * 1000);
    const timeIndex = store.index('timestamp');
    const oldRange = IDBKeyRange.upperBound(cutoff);
    const delReq = timeIndex.openKeyCursor(oldRange);
    delReq.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        store.delete(cursor.primaryKey);
        cursor.continue();
      }
    };
  } catch (err) {
    console.warn('OES IndexedDB recordReading error:', err);
  }
}

/**
 * Get all readings for a device within a time range
 */
export async function getReadings(serial, startTime, endTime = Date.now()) {
  const db = await openDB();
  if (!db) return [];

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_READINGS, 'readonly');
      const store = tx.objectStore(STORE_READINGS);
      const index = store.index('serial_time');
      const range = IDBKeyRange.bound([serial, startTime], [serial, endTime]);
      const req = index.getAll(range);

      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    } catch (e) {
      resolve([]);
    }
  });
}

/**
 * Generate 10-day daily summaries (past 10 days including today)
 * Returns purely real readings (0 / No Data if no telemetry was logged for that day)
 */
export async function get10DayDailySummaries(serial, capacityKw = 50) {
  const now = new Date();
  const tenDaysAgo = now.getTime() - (10 * 24 * 60 * 60 * 1000);
  const realReadings = await getReadings(serial, tenDaysAgo, now.getTime());

  // Group readings by dateStr
  const grouped = {};
  realReadings.forEach(r => {
    if (!grouped[r.dateStr]) grouped[r.dateStr] = [];
    grouped[r.dateStr].push(r);
  });

  const summaries = [];
  for (let i = 9; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
    const formattedDate = d.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
    const dayReadings = grouped[dateStr] || [];

    let totalKwh = 0;
    let peakKw = 0;
    let avgTemp = 0;
    let status = 'No Data';

    if (dayReadings.length > 0) {
      peakKw = Math.max(...dayReadings.map(r => r.powerKw || 0));
      totalKwh = Math.max(...dayReadings.map(r => r.energyKwh || 0));
      avgTemp = Number((dayReadings.reduce((s, r) => s + (r.temp || 0), 0) / dayReadings.length).toFixed(1));
      status = totalKwh > 0 ? 'Active' : 'Standby';
    }

    const specificYield = capacityKw > 0 && totalKwh > 0 
      ? Number((totalKwh / capacityKw).toFixed(2)) 
      : 0;

    summaries.push({
      dateStr,
      dayName,
      formattedDate,
      isToday: i === 0,
      totalKwh: Number(totalKwh.toFixed(1)),
      peakKw: Number(peakKw.toFixed(2)),
      specificYield,
      avgTemp,
      status: dayReadings.length > 0 ? status : 'No Data',
      samplesCount: dayReadings.length
    });
  }

  return summaries;
}

/**
 * Returns chart analytics data for: 'today', 'yesterday', '7days', '10days', '30days'
 * Strictly real data only - no simulated values
 */
export async function getHistoricalAnalyticsDB(serial, period = '10days', capacityKw = 50) {
  const now = new Date();

  if (period === 'today') {
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const readings = await getReadings(serial, startOfToday, now.getTime());
    const hours = ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];
    const currentHour = now.getHours();

    return hours.map((h, idx) => {
      const hourNum = 6 + idx;
      if (hourNum > currentHour) {
        return { time: h, power: null, energy: null };
      }
      const matches = readings.filter(r => new Date(r.timestamp).getHours() === hourNum);

      if (matches.length > 0) {
        const maxP = Math.max(...matches.map(m => m.powerKw || 0));
        const maxE = Math.max(...matches.map(m => m.energyKwh || 0));
        return { time: h, power: Number(maxP.toFixed(2)), energy: Number(maxE.toFixed(1)) };
      }

      // No fake curve - return 0 if no readings captured for that hour
      return { time: h, power: 0, energy: 0 };
    });
  }

  if (period === 'yesterday') {
    const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
    const endOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - 1;
    const readings = await getReadings(serial, startOfYesterday, endOfYesterday);
    const hours = ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];

    return hours.map((h, idx) => {
      const hourNum = 6 + idx;
      const matches = readings.filter(r => new Date(r.timestamp).getHours() === hourNum);
      if (matches.length > 0) {
        return {
          time: h,
          power: Number(Math.max(...matches.map(m => m.powerKw || 0)).toFixed(2)),
          energy: Number(Math.max(...matches.map(m => m.energyKwh || 0)).toFixed(1))
        };
      }
      return { time: h, power: 0, energy: 0 };
    });
  }

  if (period === '10days') {
    const summaries = await get10DayDailySummaries(serial, capacityKw);
    return summaries.map(s => ({
      time: s.formattedDate,
      fullDate: s.dateStr,
      day: s.dayName,
      energy: s.totalKwh,
      power: s.peakKw,
      specificYield: s.specificYield,
      isToday: s.isToday,
      samplesCount: s.samplesCount
    }));
  }

  if (period === '7days') {
    const summaries = await get10DayDailySummaries(serial, capacityKw);
    return summaries.slice(3).map(s => ({
      time: s.dayName + ' ' + s.formattedDate,
      energy: s.totalKwh,
      power: s.peakKw,
      samplesCount: s.samplesCount
    }));
  }

  if (period === '30days') {
    const summaries = await get10DayDailySummaries(serial, capacityKw);
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
          samplesCount: map[dateStr].samplesCount
        };
      }
      return { time: label, energy: 0, power: 0, samplesCount: 0 };
    });
  }

  return [];
}

/**
 * Export all 10-day reading data to a clean, auditor-ready CSV file
 */
export async function export10DayCSV(serial, siteMetadata = {}) {
  const now = new Date();
  const tenDaysAgo = now.getTime() - (10 * 24 * 60 * 60 * 1000);
  const readings = await getReadings(serial, tenDaysAgo, now.getTime());

  const clientName = siteMetadata.client_name || 'ONE EARTH Solar Client';
  const siteName = siteMetadata.site_name || 'Solar Plant';
  const capacityKw = siteMetadata.capacity_kw || 50;

  let csv = [];
  csv.push('"ONE EARTH SOLAR - 10-DAY TELEMETRY & READING AUDIT REPORT"');
  csv.push(`"Client Name","${clientName}"`);
  csv.push(`"Site Name","${siteName}"`);
  csv.push(`"Logger Serial Number","${serial}"`);
  csv.push(`"Plant Capacity","${capacityKw} kWp"`);
  csv.push(`"Export Timestamp","${now.toISOString()}"`);
  csv.push(`"Retention Window","10 Days (${new Date(tenDaysAgo).toLocaleDateString()} to ${now.toLocaleDateString()})"`);
  csv.push(`"Total Logged Records","${readings.length}"`);
  csv.push('');

  const headers = [
    'Record ID',
    'Date',
    'Time',
    'Timestamp (ms)',
    'Total Active Power (kW)',
    'Daily Yield (kWh)',
    'Grid Voltage (V)',
    'Grid Current (A)',
    'Frequency (Hz)',
    'PV Voltage (V)',
    'Internal Temp (deg C)',
    'Inverters Count',
    'Inverters Data & Strings Breakdown'
  ];
  csv.push(headers.map(h => `"${h}"`).join(','));

  if (readings.length === 0) {
    csv.push('"No telemetry readings recorded for this 10-day period. Please ensure logger is online and transmitting."');
  } else {
    readings.forEach((r, idx) => {
      let invSummaryStr = '';
      if (r.inverters && r.inverters.length > 0) {
        invSummaryStr = r.inverters.map(inv => {
          const strList = inv.strings ? inv.strings.map(s => `Str${s.id}:${s.v}V/${s.a}A`).join(' ') : 'None';
          return `[Inv ${inv.addr}: ${(inv.ac_w/1000).toFixed(2)}kW, ${strList}]`;
        }).join(' ; ');
      }

      const row = [
        idx + 1,
        `"${r.dateStr}"`,
        `"${r.timeStr}"`,
        r.timestamp,
        r.powerKw,
        r.energyKwh,
        r.ac_v || 0,
        r.ac_a || 0,
        r.freq || 0,
        r.pv_v || 0,
        r.temp || 0,
        (r.inverters ? r.inverters.length : 1),
        `"${invSummaryStr.replace(/"/g, '""')}"`
      ];
      csv.push(row.join(','));
    });
  }

  const csvContent = csv.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `OES_${serial}_10Day_Telemetry_${now.toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
