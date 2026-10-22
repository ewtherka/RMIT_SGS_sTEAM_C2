import { config as dotenv } from 'dotenv';
import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';

export const CONFIG = Symbol('CAREFLOW_CONFIG');
export interface AppConfig {
  port: number;
  host: string;
  publicUrl: string;
  origins: string[];
  databasePath: string;
  adapterPath: string;
  qrKey: string;
  startWorker: boolean;
  tidecloakUrl: string;
  realm: string;
  milvusAddress: string;
  milvusToken: string;
  // 'simulated' replaces TideCloak sign-in, roles and access checks with a labelled local stand-in.
  tideMode: 'strict' | 'simulated';
  simSecretPath: string;
}
export const adapterSchema = z
  .object({
    realm: z.string().min(1),
    resource: z.string().min(1),
    'auth-server-url': z.url(),
    jwk: z.object({ keys: z.array(z.record(z.string(), z.unknown())).min(1) }),
    vendorId: z.string().optional(),
    homeOrkUrl: z.url().optional(),
  })
  .passthrough();
export type TideAdapter = z.infer<typeof adapterSchema>;
export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  dotenv({ quiet: true });
  const publicUrl = new URL(process.env.PUBLIC_API_URL ?? 'http://localhost:3333');
  if (publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash)
    throw Error('PUBLIC_API_URL must be an origin');
  return {
    port: Number(process.env.PORT ?? 3333),
    host: process.env.HOST ?? '127.0.0.1',
    publicUrl: publicUrl.origin,
    origins: (process.env.FRONTEND_ORIGINS ?? 'http://localhost:5173,http://localhost:3000')
      .split(',')
      .map((x) => new URL(x.trim()).origin),
    databasePath: resolve(process.env.DATABASE_PATH ?? '.data/careflow.sqlite'),
    adapterPath: resolve(process.env.TIDE_ADAPTER_PATH ?? 'data/tidecloak.json'),
    qrKey: process.env.QR_SIGNING_KEY ?? '',
    startWorker: true,
    tidecloakUrl: process.env.TIDECLOAK_URL ?? 'http://localhost:8080',
    realm: process.env.TIDE_REALM ?? 'careflow',
    milvusAddress: process.env.MILVUS_ADDRESS ?? '',
    milvusToken: process.env.MILVUS_TOKEN ?? '',
    tideMode: process.env.TIDE_MODE === 'simulated' ? 'simulated' : 'strict',
    simSecretPath: resolve(process.env.SIM_TIDE_SECRET_PATH ?? '.data/sim-tide.secret'),
    ...overrides,
  };
}
export function readAdapter(path: string): TideAdapter | null {
  if (!existsSync(path)) return null;
  const adapter = adapterSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  if ('credentials' in adapter)
    throw Error('CareFlow requires a public-client adapter with no client secret.');
  for (const key of adapter.jwk.keys) {
    if (!['EC', 'OKP', 'RSA'].includes(String(key.kty)) || 'd' in key || 'k' in key)
      throw Error('Tide adapter must contain asymmetric PUBLIC keys only');
  }
  return adapter;
}
