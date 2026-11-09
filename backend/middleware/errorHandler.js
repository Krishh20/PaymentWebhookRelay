const { sendError } = require("../utils/apiResponse");

// Express recognises this as an error handler because it has four arguments.
function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  if (error.type === "entity.too.large") {
    return sendError(res, 413, "Request body is too large.");
  }

  const statusCode = Number.isInteger(error.statusCode)
    ? error.statusCode
    : Number.isInteger(error.status)
      ? error.status
      : 500;

  // Do not log rejected webhooks (invalid signatures can be noisy or hostile).
  if (statusCode >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl}:`, error.message);
  }

  // Do not leak internal details for unexpected server errors.
  const message = statusCode >= 500 ? "Internal server error" : error.message;

  return sendError(res, statusCode, message);
}

module.exports = errorHandler;
