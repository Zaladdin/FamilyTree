const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);
const LOOPBACK_AUTHORITY = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i;

/** Recover only the local hostname that NextURL normalizes to "localhost". */
export function getRequestOrigin(request: Request): string {
  const url = new URL(request.url);
  if (!LOOPBACK_HOSTNAMES.has(url.hostname) || !["http:", "https:"].includes(url.protocol)) {
    return url.origin;
  }

  // Browsers supply Host themselves. Do not trust Origin or forwarded headers
  // to choose an accepted origin, and never use an arbitrary Host for redirects.
  const host = request.headers.get("host");
  if (!host || !LOOPBACK_AUTHORITY.test(host)) return url.origin;

  try {
    const localUrl = new URL(`${url.protocol}//${host}`);
    // A different port is a different origin, not NextURL's loopback rewrite.
    return localUrl.port === url.port ? localUrl.origin : url.origin;
  } catch {
    return url.origin;
  }
}
