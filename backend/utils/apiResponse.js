function sendSuccess(res, data, statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    data,
  });
}

function sendError(res, statusCode, message, details) {
  const body = {
    success: false,
    error: {
      message,
    },
  };

  if (details !== undefined) {
    body.error.details = details;
  }

  return res.status(statusCode).json(body);
}

module.exports = {
  sendSuccess,
  sendError,
};
