import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { WebSocketServer } from 'ws';
import net from 'net';

/**
 * Vite Dev Plugin: MQTT WebSocket-to-TCP Bridge
 * Automatically allows web browsers on localhost to connect to the raw TCP MQTT Broker (72.62.247.124:1883)
 * via WebSocket on ws://localhost:8083 without any extra manual commands!
 */
function mqttWsBridgePlugin() {
  let bridgeServer = null;

  return {
    name: 'mqtt-ws-bridge',
    configureServer(server) {
      if (bridgeServer) return;

      const WS_PORT = 8083;
      const MQTT_HOST = '72.62.247.124';
      const MQTT_PORT = 1883;

      try {
        bridgeServer = new WebSocketServer({ port: WS_PORT });

        bridgeServer.on('listening', () => {
          console.log(`\n  ⚡ [OES MQTT Bridge] Active on ws://localhost:${WS_PORT}`);
          console.log(`  ⚡ [OES MQTT Bridge] Forwarding browser WebSockets to TCP ${MQTT_HOST}:${MQTT_PORT}\n`);
        });

        bridgeServer.on('connection', (ws, req) => {
          const clientIp = req.socket.remoteAddress;
          const tcpSocket = net.createConnection({ host: MQTT_HOST, port: MQTT_PORT });

          ws.on('message', (data) => {
            if (tcpSocket.writable) tcpSocket.write(data);
          });

          tcpSocket.on('data', (chunk) => {
            if (ws.readyState === ws.OPEN) ws.send(chunk);
          });

          ws.on('close', () => tcpSocket.end());
          tcpSocket.on('close', () => { if (ws.readyState === ws.OPEN) ws.close(); });
          ws.on('error', () => tcpSocket.destroy());
          tcpSocket.on('error', () => { if (ws.readyState === ws.OPEN) ws.close(); });
        });

        bridgeServer.on('error', (err) => {
          if (err.code !== 'EADDRINUSE') {
            console.warn('[OES MQTT Bridge] Note:', err.message);
          }
        });
      } catch (err) {
        console.warn('[OES MQTT Bridge] Failed to initialize:', err.message);
      }
    }
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), mqttWsBridgePlugin()],
  base: '/oes-dashboard1/',
});
