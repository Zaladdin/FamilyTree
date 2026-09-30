import test from "node:test";
import assert from "node:assert/strict";
import { buildFamilyTreeExport } from "@/lib/family-tree-export";
import { buildFamilyRadialLayout } from "@/lib/family-radial-layout";
import { getFamilyBySlug } from "@/lib/mock-data";
import type { Family } from "@/lib/types";

function fixture(): Family {
  const sample = getFamilyBySlug("akhmedov");
  assert.ok(sample);
  const people = ["parent", "child", "spouse", "unrelated"].map((id, index) => ({
    ...structuredClone(sample.people[0]), id, firstName: ["Рауф", "Заладдин", "Эмилия", "Айтен"][index],
    middleName: "Адалат Оглы", lastName: "Алекперов", biography: "PRIVATE_BIOGRAPHY", note: "PRIVATE_NOTE",
  }));
  return { ...structuredClone(sample), title: "Семья Алекперовых", people, archivedPeople: [], relationships: [
    { type: "parent", fromPersonId: "parent", toPersonId: "child" },
    { type: "spouse", fromPersonId: "child", toPersonId: "spouse" },
  ] };
}

function unescapeXml(value: string) {
  return value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

test("exports include their selected scope and only recorded relationships, without private notes", () => {
  const family = fixture();
  const layout = buildFamilyRadialLayout(family, "child");
  for (const style of ["circle", "tree", "pyramid"] as const) {
    const result = buildFamilyTreeExport(family, layout, style);
    assert.ok(result.svg.startsWith("<svg"));
    assert.ok(result.width >= 1000 && result.height >= 800);
    const ids = [...result.svg.matchAll(/data-person-id="([^"]*)"/g)].map((match) => unescapeXml(match[1]));
    const expectedPeople = family.people.filter((person) => style === "circle" || person.id !== "unrelated");
    assert.deepEqual(ids.sort(), expectedPeople.map((person) => person.id).sort());
    assert.equal(result.peopleCount, expectedPeople.length);
    for (const person of expectedPeople) assert.ok(result.svg.includes(`${person.firstName} ${person.middleName} ${person.lastName}`));
    const relationships = [...result.svg.matchAll(/data-relationship-keys="([^"]*)"/g)].flatMap((match) => JSON.parse(unescapeXml(match[1])) as string[]);
    assert.deepEqual([...new Set(relationships)].sort(), ['parent:["parent","child"]', 'spouse:["child","spouse"]']);
    assert.ok(!result.svg.includes("PRIVATE_BIOGRAPHY") && !result.svg.includes("PRIVATE_NOTE"));
    assert.match(result.svg, /Родители и дети/);
    assert.match(result.svg, /Супруги/);
  }
});

test("circle export preserves supplied manual coordinates while botanical export arranges generations", () => {
  const family = fixture();
  const original = buildFamilyRadialLayout(family, "child");
  const layout = { ...original, nodes: original.nodes.map((node) => ({ ...node, x: node.x + 37, y: node.y + 51 })) };
  const circle = buildFamilyTreeExport(family, layout, "circle");
  for (const node of layout.nodes) assert.ok(circle.svg.includes(`data-x="${node.x}" data-y="${node.y}"`));
  const tree = buildFamilyTreeExport(family, layout, "tree");
  assert.notEqual(tree.svg, circle.svg);
  assert.match(tree.svg, /data-decoration="botanical-tree"/);
  assert.ok(!circle.svg.includes('data-decoration="botanical-tree"'));
});

test("SVG escapes hostile names, IDs, dates, family titles and path attributes without embedding resources", () => {
  const family = fixture();
  const attack = '<script>alert("x")</script>&\'"';
  family.title = attack;
  family.people[0].firstName = attack;
  family.people[0].id = attack;
  family.people[0].birthDate = attack;
  family.relationships = [];
  const layout = buildFamilyRadialLayout(family, null);
  for (const style of ["tree", "circle", "pyramid"] as const) {
    const { svg } = buildFamilyTreeExport(family, layout, style);
    assert.ok(!svg.includes("<script"));
    assert.ok(!svg.includes("<foreignObject") && !svg.includes("<image") && !svg.includes("href="));
    assert.ok(svg.includes("&lt;script&gt;"));
    assert.ok(svg.includes("&quot;x&quot;"));
    const ids = [...svg.matchAll(/data-person-id="([^"]*)"/g)].map((match) => unescapeXml(match[1]));
    assert.ok(ids.includes(attack));
  }
});

test("empty, filtered, very long-name and large exports have finite bounded dimensions", () => {
  const sample = fixture();
  const families: Family[] = [
    { ...sample, people: [], relationships: [] },
    { ...sample, people: sample.people.slice(0, 1), relationships: [] },
    { ...sample, people: Array.from({ length: 150 }, (_, index) => ({ ...sample.people[0], id: `person-${index}`, firstName: "Имя".repeat(120) })), relationships: Array.from({ length: 149 }, (_, index) => ({ type: "parent", fromPersonId: "person-0", toPersonId: `person-${index + 1}` })) },
  ];
  for (const family of families) for (const style of ["circle", "tree", "pyramid"] as const) {
    const { svg, width, height } = buildFamilyTreeExport(family, buildFamilyRadialLayout(family, null), style);
    assert.ok(Number.isFinite(width) && Number.isFinite(height));
    assert.ok(width > 0 && width <= 8192 && height > 0 && height <= 8192);
    assert.ok(!/NaN|Infinity|undefined/.test(svg));
    assert.equal([...svg.matchAll(/data-person-id=/g)].length, family.people.length);
  }
});

function branchFixture(): Family {
  const family = fixture();
  for (const id of ["mother", "sibling", "grandchild", "inlaw"]) {
    family.people.push({ ...family.people[0], id, firstName: id, middleName: "", lastName: "Семейный" });
  }
  family.relationships.push(
    { type: "spouse", fromPersonId: "parent", toPersonId: "mother" },
    { type: "parent", fromPersonId: "mother", toPersonId: "child" },
    { type: "parent", fromPersonId: "parent", toPersonId: "sibling" },
    { type: "parent", fromPersonId: "mother", toPersonId: "sibling" },
    { type: "parent", fromPersonId: "child", toPersonId: "grandchild" },
    { type: "parent", fromPersonId: "spouse", toPersonId: "grandchild" },
    { type: "parent", fromPersonId: "inlaw", toPersonId: "spouse" },
  );
  return family;
}

function exportedNodes(svg: string) {
  return new Map([...svg.matchAll(/<g data-person-id="([^"]*)" data-x="([^"]*)" data-y="([^"]*)"([^>]*)>/g)]
    .map((match) => [unescapeXml(match[1]), { x: Number(match[2]), y: Number(match[3]), attributes: match[4] }]));
}

test("botanical tree grows upward from recorded ancestors to selected person, siblings and descendants", () => {
  const family = branchFixture();
  const { svg, peopleCount } = buildFamilyTreeExport(family, buildFamilyRadialLayout(family, "child"), "tree", "child");
  const nodes = exportedNodes(svg);
  assert.deepEqual([...nodes.keys()].sort(), ["parent", "mother", "child", "sibling", "spouse", "grandchild"].sort());
  assert.equal(peopleCount, 6);
  assert.ok(nodes.get("parent")!.y > nodes.get("child")!.y);
  assert.ok(nodes.get("mother")!.y > nodes.get("sibling")!.y);
  assert.ok(nodes.get("child")!.y > nodes.get("grandchild")!.y);
  assert.equal(nodes.get("child")!.y, nodes.get("sibling")!.y);
  assert.match(nodes.get("parent")!.attributes, /data-is-root="true"/);
  assert.match(nodes.get("mother")!.attributes, /data-is-root="true"/);
  assert.match(nodes.get("child")!.attributes, /data-is-focus="true"/);
  assert.match(svg, /Корни — старшие предки · Ветви — потомки/);
  assert.match(svg, /Выбрано: Заладдин Адалат Оглы Алекперов/);
  assert.match(svg, /data-recorded-links="true" transform="translate\(0 [\d.]+\) scale\(1 -1\)"/);
  assert.ok(!svg.includes('parent:[&quot;inlaw&quot;,&quot;spouse&quot;]'));
});

test("choosing a spouse roots the poster in that person's own family without importing unrelated in-laws", () => {
  const family = branchFixture();
  const layout = buildFamilyRadialLayout(family, "child");
  const selectedChild = buildFamilyTreeExport(family, layout, "tree", "child");
  const selectedSpouse = buildFamilyTreeExport(family, layout, "tree", "spouse");
  assert.notEqual(selectedSpouse.svg, selectedChild.svg);
  const nodes = exportedNodes(selectedSpouse.svg);
  assert.deepEqual([...nodes.keys()].sort(), ["inlaw", "spouse", "child", "grandchild"].sort());
  assert.equal(selectedSpouse.peopleCount, 4);
  assert.ok(nodes.get("inlaw")!.y > nodes.get("spouse")!.y);
  assert.ok(nodes.get("spouse")!.y > nodes.get("grandchild")!.y);
  assert.match(nodes.get("spouse")!.attributes, /data-is-focus="true"/);
});

test("circle export uses only layout-visible people even when passed the complete family", () => {
  const family = branchFixture();
  const fullLayout = buildFamilyRadialLayout(family, "child");
  const layout = { ...fullLayout, nodes: fullLayout.nodes.filter((node) => ["child", "parent"].includes(node.person.id)) };
  const { svg, peopleCount } = buildFamilyTreeExport(family, layout, "circle", "spouse");
  assert.deepEqual([...exportedNodes(svg).keys()].sort(), ["child", "parent"]);
  assert.equal(peopleCount, 2);
  const keys = [...svg.matchAll(/data-relationship-keys="([^"]*)"/g)].flatMap((match) => JSON.parse(unescapeXml(match[1])) as string[]);
  assert.deepEqual(keys, ['parent:["parent","child"]']);
});

test("pyramid export places ancestors above descendants and uses the chosen branch rather than canvas scope", () => {
  const family = branchFixture();
  const fullLayout = buildFamilyRadialLayout(family, "child");
  const layout = { ...fullLayout, nodes: fullLayout.nodes.filter((node) => node.person.id === "child"), links: [] };
  const { svg, peopleCount } = buildFamilyTreeExport(family, layout, "pyramid", "child");
  const nodes = exportedNodes(svg);
  assert.deepEqual([...nodes.keys()].sort(), ["parent", "mother", "child", "sibling", "spouse", "grandchild"].sort());
  assert.equal(peopleCount, 6);
  assert.ok(nodes.get("parent")!.y < nodes.get("child")!.y);
  assert.ok(nodes.get("mother")!.y < nodes.get("sibling")!.y);
  assert.ok(nodes.get("child")!.y < nodes.get("grandchild")!.y);
  assert.equal(nodes.get("child")!.y, nodes.get("sibling")!.y);
  assert.match(nodes.get("child")!.attributes, /data-is-focus="true"/);
  assert.match(svg, /data-decoration="pyramid"/);
  assert.match(svg, /Пирамида · Старшие предки сверху · Потомки ниже/);
  assert.doesNotMatch(svg, /botanical-tree|Семейный круг|scale\(1 -1\)|КОРНИ СЕМЬИ/);
  const spouse = buildFamilyTreeExport(family, layout, "pyramid", "spouse");
  assert.deepEqual([...exportedNodes(spouse.svg).keys()].sort(), ["inlaw", "spouse", "child", "grandchild"].sort());
  assert.equal(spouse.peopleCount, 4);
});
