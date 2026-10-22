import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { parse } from 'dotenv';

const args = process.argv.slice(2);
const emailIndex = args.indexOf('--license-email');
const email = emailIndex >= 0 ? args[emailIndex + 1] : undefined;
const accepted = args.includes('--accept-terms');
if (!email || !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email) || !accepted) {
  console.error(
    'Provide the operator-supplied --license-email and --accept-terms only after their consent at https://tide.org/legal',
  );
  process.exit(2);
}
if (!readFileSync('.gitignore', 'utf8').split(/\r?\n/).includes('.env'))
  throw Error('.env must be gitignored');
const current = existsSync('.env') ? parse(readFileSync('.env')) : {};
const defaults = parse(readFileSync('.env.example'));
const values = {
  ...defaults,
  ...current,
  TIDE_LICENSE_EMAIL: email,
  TIDE_TERMS_ACCEPTED: 'yes',
  CLIENT_APP_URL: current.CLIENT_APP_URL || 'http://localhost:5173',
  KC_BOOTSTRAP_ADMIN_PASSWORD: current.KC_BOOTSTRAP_ADMIN_PASSWORD || randomBytes(32).toString('base64url'),
  QR_SIGNING_KEY: current.QR_SIGNING_KEY || randomBytes(48).toString('base64url'),
};
writeFileSync(
  '.env',
  Object.entries(values)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n') + '\n',
  { mode: 0o600 },
);
console.log('Local .env prepared. Generated secrets are saved there and were not printed.');
