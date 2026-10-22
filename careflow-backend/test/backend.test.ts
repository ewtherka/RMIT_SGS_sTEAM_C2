import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, body, slot, day, testPolicy } from './fixture.js';
import { DEMO } from '../src/seed.js';
import { Notifications } from '../src/notifications.js';

test('booking, retries, overlap constraints and atomic reschedule', async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const a = await f.request('/v1/appointments', 'POST', body(), undefined, undefined, {
    key: 'book-one-0001',
  });
  assert.equal(a.status, 201);
  assert.equal(a.data.status, 'CONFIRMED');
  assert.ok(a.headers.get('x-request-id'));
  const retry = await f.request('/v1/appointments', 'POST', body(), undefined, undefined, {
    key: 'book-one-0001',
  });
  assert.equal(retry.data.id, a.data.id);
  const mismatch = await f.request('/v1/appointments', 'POST', body(10), undefined, undefined, {
    key: 'book-one-0001',
  });
  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.data.code, 'IDEMPOTENCY_MISMATCH');
  const concurrent = await Promise.all([
    f.request('/v1/appointments', 'POST', body(11), undefined, undefined, { key: 'race-http-1' }),
    f.request('/v1/appointments', 'POST', body(11), f.otherUser, 'patient', { key: 'race-http-2' }),
  ]);
  assert.deepEqual(concurrent.map((x) => x.status).sort(), [201, 409]);
  const b = await f.request('/v1/appointments', 'POST', body(10), f.otherUser, 'patient', {
    key: 'book-two-0001',
  });
  assert.equal(b.status, 201);
  const failed = await f.request(
    `/v1/appointments/${a.data.id}/reschedule`,
    'POST',
    { doctorId: DEMO.doctorA, startsAt: slot(10), expectedVersion: 1 },
    undefined,
    undefined,
    { key: 'move-book-0001' },
  );
  assert.equal(failed.status, 409);
  assert.equal((await f.request(`/v1/appointments/${a.data.id}`)).data.startsAt, a.data.startsAt);
  const overlap = await f.request('/v1/appointments', 'POST', body(9, DEMO.doctorB), undefined, undefined, {
    key: 'overlap-user-1',
  });
  assert.equal(overlap.status, 409);
  const moved = await f.request(
    `/v1/appointments/${a.data.id}/reschedule`,
    'POST',
    { doctorId: DEMO.doctorB, startsAt: slot(14), expectedVersion: 1 },
    undefined,
    undefined,
    { key: 'move-good-0001' },
  );
  assert.equal(moved.status, 200);
  assert.equal(moved.data.version, 2);
  const stale = await f.request(
    `/v1/appointments/${a.data.id}/cancel`,
    'POST',
    { expectedVersion: 1 },
    undefined,
    undefined,
    { key: 'cancel-stale-1' },
  );
  assert.equal(stale.status, 409);
  const cancel = await f.request(
    `/v1/appointments/${a.data.id}/cancel`,
    'POST',
    { expectedVersion: 2 },
    undefined,
    undefined,
    { key: 'cancel-good-1' },
  );
  assert.equal(cancel.data.status, 'CANCELLED');
  const available = await f.request(`/v1/availability?serviceId=${DEMO.service}&from=${day()}&to=${day()}`);
  assert.equal(available.status, 200);
  assert.ok(available.data.some((s: any) => s.doctorId === DEMO.doctorA && s.startsAt === a.data.startsAt));
});

test('ownership, role scope and clinic isolation are checked on every private route', async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const a = await f.request('/v1/appointments', 'POST', body(), undefined, undefined, {
    key: 'ownership-0001',
  });
  assert.equal((await f.request(`/v1/appointments/${a.data.id}`, 'GET', undefined, f.otherUser)).status, 404);
  assert.equal((await f.request('/v1/appointments', 'GET', undefined, f.otherUser)).data.items.length, 0);
  assert.equal(
    (await f.request(`/v1/appointments/${a.data.id}`, 'GET', undefined, DEMO.doctorUserB, 'doctor')).status,
    404,
  );
  assert.equal(
    (await f.request(`/v1/appointments/${a.data.id}`, 'GET', undefined, DEMO.doctorUserA, 'doctor')).status,
    200,
  );
  assert.equal(
    (await f.request('/v1/records', 'GET', undefined, DEMO.receptionist, 'receptionist')).data.items.length,
    0,
  );
  assert.equal(
    (await f.request(`/v1/records/${DEMO.records[0]}/policy`, 'GET', undefined, DEMO.admins[0], 'admin'))
      .status,
    404,
  );
  const roleInjection = await f.request(
    `/v1/appointments/${a.data.id}`,
    'GET',
    undefined,
    f.otherUser,
    'patient',
    { tokenClaims: { resource_access: { 'foreign-client': { roles: ['careflow-admin'] } } } },
  );
  assert.equal(roleInjection.status, 404);
  const mixedRoleCancel = await f.request(
    `/v1/appointments/${a.data.id}/cancel`,
    'POST',
    { expectedVersion: 1 },
    DEMO.doctorUserA,
    'doctor',
    {
      key: 'mixed-role-denied',
      tokenClaims: { realm_access: { roles: ['careflow-doctor', 'careflow-patient'] } },
    },
  );
  assert.equal(mixedRoleCancel.status, 404);
  assert.equal((await f.request(`/v1/appointments/${a.data.id}`)).data.status, 'CONFIRMED');
  f.db.run('DELETE FROM memberships WHERE user_id=?', DEMO.doctorUserA);
  assert.equal(
    (await f.request(`/v1/appointments/${a.data.id}`, 'GET', undefined, DEMO.doctorUserA, 'doctor')).status,
    404,
  );
  const selfRole = await f.request('/v1/me', 'PATCH', { displayName: 'Sample', roles: ['careflow-admin'] });
  assert.equal(selfRole.status, 400);
  const newSubject = randomUUID();
  assert.equal((await f.request('/v1/me', 'GET', undefined, newSubject)).data.onboardingRequired, true);
  const enrol = await f.request(
    '/v1/me/onboarding',
    'POST',
    { displayName: 'New fake patient', clinicId: DEMO.clinic },
    newSubject,
  );
  assert.equal(enrol.status, 201);
  assert.equal(
    f.db.get('SELECT tide_user_key FROM users WHERE id=?', enrol.data.userId)!.tide_user_key,
    `fixture-key-${newSubject}`,
  );
  assert.equal(
    (
      await f.request(
        '/v1/me/onboarding',
        'POST',
        { displayName: 'Duplicate', clinicId: DEMO.clinic },
        newSubject,
      )
    ).status,
    409,
  );
});

test('strict DPoP checks: missing proof, bearer, replay, time, URL, method, binding and token claims', async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  for (const options of [
    { proofClaims: { htm: 'POST' } },
    { proofClaims: { htu: 'https://attacker.invalid/v1/me' } },
    { proofClaims: { iat: 1 } },
    { proofClaims: { iat: Math.floor(Date.now() / 1000) + 1000 } },
    { proofClaims: { ath: 'incorrect' } },
    { tokenClaims: { cnf: { jkt: 'incorrect' } } },
    { tokenClaims: { azp: 'wrong-client' } },
    { tokenClaims: { aud: 'wrong-client' } },
    { tokenClaims: { iss: 'https://wrong.invalid' } },
    { tokenClaims: { exp: 1 } },
  ]) {
    const result = await f.request('/v1/me', 'GET', undefined, undefined, undefined, options);
    assert.equal(result.status, 401, JSON.stringify(options));
  }
  const headers = await f.headers('/v1/me', 'GET');
  assert.equal((await fetch(f.origin + '/v1/me', { headers })).status, 200);
  assert.equal((await fetch(f.origin + '/v1/me', { headers })).status, 401);
  assert.equal(
    (await fetch(f.origin + '/v1/me', { headers: { Authorization: headers.Authorization } })).status,
    401,
  );
  assert.equal(
    (
      await fetch(f.origin + '/v1/me', {
        headers: { ...headers, Authorization: headers.Authorization.replace('DPoP ', 'Bearer ') },
      })
    ).status,
    401,
  );
  const validQuery = await f.request('/v1/appointments?limit=1');
  assert.equal(validQuery.status, 200);
  const forgedForward = await f.request('/v1/me', 'GET', undefined, undefined, undefined, {
    headers: { 'X-Forwarded-Host': 'attacker.invalid', 'X-Forwarded-Proto': 'https' },
    proofClaims: { htu: 'https://attacker.invalid/v1/me' },
  });
  assert.equal(forgedForward.status, 401);
});

test('time off preserves patient choice, blocks new bookings and invalidates old reminders', async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const a = await f.request('/v1/appointments', 'POST', body(), undefined, undefined, {
    key: 'timeoff-book-1',
  });
  const off = await f.request(
    `/v1/doctors/${DEMO.doctorA}/time-off`,
    'POST',
    { startsAt: slot(8), endsAt: slot(12) },
    DEMO.doctorUserA,
    'doctor',
    { key: 'timeoff-create-1' },
  );
  assert.equal(off.status, 201);
  assert.equal(off.data.affectedAppointmentCount, 1);
  const affected = await f.request(`/v1/appointments/${a.data.id}`);
  assert.equal(affected.data.startsAt, a.data.startsAt);
  assert.equal(affected.data.disruptionStatus, 'ACTION_REQUIRED');
  assert.equal(
    (
      await f.request('/v1/appointments', 'POST', body(10), f.otherUser, 'patient', {
        key: 'timeoff-block-1',
      })
    ).status,
    409,
  );
  const oldJobs = f.db.all(
    'SELECT * FROM notification_outbox WHERE appointment_id=? AND version=1',
    a.data.id,
  );
  assert.ok(oldJobs.every((j) => j.status === 'INVALIDATED'));
  f.app.get(Notifications).processDue(Date.now() + 86_400_000);
  assert.equal(
    f.db.get(
      "SELECT COUNT(*) AS n FROM notifications WHERE kind='APPOINTMENT_REMINDER' AND appointment_id=?",
      a.data.id,
    )!.n,
    0,
  );
  assert.equal(
    f.db.get(
      "SELECT COUNT(*) AS n FROM notifications WHERE kind='APPOINTMENT_DISRUPTED' AND appointment_id=? AND delivery_status='SIMULATED'",
      a.data.id,
    )!.n,
    1,
  );
  const move = await f.request(
    `/v1/appointments/${a.data.id}/reschedule`,
    'POST',
    { doctorId: DEMO.doctorB, startsAt: slot(14), expectedVersion: 2 },
    undefined,
    undefined,
    { key: 'timeoff-resolve-1' },
  );
  assert.equal(move.data.disruptionStatus, 'NONE');
});

test('record drafts stay private, release is explicit, imported policy metadata cannot approve Tide', async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  assert.equal((await f.request('/v1/records')).data.items.length, 0);
  const draft = await f.request(
    '/v1/records/drafts',
    'POST',
    { appointmentId: DEMO.visit, title: 'Sample encrypted result', kind: 'RESULT' },
    DEMO.doctorUserA,
    'doctor',
  );
  assert.equal(draft.status, 201);
  assert.equal(
    (
      await f.request(
        `/v1/records/${draft.data.id}/release`,
        'POST',
        { expectedVersion: 1 },
        DEMO.doctorUserA,
        'doctor',
      )
    ).status,
    409,
  );
  const payload = {
    ciphertext: Buffer.from('OPAQUE TEST BYTES ONLY — NOT REAL TIDE CIPHERTEXT').toString('base64'),
    encryptionScheme: 'TIDE_RELATIONSHIP_ATTESTATION_V1',
    tags: [draft.data.id],
    expectedVersion: 1,
  };
  assert.equal(
    (await f.request(`/v1/records/${draft.data.id}/content`, 'PUT', payload, DEMO.doctorUserA, 'doctor'))
      .status,
    200,
  );
  const wrongScope = await f.request(
    `/v1/records/${draft.data.id}/policy`,
    'PUT',
    {
      subjectType: 'User',
      subjectId: `fixture-key-${DEMO.patientUser}`,
      policyBytes: testPolicy(DEMO.records[0]),
    },
    DEMO.admins[0],
    'admin',
  );
  assert.equal(wrongScope.status, 400);
  const policy = await f.request(
    `/v1/records/${draft.data.id}/policy`,
    'PUT',
    {
      subjectType: 'User',
      subjectId: `fixture-key-${DEMO.patientUser}`,
      policyBytes: testPolicy(draft.data.id),
    },
    DEMO.admins[0],
    'admin',
  );
  assert.equal(policy.data.grantsAccess, false);
  assert.equal(
    (
      await f.request(
        `/v1/records/${draft.data.id}/release`,
        'POST',
        { expectedVersion: 2 },
        DEMO.doctorUserA,
        'doctor',
      )
    ).data.state,
    'RELEASED',
  );
  const records = await f.request('/v1/records');
  assert.equal(records.data.items.length, 1);
  assert.equal(records.data.items[0].ciphertext, payload.ciphertext);
  assert.equal(
    (
      await f.request(
        `/v1/records/${draft.data.id}/content`,
        'PUT',
        { ...payload, expectedVersion: 3 },
        DEMO.doctorUserA,
        'doctor',
      )
    ).status,
    409,
  );
  await f.request('/v1/appointments', 'POST', body(10, DEMO.doctorB), undefined, undefined, {
    key: 'new-doctor-0001',
  });
  assert.equal(
    (await f.request('/v1/records', 'GET', undefined, DEMO.doctorUserB, 'doctor')).data.items.length,
    1,
  );
  const request = await f.request(`/v1/records/${draft.data.id}/access-requests`, 'POST', {
    doctorId: DEMO.doctorB,
    intent: 'GRANT',
  });
  assert.equal(request.data.status, 'PENDING_TIDE');
  assert.equal(request.data.automaticallyGranted, false);
  const sharing = await f.request('/v1/me/sharing');
  assert.equal(sharing.data.items[0].effectivePermissions, 'UNVERIFIED');
  f.db.run(
    "UPDATE appointments SET status='CANCELLED' WHERE doctor_id=? AND status='CONFIRMED'",
    DEMO.doctorB,
  );
  const revoke = await f.request(`/v1/records/${draft.data.id}/access-requests`, 'POST', {
    doctorId: DEMO.doctorB,
    intent: 'REVOKE',
  });
  assert.equal(revoke.status, 201);
  assert.equal(revoke.data.status, 'PENDING_TIDE');
  const fakeApprove = await f.request(
    `/v1/records/${draft.data.id}/approve`,
    'POST',
    {},
    DEMO.admins[0],
    'admin',
  );
  assert.equal(fakeApprove.status, 404);
});

test('follow-up reuses the previous visit, enforces service/date and prevents duplicates', async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const list = await f.request('/v1/me/follow-ups');
  assert.equal(list.data.length, 1);
  const booking = { ...body(9, DEMO.doctorB, DEMO.followService), followUpId: DEMO.followUp };
  const created = await f.request('/v1/appointments', 'POST', booking, undefined, undefined, {
    key: 'follow-good-1',
  });
  assert.equal(created.status, 201);
  assert.equal(
    (
      await f.request('/v1/appointments', 'POST', { ...booking, startsAt: slot(10) }, undefined, undefined, {
        key: 'follow-duplicate-1',
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.request(
        '/v1/appointments',
        'POST',
        { ...booking, serviceId: DEMO.service },
        undefined,
        undefined,
        { key: 'follow-wrong-1' },
      )
    ).status,
    400,
  );
});

test('family delegation grants booking only after verification and never medical access', async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const request = await f.request('/v1/me/dependents', 'POST', { patientProfileId: f.otherPatient });
  assert.equal(request.data.canBook, false);
  const b = { ...body(), patientProfileId: f.otherPatient };
  assert.equal(
    (await f.request('/v1/appointments', 'POST', b, undefined, undefined, { key: 'delegate-denied-1' }))
      .status,
    404,
  );
  assert.equal(
    (
      await f.request(
        `/v1/delegations/${request.data.id}/verify`,
        'POST',
        {},
        DEMO.receptionist,
        'receptionist',
      )
    ).data.canViewMedicalRecord,
    false,
  );
  assert.equal(
    (await f.request('/v1/appointments', 'POST', b, undefined, undefined, { key: 'delegate-allowed-1' }))
      .status,
    201,
  );
  assert.equal((await f.request('/v1/me/dependents')).data[0].canBook, true);
});

test('check-in code is single-use and visit transitions require the assigned clinician', async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const now = Date.now();
  const id = randomUUID();
  f.db.run(
    'INSERT INTO appointments(id,clinic_id,patient_id,doctor_id,service_id,start_ms,end_ms,status,source,booked_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
    id,
    DEMO.clinic,
    DEMO.patient,
    DEMO.doctorA,
    DEMO.service,
    now + 60000,
    now + 1860000,
    'CONFIRMED',
    'WEB',
    DEMO.patientUser,
    now,
    now,
  );
  const code = await f.request(`/v1/appointments/${id}/check-in-code`, 'POST', {});
  assert.equal(code.status, 201);
  const scan = await f.request(
    '/v1/check-ins/scan',
    'POST',
    { code: code.data.code },
    DEMO.receptionist,
    'receptionist',
    { key: 'qr-scan-0001' },
  );
  assert.equal(scan.data.status, 'CHECKED_IN');
  assert.equal(
    (
      await f.request(
        '/v1/check-ins/scan',
        'POST',
        { code: code.data.code },
        DEMO.receptionist,
        'receptionist',
        { key: 'qr-scan-0002' },
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await f.request(`/v1/appointments/${id}/cancel`, 'POST', { expectedVersion: 2 }, undefined, undefined, {
        key: 'aftercheckin-cancel',
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.request(
        `/v1/appointments/${id}/start`,
        'POST',
        { expectedVersion: 2 },
        DEMO.receptionist,
        'receptionist',
        { key: 'start-denied-1' },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await f.request(
        `/v1/appointments/${id}/start`,
        'POST',
        { expectedVersion: 2 },
        DEMO.doctorUserA,
        'doctor',
        { key: 'start-allowed-1' },
      )
    ).data.status,
    'IN_PROGRESS',
  );
  assert.equal(
    (
      await f.request(
        `/v1/appointments/${id}/complete`,
        'POST',
        { expectedVersion: 3 },
        DEMO.doctorUserA,
        'doctor',
        { key: 'complete-allowed-1' },
      )
    ).data.status,
    'COMPLETED',
  );
});
