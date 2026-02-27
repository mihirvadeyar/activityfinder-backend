function normalizeAliasText(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function createAliasResolverService({ queryRepository }) {
  const aliasToActivityIds = new Map();
  const activityNameById = new Map();
  let loadedAt = null;
  let mappingCount = 0;

  return {
    async refresh() {
      const rows = await queryRepository.listActiveAliasMappings();

      aliasToActivityIds.clear();
      activityNameById.clear();
      mappingCount = 0;

      for (const row of rows) {
        const normalizedAlias = normalizeAliasText(row.alias_normalized);
        if (!normalizedAlias) continue;

        const activityId = Number(row.activity_id);
        if (!Number.isFinite(activityId)) continue;

        if (!aliasToActivityIds.has(normalizedAlias)) {
          aliasToActivityIds.set(normalizedAlias, new Set());
        }
        aliasToActivityIds.get(normalizedAlias).add(activityId);

        const activityName = row.activity_name ? String(row.activity_name) : null;
        activityNameById.set(activityId, activityName);
        mappingCount += 1;
      }

      loadedAt = new Date();

      return {
        aliasesLoaded: aliasToActivityIds.size,
        mappingsLoaded: mappingCount,
        loadedAt: loadedAt.toISOString(),
      };
    },

    resolveActivitiesByAlias(rawAlias) {
      const normalizedAlias = normalizeAliasText(rawAlias);
      if (!normalizedAlias) {
        return {
          normalizedAlias,
          activityIds: [],
          activities: [],
        };
      }

      const activityIds = Array.from(aliasToActivityIds.get(normalizedAlias) || []);
      const activities = activityIds.map((id) => ({
        id,
        name: activityNameById.get(id) || null,
      }));

      return {
        normalizedAlias,
        activityIds,
        activities,
      };
    },

    getStats() {
      return {
        aliasesLoaded: aliasToActivityIds.size,
        mappingsLoaded: mappingCount,
        loadedAt: loadedAt ? loadedAt.toISOString() : null,
      };
    },
  };
}
