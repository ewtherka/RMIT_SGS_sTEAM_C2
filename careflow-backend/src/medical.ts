import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { Database, type Row } from './database.js';
import { Access } from './identity.js';
import { Bookings } from './bookings.js';
import { hasRole, requireRole, type Principal } from './auth/auth.js';
import { bad, conflict, forbidden, missing } from './errors.js';
import { isoTime, ZONE, dateRange } from './scheduling.js';
import { CONFIG, type AppConfig } from './config.js';
import { careGroup, validatePolicy } from './policies.js';

@Injectable()
export class Medical {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(Access) private readonly access: Access,
    @Inject(Bookings) private readonly bookings: Bookings,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}
  private record(p: Principal, id: string, allowDraft = false) {
    const r = this.db.get('SELECT * FROM records WHERE id=?', id) ?? missing();
    const u = this.access.user(p);
    this.access.clinic(p, r.clinic_id);
    const a = this.db.get(
      'SELECT a.*,pt.user_id AS patient_user_id,d.user_id AS doctor_user_id FROM appointments a JOIN patients pt ON pt.id=a.patient_id JOIN doctors d ON d.id=a.doctor_id WHERE a.id=?',
      r.appointment_id,
    )!;
    const patient = hasRole(p, 'patient') && a.patient_user_id === u.id;
    const doctor =
      hasRole(p, 'doctor') &&
      (a.doctor_user_id === u.id ||
        Boolean(
          this.db.get(
            "SELECT 1 FROM appointments v JOIN doctors d ON d.id=v.doctor_id WHERE v.patient_id=? AND v.clinic_id=? AND d.user_id=? AND v.status IN ('CONFIRMED','CHECKED_IN','IN_PROGRESS')",
            r.patient_id,
            r.clinic_id,
            u.id,
          ),
        ));
    if (!patient && !doctor) missing();
    if (
      r.state !== 'RELEASED' &&
      !(doctor && a.doctor_user_id === u.id) &&
      !(patient && allowDraft && r.kind === 'PATIENT_DOCUMENT' && r.author_id === u.id)
    )
      missing();
    return { r, a };
  }
  private presentation(r: Row) {
    return {
      id: r.id,
      appointmentId: r.appointment_id,
      title: r.title,
      kind: r.kind,
      state: r.state,
      version: r.version,
      ciphertext: r.ciphertext,
      encryptionScheme: r.encryption_scheme,
      tags: [r.id],
      encryptionStatus: r.ciphertext ? 'CLIENT_SUPPLIED_CIPHERTEXT' : 'AWAITING_CLIENT_ENCRYPTION',
      policyVerification: 'TIDE_NETWORK_REQUIRED',
      createdAt: isoTime(r.created_at),
      releasedAt: r.released_at ? isoTime(r.released_at) : null,
    };
  }
  list(p: Principal, q: any) {
    const u = this.access.user(p);
    const rows = this.db.all(
      `SELECT r.* FROM records r JOIN appointments a ON a.id=r.appointment_id JOIN patients pt ON pt.id=r.patient_id JOIN doctors d ON d.id=a.doctor_id
      WHERE EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=? AND m.clinic_id=r.clinic_id)
      AND ((?=1 AND pt.user_id=? AND (r.state='RELEASED' OR (r.kind='PATIENT_DOCUMENT' AND r.author_id=?))) OR (?=1 AND (d.user_id=? OR (r.state='RELEASED' AND EXISTS(SELECT 1 FROM appointments v JOIN doctors vd ON vd.id=v.doctor_id WHERE v.patient_id=r.patient_id AND v.clinic_id=r.clinic_id AND vd.user_id=? AND v.status IN ('CONFIRMED','CHECKED_IN','IN_PROGRESS'))))))
      AND (? IS NULL OR r.appointment_id=?) ORDER BY r.created_at DESC,r.id LIMIT ? OFFSET ?`,
      u.id,
      Number(hasRole(p, 'patient')),
      u.id,
      u.id,
      Number(hasRole(p, 'doctor')),
      u.id,
      u.id,
      q.appointmentId ?? null,
      q.appointmentId ?? null,
      q.limit,
      q.offset,
    );
    return { items: rows.map((r) => this.presentation(r)), limit: q.limit, offset: q.offset };
  }
  private allowedAuthor(p: Principal, a: Row, kind: string) {
    if (kind === 'PATIENT_DOCUMENT') {
      requireRole(p, 'patient');
      if (a.patient_user_id !== p.user!.id) forbidden();
    } else {
      requireRole(p, 'doctor');
      if (a.doctor_user_id !== p.user!.id) forbidden();
      if (!['IN_PROGRESS', 'COMPLETED'].includes(a.status))
        conflict('VISIT_NOT_STARTED', 'Bác sĩ chỉ tạo kết quả/lời dặn khi đã bắt đầu khám.');
    }
  }
  create(p: Principal, b: any, draft = false) {
    const a = this.access.appointment(p, b.appointmentId, true);
    this.allowedAuthor(p, a, b.kind);
    const id = draft ? randomUUID() : b.recordId;
    if (!draft && b.tags[0] !== id) bad('TAG_MISMATCH', 'Tide tag phải bằng duy nhất recordId.');
    this.db.transaction(() => {
      this.db.run(
        'INSERT INTO records(id,clinic_id,patient_id,appointment_id,author_id,title,kind,ciphertext,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
        id,
        a.clinic_id,
        a.patient_id,
        a.id,
        p.user!.id,
        b.title,
        b.kind,
        draft ? null : b.ciphertext,
        Date.now(),
      );
      this.db.audit(p.user!.id, a.clinic_id, 'RECORD_DRAFT_CREATED', id);
    });
    return this.presentation(this.db.get('SELECT * FROM records WHERE id=?', id)!);
  }
  content(p: Principal, id: string, b: any) {
    return this.db.transaction(() => {
      const { r, a } = this.record(p, id, true);
      this.allowedAuthor(p, a, r.kind);
      if (r.author_id !== p.user!.id) forbidden();
      if (r.state !== 'DRAFT')
        conflict('RECORD_IMMUTABLE', 'Hồ sơ đã công bố; hãy tạo tài liệu bổ sung thay vì sửa bản cũ.');
      if (r.version !== b.expectedVersion) conflict('VERSION_CONFLICT', 'Hồ sơ đã thay đổi.');
      if (b.tags[0] !== id) bad('TAG_MISMATCH', 'Tide tag phải bằng duy nhất recordId.');
      this.db.run('UPDATE records SET ciphertext=?,version=version+1 WHERE id=?', b.ciphertext, id);
      this.db.audit(p.user!.id, r.clinic_id, 'CIPHERTEXT_UPLOADED', id);
      return this.presentation(this.db.get('SELECT * FROM records WHERE id=?', id)!);
    });
  }
  release(p: Principal, id: string, b: any) {
    return this.db.transaction(() => {
      const { r, a } = this.record(p, id, true);
      this.allowedAuthor(p, a, r.kind);
      if (r.author_id !== p.user!.id) forbidden();
      if (r.state !== 'DRAFT' || r.version !== b.expectedVersion)
        conflict('VERSION_CONFLICT', 'Hồ sơ đã công bố hoặc thay đổi.');
      if (!r.ciphertext) conflict('ENCRYPTION_PENDING', 'Cần upload ciphertext từ trình duyệt trước.');
      if (
        !this.db.get(
          "SELECT 1 FROM record_policies rp JOIN patients pt ON pt.id=? JOIN users u ON u.id=pt.user_id WHERE rp.record_id=? AND rp.subject_type='User' AND rp.subject_id=u.tide_user_key",
          r.patient_id,
          id,
        )
      )
        conflict('POLICY_SETUP_PENDING', 'Cần import policy Tide đúng bệnh nhân trước khi công bố.');
      this.db.run(
        'UPDATE records SET state=?,released_at=?,version=version+1 WHERE id=?',
        'RELEASED',
        Date.now(),
        id,
      );
      const patient = this.db.get('SELECT user_id FROM patients WHERE id=?', r.patient_id)!;
      if (patient.user_id)
        this.db.run(
          'INSERT INTO notification_outbox(id,appointment_id,user_id,kind,version,scheduled_at,created_at) VALUES(?,?,?,?,?,?,?)',
          randomUUID(),
          null,
          patient.user_id,
          'RECORD_RELEASED',
          null,
          Date.now(),
          Date.now(),
        );
      this.db.audit(p.user!.id, r.clinic_id, 'RECORD_RELEASED', id);
      return this.presentation(this.db.get('SELECT * FROM records WHERE id=?', id)!);
    });
  }
  policies(p: Principal, id: string) {
    const { r, a } = this.record(p, id, true);
    const policies = this.db
      .all('SELECT id,subject_type,subject_id,policy_bytes FROM record_policies WHERE record_id=?', r.id)
      .filter((x) =>
        hasRole(p, 'doctor') && a.patient_user_id !== p.user!.id
          ? x.subject_type === 'Group' && p.groups.includes(x.subject_id)
          : x.subject_type === 'User' && x.subject_id === p.tideUserKey,
      );
    return {
      recordId: id,
      contractId: 'RelationshipAttestation:1',
      tags: [id],
      policies: policies.map((x) => ({
        id: x.id,
        subjectType: x.subject_type,
        subjectId: x.subject_id,
        policyBytes: x.policy_bytes,
      })),
      verification: 'UNVERIFIED_BY_BACKEND',
      enforcedBy: 'Tide Fabric',
      note: 'Policy bytes phải được Tide chấp nhận khi mã hóa/giải mã; metadata trong database không cấp quyền.',
    };
  }
  importPolicy(p: Principal, id: string, b: any) {
    const r = this.db.get('SELECT * FROM records WHERE id=?', id) ?? missing();
    this.access.staff(p, r.clinic_id, 'admin');
    const patient = this.db.get(
      'SELECT u.tide_user_key FROM patients pt LEFT JOIN users u ON u.id=pt.user_id WHERE pt.id=?',
      r.patient_id,
    )!;
    validatePolicy(this.config, r, patient.tide_user_key ?? undefined, b);
    // Storage only. This endpoint cannot sign policies, approve membership or assert quorum.
    const policyId = randomUUID();
    this.db.transaction(() => {
      this.db.run(
        'INSERT INTO record_policies(id,record_id,subject_type,subject_id,policy_bytes,imported_by,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(record_id,subject_type,subject_id) DO UPDATE SET policy_bytes=excluded.policy_bytes,imported_by=excluded.imported_by,created_at=excluded.created_at',
        policyId,
        id,
        b.subjectType,
        b.subjectId,
        b.policyBytes,
        p.user!.id,
        Date.now(),
      );
      this.db.audit(p.user!.id, r.clinic_id, 'SIGNED_POLICY_BYTES_IMPORTED', id);
    });
    return { recordId: id, stored: true, verification: 'UNVERIFIED_BY_BACKEND', grantsAccess: false };
  }
  policyContext(p: Principal, id: string) {
    const r = this.db.get('SELECT * FROM records WHERE id=?', id) ?? missing();
    this.access.staff(p, r.clinic_id, 'admin');
    const patient = this.db.get(
      'SELECT u.tide_user_key FROM patients pt LEFT JOIN users u ON u.id=pt.user_id WHERE pt.id=?',
      r.patient_id,
    )!;
    return {
      recordId: id,
      contractId: 'RelationshipAttestation:1',
      tags: [id],
      patientTideUserKey: patient.tide_user_key ?? null,
      careGroup: careGroup(r.clinic_id, id),
      policySigning: 'DIRECTLY_IN_EACH_ADMIN_TIDE_SESSION',
      quorumStatus: 'UNVERIFIED',
    };
  }
  requestAccess(p: Principal, id: string, b: any) {
    const { r, a } = this.record(p, id);
    requireRole(p, 'patient');
    if (a.patient_user_id !== p.user!.id) forbidden();
    const d =
      this.db.get('SELECT * FROM doctors WHERE id=? AND clinic_id=?', b.doctorId, r.clinic_id) ?? missing();
    if (
      b.intent === 'GRANT' &&
      (!d.active ||
        !this.db.get(
          "SELECT 1 FROM appointments WHERE patient_id=? AND doctor_id=? AND status IN ('CONFIRMED','CHECKED_IN','IN_PROGRESS')",
          r.patient_id,
          d.id,
        ))
    )
      bad('NO_CARE_RELATIONSHIP', 'Bác sĩ chưa có lịch được phân công cho người bệnh này.');
    const requestId = randomUUID();
    this.db.transaction(() => {
      this.db.run(
        'INSERT INTO access_requests(id,record_id,requester_id,doctor_id,intent,created_at) VALUES(?,?,?,?,?,?)',
        requestId,
        id,
        p.user!.id,
        d.id,
        b.intent,
        Date.now(),
      );
      this.db.audit(p.user!.id, r.clinic_id, 'ACCESS_INTENT_SUBMITTED', id, {
        intent: b.intent,
        doctorId: d.id,
      });
    });
    return {
      id: requestId,
      recordId: id,
      doctorId: d.id,
      intent: b.intent,
      status: 'PENDING_TIDE',
      automaticallyGranted: false,
    };
  }
  sharing(p: Principal) {
    const patient = this.access.ownPatient(p);
    return {
      verification: 'UNVERIFIED',
      items: this.db
        .all(
          "SELECT r.id,r.title FROM records r WHERE r.patient_id=? AND r.state='RELEASED' ORDER BY r.created_at DESC LIMIT 100",
          patient.id,
        )
        .map((r) => ({
          recordId: r.id,
          title: r.title,
          policyReferences: this.db.all(
            'SELECT subject_type AS subjectType,subject_id AS subjectId FROM record_policies WHERE record_id=?',
            r.id,
          ),
          requests: this.db.all(
            'SELECT id,doctor_id AS doctorId,intent,status,created_at AS createdAt FROM access_requests WHERE record_id=? AND requester_id=?',
            r.id,
            p.user!.id,
          ),
          effectivePermissions: 'UNVERIFIED',
          note: 'Ứng dụng chỉ biết policy đã import và ý định; trạng thái quyền thực tế phải kiểm chứng tại Tide.',
        })),
    };
  }
  visits(p: Principal, q: any) {
    const patient = this.access.ownPatient(p);
    const rows = this.db.all(
      "SELECT * FROM appointments WHERE patient_id=? AND status IN ('IN_PROGRESS','COMPLETED') ORDER BY start_ms DESC LIMIT ? OFFSET ?",
      patient.id,
      q.limit,
      q.offset,
    );
    return {
      items: rows.map((a) => ({
        ...this.bookings.present(a),
        records: this.db
          .all("SELECT * FROM records WHERE appointment_id=? AND state='RELEASED'", a.id)
          .map((r) => this.presentation(r)),
      })),
      limit: q.limit,
      offset: q.offset,
    };
  }
  visit(p: Principal, id: string) {
    const patient = this.access.ownPatient(p);
    const a = this.access.appointment(p, id, true);
    if (a.patient_id !== patient.id || !['IN_PROGRESS', 'COMPLETED'].includes(a.status)) missing();
    return {
      ...this.bookings.present(a),
      records: this.db
        .all("SELECT * FROM records WHERE appointment_id=? AND state='RELEASED'", id)
        .map((r) => this.presentation(r)),
      followUp:
        this.db.get(
          'SELECT id,service_id AS serviceId,from_ms AS fromMs,to_ms AS toMs FROM follow_ups WHERE appointment_id=?',
          id,
        ) ?? null,
    };
  }
  followUps(p: Principal) {
    const patient = this.access.ownPatient(p);
    return this.db
      .all(
        "SELECT f.* FROM follow_ups f JOIN appointments a ON a.id=f.appointment_id WHERE f.patient_id=? AND a.status='COMPLETED' ORDER BY f.from_ms",
        patient.id,
      )
      .map((f) => ({
        id: f.id,
        previousAppointmentId: f.appointment_id,
        serviceId: f.service_id,
        preferredDoctorId: f.doctor_id,
        from: DateTime.fromMillis(f.from_ms, { zone: ZONE }).toISODate(),
        to: DateTime.fromMillis(f.to_ms, { zone: ZONE }).toISODate(),
        bookedAppointmentId:
          this.db.get(
            "SELECT id FROM appointments WHERE follow_up_id=? AND status NOT IN ('CANCELLED','NO_SHOW')",
            f.id,
          )?.id ?? null,
      }));
  }
  setFollowUp(p: Principal, appointmentId: string, b: any) {
    const a = this.access.appointment(p, appointmentId, true);
    requireRole(p, 'doctor');
    if (a.doctor_user_id !== p.user!.id) forbidden();
    if (!['IN_PROGRESS', 'COMPLETED'].includes(a.status))
      conflict('VISIT_NOT_STARTED', 'Chưa bắt đầu buổi khám.');
    const service = this.db.get('SELECT * FROM services WHERE id=? AND active=1', b.serviceId) ?? missing();
    if (service.clinic_id !== a.clinic_id) bad('CLINIC_MISMATCH', 'Dịch vụ tái khám khác phòng khám.');
    const { start, end } = dateRange(b.from, b.to);
    if (start.toMillis() <= a.start_ms)
      bad('INVALID_FOLLOW_UP', 'Khoảng tái khám phải sau buổi khám hiện tại.');
    return this.db.transaction(() => {
      const existing = this.db.get('SELECT * FROM follow_ups WHERE appointment_id=?', appointmentId);
      if (
        existing &&
        this.db.get(
          "SELECT 1 FROM appointments WHERE follow_up_id=? AND status NOT IN ('CANCELLED','NO_SHOW')",
          existing.id,
        )
      )
        conflict('FOLLOW_UP_ALREADY_BOOKED', 'Đề nghị đã được dùng để đặt lịch.');
      const id = existing?.id ?? randomUUID();
      this.db.run(
        'INSERT INTO follow_ups(id,appointment_id,patient_id,doctor_id,service_id,from_ms,to_ms,created_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(appointment_id) DO UPDATE SET service_id=excluded.service_id,from_ms=excluded.from_ms,to_ms=excluded.to_ms',
        id,
        a.id,
        a.patient_id,
        a.doctor_id,
        b.serviceId,
        start.toMillis(),
        end.toMillis(),
        Date.now(),
      );
      this.db.audit(p.user!.id, a.clinic_id, 'FOLLOW_UP_PROPOSED', id);
      return { id, appointmentId, serviceId: b.serviceId, from: b.from, to: b.to };
    });
  }
}
