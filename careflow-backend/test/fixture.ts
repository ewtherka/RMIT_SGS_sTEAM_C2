import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { generateKeyPair, exportJWK, calculateJwkThumbprint, SignJWT } from 'jose';
import { DateTime } from 'luxon';
import { createApp } from '../src/app.js';
import { Database } from '../src/database.js';
import { seed, DEMO } from '../src/seed.js';
import { Policy, ApprovalType, ExecutionType } from '../src/vendor/tide-policy.js';

export const issuer = 'https://careflow-fixture.invalid/realms/test';
export const client = 'test-client';
export const publicUrl = 'http://localhost:3333';
export const day = () => DateTime.now().setZone('Asia/Ho_Chi_Minh').plus({ days: 2 }).toISODate()!;
export const slot = (hour = 9, minute = 0) =>
  DateTime.fromISO(day(), { zone: 'Asia/Ho_Chi_Minh' }).set({ hour, minute }).toISO()!;
export const body = (hour = 9, doctorId = DEMO.doctorA, serviceId = DEMO.service) => ({
  doctorId,
  serviceId,
  startsAt: slot(hour),
});
export function testPolicy(
  recordId: string,
  subjectId = `fixture-key-${DEMO.patientUser}`,
  subjectType = 'User',
) {
  const policy = new Policy({
    version: Policy.latestVersion,
    contractId: 'RelationshipAttestation:1',
    modelId: ['PolicyEnabledEncryption:1', 'PolicyEnabledDecryption:1'],
    keyId: 'fixture-vendor-not-real',
    approvalType: ApprovalType.IMPLICIT,
    executionType: ExecutionType.PRIVATE,
    params: new Map([
      ['subjectType', subjectType],
      ['subjectId', subjectId],
      ['assignmentId', recordId],
      ['roles', JSON.stringify(['_tide_encryptor', '_tide_decryptor'])],
    ]),
  });
  policy.signature = new Uint8Array(64).fill(1); // Fixture bytes, deliberately NOT a valid network signature.
  return Buffer.from(policy.toBytes()).toString('base64');
}

export async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'careflow-test-'));
  const realmKeys = await generateKeyPair('EdDSA');
  const realmPublic = { ...(await exportJWK(realmKeys.publicKey)), kid: 'fixture', alg: 'EdDSA' };
  const proofKeys = await generateKeyPair('ES256');
  const proofPublic = await exportJWK(proofKeys.publicKey);
  const jkt = await calculateJwkThumbprint(proofPublic);
  const adapterPath = join(root, 'adapter.json');
  writeFileSync(
    adapterPath,
    JSON.stringify({
      realm: 'test',
      resource: client,
      'auth-server-url': 'https://careflow-fixture.invalid',
      vendorId: 'fixture-vendor-not-real',
      jwk: { keys: [realmPublic] },
    }),
  );
  const { app, config } = await createApp({
    databasePath: join(root, 'db.sqlite'),
    adapterPath,
    publicUrl,
    startWorker: false,
    qrKey: 'q'.repeat(48),
    port: 0,
    tideMode: 'strict', // independent of a local .env that enables simulated mode
  });
  const db = app.get(Database);
  seed(db);
  db.run('UPDATE users SET issuer=?,subject=id', issuer);
  const otherUser = randomUUID(),
    otherPatient = randomUUID();
  db.run(
    'INSERT INTO users(id,issuer,subject,display_name,created_at) VALUES(?,?,?,?,?)',
    otherUser,
    issuer,
    otherUser,
    'Another fake patient',
    Date.now(),
  );
  db.run('INSERT INTO memberships VALUES(?,?)', otherUser, DEMO.clinic);
  db.run(
    'INSERT INTO patients(id,clinic_id,user_id,display_name,created_at) VALUES(?,?,?,?,?)',
    otherPatient,
    DEMO.clinic,
    otherUser,
    'Another fake patient',
    Date.now(),
  );
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  const origin = `http://127.0.0.1:${address.port}`;
  async function token(user = DEMO.patientUser, role = 'patient', extra: Record<string, unknown> = {}) {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      iss: issuer,
      sub: user,
      aud: client,
      iat: now,
      exp: now + 600,
      azp: client,
      realm_access: { roles: [`careflow-${role}`] },
      tideuserkey: `fixture-key-${user}`,
      cnf: { jkt },
      ...extra,
    })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'fixture' })
      .sign(realmKeys.privateKey);
  }
  async function headers(
    path: string,
    method: string,
    user = DEMO.patientUser,
    role = 'patient',
    options: any = {},
  ) {
    const accessToken = options.token ?? (await token(user, role, options.tokenClaims ?? {}));
    const proof = await new SignJWT({
      jti: randomUUID(),
      htm: method,
      htu: new URL(path, publicUrl).origin + new URL(path, publicUrl).pathname,
      iat: Math.floor(Date.now() / 1000),
      ath: createHash('sha256').update(accessToken).digest('base64url'),
      ...options.proofClaims,
    })
      .setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk: proofPublic })
      .sign(proofKeys.privateKey);
    return {
      Authorization: `DPoP ${accessToken}`,
      DPoP: proof,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    };
  }
  async function request(
    path: string,
    method = 'GET',
    payload?: unknown,
    user = DEMO.patientUser,
    role = 'patient',
    options: any = {},
  ) {
    const h = await headers(path, method, user, role, options);
    const response = await fetch(origin + path, {
      method,
      headers: { ...h, ...(options.key ? { 'Idempotency-Key': options.key } : {}), ...options.headers },
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
    });
    return { status: response.status, data: (await response.json()) as any, headers: response.headers };
  }
  return {
    app,
    config,
    db,
    root,
    origin,
    request,
    headers,
    token,
    otherUser,
    otherPatient,
    close: async () => {
      await app.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
