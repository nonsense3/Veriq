import { describe, expect, it } from "vitest";
import { createHealthRouter } from "../apps/scanner/src/routes/health";

// No store or external service is needed to answer liveness checks.
describe("scanner liveness router", () => {
  it("responds without authentication and forbids caching", async () => {
    const response = await createHealthRouter("supabase").request("/health");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const health = await response.json();
    expect(health).toMatchObject({ status: "ok", service: "veriq-scanner", storage: "supabase" });
    expect(Number.isNaN(Date.parse(health.timestamp))).toBe(false);
  });
});
