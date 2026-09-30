import test from "node:test";
import assert from "node:assert/strict";
import { buildPersonTimeline } from "@/lib/person-timeline";

const person = { birthDate: "1980", deathDate: "2020", status: "deceased" as const };
test("life events reflect current card dates and replace stored system labels", () => {
  const timeline = buildPersonTimeline(person, [
    { kind: "birth", label: "1970 - рождение" },
    { kind: "custom", label: "1998 - поступление\nПамятное событие" },
    { kind: "death", label: "2010 - смерть" },
  ]);
  assert.ok(timeline.includes("1980 - рождение"));
  assert.ok(timeline.includes("2020 - смерть"));
  assert.ok(timeline.includes("1998 - поступление\nПамятное событие"));
  assert.ok(!timeline.some((label) => label.startsWith("1970") || label.startsWith("2010")));
});
test("returning to living removes only the system death event", () => {
  const timeline = buildPersonTimeline({ ...person, status: "living" }, [
    { kind: "death", label: "2020 - смерть" }, { kind: "custom", label: "2020 - память о бабушке" },
  ]);
  assert.deepEqual(timeline, ["1980 - рождение", "2020 - память о бабушке"]);
});
test("custom historical rows are retained without guessing their provenance", () => {
  const rows = [{ label: "1932 - рождение в Губе" }, { kind: "custom", label: "1980 - рождение" }, { kind: "custom", label: "Семейное событие" }];
  const before = structuredClone(rows);
  const timeline = buildPersonTimeline({ birthDate: "1981", status: "living" }, rows);
  assert.deepEqual(timeline, ["1981 - рождение", ...rows.map((row) => row.label)]);
  assert.deepEqual(rows, before);
});
