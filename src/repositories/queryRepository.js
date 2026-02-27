/**
 * Read/query repository used by query understanding and execution services.
 *
 * @param {Object} deps
 * @param {import("postgres").Sql} deps.sql
 * @param {string} deps.provider
 */
export function createQueryRepository({ sql, provider }) {
  return {
    /**
     * Returns active alias->activity mappings for in-memory resolver cache.
     */
    async listActiveAliasMappings() {
      return sql`
        select
          aa.alias_normalized,
          aa.activity_id,
          a.name as activity_name
        from activity_alias aa
        inner join activity a on a.id = aa.activity_id
        where aa.is_active = true
          and a.provider = ${provider};
      `;
    },

    /**
     * Resolves activity ids by exact normalized names scoped to category.
     *
     * @param {string[]} names
     * @param {string} category
     */
    async findActivityIdsByNamesAndCategory(names, category) {
      const normalizedNames = Array.isArray(names)
        ? names.map((name) => String(name || "").trim().toLowerCase()).filter(Boolean)
        : [];
      if (!normalizedNames.length) return [];

      return sql`
        select id, name
        from activity
        where provider = ${provider}
          and lower(trim(category)) = lower(trim(${category}))
          and lower(trim(name)) = any(${normalizedNames}::text[]);
      `;
    },

    /**
     * Resolves activities by exact normalized names (all categories).
     *
     * @param {string[]} names
     */
    async findActivitiesByNames(names) {
      const normalizedNames = Array.isArray(names)
        ? names.map((name) => String(name || "").trim().toLowerCase()).filter(Boolean)
        : [];
      if (!normalizedNames.length) return [];

      return sql`
        select id, name, category
        from activity
        where provider = ${provider}
          and lower(trim(name)) = any(${normalizedNames}::text[]);
      `;
    },

    /**
     * Returns upcoming events by activity ids in the requested time window.
     *
     * @param {Object} params
     * @param {number[]} params.activityIds
     * @param {string} params.windowStartIso
     * @param {string} params.windowEndIso
     * @param {number} [params.limit]
     */
    async listEventsByActivityIdsWithinWindow({
      activityIds,
      windowStartIso,
      windowEndIso,
      limit = 200,
    }) {
      const normalizedIds = Array.isArray(activityIds)
        ? activityIds.map((id) => Number(id)).filter((id) => Number.isFinite(id))
        : [];
      if (!normalizedIds.length) return [];

      const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 500));

      return sql`
        select
          e.id as event_id,
          e.external_id as event_external_id,
          e.title as event_title,
          e.description as event_description,
          e.starts_at,
          e.ends_at,
          e.url as event_url,
          a.id as activity_id,
          a.name as activity_name,
          a.category as activity_category,
          c.id as centre_id,
          c.name as centre_name,
          c.city as centre_city,
          c.state as centre_state,
          c.country as centre_country
        from event e
        inner join activity a on a.id = e.activity_id
        inner join centre c on c.id = e.centre_id
        where e.provider = ${provider}
          and e.activity_id = any(${normalizedIds}::bigint[])
          and e.starts_at >= ${windowStartIso}::timestamptz
          and e.starts_at < ${windowEndIso}::timestamptz
        order by e.starts_at asc
        limit ${safeLimit};
      `;
    },
  };
}
