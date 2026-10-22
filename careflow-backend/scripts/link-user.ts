import { parseArgs } from 'node:util';
import { z } from 'zod';
import { Database } from '../src/database.js';
import { loadConfig, readAdapter } from '../src/config.js';
const args = parseArgs({
  options: {
    'local-user': { type: 'string' },
    subject: { type: 'string' },
    unlink: { type: 'boolean', default: false },
  },
}).values;
const local = z.uuid().parse(args['local-user']);
const config = loadConfig();
const adapter = readAdapter(config.adapterPath);
if (!adapter) throw Error('Export the real Tide adapter before linking identities.');
const issuer = `${adapter['auth-server-url'].replace(/\/+$/, '')}/realms/${adapter.realm}`;
const subject = args.unlink ? null : z.string().min(1).max(512).parse(args.subject);
const db = new Database(config);
try {
  db.transaction(() => {
    if (!db.get('SELECT 1 FROM users WHERE id=?', local))
      throw Error('Unknown local user. Run npm run seed first.');
    db.run('UPDATE users SET issuer=?,subject=? WHERE id=?', args.unlink ? null : issuer, subject, local);
    const membership = db.get('SELECT clinic_id FROM memberships WHERE user_id=? LIMIT 1', local)!;
    db.audit(
      local,
      membership.clinic_id,
      args.unlink ? 'IDENTITY_UNLINKED_BY_OPERATOR' : 'IDENTITY_LINKED_BY_OPERATOR',
      local,
    );
  });
  console.log(
    'Local identity linked by issuer + subject. App roles still come exclusively from the signed Tide token.',
  );
} finally {
  db.onModuleDestroy();
}
