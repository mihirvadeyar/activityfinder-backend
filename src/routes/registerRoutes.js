import { Router } from "express";

/**
 * Registers all HTTP routes and middleware bindings.
 *
 * @param {Object} deps
 * @param {import("express").Express} deps.app
 * @param {Object} deps.controllers
 * @param {Function} deps.requireAdmin
 */
export function registerRoutes({ app, controllers, requireAdmin }) {
  const router = Router();

  router.get("/health", controllers.health.getHealth);
  router.post("/admin/ingest", requireAdmin, controllers.admin.ingest);
  router.post("/query", controllers.query.query);

  app.use(router);
}
