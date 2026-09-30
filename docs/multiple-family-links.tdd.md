# Direct siblings and multiple links when adding a person

## User journeys and scope

- Add a father's sister even when his parents have not been entered. Persist a direct symmetric sibling fact, not fictional parents or a note masquerading as a relationship.
- Derive aunt/uncle and niece/nephew labels from recorded sibling and parent edges, relative to the selected person.
- Add several explicit relationships in one person card, including a child linked to both selected parents. Existing single-person and batch forms remain supported.
- In a batch, extra links may reference existing people or earlier draft cards. Removing a draft must clear all dependent selections, never silently reassign them.
- Validate the full operation before writing and retain atomic saves, authorization, origin checks and audit entries.
- Marriage and siblinghood do not establish another person's parentage. Explicit sibling relationships are not transitively closed because half siblings are possible.

## Reuse and implementation contract

Reuse the existing person validators, relationship validator, transactional repository and native mini-dialog. No packages or external services are needed.

`AddPersonInput` keeps the original primary relationship fields and gains optional `additionalRelationships` (up to nine extra relationships). UI submissions include the array, including when empty. Batch draft references are resolved before core graph validation. A direct `sibling` relationship is symmetric and has canonical endpoints.

## Database rollout boundary

The new PostgreSQL enum value requires a separate additive migration. The configured Neon database is real: preparation and isolated tests do not authorize applying it. Do not run reset, seed, migrate dev, broad data updates or test fixture writes there.

The migration only extends `RelationshipType` with `sibling`. No existing people or relationships should be rewritten. Inspect migration history before deployment and stop if other unapplied migrations or failed migrations would expand the authorized scope.

Read-only preflight found `parent` and `spouse` in the live enum. Only the initial migration is recorded (its checksum matches the local file); the older member-audit migration is not recorded. Do not use an unqualified `migrate deploy`, which would include that unrelated change. If explicitly authorized, apply only the reviewed sibling migration file, verify its enum value, and record that one migration as applied using Prisma's [documented hotfix reconciliation workflow](https://www.prisma.io/docs/orm/prisma-migrate/workflows/patching-and-hotfixing). Do not mark the older migration as applied.

PostgreSQL documents additive enum changes and the requirement to commit before using a newly added value: [ALTER TYPE](https://www.postgresql.org/docs/current/sql-altertype.html). Enum removal is not a simple reverse migration. Recovery should preserve stored sibling facts and disable new writes if needed, rather than dropping or repurposing data.

## Verification record

- TDD: the backend agent reproduced nine missing-feature failures; the graph agent reproduced eight; UI tests reproduced six missing-form cases plus a missing sibling line-style case. The same scoped tests passed after implementation.
- Independent database review found an insertion-order defect: a later parent edge could turn an existing sibling into an ancestor. Fixed with regression coverage in both directions; shared-child links use the same invariant check.
- The full suite initially found one obsolete fixture assumption in the shared-children test. The fixture now separates unknown-relative rejection from shared-children rejection; no production guard was weakened.
- `npm test`: **302/302 passed** (isolated unit/transaction mocks; no live database fixtures).
- `npx tsc --noEmit --incremental false`: passed.
- `npm run lint`: passed, no warnings or errors.
- `npm run build`: passed. The verified project server was stopped for client generation/build and the built app restarted on loopback port 3000; `/demo` returned HTTP 200.
- Local Prisma Client was regenerated; its exported enum contains `parent`, `spouse`, and `sibling`. This does not apply the database migration.
- Isolated browser QA: added two sisters to an existing father with no recorded parents, plus an explicit sister-to-sister link, in one batch (4 people/3 edges became 6 people/6 edges). Both showed as aunts relative to his son, including in pyramid view.
- Browser QA: single-person creation with explicit links to both father and mother added one person and two edges. The child's card listed both parents and derived aunts/siblings.
- Browser QA: adding/removing an extra relationship moves keyboard focus appropriately; 375px layout had no horizontal overflow; simulated network failure retained all inputs and both parent selections. Browser error log was empty.
- Independent React, TypeScript, database and general code reviews found no remaining blockers. Browser screenshot: `tmp/multiple-family-links.png`.
- Follow-up on 2026-09-28: after explicit user approval, only the sibling enum migration was applied and recorded. A fresh database connection accepts `sibling`, and the migration-history checksum matches the reviewed file. The unrelated member-audit migration was not applied or marked as applied. Existing people and relationship records were not changed; no real-database integration tests or coverage measurement were performed. The safe error-handling follow-up passed **312/312** isolated tests; see [the repair record](sibling-schema-error.tdd.md).
