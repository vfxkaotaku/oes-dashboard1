/**
 * OES Solar Cloud - Firebase Firestore Central 10-Day Peak Storage
 * Allows all users and devices to view the same 10-day historical peaks from anywhere.
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getFirestore, 
  doc, 
  getDoc, 
  setDoc, 
  collection, 
  query, 
  where, 
  getDocs 
} from 'firebase/firestore';

const STORAGE_KEY_FIREBASE = 'oes_firebase_config';

/**
 * Get stored Firebase configuration
 */
export function getFirebaseConfig() {
  try {
    // 1. Check localStorage first (user-configured in UI)
    const stored = localStorage.getItem(STORAGE_KEY_FIREBASE);
    if (stored) {
      return JSON.parse(stored);
    }
    // 2. Check environment variables
    if (import.meta.env.VITE_FIREBASE_API_KEY && import.meta.env.VITE_FIREBASE_PROJECT_ID) {
      return {
        apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
        authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
        storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
        appId: import.meta.env.VITE_FIREBASE_APP_ID
      };
    }
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Save Firebase configuration to localStorage
 */
export function saveFirebaseConfig(config) {
  try {
    if (!config || !config.projectId) {
      localStorage.removeItem(STORAGE_KEY_FIREBASE);
      return false;
    }
    localStorage.setItem(STORAGE_KEY_FIREBASE, JSON.stringify(config));
    return true;
  } catch (e) {
    console.error('Failed to save Firebase config', e);
    return false;
  }
}

/**
 * Check if Firebase is currently active and configured
 */
export function isFirebaseConfigured() {
  const config = getFirebaseConfig();
  return !!(config && config.projectId && config.apiKey);
}

/**
 * Get or initialize Firebase App and Firestore instance
 */
function getFirestoreInstance() {
  try {
    const config = getFirebaseConfig();
    if (!config || !config.projectId || !config.apiKey) return null;

    let app;
    if (getApps().length === 0) {
      app = initializeApp(config);
    } else {
      app = getApp();
    }
    return getFirestore(app);
  } catch (e) {
    console.warn('Firebase init warning:', e);
    return null;
  }
}

/**
 * Record and update today's peak generation in Firebase Firestore
 */
export async function recordDailyPeakFirestore(serial, liveData) {
  try {
    if (!serial || !liveData) return;
    const db = getFirestoreInstance();
    if (!db) return;

    const now = Date.now();
    const nowDate = new Date(now);
    const dateStr = nowDate.toISOString().split('T')[0]; // YYYY-MM-DD
    const timeStr = nowDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    const docId = `${serial}_${dateStr}`;

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

    const docRef = doc(db, 'daily_peaks', docId);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      // First record of the day
      await setDoc(docRef, {
        id: docId,
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
        updatedAt: now
      });
    } else {
      const existing = docSnap.data();
      const isNewPeak = kw >= (existing.peakPowerKw || 0);
      const maxEnergy = Math.max(existing.totalEnergyKwh || 0, kwh);

      const updatePayload = {
        totalEnergyKwh: maxEnergy,
        updatedAt: now
      };

      if (isNewPeak) {
        updatePayload.peakPowerKw = kw;
        updatePayload.peakTimeStr = timeStr;
        updatePayload.ac_v = liveData.ac_v || (invertersSummary[0]?.ac_v) || existing.ac_v;
        updatePayload.temp = liveData.temp || (invertersSummary[0]?.temp) || existing.temp;
        if (invertersSummary.length > 0) {
          updatePayload.inverters = invertersSummary;
        }
      }

      await setDoc(docRef, updatePayload, { merge: true });
    }
  } catch (err) {
    console.warn('Firestore recordDailyPeak error:', err);
  }
}

/**
 * Fetch 10-day daily peaks from Firebase Firestore
 */
export async function get10DayPeaksFirestore(serial, capacityKw = 50) {
  try {
    const db = getFirestoreInstance();
    if (!db) return null;

    const tenDaysAgo = Date.now() - (10 * 24 * 60 * 60 * 1000);
    const q = query(
      collection(db, 'daily_peaks'),
      where('serial', '==', serial)
    );

    const querySnapshot = await getDocs(q);
    const peakMap = {};

    querySnapshot.forEach((doc) => {
      const data = doc.data();
      if (data.dateStr) {
        peakMap[data.dateStr] = data;
      }
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
  } catch (err) {
    console.warn('Firestore get10DayPeaks error:', err);
    return null;
  }
}
