import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Database, type Row } from './database.js';
import { ApiError, forbidden, missing, conflict } from './errors.js';
import { hasRole, requireRole, type Principal } from './auth/auth.js';

@Injectable()
export class Access {
  constructor(@Inject(Database) readonly db: Database) {}
  user(p: Principal): Row {
    if (!p.user)
      throw new ApiError(409, 'ONBOARDING_REQUIRED', 'Cần tạo hoặc liên kết hồ sơ tài khoản trước.');
    return p.user;
  }
  clinic(p: Principal, clinicId: string) {
    const u = this.user(p);
    if (!this.db.get('SELECT 1 FROM memberships WHERE user_id=? AND clinic_id=?', u.id, clinicId)) missing();
  }
  staff(p: Principal, clinicId: string, ...roles: string[]) {
    requireRole(p, ...roles);
    this.clinic(p, clinicId);
  }
  ownPatient(p: Principal): Row {
    requireRole(p, 'patient');
    const u = this.user(p);
    return this.db.get('SELECT * FROM patients WHERE user_id=?', u.id) ?? missing();
  }
  canBookFor(p: Principal, patientId: string): Row {
    const u = this.user(p);
    const patient = this.db.get('SELECT * FROM patients WHERE id=?', patientId) ?? missing();
    this.clinic(p, patient.clinic_id);
    if (hasRole(p, 'patient') && patient.user_id === u.id) return patient;
    if (hasRole(p, 'receptionist', 'admin')) return patient;
    if (
      hasRole(p, 'patient') &&
      this.db.get(
        'SELECT 1 FROM delegations WHERE patient_id=? AND delegate_user_id=? AND status=? AND can_book=1',
        patientId,
        u.id,
        'VERIFIED',
      )
    )
      return patient;
    return missing();
  }
  appointment(p: Principal, id: string, clinical = false): Row {
    const u = this.user(p);
    const a =
      this.db.get(
        'SELECT a.*,p.user_id AS patient_user_id,d.user_id AS doctor_user_id FROM appointments a JOIN patients p ON p.id=a.patient_id JOIN doctors d ON d.id=a.doctor_id WHERE a.id=?',
        id,
      ) ?? missing();
    this.clinic(p, a.clinic_id);
    if (hasRole(p, 'patient') && a.patient_user_id === u.id) return a;
    if (hasRole(p, 'doctor') && a.doctor_user_id === u.id) return a;
    if (!clinical && hasRole(p, 'receptionist', 'admin')) return a;
    if (
      !clinical &&
      hasRole(p, 'patient') &&
      this.db.get(
        'SELECT 1 FROM delegations WHERE patient_id=? AND delegate_user_id=? AND status=? AND can_book=1',
        a.patient_id,
        u.id,
        'VERIFIED',
      )
    )
      return a;
    return missing();
  }
  doctor(p: Principal, doctorId: string): Row {
    const d = this.db.get('SELECT * FROM doctors WHERE id=?', doctorId) ?? missing();
    this.clinic(p, d.clinic_id);
    if (hasRole(p, 'doctor') && d.user_id === this.user(p).id) return d;
    if (hasRole(p, 'receptionist', 'admin')) return d;
    return missing();
  }
}

@Injectable()
export class Identity {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(Access) private readonly access: Access,
  ) {}
  me(p: Principal) {
    if (!p.user) return { onboardingRequired: true, roles: p.roles };
    return {
      onboardingRequired: false,
      id: p.user.id,
      displayName: p.user.display_name,
      email: p.user.email,
      phone: p.user.phone,
      roles: p.roles,
      patientProfileId: this.db.get('SELECT id FROM patients WHERE user_id=?', p.user.id)?.id ?? null,
      clinicIds: this.db
        .all('SELECT clinic_id FROM memberships WHERE user_id=?', p.user.id)
        .map((x) => x.clinic_id),
    };
  }
  onboard(p: Principal, b: any) {
    requireRole(p, 'patient');
    return this.db.transaction(() => {
      if (this.db.get('SELECT 1 FROM users WHERE issuer=? AND subject=?', p.issuer, p.subject))
        conflict('ALREADY_ENROLLED', 'Tài khoản đã có hồ sơ.');
      if (!this.db.get('SELECT 1 FROM clinics WHERE id=?', b.clinicId)) missing();
      const userId = randomUUID();
      const patientId = randomUUID();
      this.db.run(
        'INSERT INTO users(id,issuer,subject,display_name,email,phone,created_at,tide_user_key) VALUES(?,?,?,?,?,?,?,?)',
        userId,
        p.issuer,
        p.subject,
        b.displayName,
        b.email ?? null,
        b.phone ?? null,
        Date.now(),
        p.tideUserKey ?? null,
      );
      this.db.run('INSERT INTO memberships(user_id,clinic_id) VALUES(?,?)', userId, b.clinicId);
      this.db.run(
        'INSERT INTO patients(id,clinic_id,user_id,display_name,dob,phone,created_at) VALUES(?,?,?,?,?,?,?)',
        patientId,
        b.clinicId,
        userId,
        b.displayName,
        b.dateOfBirth ?? null,
        b.phone ?? null,
        Date.now(),
      );
      this.db.audit(userId, b.clinicId, 'PATIENT_ENROLLED', patientId);
      return { userId, patientProfileId: patientId, clinicId: b.clinicId };
    });
  }
  patch(p: Principal, b: any) {
    const u = this.access.user(p);
    this.db.transaction(() => {
      this.db.run(
        'UPDATE users SET display_name=?,phone=?,email=? WHERE id=?',
        b.displayName ?? u.display_name,
        b.phone ?? u.phone,
        b.email ?? u.email,
        u.id,
      );
      this.db.run(
        'UPDATE patients SET display_name=?,phone=? WHERE user_id=?',
        b.displayName ?? u.display_name,
        b.phone ?? u.phone,
        u.id,
      );
    });
    return this.me({
      ...p,
      user: this.db.get('SELECT id,display_name,email,phone FROM users WHERE id=?', u.id),
    });
  }
  patients(p: Principal, q: any) {
    this.access.staff(p, q.clinicId, 'receptionist', 'admin');
    const needle = `%${(q.q ?? '').replace(/[\\%_]/g, '\\$&')}%`;
    return this.db.all(
      "SELECT id,display_name AS displayName,dob AS dateOfBirth,phone FROM patients WHERE clinic_id=? AND (display_name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\') ORDER BY display_name LIMIT ? OFFSET ?",
      q.clinicId,
      needle,
      needle,
      q.limit,
      q.offset,
    );
  }
  createPatient(p: Principal, b: any) {
    this.access.staff(p, b.clinicId, 'receptionist', 'admin');
    const id = randomUUID();
    this.db.transaction(() => {
      this.db.run(
        'INSERT INTO patients(id,clinic_id,display_name,dob,phone,created_at) VALUES(?,?,?,?,?,?)',
        id,
        b.clinicId,
        b.displayName,
        b.dateOfBirth ?? null,
        b.phone ?? null,
        Date.now(),
      );
      this.db.audit(p.user!.id, b.clinicId, 'PATIENT_PROFILE_CREATED', id);
    });
    return { id, clinicId: b.clinicId, displayName: b.displayName, linkedAccount: false };
  }
  dependents(p: Principal) {
    requireRole(p, 'patient');
    const u = this.access.user(p);
    return this.db
      .all(
        'SELECT d.id,d.patient_id AS patientProfileId,p.display_name AS displayName,d.status,d.can_book AS canBook FROM delegations d JOIN patients p ON p.id=d.patient_id WHERE d.delegate_user_id=?',
        u.id,
      )
      .map((x) => ({ ...x, canBook: Boolean(x.canBook), canViewMedicalRecord: false }));
  }
  requestDelegation(p: Principal, b: any) {
    requireRole(p, 'patient');
    const u = this.access.user(p);
    const patient = this.db.get('SELECT * FROM patients WHERE id=?', b.patientProfileId) ?? missing();
    this.access.clinic(p, patient.clinic_id);
    if (patient.user_id === u.id) conflict('OWN_PROFILE', 'Đây đã là hồ sơ của bạn.');
    const id = randomUUID();
    this.db.run(
      'INSERT INTO delegations(id,clinic_id,patient_id,delegate_user_id,created_at) VALUES(?,?,?,?,?)',
      id,
      patient.clinic_id,
      patient.id,
      u.id,
      Date.now(),
    );
    return { id, status: 'PENDING', canBook: false, canViewMedicalRecord: false };
  }
  verifyDelegation(p: Principal, id: string) {
    const d = this.db.get('SELECT * FROM delegations WHERE id=?', id) ?? missing();
    this.access.staff(p, d.clinic_id, 'receptionist', 'admin');
    this.db.transaction(() => {
      this.db.run(
        'UPDATE delegations SET status=?,can_book=1,verified_by=? WHERE id=?',
        'VERIFIED',
        p.user!.id,
        id,
      );
      this.db.audit(p.user!.id, d.clinic_id, 'DELEGATION_BOOKING_VERIFIED', id);
    });
    return {
      id,
      status: 'VERIFIED',
      canBook: true,
      canViewMedicalRecord: false,
      note: 'Chỉ xác nhận sau khi đã kiểm tra ủy quyền ngoài ứng dụng. Quyền bệnh án vẫn do Tide quyết định.',
    };
  }
}
