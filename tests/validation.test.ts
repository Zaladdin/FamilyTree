import test from "node:test";
import assert from "node:assert/strict";
import { parseCreateFamilyInput } from "@/lib/family-management";
import { HttpError } from "@/lib/http-error";
import {
  parseAddPersonInput,
  parseCreateStoryInput,
  parseUpdatePersonInput,
} from "@/lib/request-validation";

test("parseAddPersonInput trims user input", () => {
  const payload = parseAddPersonInput({
    firstName: "  Тимур  ",
    lastName: " Ахмедов ",
    middleName: " Ахмедович ",
    gender: "male",
    birthDate: " 1991 ",
    birthPlace: " Баку ",
    biography: "  Биография   с   пробелами ",
    relationshipKind: "child",
    relativePersonId: " timur ",
  });

  assert.equal(payload.firstName, "Тимур");
  assert.equal(payload.lastName, "Ахмедов");
  assert.equal(payload.middleName, "Ахмедович");
  assert.equal(payload.birthPlace, "Баку");
  assert.equal(payload.biography, "Биография с пробелами");
  assert.equal(payload.relativePersonId, "timur");
});

test("parseUpdatePersonInput requires deathDate for deceased person", () => {
  assert.throws(
    () =>
      parseUpdatePersonInput({
        firstName: "Тимур",
        lastName: "Ахмедов",
        middleName: "",
        gender: "male",
        birthDate: "1991",
        birthPlace: "Баку",
        biography: "bio",
        note: "",
        status: "deceased",
        deathDate: "",
      }),
    (error) =>
      error instanceof HttpError &&
      error.status === 400 &&
      /Дата смерти/.test(error.message),
  );
});

test("parseCreateFamilyInput validates required fields", () => {
  assert.throws(
    () =>
      parseCreateFamilyInput({
        title: "",
        surname: "Ахмедовы",
        region: "Баку",
        description: "desc",
      }),
    (error) =>
      error instanceof HttpError &&
      error.status === 400 &&
      /Название семьи/.test(error.message),
  );
});

test("parseCreateStoryInput trims narrator and title", () => {
  const payload = parseCreateStoryInput({
    title: "  Легенда о прадеде  ",
    body: "  Подробный   рассказ о человеке. ",
    narrator: " Ахмед Магомедов ",
  });

  assert.equal(payload.title, "Легенда о прадеде");
  assert.equal(payload.body, "Подробный рассказ о человеке.");
  assert.equal(payload.narrator, "Ахмед Магомедов");
});
