import test from "node:test";
import assert from "node:assert/strict";
import { requestFamilyAction } from "@/lib/family-action-request";

test("story mutations retain the saved story identity and safe revision", async () => {
  assert.deepEqual(await requestFamilyAction(async () => Response.json({ personId: "person", storyId: "story", version: 2 }), "Ошибка"), { personId: "person", storyId: "story", version: 2 });
  for (const version of [-1, 1.5, "2", null]) {
    assert.deepEqual(await requestFamilyAction(async () => Response.json({ storyId: "story", version }), "Ошибка"), { storyId: "story" });
  }
});

test("successful graph warnings retain readable strings and reject malformed payloads", async () => {
  const warnings = ["Мария → Павел: у ребёнка уже два родителя."];
  assert.deepEqual(await requestFamilyAction(async () => Response.json({ personId: "child", warnings }), "Ошибка"), { personId: "child", warnings });
  for (const invalid of ["warning", [null], [{ private: "data" }]]) {
    assert.deepEqual(await requestFamilyAction(async () => Response.json({ personId: "child", warnings: invalid }), "Ошибка"), { personId: "child" });
  }
});

test("network failure has actionable Russian feedback and never retries a mutation", async () => {
  let attempts = 0;
  await assert.rejects(requestFamilyAction(async () => { attempts++; throw new TypeError("Failed to fetch"); }, "Ошибка сохранения"), /Не удалось связаться с сервером/);
  assert.equal(attempts, 1);
});
test("non-JSON and internal server responses are safe; validation feedback is retained", async () => {
  for (const response of [new Response("<html>proxy error</html>", { status: 502 }), Response.json({ error: "private Prisma details" }, { status: 500 }), Response.json(null)]) {
    await assert.rejects(requestFamilyAction(async () => response, "Ошибка сохранения"), /Ошибка сохранения/);
  }
  await assert.rejects(requestFamilyAction(async () => Response.json({ error: "Укажите дату смерти" }, { status: 400 }), "Ошибка сохранения"), /Укажите дату смерти/);
  assert.deepEqual(await requestFamilyAction(async () => Response.json({ personId: "test-only" }), "Ошибка сохранения"), { personId: "test-only" });
});

test("missing sibling schema shows a fixed explanation without trusting server details or retrying", async () => {
  let attempts = 0;
  await assert.rejects(requestFamilyAction(async () => {
    attempts++;
    return Response.json({ code: "SIBLING_SCHEMA_NOT_READY", error: "private Prisma connector details" }, { status: 503 });
  }, "Ошибка сохранения"), {
    message: "Для связи «брат / сестра» требуется обновление базы данных. Заполненные данные остались в форме. Обратитесь к администратору.",
  });
  assert.equal(attempts, 1);
});

test("only the known unavailable-schema response gets a special message", async () => {
  for (const response of [
    Response.json({ code: "UNKNOWN", error: "private Prisma details" }, { status: 503 }),
    Response.json({ code: "SIBLING_SCHEMA_NOT_READY", error: "private Prisma details" }, { status: 500 }),
    new Response("not JSON", { status: 503 }),
  ]) {
    await assert.rejects(requestFamilyAction(async () => response, "Ошибка сохранения"), {
      message: "Ошибка сохранения Сервер временно недоступен. Попробуйте позже.",
    });
  }
});
