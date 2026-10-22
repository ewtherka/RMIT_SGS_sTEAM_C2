import { Inject, Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { createHash, randomUUID } from 'node:crypto';
import { Database, type Row } from './database.js';
import { Access } from './identity.js';
import { type Principal } from './auth/auth.js';
import { bad, conflict, missing } from './errors.js';

export const ZONE = 'Asia/Ho_Chi_Minh';
export const isoTime = (n: number) => new Date(n).toISOString();
export const toMs = (s: string): number => {
  const n = Date.parse(s);
  if (!Number.isFinite(n)) bad('INVALID_TIME', 'Thời điểm không hợp lệ.');
  return n;
};
export function dateRange(from: string, to: string) {
  const start = DateTime.fromISO(from, { zone: ZONE }).startOf('day');
  const end = DateTime.fromISO(to, { zone: ZONE }).endOf('day');
  if (!start.isValid || !end.isValid || end < start || end.diff(start, 'days').days > 31)
    bad('INVALID_DATE_RANGE', 'Khoảng ngày phải hợp lệ và tối đa 31 ngày.');
  return { start, end };
}

@Injectable()
export class Scheduling {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(Access) private readonly access: Access,
  ) {}
  clinics() {
    return this.db.all(
      'SELECT id,name,timezone,address,arrival_instructions AS arrivalInstructions FROM clinics ORDER BY name',
    );
  }
  services(q: any) {
    return this.db.all(
      'SELECT id,clinic_id AS clinicId,name,description,duration_minutes AS durationMinutes,fee_vnd AS feeVnd FROM services WHERE active=1 AND (? IS NULL OR clinic_id=?) AND (? IS NULL OR id=?) AND (? IS NULL OR EXISTS(SELECT 1 FROM doctor_services ds WHERE ds.service_id=services.id AND ds.doctor_id=?)) AND instr(lower(name),lower(?))>0 ORDER BY name',
      q.clinicId ?? null,
      q.clinicId ?? null,
      q.serviceId ?? null,
      q.serviceId ?? null,
      q.doctorId ?? null,
      q.doctorId ?? null,
      q.q ?? '',
    );
  }
  doctors(q: any) {
    return this.db
      .all(
        "SELECT d.id,d.clinic_id AS clinicId,d.display_name AS displayName,d.specialty,d.languages FROM doctors d WHERE d.active=1 AND (? IS NULL OR d.clinic_id=?) AND (? IS NULL OR d.id=?) AND (? IS NULL OR EXISTS(SELECT 1 FROM doctor_services ds WHERE ds.doctor_id=d.id AND ds.service_id=?)) AND instr(lower(d.display_name || ' ' || d.specialty),lower(?))>0 ORDER BY d.display_name",
        q.clinicId ?? null,
        q.clinicId ?? null,
        q.doctorId ?? null,
        q.doctorId ?? null,
        q.serviceId ?? null,
        q.serviceId ?? null,
        q.q ?? '',
      )
      .map((d) => ({ ...d, languages: JSON.parse(d.languages) }));
  }
  availability(q: any, excludeAppointmentId?: string) {
    const service = this.db.get('SELECT * FROM services WHERE id=? AND active=1', q.serviceId) ?? missing();
    const { start, end } = dateRange(q.from, q.to);
    if (end.toMillis() > Date.now() + 91 * 86_400_000) bad('DATE_TOO_FAR', 'Chỉ mở lịch trong vòng 90 ngày.');
    const doctors = this.db.all(
      'SELECT d.* FROM doctors d JOIN doctor_services ds ON ds.doctor_id=d.id WHERE d.active=1 AND ds.service_id=? AND (? IS NULL OR d.id=?)',
      q.serviceId,
      q.doctorId ?? null,
      q.doctorId ?? null,
    );
    const result: Row[] = [];
    for (const d of doctors) {
      const rules = this.db.all('SELECT * FROM schedule_rules WHERE doctor_id=?', d.id);
      const blocked = this.db.all(
        'SELECT start_ms,end_ms FROM appointments WHERE doctor_id=? AND status IN (?,?,?) AND id<>? AND start_ms<? AND end_ms>? UNION ALL SELECT start_ms,end_ms FROM time_off WHERE doctor_id=? AND start_ms<? AND end_ms>?',
        d.id,
        'CONFIRMED',
        'CHECKED_IN',
        'IN_PROGRESS',
        excludeAppointmentId ?? '',
        end.toMillis(),
        start.toMillis(),
        d.id,
        end.toMillis(),
        start.toMillis(),
      );
      for (let day = start; day <= end; day = day.plus({ days: 1 })) {
        for (const rule of rules.filter((r) => r.weekday === day.weekday)) {
          const [sh, sm] = rule.start_time.split(':').map(Number);
          const [eh, em] = rule.end_time.split(':').map(Number);
          const close = day.set({ hour: eh, minute: em });
          for (
            let time = day.set({ hour: sh, minute: sm });
            time.plus({ minutes: service.duration_minutes }) <= close;
            time = time.plus({ minutes: service.duration_minutes })
          ) {
            const a = time.toMillis();
            const b = time.plus({ minutes: service.duration_minutes }).toMillis();
            const local = time.toFormat('HH:mm');
            if (
              a <= Date.now() ||
              (q.after && local < q.after) ||
              (q.before && time.plus({ minutes: service.duration_minutes }).toFormat('HH:mm') > q.before) ||
              blocked.some((t) => t.start_ms < b && t.end_ms > a)
            )
              continue;
            result.push({
              slotId: createHash('sha256').update(`${d.id}:${service.id}:${a}`).digest('hex').slice(0, 32),
              clinicId: d.clinic_id,
              doctorId: d.id,
              doctorName: d.display_name,
              serviceId: service.id,
              startsAt: isoTime(a),
              endsAt: isoTime(b),
              durationMinutes: service.duration_minutes,
              feeVnd: service.fee_vnd,
              timezone: ZONE,
            });
          }
        }
      }
    }
    return result
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.doctorId.localeCompare(b.doctorId))
      .slice(0, 1000);
  }
  validateSlot(doctorId: string, serviceId: string, startsAt: string) {
    const start = toMs(startsAt);
    const localDate = DateTime.fromMillis(start, { zone: ZONE }).toISODate()!;
    const service = this.db.get('SELECT * FROM services WHERE id=? AND active=1', serviceId) ?? missing();
    const d =
      this.db.get(
        'SELECT d.* FROM doctors d JOIN doctor_services ds ON ds.doctor_id=d.id WHERE d.id=? AND ds.service_id=? AND d.active=1',
        doctorId,
        serviceId,
      ) ?? bad('UNSUPPORTED_SERVICE', 'Bác sĩ không thực hiện dịch vụ này.');
    if (d.clinic_id !== service.clinic_id) bad('CLINIC_MISMATCH', 'Dịch vụ và bác sĩ không cùng phòng khám.');
    // Validate against working hours; database triggers independently protect conflicts/time off.
    const dt = DateTime.fromISO(startsAt).setZone(ZONE);
    const offered = this.db
      .all('SELECT * FROM schedule_rules WHERE doctor_id=? AND weekday=?', doctorId, dt.weekday)
      .some((r) => {
        const [h, m] = r.start_time.split(':').map(Number);
        const [eh, em] = r.end_time.split(':').map(Number);
        const open = dt.startOf('day').set({ hour: h, minute: m });
        const close = dt.startOf('day').set({ hour: eh, minute: em });
        const delta = dt.diff(open, 'minutes').minutes;
        return (
          dt >= open &&
          dt.plus({ minutes: service.duration_minutes }) <= close &&
          Number.isInteger(delta) &&
          delta % service.duration_minutes === 0
        );
      });
    if (!offered || start <= Date.now() || start > Date.now() + 90 * 86_400_000)
      bad('INVALID_SLOT', `Giờ khám không nằm trong slot được mở (${localDate}).`);
    return { doctor: d, service, start, end: start + service.duration_minutes * 60_000 };
  }
  replaceSchedule(p: Principal, id: string, b: any) {
    const d = this.access.doctor(p, id);
    for (const r of b.rules)
      if (r.endTime <= r.startTime) bad('INVALID_WORKING_HOURS', 'Giờ kết thúc phải sau giờ bắt đầu.');
    for (const [i, a] of b.rules.entries())
      if (
        b.rules.some(
          (c: any, j: number) =>
            j !== i && a.weekday === c.weekday && a.startTime < c.endTime && a.endTime > c.startTime,
        )
      )
        bad('OVERLAPPING_RULES', 'Các ca làm không được chồng nhau.');
    this.db.transaction(() => {
      // Avoid stranding existing reservations when changing normal working hours.
      if (
        this.db.get(
          "SELECT 1 FROM appointments WHERE doctor_id=? AND start_ms>? AND status IN ('CONFIRMED','CHECKED_IN','IN_PROGRESS')",
          id,
          Date.now(),
        )
      )
        conflict('EXISTING_APPOINTMENTS', 'Có lịch tương lai; hãy xử lý lịch trước hoặc tạo ngoại lệ nghỉ.');
      this.db.run('DELETE FROM schedule_rules WHERE doctor_id=?', id);
      for (const r of b.rules)
        this.db.run(
          'INSERT INTO schedule_rules(id,doctor_id,weekday,start_time,end_time) VALUES(?,?,?,?,?)',
          randomUUID(),
          id,
          r.weekday,
          r.startTime,
          r.endTime,
        );
      this.db.audit(p.user!.id, d.clinic_id, 'SCHEDULE_REPLACED', id);
    });
    return { doctorId: id, rules: b.rules };
  }
}
