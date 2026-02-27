/**
 * @typedef {Object} Centre
 * @property {number} externalId
 * @property {string} name
 * @property {string|null} description
 * @property {string|null} street
 * @property {string} city
 * @property {string} state
 * @property {string} country
 * @property {string|null} zipCode
 * @property {string|null} phone
 */

/**
 * @param {Partial<Centre>} input
 * @returns {Centre}
 */
export function createCentre(input) {
  return {
    externalId: input.externalId,
    name: input.name,
    description: input.description ?? null,
    street: input.street ?? null,
    city: input.city ?? "Vancouver",
    state: input.state ?? "BC",
    country: input.country ?? "Canada",
    zipCode: input.zipCode ?? null,
    phone: input.phone ?? null,
  };
}
