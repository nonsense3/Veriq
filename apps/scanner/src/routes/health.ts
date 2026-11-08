import { Hono } from "hono";
import { healthController } from "../controllers/health-controller";

export function createHealthRouter(storage: string) {
  const router = new Hono();
  router.get("/health", healthController(storage));
  return router;
}
