import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { CONFIG, type AppConfig } from './config.js';
import { conflict } from './errors.js';

export type Row = Record<string, any>;
@Injectable()
export class Database implements OnModuleDestroy {
  readonly sql: DatabaseSync;
  constructor(@Inject(CONFIG) readonly config: AppConfig) {
    if (config.databasePath !== ':memory:') mkdirSync(dirname(config.databasePath), { recursive: true });
    this.sql = new DatabaseSync(config.databasePath);
    this.sql.exec(
      'PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;',
    );
    this.transaction(() => {
      const version = Number(this.sql.prepare('PRAGMA user_version').get()!.user_version);
      if (version > 3) throw Error('Database schema is newer than this backend.');
      if (version < 1) this.sql.exec(SCHEMA);
      if (version < 2)
        this.sql.exec(
          "ALTER TABLE clinics ADD COLUMN address TEXT NOT NULL DEFAULT 'Địa điểm giả cho demo — chưa tiếp nhận người bệnh thực'; ALTER TABLE clinics ADD COLUMN arrival_instructions TEXT NOT NULL DEFAULT 'Đến trước giờ hẹn 10 phút, mang giấy tờ và tài liệu muốn chia sẻ.';",
        );
      if (version < 3) this.sql.exec('ALTER TABLE users ADD COLUMN tide_user_key TEXT');
      this.sql.exec('PRAGMA user_version=3');
    });
  }
  get<T extends Row = Row>(query: string, ...params: SQLInputValue[]): T | undefined {
    return this.sql.prepare(query).get(...params) as T | undefined;
  }
  all<T extends Row = Row>(query: string, ...params: SQLInputValue[]): T[] {
    return this.sql.prepare(query).all(...params) as T[];
  }
  run(query: string, ...params: SQLInputValue[]) {
    return this.sql.prepare(query).run(...params);
  }
  transaction<T>(operation: () => T): T {
    this.sql.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.sql.exec('COMMIT');
      return result;
    } catch (e) {
      this.sql.exec('ROLLBACK');
      throw e;
    }
  }
  idempotent<T>(userId: string, key: string, operation: string, input: unknown, fn: () => T): T {
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    return this.transaction(() => {
      const previous = this.get('SELECT * FROM idempotency WHERE user_id=? AND key=?', userId, key);
      if (previous) {
        if (previous.operation !== operation || previous.request_hash !== hash)
          conflict('IDEMPOTENCY_MISMATCH', 'Idempotency-Key đã được dùng với dữ liệu khác.');
        return JSON.parse(previous.response) as T;
      }
      const result = fn();
      this.run(
        'INSERT INTO idempotency(user_id,key,operation,request_hash,response,created_at) VALUES(?,?,?,?,?,?)',
        userId,
        key,
        operation,
        hash,
        JSON.stringify(result),
        Date.now(),
      );
      return result;
    });
  }
  async claimJti(key: string, expiresAt: number): Promise<boolean> {
    this.run('DELETE FROM dpop_replay WHERE expires_at < ?', Date.now());
    return (
      Number(
        this.run('INSERT OR IGNORE INTO dpop_replay(key,expires_at) VALUES(?,?)', key, expiresAt).changes,
      ) === 1
    );
  }
  audit(
    actor: string,
    clinicId: string,
    action: string,
    entityId: string,
    details: Record<string, unknown> = {},
  ) {
    this.run(
      'INSERT INTO audit(id,actor_id,clinic_id,action,entity_id,details,created_at) VALUES(?,?,?,?,?,?,?)',
      randomUUID(),
      actor,
      clinicId,
      action,
      entityId,
      JSON.stringify(details),
      Date.now(),
    );
  }
  onModuleDestroy() {
    this.sql.close();
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS clinics(id TEXT PRIMARY KEY,name TEXT NOT NULL,timezone TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh');
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,issuer TEXT,subject TEXT,display_name TEXT NOT NULL,email TEXT,phone TEXT,created_at INTEGER NOT NULL,UNIQUE(issuer,subject));
CREATE TABLE IF NOT EXISTS memberships(user_id TEXT NOT NULL REFERENCES users(id),clinic_id TEXT NOT NULL REFERENCES clinics(id),PRIMARY KEY(user_id,clinic_id));
CREATE TABLE IF NOT EXISTS patients(id TEXT PRIMARY KEY,clinic_id TEXT NOT NULL REFERENCES clinics(id),user_id TEXT UNIQUE REFERENCES users(id),display_name TEXT NOT NULL,dob TEXT,phone TEXT,created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS patients_clinic ON patients(clinic_id);
CREATE TABLE IF NOT EXISTS services(id TEXT PRIMARY KEY,clinic_id TEXT NOT NULL REFERENCES clinics(id),name TEXT NOT NULL,description TEXT NOT NULL,duration_minutes INTEGER NOT NULL CHECK(duration_minutes BETWEEN 5 AND 240),fee_vnd INTEGER NOT NULL CHECK(fee_vnd>=0),active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS doctors(id TEXT PRIMARY KEY,clinic_id TEXT NOT NULL REFERENCES clinics(id),user_id TEXT UNIQUE REFERENCES users(id),display_name TEXT NOT NULL,specialty TEXT NOT NULL,languages TEXT NOT NULL DEFAULT '["vi"]',active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS doctor_services(doctor_id TEXT NOT NULL REFERENCES doctors(id),service_id TEXT NOT NULL REFERENCES services(id),PRIMARY KEY(doctor_id,service_id));
CREATE TABLE IF NOT EXISTS schedule_rules(id TEXT PRIMARY KEY,doctor_id TEXT NOT NULL REFERENCES doctors(id),weekday INTEGER NOT NULL CHECK(weekday BETWEEN 1 AND 7),start_time TEXT NOT NULL,end_time TEXT NOT NULL,UNIQUE(doctor_id,weekday,start_time));
CREATE TABLE IF NOT EXISTS time_off(id TEXT PRIMARY KEY,doctor_id TEXT NOT NULL REFERENCES doctors(id),start_ms INTEGER NOT NULL,end_ms INTEGER NOT NULL CHECK(end_ms>start_ms),reason TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS appointments(id TEXT PRIMARY KEY,clinic_id TEXT NOT NULL REFERENCES clinics(id),patient_id TEXT NOT NULL REFERENCES patients(id),doctor_id TEXT NOT NULL REFERENCES doctors(id),service_id TEXT NOT NULL REFERENCES services(id),start_ms INTEGER NOT NULL,end_ms INTEGER NOT NULL CHECK(end_ms>start_ms),status TEXT NOT NULL CHECK(status IN ('CONFIRMED','CHECKED_IN','IN_PROGRESS','COMPLETED','CANCELLED','NO_SHOW')),attendance TEXT NOT NULL DEFAULT 'UNANSWERED' CHECK(attendance IN ('UNANSWERED','ATTENDING')),disruption TEXT NOT NULL DEFAULT 'NONE',version INTEGER NOT NULL DEFAULT 1,source TEXT NOT NULL CHECK(source IN ('WEB','PHONE','WALK_IN')),booked_by TEXT NOT NULL REFERENCES users(id),follow_up_id TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS appointments_doctor_time ON appointments(doctor_id,start_ms,end_ms,status);
CREATE INDEX IF NOT EXISTS appointments_patient_time ON appointments(patient_id,start_ms,status);
CREATE UNIQUE INDEX IF NOT EXISTS active_follow_up ON appointments(follow_up_id) WHERE follow_up_id IS NOT NULL AND status NOT IN ('CANCELLED','NO_SHOW');
CREATE TRIGGER IF NOT EXISTS appointment_insert_guard BEFORE INSERT ON appointments WHEN NEW.status IN ('CONFIRMED','CHECKED_IN','IN_PROGRESS') BEGIN
 SELECT RAISE(ABORT,'SLOT_CONFLICT') WHERE EXISTS(SELECT 1 FROM appointments a WHERE a.doctor_id=NEW.doctor_id AND a.status IN ('CONFIRMED','CHECKED_IN','IN_PROGRESS') AND a.start_ms<NEW.end_ms AND a.end_ms>NEW.start_ms);
 SELECT RAISE(ABORT,'PATIENT_CONFLICT') WHERE EXISTS(SELECT 1 FROM appointments a WHERE a.patient_id=NEW.patient_id AND a.status IN ('CONFIRMED','CHECKED_IN','IN_PROGRESS') AND a.start_ms<NEW.end_ms AND a.end_ms>NEW.start_ms);
 SELECT RAISE(ABORT,'TIME_OFF_CONFLICT') WHERE EXISTS(SELECT 1 FROM time_off t WHERE t.doctor_id=NEW.doctor_id AND t.start_ms<NEW.end_ms AND t.end_ms>NEW.start_ms);
END;
CREATE TRIGGER IF NOT EXISTS appointment_update_guard BEFORE UPDATE OF doctor_id,start_ms,end_ms,status ON appointments WHEN NEW.status IN ('CONFIRMED','CHECKED_IN','IN_PROGRESS') BEGIN
 SELECT RAISE(ABORT,'SLOT_CONFLICT') WHERE EXISTS(SELECT 1 FROM appointments a WHERE a.id<>NEW.id AND a.doctor_id=NEW.doctor_id AND a.status IN ('CONFIRMED','CHECKED_IN','IN_PROGRESS') AND a.start_ms<NEW.end_ms AND a.end_ms>NEW.start_ms);
 SELECT RAISE(ABORT,'PATIENT_CONFLICT') WHERE EXISTS(SELECT 1 FROM appointments a WHERE a.id<>NEW.id AND a.patient_id=NEW.patient_id AND a.status IN ('CONFIRMED','CHECKED_IN','IN_PROGRESS') AND a.start_ms<NEW.end_ms AND a.end_ms>NEW.start_ms);
 SELECT RAISE(ABORT,'TIME_OFF_CONFLICT') WHERE (NEW.doctor_id<>OLD.doctor_id OR NEW.start_ms<>OLD.start_ms OR NEW.end_ms<>OLD.end_ms) AND EXISTS(SELECT 1 FROM time_off t WHERE t.doctor_id=NEW.doctor_id AND t.start_ms<NEW.end_ms AND t.end_ms>NEW.start_ms);
END;
CREATE TABLE IF NOT EXISTS appointment_events(id TEXT PRIMARY KEY,appointment_id TEXT NOT NULL REFERENCES appointments(id),actor_id TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,details TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,clinic_id TEXT NOT NULL REFERENCES clinics(id),patient_id TEXT NOT NULL REFERENCES patients(id),appointment_id TEXT NOT NULL REFERENCES appointments(id),author_id TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('RESULT','INSTRUCTION','PATIENT_DOCUMENT')),ciphertext TEXT,encryption_scheme TEXT NOT NULL DEFAULT 'TIDE_RELATIONSHIP_ATTESTATION_V1',state TEXT NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','RELEASED')),version INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,released_at INTEGER);
CREATE TABLE IF NOT EXISTS record_policies(id TEXT PRIMARY KEY,record_id TEXT NOT NULL REFERENCES records(id),subject_type TEXT NOT NULL CHECK(subject_type IN ('User','Group')),subject_id TEXT NOT NULL,policy_bytes TEXT NOT NULL,imported_by TEXT NOT NULL REFERENCES users(id),created_at INTEGER NOT NULL,UNIQUE(record_id,subject_type,subject_id));
CREATE TABLE IF NOT EXISTS access_requests(id TEXT PRIMARY KEY,record_id TEXT NOT NULL REFERENCES records(id),requester_id TEXT NOT NULL REFERENCES users(id),doctor_id TEXT NOT NULL REFERENCES doctors(id),intent TEXT NOT NULL CHECK(intent IN ('GRANT','REVOKE')),status TEXT NOT NULL DEFAULT 'PENDING_TIDE',created_at INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS access_request_pending ON access_requests(record_id,doctor_id,intent) WHERE status='PENDING_TIDE';
CREATE TABLE IF NOT EXISTS follow_ups(id TEXT PRIMARY KEY,appointment_id TEXT NOT NULL REFERENCES appointments(id),patient_id TEXT NOT NULL REFERENCES patients(id),doctor_id TEXT NOT NULL REFERENCES doctors(id),service_id TEXT NOT NULL REFERENCES services(id),from_ms INTEGER NOT NULL,to_ms INTEGER NOT NULL CHECK(to_ms>=from_ms),created_at INTEGER NOT NULL,UNIQUE(appointment_id));
CREATE TABLE IF NOT EXISTS notification_outbox(id TEXT PRIMARY KEY,appointment_id TEXT REFERENCES appointments(id),user_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,version INTEGER,scheduled_at INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING',created_at INTEGER NOT NULL,UNIQUE(appointment_id,user_id,kind,version));
CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),appointment_id TEXT REFERENCES appointments(id),kind TEXT NOT NULL,delivery_status TEXT NOT NULL DEFAULT 'SIMULATED',created_at INTEGER NOT NULL,read_at INTEGER);
CREATE TABLE IF NOT EXISTS contact_tasks(id TEXT PRIMARY KEY,clinic_id TEXT NOT NULL REFERENCES clinics(id),appointment_id TEXT NOT NULL REFERENCES appointments(id),status TEXT NOT NULL DEFAULT 'OPEN',updated_by TEXT REFERENCES users(id),created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS delegations(id TEXT PRIMARY KEY,clinic_id TEXT NOT NULL REFERENCES clinics(id),patient_id TEXT NOT NULL REFERENCES patients(id),delegate_user_id TEXT NOT NULL REFERENCES users(id),status TEXT NOT NULL DEFAULT 'PENDING',can_book INTEGER NOT NULL DEFAULT 0,verified_by TEXT REFERENCES users(id),created_at INTEGER NOT NULL,UNIQUE(patient_id,delegate_user_id));
CREATE TABLE IF NOT EXISTS check_in_codes(id TEXT PRIMARY KEY,appointment_id TEXT NOT NULL REFERENCES appointments(id),token_hash TEXT UNIQUE NOT NULL,expires_at INTEGER NOT NULL,used_at INTEGER);
CREATE TABLE IF NOT EXISTS idempotency(user_id TEXT NOT NULL REFERENCES users(id),key TEXT NOT NULL,operation TEXT NOT NULL,request_hash TEXT NOT NULL,response TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(user_id,key));
CREATE TABLE IF NOT EXISTS dpop_replay(key TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL REFERENCES users(id),clinic_id TEXT NOT NULL REFERENCES clinics(id),action TEXT NOT NULL,entity_id TEXT NOT NULL,details TEXT NOT NULL,created_at INTEGER NOT NULL);
PRAGMA user_version=1;
`;
