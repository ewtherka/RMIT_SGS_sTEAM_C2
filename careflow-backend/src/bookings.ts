import { Inject, Injectable } from '@nestjs/common';
import { randomUUID, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { DateTime } from 'luxon';
import { Database, type Row } from './database.js';
import { Access } from './identity.js';
import { Scheduling, ZONE, isoTime, toMs } from './scheduling.js';
import { Notifications } from './notifications.js';
import { CONFIG, type AppConfig } from './config.js';
import { hasRole, requireRole, type Principal } from './auth/auth.js';
import { ApiError, bad, conflict, missing, forbidden } from './errors.js';

@Injectable()
export class Bookings {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(Access) private readonly access: Access,
    @Inject(Scheduling) private readonly schedules: Scheduling,
    @Inject(Notifications) private readonly notifications: Notifications,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}
  private key(key: string | undefined): string {
    if (!key || !/^[A-Za-z0-9._:-]{8,128}$/.test(key))
      return bad('IDEMPOTENCY_KEY_REQUIRED', 'Cần Idempotency-Key từ 8 đến 128 ký tự.');
    return key;
  }
  private event(p: Principal, a: Row, action: string, details: Row = {}) {
    this.db.run(
      'INSERT INTO appointment_events(id,appointment_id,actor_id,action,details,created_at) VALUES(?,?,?,?,?,?)',
      randomUUID(),
      a.id,
      p.user!.id,
      action,
      JSON.stringify(details),
      Date.now(),
    );
    this.db.audit(p.user!.id, a.clinic_id, action, a.id, details);
  }
  private raw(id: string) {
    return this.db.get('SELECT * FROM appointments WHERE id=?', id) ?? missing();
  }
  present(a: Row) {
    const doctor = this.db.get('SELECT display_name FROM doctors WHERE id=?', a.doctor_id)!;
    const service = this.db.get(
      'SELECT name,duration_minutes,fee_vnd FROM services WHERE id=?',
      a.service_id,
    )!;
    const clinic = this.db.get(
      'SELECT name,address,arrival_instructions FROM clinics WHERE id=?',
      a.clinic_id,
    )!;
    return {
      id: a.id,
      clinicId: a.clinic_id,
      patientProfileId: a.patient_id,
      doctorId: a.doctor_id,
      doctorName: doctor.display_name,
      serviceId: a.service_id,
      serviceName: service.name,
      startsAt: isoTime(a.start_ms),
      endsAt: isoTime(a.end_ms),
      timezone: ZONE,
      feeVnd: service.fee_vnd,
      durationMinutes: service.duration_minutes,
      status: a.status,
      attendanceConfirmation: a.attendance,
      disruptionStatus: a.disruption,
      bookingSource: a.source,
      version: a.version,
      followUpId: a.follow_up_id,
      clinic: {
        name: clinic.name,
        address: clinic.address,
        arrivalInstructions: clinic.arrival_instructions,
      },
      createdAt: isoTime(a.created_at),
      updatedAt: isoTime(a.updated_at),
    };
  }
  get(p: Principal, id: string) {
    return this.present(this.access.appointment(p, id));
  }
  list(p: Principal, q: any) {
    const u = this.access.user(p);
    const day = q.date ? DateTime.fromISO(q.date, { zone: ZONE }).startOf('day') : null;
    const rows = this.db.all(
      `SELECT a.* FROM appointments a JOIN patients pt ON pt.id=a.patient_id JOIN doctors d ON d.id=a.doctor_id
      WHERE EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=? AND m.clinic_id=a.clinic_id)
      AND ((?=1 AND pt.user_id=?) OR (?=1 AND d.user_id=?) OR ?=1 OR (?=1 AND EXISTS(SELECT 1 FROM delegations g WHERE g.patient_id=a.patient_id AND g.delegate_user_id=? AND g.status='VERIFIED' AND g.can_book=1)))
      AND (? IS NULL OR a.start_ms>=?) AND (? IS NULL OR a.start_ms<?)
      AND (? IS NULL OR a.doctor_id=?) AND (? IS NULL OR a.status=?) AND (? IS NULL OR a.clinic_id=?)
      ORDER BY a.start_ms,a.id LIMIT ? OFFSET ?`,
      u.id,
      Number(hasRole(p, 'patient')),
      u.id,
      Number(hasRole(p, 'doctor')),
      u.id,
      Number(hasRole(p, 'receptionist', 'admin')),
      Number(hasRole(p, 'patient')),
      u.id,
      day?.toMillis() ?? null,
      day?.toMillis() ?? null,
      day?.plus({ days: 1 }).toMillis() ?? null,
      day?.plus({ days: 1 }).toMillis() ?? null,
      q.doctorId ?? null,
      q.doctorId ?? null,
      q.status ?? null,
      q.status ?? null,
      q.clinicId ?? null,
      q.clinicId ?? null,
      q.limit,
      q.offset,
    );
    return { items: rows.map((a) => this.present(a)), limit: q.limit, offset: q.offset };
  }
  create(p: Principal, b: any, key: string | undefined) {
    const u = this.access.user(p);
    requireRole(p, 'patient', 'receptionist', 'admin');
    return this.db.idempotent(u.id, this.key(key), 'CREATE_APPOINTMENT', b, () => {
      const patient = b.patientProfileId
        ? this.access.canBookFor(p, b.patientProfileId)
        : this.access.ownPatient(p);
      const slot = this.schedules.validateSlot(b.doctorId, b.serviceId, b.startsAt);
      if (patient.clinic_id !== slot.doctor.clinic_id)
        bad('CLINIC_MISMATCH', 'Người bệnh và lịch không cùng phòng khám.');
      this.access.clinic(p, patient.clinic_id);
      const source = hasRole(p, 'receptionist', 'admin') ? (b.bookingSource ?? 'PHONE') : 'WEB';
      if (!hasRole(p, 'receptionist', 'admin') && b.bookingSource && b.bookingSource !== 'WEB') forbidden();
      if (b.followUpId) {
        const follow =
          this.db.get('SELECT * FROM follow_ups WHERE id=? AND patient_id=?', b.followUpId, patient.id) ??
          missing();
        const original = this.db.get('SELECT status FROM appointments WHERE id=?', follow.appointment_id)!;
        if (
          original.status !== 'COMPLETED' ||
          follow.service_id !== b.serviceId ||
          slot.start < follow.from_ms ||
          slot.start > follow.to_ms
        )
          bad('FOLLOW_UP_MISMATCH', 'Lịch không phù hợp đề nghị tái khám của bác sĩ.');
      }
      const id = randomUUID();
      const now = Date.now();
      this.db.run(
        'INSERT INTO appointments(id,clinic_id,patient_id,doctor_id,service_id,start_ms,end_ms,status,source,booked_by,follow_up_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
        id,
        patient.clinic_id,
        patient.id,
        b.doctorId,
        b.serviceId,
        slot.start,
        slot.end,
        'CONFIRMED',
        source,
        u.id,
        b.followUpId ?? null,
        now,
        now,
      );
      const a = this.raw(id);
      this.event(p, a, 'APPOINTMENT_BOOKED', { source });
      this.notifications.schedule(a);
      return this.present(a);
    });
  }
  private canChange(p: Principal, a: Row) {
    this.access.canBookFor(p, a.patient_id);
    if (a.status !== 'CONFIRMED') conflict('INVALID_TRANSITION', 'Chỉ thay đổi lịch trước check-in.');
  }
  private version(a: Row, expected: number) {
    if (a.version !== expected)
      conflict('VERSION_CONFLICT', 'Lịch đã thay đổi. Hãy tải lại trước khi thao tác.');
  }
  reschedule(p: Principal, id: string, b: any, key: string | undefined) {
    const u = this.access.user(p);
    return this.db.idempotent(u.id, this.key(key), `RESCHEDULE:${id}`, b, () => {
      const a = this.access.appointment(p, id);
      this.canChange(p, a);
      this.version(a, b.expectedVersion);
      const slot = this.schedules.validateSlot(b.doctorId, a.service_id, b.startsAt);
      if (slot.doctor.clinic_id !== a.clinic_id)
        bad('CLINIC_MISMATCH', 'Không thể đổi sang phòng khám khác.');
      if (a.follow_up_id) {
        const f = this.db.get('SELECT * FROM follow_ups WHERE id=?', a.follow_up_id)!;
        if (slot.start < f.from_ms || slot.start > f.to_ms)
          bad('FOLLOW_UP_MISMATCH', 'Slot ngoài khoảng tái khám.');
      }
      this.db.run(
        'UPDATE appointments SET doctor_id=?,start_ms=?,end_ms=?,version=version+1,attendance=?,disruption=?,updated_at=? WHERE id=?',
        b.doctorId,
        slot.start,
        slot.end,
        'UNANSWERED',
        'NONE',
        Date.now(),
        id,
      );
      this.db.run(
        'UPDATE contact_tasks SET status=?,updated_by=? WHERE appointment_id=? AND status<>?',
        'RESOLVED',
        u.id,
        id,
        'RESOLVED',
      );
      const updated = this.raw(id);
      this.event(p, updated, 'APPOINTMENT_RESCHEDULED', { previousDoctorId: a.doctor_id });
      this.notifications.schedule(updated, 'APPOINTMENT_CHANGED');
      return { ...this.present(updated), medicalAccessAutomaticallyGranted: false };
    });
  }
  cancel(p: Principal, id: string, b: any, key: string | undefined) {
    return this.db.idempotent(this.access.user(p).id, this.key(key), `CANCEL:${id}`, b, () => {
      const a = this.access.appointment(p, id);
      this.canChange(p, a);
      this.version(a, b.expectedVersion);
      this.db.run(
        'UPDATE appointments SET status=?,version=version+1,updated_at=? WHERE id=?',
        'CANCELLED',
        Date.now(),
        id,
      );
      this.db.run(
        'UPDATE contact_tasks SET status=?,updated_by=? WHERE appointment_id=?',
        'RESOLVED',
        p.user!.id,
        id,
      );
      const updated = this.raw(id);
      this.event(p, updated, 'APPOINTMENT_CANCELLED');
      this.notifications.schedule(updated, 'APPOINTMENT_CANCELLED');
      return this.present(updated);
    });
  }
  attendance(p: Principal, id: string, b: any, key: string | undefined) {
    return this.db.idempotent(this.access.user(p).id, this.key(key), `ATTENDANCE:${id}`, b, () => {
      const a = this.access.appointment(p, id);
      this.canChange(p, a);
      this.version(a, b.expectedVersion);
      if (a.disruption !== 'NONE')
        conflict('APPOINTMENT_DISRUPTED', 'Hãy chọn lịch thay thế trước khi xác nhận sẽ đến.');
      this.db.run(
        'UPDATE appointments SET attendance=?,updated_at=? WHERE id=?',
        'ATTENDING',
        Date.now(),
        id,
      );
      this.event(p, a, 'ATTENDANCE_CONFIRMED', {
        source: hasRole(p, 'receptionist', 'admin') ? 'PHONE' : 'PORTAL',
      });
      return this.present(this.raw(id));
    });
  }
  transition(p: Principal, id: string, target: string, b: any, key: string | undefined) {
    return this.db.idempotent(this.access.user(p).id, this.key(key), `${target}:${id}`, b, () => {
      const a = this.access.appointment(p, id);
      this.version(a, b.expectedVersion);
      const required: Record<string, string> = {
        CHECKED_IN: 'CONFIRMED',
        IN_PROGRESS: 'CHECKED_IN',
        COMPLETED: 'IN_PROGRESS',
        NO_SHOW: 'CONFIRMED',
      };
      if (a.status !== required[target])
        conflict('INVALID_TRANSITION', 'Không thể chuyển trạng thái lượt khám theo cách này.');
      if (target === 'CHECKED_IN' || target === 'NO_SHOW')
        this.access.staff(p, a.clinic_id, 'receptionist', 'admin');
      else {
        requireRole(p, 'doctor');
        if (a.doctor_user_id !== p.user!.id) forbidden();
      }
      if (a.disruption !== 'NONE') conflict('APPOINTMENT_DISRUPTED', 'Cần xử lý lịch bị ảnh hưởng trước.');
      if (target === 'NO_SHOW' && Date.now() <= a.start_ms)
        bad('TOO_EARLY', 'Chưa đến giờ hẹn để đánh dấu bỏ hẹn.');
      const localToday = DateTime.now().setZone(ZONE).toISODate();
      if (
        target === 'CHECKED_IN' &&
        DateTime.fromMillis(a.start_ms, { zone: ZONE }).toISODate() !== localToday
      )
        bad('NOT_APPOINTMENT_DAY', 'Chỉ check-in trong ngày hẹn.');
      this.db.run(
        'UPDATE appointments SET status=?,version=version+1,updated_at=? WHERE id=?',
        target,
        Date.now(),
        id,
      );
      const updated = this.raw(id);
      this.event(p, updated, `APPOINTMENT_${target}`);
      this.notifications.schedule(updated, `APPOINTMENT_${target}`);
      return this.present(updated);
    });
  }
  alternatives(p: Principal, id: string, q: any) {
    const a = this.access.appointment(p, id);
    const from = q.from ?? DateTime.now().setZone(ZONE).toISODate()!;
    const to = q.to ?? DateTime.fromISO(from).plus({ days: 14 }).toISODate()!;
    return this.schedules.availability(
      { serviceId: a.service_id, doctorId: q.doctorId, from, to, after: q.after, before: q.before },
      id,
    );
  }
  timeline(p: Principal, id: string) {
    this.access.appointment(p, id);
    return this.db
      .all(
        'SELECT id,action,created_at FROM appointment_events WHERE appointment_id=? ORDER BY created_at,id',
        id,
      )
      .map((x) => ({ id: x.id, action: x.action, createdAt: isoTime(x.created_at) }));
  }
  timeOff(p: Principal, doctorId: string, b: any, key: string | undefined) {
    const d = this.access.doctor(p, doctorId);
    const start = toMs(b.startsAt),
      end = toMs(b.endsAt);
    if (end <= start || end - start > 31 * 86_400_000)
      bad('INVALID_DATE_RANGE', 'Khoảng nghỉ phải lớn hơn 0 và tối đa 31 ngày.');
    return this.db.idempotent(p.user!.id, this.key(key), `TIME_OFF:${doctorId}`, b, () => {
      const id = randomUUID();
      this.db.run(
        'INSERT INTO time_off(id,doctor_id,start_ms,end_ms,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?)',
        id,
        doctorId,
        start,
        end,
        b.reason,
        p.user!.id,
        Date.now(),
      );
      const affected = this.db.all(
        "SELECT * FROM appointments WHERE doctor_id=? AND start_ms<? AND end_ms>? AND status IN ('CONFIRMED','CHECKED_IN')",
        doctorId,
        end,
        start,
      );
      for (const a of affected) {
        this.db.run(
          'UPDATE appointments SET disruption=?,version=version+1,updated_at=? WHERE id=?',
          'ACTION_REQUIRED',
          Date.now(),
          a.id,
        );
        if (!this.db.get("SELECT 1 FROM contact_tasks WHERE appointment_id=? AND status<>'RESOLVED'", a.id))
          this.db.run(
            'INSERT INTO contact_tasks(id,clinic_id,appointment_id,created_at) VALUES(?,?,?,?)',
            randomUUID(),
            a.clinic_id,
            a.id,
            Date.now(),
          );
        const updated = this.raw(a.id);
        this.notifications.schedule(updated, 'APPOINTMENT_DISRUPTED');
        this.event(p, updated, 'APPOINTMENT_DISRUPTED');
      }
      this.db.audit(p.user!.id, d.clinic_id, 'TIME_OFF_CREATED', id);
      return {
        id,
        doctorId,
        startsAt: isoTime(start),
        endsAt: isoTime(end),
        affectedAppointmentCount: affected.length,
      };
    });
  }
  affected(p: Principal, id: string) {
    const t = this.db.get('SELECT * FROM time_off WHERE id=?', id) ?? missing();
    this.access.doctor(p, t.doctor_id);
    return this.db
      .all(
        "SELECT * FROM appointments WHERE doctor_id=? AND start_ms<? AND end_ms>? AND status IN ('CONFIRMED','CHECKED_IN')",
        t.doctor_id,
        t.end_ms,
        t.start_ms,
      )
      .map((a) => this.present(a));
  }
  contacts(p: Principal, clinicId: string) {
    this.access.staff(p, clinicId, 'receptionist', 'admin');
    return this.db.all(
      'SELECT t.id,t.appointment_id AS appointmentId,t.status,p.display_name AS patientName,p.phone FROM contact_tasks t JOIN appointments a ON a.id=t.appointment_id JOIN patients p ON p.id=a.patient_id WHERE t.clinic_id=? ORDER BY t.created_at DESC LIMIT 100',
      clinicId,
    );
  }
  updateContact(p: Principal, id: string, b: any) {
    const t = this.db.get('SELECT * FROM contact_tasks WHERE id=?', id) ?? missing();
    this.access.staff(p, t.clinic_id, 'receptionist', 'admin');
    this.db.run('UPDATE contact_tasks SET status=?,updated_by=? WHERE id=?', b.status, p.user!.id, id);
    return { id, status: b.status };
  }
  checkInCode(p: Principal, id: string) {
    const a = this.access.appointment(p, id);
    requireRole(p, 'patient');
    if (a.status !== 'CONFIRMED' || a.disruption !== 'NONE')
      conflict('INVALID_TRANSITION', 'Lịch chưa sẵn sàng để check-in.');
    if (this.config.qrKey.length < 32)
      throw new ApiError(503, 'QR_NOT_CONFIGURED', 'Cần cấu hình QR_SIGNING_KEY.');
    const nonce = randomUUID();
    const expires = Date.now() + 10 * 60_000;
    const data = Buffer.from(JSON.stringify({ nonce, appointmentId: id, expires })).toString('base64url');
    const code = `${data}.${createHmac('sha256', this.config.qrKey).update(data).digest('base64url')}`;
    this.db.run(
      'INSERT INTO check_in_codes(id,appointment_id,token_hash,expires_at) VALUES(?,?,?,?)',
      nonce,
      id,
      createHash('sha256').update(code).digest('hex'),
      expires,
    );
    return { code, expiresAt: isoTime(expires), containsMedicalData: false };
  }
  consumeCode(p: Principal, code: string, key: string | undefined) {
    let payload: { nonce: string; appointmentId: string; expires: number };
    try {
      if (this.config.qrKey.length < 32) throw Error('No key');
      const [data, signature, extra] = code.split('.');
      const expected = createHmac('sha256', this.config.qrKey).update(data).digest();
      const supplied = Buffer.from(signature ?? '', 'base64url');
      if (extra || expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
        throw Error('Invalid signature');
      payload = JSON.parse(Buffer.from(data, 'base64url').toString());
      if (
        typeof payload.appointmentId !== 'string' ||
        typeof payload.nonce !== 'string' ||
        payload.expires < Date.now()
      )
        throw Error('Expired');
    } catch {
      bad('INVALID_CHECK_IN_CODE', 'Mã hẹn không hợp lệ hoặc hết hạn.');
    }
    const a = this.access.appointment(p, payload!.appointmentId);
    this.access.staff(p, a.clinic_id, 'receptionist', 'admin');
    // The check-in state change and code consumption share the same database transaction.
    return this.db.idempotent(
      p.user!.id,
      this.key(key),
      'QR_CHECK_IN',
      { codeHash: createHash('sha256').update(code).digest('hex') },
      () => {
        const stored = this.db.get(
          'SELECT * FROM check_in_codes WHERE id=? AND token_hash=?',
          payload!.nonce,
          createHash('sha256').update(code).digest('hex'),
        );
        if (!stored || stored.used_at || stored.expires_at < Date.now())
          conflict('CODE_USED_OR_EXPIRED', 'Mã hẹn đã dùng hoặc hết hạn.');
        const current = this.raw(a.id);
        if (
          current.status !== 'CONFIRMED' ||
          current.disruption !== 'NONE' ||
          DateTime.fromMillis(current.start_ms, { zone: ZONE }).toISODate() !==
            DateTime.now().setZone(ZONE).toISODate()
        )
          conflict('INVALID_TRANSITION', 'Chỉ nhận lịch chưa check-in trong ngày hẹn.');
        this.db.run('UPDATE check_in_codes SET used_at=? WHERE id=?', Date.now(), payload!.nonce);
        this.db.run(
          'UPDATE appointments SET status=?,version=version+1,updated_at=? WHERE id=?',
          'CHECKED_IN',
          Date.now(),
          a.id,
        );
        const updated = this.raw(a.id);
        this.event(p, updated, 'APPOINTMENT_CHECKED_IN', { source: 'QR' });
        this.notifications.schedule(updated, 'APPOINTMENT_CHECKED_IN');
        return this.present(updated);
      },
    );
  }
}
