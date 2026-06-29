/**
 * Simple validation middleware factory.
 * Validates required fields on req.body.
 *
 * Usage: router.post('/route', validate(['email', 'password']), handler);
 */
function validate(requiredFields) {
  return (req, res, next) => {
    const missing = [];
    for (const field of requiredFields) {
      if (req.body[field] === undefined || req.body[field] === null || req.body[field] === '') {
        missing.push(field);
      }
    }

    if (missing.length > 0) {
      return res.status(400).json({
        error: 'Validation error',
        missing,
        msg: `Missing required fields: ${missing.join(', ')}`
      });
    }

    next();
  };
}

module.exports = validate;