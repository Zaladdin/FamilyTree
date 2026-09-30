import { getCiDatabaseEnvironment } from "./ci-database-environment";
import { assertTestDatabaseUrl } from "./test-environment";

export function getRecoveryEnvironment(env: Record<string, string | undefined>) {
  if (env.RODOVO_RECOVERY_DRILL !== "disposable") throw new Error("Explicit disposable recovery acknowledgement required.");
  const source = getCiDatabaseEnvironment(env).DATABASE_URL!;
  const target = assertTestDatabaseUrl(env.RECOVERY_DATABASE_URL, env.DATABASE_URL);
  const from = new URL(source);
  const to = new URL(target);
  if (to.hostname !== "127.0.0.1" || to.pathname !== "/rodovo_recovery_test" || to.search || to.hash ||
      to.host !== from.host || to.username !== from.username || to.password !== from.password || from.port !== "55432" ||
      env.RECOVERY_CONTAINER !== "rodovo-recovery-test") throw new Error("Recovery requires the dedicated local container and separate database.");
  return { source, target, container: "rodovo-recovery-test", port: from.port, username: decodeURIComponent(from.username) };
}
