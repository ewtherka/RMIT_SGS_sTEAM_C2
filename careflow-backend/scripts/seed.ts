import { Database } from '../src/database.js';
import { loadConfig } from '../src/config.js';
import { seed } from '../src/seed.js';
const db = new Database(loadConfig());
try {
  console.log(JSON.stringify(seed(db), null, 2));
} finally {
  db.onModuleDestroy();
}
