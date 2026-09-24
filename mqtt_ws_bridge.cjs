// =============================================================================
// mqtt_ws_bridge.cjs — Local MQTT WebSocket to TCP Bridge for OES Web Dashboard
// Allows web browsers to connect to the raw TCP MQTT Broker (72.62.247.124:1883)
// via WebSocket on ws://localhost:8083
// =============================================================================

const WebSocket = require('ws');
const net = require('net');

const WS_PORT = parseInt(process.env.WS_PORT || '8083', 10);
const MQTT_HOST = process.env.MQTT_HOST || '72.62.247.124';
const MQTT_PORT = parseInt(process.env.MQTT_PORT || '1883', 10);

const wss = new WebSocket.Server({ port: WS_PORT }, () => {
  console.log(`[OES Bridge] WebSocket bridge listening on ws://localhost:${WS_PORT}`);
  console.log(`[OES Bridge] Forwarding traffic to TCP MQTT broker ${MQTT_HOST}:${MQTT_PORT}`);
});

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`[OES Bridge] Browser client connected from ${clientIp}`);

  const tcpSocket = net.createConnection({ host: MQTT_HOST, port: MQTT_PORT }, () => {
    console.log(`[OES Bridge] Connected to TCP MQTT broker for client ${clientIp}`);
  });

  ws.on('message', (data) => {
    if (tcpSocket.writable) {
      tcpSocket.write(data);
    }
  });

  tcpSocket.on('data', (chunk) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(chunk);
    }
  });

  ws.on('close', () => {
    console.log(`[OES Bridge] Browser client disconnected (${clientIp})`);
    tcpSocket.end();
  });

  tcpSocket.on('close', () => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  });

  ws.on('error', (err) => {
    console.error(`[OES Bridge] WebSocket error: ${err.message}`);
    tcpSocket.destroy();
  });

  tcpSocket.on('error', (err) => {
    console.error(`[OES Bridge] TCP socket error: ${err.message}`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  });
});

wss.on('error', (err) => {
  console.error(`[OES Bridge] Server error: ${err.message}`);
});
