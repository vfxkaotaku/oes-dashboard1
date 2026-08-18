import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Activity, Plus, Search, Sun, Zap, BatteryCharging, Server, 
  MapPin, Edit, Trash2, ArrowUpRight, CheckCircle2, AlertCircle, RefreshCw, X
} from 'lucide-react';
import mqtt from 'mqtt';
import { getDevices, saveDevices, upsertDevice, deleteDevice, recordDeviceTelemetry } from '../utils/storage';

export default function FleetView() {
  const navigate = useNavigate();
  const [devices, setDevices] = useState([]);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all'); // 'all' | 'online' | 'offline'
  const [liveData, setLiveData] = useState({});
  const [lastSeenMap, setLastSeenMap] = useState({});
  const [mqttDebugLogs, setMqttDebugLogs] = useState([]);
  
  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [currentEditDev, setCurrentEditDev] = useState(null);

  // Form State for Add / Edit
  const [formState, setFormState] = useState({
    serial_number: '',
    client_name: '',
    site_name: '',
    location: '',
    inverter_model: 'Polycab 50 kW',
    capacity_kw: 50
  });

  // Load devices on mount
  useEffect(() => {
    const loaded = getDevices();
    setDevices(loaded);

    // Initial last_seen map
    const initialSeen = {};
    loaded.forEach(d => {
      initialSeen[d.serial_number] = d.last_seen ? new Date(d.last_seen).getTime() : Date.now();
    });
    setLastSeenMap(initialSeen);

    // Connect to WebSocket MQTT Broker (EMQX - reliable WS support)
    const client = mqtt.connect('ws://broker.emqx.io:8083/mqtt');
    
    client.on('connect', () => {
      console.log('FleetView: Connected to MQTT Broker (EMQX)');
      client.subscribe('oes/#');
    });

    client.on('message', (topic, message) => {
      setMqttDebugLogs(prev => {
        const newLogs = [`${new Date().toISOString().substring(11, 19)} | ${topic}`, ...prev];
        return newLogs.slice(0, 5);
      });
      try {
        const parts = topic.split('/');
        let serial = '';
        let type = '';

        if (parts[0] === 'oes' && parts[1] === 'logger') {
          serial = parts[2];
          type = parts[3];
        } else if (parts[0] === 'oes') {
          serial = parts[1];
          type = parts[2];
        }

        if (!serial) return;
        const now = Date.now();
        setLastSeenMap(prev => ({ ...prev, [serial]: now }));
        
        let data;
        try {
          data = JSON.parse(message.toString());
        } catch (e) {
          // Add error log to UI
          setMqttDebugLogs(prev => {
            const newLogs = [`ERROR parsing JSON for ${topic}`, ...prev];
            return newLogs.slice(0, 5);
          });
          return;
        }

        if (type === 'telemetry' || type === 'live') {
          setLiveData(prev => ({ ...prev, [serial]: data }));
          recordDeviceTelemetry(serial, data);

          // Auto-register discovered logger if not present
          setDevices(prev => {
            if (!prev.find(d => d.serial_number === serial)) {
              const newDev = {
                serial_number: serial,
                client_name: data.plant || `Client ${serial}`,
                site_name: 'Solar Site',
                location: 'Maharashtra, India',
                inverter_model: data.inv ? `Multi-Inverter (${data.inv.length})` : 'Solar Inverter',
                capacity_kw: 50,
                status: 'online',
                last_seen: new Date().toISOString()
              };
              const updated = [newDev, ...prev];
              saveDevices(updated);
              return updated;
            }
            return prev.map(d => d.serial_number === serial ? { ...d, status: 'online', last_seen: new Date().toISOString() } : d);
          });

        } else if (type === 'status') {
          const isOnline = data.online === true || data.online === 1;
          setDevices(prev => prev.map(d => 
            d.serial_number === serial 
              ? { ...d, status: isOnline ? 'online' : 'offline', last_seen: new Date().toISOString() } 
              : d
          ));
        } else if (type === 'heartbeat') {
          setDevices(prev => prev.map(d => 
            d.serial_number === serial 
              ? { ...d, status: 'online', last_seen: new Date().toISOString() } 
              : d
          ));
        }
      } catch (e) {
        // Ignore parsing errors on malformed messages
      }
    });

    // Heartbeat check interval: Mark devices offline if no message received in 45s
    const statusInterval = setInterval(() => {
      const currentTime = Date.now();
      setDevices(prev => prev.map(d => {
        const last = lastSeenMap[d.serial_number] || (d.last_seen ? new Date(d.last_seen).getTime() : 0);
        if (d.status === 'online' && currentTime - last > 45000) {
          return { ...d, status: 'offline' };
        }
        return d;
      }));
    }, 5000);

    return () => {
      client.end();
      clearInterval(statusInterval);
    };
  }, []);

  const handleOpenAddModal = () => {
    setFormState({
      serial_number: `OES-DL-${String(devices.length + 1).padStart(4, '0')}`,
      client_name: '',
      site_name: '',
      location: '',
      inverter_model: 'Polycab 50 kW',
      capacity_kw: 50
    });
    setShowAddModal(true);
  };

  const handleSaveNewDevice = () => {
    if (!formState.serial_number || !formState.client_name) {
      alert('Please provide at least a Device ID and Client Name.');
      return;
    }
    if (devices.some(d => d.serial_number === formState.serial_number)) {
      alert('A logger with this Device ID already exists.');
      return;
    }
    const updated = upsertDevice(formState);
    setDevices(updated);
    setShowAddModal(false);
  };

  const handleOpenEditModal = (dev, e) => {
    e.stopPropagation();
    setCurrentEditDev(dev);
    setFormState({
      serial_number: dev.serial_number,
      client_name: dev.client_name || '',
      site_name: dev.site_name || '',
      location: dev.location || '',
      inverter_model: dev.inverter_model || 'Solar Inverter',
      capacity_kw: dev.capacity_kw || 50
    });
    setShowEditModal(true);
  };

  const handleSaveEditDevice = () => {
    if (!formState.client_name) return;
    const updated = upsertDevice(formState);
    setDevices(updated);
    setShowEditModal(false);
  };

  const handleDeleteDevice = (serial, e) => {
    e.stopPropagation();
    if (confirm(`Are you sure you want to remove Data Logger ${serial}?`)) {
      const updated = deleteDevice(serial);
      setDevices(updated);
    }
  };

  // Fleet Totals Calculations
  let totalFleetKw = 0;
  let totalFleetKwh = 0;
  let onlineCount = 0;

  devices.forEach(dev => {
    if (dev.status === 'online') onlineCount++;
    const live = liveData[dev.serial_number];
    if (live && live.inv) {
      totalFleetKw += live.inv.reduce((s, i) => s + (parseFloat(i.ac_w) || 0), 0) / 1000;
      totalFleetKwh += live.inv.reduce((s, i) => s + (parseFloat(i.e_day) || 0), 0);
    } else if (live) {
      totalFleetKw += (parseFloat(live.ac_w) || 0) / 1000;
      totalFleetKwh += parseFloat(live.e_day) || 0;
    }
  });

  const filtered = devices.filter(d => {
    const matchesSearch = 
      d.serial_number.toLowerCase().includes(search.toLowerCase()) ||
      (d.client_name && d.client_name.toLowerCase().includes(search.toLowerCase())) ||
      (d.site_name && d.site_name.toLowerCase().includes(search.toLowerCase())) ||
      (d.location && d.location.toLowerCase().includes(search.toLowerCase()));

    if (filterStatus === 'online') return matchesSearch && d.status === 'online';
    if (filterStatus === 'offline') return matchesSearch && d.status !== 'online';
    return matchesSearch;
  });

  const formatTimeAgo = (serial) => {
    const ts = lastSeenMap[serial];
    if (!ts) return 'Never';
    const sec = Math.floor((Date.now() - ts) / 1000);
    if (sec < 10) return 'Just now';
    if (sec < 60) return `${sec}s ago`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    return `${Math.floor(sec / 3600)}h ago`;
  };

  return (
    <div className="space-y-6">
      
      {/* 1. FLEET SUMMARY KPI BANNER */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm border-l-4 border-l-oes-green flex items-center justify-between">
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Fleet Power</div>
            <div className="text-2xl font-black text-slate-800 mt-1">{totalFleetKw.toFixed(1)} <span className="text-sm font-semibold text-slate-500">kW</span></div>
          </div>
          <div className="bg-oes-green/20 text-oes-blue p-3 rounded-xl">
            <Zap className="w-6 h-6 text-oes-blue" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm border-l-4 border-l-oes-blue flex items-center justify-between">
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Today's Generation</div>
            <div className="text-2xl font-black text-slate-800 mt-1">{totalFleetKwh.toFixed(1)} <span className="text-sm font-semibold text-slate-500">kWh</span></div>
          </div>
          <div className="bg-oes-blue/10 text-oes-blue p-3 rounded-xl">
            <Sun className="w-6 h-6 text-oes-blue" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm border-l-4 border-l-emerald-500 flex items-center justify-between">
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Active Loggers</div>
            <div className="text-2xl font-black text-slate-800 mt-1">{onlineCount} <span className="text-sm font-semibold text-slate-400">/ {devices.length}</span></div>
          </div>
          <div className="bg-emerald-50 text-emerald-600 p-3 rounded-xl">
            <Server className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm border-l-4 border-l-oes-orange flex items-center justify-between">
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Cloud Broker</div>
            <div className="text-sm font-semibold text-slate-800 mt-1">broker.emqx.io</div>
            <div className="text-[10px] text-emerald-600 font-bold flex items-center gap-1 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Connected
            </div>
          </div>
          <div className="bg-oes-orange/20 text-oes-orange p-3 rounded-xl">
            <Activity className="w-6 h-6 text-oes-orange" />
          </div>
        </div>
      </div>
      
      {/* 2. SEARCH & FILTER BAR */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search by Device ID, Client, Site or Location..." 
              className="pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:border-oes-blue w-full text-sm font-medium bg-slate-50"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {/* Status Filter Tabs */}
          <div className="flex bg-slate-100 p-1 rounded-xl text-xs font-bold">
            <button 
              onClick={() => setFilterStatus('all')}
              className={`px-3 py-1.5 rounded-lg transition-all ${filterStatus === 'all' ? 'bg-white text-oes-blue shadow-sm' : 'text-slate-500'}`}
            >
              All ({devices.length})
            </button>
            <button 
              onClick={() => setFilterStatus('online')}
              className={`px-3 py-1.5 rounded-lg transition-all ${filterStatus === 'online' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500'}`}
            >
              Online ({onlineCount})
            </button>
            <button 
              onClick={() => setFilterStatus('offline')}
              className={`px-3 py-1.5 rounded-lg transition-all ${filterStatus === 'offline' ? 'bg-white text-rose-700 shadow-sm' : 'text-slate-500'}`}
            >
              Offline ({devices.length - onlineCount})
            </button>
          </div>
        </div>

        <button 
          onClick={handleOpenAddModal}
          className="bg-oes-blue hover:bg-slate-800 text-white px-5 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-md shadow-oes-blue/20 transition-all transform active:scale-95"
        >
          <Plus className="w-4 h-4 text-oes-green" /> Add Data Logger
        </button>
      </div>

      {/* 3. MULTI-LOGGER DATA TABLE */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 text-xs uppercase tracking-wider">
                <th className="p-4 font-bold">Status</th>
                <th className="p-4 font-bold">Device ID</th>
                <th className="p-4 font-bold">Client & Site</th>
                <th className="p-4 font-bold">Inverter Model</th>
                <th className="p-4 font-bold text-right">Live Output</th>
                <th className="p-4 font-bold text-right">Today (kWh)</th>
                <th className="p-4 font-bold text-right">Heartbeat</th>
                <th className="p-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(dev => {
                const live = liveData[dev.serial_number];
                let liveKw = '--';
                let todayKwh = '--';
                
                if (live && live.inv) {
                  const totalKw = live.inv.reduce((s, i) => s + (parseFloat(i.ac_w) || 0), 0) / 1000;
                  liveKw = totalKw.toFixed(2);
                  const totalKwh = live.inv.reduce((s, i) => s + (parseFloat(i.e_day) || 0), 0);
                  todayKwh = totalKwh.toFixed(1);
                } else if (live) {
                  liveKw = ((parseFloat(live.ac_w) || 0) / 1000).toFixed(2);
                  todayKwh = (parseFloat(live.e_day) || 0).toFixed(1);
                }

                const isOnline = dev.status === 'online';

                return (
                  <tr 
                    key={dev.serial_number} 
                    className="hover:bg-slate-50/80 cursor-pointer transition-colors group"
                    onClick={() => navigate(`/device/${dev.serial_number}`)}
                  >
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <div className={`w-3 h-3 rounded-full ${isOnline ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50 animate-pulse' : 'bg-slate-300'}`}></div>
                        <span className={`text-xs font-bold capitalize ${isOnline ? 'text-emerald-700' : 'text-slate-400'}`}>
                          {isOnline ? 'Online' : 'Offline'}
                        </span>
                      </div>
                    </td>

                    <td className="p-4">
                      <span className="font-mono font-bold text-oes-blue text-sm">{dev.serial_number}</span>
                    </td>

                    <td className="p-4">
                      <div className="font-bold text-slate-800 text-sm">{dev.client_name || 'Solar Client'}</div>
                      <div className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                        <span>{dev.site_name || 'Main Plant'}</span>
                        <span>•</span>
                        <span className="flex items-center gap-0.5"><MapPin className="w-3 h-3" /> {dev.location || 'Maharashtra'}</span>
                      </div>
                    </td>

                    <td className="p-4">
                      <div className="text-xs font-semibold text-slate-700">{dev.inverter_model || 'Polycab 50 kW'}</div>
                      <div className="text-[11px] text-slate-400">{dev.capacity_kw || 50} kWp Rated</div>
                    </td>

                    <td className="p-4 text-right">
                      <div className="font-black text-base text-slate-800">
                        {liveKw !== '--' ? `${liveKw} kW` : '--'}
                      </div>
                    </td>

                    <td className="p-4 text-right">
                      <div className="font-bold text-sm text-oes-blue">
                        {todayKwh !== '--' ? `${todayKwh} kWh` : '--'}
                      </div>
                    </td>

                    <td className="p-4 text-right text-xs text-slate-400 font-medium">
                      {formatTimeAgo(dev.serial_number)}
                    </td>

                    <td className="p-4 text-center">
                      <div className="flex items-center justify-center gap-1" onClick={e => e.stopPropagation()}>
                        <button 
                          onClick={(e) => handleOpenEditModal(dev, e)}
                          title="Edit Site Metadata"
                          className="p-1.5 text-slate-400 hover:text-oes-blue hover:bg-slate-100 rounded-lg transition-colors"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={(e) => handleDeleteDevice(dev.serial_number, e)}
                          title="Remove Data Logger"
                          className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => navigate(`/device/${dev.serial_number}`)}
                          title="Open Live Dashboard"
                          className="p-1.5 text-oes-blue hover:bg-oes-blue/10 rounded-lg transition-colors"
                        >
                          <ArrowUpRight className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan="8" className="p-12 text-center text-slate-400">
                    <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm font-semibold">No data loggers match your filter.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ADD LOGGER MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl border border-slate-100 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <Plus className="w-5 h-5 text-oes-blue" /> Add Data Logger
              </h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs font-semibold">
              <div>
                <label className="block text-slate-600 mb-1">Device ID / Serial Number *</label>
                <input 
                  type="text" 
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 font-mono text-sm text-slate-800 outline-none focus:border-oes-blue"
                  value={formState.serial_number}
                  onChange={e => setFormState({ ...formState, serial_number: e.target.value })}
                  placeholder="e.g. OES-DL-0004"
                />
              </div>

              <div>
                <label className="block text-slate-600 mb-1">Client Name *</label>
                <input 
                  type="text" 
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-800 outline-none focus:border-oes-blue"
                  value={formState.client_name}
                  onChange={e => setFormState({ ...formState, client_name: e.target.value })}
                  placeholder="e.g. ABC Solar Enterprises"
                />
              </div>

              <div>
                <label className="block text-slate-600 mb-1">Site / Plant Name</label>
                <input 
                  type="text" 
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-800 outline-none focus:border-oes-blue"
                  value={formState.site_name}
                  onChange={e => setFormState({ ...formState, site_name: e.target.value })}
                  placeholder="e.g. Rooftop Array 1"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-600 mb-1">Location</label>
                  <input 
                    type="text" 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-800 outline-none focus:border-oes-blue"
                    value={formState.location}
                    onChange={e => setFormState({ ...formState, location: e.target.value })}
                    placeholder="e.g. Nashik, MH"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">Rated Capacity (kWp)</label>
                  <input 
                    type="number" 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-800 outline-none focus:border-oes-blue"
                    value={formState.capacity_kw}
                    onChange={e => setFormState({ ...formState, capacity_kw: parseFloat(e.target.value) || 50 })}
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-600 mb-1">Inverter Model</label>
                <input 
                  type="text" 
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-800 outline-none focus:border-oes-blue"
                  value={formState.inverter_model}
                  onChange={e => setFormState({ ...formState, inverter_model: e.target.value })}
                  placeholder="e.g. Polycab 50 kW / Huawei SUN2000"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button 
                onClick={() => setShowAddModal(false)}
                className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl text-xs font-bold"
              >
                Cancel
              </button>
              <button 
                onClick={handleSaveNewDevice}
                className="flex-1 bg-oes-blue hover:bg-slate-800 text-white py-3 rounded-xl text-xs font-bold shadow-md shadow-oes-blue/20"
              >
                Save Data Logger
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT LOGGER MODAL */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl border border-slate-100 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <Edit className="w-5 h-5 text-oes-blue" /> Edit Site Information
              </h3>
              <button onClick={() => setShowEditModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs font-semibold">
              <div>
                <label className="block text-slate-400 mb-1">Device ID (Read-only)</label>
                <input 
                  type="text" 
                  disabled
                  className="w-full bg-slate-100 border border-slate-200 rounded-xl px-3.5 py-2.5 font-mono text-sm text-slate-500 outline-none"
                  value={formState.serial_number}
                />
              </div>

              <div>
                <label className="block text-slate-600 mb-1">Client Name *</label>
                <input 
                  type="text" 
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-800 outline-none focus:border-oes-blue"
                  value={formState.client_name}
                  onChange={e => setFormState({ ...formState, client_name: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-slate-600 mb-1">Site / Plant Name</label>
                <input 
                  type="text" 
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-800 outline-none focus:border-oes-blue"
                  value={formState.site_name}
                  onChange={e => setFormState({ ...formState, site_name: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-600 mb-1">Location</label>
                  <input 
                    type="text" 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-800 outline-none focus:border-oes-blue"
                    value={formState.location}
                    onChange={e => setFormState({ ...formState, location: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">Rated Capacity (kWp)</label>
                  <input 
                    type="number" 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-800 outline-none focus:border-oes-blue"
                    value={formState.capacity_kw}
                    onChange={e => setFormState({ ...formState, capacity_kw: parseFloat(e.target.value) || 50 })}
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-600 mb-1">Inverter Model</label>
                <input 
                  type="text" 
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-800 outline-none focus:border-oes-blue"
                  value={formState.inverter_model}
                  onChange={e => setFormState({ ...formState, inverter_model: e.target.value })}
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button 
                onClick={() => setShowEditModal(false)}
                className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl text-xs font-bold"
              >
                Cancel
              </button>
              <button 
                onClick={handleSaveEditDevice}
                className="flex-1 bg-oes-blue hover:bg-slate-800 text-white py-3 rounded-xl text-xs font-bold shadow-md shadow-oes-blue/20"
              >
                Update Site Details
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
