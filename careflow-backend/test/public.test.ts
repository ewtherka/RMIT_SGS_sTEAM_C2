import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fixture, day } from './fixture.js';
import { DEMO } from '../src/seed.js';

test('public catalog, relay bytes/headers, API contract and input errors', async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const catalog = await fetch(f.origin + `/v1/services?doctorId=${DEMO.doctorA}`);
  assert.equal(catalog.status, 200);
  assert.equal(((await catalog.json()) as any[]).length, 2);
  const doctors = await fetch(f.origin + `/v1/doctors?doctorId=${DEMO.doctorA}`);
  assert.equal(((await doctors.json()) as any[]).length, 1);
  const noMatch = await fetch(f.origin + '/v1/services?q=no-such-service');
  assert.deepEqual(await noMatch.json(), []);
  const available = await fetch(
    f.origin +
      `/v1/availability?serviceId=${DEMO.service}&from=${day()}&to=${day()}&after=13:00&before=14:00`,
  );
  const slots = (await available.json()) as any[];
  assert.ok(slots.length > 0);
  assert.ok(slots.every((x) => x.startsAt.slice(11, 16) >= '06:00' && x.endsAt.slice(11, 16) <= '07:00'));
  const relay = await fetch(f.origin + '/tide_dpop/iss/ab/aud/cd/tide_dpop_auth.html');
  assert.equal(relay.status, 200);
  assert.equal(
    createHash('sha256')
      .update(Buffer.from(await relay.arrayBuffer()))
      .digest('hex'),
    '9d7844b938f0a2565fa910d3d30e9b8797cbfd6e0b73d59d804169a089aea757',
  );
  assert.equal(relay.headers.get('allow-csp-from'), '*');
  assert.equal(relay.headers.get('x-frame-options'), null);
  assert.ok(relay.headers.get('content-security-policy')!.includes('script-src'));
  const openapi = await fetch(f.origin + '/openapi.json');
  const doc = (await openapi.json()) as any;
  assert.equal(doc.paths['/v1/appointments'].post.security[0].DPoP.length, 0);
  assert.ok(doc.paths['/v1/appointments'].post.parameters.some((p: any) => p.name === 'DPoP'));
  assert.equal(doc.paths['/v1/services'].get.security.length, 0);
  assert.ok(doc.components.schemas.Appointment);
  const badInput = await f.request(
    '/v1/appointments',
    'POST',
    {
      ...{ doctorId: DEMO.doctorA, serviceId: DEMO.service, startsAt: 'not-an-iso-time' },
      roles: ['careflow-admin'],
    },
    undefined,
    undefined,
    { key: 'invalid-input-001' },
  );
  assert.equal(badInput.status, 400);
  assert.equal(badInput.data.code, 'VALIDATION_ERROR');
  assert.ok(badInput.data.requestId);
  const malformed = await fetch(f.origin + '/v1/appointments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  });
  assert.equal(malformed.status, 400);
  const error = (await malformed.json()) as any;
  assert.equal(typeof error.code, 'string');
  assert.equal(typeof error.requestId, 'string');
  assert.ok(!error.message.includes('SyntaxError'));
  const patch = await f.request('/v1/me', 'PATCH', { phone: '+84900000000' });
  assert.equal(patch.status, 200);
  assert.equal(patch.data.phone, '+84900000000');
  assert.equal(patch.data.displayName, 'Nguyễn An (bệnh nhân giả)');
  const cross = await fetch(f.origin + '/v1/services', { headers: { Origin: 'https://unknown.invalid' } });
  assert.equal(cross.headers.get('access-control-allow-origin'), null);
});
