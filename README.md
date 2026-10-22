# RMIT_SGS_sTEAM_C2 — CareFlow

## Vision & originality (25%)

CareFlow helps patients choose appointments, manage changes, revisit published results and book clinician-requested follow-ups. Patients select individual records to share when continuing care with another doctor. The frontend belongs to the team; this repository implements the API.

## Trust constraint insight (20%)

Clinic administrators should not be able to turn scheduling authority into unilateral access to medical records. Appointment ownership and clinical assignment govern API access; independently governed Tide policies must govern decryption. Database approval counters cannot replace that boundary.

## Value & impact (20%)

Patients can reschedule without calling reception. Disrupted appointments require patient choice, and obsolete reminders are invalidated. Family delegation grants booking assistance without automatically granting medical access.

## Why TideCloak matters (20%)

The integration verifies embedded-key JWTs and sender-bound DPoP proofs. Record contents remain client-supplied ciphertext. Policy imports validate scope but do not sign policies or approve access. The intended cryptographic design uses `RelationshipAttestation:1` and an independently verified administrator quorum of at least two.

## Prototype & storytelling (15%)

The NestJS API includes OpenAPI, local Docker, SQLite transactions, synthetic seed data and automated integration tests. Milvus remains optional because the MVP contains no vector feature. Notifications and the rule-based booking assistant use no paid APIs.

**Current limit:** Tide licensing returned HTTP 500; real login, record encryption/decryption and MultiAdmin enforcement remain unverified. The submission video is not completed.

[Setup](careflow-backend/docs/SETUP.md) · [Frontend API handoff](careflow-backend/docs/FRONTEND.md) · [Verification](careflow-backend/docs/VERIFICATION.md) · [OpenAPI](careflow-backend/docs/openapi.json)
