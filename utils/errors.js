class ConcurrencyError extends Error {
  constructor(message = '数据已被其他操作修改，请刷新后重试', meta = {}) {
    super(message);
    this.name = 'ConcurrencyError';
    this.statusCode = 409;
    this.meta = meta;
  }
}

class ValidationError extends Error {
  constructor(message = '参数校验失败', meta = {}) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
    this.meta = meta;
  }
}

class ForbiddenError extends Error {
  constructor(message = '无操作权限', meta = {}) {
    super(message);
    this.name = 'ForbiddenError';
    this.statusCode = 403;
    this.meta = meta;
  }
}

class NotFoundError extends Error {
  constructor(message = '资源不存在', meta = {}) {
    super(message);
    this.name = 'NotFoundError';
    this.statusCode = 404;
    this.meta = meta;
  }
}

const updateWithOptimisticLock = async (
  Model,
  id,
  expectedVersion,
  updateData,
  extraConditions = {},
  options = {}
) => {
  const conditions = {
    _id: id,
    __v: expectedVersion,
    ...extraConditions,
  };

  const update = {
    $set: updateData,
    $inc: { __v: 1 },
  };

  if (options.arrayPush) {
    update.$push = options.arrayPush;
  }

  const doc = await Model.findByIdAndUpdate(conditions, update, {
    new: true,
    runValidators: true,
    ...options.findOptions,
  });

  if (!doc) {
    throw new ConcurrencyError('乐观锁校验失败，数据版本不匹配', {
      id,
      expectedVersion,
    });
  }

  return doc;
};

module.exports = {
  ConcurrencyError,
  ValidationError,
  ForbiddenError,
  NotFoundError,
  updateWithOptimisticLock,
};
