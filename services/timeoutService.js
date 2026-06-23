const Order = require('../models/Order');
const { reassignOrderToPool } = require('./orderService');
const { addTimeoutMark } = require('./riderService');
const { ConcurrencyError } = require('../utils/errors');

const DEFAULT_BATCH_SIZE = 50;
const LOG_PREFIX = '[TimeoutScanner]';

const findTimeoutOrdersBatch = async (now, skip = 0, limit = DEFAULT_BATCH_SIZE) => {
  return Order.find({
    status: { $in: ['accepted', 'delivering'] },
    promisedDeliveryTime: { $lt: now },
    rider: { $exists: true, $ne: null },
  })
    .populate('rider', '_id')
    .skip(skip)
    .limit(limit);
};

const processOneTimeoutOrder = async (order, now) => {
  const timeoutMinutes = Math.ceil(
    (now - new Date(order.promisedDeliveryTime)) / (1000 * 60)
  );
  const riderId = order.rider && order.rider._id ? order.rider._id : order.rider;

  await reassignOrderToPool(order, timeoutMinutes, now);
  await addTimeoutMark(riderId, order._id, timeoutMinutes, true);

  return {
    orderId: order._id,
    orderNo: order.orderNo,
    timeoutMinutes,
  };
};

const scanAndReassignTimeoutOrders = async () => {
  const now = new Date();
  const reassigned = [];
  const skipped = [];
  let hasMore = true;
  let skip = 0;

  while (hasMore) {
    const batch = await findTimeoutOrdersBatch(now, skip, DEFAULT_BATCH_SIZE);
    if (batch.length === 0) {
      hasMore = false;
      break;
    }

    for (const order of batch) {
      try {
        const result = await processOneTimeoutOrder(order, now);
        reassigned.push(result);
      } catch (err) {
        if (err instanceof ConcurrencyError) {
          skipped.push({
            orderId: order._id,
            orderNo: order.orderNo,
            reason: 'CONCURRENT_MODIFICATION',
          });
          continue;
        }
        console.error(`${LOG_PREFIX} 订单 ${order._id} 改派失败:`, err.message);
      }
    }

    skip += DEFAULT_BATCH_SIZE;
    if (batch.length < DEFAULT_BATCH_SIZE) hasMore = false;
  }

  const result = {
    scannedAt: now,
    totalReassigned: reassigned.length,
    totalSkipped: skipped.length,
    reassigned,
    skipped,
  };

  if (reassigned.length > 0 || skipped.length > 0) {
    console.log(
      `${LOG_PREFIX} ${now.toISOString()} 改派 ${reassigned.length} 笔，` +
      `跳过 ${skipped.length} 笔（并发冲突）`
    );
  }

  return result;
};

module.exports = {
  DEFAULT_BATCH_SIZE,
  LOG_PREFIX,
  findTimeoutOrdersBatch,
  processOneTimeoutOrder,
  scanAndReassignTimeoutOrders,
};
