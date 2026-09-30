import { withObservedRoute } from "@/lib/observability";

export const dynamic = "force-dynamic";
export const GET = withObservedRoute("/api/health/live", async () =>
  Response.json({ status: "alive" }, { headers: { "Cache-Control": "no-store" } }),
);
