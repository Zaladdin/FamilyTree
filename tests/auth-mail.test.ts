import test from "node:test";
import assert from "node:assert/strict";
import { createAuthMailSender, sendAuthEmail, type AuthMailMessage } from "@/lib/auth-mail";

const input = { to: "synthetic@example.test", kind: "password_reset" as const, token: "a".repeat(64) };

test("unconfigured delivery is unavailable without sending or pretending success", async () => {
  assert.equal(await sendAuthEmail(input), false);
  assert.equal(await createAuthMailSender(null)(input), false);
});

test("local injectable mail adapter receives fragment-only one-time links", async () => {
  const messages: AuthMailMessage[] = [];
  const sender = createAuthMailSender({ send: async (message) => { messages.push(message); } }, "https://archive.example.test");
  for (const kind of ["verify_email", "password_reset", "family_invitation"] as const) {
    assert.equal(await sender({ ...input, kind, familyTitle: "Семья для проверки" }), true);
  }
  assert.equal(messages.length, 3);
  const paths = ["/verify-email", "/reset-password", "/invitations/accept"];
  messages.forEach((message, index) => {
    const link = new URL(message.text.match(/https:\/\/\S+/)![0]);
    assert.equal(link.origin, "https://archive.example.test");
    assert.equal(link.pathname, paths[index]);
    assert.equal(link.search, "");
    assert.equal(link.hash, `#token=${input.token}`);
    assert.equal(message.to, input.to);
    assert.ok(!message.subject.includes(input.token));
  });
});

test("mail transport errors do not expose provider details or token values", async () => {
  const sender = createAuthMailSender({ send: async () => { throw new Error(`secret provider details ${input.token}`); } }, "https://archive.example.test");
  assert.equal(await sender(input), false);
});

test("mail links require a fixed secure origin and reject recipient header injection", async () => {
  const transport = { send: async () => undefined };
  for (const origin of [undefined, "http://archive.example.test", "https://user:password@archive.example.test", "https://archive.example.test/path", "https://archive.example.test?redirect=bad", "javascript:bad"]) {
    assert.throws(() => createAuthMailSender(transport, origin), /адрес/);
  }
  const sender = createAuthMailSender(transport, "https://archive.example.test");
  await assert.rejects(sender({ ...input, to: "synthetic@example.test\r\nBcc: another@example.test" }), /email/);
});
