import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CONFIG, type AppConfig } from './config.js';
import { Database, type Row } from './database.js';

@Injectable()
export class Notifications implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}
  schedule(appointment: Row, kind = 'BOOKING_CONFIRMATION') {
    const patient = this.db.get('SELECT user_id FROM patients WHERE id=?', appointment.patient_id);
    if (!patient?.user_id) return;
    const now = Date.now();
    this.db.run(
      'UPDATE notification_outbox SET status=? WHERE appointment_id=? AND status=?',
      'INVALIDATED',
      appointment.id,
      'PENDING',
    );
    this.enqueue(appointment, patient.user_id, kind, now);
    if (
      appointment.start_ms - now > 86_400_000 &&
      appointment.disruption === 'NONE' &&
      appointment.status === 'CONFIRMED'
    )
      this.enqueue(appointment, patient.user_id, 'APPOINTMENT_REMINDER', appointment.start_ms - 86_400_000);
  }
  private enqueue(a: Row, user: string, kind: string, scheduled: number) {
    this.db.run(
      'INSERT OR IGNORE INTO notification_outbox(id,appointment_id,user_id,kind,version,scheduled_at,created_at) VALUES(?,?,?,?,?,?,?)',
      randomUUID(),
      a.id,
      user,
      kind,
      a.version,
      scheduled,
      Date.now(),
    );
  }
  processDue(now = Date.now()) {
    return this.db.transaction(() => {
      let count = 0;
      for (const job of this.db.all(
        'SELECT * FROM notification_outbox WHERE status=? AND scheduled_at<=? ORDER BY scheduled_at LIMIT 100',
        'PENDING',
        now,
      )) {
        const a = job.appointment_id
          ? this.db.get('SELECT * FROM appointments WHERE id=?', job.appointment_id)
          : undefined;
        const invalid =
          a &&
          (a.version !== job.version ||
            (job.kind === 'APPOINTMENT_REMINDER' && (a.status !== 'CONFIRMED' || a.disruption !== 'NONE')));
        if (invalid) {
          this.db.run('UPDATE notification_outbox SET status=? WHERE id=?', 'INVALIDATED', job.id);
          continue;
        }
        this.db.run(
          'INSERT OR IGNORE INTO notifications(id,user_id,appointment_id,kind,delivery_status,created_at) VALUES(?,?,?,?,?,?)',
          job.id,
          job.user_id,
          job.appointment_id,
          job.kind,
          'SIMULATED',
          now,
        );
        this.db.run('UPDATE notification_outbox SET status=? WHERE id=?', 'SIMULATED', job.id);
        count++;
      }
      return count;
    });
  }
  onModuleInit() {
    if (this.config.startWorker)
      this.timer = setInterval(() => {
        try {
          this.processDue();
        } catch {
          console.error('Notification worker could not process due jobs');
        }
      }, 30_000).unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
