// Runs pi-bridge/bridge.js against the real server with a fake tesla-control.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../server/config.js';
import { createApp } from '../server/index.js';
import { createServer } from '../server/http.js';

test('the Pi bridge posts state and runs a queued command', async () => {
  const app = createApp({ ...config, sampleMode: false, appPasscode: '', bridgeToken: 'bt', vin: 'V' }, { dbFile: ':memory:' });
  const server = createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-')), 'calls.log');
  const child = spawn(process.execPath, [new URL('../pi-bridge/bridge.js', import.meta.url).pathname], {
    env: {
      ...process.env,
      SERVER_URL: `http://127.0.0.1:${server.address().port}`,
      BRIDGE_TOKEN: 'bt',
      TESLA_VIN: 'V',
      TESLA_KEY_FILE: '/dev/null',
      TESLA_CONTROL: new URL('./fixtures/fake-tesla-control.sh', import.meta.url).pathname,
      FAKE_LOG: log,
    },
    stdio: 'ignore',
  });
  try {
    const until = async (cond) => {
      for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 50));
      assert.ok(cond());
    };
    await until(() => app.store.get('Soc') === 64);
    assert.equal(app.store.get('Locked'), true);
    assert.equal(app.store.entry('Soc').source, 'BLE');
    const result = await app.commands.run('door_unlock', {}, 'ble');
    assert.equal(result.via, 'ble');
    assert.match(fs.readFileSync(log, 'utf8'), /^unlock$/m);
  } finally {
    child.kill();
    server.close();
  }
});
