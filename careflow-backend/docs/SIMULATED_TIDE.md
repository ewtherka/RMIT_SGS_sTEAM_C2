# Simulated TideCloak (`TIDE_MODE=simulated`)

The UNLOCKED brief allows simulating TideCloak's sign-in, roles and access checks, and judges simulated and live integrations the same way. CareFlow is built as though TideCloak protects it. Every simulated response carries `SIMULATED` / `SIMULATED_TIDECLOAK`; nothing claims to be the real Tide network. `TIDE_MODE=strict` (the default) keeps the real TideCloak JWT + DPoP path unchanged.

## Where TideCloak fits (planned with Tide's Raziel MCP, `feature-mapping` canon)

| Concern | Real TideCloak | Simulated here | Why it matters |
| --- | --- | --- | --- |
| Sign-in | Threshold-verified login; JWT signed by the VVK across ORKs | `POST /v1/sim/session` issues a TideCloak-shaped JWT (`realm_access.roles`, `tideuserkey`, `azp/aud`) | No password hash or master signing key at the clinic |
| Roles | Verified server-side from the JWT | Same guard path: the server verifies the token and reads `careflow-*` roles; UI gating is never authorization | Front-end role toggles grant nothing |
| Record access | Forseti policy + E2EE; decryption needs the network | `POST /v1/sim/records/:id/decrypt` returns plaintext only for the patient, the authoring doctor or a quorum-granted doctor; otherwise `403 TIDE_POLICY_DENIED` | The clinic database holds ciphertext only |
| Changing access | Quorum-enforced governance (IGA change request) | Patient files `GRANT`/`REVOKE` → **2 of 3 independent admins** must approve → `COMMITTED` | No single admin, clinic or AI can unlock a record alone |

## Run

```bash
cp .env.example .env    # then set TIDE_MODE=simulated and QR_SIGNING_KEY
npm ci --ignore-scripts && npm run seed && npm start
node scripts/sim-demo.mjs   # end-to-end demo of the quorum flow
```

On first start in simulated mode the two seed records are encrypted (AES-256-GCM, a key derived per record from a secret in `.data/sim-tide.secret`, which is outside Git) and released.

## API for the front-end

Private calls use `Authorization: Bearer <accessToken>` (no DPoP in simulated mode). All other `/v1` endpoints keep the contract in `FRONTEND.md`.

| Method | Path | Who | Response |
| --- | --- | --- | --- |
| GET | `/v1/auth/config` | public | `{configured:true, mode:"SIMULATED", tokenType:"Bearer", identitiesPath, sessionPath, quorum:{threshold:2,of:3}}` |
| GET | `/v1/sim/identities` | public | `[{userId, displayName, roles:["careflow-patient"\|...]}]` |
| POST | `/v1/sim/session` | public | body `{userId}` → `{mode, tokenType:"Bearer", accessToken, expiresIn, userId, roles}` |
| GET | `/v1/sim/approvals` | admin | `{quorum, items:[AccessRequest]}`: requests still `PENDING_TIDE` |
| POST | `/v1/sim/approvals/:id/approve` | admin | `AccessRequest`; `409 ALREADY_APPROVED` if the same admin approves twice; `409 REQUEST_CLOSED` once committed |
| GET | `/v1/sim/records/:id/access` | patient/doctor/admin | `{recordId, canDecrypt, allowedBy, grantedDoctorIds, requests, quorum}` |
| POST | `/v1/sim/records/:id/decrypt` | patient/doctor | `{recordId, plaintext, allowedBy:"PATIENT_USER_POLICY"\|"AUTHOR_CARE_TEAM"\|"QUORUM_GRANT"}` or `403 TIDE_POLICY_DENIED` |

`AccessRequest` = `{id, recordId, recordTitle, doctorId, doctorName, intent:"GRANT"|"REVOKE", status:"PENDING_TIDE"|"COMMITTED", approvals:[{adminId, displayName, approvedAt}], quorum:{threshold, of, reached}, createdAt, enforcedBy}`.

The patient still creates requests with the existing `POST /v1/records/:id/access-requests {doctorId, intent}`. A `GRANT` requires an active appointment with that doctor, so book first.

### Seed identities

| userId | Who | Role |
| --- | --- | --- |
| `30000000-0000-4000-8000-000000000001` | Nguyễn An (patient) | careflow-patient |
| `30000000-0000-4000-8000-000000000002` | BS. Minh (author of the seed records) | careflow-doctor |
| `30000000-0000-4000-8000-000000000003` | BS. Lan (new doctor, no access yet) | careflow-doctor |
| `30000000-0000-4000-8000-000000000004` | Receptionist | careflow-receptionist |
| `30000000-0000-4000-8000-000000000005..7` | Independent admins 1–3 | careflow-admin |

## Two-minute demo storyline

1. Patient signs in (simulated) → books BS. Lan.
2. BS. Lan opens the patient's result → **denied by Tide** even though she has an appointment.
3. Patient shares that one record with BS. Lan → `PENDING_TIDE`.
4. Admin 1 approves → still denied (1/2). Admin 1 cannot approve twice.
5. Admin 2 approves → quorum reached → BS. Lan decrypts the result.
6. Message: the clinic's admins, its database and its AI cannot unlock a patient's record alone.
