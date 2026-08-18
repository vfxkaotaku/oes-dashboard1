
import mqtt from 'mqtt';
const client = mqtt.connect('ws://broker.hivemq.com:8000/mqtt');
const deviceId = 'OES-DL-0001';
client.on('connect', () => {
  console.log('Connected to broker. Simulating data...');
  const payload = {
    ac_w: '25000', e_day: '120.5', e_tot: '4500.5',
    ac_v: '230.1', freq: '50.0', temp: '45.2', ac_a: '108.7',
    pv_v: '650.0', pv_a: '38.5', pv_w: '25025'
  };
  const statusPayload = { online: true, device_id: deviceId };
  setInterval(() => {
    client.publish('oes/logger/' + deviceId + '/telemetry', JSON.stringify(payload));
    client.publish('oes/logger/' + deviceId + '/status', JSON.stringify(statusPayload));
    console.log('Published test data for ' + deviceId);
  }, 3000);
});

