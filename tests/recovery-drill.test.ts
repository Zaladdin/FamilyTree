import test from "node:test";
import assert from "node:assert/strict";
import { getRecoveryEnvironment } from "../scripts/recovery-drill-environment";

const safe = {
  RODOVO_CI_DATABASE: "disposable", RODOVO_RECOVERY_DRILL: "disposable",
  TEST_DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:55432/rodovo_ci_test",
  RECOVERY_DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:55432/rodovo_recovery_test",
  RECOVERY_CONTAINER: "rodovo-recovery-test",
};
test("recovery accepts only explicit separate local databases", () => {
  assert.equal(getRecoveryEnvironment(safe).port, "55432");
});
test("recovery refuses missing acknowledgements, production identity and changed endpoints", () => {
  for (const mutation of [
    { RODOVO_RECOVERY_DRILL: undefined }, { RODOVO_CI_DATABASE: undefined }, { RECOVERY_CONTAINER: "other" },
    { DATABASE_URL: safe.RECOVERY_DATABASE_URL }, { DATABASE_URL: safe.TEST_DATABASE_URL },
    { RECOVERY_DATABASE_URL: safe.TEST_DATABASE_URL },
    ...["localhost:55439", "127.0.0.1:55440", "example.invalid:55439"].map((host) => ({ RECOVERY_DATABASE_URL: `postgresql://fixture:fixture@${host}/rodovo_recovery_test` })),
    { RECOVERY_DATABASE_URL: `${safe.RECOVERY_DATABASE_URL}?schema=other` },
    { RECOVERY_DATABASE_URL: safe.RECOVERY_DATABASE_URL.replace("fixture:fixture", "other:other") },
  ]) assert.throws(() => getRecoveryEnvironment({ ...safe, ...mutation }));
});
