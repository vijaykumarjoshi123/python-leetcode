const jwt = require('jsonwebtoken');

/**
 * Middleware to verify JWT token from Authorization header.
 * Attaches decoded user info to req.user.
 *
 * The JWT is signed with { userId } (see routes/auth.js), so the decoded
 * payload has `userId` but NOT `id`. Several routes historically read
 * `req.user.id` (which was undefined), causing bugs like /api/hints
 * always returning 401. To make both `req.user.id` and `req.user.userId`
 * work everywhere, we normalise here: set req.user.id to the decoded
 * userId. Routes can now use either field interchangeably.
 */
function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ msg: 'No authorization header' });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ msg: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    // Normalise: routes read either req.user.id or req.user.userId.
    // Prefer the existing `id` if the token already carries one; otherwise
    // derive it from `userId` (the field routes/auth.js signs).
    if (decoded.userId && !decoded.id) {
      decoded.id = decoded.userId;
    } else if (decoded.id && !decoded.userId) {
      decoded.userId = decoded.id;
    }
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ msg: 'Invalid or expired token' });
  }
}

module.exports = authMiddleware;