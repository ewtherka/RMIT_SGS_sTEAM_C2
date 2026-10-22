import 'reflect-metadata';
import { parentPort, workerData } from 'node:worker_threads';
import { Database } from '../src/database.js';
import { Access } from '../src/identity.js';
import { Scheduling } from '../src/scheduling.js';
import { Bookings } from '../src/bookings.js';
import { Notifications } from '../src/notifications.js';
const { config, barrier, userId, body, key } = workerData;
const db = new Database(config);
const access = new Access(db);
const bookings = new Bookings(db, access, new Scheduling(db, access), new Notifications(db, config), config);
parentPort!.postMessage({ ready: true });
Atomics.wait(new Int32Array(barrier), 0, 0);
try {
  const result = bookings.create(
    {
      issuer: 'test',
      subject: userId,
      roles: ['careflow-patient'],
      groups: [],
      user: db.get('SELECT * FROM users WHERE id=?', userId),
    },
    body,
    key,
  );
  parentPort!.postMessage({ status: 201, id: result.id });
} catch (e) {
  parentPort!.postMessage({ status: e instanceof Error && /SLOT_CONFLICT/.test(e.message) ? 409 : 500 });
} finally {
  db.onModuleDestroy();
}
