# Local infrastructure

The API uses SQLite WAL on a persistent single-host volume. Start with `docker compose up -d --build`, then `docker compose exec api node dist/scripts/seed.js`. The container does not receive the Tide master password or licence email. Seed data stays unlinked until the operator maps real Tide `(iss, sub)` identities.

Bootstrap Tide separately: `bash scripts/init-tidecloak.sh`. It creates `careflow-tidecloak` and `careflow-tide-data`, refuses to overwrite existing data, and binds port 8080 to loopback. Restart with `docker start careflow-tidecloak`. Do not run bootstrap again on an enrolled realm. See `docs/VERIFICATION.md` before attempting to recover an unfinished licence step.

Milvus is optional and disabled. Its SDK is installed; `MILVUS_ADDRESS=localhost:19530` enables `npm run milvus:check`. No collections, embeddings or fake vectors are created. It is not used for patient data, encrypted medical records, appointment locking, idempotency or audit. A future vector feature needs a real embedding design and approved scope; none is part of this MVP.

If a local Milvus instance is wanted later, use the [official standalone Docker Compose instructions](https://milvus.io/docs/install_standalone-docker-compose.md). Starting it is unnecessary for this backend and consumes additional RAM. No cloud service or paid account is configured.

This Windows machine runs Docker in Ubuntu WSL2. Use WSL for Docker commands. Keep a WSL terminal open while demonstrating services: closing every WSL process can stop systemd services. Windows API commands use `npm.cmd` if PowerShell blocks `npm.ps1`.
