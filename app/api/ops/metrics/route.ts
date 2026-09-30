import { isMetricsAuthorized } from "@/lib/health";
import { getRuntimeReadiness } from "@/lib/health-runtime";
import { getOperationalSnapshot, withObservedRoute } from "@/lib/observability";

export const dynamic = "force-dynamic";
export const GET = withObservedRoute("/api/ops/metrics", async (request: Request) => {
  if (!isMetricsAuthorized(request.headers.get("authorization"), process.env.OPS_METRICS_TOKEN)) {
    return Response.json({ error: "Не найдено." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json({ readiness: await getRuntimeReadiness(), operations: getOperationalSnapshot() }, {
    headers: { "Cache-Control": "private, no-store" },
  });
});
