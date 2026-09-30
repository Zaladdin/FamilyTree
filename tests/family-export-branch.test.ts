import test from "node:test";
import assert from "node:assert/strict";
import { getFamilyBySlug } from "@/lib/mock-data";
import { getFamilyExportBranch } from "@/lib/family-export-branch";
import type { Family } from "@/lib/types";

function fixture(): Family {
  const family = structuredClone(getFamilyBySlug("akhmedov")!);
  family.people.push(...["wife-father", "wife-mother", "unrelated"].map((id) => ({ ...structuredClone(family.people[0]), id, firstName: id })));
  family.relationships.push({ type: "parent", fromPersonId: "wife-father", toPersonId: "leyla" }, { type: "parent", fromPersonId: "wife-mother", toPersonId: "leyla" });
  return family;
}

test("roots are the oldest recorded ancestors, while siblings and descendants stay in the branch", () => {
  const family = fixture();
  const before = structuredClone(family);
  const branch = getFamilyExportBranch(family, "timur");
  assert.equal(branch.focusPersonId, "timur");
  assert.deepEqual(branch.rootIds, ["amina", "magomed", "zalikha"]);
  assert.deepEqual(branch.family.people.map((person) => person.id).sort(), ["ahmed", "amina", "ilyas", "leyla", "magomed", "safiya", "timur", "zalikha"]);
  assert.deepEqual(family, before);
  assert.ok(branch.family.relationships.every((edge) => branch.family.people.some((person) => person.id === edge.fromPersonId) && branch.family.people.some((person) => person.id === edge.toPersonId)));
});

test("changing export person uses their own ancestor roots, never their spouse's parents", () => {
  const family = fixture();
  const branch = getFamilyExportBranch(family, "leyla");
  assert.deepEqual(branch.rootIds, ["wife-father", "wife-mother"]);
  assert.deepEqual(branch.family.people.map((person) => person.id).sort(), ["leyla", "safiya", "timur", "wife-father", "wife-mother"]);
  assert.deepEqual(branch.family.relationships, family.relationships.filter((edge) => ["leyla", "safiya", "timur", "wife-father", "wife-mother"].includes(edge.fromPersonId) && ["leyla", "safiya", "timur", "wife-father", "wife-mother"].includes(edge.toPersonId)));
});

test("without grandparents recorded the parents become roots, with siblings as branches", () => {
  const family = fixture();
  family.people = family.people.filter((person) => !["magomed", "zalikha"].includes(person.id));
  const branch = getFamilyExportBranch(family, "timur");
  assert.deepEqual(branch.rootIds, ["ahmed", "amina"]);
  assert.ok(branch.family.people.some((person) => person.id === "ilyas"));
});

test("missing ancestors do not invent parenthood and an unrelated person starts their own tree", () => {
  const family = fixture();
  const branch = getFamilyExportBranch(family, "unrelated");
  assert.deepEqual(branch.rootIds, ["unrelated"]);
  assert.equal(branch.family.people.length, 1);
  assert.equal(branch.family.relationships.length, 0);
  const missing = getFamilyExportBranch(family, "missing");
  assert.equal(missing.focusPersonId, null);
  assert.equal(missing.family.people.length, 0);
});

test("ancestry cycles terminate, duplicates and archived or missing endpoints never create extra people", () => {
  const family = fixture();
  family.relationships.push({ type: "parent", fromPersonId: "timur", toPersonId: "magomed" }, ...family.relationships);
  family.people.find((person) => person.id === "unrelated")!.isArchived = true;
  const branch = getFamilyExportBranch(family, "timur");
  assert.ok(branch.family.people.length <= family.people.length);
  assert.equal(new Set(branch.family.people.map((person) => person.id)).size, branch.family.people.length);
  assert.ok(branch.family.people.every((person) => !person.isArchived));
  assert.equal(getFamilyExportBranch(family, "unrelated").family.people.length, 0);
});
