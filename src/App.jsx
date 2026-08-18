import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import { Sun, Activity, ShieldCheck, Layers, HelpCircle } from 'lucide-react';
import FleetView from './pages/FleetView';
import DeviceDashboard from './pages/DeviceDashboard';
import './index.css';

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans">
        
        {/* TOP BRANDING NAVBAR */}
        <header className="bg-oes-blue text-white shadow-md sticky top-0 z-50">
          <div className="max-w-6xl mx-auto px-4 md:px-6 py-3.5 flex items-center justify-between">
            
            {/* Logo & Product Name */}
            <Link to="/" className="group">
              <div className="bg-white rounded-xl shadow-sm transition-transform group-hover:scale-105 flex items-center" style={{ padding: '6px 16px', height: '48px' }}>
                <img src="/logo.png" alt="ONE EARTH Solar" style={{ height: '28px', width: 'auto', objectFit: 'contain' }} />
                
                {/* Vertical Divider */}
                <div className="bg-slate-200" style={{ width: '2px', height: '24px', margin: '0 12px', borderRadius: '1px' }}></div>
                
                {/* Product Name */}
                <div style={{ color: '#0F172A', fontWeight: 800, fontSize: '0.9rem', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
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
            </div>
          </div>
        </header>
        
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
