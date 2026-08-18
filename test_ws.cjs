const mqtt = require('mqtt');
const wsClient = mqtt.connect('ws://broker.hivemq.com:8000/mqtt');
wsClient.on('connect', () => {
    console.log('WS Connected');
    wsClient.subscribe('oes/logger/#');
});
wsClient.on('message', (topic, message) => {
    console.log('WS received:', topic, message.toString().substring(0, 50));
});
