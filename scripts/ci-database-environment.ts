import { assertTestDatabaseUrl } from "./test-environment";

/** Deliberately narrower than the general integration guard: CI owns this empty DB. */
export function getCiDatabaseEnvironment(env: Record<string, string | undefined>): Record<string, string | undefined> {
  if (env.RODOVO_CI_DATABASE !== "disposable") {
    throw new Error("CI database operations require RODOVO_CI_DATABASE=disposable.");
  }
  const value = assertTestDatabaseUrl(env.TEST_DATABASE_URL, env.DATABASE_URL);
  const url = new URL(value);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/rodovo_ci_test" || url.search || url.hash) {
    throw new Error("CI database must be the explicit loopback rodovo_ci_test service without URL options.");
  }
  return { ...env, DATABASE_URL: value, TEST_DATABASE_URL: value };
}
