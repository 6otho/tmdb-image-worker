const ORIGIN = "https://image.tmdb.org";
const CLIENT_TTL = 30 * 86400;
const EDGE_POLICY = "public, max-age=7776000, stale-while-revalidate=86400, stale-if-error=604800";
const IMAGE_PATH = /^\/t\/p\/(?:original|w45|w92|w154|w185|w300|w342|w500|w780|w1280|h632)\/[A-Za-z0-9_-]{1,200}\.(?:jpg|jpeg|png|webp|avif|gif|svg)$/;

function headers() {
  return new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "ETag, Age, CF-Cache-Status, X-TMDB-Proxy, Server-Timing",
    "Cache-Control": "no-store",
    "Cloudflare-CDN-Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-TMDB-Proxy": "tmdb-image-worker",
  });
}

function reply(request, text, status, extra = {}) {
  const h = headers();
  h.set("Content-Type", "text/plain; charset=utf-8");
  for (const [key, value] of Object.entries(extra)) h.set(key, value);
  return new Response(request.method === "HEAD" ? null : text, { status, headers: h });
}

async function upstream(request, pathname) {
  const h = new Headers();
  for (const name of ["If-None-Match", "If-Modified-Since"]) {
    if (request.headers.has(name)) h.set(name, request.headers.get(name));
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    // Bound the wait for headers, not the subsequent streaming of large originals.
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const response = await fetch(ORIGIN + pathname, {
        method: request.method,
        headers: h,
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
      });
      if (attempt === 0 && [502, 503, 504].includes(response.status)) {
        await response.body?.cancel();
        continue;
      }
      return response;
    } catch (error) {
      if (attempt === 1) throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return reply(request, null, 204, {
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "If-None-Match, If-Modified-Since, Range",
        "Access-Control-Max-Age": "86400",
      });
    }
    if (!["GET", "HEAD"].includes(request.method)) {
      return reply(request, "Method Not Allowed", 405, { Allow: "GET, HEAD, OPTIONS" });
    }
    const url = new URL(request.url);
    if (url.pathname === "/") return reply(request, "TMDB image worker OK", 200);
    // Clients may append size/file directly to a bare custom image origin.
    const pathname = url.pathname.startsWith("/t/p/") ? url.pathname : "/t/p" + url.pathname;
    if (!IMAGE_PATH.test(pathname)) return reply(request, "Not Found", 404);

    // App URLs already have no query. Canonicalize other callers once so the
    // native cache cannot hold multiple copies of the same image for ?v=... .
    if (url.search) {
      url.search = "";
      return reply(request, null, 308, { Location: url.href });
    }

    const upstreamStarted = Date.now();
    let response;
    try {
      response = await upstream(request, pathname);
    } catch (error) {
      console.warn("TMDB fetch failed", error.name, error.message);
      return reply(request, "TMDB temporarily unavailable", 502);
    }

    const upstreamHeadersMs = Date.now() - upstreamStarted;
    if (response.status === 404) {
      await response.body?.cancel();
      return reply(request, "Image not found", 404, {
        "Cloudflare-CDN-Cache-Control": "public, max-age=60",
      });
    }
    const contentType = response.headers.get("Content-Type") || "";
    if (response.status !== 304 && (response.status !== 200 || !contentType.toLowerCase().startsWith("image/"))) {
      console.warn("Unexpected TMDB response", response.status, contentType);
      await response.body?.cancel();
      const extra = response.headers.has("Retry-After")
        ? { "Retry-After": response.headers.get("Retry-After") } : {};
      return reply(request, "TMDB temporarily unavailable", response.status === 429 ? 429 : 502, extra);
    }

    const h = headers();
    // Never forward cookies, upstream cache policy or stale CDN diagnostic headers.
    for (const name of ["Content-Type", "Content-Length", "Content-Encoding", "ETag", "Last-Modified", "Accept-Ranges"]) {
      if (response.headers.has(name)) h.set(name, response.headers.get(name));
    }
    h.set("Cache-Control", `public, max-age=${CLIENT_TTL}`);
    h.set("Cloudflare-CDN-Cache-Control", EDGE_POLICY);
    // Stored with the image: on a cache HIT this describes the original fill,
    // not this request. Does not include the streamed body or client connection.
    h.set("Server-Timing", `origin_headers;dur=${upstreamHeadersMs}`);
    return new Response(request.method === "HEAD" || response.status === 304 ? null : response.body, {
      status: response.status,
      headers: h,
    });
  },
};
