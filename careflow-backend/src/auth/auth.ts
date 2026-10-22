import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { verifyTideCloakToken } from '@tidecloak/verify';
import { decodeProtectedHeader, type JWTPayload } from 'jose';
import type { Request } from 'express';
import { CONFIG, readAdapter, type AppConfig, type TideAdapter } from '../config.js';
import { Database, type Row } from '../database.js';
import { ApiError, forbidden } from '../errors.js';
import { verifyDpop } from './verifyDpop.js';

export const Public = () => SetMetadata('careflow:public', true);
// String token avoids an import cycle with simulation.ts, which provides it via useExisting.
export const SIM_TIDE = 'CAREFLOW_SIM_TIDE';
export interface SimVerifier {
  verify(token: string): Promise<JWTPayload>;
}
export interface Principal {
  issuer: string;
  subject: string;
  roles: string[];
  tideUserKey?: string;
  groups: string[];
  user?: Row;
}
export type AuthRequest = Request & { principal: Principal; requestId: string };
export function hasRole(p: Principal, ...roles: string[]) {
  return roles.some((r) => p.roles.includes(`careflow-${r}`));
}
export function requireRole(p: Principal, ...roles: string[]) {
  if (!hasRole(p, ...roles)) forbidden();
}

@Injectable()
export class AuthGuard implements CanActivate {
  readonly adapter: TideAdapter | null;
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(Database) private readonly db: Database,
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SIM_TIDE) private readonly sim: SimVerifier,
  ) {
    this.adapter = config.tideMode === 'simulated' ? null : readAdapter(config.adapterPath);
  }
  // SIMULATED TideCloak: Bearer token with TideCloak-shaped claims, still verified server-side.
  private async simulated(req: AuthRequest) {
    const authz = req.headers.authorization;
    if (!authz || !/^Bearer [^ ]+$/i.test(authz))
      throw new ApiError(401, 'UNAUTHORIZED', 'Cần đăng nhập (TideCloak mô phỏng) qua /v1/sim/session.');
    let claims: JWTPayload;
    try {
      claims = await this.sim.verify(authz.slice(7));
    } catch {
      throw new ApiError(401, 'UNAUTHORIZED', 'Token mô phỏng không hợp lệ hoặc đã hết hạn.');
    }
    const roles = ((claims.realm_access as { roles?: unknown })?.roles ?? []) as unknown[];
    req.principal = {
      issuer: claims.iss!,
      subject: claims.sub!,
      roles: roles.filter((x): x is string => typeof x === 'string' && x.startsWith('careflow-')),
      groups: [],
      tideUserKey: typeof claims.tideuserkey === 'string' ? claims.tideuserkey : undefined,
      user: this.db.get('SELECT id,display_name,email,phone FROM users WHERE id=?', claims.sub!),
    };
    return true;
  }
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride('careflow:public', [context.getHandler(), context.getClass()]))
      return true;
    if (this.config.tideMode === 'simulated')
      return this.simulated(context.switchToHttp().getRequest<AuthRequest>());
    if (!this.adapter)
      throw new ApiError(
        503,
        'TIDE_NOT_CONFIGURED',
        'Chưa có Tide adapter. Hoàn tất enrolment và xuất adapter trước khi gọi API riêng tư.',
      );
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const authz = req.headers.authorization;
    if (!authz || !/^DPoP [^ ]+$/i.test(authz) || typeof req.headers.dpop !== 'string')
      throw new ApiError(401, 'UNAUTHORIZED', 'Cần đăng nhập bằng token và DPoP hợp lệ.');
    const token = authz.slice(5);
    let claims: JWTPayload;
    try {
      const proofHeader = decodeProtectedHeader(req.headers.dpop);
      if (
        !['ES256', 'ES384', 'ES512', 'EdDSA'].includes(proofHeader.alg!) ||
        !proofHeader.jwk ||
        ['d', 'k', 'p', 'q'].some((k) => k in proofHeader.jwk!)
      )
        throw Error('Invalid proof key');
      const verified = await verifyTideCloakToken(this.adapter, token, []);
      if (!verified) throw Error('Invalid token');
      claims = verified as JWTPayload;
      const now = Date.now() / 1000;
      if (
        typeof claims.sub !== 'string' ||
        typeof claims.iss !== 'string' ||
        typeof claims.exp !== 'number' ||
        typeof claims.iat !== 'number' ||
        claims.iat > now + 60 ||
        claims.exp <= now
      )
        throw Error('Invalid claims');
      if (
        claims.azp !== this.adapter.resource ||
        claims.iss !== `${this.adapter['auth-server-url'].replace(/\/+$/, '')}/realms/${this.adapter.realm}`
      )
        throw Error('Invalid issuer/client');
      if (!(Array.isArray(claims.aud) ? claims.aud : [claims.aud]).includes(this.adapter.resource))
        throw Error('Invalid audience');
      const bound = claims as JWTPayload & { cnf?: { jkt?: string } };
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers))
        if (typeof value === 'string') headers.set(name, value);
      await verifyDpop(
        { method: req.method, url: new URL(req.originalUrl, this.config.publicUrl).href, headers },
        token,
        bound,
        {
          trustForwardedHeaders: false,
          iatSkewSeconds: 120,
          jtiStore: { claim: (jti, expires) => this.db.claimJti(`${bound.cnf?.jkt}:${jti}`, expires) },
        },
      );
    } catch {
      throw new ApiError(401, 'UNAUTHORIZED', 'Token hoặc DPoP không hợp lệ.');
    }
    const realmRoles = (claims.realm_access as { roles?: unknown })?.roles;
    const clientRoles = (claims.resource_access as Record<string, { roles?: unknown }> | undefined)?.[
      this.adapter.resource
    ]?.roles;
    const roles = [
      ...(Array.isArray(realmRoles) ? realmRoles : []),
      ...(Array.isArray(clientRoles) ? clientRoles : []),
    ].filter((x): x is string => typeof x === 'string' && x.startsWith('careflow-'));
    req.principal = {
      issuer: claims.iss!,
      subject: claims.sub!,
      roles,
      groups: Array.isArray(claims.groups)
        ? claims.groups.filter((x): x is string => typeof x === 'string')
        : [],
      tideUserKey: typeof claims.tideuserkey === 'string' ? claims.tideuserkey : undefined,
      user: this.db.get(
        'SELECT id,display_name,email,phone FROM users WHERE issuer=? AND subject=?',
        claims.iss!,
        claims.sub!,
      ),
    };
    if (req.principal.user && req.principal.tideUserKey)
      this.db.run(
        'UPDATE users SET tide_user_key=? WHERE id=? AND (tide_user_key IS NULL OR tide_user_key<>?)',
        req.principal.tideUserKey,
        req.principal.user.id,
        req.principal.tideUserKey,
      );
    return true;
  }
}
