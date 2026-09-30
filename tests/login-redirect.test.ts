import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/auth/login/route";

const origin = "http://localhost:3000";
const loginUrl = `${origin}/api/auth/login`;

// These requests stop at field/origin validation, before rate limiting,
// authentication, session creation, or any database access.
function invalidLoginRequest(redirectTo: string, useNextRequest = false) {
  const init = {
    method: "POST",
    headers: { origin },
    body: new URLSearchParams({ email: "", password: "", redirectTo }),
  };
  return useNextRequest ? new NextRequest(loginUrl, init) : new Request(loginUrl, init);
}

function redirectedLogin(response: Response, expectedOrigin = origin) {
  assert.equal(response.status, 303);
  const location = response.headers.get("location");
  assert.ok(location);
  const url = new URL(location);
  assert.equal(url.origin, expectedOrigin);
  assert.equal(url.pathname, "/login");
  assert.equal(url.hash, "");
  assert.ok(url.searchParams.get("error"));
  assert.deepEqual([...url.searchParams.keys()].sort(), ["error", "redirectTo"]);
  return url;
}

test("invalid email retains a safe destination including its query and fragment", async () => {
  const destination = "/family/akhmedov?person=timur&tab=photos#memory-panel";
  const response = await POST(invalidLoginRequest(destination));
  const url = redirectedLogin(response);

  assert.equal(url.searchParams.get("redirectTo"), destination);
  assert.match(url.searchParams.get("error")!, /Email/);
});

test("invalid password retains the destination before credential validation", async () => {
  const request = new NextRequest(loginUrl, {
    method: "POST",
    headers: { origin },
    body: new URLSearchParams({
      email: "not-authenticated@example.test",
      password: "",
      redirectTo: "/onboarding/family",
    }),
  });
  const url = redirectedLogin(await POST(request));

  assert.equal(url.searchParams.get("redirectTo"), "/onboarding/family");
  assert.match(url.searchParams.get("error")!, /Пароль/);
});

test("external or malformed destinations fall back to the family list", async () => {
  for (const destination of [
    "https://outside.example/path",
    "//outside.example/path",
    "/\\outside.example/path",
    "/%2F%2Foutside.example/path",
    "/family/demo\r\nLocation:https://outside.example",
    "",
  ]) {
    const url = redirectedLogin(await POST(invalidLoginRequest(destination, true)));
    assert.equal(url.searchParams.get("redirectTo"), "/families");
    assert.match(url.searchParams.get("error")!, /Email/);
  }
});

test("a rejected origin neither reads form data nor uses its destination", async () => {
  const request = new Request(loginUrl, {
    method: "POST",
    headers: { origin: "https://outside.example" },
    body: new URLSearchParams({
      email: "",
      password: "",
      redirectTo: "/family/untrusted-destination#people-panel",
    }),
  });
  const url = redirectedLogin(await POST(request));

  assert.equal(request.bodyUsed, false);
  assert.equal(url.searchParams.get("redirectTo"), "/families");
  assert.match(url.searchParams.get("error")!, /недопустимый источник/);
});

test("a normalized NextRequest keeps the browser's loopback host and safe destination on login error", async () => {
  const browserOrigin = "http://127.0.0.1:3000";
  const destination = "/family/akhmedov?person=timur#memory-panel";
  const request = new NextRequest(`${browserOrigin}/api/auth/login`, {
    method: "POST",
    headers: { host: "127.0.0.1:3000", origin: browserOrigin },
    body: new URLSearchParams({ email: "", password: "", redirectTo: destination }),
  });
  const url = redirectedLogin(await POST(request), browserOrigin);

  assert.equal(request.bodyUsed, true);
  assert.equal(url.searchParams.get("redirectTo"), destination);
  assert.match(url.searchParams.get("error")!, /Email/);
});

test("restoring the loopback host does not trust a different scheme, port, or external Origin", async () => {
  const browserOrigin = "http://127.0.0.1:3000";
  for (const suppliedOrigin of [
    "https://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "https://outside.example",
  ]) {
    const request = new NextRequest(`${browserOrigin}/api/auth/login`, {
      method: "POST",
      headers: { host: "127.0.0.1:3000", origin: suppliedOrigin },
      body: new URLSearchParams({ email: "", password: "", redirectTo: "/onboarding/family" }),
    });
    const url = redirectedLogin(await POST(request), browserOrigin);

    assert.equal(request.bodyUsed, false);
    assert.equal(url.searchParams.get("redirectTo"), "/families");
    assert.match(url.searchParams.get("error")!, /недопустимый источник/);
  }
});
