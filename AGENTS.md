# FamilyTree / Rodovo — development instructions

## Project and scope

This is a Russian-language family archive and genealogy app: Next.js 15 App Router,
React 19, TypeScript, Prisma 6 and PostgreSQL. The shell is Windows PowerShell.
Keep the product UI Russian unless requested otherwise; answer the user in their
current language. Inspect package.json and existing code before choosing tools.
The worktree contains user-owned changes; preserve unrelated edits. Use apply_patch
for source edits. Do not commit, push, deploy, reset or clean without authorization.

## ECC workflow and discovery

ECC 2.2.1 is installed once as the native `ecc@ecc` plugin. Source checkout:
`C:/Users/Zaladdin/.codex/vendor/ecc`, pinned at
`8321021c54d670126ce3b2969d5deb880b4b0c2a`.
Usage and compatibility guide: `docs/ecc-guide.az.md`.

Use task-relevant ECC skills, reading the complete selected SKILL.md first:

| Work | Skills in the ECC `skills/` catalog | Specialist adapters |
| --- | --- | --- |
| Feature or bug | search-first, tdd-workflow, verification-loop | ecc-planner, ecc-tdd-guide |
| React/UI | frontend-patterns, react-patterns, react-performance, frontend-a11y | ecc-typescript-reviewer, ecc-a11y-architect |
| API/database | api-design, backend-patterns, prisma-patterns, postgres-patterns | ecc-database-reviewer |
| Review/auth | security-review, verification-loop | ecc-code-reviewer, ecc-security-reviewer |
| Browser flows | browser-qa, click-path-audit, e2e-testing | ecc-e2e-runner |
| Build/docs | coding-standards, documentation-lookup | ecc-build-error-resolver, ecc-doc-updater |

Native adapters are in `C:/Users/Zaladdin/.codex/agents/ecc-*.toml`; the original
68 specialist instructions remain in the source `agents/` directory. If native
role selection is unavailable in this host, read the corresponding adapter/source
and use the available collaboration tools with a bounded specialist prompt.
Select only relevant roles, do not launch all agents or load all 292 skills.
The source `commands/` files are reference workflows, not guaranteed slash commands.
The native installer also exposes 35 migrated `source-command-*` skills, for 327
ECC entries including the 292 primary skills. Load only relevant entries.

For nontrivial changes: inspect code and primary docs; plan; reproduce with a failing
test; implement minimally; delegate an independent review where useful; run scoped
and regression checks; report measured results. Preserve existing architecture.
ECC's 80% coverage is a target, not the current measured result. Do not add a new
test framework, Zod, a service, or a package merely because an example uses it.
Do not apply the Next.js 16 Turbopack skill as a Next.js 15 configuration template.

## Data and authorization boundaries

The configured database is a real remote Neon database with private family data.
NEVER run Prisma reset, seed, migrate, integration tests, broad updates, or fixture
creation against DATABASE_URL. Integration tests require a separate disposable
TEST_DATABASE_URL and the project's fail-closed guard. Do not display .env contents,
credentials, session cookies or private family data in diagnostics or shared docs.
Read-only diagnostics should be narrowly scoped. Mutations require the user's
specific task authority. Retain auth, role checks, Origin/CSRF checks and audit logs.

## Verification on this project

- `npm test`: isolated node:test suite through scripts/run-tests.ts; no extra flags.
  In particular `npm run test -- --coverage` is NOT supported by this runner.
- `npx tsc --noEmit --incremental false`: type checking.
- `npm run lint`: ESLint through Next.js.
- `npm run build`: production check; stop only the verified project's server first
  because .next is shared. Restart the server when the task calls for live changes.
- `npx tsx scripts/relationship-ui-preview.ts`: in-memory UI fixture on loopback
  port 3001, no DB/auth bypass. Use the real components through this fixture for
  write-flow tests; close temporary tabs and stop that verified server afterwards.
- Use the installed Codex CUA/browser APIs for UI control. Do not create a separate
  Playwright/CDP connection, install browser MCPs or bypass authentication to test.
- Check responsive layout, keyboard focus, error states and console errors when
  changing UI. Reload production/fixture tabs after non-HMR rebuilds.

## Family graph invariants

- Recorded parent, spouse and sibling edges are supported. The user's updated
  requirement in docs/technical-specification.ru.md (GRAPH-01) calls for automatic
  parent edges from spouses and siblings, with user correction/removal and saved
  exceptions. Ship this together with editing/removal; do not silently re-create
  rejected links or invent unknown parent people. Preserve graph constraints.
- Derived kinship (тесть, невестка, etc.) is relative to the selected person and
  does not create database edges. Handle half siblings and multiple marriages.
- Preserve the circular/radial layout (selected person at the centre), deterministic
  coordinates for the same perspective, compact circular context nodes, the single
  «Скрыть остальных» checkbox, selected-person zoom, «Снять выбор»/Escape,
  and the native mini-dialog for adding people unless the user asks to change them.
- Check lib/family-kinship.ts, family-display-layout.ts, family-radial-layout.ts
  and their tests for active tree changes. Keep legacy overview layout tests intact.
  Radial links must preserve exact recorded relationship keys and circle borders.

## Compatibility and optional automation

Existing Codex/GitHub/browser/security plugins take precedence for their supported
capabilities. ECC security-scan is a Claude-config/AgentShield workflow, not a
replacement for the installed Codex Security repository scan.
ECC's bundled chrome-devtools MCP is disabled; no extra provider credentials are
configured. Native SessionStart hooks require an explicit separate trust choice;
do not enable them, legacy sync, global Git hooks, auto-learning daemons, telemetry,
paid compute or external posting as an implicit part of ordinary coding.
System/developer instructions and the user's current request outrank ECC examples.
