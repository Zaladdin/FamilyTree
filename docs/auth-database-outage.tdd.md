# Authentication database outage handling

Scope: registration/login error privacy and a bounded PostgreSQL connection timeout.

- RED: `node --import tsx --test tests/register-route.test.ts tests/database-connection.test.ts` failed on the exposed internal exception and the missing timeout helper.
- GREEN: `node --import tsx --test tests/register-route.test.ts tests/database-connection.test.ts tests/login-redirect.test.ts` passed all 16 tests.
- Auth route tests inject a Prisma fake before loading auth. They create no real accounts or sessions.
- Database outage codes map to a static Russian retry message. Unexpected errors map to a static operation-specific fallback; intentional 4xx validation messages remain visible.
- PostgreSQL URLs without `connect_timeout` receive 20 seconds. Explicit values, other protocols, encoded credentials and other options are preserved. No environment file or database record was changed.
- A server restart is required to replace any cached Prisma client.
- Independent code review found no actionable issues. Coverage percentage was not measured.

The interrupted visualization task left draft tests referring to an unimplemented helper. Its standalone draft was preserved in `tmp/family-link-emphasis.test.ts.pending`, and its unimplemented UI assertion was withdrawn. Existing implemented tree regression tests remain unchanged.
