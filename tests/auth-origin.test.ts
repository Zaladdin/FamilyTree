import test, { after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/request-validation";
import { getRequestOrigin } from "@/lib/request-origin";

// Exercise the actual NextRequest normalization, not native Request alone or a
// hand-set flag that may not describe Next's live Route Handler adapter.
const previousNormalization = process.env.__NEXT_NO_MIDDLEWARE_URL_NORMALIZE;
delete process.env.__NEXT_NO_MIDDLEWARE_URL_NORMALIZE;
after(() => {
  if (previousNormalization === undefined) delete process.env.__NEXT_NO_MIDDLEWARE_URL_NORMALIZE;
  else process.env.__NEXT_NO_MIDDLEWARE_URL_NORMALIZE = previousNormalization;
});

const origin = "http://127.0.0.1:3000";
const requestUrl = `${origin}/api/auth/register`;

function localRequest(requestOrigin: string, host = "127.0.0.1:3000") {
  return new NextRequest(requestUrl, { headers: { host, origin: requestOrigin } });
}

test("NextRequest's normalized loopback URL retains the browser origin for CSRF and redirects", () => {
  const request = localRequest(origin);
  assert.equal(request.url, "http://localhost:3000/api/auth/register", "reproduce the framework normalization");
  assert.equal(getRequestOrigin(request), origin);
  assert.doesNotThrow(() => assertSameOrigin(request));

  for (const pathname of ["/onboarding/family", "/register?error=invalid", "/login", "/families"]) {
    const response = NextResponse.redirect(new URL(pathname, getRequestOrigin(request)), 303);
    assert.equal(new URL(response.headers.get("location")!).origin, origin);
  }
});

test("different hostname, scheme, port, and opaque origins remain forbidden", () => {
  for (const requestOrigin of [
    "http://localhost:3000",
    "https://outside.example",
    "http://127.0.0.1:3001",
    "https://127.0.0.1:3000",
    "http://[::1]:3000",
    "null",
  ]) {
    assert.throws(() => assertSameOrigin(localRequest(requestOrigin)), /недопустимый источник/);
  }
});

test("each literal loopback host accepts only its own browser origin, including default ports", () => {
  for (const expectedOrigin of [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
    "http://127.0.0.1",
    "https://127.0.0.1",
    "https://[::1]",
  ]) {
    const request = new NextRequest(`${expectedOrigin}/api/auth/register`, {
      headers: { host: new URL(expectedOrigin).host, origin: expectedOrigin },
    });
    assert.equal(getRequestOrigin(request), expectedOrigin);
    assert.doesNotThrow(() => assertSameOrigin(request));
  }
});

test("untrusted or malformed Host headers cannot override the request origin", () => {
  for (const host of [
    "outside.example:3000",
    "127.0.0.1:3001",
    "localhost:4000",
    "user@127.0.0.1:3000",
    "127.0.0.1:3000@outside.example",
    "127.0.0.1:3000/path",
    "127.0.0.1:3000?query",
    "127.0.0.1:3000#fragment",
    "127.0.0.1:3000\\path",
    "http://127.0.0.1:3000",
    "127.0.0.1:65536",
    "127.0.0.1:3000, outside.example",
    "127.0.0.1 :3000",
    "127.1:3000",
    "127.0.0.2:3000",
    "2130706433:3000",
    "0x7f000001:3000",
  ]) {
    const request = localRequest(origin, host);
    assert.equal(getRequestOrigin(request), "http://localhost:3000", `ignore invalid Host: ${host}`);
    assert.throws(() => assertSameOrigin(request), /недопустимый источник/);
  }
});

test("Origin and forwarded headers never select the accepted origin or redirect destination", () => {
  const request = new NextRequest(requestUrl, {
    headers: {
      origin: "https://outside.example",
      "x-forwarded-host": "127.0.0.1:3000",
      "x-forwarded-proto": "https",
      forwarded: "host=outside.example;proto=https",
    },
  });
  assert.equal(getRequestOrigin(request), "http://localhost:3000");
  assert.throws(() => assertSameOrigin(request), /недопустимый источник/);
  assert.equal(new URL("/login", getRequestOrigin(request)).origin, "http://localhost:3000");
});

test("external request URLs ignore even a valid loopback Host override", () => {
  for (const host of ["127.0.0.1", "localhost", "[::1]", "outside.example"]) {
    const request = new NextRequest("https://archive.example/api/auth/register", {
      headers: { host, origin: "https://archive.example" },
    });
    assert.equal(getRequestOrigin(request), "https://archive.example");
    assert.doesNotThrow(() => assertSameOrigin(request));
  }
});

test("requests without Origin retain the existing non-browser policy", () => {
  const request = new NextRequest(requestUrl, { headers: { host: "127.0.0.1:3000" } });
  assert.doesNotThrow(() => assertSameOrigin(request));
  assert.equal(getRequestOrigin(request), origin);
});
