import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, Download, Sun, Zap, Layers, Activity, 
  MapPin, Clock, Edit, CheckCircle2, AlertTriangle, ShieldCheck, 
  Calendar, TrendingUp, BarChart3, Database, RefreshCw, X, ShieldAlert, Cpu,
  FileSpreadsheet, CalendarDays, History, Sparkles, Check, HardDrive, Cloud
} from 'lucide-react';
import mqtt from 'mqtt';
import { 
  ResponsiveContainer, Tooltip, PieChart, Pie, Cell,
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid
} from 'recharts';
import { 
  getDeviceBySerial, 
  upsertDevice, 
  recordDeviceTelemetry, 
  getHistoricalAnalytics, 
  getLastLiveData, 
  saveLastLiveData,
  getHistoricalAnalyticsDB,
  get10DayDailySummaries,
  export10DayCSV,
  isFirebaseConfigured,
  syncDevicesFromCloud
} from '../utils/storage';
import { generateSolarPdfReport } from '../utils/pdfGenerator';

function CustomHistoryTooltip({ active, payload, label }) {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const hasData = (data.energy > 0) || (data.power > 0) || (data.hasData);
    return (
      <div className="bg-slate-900 text-white px-3.5 py-2.5 rounded-xl shadow-xl text-xs space-y-1.5 border border-slate-700/50">
        <div className="font-bold text-slate-200 border-b border-slate-700/60 pb-1 flex items-center justify-between gap-4">
          <span>{label} {data.day ? `(${data.day})` : ''}</span>
          {data.isToday && <span className="text-[9px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded font-bold">Today</span>}
        </div>
        {!hasData ? (
          <div className="text-slate-400 italic py-0.5">No readings recorded</div>
        ) : (
          <>
            {data.energy !== null && data.energy !== undefined && (
              <div className="flex items-center justify-between gap-4">
                <span className="text-slate-400">Daily Yield:</span>
                <span className="font-bold text-emerald-400">{data.energy} kWh</span>
              </div>
            )}
            {data.power !== null && data.power !== undefined && (
              <div className="flex items-center justify-between gap-4">
                <span className="text-slate-400">Peak Output:</span>
                <span className="font-bold text-blue-400">{data.power} kW</span>
              </div>
            )}
            {data.peakTime && data.peakTime !== '--' && (
              <div className="flex items-center justify-between gap-4 text-[10px]">
                <span className="text-slate-400">Peak Time:</span>
                <span className="font-medium text-slate-300">{data.peakTime}</span>
              </div>
            )}
            {data.specificYield > 0 && (
              <div className="flex items-center justify-between gap-4">
                <span className="text-slate-400">Specific Yield:</span>
                <span className="font-medium text-amber-300">{data.specificYield} kWh/kWp</span>
              </div>
            )}
          </>
        )}
      </div>
    );
  }
  return null;
}

export default function DeviceDashboard() {
  const { serial } = useParams();
  const navigate = useNavigate();

  const [device, setDevice] = useState(() => getDeviceBySerial(serial));
  const [liveData, setLiveData] = useState(() => getLastLiveData(serial));
  const [lastSeen, setLastSeen] = useState(Date.now());
  const [isOnline, setIsOnline] = useState(false);
  const [viewMode, setViewMode] = useState('combined');
  
  // 10-Day Historical Analytics State (Only 10 days)
  const [historyMetric, setHistoryMetric] = useState('energy'); // 'energy' | 'power'
  const [historicalData, setHistoricalData] = useState([]);
  const [tenDaySummaries, setTenDaySummaries] = useState([]);
  const [csvExporting, setCsvExporting] = useState(false);
  const [csvSuccess, setCsvSuccess] = useState(false);

  // Edit Site Modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState({ ...device });
  const isCloudSynced = isFirebaseConfigured();

  // 1. MQTT Connection & Live Streaming
  useEffect(() => {
    const dev = getDeviceBySerial(serial);
    setDevice(dev);

    // Sync from Firestore so device details/capacity are accurate on phones
    syncDevicesFromCloud().then(devices => {
      const found = devices.find(d => d.serial_number === serial);
      if (found) setDevice(found);
    });
    
    const cached = getLastLiveData(serial);
    if (cached) {
      setLiveData(cached);
      setIsOnline(true);
    }
    
    const mqttHost = localStorage.getItem('oes_mqtt_host') || 'wss://broker.emqx.io:8084/mqtt';
    const mqttPrefix = localStorage.getItem('oes_mqtt_prefix') || 'oes';

    console.log('DeviceDashboard: Connecting to MQTT ' + mqttHost + ' for device ' + serial);
    const client = mqtt.connect(mqttHost);

    client.on('connect', () => {
      console.log('DeviceDashboard: Connected to MQTT for ' + serial);
      client.subscribe(mqttPrefix + '/#');
      client.subscribe('oes/#');
    });

    client.on('message', (topic, message) => {
      try {
        const parts = topic.split('/');
        let msgSerial = '';
        let type = '';

        if (parts[0] === 'oes' && parts[1] === 'logger' && parts.length >= 4) {
          msgSerial = parts[2];
          type = parts[3];
        } else if (parts.length >= 3) {
          msgSerial = parts[1];
          type = parts[2];
        } else if (parts.length === 2) {
          msgSerial = parts[1];
          type = 'telemetry';
        }

        if (!msgSerial || msgSerial.toLowerCase() !== serial.toLowerCase()) return;

        const data = JSON.parse(message.toString());
        const now = Date.now();
        setLastSeen(now);
        setIsOnline(true);

        if (type === 'telemetry' || type === 'live' || !type || data.ac_w !== undefined || data.inv !== undefined) {
          setLiveData(data);
          saveLastLiveData(serial, data);
          recordDeviceTelemetry(serial, data);
        } else if (type === 'status') {
          setIsOnline(data.online === true || data.online === 1 || data.online === 'true');
        }
      } catch (e) {
        console.error('DeviceDashboard MQTT parse error:', e);
      }
    });

    const timer = setInterval(() => {
      setLastSeen(prev => {
        if (Date.now() - prev > 45000) {
          setIsOnline(false);
        }
        return prev;
      });
    }, 5000);

    return () => {
      client.end();
      clearInterval(timer);
    };
  }, [serial]);

  // Load 10-Day history (from Firebase Firestore or local IndexedDB)
  useEffect(() => {
    let isMounted = true;
    async function loadHistory() {
      const cap = device?.capacity_kw || 50;
      const data = await getHistoricalAnalyticsDB(serial, '10days', cap);
      if (isMounted) {
        setHistoricalData(data || []);
      }
      const summaries = await get10DayDailySummaries(serial, cap);
      if (isMounted) {
        setTenDaySummaries(summaries || []);
      }
    }
    loadHistory();
    return () => { isMounted = false; };
  }, [serial, device?.capacity_kw, liveData]);

  const handleSaveSiteDetails = () => {
    const updated = upsertDevice({ ...editForm, _userEdit: true });
    setDevice(getDeviceBySerial(serial));
    setShowEditModal(false);
  };

  const handleDownloadPdf = () => {
    const pdfData = liveData || getLastLiveData(serial);
    if (pdfData && pdfData.inv) {
      pdfData.inv.forEach((inv, i) => {
        const strKeys = Object.keys(inv).filter(k => k.startsWith('str') && k.endsWith('_v'));
        console.log('[PDF] Inv', inv.addr || i+1, '=> strings:', strKeys.join(', '));
      });
    }
    generateSolarPdfReport({
      device,
      liveData: pdfData,
      historicalData,
      selectedPeriod: '10days'
    });
  };

  const handleExportCsv = async () => {
    try {
      setCsvExporting(true);
      await export10DayCSV(serial, device);
      setCsvSuccess(true);
      setTimeout(() => setCsvSuccess(false), 4000);
    } catch (err) {
      console.error('Error exporting CSV:', err);
    } finally {
      setCsvExporting(false);
    }
  };

  // Zero-out when device is offline
  const ZERO_DATA = {
    status: 0, pv_v: 0, pv_a: 0, pv_w: 0,
    ac_v: 0, ac_a: 0, ac_w: 0, freq: 0,
    e_day: 0, e_tot: 0, temp: 0
  };
  const rawData = liveData || getLastLiveData(serial) || ZERO_DATA;
  const displayData = isOnline ? rawData : (() => {
    if (rawData.inv && Array.isArray(rawData.inv)) {
      return { ...rawData, inv: rawData.inv.map(inv => ({ ...inv, ...ZERO_DATA, status: 0, online: 0 })) };
    }
    return { ...rawData, ...ZERO_DATA };
  })();

  const isMulti = Array.isArray(displayData) || (displayData.inv && Array.isArray(displayData.inv));
  const inverters = Array.isArray(displayData) ? displayData : (displayData.inv ? displayData.inv : [displayData]);
  const isCombined = viewMode === 'combined';
  const currentInv = isCombined ? inverters[0] : inverters[parseInt(viewMode)] || inverters[0];

  const ac_w = isCombined ? inverters.reduce((s, i) => s + (parseFloat(i.ac_w) || 0), 0) : (parseFloat(currentInv.ac_w) || 0);
  const pv_w = isCombined ? inverters.reduce((s, i) => s + (parseFloat(i.pv_w) || 0), 0) : (parseFloat(currentInv.pv_w) || 0);
  const e_day = isCombined ? inverters.reduce((s, i) => s + (parseFloat(i.e_day) || 0), 0) : (parseFloat(currentInv.e_day) || 0);
  const e_tot = isCombined ? inverters.reduce((s, i) => s + (parseFloat(i.e_tot) || 0), 0) : (parseFloat(currentInv.e_tot) || 0);

  const powerKW = (ac_w / 1000).toFixed(2);

  // MPPT Strings (Real data only)
  const allStrings = [];
  inverters.forEach((inv, invIdx) => {
    if (!isCombined && parseInt(viewMode) !== invIdx) return;

    if (inv.mppt && Array.isArray(inv.mppt)) {
      inv.mppt.forEach(mppt => {
        mppt.strings?.forEach(str => {
          const v = parseFloat(str.v) || 0;
          const a = parseFloat(str.a) || 0;
          const power = v * a;
          if (power > 0) {
            allStrings.push({
              name: str.label || (isMulti ? `Inv${invIdx+1} ${mppt.label} ${str.label}` : `${mppt.label} ${str.label}`),
              voltage: v,
              current: a,
              value: power
            });
          }
        });
      });
    } else {
      Object.keys(inv).forEach(key => {
        if (key.startsWith('str') && key.endsWith('_v')) {
          const sid = key.replace('str', '').replace('_v', '');
          const v = parseFloat(inv[key]);
          const a = parseFloat(inv[`str${sid}_a`]);
          if (v > 0 || a > 0) {
            allStrings.push({
              name: isMulti ? `Inv${invIdx + 1}-Str${sid}` : `String ${sid}`,
              voltage: v,
              current: a,
              value: v * a
            });
          }
        }
      });
    }
  });

  const PIE_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#14B8A6', '#F43F5E', '#6366F1'];

  const isGenerating = parseFloat(ac_w) > 0 || currentInv?.status === 2 || currentInv?.status === '2' || currentInv?.status === 'online';
  const statusLabel = isGenerating ? 'Generating' : (currentInv?.status === 3 ? 'Fault' : (isOnline ? 'Standby' : 'Offline'));
  const statusColor = isGenerating ? 'bg-oes-green text-oes-blue' : (currentInv?.status === 3 ? 'bg-red-500 text-white' : 'bg-slate-700 text-white');

  const timeDiffSec = Math.floor((Date.now() - lastSeen) / 1000);
  const heartbeatText = isOnline 
    ? (timeDiffSec < 5 ? 'Just now' : `${timeDiffSec}s ago`) 
    : 'Offline';

  const hasAnyChartData = historicalData.some(d => (d.energy > 0) || (d.power > 0) || d.hasData);

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 text-slate-800 pb-20">
      
      {/* 1. TOP NAV & CONTROLS */}
      <div className="bg-oes-blue text-white pt-6 md:pt-10 pb-6 md:pb-8 px-4 md:px-12 shadow-lg rounded-b-3xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -mr-20 -mt-20 pointer-events-none"></div>
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-4 relative z-10">
          <div>
            <button 
              onClick={() => navigate('/')} 
              className="flex items-center gap-2 text-white/80 hover:text-white mb-3 md:mb-4 transition-colors font-medium text-xs md:text-sm"
            >
              <ArrowLeft className="w-4 h-4" /> Back to Fleet Overview
            </button>
            <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
              <Activity className="w-5 h-5 md:w-6 md:h-6" /> {device.client_name || 'Solar Site'}
            </h1>
            <p className="text-white/80 mt-1 text-xs md:text-sm font-medium">
              {device.serial_number} • {device.site_name}
            </p>
          </div>
          
          <div className="flex flex-wrap items-center gap-2 md:gap-3 w-full md:w-auto mt-2 md:mt-0">
            <button 
              onClick={() => { setEditForm({ ...device }); setShowEditModal(true); }}
              className="flex items-center justify-center gap-1.5 p-2.5 md:p-3 bg-white/10 hover:bg-white/20 rounded-xl transition-colors text-white font-semibold text-xs md:text-sm"
            >
              <Edit className="w-4 h-4" /> Edit Site
            </button>

            {/* Generate PDF Button */}
            <button 
              onClick={handleDownloadPdf}
              className="flex items-center justify-center gap-1.5 px-4 md:px-5 py-2.5 md:py-3 bg-white text-oes-blue hover:bg-slate-50 rounded-xl transition-all font-bold text-xs md:text-sm shadow-[0_4px_12px_rgba(0,0,0,0.1)] hover:shadow-[0_6px_16px_rgba(0,0,0,0.15)] hover:-translate-y-0.5"
            >
              <Download className="w-4 h-4" /> Generate PDF
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto w-full px-4 md:px-8 py-6 flex flex-col gap-6 -mt-4">
        
        {/* MULTI-INVERTER TABS */}
        {isMulti && (
          <div className="bg-white p-1.5 md:p-2 rounded-xl shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] border border-slate-100 flex gap-2 overflow-x-auto mx-2 md:mx-0 hide-scrollbar">
            <button 
              onClick={() => setViewMode('combined')}
              className={`px-4 py-2 rounded-lg text-xs md:text-sm font-bold whitespace-nowrap transition-colors ${isCombined ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'}`}
            >
              Combined Plant
            </button>
            {inverters.map((inv, idx) => (
              <button 
                key={idx} 
                onClick={() => setViewMode(idx.toString())}
                className={`px-4 py-2 rounded-lg text-xs md:text-sm font-bold whitespace-nowrap transition-colors ${viewMode === idx.toString() ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'}`}
              >
                Inverter {idx + 1}
              </button>
            ))}
          </div>
        )}

        {/* HERO SOLAR GENERATION CARD */}
        <div className="bg-white rounded-3xl p-5 md:p-8 shadow-[0_8px_30px_-10px_rgba(0,0,0,0.05)] border border-slate-100 relative overflow-hidden mx-2 md:mx-0 group hover:shadow-[0_8px_30px_-10px_rgba(0,0,0,0.08)] transition-shadow">
          <div className="absolute top-0 right-0 w-32 h-32 md:w-48 md:h-48 bg-gradient-to-bl from-oes-green/10 to-transparent rounded-bl-full -mr-10 -mt-10 pointer-events-none"></div>
          
          <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-5 md:gap-6">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className={`px-2.5 py-1 rounded-md text-[9px] md:text-[10px] font-black uppercase tracking-wider ${statusColor}`}>
                  {statusLabel}
                </span>
                <span className={`px-2.5 py-1 rounded-md text-[9px] md:text-[10px] font-black uppercase tracking-wider ${isOnline ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-500'}`}>
                  {isOnline ? 'ONLINE' : 'OFFLINE'}
                </span>
                <span className="text-[10px] text-slate-400 font-medium ml-2">
                  Last telemetry: {heartbeatText}
                </span>
              </div>
              
              <div className="text-xs md:text-sm font-bold text-slate-400 uppercase tracking-widest mt-2 md:mt-4">
                {isCombined ? 'Total Active Output' : 'Current Output'}
              </div>
              <div className="flex items-baseline gap-1.5 md:gap-2 mt-1">
                <span className="text-5xl md:text-7xl font-black text-slate-800 tracking-tighter">{powerKW}</span>
                <span className="text-xl md:text-2xl font-bold text-slate-400">kW</span>
              </div>
            </div>

            <div className="bg-slate-50/80 md:bg-transparent p-3 md:p-0 rounded-xl md:rounded-none md:text-right border border-slate-100 md:border-none">
              <div className="text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-widest">Performance Ratio</div>
              <div className="text-lg md:text-2xl font-black text-slate-700 mt-0.5 md:mt-1">
                {device.capacity_kw > 0 ? ((parseFloat(powerKW) / device.capacity_kw) * 100).toFixed(1) : '0.0'}%
              </div>
              <div className="text-[10px] md:text-xs text-slate-400 mt-1 md:mt-2 font-medium">Rated: {device.capacity_kw} kWp</div>
            </div>
          </div>
        </div>

        {/* 4. CORE KPI METRICS */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mx-2 md:mx-0">
          <div className="bg-white p-4 md:p-5 rounded-2xl border border-slate-100 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] hover:-translate-y-1 transition-transform">
            <div className="bg-gradient-to-br from-oes-green/20 to-oes-green/5 w-10 h-10 rounded-xl flex items-center justify-center text-oes-green-dark mb-3"><Zap className="w-5 h-5" /></div>
            <div className="text-xl md:text-3xl font-black text-slate-800">{e_day.toFixed(1)}</div>
            <div className="text-[10px] md:text-xs font-bold text-slate-400 mt-1 uppercase tracking-wider">Today (kWh)</div>
          </div>

          <div className="bg-white p-4 md:p-5 rounded-2xl border border-slate-100 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] hover:-translate-y-1 transition-transform">
            <div className="bg-gradient-to-br from-oes-blue/20 to-oes-blue/5 w-10 h-10 rounded-xl flex items-center justify-center text-oes-blue mb-3"><Activity className="w-5 h-5" /></div>
            <div className="text-xl md:text-3xl font-black text-slate-800">{(e_tot / 1000).toFixed(1)}</div>
            <div className="text-[10px] md:text-xs font-bold text-slate-400 mt-1 uppercase tracking-wider">Life (MWh)</div>
          </div>

          <div className="bg-white p-4 md:p-5 rounded-2xl border border-slate-100 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] hover:-translate-y-1 transition-transform">
            <div className="bg-gradient-to-br from-amber-500/20 to-amber-500/5 w-10 h-10 rounded-xl flex items-center justify-center text-amber-500 mb-3"><Cpu className="w-5 h-5" /></div>
            <div className="text-xl md:text-3xl font-black text-slate-800">{(parseFloat(currentInv.temp) || 0).toFixed(1)}</div>
            <div className="text-[10px] md:text-xs font-bold text-slate-400 mt-1 uppercase tracking-wider">Temp (°C)</div>
          </div>

          <div className="bg-white p-4 md:p-5 rounded-2xl border border-slate-100 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] hover:-translate-y-1 transition-transform">
            <div className="bg-gradient-to-br from-indigo-500/20 to-indigo-500/5 w-10 h-10 rounded-xl flex items-center justify-center text-indigo-500 mb-3"><ShieldAlert className="w-5 h-5" /></div>
            <div className="text-xl md:text-3xl font-black text-slate-800">{(parseFloat(currentInv.freq) || 0).toFixed(2)}</div>
            <div className="text-[10px] md:text-xs font-bold text-slate-400 mt-1 uppercase tracking-wider">Freq (Hz)</div>
          </div>
        </div>

        {/* 5. ELECTRICAL PARAMETERS: DC SOLAR VS AC GRID */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mx-2 md:mx-0">
          {/* DC Array */}
          <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Sun className="w-5 h-5 text-amber-500" /> DC Solar Input (PV)
            </h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center pb-2 border-b border-slate-50">
                <span className="text-slate-500 font-medium">Voltage</span>
                <span className="font-bold text-slate-800 text-lg">{(parseFloat(currentInv.pv_v) || 0).toFixed(1)} V</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-slate-50">
                <span className="text-slate-500 font-medium">Current</span>
                <span className="font-bold text-slate-800 text-lg">{(parseFloat(currentInv.pv_a) || 0).toFixed(2)} A</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Total Power</span>
                <span className="font-bold text-amber-500 text-lg">{((pv_w || 0) / 1000).toFixed(2)} kW</span>
              </div>
            </div>
          </div>

          {/* AC Grid */}
          <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Zap className="w-5 h-5 text-oes-blue" /> AC Grid Output
            </h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center pb-2 border-b border-slate-50">
                <span className="text-slate-500 font-medium">Voltage</span>
                <span className="font-bold text-slate-800 text-lg">{(parseFloat(currentInv.ac_v) || 0).toFixed(1)} V</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-slate-50">
                <span className="text-slate-500 font-medium">Current</span>
                <span className="font-bold text-slate-800 text-lg">{(parseFloat(currentInv.ac_a) || 0).toFixed(2)} A</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Active Power</span>
                <span className="font-bold text-oes-blue text-lg">{powerKW} kW</span>
              </div>
            </div>
          </div>
        </div>

        {/* 6. PROPERLY ARRANGED 10-DAY GENERATION HISTORY & PEAK AUDIT */}
        <div className="bg-white rounded-3xl p-5 md:p-8 border border-slate-100 shadow-[0_8px_30px_-10px_rgba(0,0,0,0.05)] mx-2 md:mx-0 space-y-6">
          
          {/* Header Block: Balanced Flex Row */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            
            {/* Title & Status Badge */}
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 bg-oes-blue/10 text-oes-blue rounded-2xl flex items-center justify-center shrink-0">
                <CalendarDays className="w-6 h-6" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base md:text-lg font-bold text-slate-800 tracking-tight">
                    10-Day Generation History
                  </h3>
                  {isCloudSynced ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200/80">
                      <Cloud className="w-3 h-3 text-amber-600" /> Cloud Synced
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200/80">
                      <HardDrive className="w-3 h-3 text-emerald-600" /> Local Storage
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 font-medium mt-0.5">
                  Daily peak power and total energy yield for the past 10 days
                </p>
              </div>
            </div>

            {/* Metric Mode Toggle & Export Button (Clean Single Row) */}
            <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
              
              {/* Metric Toggle */}
              <div className="bg-slate-100 p-1 rounded-xl flex items-center text-xs font-bold">
                <button
                  onClick={() => setHistoryMetric('energy')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                    historyMetric === 'energy' 
                      ? 'bg-white text-slate-900 shadow-sm' 
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Zap className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Yield (kWh)</span>
                </button>
                <button
                  onClick={() => setHistoryMetric('power')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                    historyMetric === 'power' 
                      ? 'bg-white text-slate-900 shadow-sm' 
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <TrendingUp className="w-3.5 h-3.5 text-blue-600" />
                  <span>Peak Power (kW)</span>
                </button>
              </div>

              {/* Export 10-Day CSV Button */}
              <button
                onClick={handleExportCsv}
                disabled={csvExporting}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors border border-slate-200/60"
                title="Download complete 10-day peak readings as CSV"
              >
                {csvSuccess ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />}
                <span>{csvSuccess ? 'Exported!' : 'Export CSV'}</span>
              </button>

            </div>
          </div>

          {/* 10-Day Interactive Chart */}
          <div className="w-full h-64 md:h-72 pt-2">
            <ResponsiveContainer width="100%" height="100%">
              {historyMetric === 'energy' ? (
                <BarChart data={historicalData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                  <defs>
                    <linearGradient id="oesEnergyGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10B981" stopOpacity={0.9} />
                      <stop offset="100%" stopColor="#059669" stopOpacity={0.65} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                  <XAxis 
                    dataKey="time" 
                    stroke="#94A3B8" 
                    fontSize={11} 
                    tickLine={false} 
                    axisLine={{ stroke: '#E2E8F0' }} 
                  />
                  <YAxis 
                    stroke="#94A3B8" 
                    fontSize={11} 
                    tickLine={false} 
                    axisLine={false} 
                    unit=" kWh" 
                  />
                  <Tooltip content={<CustomHistoryTooltip />} />
                  <Bar 
                    dataKey="energy" 
                    fill="url(#oesEnergyGrad)" 
                    radius={[6, 6, 0, 0]} 
                    maxBarSize={42} 
                  />
                </BarChart>
              ) : (
                <AreaChart data={historicalData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                  <defs>
                    <linearGradient id="oesPowerGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.45} />
                      <stop offset="95%" stopColor="#3B82F6" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                  <XAxis 
                    dataKey="time" 
                    stroke="#94A3B8" 
                    fontSize={11} 
                    tickLine={false} 
                    axisLine={{ stroke: '#E2E8F0' }} 
                  />
                  <YAxis 
                    stroke="#94A3B8" 
                    fontSize={11} 
                    tickLine={false} 
                    axisLine={false} 
                    unit=" kW" 
                  />
                  <Tooltip content={<CustomHistoryTooltip />} />
                  <Area 
                    type="monotone" 
                    dataKey="power" 
                    stroke="#3B82F6" 
                    strokeWidth={3} 
                    fillOpacity={1} 
                    fill="url(#oesPowerGrad)" 
                  />
                </AreaChart>
              )}
            </ResponsiveContainer>
          </div>

          {!hasAnyChartData && (
            <div className="flex items-center justify-center gap-2 py-2 px-4 bg-slate-50 rounded-xl text-xs text-slate-500 border border-slate-100">
              <Activity className="w-3.5 h-3.5 text-slate-400 animate-pulse" />
              <span>Awaiting first transmission — daily peaks will populate automatically as your data logger transmits live data.</span>
            </div>
          )}

          {/* 10-Day Yield Audit Table */}
          {tenDaySummaries.length > 0 && (
            <div className="pt-4 border-t border-slate-100">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <History className="w-4 h-4 text-oes-blue" /> 10-Day Plant Reading Log
                </h4>
                <span className="text-[11px] text-slate-400 font-medium">
                  Showing all 10 days of recorded peak generation
                </span>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-100">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-50/80 border-b border-slate-100 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4">Daily Yield (kWh)</th>
                      <th className="py-3 px-4">Peak Power (kW)</th>
                      <th className="py-3 px-4">Specific Yield</th>
                      <th className="py-3 px-4">Avg Temp</th>
                      <th className="py-3 px-4 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium bg-white">
                    {tenDaySummaries.map((day, idx) => (
                      <tr key={idx} className={`hover:bg-slate-50/80 transition-colors ${day.isToday ? 'bg-emerald-50/30' : ''}`}>
                        <td className="py-3 px-4 flex items-center gap-2">
                          <span className="font-bold text-slate-800">{day.formattedDate}</span>
                          <span className="text-[11px] text-slate-400">({day.dayName})</span>
                          {day.isToday && (
                            <span className="text-[9px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-black uppercase">Today</span>
                          )}
                        </td>
                        <td className="py-3 px-4 font-bold text-slate-800">
                          {day.hasData ? `${day.totalKwh} kWh` : '--'}
                        </td>
                        <td className="py-3 px-4">
                          {day.hasData ? (
                            <div>
                              <span className="font-bold text-slate-800">{day.peakKw} kW</span>
                              {day.peakTime && day.peakTime !== '--' && (
                                <span className="text-[10px] text-slate-400 block font-normal">at {day.peakTime}</span>
                              )}
                            </div>
                          ) : '--'}
                        </td>
                        <td className="py-3 px-4 text-slate-600">
                          {day.hasData && day.specificYield > 0 ? `${day.specificYield} kWh/kWp` : '--'}
                        </td>
                        <td className="py-3 px-4 text-slate-500">
                          {day.hasData && day.avgTemp > 0 ? `${day.avgTemp} °C` : '--'}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <span className={`inline-block px-2.5 py-1 rounded-md text-[10px] font-bold ${
                            !day.hasData
                              ? 'bg-slate-100 text-slate-400'
                              : day.status === 'Active' 
                                ? 'bg-emerald-100 text-emerald-800' 
                                : 'bg-amber-100 text-amber-800'
                          }`}>
                            {!day.hasData ? 'No Data' : day.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* 7. MPPT & STRING CONTRIBUTION */}
        {allStrings.length > 0 && (
          <div className="bg-white rounded-2xl p-6 md:p-8 border border-slate-100 shadow-sm space-y-6 mx-2 md:mx-0">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Layers className="w-5 h-5 text-oes-blue" /> MPPT / String Distribution
            </h3>

            <div className="flex flex-col md:flex-row items-center gap-8 md:gap-12">
              <div style={{ width: 220, height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={allStrings} innerRadius={65} outerRadius={90} paddingAngle={4} dataKey="value" stroke="none">
                      {allStrings.map((entry, index) => (
                        <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(val) => `${(val / 1000).toFixed(2)} kW`} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
                {allStrings.map((str, idx) => (
                  <div key={idx} className="bg-slate-50 p-4 rounded-2xl border border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-4 h-4 rounded-full" style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }}></div>
                      <span className="font-bold text-slate-700">{str.name}</span>
                    </div>
                    <div className="text-right">
                      <div className="font-black text-slate-800 text-lg">{(str.value / 1000).toFixed(2)} kW</div>
                      <div className="text-xs font-medium text-slate-500">{str.voltage?.toFixed(1)}V • {str.current?.toFixed(2)}A</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

      </div>

      {/* EDIT SITE MODAL */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl border border-slate-100 space-y-6">
            <div className="flex justify-between items-center">
              <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <Edit className="w-5 h-5 text-oes-blue" /> Edit Site Details
              </h3>
              <button onClick={() => setShowEditModal(false)} className="text-slate-400 hover:text-slate-600 bg-slate-50 p-2 rounded-full">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 font-semibold">
              <div>
                <label className="block text-sm text-slate-500 mb-1">Client Name *</label>
                <input 
                  type="text" 
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-800 outline-none focus:border-oes-blue focus:ring-2 focus:ring-oes-blue/20 transition-all"
                  value={editForm.client_name}
                  onChange={e => setEditForm({ ...editForm, client_name: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-sm text-slate-500 mb-1">Site Name</label>
                <input 
                  type="text" 
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-800 outline-none focus:border-oes-blue focus:ring-2 focus:ring-oes-blue/20 transition-all"
                  value={editForm.site_name}
                  onChange={e => setEditForm({ ...editForm, site_name: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-slate-500 mb-1">Location</label>
                  <input 
                    type="text" 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-800 outline-none focus:border-oes-blue focus:ring-2 focus:ring-oes-blue/20 transition-all"
                    value={editForm.location}
                    onChange={e => setEditForm({ ...editForm, location: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-500 mb-1">Capacity (kWp)</label>
                  <input 
                    type="number" 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-800 outline-none focus:border-oes-blue focus:ring-2 focus:ring-oes-blue/20 transition-all"
                    value={editForm.capacity_kw}
                    onChange={e => setEditForm({ ...editForm, capacity_kw: parseFloat(e.target.value) || 50 })}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-slate-500 mb-1">Inverter Model</label>
                <input 
                  type="text" 
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-800 outline-none focus:border-oes-blue focus:ring-2 focus:ring-oes-blue/20 transition-all"
                  value={editForm.inverter_model}
                  onChange={e => setEditForm({ ...editForm, inverter_model: e.target.value })}
                />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button 
                onClick={() => setShowEditModal(false)}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 py-4 rounded-2xl text-sm font-bold transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleSaveSiteDetails}
                className="flex-1 bg-oes-blue hover:bg-slate-800 text-white py-4 rounded-2xl text-sm font-bold shadow-lg shadow-oes-blue/20 transition-all transform active:scale-95"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
