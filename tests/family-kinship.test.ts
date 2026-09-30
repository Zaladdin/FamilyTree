import test from "node:test";
import assert from "node:assert/strict";
import { getFamilyKinship } from "@/lib/family-kinship";
import type { Family, FamilyPerson, FamilyRelationship } from "@/lib/types";

function person(id: string, gender: FamilyPerson["gender"] = "male"): FamilyPerson {
  return {
    id, gender, firstName: id, lastName: "Семья", birthDate: "1980", birthPlace: "Баку",
    status: "living", isArchived: false, biography: "", timeline: [],
    media: { photos: 0, audio: 0, documents: 0 }, mediaAssets: [], stories: [],
  };
}
const parent = (fromPersonId: string, toPersonId: string): FamilyRelationship => ({ fromPersonId, toPersonId, type: "parent" });
const spouse = (fromPersonId: string, toPersonId: string): FamilyRelationship => ({ fromPersonId, toPersonId, type: "spouse" });
function family(people: FamilyPerson[], relationships: FamilyRelationship[]): Family {
  return {
    id: "kinship-test", slug: "kinship-test", title: "Семья", surname: "Семья", description: "", region: "", coverQuote: "",
    stats: { people: people.length, photos: 0, audio: 0, stories: 0, contributors: 0 },
    memberships: [], digitizationQueue: [], archivedPeople: [], auditLog: [], people, relationships,
  };
}
function labels(data: Family, focusId: string) {
  return Object.fromEntries([...getFamilyKinship(data, focusId)].map(([id, value]) => [id, value.label]));
}

test("direct parents, spouse, children and half siblings have explicit labels and witnessed paths", () => {
  const data = family([person("focus"), person("dad"), person("mom", "female"), person("wife", "female"), person("son"), person("daughter", "female"), person("brother"), person("sister", "female")], [
    parent("dad", "focus"), parent("mom", "focus"), spouse("wife", "focus"), parent("focus", "son"), parent("focus", "daughter"), parent("dad", "brother"), parent("mom", "sister"),
  ]);
  assert.deepEqual(labels(data, "focus"), { dad: "Отец", mom: "Мать", wife: "Жена", daughter: "Дочь", son: "Сын", brother: "Брат", sister: "Сестра" });
  assert.deepEqual(getFamilyKinship(data, "focus").get("brother"), { label: "Брат", pathIds: ["focus", "dad", "brother"], distance: 2 });
  assert.equal(getFamilyKinship(data, "focus").has("focus"), false);
});

test("grandparents and grandchildren require two recorded parent edges", () => {
  const data = family([person("focus"), person("parent"), person("grandpa"), person("grandma", "female"), person("child"), person("grandson"), person("granddaughter", "female")], [
    parent("parent", "focus"), parent("grandpa", "parent"), parent("grandma", "parent"), parent("focus", "child"), parent("child", "grandson"), parent("child", "granddaughter"),
  ]);
  const result = getFamilyKinship(data, "focus");
  assert.equal(result.get("grandpa")?.label, "Дедушка");
  assert.equal(result.get("grandma")?.label, "Бабушка");
  assert.equal(result.get("grandson")?.label, "Внук");
  assert.deepEqual(result.get("granddaughter"), { label: "Внучка", pathIds: ["focus", "child", "granddaughter"], distance: 2 });
});

test("wife's actual parents are Тесть and Тёща; their daughter's husband is Зять", () => {
  const data = family([person("husband"), person("wife", "female"), person("wife-dad"), person("wife-mom", "female")], [
    spouse("wife", "husband"), parent("wife-dad", "wife"), parent("wife-mom", "wife"),
  ]);
  const result = getFamilyKinship(data, "husband");
  assert.deepEqual(result.get("wife-mom"), { label: "Тёща", pathIds: ["husband", "wife", "wife-mom"], distance: 2 });
  assert.equal(result.get("wife-dad")?.label, "Тесть");
  assert.equal(getFamilyKinship(data, "wife-mom").get("husband")?.label, "Зять");
  assert.equal(getFamilyKinship(data, "wife-dad").get("husband")?.label, "Зять");
});

test("husband's actual parents are Свёкор and Свекровь; their son's wife is Невестка", () => {
  const data = family([person("wife", "female"), person("husband"), person("husband-dad"), person("husband-mom", "female")], [
    spouse("wife", "husband"), parent("husband-dad", "husband"), parent("husband-mom", "husband"),
  ]);
  const result = getFamilyKinship(data, "wife");
  assert.equal(result.get("husband-dad")?.label, "Свёкор");
  assert.deepEqual(result.get("husband-mom"), { label: "Свекровь", pathIds: ["wife", "husband", "husband-mom"], distance: 2 });
  assert.equal(getFamilyKinship(data, "husband-dad").get("wife")?.label, "Невестка");
  assert.equal(getFamilyKinship(data, "husband-mom").get("wife")?.label, "Невестка");
});

test("in-law parent label follows spouse gender, not focus gender", () => {
  const data = family([person("focus", "female"), person("wife", "female"), person("her-mom", "female")], [spouse("focus", "wife"), parent("her-mom", "wife")]);
  assert.equal(getFamilyKinship(data, "focus").get("her-mom")?.label, "Тёща");
});

test("spouse siblings and sibling spouses use clear perspective-specific labels", () => {
  const data = family([person("focus"), person("wife", "female"), person("wife-parent"), person("wife-brother"), person("wife-sister", "female"), person("focus-parent"), person("brother"), person("sister", "female"), person("brother-wife", "female"), person("sister-husband")], [
    spouse("focus", "wife"), parent("wife-parent", "wife"), parent("wife-parent", "wife-brother"), parent("wife-parent", "wife-sister"), parent("focus-parent", "focus"), parent("focus-parent", "brother"), parent("focus-parent", "sister"), spouse("brother-wife", "brother"), spouse("sister", "sister-husband"),
  ]);
  const result = getFamilyKinship(data, "focus");
  assert.equal(result.get("wife-brother")?.label, "Брат жены");
  assert.equal(result.get("wife-sister")?.label, "Сестра жены");
  assert.deepEqual(result.get("brother-wife"), { label: "Жена брата", pathIds: ["focus", "focus-parent", "brother", "brother-wife"], distance: 3 });
  assert.equal(result.get("sister-husband")?.label, "Муж сестры");
  assert.equal(getFamilyKinship(data, "wife").get("brother")?.label, "Брат мужа");
  assert.equal(getFamilyKinship(data, "wife").get("sister")?.label, "Сестра мужа");
});

test("aunts, uncles, nieces and nephews use actual shared-parent paths", () => {
  const data = family([person("focus"), person("mom", "female"), person("grandparent"), person("uncle"), person("aunt", "female"), person("sibling"), person("nephew"), person("niece", "female")], [
    parent("mom", "focus"), parent("grandparent", "mom"), parent("grandparent", "uncle"), parent("grandparent", "aunt"), parent("mom", "sibling"), parent("sibling", "nephew"), parent("sibling", "niece"),
  ]);
  const result = getFamilyKinship(data, "focus");
  assert.equal(result.get("uncle")?.label, "Дядя");
  assert.equal(result.get("aunt")?.label, "Тётя");
  assert.equal(result.get("nephew")?.label, "Племянник");
  assert.deepEqual(result.get("niece"), { label: "Племянница", pathIds: ["focus", "mom", "sibling", "niece"], distance: 3 });
});

test("marriage never implies a missing parent, sibling, grandparent or child edge", () => {
  const data = family([person("focus"), person("dad"), person("dad-wife", "female"), person("wife-dad"), person("wife-child"), person("wife-child-spouse", "female")], [
    parent("dad", "focus"), spouse("dad", "dad-wife"), parent("wife-dad", "dad-wife"), parent("dad-wife", "wife-child"), spouse("wife-child", "wife-child-spouse"),
  ]);
  assert.deepEqual(labels(data, "focus"), { dad: "Отец" });
  assert.equal(getFamilyKinship(data, "dad-wife").has("focus"), false);
});

test("partial parent records still derive half siblings and in-laws, without inventing co-parents", () => {
  const data = family([person("focus"), person("wife", "female"), person("her-mom", "female"), person("her-mom-husband"), person("her-half-brother")], [
    spouse("wife", "focus"), parent("her-mom", "wife"), spouse("her-mom-husband", "her-mom"), parent("her-mom", "her-half-brother"),
  ]);
  const result = getFamilyKinship(data, "focus");
  assert.equal(result.get("her-mom")?.label, "Тёща");
  assert.equal(result.get("her-half-brother")?.label, "Брат жены");
  assert.equal(result.has("her-mom-husband"), false);
});

test("multiple marriages keep every actual spouse's family but do not label another spouse as a relative", () => {
  const data = family([person("focus"), person("wife-a", "female"), person("wife-b", "female"), person("a-dad"), person("b-mom", "female"), person("other-husband")], [
    spouse("focus", "wife-a"), spouse("wife-b", "focus"), parent("a-dad", "wife-a"), parent("b-mom", "wife-b"), spouse("wife-a", "other-husband"),
  ]);
  const result = getFamilyKinship(data, "focus");
  assert.equal(result.get("wife-a")?.label, "Жена");
  assert.equal(result.get("wife-b")?.label, "Жена");
  assert.equal(result.get("a-dad")?.label, "Тесть");
  assert.equal(result.get("b-mom")?.label, "Тёща");
  assert.equal(result.has("other-husband"), false);
});

test("direct roles including siblings take priority over competing derived labels", () => {
  const data = family([person("focus"), person("dad"), person("wife", "female"), person("sibling"), person("grandparent")], [
    parent("dad", "focus"), parent("dad", "sibling"), spouse("focus", "wife"), parent("sibling", "wife"), parent("dad", "wife"), parent("grandparent", "dad"), parent("grandparent", "sibling"),
  ]);
  const result = getFamilyKinship(data, "focus");
  assert.equal(result.get("dad")?.label, "Отец");
  assert.equal(result.get("wife")?.label, "Жена");
  assert.equal(result.get("sibling")?.label, "Брат");
  assert.deepEqual(result.get("sibling")?.pathIds, ["focus", "dad", "sibling"]);
});

test("duplicate/reversed spouse edges and input reordering leave labels and witness paths deterministic", () => {
  const data = family([person("focus"), person("parent-b"), person("parent-a"), person("sibling"), person("wife", "female")], [
    parent("parent-b", "focus"), parent("parent-a", "focus"), parent("parent-b", "sibling"), parent("parent-a", "sibling"), spouse("wife", "focus"), spouse("focus", "wife"), parent("parent-a", "focus"),
  ]);
  const before = structuredClone(data);
  const first = getFamilyKinship(data, "focus");
  const reordered = { ...data, people: [...data.people].reverse(), relationships: [...data.relationships].reverse() };
  assert.deepEqual([...getFamilyKinship(reordered, "focus")], [...first]);
  assert.deepEqual(first.get("sibling")?.pathIds, ["focus", "parent-a", "sibling"]);
  assert.equal(first.size, 4);
  assert.deepEqual(data, before);
});

test("ancestry cycles, self edges and disconnected people terminate without repeated path IDs", () => {
  const data = family([person("focus"), person("a"), person("b"), person("unrelated")], [
    parent("a", "focus"), parent("focus", "b"), parent("b", "a"), spouse("focus", "focus"), parent("a", "a"), parent("missing", "focus"),
  ]);
  const result = getFamilyKinship(data, "focus");
  assert.equal(result.get("a")?.label, "Отец");
  assert.equal(result.get("b")?.label, "Сын");
  assert.equal(result.has("focus"), false);
  assert.equal(result.has("unrelated"), false);
  for (const value of result.values()) {
    assert.equal(value.pathIds.length, new Set(value.pathIds).size);
    assert.equal(value.distance, value.pathIds.length - 1);
    assert.ok(value.distance <= 3);
  }
});

test("archived and absent intermediates cannot produce kinship and an invalid focus returns an empty map", () => {
  const archived = person("archived");
  archived.isArchived = true;
  const data = family([person("focus"), archived, person("sibling"), person("grandparent")], [
    parent("archived", "focus"), parent("archived", "sibling"), parent("grandparent", "archived"), parent("missing", "focus"),
  ]);
  assert.equal(getFamilyKinship(data, "focus").size, 0);
  assert.equal(getFamilyKinship(data, "archived").size, 0);
  assert.equal(getFamilyKinship(data, "missing").size, 0);
  assert.equal(getFamilyKinship(family([], []), "focus").size, 0);
});

test("unsupported cousin and great-grandparent paths are omitted rather than mislabelled", () => {
  const data = family([person("focus"), person("dad"), person("grandparent"), person("great-grandparent"), person("uncle"), person("cousin")], [
    parent("dad", "focus"), parent("grandparent", "dad"), parent("great-grandparent", "grandparent"), parent("grandparent", "uncle"), parent("uncle", "cousin"),
  ]);
  const result = getFamilyKinship(data, "focus");
  assert.equal(result.get("uncle")?.label, "Дядя");
  assert.equal(result.has("cousin"), false);
  assert.equal(result.has("great-grandparent"), false);
});
