import { investigationRequestSchema } from "@veriq/contracts";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";

/**
 * Cloudflare edge gateway. The investigation service (apps/scanner) needs raw TLS sockets and DNS, which
 * Workers do not offer, so it runs on a controlled Node host. This Worker is the public entry point:
 * it applies exact-origin CORS, security headers and input validation, then forwards to SCANNER_ORIGIN
 * (for example a Cloudflare Tunnel hostname). Without SCANNER_ORIGIN it reports that honestly.
 */
type Bindings = {
  /** One extra browser origin, kept for older configuration. */
  ALLOWED_ORIGIN?: string;
  /** Comma-separated browser origins. Change this in the Worker settings without editing code. */
  ALLOWED_ORIGINS?: string;
  SCANNER_ORIGIN?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
};

/** Public account settings only. Secret keys are never included. Accepts the URL and key in either variable if they were swapped. */
function publicAuth(env: Bindings): { supabaseUrl: string; supabaseKey: string } {
  const values = [env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, env.NEXT_PUBLIC_SUPABASE_ANON_KEY].map((value) => value?.trim() ?? "").filter(Boolean);
  const supabaseUrl = values.find((value) => value.startsWith("https://")) ?? "";
  const supabaseKey = values.find((value) => value.startsWith("eyJ") || value.startsWith("sb_publishable_")) ?? "";
  return { supabaseUrl, supabaseKey };
}

function listedOrigins(env: Bindings): Set<string> {
  return new Set(
    [env.ALLOWED_ORIGINS, env.ALLOWED_ORIGIN]
      .filter(Boolean)
      .join(",")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

const app = new Hono<{ Bindings: Bindings }>();

const publicError = (code: string, title: string, message: string, retryable: boolean) => ({
  code,
  title,
  message,
  retryable,
  correlationId: crypto.randomUUID(),
});

app.use("*", secureHeaders());
app.use(
  "/v1/*",
  cors({
    origin: (origin, context) => {
      if (!origin) return null;
      const own = new URL(context.req.url).origin;
      if (origin === own || listedOrigins(context.env).has(origin)) return origin;
      return null;
    },
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    maxAge: 600,
  }),
);

app.get("/health", (context) =>
  context.json({
    status: "ok",
    service: "veriq-api",
    scanner: context.env.SCANNER_ORIGIN ? "configured" : "not_configured",
    timestamp: new Date().toISOString(),
  }),
);

const ALLOWED_ROUTES: Array<{ method: string; pattern: RegExp }> = [
  { method: "GET", pattern: /^\/v1\/public-config$/ },
  { method: "GET", pattern: /^\/v1\/config$/ },
  { method: "POST", pattern: /^\/v1\/investigations$/ },
  { method: "GET", pattern: /^\/v1\/investigations\/[0-9a-f-]{36}$/i },
  { method: "POST", pattern: /^\/v1\/investigations\/[0-9a-f-]{36}\/register$/i },
  { method: "GET", pattern: /^\/v1\/investigations\/[0-9a-f-]{36}\/bundle$/i },
  { method: "GET", pattern: /^\/v1\/investigations\/[0-9a-f-]{36}\/registration$/i },
  { method: "DELETE", pattern: /^\/v1\/investigations\/[0-9a-f-]{36}\/publication$/i },
  { method: "GET", pattern: /^\/v1\/repository$/ },
  { method: "GET", pattern: /^\/v1\/repository\/0x[0-9a-f]{64}$/i },
  { method: "GET", pattern: /^\/v1\/me\/investigations$/ },
  { method: "DELETE", pattern: /^\/v1\/me$/ },
  { method: "POST", pattern: /^\/v1\/repository\/0x[0-9a-f]{64}\/statements$/i },
];

app.all("/v1/*", async (context) => {
  const url = new URL(context.req.url);
  if (context.req.method === "GET" && url.pathname === "/v1/public-config") {
    context.header("cache-control", "no-store");
    return context.json(publicAuth(context.env));
  }
  const route = ALLOWED_ROUTES.find((entry) => entry.method === context.req.method && entry.pattern.test(url.pathname));
  if (!route) return context.json(publicError("NOT_FOUND", "Endpoint not found", "The requested API endpoint does not exist.", false), 404);

  let body: string | undefined;
  if (context.req.method === "POST") {
    body = await context.req.text();
    if (body.length > 64 * 1024) return context.json(publicError("PAYLOAD_TOO_LARGE", "Too much text", "Submissions are limited to 64 KB.", false), 413);
    if (url.pathname === "/v1/investigations") {
      let parsedBody: unknown = null;
      try {
        parsedBody = JSON.parse(body);
      } catch {
        parsedBody = null;
      }
      const result = investigationRequestSchema.safeParse(parsedBody);
      if (!result.success) {
        return context.json(publicError("INVALID_REQUEST", "Check your submission", result.error.issues[0]?.message ?? "The request is invalid.", false), 400);
      }
    }
  }

  if (!context.env.SCANNER_ORIGIN) {
    return context.json(
      publicError("SCANNER_NOT_CONFIGURED", "Investigation service offline", "The API gateway is running, but no investigation service is connected (SCANNER_ORIGIN is not set).", true),
      503,
    );
  }

  try {
    const upstream = await fetch(new URL(url.pathname, context.env.SCANNER_ORIGIN), {
      method: context.req.method,
      signal: AbortSignal.timeout(context.req.method === "POST" ? 90_000 : 15_000),
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": context.req.header("cf-connecting-ip") ?? "",
        ...(context.req.header("authorization")?.startsWith("Bearer ") ? { authorization: context.req.header("authorization")! } : {}),
      },
      ...(body !== undefined ? { body } : {}),
    });
    if (!/application\/(?:[a-z0-9.+-]*\+)?json/i.test(upstream.headers.get("content-type") ?? "")) {
      await upstream.body?.cancel();
      return context.json(publicError("SCANNER_UNAVAILABLE", "Investigation service unavailable", "The investigation service could not load this request. Please try again shortly.", true), 502);
    }
    const headers = new Headers({ "content-type": upstream.headers.get("content-type") ?? "application/json" });
    const disposition = upstream.headers.get("content-disposition");
    if (disposition) headers.set("content-disposition", disposition);
    headers.set("cache-control", "no-store");
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return context.json(publicError("SCANNER_UNREACHABLE", "Investigation service unreachable", "The investigation service did not respond. Try again shortly.", true), 502);
  }
});

app.notFound((context) => context.json(publicError("NOT_FOUND", "Endpoint not found", "The requested API endpoint does not exist.", false), 404));

app.onError((error, context) => {
  console.error(JSON.stringify({ message: error.message }));
  return context.json(publicError("INTERNAL_ERROR", "Something went wrong", "The request could not be completed. Try again in a moment.", true), 500);
});

export default app;
