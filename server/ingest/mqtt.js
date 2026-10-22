// Subscribes to the MQTT topics written by tesla/fleet-telemetry's MQTT dispatcher:
//   <topic_base>/<VIN>/v/<field_name>         JSON value
//   <topic_base>/<VIN>/connectivity           {"ConnectionId","Status","CreatedAt"}
//   <topic_base>/<VIN>/alerts/<name>/current  {"StartedAt","EndedAt","Audiences"}
// Source: datastore/mqtt/README.md and mqtt_payload.go in teslamotors/fleet-telemetry.
import mqtt from 'mqtt';

export function parseTopic(base, topic) {
  const parts = topic.split('/');
  const baseParts = base.split('/');
  if (parts.slice(0, baseParts.length).join('/') !== base) return null;
  const [vin, kind, name, sub] = parts.slice(baseParts.length);
  if (kind === 'v' && name) return { vin, kind: 'field', name };
  if (kind === 'connectivity') return { vin, kind: 'connectivity' };
  if (kind === 'alerts' && name && sub === 'current') return { vin, kind: 'alert', name };
  return null;
}

export function handleMessage({ store, base, vin, onConnectivity, onAlert }, topic, buf) {
  const t = parseTopic(base, topic);
  if (!t || (vin && t.vin !== vin)) return false;
  let value;
  try { value = JSON.parse(buf.toString()); } catch { return false; }
  if (t.kind === 'field') store.put(t.name, value, Date.now(), 'TEL');
  else if (t.kind === 'connectivity') onConnectivity?.(value);
  else if (t.kind === 'alert') onAlert?.(t.name, value);
  return true;
}

export function startMqtt({ url, username, password, base, vin, store, onConnectivity, onAlert }) {
  const client = mqtt.connect(url, { username, password, reconnectPeriod: 5000 });
  const ctx = { store, base, vin, onConnectivity, onAlert };
  client.on('connect', () => {
    const v = vin || '+';
    client.subscribe([`${base}/${v}/v/+`, `${base}/${v}/connectivity`, `${base}/${v}/alerts/+/current`], { qos: 1 });
    console.log(`[mqtt] connected to ${url}, listening on ${base}/${v}/…`);
  });
  client.on('error', (err) => console.warn('[mqtt]', err.message));
  client.on('message', (topic, buf) => handleMessage(ctx, topic, buf));
  return client;
}
