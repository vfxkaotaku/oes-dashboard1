/**
 * OES Solar Cloud - 10-Day Peak Telemetry Storage Engine (IndexedDB)
 * Stores ONLY the PEAK generation of each day (1 record per day per device).
 * Tracks maximum active power (kW), peak time, total daily energy (kWh),
 * and string values at peak, with automatic 10-day rolling prune.
 */

const DB_NAME = 'OES_TelemetryDB';
const DB_VERSION = 2;
const STORE_PEAKS = 'daily_peaks';

/**
 * Open or initialize IndexedDB with daily_peaks store
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
      if (!db.objectStoreNames.contains(STORE_PEAKS)) {
        const store = db.createObjectStore(STORE_PEAKS, { keyPath: 'id' });
        store.createIndex('serial', 'serial', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
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
 * Record incoming telemetry - updates ONLY the daily peak for this date
 */
export async function recordReading(serial, liveData) {
  try {
    if (!serial || !liveData) return;

    const db = await openDB();
    if (!db) return;

    const now = Date.now();
    const nowDate = new Date(now);
    const dateStr = nowDate.toISOString().split('T')[0]; // YYYY-MM-DD
    const timeStr = nowDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    const dayId = `${serial}_${dateStr}`;

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

    kw = Number(kw.toFixed(2));
    kwh = Number(kwh.toFixed(2));

    const tx = db.transaction(STORE_PEAKS, 'readwrite');
    const store = tx.objectStore(STORE_PEAKS);
    const getReq = store.get(dayId);

    getReq.onsuccess = () => {
      const existing = getReq.result;

      if (!existing) {
        // First record of the day
        store.put({
          id: dayId,
          serial,
          dateStr,
          timestamp: now,
          peakPowerKw: kw,
          peakTimeStr: timeStr,
          totalEnergyKwh: kwh,
          ac_v: liveData.ac_v || (invertersSummary[0]?.ac_v) || 0,
          ac_a: liveData.ac_a || (invertersSummary[0]?.ac_a) || 0,
          pv_v: liveData.pv_v || (invertersSummary[0]?.pv_v) || 0,
          temp: liveData.temp || (invertersSummary[0]?.temp) || 0,
          freq: liveData.freq || 0,
          inverters: invertersSummary,
          updatesCount: 1
        });
      } else {
        // Update existing daily record with new peak values
        const isNewPeakPower = kw >= (existing.peakPowerKw || 0);
        const maxEnergy = Math.max(existing.totalEnergyKwh || 0, kwh);

        const updated = {
          ...existing,
          timestamp: now, // refresh timestamp for retention
          totalEnergyKwh: maxEnergy,
          updatesCount: (existing.updatesCount || 1) + 1
        };

        // If current output power is higher than today's recorded peak, update peak snapshot
        if (isNewPeakPower) {
          updated.peakPowerKw = kw;
          updated.peakTimeStr = timeStr;
          updated.ac_v = liveData.ac_v || (invertersSummary[0]?.ac_v) || existing.ac_v;
          updated.ac_a = liveData.ac_a || (invertersSummary[0]?.ac_a) || existing.ac_a;
          updated.pv_v = liveData.pv_v || (invertersSummary[0]?.pv_v) || existing.pv_v;
          updated.temp = liveData.temp || (invertersSummary[0]?.temp) || existing.temp;
          updated.freq = liveData.freq || existing.freq;
          if (invertersSummary.length > 0) {
            updated.inverters = invertersSummary;
          }
        }

        store.put(updated);
      }

      // Auto-prune records older than 10 days
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
    };
  } catch (err) {
    console.warn('OES IndexedDB recordReading error:', err);
  }
}

/**
 * Get all daily peak records for a device
 */
export async function getDailyPeaks(serial) {
  const db = await openDB();
  if (!db) return [];

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_PEAKS, 'readonly');
      const store = tx.objectStore(STORE_PEAKS);
      const index = store.index('serial');
      const req = index.getAll(serial);

      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    } catch (e) {
      resolve([]);
    }
  });
}

/**
 * Generate 10-day summaries from the daily peak records
 */
export async function get10DayDailySummaries(serial, capacityKw = 50) {
  const peaks = await getDailyPeaks(serial);
  const peakMap = {};
  peaks.forEach(p => {
    peakMap[p.dateStr] = p;
  });

  const summaries = [];
  for (let i = 9; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
    const formattedDate = d.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
    const record = peakMap[dateStr];

    const hasData = !!record;
    const totalKwh = record ? record.totalEnergyKwh : 0;
    const peakKw = record ? record.peakPowerKw : 0;
    const peakTime = record ? record.peakTimeStr : '--';
    const avgTemp = record ? record.temp : 0;
    const status = hasData ? (totalKwh > 0 ? 'Active' : 'Standby') : 'No Data';
    const specificYield = (hasData && capacityKw > 0 && totalKwh > 0)
      ? Number((totalKwh / capacityKw).toFixed(2))
      : 0;

    summaries.push({
      dateStr,
      dayName,
      formattedDate,
      isToday: i === 0,
      totalKwh,
      peakKw,
      peakTime,
      specificYield,
      avgTemp,
      status,
      hasData,
      inverters: record?.inverters || []
    });
  }

  return summaries;
}

/**
 * Returns chart analytics data for: 'today', 'yesterday', '7days', '10days', '30days'
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
 * Export 10-day peak readings to a clean auditor-ready CSV file
 */
export async function export10DayCSV(serial, siteMetadata = {}) {
  const summaries = await get10DayDailySummaries(serial, siteMetadata.capacity_kw || 50);
  const now = new Date();

  const clientName = siteMetadata.client_name || 'ONE EARTH Solar Client';
  const siteName = siteMetadata.site_name || 'Solar Plant';
  const capacityKw = siteMetadata.capacity_kw || 50;

  let csv = [];
  csv.push('"ONE EARTH SOLAR - 10-DAY DAILY PEAK GENERATION AUDIT REPORT"');
  csv.push(`"Client Name","${clientName}"`);
  csv.push(`"Site Name","${siteName}"`);
  csv.push(`"Logger Serial Number","${serial}"`);
  csv.push(`"Plant Capacity","${capacityKw} kWp"`);
  csv.push(`"Report Type","Daily Peak Generation & Yield (10 Days)"`);
  csv.push(`"Export Timestamp","${now.toISOString()}"`);
  csv.push('');

  const headers = [
    'Date',
    'Day of Week',
    'Peak Active Power (kW)',
    'Peak Power Timestamp',
    'Total Daily Yield (kWh)',
    'Specific Yield (kWh/kWp)',
    'Average Temp (°C)',
    'Operational Status',
    'Peak Inverters & Strings Detail'
  ];
  csv.push(headers.map(h => `"${h}"`).join(','));

  const activeDays = summaries.filter(s => s.hasData);

  if (activeDays.length === 0) {
    csv.push('"No peak telemetry records logged yet for this 10-day period."');
  } else {
    summaries.forEach((s) => {
      let invSummaryStr = '';
      if (s.inverters && s.inverters.length > 0) {
        invSummaryStr = s.inverters.map(inv => {
          const strList = inv.strings ? inv.strings.map(str => `Str${str.id}:${str.v}V/${str.a}A`).join(' ') : 'None';
          return `[Inv ${inv.addr}: ${(inv.ac_w/1000).toFixed(2)}kW, ${strList}]`;
        }).join(' ; ');
      }

      const row = [
        `"${s.dateStr}"`,
        `"${s.dayName}"`,
        s.hasData ? s.peakKw : 0,
        `"${s.hasData ? s.peakTime : '--'}"`,
        s.hasData ? s.totalKwh : 0,
        s.hasData ? s.specificYield : 0,
        s.hasData ? s.avgTemp : 0,
        `"${s.status}"`,
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
  link.setAttribute('download', `OES_${serial}_10Day_Daily_Peaks_${now.toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
