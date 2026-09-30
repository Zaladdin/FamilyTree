import { getRuntimeReadiness } from "@/lib/health-runtime";
import { withObservedRoute } from "@/lib/observability";

export const dynamic = "force-dynamic";
export const GET = withObservedRoute("/api/health/ready", async () => {
  const report = await getRuntimeReadiness();
  return Response.json({ status: report.ready ? "ready" : "not_ready" }, {
    status: report.ready ? 200 : 503, headers: { "Cache-Control": "no-store" },
  });
});
