/**
 * Creates query endpoint controller.
 *
 * @param {Object} deps
 * @param {Object} deps.queryExecutionService
 */
export function createQueryController({ queryExecutionService }) {
  if (!queryExecutionService || typeof queryExecutionService.executeQuery !== "function") {
    throw new Error("Missing queryExecutionService");
  }

  return {
    /**
     * Executes semantic event query flow and returns structured response.
     */
    query: async (req, res) => {
      const started = Date.now();

      try {
        const queryText = req?.body?.query;
        const result = await queryExecutionService.executeQuery(queryText);
        res.json({
          ok: true,
          durationMs: Date.now() - started,
          result,
        });
      } catch (error) {
        const message = error?.message || "Failed to process query";
        const statusCode = message === "Query text is required" ? 400 : 500;

        res.status(statusCode).json({
          ok: false,
          durationMs: Date.now() - started,
          error: message,
        });
      }
    },
  };
}
