const mqtt = require('mqtt');

console.log("Connecting to HiveMQ...");
const client = mqtt.connect('mqtt://broker.emqx.io:1883');

client.on('connect', () => {
    console.log("Connected! Subscribing to oes/#");
    client.subscribe('oes/#', (err) => {
        if (!err) {
            console.log("Subscribed successfully. Waiting for messages...");
        } else {
            console.log("Subscribe error:", err);
        }
    });
});

client.on('message', (topic, message) => {
    console.log(`\n[${new Date().toISOString()}] Topic: ${topic}`);
    console.log(`Payload: ${message.toString()}`);
});

client.on('error', (err) => {
    console.error("Connection error:", err);
});
