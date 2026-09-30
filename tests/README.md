# Tests

`npm test` runs only the unit tests directly inside `tests/`. It supplies a
non-working localhost database URL before starting the test processes, so these
tests cannot fall back to the application's database.
It does not run migrations, seed data, or integration tests.
Prisma Client must already be generated, as it normally is after dependency
installation. If it is missing, run `npm run prisma:generate` once. Tests do not
regenerate it or replace its engine DLL while the development server is running.

Media tests use their own `mkdtemp` directory under the operating system's temp
directory. A Node test child process changes its own working directory for the
duration of that file. Cleanup restores the original working directory, resolves
the exact temporary path, validates its parent and prefix, and removes only that
fixture. The project's `storage/` directory is never a test cleanup target.

## Database integration tests

`npm run test:integration` requires an explicitly exported `TEST_DATABASE_URL`.
No default is taken from `.env`. The database name must contain a separate `test`
segment, such as `rodovo_test` or `test_rodovo`. Reusing the active `DATABASE_URL`
database is rejected by the runner, even with different credentials or schemas.
The integration helpers independently check the explicit test URL before importing
Prisma or application repositories, including when files are invoked directly.

Prepare a separate PostgreSQL test database with the project's current schema
first. This command never creates, resets, or migrates a database automatically.
For example, after the dedicated database exists and its migrations have been
applied explicitly, set `TEST_DATABASE_URL` in your shell and run the integration
command. Do not point it at development or production data.

The suite creates UUID-named users and their own families, and cleans them in
`finally` blocks. It does not depend on demo seeds or known production users.
Termination of a process can interrupt cleanup; the database must therefore remain
disposable even though routine test completion cleans its fixtures.

The CONTENT-01 integration cases require the story lifecycle migration:

- `story-concurrency.test.ts`: lifecycle, preserved text, counts/audit and
  competing update/delete/restore requests.
- `content-migration.test.ts`: replays only the reviewed legacy timeline
  classification statement, constrained to each fixture's parameterized person
  ID. Checks corrected birth dates and preserves custom or ambiguous events.

These tests do not apply the schema migration. A successful isolated unit run
does not establish PostgreSQL migration or concurrency acceptance.

AUTH-01/02 adds `auth-account-concurrency.test.ts` (reset race, old credential
sessions, other-session revocation and legacy access) and
`family-invitations.test.ts` (verified invitation acceptance and legacy managers).
The existing membership concurrency case now tests two invitation acceptances.
These require `20260928040000_account_security` on the disposable test database.
No real mail transport is enabled. Unit tests inject an in-memory sender and
the browser fixture uses synthetic responses with no server-request fallback:

```powershell
npx tsx scripts/auth-ui-preview.ts
```

This standalone fixture uses loopback port 3001; stop a verified previous fixture
before starting it. It does not test real login, mail delivery or database races.

## MEDIA-01 / OPS-01

The media unit suites exercise bounded multipart input, MIME/size checks,
quota reservations, lifecycle compensation, permission revocation, idempotent
cleanup, streaming Range responses and diagnostics. Filesystem tests use private
temporary directories; they never select the application's storage volume.
Repository tests inject Prisma mocks and do not establish PostgreSQL isolation.

`tests/integration/media-concurrency.test.ts` adds three cases requiring the
media lifecycle migration on the disposable database: concurrent family quota,
system quota across families, and revoked permission/finalization consistency.
These are excluded from `npm test` and were not run against the working database.

`backup-manifest.test.ts` and `backup-cli.test.ts` create, verify and restore
temporary offline packages. Their dump is synthetic bytes, not a PostgreSQL dump.
Passing these tests verifies file integrity and CLI boundaries; full recovery
still requires the separate database/media drill in
[`docs/backup-recovery.ru.md`](../docs/backup-recovery.ru.md).

Stage 7 operational tests cover bounded/cached readiness, storage permissions,
metrics authorization, safe request logging and Redis degradation. `npm test`
keeps these isolated from the configured database. `npm run test:smoke` requires
a completed build and free loopback port 3002; it starts its own production server
with an unreachable test database and temporary storage, then cleans up.

`npm run ci:database` is only for the disposable CI PostgreSQL service. It requires
`RODOVO_CI_DATABASE=disposable` and an explicit `TEST_DATABASE_URL` restricted to
127.0.0.1/rodovo_ci_test, different from DATABASE_URL. It applies migrations and
checks history/checksums/schema; never point it at the working database.

`npm run test:upgrade` requires a fresh empty disposable `rodovo_ci_test` database
and the same explicit CI guard. It deploys the first two migrations, inserts
synthetic legacy rows, then deploys the full chain and compares every original
column across 11 tables. It checks legacy sessions, defaults, migration history,
schema drift and repeat deployment. It refuses a populated public schema and
leaves synthetic rows for diagnosis; use a dedicated disposable container.
See [`docs/legacy-upgrade-acceptance.ru.md`](../docs/legacy-upgrade-acceptance.ru.md).
