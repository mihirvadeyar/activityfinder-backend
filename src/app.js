import express from "express";
import { config } from "./config.js";
import { sql } from "./db.js";
import { createProviderClient } from "./clients/providerClient.js";
import { createOllamaClient } from "./clients/ollamaClient.js";
import { createIngestionRepository } from "./repositories/ingestionRepository.js";
import { createQueryRepository } from "./repositories/queryRepository.js";
import { createIngestionService } from "./services/ingestionService.js";
import { createAliasResolverService } from "./services/aliasResolverService.js";
import { createQueryUnderstandingService } from "./services/queryUnderstandingService.js";
import { createQueryExecutionService } from "./services/queryExecutionService.js";
import { createHealthController } from "./controllers/healthController.js";
import { createAdminController } from "./controllers/adminController.js";
import { createQueryController } from "./controllers/queryController.js";
import { createRequireAdmin } from "./middleware/requireAdmin.js";
import { registerRoutes } from "./routes/registerRoutes.js";

/**
 * Application bootstrap: wires dependencies, registers routes, refreshes alias cache,
 * and starts the HTTP server.
 */
const app = express();
app.use(express.json());

const providerClient = createProviderClient(config.ingestion);
const understandingLlmClient = createOllamaClient({
  host: config.ai.ollama.baseUrl,
  model: config.ai.ollama.models.understanding,
  requestTimeoutMs: config.ai.ollama.requestTimeoutMs,
});
const summaryLlmClient = createOllamaClient({
  host: config.ai.ollama.baseUrl,
  model: config.ai.ollama.models.summary,
  requestTimeoutMs: config.ai.ollama.requestTimeoutMs,
});
const queryUnderstandingService = createQueryUnderstandingService({
  llmClient: understandingLlmClient,
});
const repository = createIngestionRepository({
  sql,
  provider: config.provider,
});
const queryRepository = createQueryRepository({
  sql,
  provider: config.provider,
});
const aliasResolver = createAliasResolverService({
  queryRepository,
});
const queryExecutionService = createQueryExecutionService({
  summaryLlmClient,
  queryRepository,
  aliasResolver,
  queryUnderstandingService,
  categoryDefaults: config.query.categoryDefaults,
  defaultWindowDays: config.ingestion.windowDays,
});
const ingestionService = createIngestionService({
  providerClient,
  repository,
  provider: config.provider,
  windowDays: config.ingestion.windowDays,
  centerChunkSize: config.ingestion.centerChunkSize,
});

const controllers = {
  health: createHealthController({
    repository,
    provider: config.provider,
    aliasResolver,
  }),
  admin: createAdminController({
    ingestionService,
  }),
  query: createQueryController({
    queryExecutionService,
  }),
};

registerRoutes({
  app,
  controllers,
  requireAdmin: createRequireAdmin({ adminToken: config.adminToken }),
});

app.use((error, _req, res, _next) => {
  res.status(500).json({ error: error.message || "Internal server error" });
});

try {
  const summary = await aliasResolver.refresh();
  console.info("[alias-resolver] startup_refresh_done", summary);
} catch (error) {
  console.warn("[alias-resolver] startup_refresh_failed", { error: error.message });
}

app.listen(config.port, () => {
  console.log(`ActivityFinder backend listening on http://localhost:${config.port}`);
});
