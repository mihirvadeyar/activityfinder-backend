import { Router } from "express";

export function registerRoutes({ app, controllers, requireAdmin }) {
  const router = Router();

  router.get("/health", controllers.health.getHealth);
  router.post("/admin/ingest", requireAdmin, controllers.admin.ingest);
  router.post("/query", controllers.query.query);

  app.use(router);
}
