import React, { useState } from 'react';
import { HashRouter as Router, Routes, Route, Link } from 'react-router-dom';
import { Sun, Activity, ShieldCheck, Layers, HelpCircle, Settings, X } from 'lucide-react';
import FleetView from './pages/FleetView';
import DeviceDashboard from './pages/DeviceDashboard';
import './index.css';

function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [mqttHost, setMqttHost] = useState(localStorage.getItem('oes_mqtt_host') || 'wss://broker.emqx.io:8084/mqtt');
  const [mqttPrefix, setMqttPrefix] = useState(localStorage.getItem('oes_mqtt_prefix') || 'oes');

  const handleSaveSettings = () => {
    localStorage.setItem('oes_mqtt_host', mqttHost);
    localStorage.setItem('oes_mqtt_prefix', mqttPrefix);
    setShowSettings(false);
    window.location.reload(); // Reload to reconnect MQTT
  };

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
            <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-fade-in-up">
              <div className="flex justify-between items-center p-5 border-b border-slate-100">
                <div className="font-bold text-lg text-slate-800">Dashboard Settings</div>
                <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-slate-600">
                  <X size={20} />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">MQTT Broker URL (WebSocket)</label>
                  <input 
                    type="text" 
                    value={mqttHost}
                    onChange={(e) => setMqttHost(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-oes-blue/20 focus:border-oes-blue transition-all"
                    placeholder="wss://broker.emqx.io:8084/mqtt"
                  />
                  <p className="text-[10px] text-slate-400">Must be a WebSocket (wss://) URL if running in browser.</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">MQTT Topic Prefix</label>
                  <input 
                    type="text" 
                    value={mqttPrefix}
                    onChange={(e) => setMqttPrefix(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-oes-blue/20 focus:border-oes-blue transition-all"
                    placeholder="oes"
                  />
                </div>
              </div>
              <div className="p-5 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                <button 
                  onClick={() => setShowSettings(false)}
                  className="px-5 py-2.5 text-sm font-semibold text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleSaveSettings}
                  className="px-5 py-2.5 text-sm font-bold text-white bg-oes-blue rounded-xl hover:bg-[#00284A] transition-colors shadow-sm"
                >
                  Save & Reload
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
