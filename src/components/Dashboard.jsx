import React, { useState, useEffect, useRef } from 'react';
import mqtt from 'mqtt';
import { supabase } from '../lib/supabase';

const BROKER_URL = import.meta.env.VITE_MQTT_BROKER || 'wss://broker.hivemq.com:8884/mqtt';
const DEVICE_ID = import.meta.env.VITE_DEVICE_ID || 'esp01_wol_01';
const CMD_TOPIC = `nyalakanpc/${DEVICE_ID}/cmd`;
const LOG_TOPIC = `nyalakanpc/${DEVICE_ID}/logs`;
const STATUS_TOPIC = `nyalakanpc/${DEVICE_ID}/status`;

export function Dashboard({ profile }) {
  const [client, setClient] = useState(null);
  const [brokerStatus, setBrokerStatus] = useState('connecting');
  const [logs, setLogs] = useState([]);
  const [espStatus, setEspStatus] = useState('offline');
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [waking, setWaking] = useState(null); // track which MAC is being sent
  const logEndRef = useRef(null);

  useEffect(() => {
    fetchDevices();
    const mqttClient = mqtt.connect(BROKER_URL, {
      clientId: `dash_${Math.random().toString(16).slice(2, 8)}`,
      clean: true,
      reconnectPeriod: 3000,
      connectTimeout: 30 * 1000, // 30s timeout for mobile
      keepalive: 60,
    });

    mqttClient.on('connect', () => {
      setBrokerStatus('connected');
      mqttClient.subscribe([LOG_TOPIC, STATUS_TOPIC]);
      setClient(mqttClient);
    });

    mqttClient.on('reconnect', () => setBrokerStatus('reconnecting'));
    mqttClient.on('close', () => setBrokerStatus('disconnected'));
    mqttClient.on('error', (err) => {
      console.error('MQTT Error:', err);
      setBrokerStatus('error');
    });

    mqttClient.on('message', (topic, msg) => {
      const text = msg.toString();
      if (topic === LOG_TOPIC) {
        setLogs(prev => [...prev.slice(-49), { time: new Date().toLocaleTimeString(), text, id: Date.now() }]);
      } else if (topic === STATUS_TOPIC) {
        setEspStatus(text);
      }
    });

    return () => mqttClient.end();
  }, []);

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  const fetchDevices = async () => {
    setLoading(true);
    const { data } = await supabase.from('devices').select('*');
    if (data) setDevices(data);
    setLoading(false);
  };

  const handleWake = (mac) => {
    if (!client) return;
    setWaking(mac);
    client.publish(CMD_TOPIC, `WAKE|${mac}`);
    setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), text: `⚡ Mengirim WAKE ke ${mac}`, id: Date.now(), action: true }]);
    setTimeout(() => setWaking(null), 2000);
  };

  // ── Pending Approval State ──
  if (!profile?.is_approved) {
    return (
      <div className="max-w-container mx-auto px-5 py-20 flex justify-center animate-fade-in">
        <div className="card p-10 text-center max-w-md">
          <span className="material-symbols-outlined text-5xl text-orange-500 mb-4">hourglass_top</span>
          <h2 className="text-xl font-bold text-surface-800 mb-2">Menunggu Persetujuan</h2>
          <p className="text-surface-500 text-sm">Akun <strong>{profile?.email}</strong> belum disetujui. Hubungi admin untuk aktivasi akses.</p>
        </div>
      </div>
    );
  }

  const mainDevice = devices[0]; // PC Utama (first registered)

  return (
    <div className="max-w-container mx-auto px-5 py-8 animate-fade-in">

      {/* ──── Hero: Primary Station ──── */}
      {mainDevice && (
        <section className="card bg-gradient-to-br from-primary-500 via-primary-600 to-primary-800 text-white p-8 mb-8 relative overflow-hidden">
          {/* Decorative circles */}
          <div className="absolute -top-16 -right-16 w-48 h-48 bg-white/5 rounded-full" />
          <div className="absolute -bottom-20 -left-10 w-64 h-64 bg-white/5 rounded-full" />
          
          <div className="relative z-10 flex flex-col sm:flex-row items-center justify-between gap-6">
            <div>
              <p className="text-primary-200 text-xs font-bold uppercase tracking-widest mb-1">Primary Station</p>
              <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{mainDevice.name}</h2>
              <p className="text-primary-200 font-mono text-sm mt-1">{mainDevice.mac_address}</p>
            </div>
            <button
              onClick={() => handleWake(mainDevice.mac_address)}
              disabled={espStatus !== 'online' || waking === mainDevice.mac_address}
              className="btn bg-white text-primary-700 font-extrabold px-8 py-4 rounded-2xl text-base shadow-elevated hover:shadow-lg disabled:opacity-50 group"
            >
              <span className="material-symbols-outlined text-2xl group-hover:scale-110 transition-transform" style={{ fontVariationSettings: "'FILL' 1" }}>
                {waking === mainDevice.mac_address ? 'progress_activity' : 'power_settings_new'}
              </span>
              {waking === mainDevice.mac_address ? 'Mengirim...' : 'NYALAKAN'}
            </button>
          </div>

          {/* Mini stats */}
          <div className="relative z-10 grid grid-cols-3 gap-4 mt-8">
            <div className="bg-white/10 backdrop-blur rounded-xl p-3 text-center">
              <p className="text-[10px] font-bold uppercase tracking-wider text-primary-200">ESP-01</p>
              <p className={`font-mono font-bold text-sm ${espStatus === 'online' ? 'text-green-300' : 'text-red-300'}`}>
                {espStatus.toUpperCase()}
              </p>
            </div>
            <div className="bg-white/10 backdrop-blur rounded-xl p-3 text-center">
              <p className="text-[10px] font-bold uppercase tracking-wider text-primary-200">System Link</p>
              <p className={`font-mono font-bold text-sm ${brokerStatus === 'connected' ? 'text-green-300' : 'text-orange-300 animate-pulse'}`}>
                {brokerStatus.toUpperCase()}
              </p>
            </div>
            <div className="bg-white/10 backdrop-blur rounded-xl p-3 text-center">
              <p className="text-[10px] font-bold uppercase tracking-wider text-primary-200">Devices</p>
              <p className="font-mono font-bold text-sm">{devices.length}</p>
            </div>
          </div>
        </section>
      )}

      {/* ──── Two-Column Grid ──── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* ── Device List ── */}
        <section className="lg:col-span-3 card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-surface-200">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary-500">devices</span>
              <h3 className="font-bold text-surface-800">Registered Devices</h3>
            </div>
            <span className="badge badge-primary">{devices.length} aktif</span>
          </div>

          <div className="divide-y divide-surface-100">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-surface-400 gap-2">
                <span className="material-symbols-outlined animate-spin">progress_activity</span> Loading...
              </div>
            ) : devices.length === 0 ? (
              <p className="py-10 text-center text-surface-400 text-sm italic">Belum ada perangkat terdaftar.</p>
            ) : (
              devices.map((dev) => (
                <div key={dev.id} className="flex items-center justify-between px-5 py-4 hover:bg-surface-50 transition-colors group">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary-50 text-primary-500 flex items-center justify-center group-hover:bg-primary-100 transition-colors">
                      <span className="material-symbols-outlined">desktop_windows</span>
                    </div>
                    <div>
                      <p className="font-semibold text-surface-800 text-sm">{dev.name}</p>
                      <p className="font-mono text-[11px] text-surface-400 tracking-wider">{dev.mac_address}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleWake(dev.mac_address)}
                    disabled={espStatus !== 'online' || waking === dev.mac_address}
                    className="btn-primary px-5 py-2 text-xs"
                  >
                    {waking === dev.mac_address ? (
                      <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                    ) : (
                      <><span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>power_settings_new</span> WAKE</>
                    )}
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        {/* ── Live Logs ── */}
        <section className="lg:col-span-2 card overflow-hidden flex flex-col max-h-[520px]">
          <div className="flex items-center justify-between px-5 py-4 border-b border-surface-200">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-surface-400">terminal</span>
              <h3 className="font-bold text-surface-800 text-sm">System Logs</h3>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${brokerStatus === 'connected' ? 'bg-green-500' : 'bg-orange-500 animate-pulse'}`} />
                <span className="text-[10px] font-bold text-surface-400 uppercase tracking-tighter">BROKER</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${espStatus === 'online' ? 'bg-green-500 animate-pulse-dot' : 'bg-red-400'}`} />
                <span className="text-[10px] font-bold text-surface-400 uppercase tracking-tighter">ESP01</span>
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto bg-surface-900 p-4 font-mono text-xs text-surface-300">
            {logs.length === 0 ? (
              <p className="text-surface-500 italic text-center mt-8">Menunggu sinyal dari ESP01…</p>
            ) : (
              logs.map(log => (
                <div key={log.id} className={`mb-1 flex gap-3 py-0.5 border-l-2 pl-2 ${log.action ? 'border-primary-400 text-primary-300' : 'border-surface-700'}`}>
                  <span className="text-surface-500 shrink-0">{log.time}</span>
                  <span>{log.text}</span>
                </div>
              ))
            )}
            <div ref={logEndRef} />
          </div>
        </section>

      </div>
    </div>
  );
}
