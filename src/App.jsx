import React, { useState } from 'react';
import { HashRouter as Router, Routes, Route, Link } from 'react-router-dom';
import { Sun, Activity, ShieldCheck, Layers, HelpCircle, Settings, X, Cloud, HardDrive, CheckCircle2, Trash2 } from 'lucide-react';
import FleetView from './pages/FleetView';
import DeviceDashboard from './pages/DeviceDashboard';
import { isFirebaseConfigured, getFirebaseConfig, saveFirebaseConfig, resetAllFleetData, DEFAULT_FIREBASE_CONFIG } from './utils/storage';
import './index.css';

// Helper to parse both pure JSON and Firebase JS snippet (const firebaseConfig = { ... })
function parseFirebaseInput(raw) {
  if (!raw || !raw.trim()) return null;
  // 1. Try direct JSON.parse
  try {
    return JSON.parse(raw);
  } catch (e) {}

  // 2. Extract object {...}
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    const objectStr = match[0];
    try {
      return JSON.parse(objectStr);
    } catch (e) {}

    // 3. Extract key-value pairs via regex (handles unquoted JS keys and comments)
    const config = {};
    const keys = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId', 'measurementId'];
    keys.forEach(k => {
      const reg = new RegExp(`['"]?${k}['"]?\\s*:\\s*['"]([^'"]+)['"]`, 'i');
      const m = objectStr.match(reg);
      if (m && m[1]) {
        config[k] = m[1];
      }
    });

    if (config.apiKey && config.projectId) {
      return config;
    }
  }
  return null;
}

function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [mqttHost, setMqttHost] = useState(localStorage.getItem('oes_mqtt_host') || 'wss://broker.emqx.io:8084/mqtt');
  const [mqttPrefix, setMqttPrefix] = useState(localStorage.getItem('oes_mqtt_prefix') || 'oes');

  // Firebase Config State
  const [firebaseConfigStr, setFirebaseConfigStr] = useState(() => {
    const cfg = getFirebaseConfig();
    return cfg ? JSON.stringify(cfg, null, 2) : '';
  });

  const handleSaveSettings = () => {
    localStorage.setItem('oes_mqtt_host', mqttHost);
    localStorage.setItem('oes_mqtt_prefix', mqttPrefix);

    if (firebaseConfigStr.trim()) {
      const parsed = parseFirebaseInput(firebaseConfigStr);
      if (!parsed || !parsed.apiKey || !parsed.projectId) {
        alert('Could not find apiKey or projectId in your Firebase configuration. Please check the snippet.');
        return;
      }
      saveFirebaseConfig(parsed);
    } else {
      saveFirebaseConfig(null);
    }

    setShowSettings(false);
    window.location.reload();
  };

  const isCloudActive = isFirebaseConfigured();

  return (
    <Router>
      <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans">
        
        {/* TOP BRANDING NAVBAR */}
        <header className="bg-oes-blue text-white shadow-md sticky top-0 z-50">
          <div className="max-w-6xl mx-auto px-4 md:px-6 py-3.5 flex items-center justify-between">
            
            {/* Logo & Product Name */}
            <Link to="/" className="group flex-shrink-0">
              <div className="bg-white rounded-lg shadow-sm transition-transform group-hover:scale-[1.02] flex items-center px-3 md:px-4 py-1.5 md:h-12 h-10">
                <img src={`${import.meta.env.BASE_URL}logo.png`} alt="ONE EARTH Solar" className="h-5 md:h-7 w-auto object-contain" />
                
                {/* Vertical Divider */}
                <div className="bg-slate-200 w-[1px] h-4 md:h-6 mx-2 md:mx-3"></div>
                
                {/* Product Name */}
                <div className="text-slate-900 font-extrabold text-[0.65rem] md:text-sm tracking-wide uppercase">
                  Data Logger
                </div>
              </div>
            </Link>

            {/* Navigation & System Status */}
            <div className="flex items-center gap-4">
              <div className="hidden md:flex items-center gap-2 bg-white/10 px-3 py-1.5 rounded-xl text-xs font-semibold border border-white/10">
                <span className="w-2 h-2 rounded-full bg-oes-green animate-pulse"></span>
                <span>MQTT Real-time Ingestion</span>
              </div>

              {isCloudActive ? (
                <div className="flex items-center gap-1.5 bg-amber-400/20 text-amber-200 px-2.5 py-1 md:px-3 md:py-1.5 rounded-xl text-xs font-bold border border-amber-400/30">
                  <Cloud className="w-3.5 h-3.5 text-amber-300" />
                  <span className="hidden sm:inline">Cloud Synced</span>
                  <span className="sm:hidden">Cloud</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 bg-white/10 text-white/80 px-2.5 py-1 md:px-3 md:py-1.5 rounded-xl text-xs font-bold border border-white/10">
                  <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="hidden sm:inline">Local Store</span>
                  <span className="sm:hidden">Local</span>
                </div>
              )}
              
              <Link 
                to="/" 
                className="text-xs font-bold bg-oes-green text-slate-900 px-3.5 py-2 rounded-xl shadow-sm hover:bg-[#b8cc10] transition-colors"
              >
                Fleet Overview
              </Link>
              
              <button 
                onClick={() => setShowSettings(true)}
                className="p-2 bg-white/10 rounded-xl hover:bg-white/20 transition-colors"
                title="Global Settings"
              >
                <Settings size={18} />
              </button>
            </div>
          </div>
        </header>

        {/* Global Settings Modal */}
        {showSettings && (
          <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden animate-fade-in-up border border-slate-100 max-h-[90vh] flex flex-col">
              <div className="flex justify-between items-center p-5 border-b border-slate-100">
                <div className="font-bold text-lg text-slate-800 flex items-center gap-2">
                  <Settings className="w-5 h-5 text-oes-blue" /> Dashboard Settings
                </div>
                <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-slate-600 bg-slate-50 p-2 rounded-full">
                  <X size={18} />
                </button>
              </div>

              <div className="p-5 space-y-5 overflow-y-auto flex-1 text-xs">
                
                {/* 1. MQTT Section */}
                <div className="space-y-3">
                  <h4 className="font-bold text-slate-700 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                    <Activity className="w-4 h-4 text-oes-blue" /> Live MQTT Stream
                  </h4>
                  <div className="space-y-1.5">
                    <label className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">MQTT Broker URL (WebSocket)</label>
                    <input 
                      type="text" 
                      value={mqttHost}
                      onChange={(e) => setMqttHost(e.target.value)}
                      className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-oes-blue font-mono"
                      placeholder="wss://broker.emqx.io:8084/mqtt"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">MQTT Topic Prefix</label>
                    <input 
                      type="text" 
                      value={mqttPrefix}
                      onChange={(e) => setMqttPrefix(e.target.value)}
                      className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-oes-blue font-mono"
                      placeholder="oes"
                    />
                  </div>
                </div>

                {/* 2. Firebase Cloud Database Section */}
                <div className="space-y-3 pt-3 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-slate-700 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                      <Cloud className="w-4 h-4 text-amber-500" /> Firebase Cloud Storage (Firestore)
                    </h4>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${isCloudActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}`}>
                      {isCloudActive ? 'Cloud Connected 24/7' : 'Local Only'}
                    </span>
                  </div>
                  
                  <p className="text-slate-500 text-[11px] leading-relaxed">
                    Centrally stores 10-day daily peaks and registered devices across all mobile phones, PCs, and tablets 24/7.
                  </p>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">Firebase Config (JSON snippet)</label>
                      <button
                        type="button"
                        onClick={() => setFirebaseConfigStr(JSON.stringify(DEFAULT_FIREBASE_CONFIG, null, 2))}
                        className="text-[10px] text-oes-blue font-bold hover:underline"
                      >
                        Reset to Project Default
                      </button>
                    </div>
                    <textarea 
                      rows={6}
                      value={firebaseConfigStr}
                      onChange={(e) => setFirebaseConfigStr(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[11px] font-mono focus:outline-none focus:border-oes-blue leading-tight"
                      placeholder={`{\n  "apiKey": "AIzaSy...",\n  "authDomain": "your-project.firebaseapp.com",\n  "projectId": "your-project-id"\n}`}
                    />
                    <p className="text-[10px] text-emerald-600 font-semibold flex items-center gap-1">
                      <CheckCircle2 size={12} /> Pre-configured with OES Solar Cloud project
                    </p>
                  </div>
                </div>

                {/* 3. Fresh Start / Reset Fleet */}
                <div className="space-y-3 pt-3 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-rose-600 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                      <Trash2 className="w-4 h-4 text-rose-500" /> Fresh Start / Reset Devices
                    </h4>
                  </div>
                  <p className="text-slate-500 text-[11px] leading-relaxed">
                    Wipe all currently registered data loggers and start freshly with zero devices. (Retains your MQTT & Firebase credentials).
                  </p>
                  <button 
                    type="button"
                    onClick={() => {
                      if (window.confirm('Are you sure you want to remove all data loggers and start completely fresh? This cannot be undone.')) {
                        resetAllFleetData();
                        setShowSettings(false);
                        window.location.reload();
                      }
                    }}
                    className="px-4 py-2 bg-rose-50 text-rose-700 border border-rose-200 rounded-xl font-bold text-xs hover:bg-rose-100 transition-colors flex items-center gap-2"
                  >
                    <Trash2 size={14} /> Clear All Devices & Fresh Start
                  </button>
                </div>

              </div>

              <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2.5">
                <button 
                  onClick={() => setShowSettings(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleSaveSettings}
                  className="px-5 py-2 text-xs font-bold text-white bg-oes-blue rounded-xl hover:bg-[#00284A] transition-colors shadow-sm"
                >
                  Save & Apply
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* MAIN CONTENT AREA */}
        <main className="max-w-6xl w-full mx-auto px-4 md:px-6 py-6 flex-1">
          <Routes>
            <Route path="/" element={<FleetView />} />
            <Route path="/device/:serial" element={<DeviceDashboard />} />
          </Routes>
        </main>

        {/* FOOTER */}
        <footer className="bg-white border-t border-slate-200 py-6 mt-12 text-xs text-slate-400">
          <div className="max-w-6xl mx-auto px-4 md:px-6 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-600">ONE EARTH Solar</span>
              <span>•</span>
              <span>Commercial & Industrial Solar Data Logger Platform</span>
            </div>
            <div>
              Firmware v3.0.0 • Multi-Inverter & Custom Modbus Architecture
            </div>
          </div>
        </footer>

      </div>
    </Router>
  );
}

export default App;
