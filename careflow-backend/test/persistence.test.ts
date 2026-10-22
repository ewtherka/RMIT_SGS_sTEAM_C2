import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Database } from '../src/database.js';
import { loadConfig } from '../src/config.js';
import { DEMO, seed } from '../src/seed.js';
import { body } from './fixture.js';

test('independent writers contend for the same slot; durable retry and replay survive reconnection', async () => {
  const root = mkdtempSync(join(tmpdir(), 'careflow-persistence-'));
  const config = loadConfig({ databasePath: join(root, 'db.sqlite'), startWorker: false });
  let db = new Database(config);
  seed(db);
  const otherUser = randomUUID(),
    otherPatient = randomUUID();
  db.run(
    'INSERT INTO users(id,display_name,created_at) VALUES(?,?,?)',
    otherUser,
    'Fake concurrency patient',
    Date.now(),
  );
  db.run('INSERT INTO memberships VALUES(?,?)', otherUser, DEMO.clinic);
  db.run(
    'INSERT INTO patients(id,clinic_id,user_id,display_name,created_at) VALUES(?,?,?,?,?)',
    otherPatient,
    DEMO.clinic,
    otherUser,
    'Fake concurrency patient',
    Date.now(),
  );
  const barrier = new SharedArrayBuffer(4);
  let ready = 0;
  const jobs = [DEMO.patientUser, otherUser].map(
    (userId) =>
      new Promise<{ status: number; id?: string }>((resolve, reject) => {
        const worker = new Worker(new URL('./booking-worker.js', import.meta.url), {
          workerData: { config, barrier, userId, body: body(), key: 'independent-writer-key' },
        });
        worker.on('message', (message) => {
          if (message.ready) {
            ready++;
            if (ready === 2) {
              Atomics.store(new Int32Array(barrier), 0, 1);
              Atomics.notify(new Int32Array(barrier), 0, 2);
            }
          } else resolve(message);
        });
        worker.on('error', reject);
        worker.on('exit', (code) => {
          if (code !== 0) reject(Error('Worker failed'));
        });
      }),
  );
  try {
    const results = await Promise.all(jobs);
    assert.deepEqual(results.map((x) => x.status).sort(), [201, 409]);
    assert.equal(await db.claimJti('persistent-proof', Date.now() + 120000), true);
    db.onModuleDestroy();
    db = new Database(config);
    assert.equal(await db.claimJti('persistent-proof', Date.now() + 120000), false);
    const saved = db.get('SELECT * FROM idempotency WHERE key=?', 'independent-writer-key')!;
    assert.equal(JSON.parse(saved.response).id, results.find((x) => x.status === 201)!.id);
    assert.equal(
      db.idempotent<{ id: string }>(saved.user_id, saved.key, saved.operation, body(), () => {
        throw Error('Must not execute retry');
      }).id,
      JSON.parse(saved.response).id,
    );
  } finally {
    db.onModuleDestroy();
    rmSync(root, { recursive: true, force: true });
  }
});
