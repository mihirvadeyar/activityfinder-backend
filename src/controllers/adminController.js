export function createAdminController({ ingestionService }) {
  return {
    ingest: async (_req, res) => {
      const started = Date.now();
      try {
        const result = await ingestionService.runIngestion();
        res.json({
          ok: true,
          durationMs: Date.now() - started,
          result,
        });
      } catch (error) {
        res.status(500).json({
          ok: false,
          durationMs: Date.now() - started,
          error: error.message,
        });
      }
    },
  };
}
