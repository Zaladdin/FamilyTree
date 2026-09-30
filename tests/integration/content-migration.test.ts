import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { disconnectTestPrisma, withTestUser } from "./helpers";

after(disconnectTestPrisma);

test("legacy timeline migration recognizes corrected dates and leaves custom events intact", async () => {
  await withTestUser(async ({ prisma, user }) => {
    const { createFamilySpace } = await import("@/lib/family-admin-repository");
    const { slug } = await createFamilySpace({ user, input: {
      title: "Тест хронологии", surname: user.id, region: "Баку", description: "Disposable migration fixture",
    } });
    const family = await prisma.family.findUniqueOrThrow({ where: { slug } });
    const source = await readFile(path.resolve("prisma/migrations/20260928030000_story_lifecycle/migration.sql"), "utf8");
    const start = source.indexOf('UPDATE "TimelineEvent" AS birth');
    assert.ok(start >= 0);
    const classification = source.slice(start).trim().replace(/;$/, "");
    assert.ok(!classification.includes(";"), "execute only the migration classification statement");
    const createdAt = new Date("2026-01-10T12:00:00Z");
    const later = new Date("2026-01-10T12:00:01Z");
    const cases = [
      { label: "1980 - рождение", date: "1981", expected: "birth" },
      { label: "1980 - рождение", date: "1980", expected: "birth" },
      { label: "01.02.1980 - рождение", date: "1981", expected: "birth" },
      { label: "1980 - рождение в Баку", date: "1981", expected: "custom" },
      { label: "1980 - рождение", date: "1981", missingCompanion: true, expected: "custom" },
      { label: "1980 - рождение", date: "1981", wrongCompanion: true, expected: "custom" },
      { label: "1980 - рождение", date: "1981", birthTime: later, expected: "custom" },
      { label: "1980 - рождение", date: "1981", companionTime: later, expected: "custom" },
    ];
    for (const [index, item] of cases.entries()) {
      const person = await prisma.person.create({ data: {
        id: randomUUID(), familyId: family.id, firstName: `Тест ${index}`, lastName: "Хронология", gender: "female",
        birthDate: item.date, birthPlace: "Баку", status: "living", biography: "", createdAt,
        timelineEvents: { create: [
          { label: item.label, order: 0, createdAt: item.birthTime ?? createdAt },
          ...(!item.missingCompanion ? [{ label: `${item.wrongCompanion ? "2025" : "2026"} - добавлен(а) в цифровое дерево семьи`, order: 1, createdAt: item.companionTime ?? createdAt }] : []),
          { label: "Пользовательское событие", order: 2, createdAt },
        ] },
      } });
      // The SQL comes from the reviewed migration; bind this fixture's ID so no
      // other concurrent test's records can be classified by the replay.
      await prisma.$executeRawUnsafe(`${classification} AND person."id" = $1`, person.id);
      const events = await prisma.timelineEvent.findMany({ where: { personId: person.id }, orderBy: { order: "asc" } });
      assert.equal(events[0].kind, item.expected, `case ${index}`);
      assert.equal(events[0].label, item.label);
      assert.equal(events.at(-1)?.kind, "custom");
      assert.equal(events.at(-1)?.label, "Пользовательское событие");
    }
  });
});
