/**
 * Builds token-based admin authorization middleware.
 *
 * @param {Object} deps
 * @param {string} deps.adminToken
 */
export function createRequireAdmin({ adminToken }) {
  /**
   * Validates admin token from `x-admin-token` or bearer auth header.
   */
  return function requireAdmin(req, res, next) {
    const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    const token = req.headers["x-admin-token"] || bearer;

    if (!token || token !== adminToken) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    return next();
  };
}
