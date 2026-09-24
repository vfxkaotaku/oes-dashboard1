// =============================================================================
// mqttHelper.js — URL Normalization & Connection Helper for OES Web Dashboard
// =============================================================================

/**
 * Returns a valid WebSocket MQTT URL for browsers.
 * Web browsers CANNOT connect to raw TCP (port 1883 / mqtt://).
 * They require MQTT over WebSockets (ws:// or wss://).
 */
export function getSafeMqttUrl(rawUrl) {
  let url = (rawUrl || '').trim();
  const isLocalhost = typeof window !== 'undefined' && 
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';

  // If no URL is configured, use local bridge on localhost or EMQX cloud on deployed web
  if (!url) {
    if (isLocalhost) {
      return `ws://${window.location.hostname}:8083`;
    }
    return 'wss://broker.emqx.io:8084/mqtt';
  }

  // If user entered raw TCP address like "72.62.247.124:1883" or "mqtt://72.62.247.124"
  if (url.startsWith('mqtt://') || url.startsWith('tcp://')) {
    url = url.replace(/^(mqtt|tcp):\/\//, '');
  }

  // If user entered the server IP with port 1883 (raw TCP), and is on localhost
  if (url === '72.62.247.124:1883' || url === '72.62.247.124') {
    if (isLocalhost) {
      // Connect through the dev server WebSocket bridge
      return `ws://${window.location.hostname}:8083`;
    } else {
      // On public/cloud, if server has WS on 9001 or 8083
      return `ws://72.62.247.124:9001`;
    }
  }

  // Ensure ws:// or wss:// prefix
  if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
    url = (isHttps ? 'wss://' : 'ws://') + url;
  }

  return url;
}
