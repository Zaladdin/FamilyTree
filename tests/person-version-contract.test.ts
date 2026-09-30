import test from "node:test";
import assert from "node:assert/strict";
import { HttpError } from "@/lib/http-error";
import { parseUpdatePersonInput } from "@/lib/request-validation";

const personUpdate = {
  firstName: "Тест", lastName: "Тестов", gender: "male", birthDate: "1950",
  birthPlace: "Баку", biography: "Черновик пользователя", status: "living",
};

test("person updates require the revision read by the editor", () => {
  assert.throws(() => parseUpdatePersonInput(personUpdate),
    (error: unknown) => error instanceof HttpError && error.status === 400 && /верси/i.test(error.message));
});

test("person update revisions accept zero and preserve subsequent integer values", () => {
  for (const expectedVersion of [0, 1, 43, Number.MAX_SAFE_INTEGER]) {
    const result = parseUpdatePersonInput({ ...personUpdate, expectedVersion });
    assert.equal(result.expectedVersion, expectedVersion);
    assert.equal(result.biography, personUpdate.biography);
  }
});

test("person updates reject coerced, negative, fractional and unsafe revisions", () => {
  for (const expectedVersion of [null, "0", "43", "", true, false, -1, 0.5, NaN, Infinity, -Infinity,
    Number.MAX_SAFE_INTEGER + 1, {}, [], [0]]) {
    assert.throws(() => parseUpdatePersonInput({ ...personUpdate, expectedVersion }),
      (error: unknown) => error instanceof HttpError && error.status === 400 && /верси/i.test(error.message),
      `invalid revision: ${String(expectedVersion)}`);
  }
});

test("a versioned update keeps existing name and life-date validation", () => {
  assert.throws(() => parseUpdatePersonInput({ ...personUpdate, expectedVersion: 0, firstName: " " }),
    (error: unknown) => error instanceof HttpError && error.status === 400 && /Имя/.test(error.message));
  assert.throws(() => parseUpdatePersonInput({ ...personUpdate, expectedVersion: 0, status: "deceased", deathDate: "1949" }),
    (error: unknown) => error instanceof HttpError && error.status === 400 && /раньше даты рождения/.test(error.message));
});
