# Multiple people in one submission

## Scope and contract

- Existing single-person mini-dialog remains available.
- Batch mode accepts 1–10 cards, each with independent identity, life dates and relationship selection.
- A relationship may point to an existing family member or an earlier draft card, using a stable client ID rather than an array index.
- All cards are validated before writing. One serializable transaction persists people, recorded edges, audit entries and statistics; no partial group is committed.
- A lost network response never triggers an automatic repeat. Existing duplicate detection rejects replayed people, preserving input for correction.
- No new dependencies, schema changes, database migrations or real-family test writes.

## Reuse and design

Reuses `PersonFormDialog`, the existing add-person validator and graph logic, the action response helper and Prisma transaction patterns. Package/MCP searches were not needed for these project-specific contracts.

Batch transactions use bounded timing options supported by [Prisma 6](https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions); client retries are not added.

## Validation record

- TDD: the backend and dialog agents reproduced missing-feature failures before implementing the batch contract.
- `npm test`: **274/274 passed**, including 34 new batch tests. Tests use in-memory graphs and mocked transactions, not the configured database.
- `npx tsc --noEmit --incremental false`: passed.
- `npm run lint`: passed, no warnings or errors.
- `npm run build`: passed, including the new batch endpoint. The verified project dev server was stopped before building the shared `.next` directory.
- Restarted the built app on `127.0.0.1:3000`; `/demo` returned HTTP 200.
- Browser QA used the isolated loopback fixture with fictional people: two people and their explicit parent-child edge were added in one submission; names and patronymics were preserved when switching from the single form.
- Simulated network failure kept both completed cards and moved keyboard focus to the error. No automatic resubmission occurred.
- Checked card removal, cleared dependent references, a replacement first card in an empty tree, the ten-card limit, Escape and focus restoration. At 375px the dialog and document had no horizontal overflow. The browser error log was empty.
- Independent database, React, TypeScript and general code reviews found no blockers.
- Database integration was not run: no disposable `TEST_DATABASE_URL` was used. Atomic rollback, UUID mapping, duplicate replay and authorization are covered by isolated tests; real family data was not changed.
- Duplicate detection rejects an unchanged replay; this is not a full idempotency-key implementation and does not return a receipt for an earlier successful request.
- Browser evidence: `tmp/batch-person-form.png`. The temporary fixture server and tab were closed after QA.
