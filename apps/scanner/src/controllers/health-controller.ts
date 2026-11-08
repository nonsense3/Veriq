import type { Context } from "hono";

/** Cheap liveness check. Waking the service must not trigger scans, AI, DB queries or chain requests. */
export function healthController(storage: string) {
  return (context: Context) => {
    context.header("Cache-Control", "no-store");
    return context.json({ status: "ok", service: "veriq-scanner", storage, timestamp: new Date().toISOString() }, 200);
  };
}
