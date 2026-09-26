# TeamBoard — real ForgeQA consumer

TeamBoard is a small React/TypeScript application with a TypeScript HTTP backend and PostgreSQL persistence. Its purpose is exercising the quality platform, not providing a production SaaS service. Use synthetic data only.

## Execution

From the repository root, install the locked dependencies, run `npm run build`, then `npm run build --workspace examples/demo-saas`. Schema migrations are explicit: run `node dist/server.js --migrate` in this directory with `DATABASE_URL` set to the migration-owner connection. Start the application with `npm start --workspace examples/demo-saas` using a restricted runtime connection. The database name must be `forgeqa_test` or start with `forgeqa_test_`; arbitrary targets are refused.

The CI `teamboard` job provisions PostgreSQL 17, creates separate migration-owner and runtime roles, applies the two migrations, checks that the runtime cannot create schema objects or alter migration history, and then runs `npm run test:teamboard`. This executes eight API scenarios plus four browser journeys in each of Chromium, Firefox and WebKit, with zero retries. The browserless API project is not multiplied by browser count.

`npm run test:consumers -- teamboard` packs the public packages and copies this consumer to independent temporary directories for npm and pnpm. Each installation compiles public imports, builds this application, and executes the same 20-execution inventory. The consumer harness never imports private ForgeQA source paths or links back to the provider workspace.

## Data lifecycle and security boundary

The server requires `TEAMBOARD_TEST_MODE=1`, a non-production `NODE_ENV`, an explicitly authorized laboratory database, and a disposable `TEAMBOARD_TEST_TOKEN` of at least 32 characters to enable test seed/cleanup endpoints. The token is created per CI job. Each test receives independent synthetic owner/editor/viewer accounts and a run-namespaced tenant. Cleanup also requires a separate unguessable ownership proof, deletes only resources in that namespace, and is checked for zero remaining rows. Another namespace's proof is rejected.

API permission checks enforce membership and owner/editor/viewer roles; hiding UI buttons is not the authorization boundary. Passwords use salted scrypt. Sessions use random tokens stored as hashes, HTTP-only same-site cookies, an eight-hour database expiry, and explicit logout. Cookie mutations reject mismatched browser origins. Attachments have a 64 KB decoded limit and safe filenames; downloads recheck membership. CSV fields are quoted and formula-leading characters are neutralized. The runtime never receives GitHub publishing credentials.

## Scope of the evidence

Acceptance covers login/logout, role restrictions, cross-tenant denial, owned cleanup, owner creation, editor changes, viewer denial, validation, filters/pagination, a tenant-scoped flag, attachments, CSV download and native browser clock display. Clock control changes browser display only, not PostgreSQL time. There are no mocked successful persistence or authorization responses.

The application is a laboratory: it has no production deployment, email delivery, password recovery, durable distributed rate limiter, malware scanner, or production operations commitment. Hard-kill stale-tenant reclamation and lifecycle proofs for every remaining generic fixture family are not claimed complete. PostgreSQL/three-browser and packed-consumer results must be read from the exact-source CI run, not inferred from these files.
