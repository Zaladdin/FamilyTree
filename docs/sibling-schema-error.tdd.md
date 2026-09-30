# Safe handling of a pending sibling schema update

## Report and cause

The user reported PostgreSQL `22P02` when saving `sibling`. The application client included the new relationship type, but the real database was missing the separately authorized enum migration. That migration is not permission to rewrite family data or apply unrelated pending migrations.

The single-person endpoint also exposed arbitrary internal exceptions as HTTP 400. This is a separate error-handling defect: it must return a safe server error, while intentional input errors retain useful Russian feedback.

## Fix contract

- A narrowly identified Prisma missing-sibling-enum error returns HTTP 503 and code `SIBLING_SCHEMA_NOT_READY`.
- Other unexpected exceptions never expose Prisma messages; malformed JSON and intentional domain validation keep appropriate client error statuses.
- The client recognizes only the exact 503/code combination and uses its own fixed message. It never displays arbitrary server 5xx text and never retries a mutation automatically.
- Existing form state remains available for correction or a later user-initiated retry.
- The application error handler does **not** apply migrations or by itself enable saving sibling relationships in the old schema.

## Verification

- Client TDD: the new missing-schema case failed with the generic server message; after the change all four request-helper tests passed. Tests also cover unknown codes, wrong statuses, malformed JSON, safe validation feedback and no retry.
- Server TDD: five route regressions failed before the fix; all 70 scoped server tests passed afterwards.
- `npm test`: **312/312 passed**, using isolated tests and transaction mocks, not real family records.
- `npx tsc --noEmit --incremental false`: passed.
- `npm run lint`: passed, no warnings or errors.
- `npm run build`: passed. The verified project server was stopped before building and restarted on loopback port 3000 afterwards; `/demo` returned HTTP 200. Existing browser forms were not reloaded.
- Independent general code and TypeScript reviews found no remaining blockers.

## Authorized database repair — 2026-09-28

The user explicitly approved adding only the sibling enum value. Applied the reviewed file `prisma/migrations/20260928000000_direct_sibling_relationship/migration.sql` using `prisma db execute`, then reconciled only that migration with `prisma migrate resolve --applied`.

- A fresh read-only connection successfully cast `sibling` to `public."RelationshipType"`.
- The migration is recorded as finished, not rolled back; its database checksum matches the local SHA-256 `efdb04e0d3fab50f81d3370c45a841be3a7a29a1c1ba1ea746680e6bdb3c4bfe`.
- The initial migration's checksum and finished status remain unchanged.
- The unrelated `20260802000000_member_audit_actions` migration remains unregistered and was not applied by this repair.
- No existing people or relationship records were changed; no real family fixtures were created. The database verification checks schema support, not end-to-end creation of a real person.
