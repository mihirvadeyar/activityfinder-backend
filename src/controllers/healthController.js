/**
 * Creates health endpoints controller.
 *
 * @param {Object} deps
 * @param {Object} deps.repository
 * @param {string} deps.provider
 * @param {Object} deps.aliasResolver
 */
export function createHealthController({ repository, provider, aliasResolver }) {
  return {
    /**
     * Returns service liveness with DB time and alias resolver stats.
     */
    getHealth: async (_req, res) => {
      try {
        const dbTime = await repository.getHealthDbTime();
        res.json({
          ok: true,
          dbTime,
          provider,
          aliasResolver: aliasResolver ? aliasResolver.getStats() : null,
        });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  };
}
