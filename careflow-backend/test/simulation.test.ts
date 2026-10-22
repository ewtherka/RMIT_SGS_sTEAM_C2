import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { createApp } from '../src/app.js';
import { Database } from '../src/database.js';
import { seed, DEMO } from '../src/seed.js';
import { SimTide } from '../src/simulation.js';
import { body } from './fixture.js';

async function simFixture() {
  const root = mkdtempSync(join(tmpdir(), 'careflow-sim-'));
  const { app } = await createApp({
    databasePath: join(root, 'db.sqlite'),
    adapterPath: join(root, 'no-adapter.json'),
    simSecretPath: join(root, 'sim.secret'),
    tideMode: 'simulated',
    publicUrl: 'http://localhost:3333',
    startWorker: false,
    qrKey: 'q'.repeat(48),
    port: 0,
  });
  seed(app.get(Database));
  app.get(SimTide).onModuleInit(); // encrypts and releases seed records after seeding
  await app.listen(0, '127.0.0.1');
  const origin = `http://127.0.0.1:${(app.getHttpServer().address() as any).port}`;
  const call = async (method: string, path: string, token?: string, json?: unknown) => {
    const res = await fetch(origin + path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(json ? { 'Content-Type': 'application/json' } : {}),
        ...(method === 'POST' && path === '/v1/appointments' ? { 'Idempotency-Key': randomUUID() } : {}),
      },
      body: json ? JSON.stringify(json) : undefined,
    });
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };
  const login = async (userId: string) => (await call('POST', '/v1/sim/session', undefined, { userId })).json.accessToken as string;
  return {
    call,
    login,
    db: app.get(Database),
    close: async () => {
      await app.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test('simulated TideCloak: server-verified sign-in and roles', async (t) => {
  const f = await simFixture();
  t.after(() => f.close());
  const config = await f.call('GET', '/v1/auth/config');
  assert.equal(config.json.mode, 'SIMULATED');
  assert.deepEqual(config.json.quorum, { threshold: 2, of: 3 });
  assert.equal((await f.call('GET', '/v1/me')).status, 401);
  const forged = await new SignJWT({ realm_access: { roles: ['careflow-admin'] }, azp: 'careflow-client' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(DEMO.patientUser)
    .setIssuer('http://localhost:3333/sim-tidecloak/realms/careflow')
    .setAudience('careflow-client')
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode('x'.repeat(32)));
  assert.equal((await f.call('GET', '/v1/me', forged)).status, 401);
  const me = await f.call('GET', '/v1/me', await f.login(DEMO.patientUser));
  assert.deepEqual(me.json.roles, ['careflow-patient']);
  assert.equal((await f.call('POST', '/v1/sim/session', undefined, { userId: randomUUID() })).status, 404);
});

test('simulated Emergent Authority: 2 of 3 independent admins gate record access', async (t) => {
  const f = await simFixture();
  t.after(() => f.close());
  const record = DEMO.records[0];
  const [patient, lan, reception, a1, a2] = await Promise.all(
    [DEMO.patientUser, DEMO.doctorUserB, DEMO.receptionist, DEMO.admins[0], DEMO.admins[1]].map(f.login),
  );
  // Unrelated doctor and clinic staff cannot even see that the record exists.
  assert.equal((await f.call('POST', `/v1/sim/records/${record}/decrypt`, lan)).status, 404);
  assert.equal((await f.call('GET', `/v1/sim/records/${record}/access`, reception)).status, 404);
  // An admin governs access but cannot read the record.
  const adminRead = await f.call('POST', `/v1/sim/records/${record}/decrypt`, a1);
  assert.equal(adminRead.status, 403);
  assert.equal(adminRead.json.code, 'TIDE_POLICY_DENIED');

  assert.equal((await f.call('POST', '/v1/appointments', patient, body(10, DEMO.doctorB))).status, 201);
  assert.equal((await f.call('POST', `/v1/sim/records/${record}/decrypt`, lan)).status, 403);
  const lanView = await f.call('GET', `/v1/sim/records/${record}/access`, lan);
  assert.equal(lanView.json.canDecrypt, false);
  assert.deepEqual(lanView.json.requests, []);

  const share = await f.call('POST', `/v1/records/${record}/access-requests`, patient, {
    doctorId: DEMO.doctorB,
    intent: 'GRANT',
  });
  assert.equal(share.json.status, 'PENDING_TIDE');
  assert.equal((await f.call('POST', `/v1/sim/approvals/${share.json.id}/approve`, lan)).status, 403);
  const first = await f.call('POST', `/v1/sim/approvals/${share.json.id}/approve`, a1);
  assert.equal(first.json.quorum.reached, false);
  assert.equal((await f.call('POST', `/v1/sim/approvals/${share.json.id}/approve`, a1)).json.code, 'ALREADY_APPROVED');
  assert.equal((await f.call('POST', `/v1/sim/records/${record}/decrypt`, lan)).status, 403);
  const second = await f.call('POST', `/v1/sim/approvals/${share.json.id}/approve`, a2);
  assert.equal(second.json.status, 'COMMITTED');
  const read = await f.call('POST', `/v1/sim/records/${record}/decrypt`, lan);
  assert.equal(read.status, 201);
  assert.equal(read.json.allowedBy, 'QUORUM_GRANT');
  assert.match(read.json.plaintext, /dữ liệu giả/);
  // Sharing one record never unlocks the other one.
  assert.equal((await f.call('POST', `/v1/sim/records/${DEMO.records[1]}/decrypt`, lan)).status, 403);

  const revoke = await f.call('POST', `/v1/records/${record}/access-requests`, patient, {
    doctorId: DEMO.doctorB,
    intent: 'REVOKE',
  });
  await f.call('POST', `/v1/sim/approvals/${revoke.json.id}/approve`, a1);
  assert.equal((await f.call('POST', `/v1/sim/records/${record}/decrypt`, lan)).status, 201);
  await f.call('POST', `/v1/sim/approvals/${revoke.json.id}/approve`, a2);
  assert.equal((await f.call('POST', `/v1/sim/records/${record}/decrypt`, lan)).status, 403);

  const log = await f.call('GET', `/v1/sim/records/${record}/access-log`, patient);
  const actions = log.json.items.map((x: any) => x.action);
  for (const action of ['ACCESS_INTENT_SUBMITTED', 'SIM_TIDE_APPROVAL', 'SIM_TIDE_QUORUM_COMMITTED', 'SIM_TIDE_DECRYPT', 'SIM_TIDE_DECRYPT_DENIED'])
    assert.ok(actions.includes(action), action);
  assert.equal((await f.call('GET', `/v1/sim/records/${record}/access-log`, lan)).status, 404);
});

test('simulated break-glass: quorum-approved, time-limited, visible and revocable by the patient', async (t) => {
  const f = await simFixture();
  t.after(() => f.close());
  const record = DEMO.records[0];
  const [patient, lan, a1, a2, a3] = await Promise.all(
    [DEMO.patientUser, DEMO.doctorUserB, ...DEMO.admins].map(f.login),
  );
  const ask = (token: string, reason = 'Người bệnh bất tỉnh tại cấp cứu, cần kết quả xét nghiệm gần nhất.') =>
    f.call('POST', `/v1/sim/records/${record}/emergency-requests`, token, { reason });
  // Without a treating relationship the record stays invisible.
  assert.equal((await ask(lan)).status, 404);
  await f.call('POST', '/v1/appointments', patient, body(11, DEMO.doctorB));
  assert.equal((await ask(lan, 'ngắn')).status, 400);
  assert.equal((await ask(a1)).status, 403);
  const req = await ask(lan);
  assert.equal(req.status, 201);
  assert.equal(req.json.status, 'PENDING_TIDE');
  assert.equal((await ask(lan)).json.code, 'EMERGENCY_OPEN');
  const queue = await f.call('GET', '/v1/sim/approvals', a1);
  assert.equal(queue.json.emergencyItems.length, 1);
  await f.call('POST', `/v1/sim/emergency-requests/${req.json.id}/approve`, a1);
  assert.equal((await f.call('POST', `/v1/sim/records/${record}/decrypt`, lan)).status, 403);
  const committed = await f.call('POST', `/v1/sim/emergency-requests/${req.json.id}/approve`, a2);
  assert.equal(committed.json.status, 'COMMITTED');
  assert.ok(committed.json.expiresAt);
  assert.equal((await f.call('POST', `/v1/sim/emergency-requests/${req.json.id}/approve`, a3)).json.code, 'REQUEST_CLOSED');
  const read = await f.call('POST', `/v1/sim/records/${record}/decrypt`, lan);
  assert.equal(read.json.allowedBy, 'EMERGENCY_QUORUM_GRANT');
  // Emergency access covers only the requested record.
  assert.equal((await f.call('POST', `/v1/sim/records/${DEMO.records[1]}/decrypt`, lan)).status, 403);
  // The patient sees it and can end it early.
  const view = await f.call('GET', `/v1/sim/records/${record}/access`, patient);
  assert.equal(view.json.emergencies[0].status, 'COMMITTED');
  const ended = await f.call('POST', `/v1/sim/emergency-requests/${req.json.id}/end`, patient);
  assert.equal(ended.json.status, 'ENDED');
  assert.equal((await f.call('POST', `/v1/sim/records/${record}/decrypt`, lan)).status, 403);
  const log = (await f.call('GET', `/v1/sim/records/${record}/access-log`, patient)).json.items.map((x: any) => x.action);
  for (const action of ['SIM_EMERGENCY_REQUESTED', 'SIM_EMERGENCY_APPROVAL', 'SIM_EMERGENCY_COMMITTED', 'SIM_EMERGENCY_ENDED'])
    assert.ok(log.includes(action), action);

  // A second request expires on its own after the time limit.
  const again = await ask(lan);
  await f.call('POST', `/v1/sim/emergency-requests/${again.json.id}/approve`, a1);
  await f.call('POST', `/v1/sim/emergency-requests/${again.json.id}/approve`, a3);
  assert.equal((await f.call('POST', `/v1/sim/records/${record}/decrypt`, lan)).status, 201);
  f.db.run('UPDATE sim_emergency SET expires_at=? WHERE id=?', Date.now() - 1000, again.json.id);
  assert.equal((await f.call('POST', `/v1/sim/records/${record}/decrypt`, lan)).status, 403);
  const expired = await f.call('GET', `/v1/sim/records/${record}/access`, lan);
  assert.equal(expired.json.emergencies[0].status, 'EXPIRED');
});
