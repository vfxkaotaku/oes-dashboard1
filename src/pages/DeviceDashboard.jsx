import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, Download, Sun, Zap, Layers, Activity, 
  MapPin, Clock, Edit, CheckCircle2, AlertTriangle, ShieldCheck, 
  Calendar, TrendingUp, BarChart3, Database, RefreshCw, X, ShieldAlert, Cpu
} from 'lucide-react';
import mqtt from 'mqtt';
import { 
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell 
} from 'recharts';
import { getDeviceBySerial, upsertDevice, recordDeviceTelemetry, getHistoricalAnalytics } from '../utils/storage';
import { generateSolarPdfReport } from '../utils/pdfGenerator';

export default function DeviceDashboard() {
  const { serial } = useParams();
  const navigate = useNavigate();

  const [device, setDevice] = useState(() => getDeviceBySerial(serial));
  const [liveData, setLiveData] = useState(null);
  const [lastSeen, setLastSeen] = useState(Date.now());
  const [isOnline, setIsOnline] = useState(true);
  const [viewMode, setViewMode] = useState('combined'); // 'combined' | '0' | '1' ...
  
  // Historical Analytics Tab
  const [historyPeriod, setHistoryPeriod] = useState('today'); // 'today' | 'yesterday' | '7days' | '30days'
  const [historicalData, setHistoricalData] = useState([]);

  // Edit Site Modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState({ ...device });

  // 1. MQTT Connection & Live Streaming
  useEffect(() => {
    setDevice(getDeviceBySerial(serial));
    setHistoricalData(getHistoricalAnalytics(serial, historyPeriod, device.capacity_kw || 50));

    const client = mqtt.connect('wss://broker.emqx.io:8084/mqtt');

    client.on('connect', () => {
      console.log(`DeviceDashboard: Subscribing to telemetry for ${serial}`);
      client.subscribe(`oes/logger/${serial}/telemetry`);
      client.subscribe(`oes/logger/${serial}/status`);
      client.subscribe(`oes/logger/${serial}/heartbeat`);
      // Legacy topics
      client.subscribe(`oes/${serial}/live`);
      client.subscribe(`oes/${serial}/status`);
    });

    client.on('message', (topic, message) => {
      try {
        const parts = topic.split('/');
        let msgSerial = '';
        let type = '';

        if (parts[0] === 'oes' && parts[1] === 'logger') {
          msgSerial = parts[2];
          type = parts[3];
        } else if (parts[0] === 'oes') {
          msgSerial = parts[1];
          type = parts[2];
        }

        if (msgSerial !== serial) return;
        const data = JSON.parse(message.toString());
        const now = Date.now();

        setLastSeen(now);
        setIsOnline(true);

        if (type === 'telemetry' || type === 'live') {
          setLiveData(data);
          recordDeviceTelemetry(serial, data);
        } else if (type === 'status') {
          setIsOnline(data.online === true || data.online === 1);
        }
      } catch (e) {
        // Ignore parse error
      }
    });

    // Offline timer: if no packet for 40 seconds, mark offline
    const timer = setInterval(() => {
      if (Date.now() - lastSeen > 40000) {
        setIsOnline(false);
      }
    }, 5000);

    return () => {
      client.end();
      clearInterval(timer);
    };
  }, [serial]);

  // Update history whenever period changes
  useEffect(() => {
    setHistoricalData(getHistoricalAnalytics(serial, historyPeriod, device.capacity_kw || 50));
  }, [historyPeriod, serial, device.capacity_kw]);

  const handleSaveSiteDetails = () => {
    const updated = upsertDevice(editForm);
    setDevice(getDeviceBySerial(serial));
    setShowEditModal(false);
  };

  const handleDownloadPdf = () => {
    generateSolarPdfReport({
      device,
      liveData,
      historicalData,
      selectedPeriod: historyPeriod
    });
  };

  // Safe fallback if liveData is null initially
  const displayData = liveData || {
    status: 0,
    pv_v: 0,
    pv_a: 0,
    pv_w: 0,
    ac_v: 0,
    ac_a: 0,
    ac_w: 0,
    freq: 0,
    e_day: 0,
    e_tot: 0,
    temp: 0
  };

  const isMulti = Array.isArray(displayData) || (displayData.inv && Array.isArray(displayData.inv));
  const inverters = Array.isArray(displayData) ? displayData : (displayData.inv ? displayData.inv : [displayData]);
  const isCombined = viewMode === 'combined';
  const currentInv = isCombined ? inverters[0] : inverters[parseInt(viewMode)] || inverters[0];

  const ac_w = isCombined ? inverters.reduce((s, i) => s + (parseFloat(i.ac_w) || 0), 0) : (parseFloat(currentInv.ac_w) || 0);
  const pv_w = isCombined ? inverters.reduce((s, i) => s + (parseFloat(i.pv_w) || 0), 0) : (parseFloat(currentInv.pv_w) || 0);
  const e_day = isCombined ? inverters.reduce((s, i) => s + (parseFloat(i.e_day) || 0), 0) : (parseFloat(currentInv.e_day) || 0);
  const e_tot = isCombined ? inverters.reduce((s, i) => s + (parseFloat(i.e_tot) || 0), 0) : (parseFloat(currentInv.e_tot) || 0);

  const powerKW = (ac_w / 1000).toFixed(2);

  // MPPT Strings
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

  // Default demo strings if none configured in data
  if (allStrings.length === 0) {
    // Show empty data if no real data is available
  }

  const PIE_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#14B8A6', '#F43F5E', '#6366F1'];

  // Status computation
  const statusLabel = currentInv.status === 2 ? 'Generating' : currentInv.status === 3 ? 'Fault' : 'Standby';
  const statusColor = currentInv.status === 2 ? 'bg-oes-green text-white' : currentInv.status === 3 ? 'bg-red-500 text-white' : 'bg-oes-blue text-white';

  const timeDiffSec = Math.floor((Date.now() - lastSeen) / 1000);
  const heartbeatText = isOnline 
    ? (timeDiffSec < 5 ? 'Just now' : `${timeDiffSec}s ago`) 
    : 'Offline';

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 text-slate-800 pb-20">
      
      {/* 1. TOP NAV & CONTROLS (App Aesthetic) */}
      <div className="bg-oes-blue text-white pt-10 pb-8 px-6 md:px-12 shadow-md rounded-b-3xl relative">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <button 
              onClick={() => navigate('/')} 
              className="flex items-center gap-2 text-white/80 hover:text-white mb-4 transition-colors font-medium text-sm"
            >
              <ArrowLeft className="w-4 h-4" /> Back to Fleet Overview
            </button>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="w-6 h-6" /> {device.client_name || 'Solar Site'}
            </h1>
            <p className="text-white/80 mt-1 text-sm">
              {device.serial_number} • {device.site_name}
            </p>
          </div>
          
          <div className="flex items-center gap-3 w-full md:w-auto">
            <button 
              onClick={() => { setEditForm({ ...device }); setShowEditModal(true); }}
              className="flex-1 md:flex-none flex items-center justify-center gap-2 p-3 bg-white/10 hover:bg-white/20 rounded-xl transition-colors text-white font-semibold text-sm"
            >
              <Edit className="w-4 h-4" /> Edit Site
            </button>
            <button 
              onClick={handleDownloadPdf}
              className="flex-1 md:flex-none flex items-center justify-center gap-2 px-5 py-3 bg-white text-oes-blue hover:bg-slate-100 rounded-xl transition-colors font-bold text-sm shadow-md"
            >
              <Download className="w-4 h-4" /> Generate PDF
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto w-full px-4 md:px-8 py-6 flex flex-col gap-6 -mt-4">
        
        {/* MULTI-INVERTER TABS */}
        {isMulti && (
          <div className="bg-white p-2 rounded-xl shadow-sm border border-slate-100 flex gap-2 overflow-x-auto mx-2 md:mx-0">
            <button 
              onClick={() => setViewMode('combined')}
              className={`px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-colors ${isCombined ? 'bg-oes-blue text-white' : 'text-slate-500 hover:bg-slate-50'}`}
            >
              Combined Plant
            </button>
            {inverters.map((inv, idx) => (
              <button 
                key={idx} 
                onClick={() => setViewMode(idx.toString())}
                className={`px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-colors ${viewMode === idx.toString() ? 'bg-oes-blue text-white' : 'text-slate-500 hover:bg-slate-50'}`}
              >
                Inverter {idx + 1}
              </button>
            ))}
          </div>
        )}

        {/* HERO SOLAR GENERATION CARD (App Aesthetic) */}
        <div className="bg-white rounded-3xl p-6 md:p-8 shadow-sm border border-slate-100 relative overflow-hidden mx-2 md:mx-0">
          <div className="absolute top-0 right-0 w-32 h-32 md:w-48 md:h-48 bg-oes-green/10 rounded-bl-full -mr-10 -mt-10"></div>
          
          <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider ${statusColor}`}>
                  {statusLabel}
                </span>
                <span className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider ${isOnline ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}`}>
                  {isOnline ? 'ONLINE' : 'OFFLINE'}
                </span>
              </div>
              
              <div className="text-sm font-bold text-slate-400 uppercase tracking-widest mt-4">
                {isCombined ? 'Total Active Output' : `Current Output`}
              </div>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-6xl font-black text-slate-800 tracking-tighter">{powerKW}</span>
                <span className="text-2xl font-bold text-slate-500">kW</span>
              </div>
            </div>

            <div className="text-right">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">Performance Ratio</div>
              <div className="text-xl font-bold text-slate-700 mt-1">
                {((parseFloat(powerKW) / (device.capacity_kw || 50)) * 100).toFixed(1)}%
              </div>
              <div className="text-xs text-slate-400 mt-1">Rated: {device.capacity_kw} kWp</div>
            </div>
          </div>
        </div>

        {/* 4. CORE KPI METRICS (App Aesthetic) */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mx-2 md:mx-0">
          <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
            <div className="text-oes-green mb-3"><Zap className="w-6 h-6" /></div>
            <div className="text-2xl md:text-3xl font-black text-slate-800">{e_day.toFixed(1)}</div>
            <div className="text-xs font-bold text-slate-400 mt-1 uppercase tracking-wider">Today (kWh)</div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
            <div className="text-oes-blue mb-3"><Activity className="w-6 h-6" /></div>
            <div className="text-2xl md:text-3xl font-black text-slate-800">{(e_tot / 1000).toFixed(1)}</div>
            <div className="text-xs font-bold text-slate-400 mt-1 uppercase tracking-wider">Life (MWh)</div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
            <div className="text-red-400 mb-3"><Cpu className="w-6 h-6" /></div>
            <div className="text-2xl md:text-3xl font-black text-slate-800">{(parseFloat(currentInv.temp) || 0).toFixed(1)}</div>
            <div className="text-xs font-bold text-slate-400 mt-1 uppercase tracking-wider">Temp (°C)</div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
            <div className="text-slate-400 mb-3"><ShieldAlert className="w-6 h-6" /></div>
            <div className="text-2xl md:text-3xl font-black text-slate-800">{(parseFloat(currentInv.freq) || 0).toFixed(2)}</div>
            <div className="text-xs font-bold text-slate-400 mt-1 uppercase tracking-wider">Freq (Hz)</div>
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
                <span className="font-bold text-amber-500 text-lg">{(pv_w || 0).toFixed(0)} W</span>
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

        {/* 6. MPPT & STRING CONTRIBUTION (Web specific, restyled) */}
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
                    <Tooltip formatter={(val) => `${val.toFixed(0)} W`} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
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
                      <div className="font-black text-slate-800 text-lg">{str.value.toFixed(0)} W</div>
                      <div className="text-xs font-medium text-slate-500">{str.voltage?.toFixed(1)}V • {str.current?.toFixed(2)}A</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 7. HISTORICAL DATA ANALYTICS (App Aesthetic + Features) */}
        <div className="bg-white rounded-2xl p-6 md:p-8 border border-slate-100 shadow-sm mx-2 md:mx-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-oes-blue" /> Output Trend
              </h3>
              <p className="text-sm text-slate-500 mt-1 font-medium">Historical power output and energy statistics</p>
            </div>

            <div className="flex bg-slate-50 p-1 rounded-xl text-sm font-bold border border-slate-100 overflow-x-auto w-full sm:w-auto">
              <button 
                onClick={() => setHistoryPeriod('today')}
                className={`flex-1 px-4 py-2 rounded-lg transition-colors whitespace-nowrap ${historyPeriod === 'today' ? 'bg-white text-oes-blue shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
              >
                Today
              </button>
              <button 
                onClick={() => setHistoryPeriod('yesterday')}
                className={`flex-1 px-4 py-2 rounded-lg transition-colors whitespace-nowrap ${historyPeriod === 'yesterday' ? 'bg-white text-oes-blue shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
              >
                Yesterday
              </button>
              <button 
                onClick={() => setHistoryPeriod('7days')}
                className={`flex-1 px-4 py-2 rounded-lg transition-colors whitespace-nowrap ${historyPeriod === '7days' ? 'bg-white text-oes-blue shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
              >
                7 Days
              </button>
              <button 
                onClick={() => setHistoryPeriod('30days')}
                className={`flex-1 px-4 py-2 rounded-lg transition-colors whitespace-nowrap ${historyPeriod === '30days' ? 'bg-white text-oes-blue shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
              >
                30 Days
              </button>
            </div>
          </div>

          {/* Chart View */}
          <div className="w-full" style={{ height: 350 }}>
            <ResponsiveContainer width="100%" height="100%">
              {historyPeriod === '7days' || historyPeriod === '30days' ? (
                <BarChart data={historicalData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <XAxis dataKey="time" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} dy={10} />
                  <YAxis tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} dx={-10} unit=" kWh" />
                  <Tooltip 
                    cursor={{ fill: '#f8fafc' }}
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    formatter={(val) => [`${val} kWh`, 'Energy']} 
                  />
                  <Bar dataKey="energy" fill="#3B82F6" radius={[6, 6, 0, 0]} />
                </BarChart>
              ) : (
                <AreaChart data={historicalData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorPower" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="time" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} dy={10} />
                  <YAxis tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} dx={-10} unit=" kW" />
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    formatter={(val) => [`${val} kW`, 'Power Output']} 
                  />
                  <Area type="monotone" dataKey="power" stroke="#3B82F6" strokeWidth={3} fillOpacity={1} fill="url(#colorPower)" isAnimationActive={false} />
                </AreaChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>

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
                    onChange={e => setFormState({ ...editForm, location: e.target.value })}
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
