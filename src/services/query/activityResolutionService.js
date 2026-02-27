import { buildAliasCandidates } from "./textProcessing.js";

export function createActivityResolutionService({
  aliasResolver,
  queryRepository,
  categoryDefaults = {},
}) {
  if (!aliasResolver || typeof aliasResolver.resolveActivitiesByAlias !== "function") {
    throw new Error("Missing aliasResolver");
  }
  if (!queryRepository) {
    throw new Error("Missing queryRepository");
  }
  if (typeof categoryDefaults !== "object" || categoryDefaults === null) {
    throw new Error("Invalid categoryDefaults");
  }

  async function resolveActivityTerms(activityTerms) {
    const uniqueActivityIds = new Set();
    const mappingDetails = [];
    const unmappedTerms = [];

    for (const term of activityTerms) {
      const aliasCandidates = buildAliasCandidates(term);
      const matchedActivityIds = new Set();
      const matchedActivitiesById = new Map();
      const matchedAliases = [];
      let matchSource = "alias";

      for (const candidate of aliasCandidates) {
        const resolution = aliasResolver.resolveActivitiesByAlias(candidate);
        if (!resolution.activityIds.length) continue;

        matchedAliases.push(resolution.normalizedAlias);
        resolution.activityIds.forEach((id) => matchedActivityIds.add(id));
        resolution.activities.forEach((activity) => matchedActivitiesById.set(activity.id, activity));
      }

      if (!matchedActivityIds.size) {
        const nameMatches = await queryRepository.findActivitiesByNames(aliasCandidates);
        nameMatches.forEach((row) => {
          const activityId = Number(row.id);
          if (!Number.isFinite(activityId)) return;
          matchedActivityIds.add(activityId);
          matchedActivitiesById.set(activityId, {
            id: activityId,
            name: row.name ? String(row.name) : null,
            category: row.category ? String(row.category) : null,
          });
        });
        if (nameMatches.length) {
          matchSource = "activity_name";
        }
      }

      if (!matchedActivityIds.size) {
        unmappedTerms.push(term);
      } else {
        matchedActivityIds.forEach((id) => uniqueActivityIds.add(id));
      }

      mappingDetails.push({
        inputTerm: term,
        matchSource: matchedActivityIds.size ? matchSource : "none",
        aliasCandidates,
        matchedAliases: Array.from(new Set(matchedAliases)),
        activityIds: Array.from(matchedActivityIds),
        activities: Array.from(matchedActivitiesById.values()),
      });
    }

    return {
      mappedActivityIds: Array.from(uniqueActivityIds),
      unmappedTerms,
      mappingDetails,
    };
  }

  async function resolveDefaultActivityIds(scopeCategory) {
    const defaultConfig = categoryDefaults[scopeCategory];
    if (!defaultConfig) {
      return {
        applied: false,
        scopeCategory,
        categoryName: null,
        configuredActivityNames: [],
        resolvedActivityIds: [],
      };
    }

    const categoryName = String(defaultConfig.categoryName || "").trim();
    const configuredActivityNames = Array.isArray(defaultConfig.activityNames)
      ? defaultConfig.activityNames
        .map((name) => String(name || "").trim())
        .filter(Boolean)
      : [];

    if (!categoryName || !configuredActivityNames.length) {
      return {
        applied: false,
        scopeCategory,
        categoryName: categoryName || null,
        configuredActivityNames,
        resolvedActivityIds: [],
      };
    }

    const resolvedActivityIds = [];
    const rows = await queryRepository.findActivityIdsByNamesAndCategory(
      configuredActivityNames,
      categoryName,
    );
    rows.forEach((row) => {
      const activityId = Number(row.id);
      if (Number.isFinite(activityId)) {
        resolvedActivityIds.push(activityId);
      }
    });

    return {
      applied: true,
      scopeCategory,
      categoryName,
      configuredActivityNames,
      resolvedActivityIds,
    };
  }

  return {
    resolveActivityTerms,
    resolveDefaultActivityIds,
  };
}
