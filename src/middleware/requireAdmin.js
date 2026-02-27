export function createRequireAdmin({ adminToken }) {
  return function requireAdmin(req, res, next) {
    const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    const token = req.headers["x-admin-token"] || bearer;

    if (!token || token !== adminToken) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    return next();
  };
}
