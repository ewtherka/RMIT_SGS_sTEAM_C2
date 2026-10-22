import { Controller, Get, Inject, Injectable, Param, ParseUUIDPipe, Post, Req, type OnModuleInit } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { z } from 'zod';
import { CONFIG, type AppConfig } from './config.js';
import { Database } from './database.js';
import { ApiError, conflict, missing } from './errors.js';
import { Public, hasRole, requireRole, type AuthRequest, type Principal } from './auth/auth.js';
import { Access } from './identity.js';
import { DEMO } from './seed.js';
import * as S from './schemas.js';

// SIMULATED TideCloak. The competition allows simulating sign-in, roles and access checks; every response
// produced here is labelled SIMULATED. Token claims mirror a TideCloak access token (realm_access.roles,
// tideuserkey, azp/aud) so strict mode can replace this module without touching business code.
export const SIM_LABEL = 'SIMULATED_TIDECLOAK';
export const QUORUM = { threshold: 2, of: DEMO.admins.length };
const CLIENT = 'careflow-client';
const SCHEME = 'SIMULATED_TIDE_E2EE_AES256GCM';
const SIM_ROLES: Record<string, string[]> = {
  [DEMO.patientUser]: ['careflow-patient'],
  [DEMO.doctorUserA]: ['careflow-doctor'],
  [DEMO.doctorUserB]: ['careflow-doctor'],
  [DEMO.receptionist]: ['careflow-receptionist'],
  ...Object.fromEntries(DEMO.admins.map((id) => [id, ['careflow-admin']])),
};
const SAMPLE_PLAINTEXT = [
  'Kết quả mẫu (dữ liệu giả): huyết áp 118/76 mmHg, đường huyết lúc đói 5,1 mmol/L. Không có bất thường.',
  'Lời dặn mẫu (dữ liệu giả): uống đủ nước, tái khám sau 2 tuần để theo dõi.',
];

@Injectable()
export class SimTide implements OnModuleInit {
  private readonly secret: Buffer;
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(Database) private readonly db: Database,
  ) {
    this.secret = this.loadSecret();
  }
  get enabled() {
    return this.config.tideMode === 'simulated';
  }
  get issuer() {
    return `${this.config.publicUrl}/sim-tidecloak/realms/${this.config.realm}`;
  }
  private loadSecret() {
    if (this.config.tideMode !== 'simulated') return Buffer.alloc(0);
    if (!existsSync(this.config.simSecretPath)) {
      mkdirSync(dirname(this.config.simSecretPath), { recursive: true });
      writeFileSync(this.config.simSecretPath, randomBytes(32).toString('base64'), { mode: 0o600 });
    }
    return Buffer.from(readFileSync(this.config.simSecretPath, 'utf8').trim(), 'base64');
  }
  private derive(label: string) {
    return createHmac('sha256', this.secret).update(label).digest();
  }
  onModuleInit() {
    if (!this.enabled) return;
    this.db.sql.exec(`
      CREATE TABLE IF NOT EXISTS sim_approvals(request_id TEXT NOT NULL REFERENCES access_requests(id),admin_id TEXT NOT NULL REFERENCES users(id),created_at INTEGER NOT NULL,PRIMARY KEY(request_id,admin_id));
      CREATE TABLE IF NOT EXISTS sim_grants(record_id TEXT NOT NULL REFERENCES records(id),doctor_id TEXT NOT NULL REFERENCES doctors(id),granted_at INTEGER NOT NULL,PRIMARY KEY(record_id,doctor_id));`);
    // Seed records start as DRAFT without ciphertext. Simulated Tide encrypts and releases them once.
    DEMO.records.forEach((id, i) => {
      const r = this.db.get('SELECT * FROM records WHERE id=?', id);
      if (!r || r.ciphertext) return;
      this.db.run(
        "UPDATE records SET ciphertext=?,encryption_scheme=?,state='RELEASED',released_at=?,version=version+1,title=REPLACE(title,' — chờ mã hóa','') WHERE id=?",
        this.encrypt(id, SAMPLE_PLAINTEXT[i] ?? SAMPLE_PLAINTEXT[0]),
        SCHEME,
        Date.now(),
        id,
      );
    });
    this.db.run("UPDATE records SET title=REPLACE(title,' — chờ mã hóa','') WHERE encryption_scheme=?", SCHEME);
  }
  ensure() {
    if (!this.enabled) missing();
  }
  identities() {
    this.ensure();
    return Object.entries(SIM_ROLES).map(([userId, roles]) => ({
      userId,
      displayName: this.db.get('SELECT display_name FROM users WHERE id=?', userId)?.display_name ?? null,
      roles,
    }));
  }
  async session(userId: string) {
    this.ensure();
    const roles = SIM_ROLES[userId];
    if (!roles || !this.db.get('SELECT 1 FROM users WHERE id=?', userId))
      throw new ApiError(404, 'SIM_IDENTITY_NOT_FOUND', 'Không có danh tính mô phỏng này. Chạy npm run seed.');
    const accessToken = await new SignJWT({
      azp: CLIENT,
      realm_access: { roles },
      tideuserkey: `sim-tuk-${userId}`,
      groups: [],
      sim: true,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(this.issuer)
      .setAudience(CLIENT)
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime('8h')
      .sign(this.derive('token'));
    return { mode: 'SIMULATED', label: SIM_LABEL, tokenType: 'Bearer', accessToken, expiresIn: 28800, userId, roles };
  }
  async verify(token: string): Promise<JWTPayload> {
    const { payload } = await jwtVerify(token, this.derive('token'), {
      issuer: this.issuer,
      audience: CLIENT,
      algorithms: ['HS256'],
    });
    if (payload.azp !== CLIENT || typeof payload.sub !== 'string') throw Error('Invalid simulated token');
    return payload;
  }
  encrypt(recordId: string, plaintext: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.derive(`record:${recordId}`), iv);
    cipher.setAAD(Buffer.from(recordId));
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
  }
  decrypt(recordId: string, ciphertext: string) {
    const raw = Buffer.from(ciphertext, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.derive(`record:${recordId}`), raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(recordId));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  }
}

// Simulated Tide Fabric decisions: quorum-approved access changes and policy-gated decryption.
@Injectable()
export class SimFabric {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(Access) private readonly access: Access,
    @Inject(SimTide) private readonly tide: SimTide,
  ) {}
  private presentRequest(x: any) {
    const approvals = this.db
      .all(
        'SELECT s.admin_id AS adminId,u.display_name AS displayName,s.created_at AS approvedAt FROM sim_approvals s JOIN users u ON u.id=s.admin_id WHERE s.request_id=? ORDER BY s.created_at',
        x.id,
      )
      .map((a) => ({ ...a, approvedAt: new Date(a.approvedAt).toISOString() }));
    return {
      id: x.id,
      recordId: x.record_id,
      recordTitle: x.title,
      doctorId: x.doctor_id,
      doctorName: x.doctor_name,
      intent: x.intent,
      status: x.status,
      approvals,
      quorum: { ...QUORUM, reached: approvals.length >= QUORUM.threshold },
      createdAt: new Date(x.created_at).toISOString(),
      enforcedBy: SIM_LABEL,
    };
  }
  private requestRow(id: string) {
    return this.db.get(
      'SELECT q.*,r.title,r.clinic_id,d.display_name AS doctor_name FROM access_requests q JOIN records r ON r.id=q.record_id JOIN doctors d ON d.id=q.doctor_id WHERE q.id=?',
      id,
    );
  }
  pending(p: Principal) {
    this.tide.ensure();
    requireRole(p, 'admin');
    const u = this.access.user(p);
    return {
      quorum: QUORUM,
      items: this.db
        .all(
          "SELECT q.*,r.title,d.display_name AS doctor_name FROM access_requests q JOIN records r ON r.id=q.record_id JOIN doctors d ON d.id=q.doctor_id WHERE q.status='PENDING_TIDE' AND EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=? AND m.clinic_id=r.clinic_id) ORDER BY q.created_at",
          u.id,
        )
        .map((x) => this.presentRequest(x)),
    };
  }
  approve(p: Principal, requestId: string) {
    this.tide.ensure();
    requireRole(p, 'admin');
    return this.db.transaction(() => {
      const q = this.requestRow(requestId) ?? missing();
      this.access.clinic(p, q.clinic_id);
      if (q.status !== 'PENDING_TIDE') conflict('REQUEST_CLOSED', 'Yêu cầu đã được Tide xử lý.');
      if (this.db.get('SELECT 1 FROM sim_approvals WHERE request_id=? AND admin_id=?', requestId, p.user!.id))
        conflict('ALREADY_APPROVED', 'Mỗi admin chỉ phê duyệt một lần; cần admin độc lập khác.');
      this.db.run('INSERT INTO sim_approvals VALUES(?,?,?)', requestId, p.user!.id, Date.now());
      this.db.audit(p.user!.id, q.clinic_id, 'SIM_TIDE_APPROVAL', requestId);
      const count = Number(this.db.get('SELECT COUNT(*) AS n FROM sim_approvals WHERE request_id=?', requestId)!.n);
      if (count >= QUORUM.threshold) {
        if (q.intent === 'GRANT')
          this.db.run(
            'INSERT INTO sim_grants VALUES(?,?,?) ON CONFLICT DO NOTHING',
            q.record_id,
            q.doctor_id,
            Date.now(),
          );
        else this.db.run('DELETE FROM sim_grants WHERE record_id=? AND doctor_id=?', q.record_id, q.doctor_id);
        this.db.run("UPDATE access_requests SET status='COMMITTED' WHERE id=?", requestId);
        this.db.audit(p.user!.id, q.clinic_id, 'SIM_TIDE_QUORUM_COMMITTED', requestId, { intent: q.intent });
      }
      return this.presentRequest(this.requestRow(requestId));
    });
  }
  // Who may decrypt: the patient (User policy), the authoring doctor, or a doctor granted by quorum.
  private decision(p: Principal, recordId: string) {
    const u = this.access.user(p);
    const r = this.db.get('SELECT * FROM records WHERE id=?', recordId) ?? missing();
    this.access.clinic(p, r.clinic_id);
    const patient =
      hasRole(p, 'patient') && Boolean(this.db.get('SELECT 1 FROM patients WHERE id=? AND user_id=?', r.patient_id, u.id));
    const doctor = hasRole(p, 'doctor') ? this.db.get('SELECT id FROM doctors WHERE user_id=?', u.id) : undefined;
    const author = Boolean(doctor) && r.author_id === u.id;
    const granted =
      Boolean(doctor) && Boolean(this.db.get('SELECT 1 FROM sim_grants WHERE record_id=? AND doctor_id=?', r.id, doctor!.id));
    const reason = patient ? 'PATIENT_USER_POLICY' : author ? 'AUTHOR_CARE_TEAM' : granted ? 'QUORUM_GRANT' : null;
    return { r, reason };
  }
  decrypt(p: Principal, recordId: string) {
    this.tide.ensure();
    const { r, reason } = this.decision(p, recordId);
    if (r.state !== 'RELEASED' || !r.ciphertext) missing();
    if (!reason)
      throw new ApiError(
        403,
        'TIDE_POLICY_DENIED',
        'Mạng Tide (mô phỏng) từ chối giải mã: chưa có quyền được ≥2 admin độc lập phê duyệt.',
      );
    this.db.audit(p.user!.id, r.clinic_id, 'SIM_TIDE_DECRYPT', r.id, { reason });
    return { recordId: r.id, plaintext: this.tide.decrypt(r.id, r.ciphertext), allowedBy: reason, enforcedBy: SIM_LABEL };
  }
  status(p: Principal, recordId: string) {
    this.tide.ensure();
    const { r, reason } = this.decision(p, recordId);
    const requests = this.db
      .all(
        'SELECT q.*,r.title,d.display_name AS doctor_name FROM access_requests q JOIN records r ON r.id=q.record_id JOIN doctors d ON d.id=q.doctor_id WHERE q.record_id=? ORDER BY q.created_at DESC LIMIT 50',
        r.id,
      )
      .map((x) => this.presentRequest(x));
    return {
      recordId: r.id,
      canDecrypt: Boolean(reason) && r.state === 'RELEASED',
      allowedBy: reason,
      grantedDoctorIds: this.db.all('SELECT doctor_id FROM sim_grants WHERE record_id=?', r.id).map((x) => x.doctor_id),
      requests: hasRole(p, 'patient', 'admin') ? requests : [],
      quorum: QUORUM,
      enforcedBy: SIM_LABEL,
    };
  }
}

const sessionInput = z.object({ userId: S.uuid }).strict();
const Id = () => Param('id', new ParseUUIDPipe({ version: '4' }));

@ApiTags('Simulated TideCloak')
@Controller('v1/sim')
export class SimController {
  constructor(
    @Inject(SimTide) private readonly tide: SimTide,
    @Inject(SimFabric) private readonly fabric: SimFabric,
  ) {}
  @Public()
  @Get('identities')
  @ApiOperation({ summary: 'SIMULATED: demo identities available for simulated TideCloak sign-in' })
  identities() {
    return this.tide.identities();
  }
  @Public()
  @Post('session')
  @ApiOperation({ summary: 'SIMULATED: sign in as a seeded identity; returns a TideCloak-shaped Bearer token' })
  @S.DocumentBody(sessionInput)
  session(@S.BodySchema(sessionInput) b: any) {
    return this.tide.session(b.userId);
  }
  @Get('approvals')
  @ApiOperation({ summary: 'SIMULATED: admin views access changes waiting for quorum' })
  approvals(@Req() r: AuthRequest) {
    return this.fabric.pending(r.principal);
  }
  @Post('approvals/:id/approve')
  @ApiOperation({ summary: 'SIMULATED: one independent admin approval; quorum 2 of 3 commits the change' })
  approve(@Req() r: AuthRequest, @Id() id: string) {
    return this.fabric.approve(r.principal, id);
  }
  @Get('records/:id/access')
  @ApiOperation({ summary: 'SIMULATED: whether the caller can decrypt, plus quorum state of requests' })
  access(@Req() r: AuthRequest, @Id() id: string) {
    return this.fabric.status(r.principal, id);
  }
  @Post('records/:id/decrypt')
  @ApiOperation({ summary: 'SIMULATED: Tide Fabric decrypts only when policy allows; otherwise 403 TIDE_POLICY_DENIED' })
  decrypt(@Req() r: AuthRequest, @Id() id: string) {
    return this.fabric.decrypt(r.principal, id);
  }
}
