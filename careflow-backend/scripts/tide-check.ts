import { loadConfig, readAdapter } from '../src/config.js';
const config = loadConfig();
const adapter = readAdapter(config.adapterPath);
const report: Record<string, unknown> = {
  adapterConfigured: Boolean(adapter),
  embeddedPublicKeys: adapter?.jwk.keys.length ?? 0,
  realLogin: 'NOT_VERIFIED',
  relationshipEncryption: 'NOT_VERIFIED',
  multiAdminQuorum: 'NOT_VERIFIED',
};
async function get(path: string, token?: string) {
  return fetch(config.tidecloakUrl + path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(15000),
  });
}
try {
  const discovery = await get(`/realms/${config.realm}/.well-known/openid-configuration`);
  report.realmDiscoveryHttp = discovery.status;
  if (process.env.KC_BOOTSTRAP_ADMIN_PASSWORD) {
    const response = await fetch(`${config.tidecloakUrl}/realms/master/protocol/openid-connect/token`, {
      method: 'POST',
      body: new URLSearchParams({
        client_id: 'admin-cli',
        grant_type: 'password',
        username: process.env.KC_BOOTSTRAP_ADMIN_USERNAME ?? 'admin',
        password: process.env.KC_BOOTSTRAP_ADMIN_PASSWORD,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw Error(`Bootstrap credential check HTTP ${response.status}`);
    const token = ((await response.json()) as any).access_token as string;
    const realm = await get(`/admin/realms/${config.realm}`, token);
    const body = (await realm.json()) as any;
    report.igaEnabled = body.attributes?.isIGAEnabled === 'true';
    report.attestor = body.attributes?.['iga.attestor'] ?? null;
    const licence = await get(`/admin/realms/${config.realm}/vendorResources/getLicenseDetails`, token);
    report.licenseDetailsHttp = licence.status;
    if (licence.ok) {
      const raw = await licence.text();
      let details: any = {};
      try {
        details = JSON.parse(raw);
      } catch {
        report.licenseDetailsFormat = raw ? 'NON_JSON' : 'EMPTY';
      }
      report.licenseFields = Object.keys(details ?? {});
      report.licenseFlags = Object.fromEntries(
        Object.entries(details ?? {}).filter(
          ([k, v]) =>
            typeof v === 'boolean' ||
            (/^(status|tier|licensingTier|plan|expiry|expiresAt|isActive)$/i.test(k) &&
              typeof v === 'string'),
        ),
      );
    }
    // Never dump provider representations, realm attributes, credentials or token bodies.
  }
} catch (e) {
  report.connectionError = e instanceof Error ? e.name : 'Error';
  if (e instanceof Error && e.cause && typeof e.cause === 'object' && 'code' in e.cause)
    report.connectionCode = e.cause.code;
}
console.log(JSON.stringify(report, null, 2));
if (!adapter) process.exitCode = 1;
