import { createHash } from "node:crypto";
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit";

/** Raw email addresses and bearer tokens never become rate-limit keys. */
export async function enforceInvitationRateLimit(request: Request, userId: string, deliveryTarget?: string, enforce = enforceRateLimit) {
  const purpose = deliveryTarget === undefined ? "accept" : "delivery";
  const windowMs = 15 * 60 * 1000;
  await enforce({ key: `invitation:${purpose}:user:${userId}`, limit: purpose === "delivery" ? 30 : 60, windowMs });
  if (deliveryTarget !== undefined) {
    const targetHash = createHash("sha256").update(deliveryTarget).digest("hex");
    await enforce({ key: `invitation:delivery:target:${targetHash}`, limit: 10, windowMs });
  }
  const ip = getClientIp(request);
  await enforce({ key: ip ? `invitation:${purpose}:ip:${ip}` : `invitation:${purpose}:global`, limit: ip ? 60 : 1200, windowMs });
}
