import { DateTime } from 'luxon';
import { Database } from './database.js';
import { ZONE } from './scheduling.js';

export const DEMO = {
  clinic: '10000000-0000-4000-8000-000000000001',
  patient: '20000000-0000-4000-8000-000000000001',
  patientUser: '30000000-0000-4000-8000-000000000001',
  doctorA: '40000000-0000-4000-8000-000000000001',
  doctorB: '40000000-0000-4000-8000-000000000002',
  doctorUserA: '30000000-0000-4000-8000-000000000002',
  doctorUserB: '30000000-0000-4000-8000-000000000003',
  receptionist: '30000000-0000-4000-8000-000000000004',
  admins: [
    '30000000-0000-4000-8000-000000000005',
    '30000000-0000-4000-8000-000000000006',
    '30000000-0000-4000-8000-000000000007',
  ],
  service: '50000000-0000-4000-8000-000000000001',
  followService: '50000000-0000-4000-8000-000000000002',
  visit: '60000000-0000-4000-8000-000000000001',
  followUp: '70000000-0000-4000-8000-000000000001',
  records: ['80000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000002'],
};

// Idempotent fake clinic data. All identities start UNLINKED; no passwords, tokens or fake encryption.
export function seed(db: Database) {
  return db.transaction(() => {
    if (db.get('SELECT 1 FROM clinics WHERE id=?', DEMO.clinic)) return { created: false, ids: DEMO };
    const now = Date.now();
    db.run('INSERT INTO clinics(id,name) VALUES(?,?)', DEMO.clinic, 'CareFlow Demo Clinic — cơ sở giả');
    const names = [
      'Nguyễn An (bệnh nhân giả)',
      'BS. Minh (giả)',
      'BS. Lan (giả)',
      'Lễ tân demo',
      'Admin độc lập 1',
      'Admin độc lập 2',
      'Admin độc lập 3',
    ];
    [DEMO.patientUser, DEMO.doctorUserA, DEMO.doctorUserB, DEMO.receptionist, ...DEMO.admins].forEach(
      (id, i) => {
        db.run('INSERT INTO users(id,display_name,created_at) VALUES(?,?,?)', id, names[i], now);
        db.run('INSERT INTO memberships(user_id,clinic_id) VALUES(?,?)', id, DEMO.clinic);
      },
    );
    db.run(
      'INSERT INTO patients(id,clinic_id,user_id,display_name,dob,created_at) VALUES(?,?,?,?,?,?)',
      DEMO.patient,
      DEMO.clinic,
      DEMO.patientUser,
      names[0],
      '2000-01-01',
      now,
    );
    db.run(
      'INSERT INTO services(id,clinic_id,name,description,duration_minutes,fee_vnd) VALUES(?,?,?,?,?,?)',
      DEMO.service,
      DEMO.clinic,
      'Khám tổng quát',
      'Dịch vụ giả; giá tham khảo cho demo',
      30,
      200000,
    );
    db.run(
      'INSERT INTO services(id,clinic_id,name,description,duration_minutes,fee_vnd) VALUES(?,?,?,?,?,?)',
      DEMO.followService,
      DEMO.clinic,
      'Tái khám',
      'Theo đề nghị của bác sĩ trong demo',
      30,
      100000,
    );
    [DEMO.doctorA, DEMO.doctorB].forEach((id, i) => {
      db.run(
        'INSERT INTO doctors(id,clinic_id,user_id,display_name,specialty) VALUES(?,?,?,?,?)',
        id,
        DEMO.clinic,
        i ? DEMO.doctorUserB : DEMO.doctorUserA,
        names[i + 1],
        'Nội tổng quát',
      );
      for (const service of [DEMO.service, DEMO.followService])
        db.run('INSERT INTO doctor_services VALUES(?,?)', id, service);
      for (let weekday = 1; weekday <= 7; weekday++)
        for (const [j, start, end] of [
          [0, '08:00', '12:00'],
          [1, '13:00', '17:00'],
        ] as const)
          db.run(
            'INSERT INTO schedule_rules VALUES(?,?,?,?,?)',
            `90000000-0000-4000-800${i}-${String(weekday * 10 + j).padStart(12, '0')}`,
            id,
            weekday,
            start,
            end,
          );
    });
    const past = DateTime.now()
      .setZone(ZONE)
      .minus({ days: 7 })
      .set({ hour: 9, minute: 0, second: 0, millisecond: 0 })
      .toMillis();
    db.run(
      'INSERT INTO appointments(id,clinic_id,patient_id,doctor_id,service_id,start_ms,end_ms,status,source,booked_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      DEMO.visit,
      DEMO.clinic,
      DEMO.patient,
      DEMO.doctorA,
      DEMO.service,
      past,
      past + 1800000,
      'COMPLETED',
      'WEB',
      DEMO.patientUser,
      past,
      past + 1800000,
    );
    const from = DateTime.now().setZone(ZONE).plus({ days: 1 }).startOf('day').toMillis();
    const to = DateTime.fromMillis(from).plus({ days: 14 }).endOf('day').toMillis();
    db.run(
      'INSERT INTO follow_ups VALUES(?,?,?,?,?,?,?,?)',
      DEMO.followUp,
      DEMO.visit,
      DEMO.patient,
      DEMO.doctorA,
      DEMO.followService,
      from,
      to,
      past + 1800000,
    );
    DEMO.records.forEach((id, i) =>
      db.run(
        'INSERT INTO records(id,clinic_id,patient_id,appointment_id,author_id,title,kind,created_at) VALUES(?,?,?,?,?,?,?,?)',
        id,
        DEMO.clinic,
        DEMO.patient,
        DEMO.visit,
        DEMO.doctorUserA,
        i ? 'Lời dặn mẫu — chờ mã hóa' : 'Kết quả mẫu — chờ mã hóa',
        i ? 'INSTRUCTION' : 'RESULT',
        past + 1800000,
      ),
    );
    return {
      created: true,
      ids: DEMO,
      recordState: 'DRAFT_AWAITING_REAL_CLIENT_ENCRYPTION',
      identityState: 'UNLINKED',
    };
  });
}
