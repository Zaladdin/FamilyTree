# Add-person lifecycle and network feedback

User journeys: enter patronymic without expanding optional fields; mark a new person deceased and supply a valid death date; keep form contents when connectivity fails.

## Evidence

- Backend RED: four intended failures before optional status/deathDate support; GREEN: 20/20 scoped validation/logic/repository tests (fake transaction only).
- UI/request RED: missing lifecycle component and request helper; GREEN: 3/3 tests for native checkbox/date markup, network failure without retry, safe malformed/server responses and validation feedback.
- Full `npm test`: 240/240 passed.
- `npx tsc --noEmit --incremental false`: passed.
- `npm run lint`: passed, no warnings or errors.
- Independent React and TypeScript reviews: no blocking findings.
- Browser fixture: patronymic outside collapsed details; checkbox exposes required death date; uncheck/recheck clears it; earlier-than-birth date rejected; network failure keeps all entered fields; successful in-memory save displayed full name and `1900 — 2001` in the inspector. No console errors observed. Checked mobile 375px and desktop 1280px; dialog had no horizontal overflow.

No real accounts or family records were created. The fixture intercepts requests in memory and was closed after QA. Real server returned to development mode after the production build was interrupted to incorporate the new request. A completed production build is not claimed. Coverage percentage was not measured.
