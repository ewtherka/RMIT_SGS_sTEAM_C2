// Smoke test / demo script for TIDE_MODE=simulated. Run with the API up: node scripts/sim-demo.mjs
const API = process.env.API ?? 'http://localhost:3333';
const ID = {
  patient: '30000000-0000-4000-8000-000000000001',
  lanUser: '30000000-0000-4000-8000-000000000003',
  lanDoctor: '40000000-0000-4000-8000-000000000002',
  admins: ['30000000-0000-4000-8000-000000000005', '30000000-0000-4000-8000-000000000006'],
  service: '50000000-0000-4000-8000-000000000001',
  record: '80000000-0000-4000-8000-000000000001',
};
async function call(method, path, token, body, key) {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}
const login = async (userId) => (await call('POST', '/v1/sim/session', null, { userId })).json.accessToken;
const show = (label, r) => console.log(`${label}: ${r.status}`, JSON.stringify(r.json).slice(0, 220));

show('auth/config', await call('GET', '/v1/auth/config'));
const patient = await login(ID.patient);
const lan = await login(ID.lanUser);
show('me (patient)', await call('GET', '/v1/me', patient));

// Patient books BS. Lan so a care relationship exists, but booking alone grants no record access.
const from = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const slots = await call('GET', `/v1/availability?serviceId=${ID.service}&from=${from}&to=${from}`);
const slot = slots.json.find((s) => s.doctorId === ID.lanDoctor);
show(
  'book BS. Lan',
  await call('POST', '/v1/appointments', patient, { serviceId: ID.service, doctorId: ID.lanDoctor, startsAt: slot.startsAt }, crypto.randomUUID()),
);
show('Lan decrypt BEFORE approval (expect 403)', await call('POST', `/v1/sim/records/${ID.record}/decrypt`, lan));
const req = await call('POST', `/v1/records/${ID.record}/access-requests`, patient, { doctorId: ID.lanDoctor, intent: 'GRANT' });
show('patient shares record with Lan', req);
const a1 = await login(ID.admins[0]);
const a2 = await login(ID.admins[1]);
show('admin 1 approves', await call('POST', `/v1/sim/approvals/${req.json.id}/approve`, a1));
show('admin 1 approves again (expect 409)', await call('POST', `/v1/sim/approvals/${req.json.id}/approve`, a1));
show('Lan decrypt after 1/2 (expect 403)', await call('POST', `/v1/sim/records/${ID.record}/decrypt`, lan));
show('admin 2 approves (quorum)', await call('POST', `/v1/sim/approvals/${req.json.id}/approve`, a2));
show('Lan decrypt after quorum (expect 200)', await call('POST', `/v1/sim/records/${ID.record}/decrypt`, lan));
show('no token (expect 401)', await call('GET', '/v1/me'));
