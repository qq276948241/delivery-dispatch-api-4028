const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || '服务器内部错误';

  if (statusCode >= 500) {
    console.error(err.stack);
  } else {
    console.warn(`[${err.name || 'Error'}] ${statusCode} ${req.method} ${req.path}: ${message}`);
  }

  const response = {
    message,
    error: err.name || 'Error',
    ...(err.meta && { meta: err.meta }),
  };

  if (process.env.NODE_ENV === 'development') {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
};

const notFound = (req, res, next) => {
  res.status(404).json({
    message: `无法找到 ${req.method} ${req.originalUrl}`,
    error: 'NotFound',
  });
};

module.exports = { errorHandler, notFound };
