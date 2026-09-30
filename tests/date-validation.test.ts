import test from "node:test";
import assert from "node:assert/strict";
import { HttpError } from "@/lib/http-error";
import { parseAddPersonInput, parseUpdatePersonInput } from "@/lib/request-validation";

const person = {
  firstName: "Тест", lastName: "Тестов", gender: "male", birthDate: "1950",
  birthPlace: "Баку", relationshipKind: "parent", relativePersonId: "relative",
  status: "deceased", deathDate: "2000", expectedVersion: 0,
};

for (const parse of [parseAddPersonInput, parseUpdatePersonInput]) {
  test(`${parse.name} preserves all supported date formats`, () => {
    for (const birthDate of ["1950", "1950-05", "1950-05-10", "10.05.1950", "05.1950"]) {
      assert.equal(parse({ ...person, birthDate: ` ${birthDate} ` }).birthDate, birthDate);
    }
  });

  test(`${parse.name} rejects invalid dotted months for birth and death`, () => {
    for (const field of ["birthDate", "deathDate"]) {
      for (const date of ["00.1950", "13.1950", "99.1950"]) {
        assert.throws(() => parse({ ...person, [field]: date }),
          (error: unknown) => error instanceof HttpError && error.status === 400 && /Месяц/.test(error.message),
          `${field}: ${date}`);
      }
    }
  });

  test(`${parse.name} rejects calendar errors and accepts leap days`, () => {
    for (const field of ["birthDate", "deathDate"]) {
      const base = { ...person, birthDate: "1000", deathDate: "2020" };
      for (const date of ["1900-02-29", "29.02.1900", "2001-02-29", "31.04.2000", "2000-01-00", "2000-00-01"]) {
        assert.throws(() => parse({ ...base, [field]: date }), HttpError, `${field}: ${date}`);
      }
      for (const date of ["2000-02-29", "29.02.2000", "2004-02-29", "30.04.2000"]) {
        assert.equal(parse({ ...base, [field]: date })[field as "birthDate" | "deathDate"], date);
      }
    }
  });

  test(`${parse.name} allows overlapping partial dates without inventing a day`, () => {
    for (const [birthDate, deathDate] of [
      ["1950-05-10", "1950-05"], ["10.05.1950", "05.1950"],
      ["1950-05-10", "1950"], ["1950", "1950-01-01"],
      ["1950-05", "1950-05-01"], ["1950-05", "05.1950"],
      ["1950-05-10", "10.05.1950"],
    ]) {
      assert.equal(parse({ ...person, birthDate, deathDate }).deathDate, deathDate);
    }
  });

  test(`${parse.name} rejects death that is certainly before birth at any precision`, () => {
    for (const [birthDate, deathDate] of [
      ["1950", "1949"], ["1950-01", "1949-12-31"],
      ["05.1950", "04.1950"], ["1950-05", "30.04.1950"],
      ["10.05.1950", "1950-04"], ["1950-05-10", "09.05.1950"],
    ]) {
      assert.throws(() => parse({ ...person, birthDate, deathDate }),
        (error: unknown) => error instanceof HttpError && error.status === 400 && /раньше даты рождения/.test(error.message),
        `${birthDate} / ${deathDate}`);
    }
  });
}
