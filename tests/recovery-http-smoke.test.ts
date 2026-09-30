import assert from "node:assert/strict";
import test from "node:test";
import { assertRecoveryHttpDatabase } from "../scripts/recovery-http-smoke";

test("recovery HTTP accepts only the explicitly named disposable target", () => {
  const target = "postgresql://synthetic:synthetic@127.0.0.1:55432/rodovo_recovery_test";
  assert.equal(assertRecoveryHttpDatabase(target), target);
  for (const rejected of [
    target.replace("rodovo_recovery_test", "rodovo_ci_test"),
    target.replace("127.0.0.1", "example.invalid"),
    target.replace("55432", "5432"),
    `${target}?host=example.invalid`,
    `${target}#ignored`,
    "not-a-database-url",
  ]) assert.throws(() => assertRecoveryHttpDatabase(rejected));
});
