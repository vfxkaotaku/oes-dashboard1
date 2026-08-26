import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, Download, Sun, Zap, Layers, Activity, 
  MapPin, Edit, CheckCircle2, AlertTriangle, X,
  Thermometer, Server, Cloud, SunMedium,
  Calendar, Database, Clock
} from 'lucide-react';
import mqtt from 'mqtt';
import { 
  ResponsiveContainer, Tooltip, PieChart, Pie, Cell 
} from 'recharts';
import { 
  getDeviceBySerial, upsertDevice, recordDeviceTelemetry, 
  getLastLiveData, saveLastLiveData 
} from '../utils/storage';
import { getSimulationTelemetry } from '../utils/simulator';
import { generateSolarPdfReport } from '../utils/pdfGenerator';

// Professional Custom SVG Icons
function WaveformIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' className={className}>
      <path d='M2 12h3l3-7 3 14 3-10 3 6 3-3h3' />
    </svg>
  );
}

function SolarPanelIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' className={className}>
      <rect x='2' y='6' width='20' height='12' rx='2' />
      <line x1='12' y1='6' x2='12' y2='18' />
      <line x1='2' y1='12' x2='22' y2='12' />
      <line x1='7' y1='6' x2='7' y2='18' />
      <line x1='17' y1='6' x2='17' y2='18' />
    </svg>
  );
}

function GridPowerIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' className={className}>
      <path d='M3 3h3l1 7H5L3 3z' />
      <path d='M21 3h-3l-1 7h2l2-7z' />
      <path d='M5 10h14' />
      <path d='M9 10l1 11h4l1-11' />
      <path d='M7 21h10' />
    </svg>
  );
}

function MPPTIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' className={className}>
      <polyline points='22 12 18 12 15 21 9 3 6 12 2 12' />
    </svg>
  );
}

function InverterIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' className={className}>
      <rect x='3' y='6' width='18' height='12' rx='2' />
      <path d='M7 12h2l2-3 2 6 2-3h2' />
    </svg>
  );
}

function fmt(val, decimals = 2) {
  const n = parseFloat(val);
  return isNaN(n) ? '0.00' : n.toFixed(decimals);
}

function toKW(watts, decimals = 2) {
  const n = parseFloat(watts);
  return isNaN(n) ? '0.00' : (n / 1000).toFixed(decimals);
}

const PIE_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#14B8A6', '#F43F5E', '#6366F1'];

export default function DeviceDashboard() {
  const { serial } = useParams();
  const navigate = useNavigate();

  const [device, setDevice] = useState(() => getDeviceBySerial(serial));
  const [liveData, setLiveData] = useState(() => getLastLiveData(serial));
  const [lastSeen, setLastSeen] = useState(Date.now());
  const [isOnline, setIsOnline] = useState(true);
  const [viewMode, setViewMode] = useState('combined'); // 'combined' | '0' | '1'
  const [mqttConnected, setMqttConnected] = useState(false);

  // Simulation mode
  const [simMode, setSimMode] = useState(false);
  const [simData, setSimData] = useState(null);
  const simIntervalRef = useRef(null);
  const mqttDataTimerRef = useRef(null);

  // Edit Site Modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState({ ...device });
  const [capacityRaw, setCapacityRaw] = useState(String(device?.capacity_kw ?? 80));

  // 1. MQTT Connection & Live Streaming
  useEffect(() => {
    const dev = getDeviceBySerial(serial);
    setDevice(dev);

    const cached = getLastLiveData(serial);
    if (cached) {
      setLiveData(cached);
      setIsOnline(true);
    }

    const mqttHost = localStorage.getItem('oes_mqtt_host') || 'wss://broker.emqx.io:8084/mqtt';
    const mqttPrefix = localStorage.getItem('oes_mqtt_prefix') || 'oes';

    const client = mqtt.connect(mqttHost);

    client.on('connect', () => {
      setMqttConnected(true);
      client.subscribe(mqttPrefix + '/#');
      client.subscribe('oes/#');
    });

    client.on('close', () => setMqttConnected(false));
    client.on('disconnect', () => setMqttConnected(false));

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
        setLastSeen(Date.now());
        setIsOnline(true);

        if (type === 'telemetry' || type === 'live' || !type || data.ac_w !== undefined || data.inv !== undefined) {
          setLiveData(data);
          setSimMode(false);
          saveLastLiveData(serial, data);
          recordDeviceTelemetry(serial, data);
        } else if (type === 'status') {
          setIsOnline(data.online === true || data.online === 1 || data.online === 'true');
        }

        if (mqttDataTimerRef.current) clearTimeout(mqttDataTimerRef.current);
        mqttDataTimerRef.current = setTimeout(() => {
          setSimMode(true);
        }, 15000);
      } catch (e) {
        console.error('DeviceDashboard MQTT parse error:', e);
      }
    });

    // Auto fallback to simulation if no packets within 15s
    mqttDataTimerRef.current = setTimeout(() => {
      setSimMode(true);
    }, 15000);

    const heartbeatTimer = setInterval(() => {
      setLastSeen(prev => {
        if (Date.now() - prev > 45000) setIsOnline(false);
        return prev;
      });
    }, 5000);

    return () => {
      client.end();
      clearInterval(heartbeatTimer);
      if (mqttDataTimerRef.current) clearTimeout(mqttDataTimerRef.current);
      if (simIntervalRef.current) clearInterval(simIntervalRef.current);
    };
  }, [serial]);

  // Simulation loop
  useEffect(() => {
    if (simIntervalRef.current) clearInterval(simIntervalRef.current);

    if (simMode) {
      const tick = () => {
        const payload = getSimulationTelemetry();
        setSimData(payload);
        setIsOnline(true);
        setLastSeen(Date.now());
        saveLastLiveData(serial, payload);
      };
      tick();
      simIntervalRef.current = setInterval(tick, 4000);
    } else {
      simIntervalRef.current = null;
    }

    return () => {
      if (simIntervalRef.current) clearInterval(simIntervalRef.current);
    };
  }, [simMode, serial]);

  // Handle Edit Site Save
  const handleSaveSiteDetails = () => {
    const parsedCap = parseFloat(capacityRaw);
    const updated = {
      ...editForm,
      capacity_kw: !isNaN(parsedCap) && parsedCap > 0 ? parsedCap : 80
    };
    upsertDevice(updated);
    setDevice(getDeviceBySerial(serial));
    setShowEditModal(false);
  };

  const handleDownloadPdf = () => {
    generateSolarPdfReport({
      device,
      liveData: activeData,
      historicalData: [],
      selectedPeriod: 'today'
    });
  };

  // Determine active dataset
  const activeData = (simMode ? simData : liveData) || liveData || getLastLiveData(serial) || {
    status: 0, pv_v: 0, pv_a: 0, pv_w: 0,
    ac_v: 0, ac_a: 0, ac_w: 0, freq: 0, e_day: 0, e_tot: 0, temp: 0
  };

  const isMulti = !!(activeData?.inv && Array.isArray(activeData.inv));
  const inverters = isMulti ? activeData.inv : [activeData];
  const isCombined = viewMode === 'combined';
  const currentInv = isCombined ? inverters[0] : (inverters[parseInt(viewMode)] || inverters[0]);

  // Calculations in Watts, converted to kW for UI
  const total_ac_w = isCombined 
    ? inverters.reduce((s, i) => s + (parseFloat(i.ac_w) || 0), 0)
    : (parseFloat(currentInv.ac_w) || 0);

  const total_pv_w = isCombined 
    ? inverters.reduce((s, i) => s + (parseFloat(i.pv_w) || 0), 0)
    : (parseFloat(currentInv.pv_w) || 0);

  const total_e_day = isCombined 
    ? inverters.reduce((s, i) => s + (parseFloat(i.e_day) || 0), 0)
    : (parseFloat(currentInv.e_day) || 0);

  const total_e_tot = isCombined 
    ? inverters.reduce((s, i) => s + (parseFloat(i.e_tot) || 0), 0)
    : (parseFloat(currentInv.e_tot) || 0);

  const avg_temp = isCombined 
    ? inverters.reduce((s, i) => s + (parseFloat(i.temp) || 0), 0) / inverters.length
    : (parseFloat(currentInv.temp) || 0);

  const avg_freq = isCombined 
    ? inverters.reduce((s, i) => s + (parseFloat(i.freq) || 0), 0) / inverters.length
    : (parseFloat(currentInv.freq) || 0);

  const plantRatedKw = device?.capacity_kw || 80;
  const singleInvRatedKw = plantRatedKw / Math.max(inverters.length, 1);
  const activeRatedKw = isCombined ? plantRatedKw : singleInvRatedKw;

  // Extract MPPT / Strings
  const allStrings = [];
  inverters.forEach((inv, invIdx) => {
    if (!isCombined && parseInt(viewMode) !== invIdx) return;

    if (inv.mppt && Array.isArray(inv.mppt)) {
      inv.mppt.forEach(mppt => {
        mppt.strings?.forEach(str => {
          const v = parseFloat(str.v) || 0;
          const a = parseFloat(str.a) || 0;
          const w = parseFloat(str.w) || (v * a);
          if (w > 0) {
            allStrings.push({
              name: isMulti ? `Inv${invIdx + 1} ${str.label}` : str.label,
              voltage: v,
              current: a,
              value: w // stored in Watts
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

  const isGenerating = total_ac_w > 100 || currentInv?.status === 2 || currentInv?.status === '2';
  const statusLabel = isGenerating ? 'Generating' : (currentInv?.status === 3 ? 'Fault' : (isOnline ? 'Standby' : 'Offline'));
  const statusColor = isGenerating ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : (currentInv?.status === 3 ? 'bg-red-100 text-red-800 border border-red-300' : 'bg-slate-100 text-slate-600 border border-slate-300');
  const onlineBadge = isOnline ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-red-100 text-red-800 border border-red-300';

  const timeDiffSec = Math.floor((Date.now() - lastSeen) / 1000);
  const heartbeatText = isOnline ? (timeDiffSec < 5 ? 'Just now' : `${timeDiffSec}s ago`) : 'Offline';

  return (
    <div className='flex flex-col min-h-screen bg-slate-50 text-slate-800 pb-20'>
      
      {/* 1. TOP HEADER */}
      <div className='bg-oes-blue text-white pt-6 md:pt-10 pb-6 md:pb-8 px-4 md:px-12 shadow-lg rounded-b-3xl relative overflow-hidden'>
        <div className='absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -mr-20 -mt-20 pointer-events-none' />
        <div className='max-w-5xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-4 relative z-10'>
          <div>
            <button 
              onClick={() => navigate('/')} 
              className='flex items-center gap-2 text-white/80 hover:text-white mb-3 md:mb-4 transition-colors font-medium text-xs md:text-sm'
            >
              <ArrowLeft className='w-4 h-4' /> Back to Fleet Overview
            </button>
            <h1 className='text-xl md:text-2xl font-bold flex items-center gap-2'>
              <SunMedium className='w-5 h-5 md:w-6 md:h-6 text-amber-300' /> {device.client_name || 'Solar Site'}
            </h1>
            <p className='text-white/80 mt-1 text-xs md:text-sm font-medium flex items-center gap-2 flex-wrap'>
              <span>{device.serial_number}</span>
              <span>&bull;</span>
              <span>{device.site_name}</span>
              {simMode && (
                <span className='bg-amber-400/20 text-amber-200 text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-300/30'>
                  SIMULATION ACTIVE
                </span>
              )}
            </p>
          </div>
          
          <div className='flex items-center gap-2 md:gap-3 w-full md:w-auto mt-2 md:mt-0'>
            <button 
              onClick={() => {
                setEditForm({ ...device });
                setCapacityRaw(String(device?.capacity_kw ?? 80));
                setShowEditModal(true);
              }}
              className='flex-1 md:flex-none flex items-center justify-center gap-1.5 md:gap-2 p-2.5 md:p-3 bg-white/10 hover:bg-white/20 rounded-xl transition-colors text-white font-semibold text-xs md:text-sm'
            >
              <Edit className='w-4 h-4' /> Edit Site
            </button>
            <button 
              onClick={handleDownloadPdf}
              className='flex-1 md:flex-none flex items-center justify-center gap-1.5 md:gap-2 px-4 md:px-5 py-2.5 md:py-3 bg-white text-oes-blue hover:bg-slate-50 rounded-xl transition-all font-bold text-xs md:text-sm shadow-[0_4px_12px_rgba(0,0,0,0.1)] hover:shadow-[0_6px_16px_rgba(0,0,0,0.15)] hover:-translate-y-0.5'
            >
              <Download className='w-4 h-4' /> Generate PDF
            </button>
          </div>
        </div>
      </div>

      <div className='max-w-5xl mx-auto w-full px-4 md:px-8 py-6 flex flex-col gap-6 -mt-4'>
        
        {/* MULTI-INVERTER TABS */}
        {isMulti && (
          <div className='bg-white p-1.5 md:p-2 rounded-xl shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] border border-slate-100 flex gap-2 overflow-x-auto mx-2 md:mx-0 hide-scrollbar'>
            <button 
              onClick={() => setViewMode('combined')}
              className={`px-4 py-2 rounded-lg text-xs md:text-sm font-bold whitespace-nowrap transition-colors ${isCombined ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'}`}
            >
              Combined Plant ({fmt(plantRatedKw, 0)} kW)
            </button>
            {inverters.map((_, idx) => (
              <button 
                key={idx}
                onClick={() => setViewMode(String(idx))}
                className={`px-4 py-2 rounded-lg text-xs md:text-sm font-bold whitespace-nowrap transition-colors ${viewMode === String(idx) ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'}`}
              >
                Inverter {idx + 1} ({fmt(singleInvRatedKw, 0)} kW)
              </button>
            ))}
          </div>
        )}

        {/* 2. MAIN POWER CARD */}
        <div className='bg-white rounded-2xl p-6 md:p-8 border border-slate-100 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.08)] mx-2 md:mx-0'>
          <div className='flex flex-wrap gap-2.5 mb-5'>
            <span className={`text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider ${statusColor}`}>
              {statusLabel}
            </span>
            <span className={`text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider ${onlineBadge}`}>
              {isOnline ? 'ONLINE' : 'OFFLINE'}
            </span>
            {simMode && (
              <span className='text-xs font-bold px-3 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200'>
                2x Huawei 40kW Sim
              </span>
            )}
          </div>

          <div className='flex flex-col md:flex-row md:items-end justify-between gap-6'>
            <div>
              <div className='text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-2'>
                <InverterIcon className='w-4 h-4 text-oes-blue' />
                {isCombined ? 'Total Plant Active Output' : `Inverter ${parseInt(viewMode) + 1} Active Output`}
              </div>
              <div className='text-5xl md:text-6xl font-black text-slate-800 leading-none'>
                {toKW(total_ac_w)} <span className='text-2xl font-semibold text-slate-400'>kW</span>
              </div>
            </div>

            <div className='bg-slate-50 rounded-2xl px-6 py-4 border border-slate-100 text-right'>
              <div className='text-xs font-bold text-slate-400 uppercase tracking-wider mb-1'>Performance Ratio</div>
              <div className='text-2xl font-black text-slate-700'>
                {((parseFloat(toKW(total_ac_w)) / activeRatedKw) * 100).toFixed(1)}%
              </div>
              <div className='text-xs text-slate-400 mt-1 font-medium'>
                Rated: {fmt(activeRatedKw, 2)} kW
              </div>
            </div>
          </div>
        </div>

        {/* 3. CORE KPI METRICS */}
        <div className='grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mx-2 md:mx-0'>
          <div className='bg-white p-4 md:p-5 rounded-2xl border border-slate-100 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] hover:-translate-y-1 transition-transform'>
            <div className='bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 w-10 h-10 rounded-xl flex items-center justify-center text-emerald-600 mb-3'>
              <Calendar className='w-5 h-5' />
            </div>
            <div className='text-xl md:text-3xl font-black text-slate-800'>{fmt(total_e_day, 1)}</div>
            <div className='text-[10px] md:text-xs font-bold text-slate-400 mt-1 uppercase tracking-wider'>Today (kWh)</div>
          </div>

          <div className='bg-white p-4 md:p-5 rounded-2xl border border-slate-100 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] hover:-translate-y-1 transition-transform'>
            <div className='bg-gradient-to-br from-oes-blue/20 to-oes-blue/5 w-10 h-10 rounded-xl flex items-center justify-center text-oes-blue mb-3'>
              <Database className='w-5 h-5' />
            </div>
            <div className='text-xl md:text-3xl font-black text-slate-800'>{fmt(total_e_tot, 1)}</div>
            <div className='text-[10px] md:text-xs font-bold text-slate-400 mt-1 uppercase tracking-wider'>Lifetime (kWh)</div>
          </div>

          <div className='bg-white p-4 md:p-5 rounded-2xl border border-slate-100 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] hover:-translate-y-1 transition-transform'>
            <div className='bg-gradient-to-br from-amber-500/20 to-amber-500/5 w-10 h-10 rounded-xl flex items-center justify-center text-amber-500 mb-3'>
              <Thermometer className='w-5 h-5' />
            </div>
            <div className='text-xl md:text-3xl font-black text-slate-800'>{fmt(avg_temp, 1)}</div>
            <div className='text-[10px] md:text-xs font-bold text-slate-400 mt-1 uppercase tracking-wider'>Temp (&deg;C)</div>
          </div>

          <div className='bg-white p-4 md:p-5 rounded-2xl border border-slate-100 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] hover:-translate-y-1 transition-transform'>
            <div className='bg-gradient-to-br from-indigo-500/20 to-indigo-500/5 w-10 h-10 rounded-xl flex items-center justify-center text-indigo-500 mb-3'>
              <WaveformIcon className='w-5 h-5' />
            </div>
            <div className='text-xl md:text-3xl font-black text-slate-800'>{fmt(avg_freq, 2)}</div>
            <div className='text-[10px] md:text-xs font-bold text-slate-400 mt-1 uppercase tracking-wider'>Freq (Hz)</div>
          </div>
        </div>

        {/* 4. DC SOLAR INPUT vs AC GRID OUTPUT (Both in kW) */}
        <div className='grid grid-cols-1 md:grid-cols-2 gap-4 mx-2 md:mx-0'>
          {/* DC Solar Input */}
          <div className='bg-white rounded-2xl p-6 border border-slate-100 shadow-sm space-y-4'>
            <h3 className='text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2'>
              <div className='bg-amber-100 p-1.5 rounded-lg'>
                <SolarPanelIcon className='w-4 h-4 text-amber-600' />
              </div>
              DC Solar Input (PV)
            </h3>
            <div className='space-y-3'>
              <div className='flex justify-between items-center pb-2 border-b border-slate-50'>
                <span className='text-slate-500 font-medium text-sm'>PV Voltage</span>
                <span className='font-bold text-slate-800'>{fmt(currentInv.pv_v, 1)} <span className='text-slate-400 font-normal text-sm'>V</span></span>
              </div>
              <div className='flex justify-between items-center pb-2 border-b border-slate-50'>
                <span className='text-slate-500 font-medium text-sm'>PV Current</span>
                <span className='font-bold text-slate-800'>{fmt(currentInv.pv_a, 2)} <span className='text-slate-400 font-normal text-sm'>A</span></span>
              </div>
              <div className='flex justify-between items-center'>
                <span className='text-slate-500 font-medium text-sm'>Total DC Power</span>
                <span className='font-black text-amber-500 text-xl'>{toKW(total_pv_w)} <span className='text-sm font-semibold text-amber-400'>kW</span></span>
              </div>
            </div>
          </div>

          {/* AC Grid Output */}
          <div className='bg-white rounded-2xl p-6 border border-slate-100 shadow-sm space-y-4'>
            <h3 className='text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2'>
              <div className='bg-blue-100 p-1.5 rounded-lg'>
                <GridPowerIcon className='w-4 h-4 text-blue-600' />
              </div>
              AC Grid Output
            </h3>
            <div className='space-y-3'>
              <div className='flex justify-between items-center pb-2 border-b border-slate-50'>
                <span className='text-slate-500 font-medium text-sm'>AC Voltage</span>
                <span className='font-bold text-slate-800'>{fmt(currentInv.ac_v, 1)} <span className='text-slate-400 font-normal text-sm'>V</span></span>
              </div>
              <div className='flex justify-between items-center pb-2 border-b border-slate-50'>
                <span className='text-slate-500 font-medium text-sm'>AC Current</span>
                <span className='font-bold text-slate-800'>{fmt(currentInv.ac_a, 2)} <span className='text-slate-400 font-normal text-sm'>A</span></span>
              </div>
              <div className='flex justify-between items-center'>
                <span className='text-slate-500 font-medium text-sm'>Active Power</span>
                <span className='font-black text-oes-blue text-xl'>{toKW(total_ac_w)} <span className='text-sm font-semibold text-blue-400'>kW</span></span>
              </div>
            </div>
          </div>
        </div>

        {/* 5. ACTIVE LOGGER & CLOUD BROKER STATUS CARDS */}
        <div className='grid grid-cols-1 md:grid-cols-2 gap-4 mx-2 md:mx-0'>
          {/* Active Logger */}
          <div className='bg-white rounded-2xl p-5 border border-slate-100 shadow-sm'>
            <div className='flex items-center justify-between mb-4'>
              <h3 className='text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2'>
                <div className='bg-emerald-100 p-1.5 rounded-lg'>
                  <Server className='w-4 h-4 text-emerald-600' />
                </div>
                Active Logger
              </h3>
              <div className={`flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full ${isOnline ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}`}>
                <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                {isOnline ? 'Active' : 'Offline'}
              </div>
            </div>
            <div className='space-y-2 text-sm'>
              <div className='flex justify-between'>
                <span className='text-slate-500'>Device ID</span>
                <span className='font-bold text-slate-800 font-mono text-xs'>{serial}</span>
              </div>
              <div className='flex justify-between'>
                <span className='text-slate-500'>Last Update</span>
                <span className='font-semibold text-slate-700'>{heartbeatText}</span>
              </div>
              <div className='flex justify-between'>
                <span className='text-slate-500'>Data Source</span>
                <span className={`font-bold text-xs px-2 py-0.5 rounded-full ${simMode ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                  {simMode ? 'Simulation (2x Huawei)' : 'Live Hardware (MQTT)'}
                </span>
              </div>
              <div className='flex justify-between'>
                <span className='text-slate-500'>Inverters</span>
                <span className='font-semibold text-slate-700'>{inverters.length} Connected (40kW each)</span>
              </div>
            </div>
          </div>

          {/* Cloud Broker */}
          <div className='bg-white rounded-2xl p-5 border border-slate-100 shadow-sm'>
            <div className='flex items-center justify-between mb-4'>
              <h3 className='text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2'>
                <div className='bg-sky-100 p-1.5 rounded-lg'>
                  <Cloud className='w-4 h-4 text-sky-600' />
                </div>
                Cloud Broker
              </h3>
              <div className={`flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full ${mqttConnected ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                <span className={`w-2 h-2 rounded-full ${mqttConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400'}`} />
                {mqttConnected ? 'Connected' : 'Connecting'}
              </div>
            </div>
            <div className='space-y-2 text-sm'>
              <div className='flex justify-between'>
                <span className='text-slate-500'>Broker</span>
                <span className='font-bold text-slate-800'>EMQX Cloud</span>
              </div>
              <div className='flex justify-between'>
                <span className='text-slate-500'>Protocol</span>
                <span className='font-semibold text-slate-700'>MQTT over WSS (Port 8084)</span>
              </div>
              <div className='flex justify-between'>
                <span className='text-slate-500'>Topic Prefix</span>
                <span className='font-bold text-slate-800 font-mono text-xs'>
                  {localStorage.getItem('oes_mqtt_prefix') || 'oes'}/#
                </span>
              </div>
              <div className='flex justify-between'>
                <span className='text-slate-500'>Last Packet</span>
                <span className='font-semibold text-slate-700'>{heartbeatText}</span>
              </div>
            </div>
          </div>
        </div>

        {/* 6. INDIVIDUAL INVERTER VIEW (When viewing specific inverter) */}
        {!isCombined && (
          <div className='bg-white rounded-2xl p-6 border border-slate-100 shadow-sm mx-2 md:mx-0'>
            <h3 className='text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2 mb-5'>
              <div className='bg-indigo-100 p-1.5 rounded-lg'>
                <InverterIcon className='w-4 h-4 text-indigo-600' />
              </div>
              Inverter {parseInt(viewMode) + 1} &mdash; Huawei SUN2000 {fmt(singleInvRatedKw, 0)} kW Detailed Telemetry
            </h3>
            <div className='grid grid-cols-2 md:grid-cols-4 gap-4'>
              {[
                { label: 'Rated Capacity', value: `${fmt(singleInvRatedKw, 2)} kW`, color: 'text-slate-800' },
                { label: 'DC Solar Input', value: `${toKW(currentInv.pv_w)} kW`, color: 'text-amber-600' },
                { label: 'AC Grid Output', value: `${toKW(currentInv.ac_w)} kW`, color: 'text-oes-blue' },
                { label: 'Active Power', value: `${toKW(currentInv.ac_w)} kW`, color: 'text-oes-blue' },
                { label: 'Today Generation', value: `${fmt(currentInv.e_day, 1)} kWh`, color: 'text-emerald-600' },
                { label: 'Lifetime Generation', value: `${fmt(currentInv.e_tot, 1)} kWh`, color: 'text-slate-700' },
                { label: 'Inverter Temp', value: `${fmt(currentInv.temp, 1)} °C`, color: 'text-amber-500' },
                { label: 'Grid Frequency', value: `${fmt(currentInv.freq, 2)} Hz`, color: 'text-indigo-600' },
                { label: 'PV DC Voltage', value: `${fmt(currentInv.pv_v, 1)} V`, color: 'text-slate-800' },
                { label: 'PV DC Current', value: `${fmt(currentInv.pv_a, 2)} A`, color: 'text-slate-800' },
                { label: 'AC Voltage', value: `${fmt(currentInv.ac_v, 1)} V`, color: 'text-slate-800' },
                { label: 'AC Current', value: `${fmt(currentInv.ac_a, 2)} A`, color: 'text-slate-800' },
              ].map((item, i) => (
                <div key={i} className='bg-slate-50 rounded-xl p-3.5 border border-slate-100'>
                  <div className='text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1'>{item.label}</div>
                  <div className={`text-base font-black ${item.color}`}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 7. MPPT & STRING CONTRIBUTION (Power in kW) */}
        {allStrings.length > 0 && (
          <div className='bg-white rounded-2xl p-6 md:p-8 border border-slate-100 shadow-sm space-y-6 mx-2 md:mx-0'>
            <h3 className='text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2'>
              <div className='bg-purple-100 p-1.5 rounded-lg'>
                <MPPTIcon className='w-4 h-4 text-purple-600' />
              </div>
              MPPT / String Distribution (Individual Strings)
            </h3>

            <div className='flex flex-col md:flex-row items-center gap-8 md:gap-12'>
              <div style={{ width: 220, height: 220 }}>
                <ResponsiveContainer width='100%' height='100%'>
                  <PieChart>
                    <Pie
                      data={allStrings}
                      innerRadius={65}
                      outerRadius={90}
                      paddingAngle={4}
                      dataKey='value'
                      stroke='none'
                    >
                      {allStrings.map((_, index) => (
                        <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(val) => [`${toKW(val)} kW`, 'String Power']}
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className='flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3 w-full'>
                {allStrings.map((str, idx) => (
                  <div key={idx} className='bg-slate-50 p-4 rounded-2xl border border-slate-100 flex items-center justify-between'>
                    <div className='flex items-center gap-3'>
                      <div className='w-3 h-3 rounded-full flex-shrink-0' style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }} />
                      <span className='font-bold text-slate-700 text-sm'>{str.name}</span>
                    </div>
                    <div className='text-right'>
                      <div className='font-black text-slate-800'>{toKW(str.value)} <span className='text-xs font-semibold text-slate-400'>kW</span></div>
                      <div className='text-xs font-medium text-slate-400'>{fmt(str.voltage, 1)}V &bull; {fmt(str.current, 2)}A</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

      </div>

      {/* EDIT SITE MODAL — With Controlled Numeric Capacity Input */}
      {showEditModal && (
        <div className='fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4'>
          <div className='bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl border border-slate-100 space-y-6'>
            <div className='flex justify-between items-center'>
              <h3 className='text-xl font-bold text-slate-800 flex items-center gap-2'>
                <Edit className='w-5 h-5 text-oes-blue' /> Edit Site Details
              </h3>
              <button onClick={() => setShowEditModal(false)} className='text-slate-400 hover:text-slate-600 bg-slate-50 p-2 rounded-full'>
                <X className='w-5 h-5' />
              </button>
            </div>

            <div className='space-y-4 font-semibold'>
              <div>
                <label className='block text-sm text-slate-500 mb-1'>Client Name *</label>
                <input 
                  type='text' 
                  className='w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-800 outline-none focus:border-oes-blue focus:ring-2 focus:ring-oes-blue/20 transition-all'
                  value={editForm.client_name || ''}
                  onChange={e => setEditForm({ ...editForm, client_name: e.target.value })}
                />
              </div>

              <div>
                <label className='block text-sm text-slate-500 mb-1'>Site Name</label>
                <input 
                  type='text' 
                  className='w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-800 outline-none focus:border-oes-blue focus:ring-2 focus:ring-oes-blue/20 transition-all'
                  value={editForm.site_name || ''}
                  onChange={e => setEditForm({ ...editForm, site_name: e.target.value })}
                />
              </div>

              <div className='grid grid-cols-2 gap-4'>
                <div>
                  <label className='block text-sm text-slate-500 mb-1'>Location</label>
                  <input 
                    type='text' 
                    className='w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-800 outline-none focus:border-oes-blue focus:ring-2 focus:ring-oes-blue/20 transition-all'
                    value={editForm.location || ''}
                    onChange={e => setEditForm({ ...editForm, location: e.target.value })}
                  />
                </div>
                <div>
                  <label className='block text-sm text-slate-500 mb-1'>Rated Capacity (kW)</label>
                  {/* Fixed Controlled Input: Supports full clearing, selecting all, decimals */}
                  <input 
                    type='text' 
                    inputMode='decimal'
                    className='w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-800 outline-none focus:border-oes-blue focus:ring-2 focus:ring-oes-blue/20 transition-all'
                    value={capacityRaw}
                    onChange={e => {
                      const val = e.target.value;
                      if (val === '' || /^\d*\.?\d*$/.test(val)) {
                        setCapacityRaw(val);
                      }
                    }}
                    onBlur={() => {
                      const num = parseFloat(capacityRaw);
                      if (!isNaN(num) && num > 0) {
                        setCapacityRaw(num.toFixed(2));
                      } else {
                        setCapacityRaw('80.00');
                      }
                    }}
                    placeholder='e.g. 80.00'
                  />
                </div>
              </div>

              <div>
                <label className='block text-sm text-slate-500 mb-1'>Inverter Model</label>
                <input 
                  type='text' 
                  className='w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-800 outline-none focus:border-oes-blue focus:ring-2 focus:ring-oes-blue/20 transition-all'
                  value={editForm.inverter_model || ''}
                  onChange={e => setEditForm({ ...editForm, inverter_model: e.target.value })}
                />
              </div>
            </div>

            <div className='flex gap-3 pt-2'>
              <button 
                onClick={() => setShowEditModal(false)}
                className='flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 py-4 rounded-2xl text-sm font-bold transition-colors'
              >
                Cancel
              </button>
              <button 
                onClick={handleSaveSiteDetails}
                className='flex-1 bg-oes-blue hover:bg-slate-800 text-white py-4 rounded-2xl text-sm font-bold shadow-lg shadow-oes-blue/20 transition-all transform active:scale-95'
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
