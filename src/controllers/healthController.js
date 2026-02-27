export function createHealthController({ repository, provider, aliasResolver }) {
  return {
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
