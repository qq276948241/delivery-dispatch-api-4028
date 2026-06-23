const Order = require('../models/Order');
const Zone = require('../models/Zone');
const Rider = require('../models/Rider');
const { generateOrderNo, calculateDistance, calculateDeliveryFee } = require('../utils/helpers');
const {
  validateRiderCanAccept,
  ensureTodayStats,
} = require('./riderService');
const {
  updateWithOptimisticLock,
  ConcurrencyError,
  ForbiddenError,
  ValidationError,
  NotFoundError,
} = require('../utils/errors');

const VALID_TRANSITIONS = {
  accepted: ['delivering', 'cancelled'],
  delivering: ['delivered', 'cancelled'],
};

const DEFAULT_PROMISED_MINUTES = 45;
const REASSIGN_PROMISED_MINUTES = 30;
const TIMEOUT_DEDUCTION_RATE_PER_MIN = 0.5;
const TIMEOUT_DEDUCTION_MAX_RATIO = 0.5;

const findZoneForPoint = async (coordinates) => {
  return Zone.findOne({
    boundary: {
      $geoIntersects: {
        $geometry: { type: 'Point', coordinates },
      },
    },
  });
};

const createOrder = async (payload) => {
  const { merchant, customer, items, orderAmount } = payload;
  const distance = calculateDistance(
    merchant.location.coordinates,
    customer.location.coordinates
  );
  const deliveryFee = calculateDeliveryFee(distance);
  const zone = await findZoneForPoint(merchant.location.coordinates);

  const order = new Order({
    orderNo: generateOrderNo(),
    merchant,
    customer,
    items,
    orderAmount,
    distance,
    deliveryFee,
    zone: zone ? zone._id : null,
    promisedDeliveryTime: new Date(Date.now() + DEFAULT_PROMISED_MINUTES * 60 * 1000),
  });

  await order.save();
  return order;
};

const getPendingOrders = async (filters = {}) => {
  const query = { status: 'pending' };
  if (filters.zoneId) query.zone = filters.zoneId;

  if (filters.longitude && filters.latitude) {
    query['merchant.location'] = {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [parseFloat(filters.longitude), parseFloat(filters.latitude)],
        },
        $maxDistance: parseInt(filters.maxDistance) || 5000,
      },
    };
  }

  return Order.find(query).sort({ createdAt: -1 }).limit(50);
};

const getOrderById = async (orderId, populate = true) => {
  let q = Order.findById(orderId);
  if (populate) {
    q = q.populate('rider', 'name phone').populate('zone', 'name');
  }
  return q;
};

const getOrdersByRider = async (riderId, status) => {
  const query = { rider: riderId };
  if (status) query.status = status;
  return Order.find(query).sort({ createdAt: -1 }).limit(100);
};

const validateOrderAcceptableForRider = (order, rider) => {
  if (!order) {
    return { ok: false, error: new NotFoundError('订单不存在') };
  }
  if (order.status !== 'pending') {
    return { ok: false, error: new ValidationError('订单已被接取或已取消') };
  }
  if (
    order.previousRiders &&
    order.previousRiders.some(
      (p) => p.rider && p.rider.toString() === rider._id.toString()
    )
  ) {
    return {
      ok: false,
      error: new ValidationError('该订单此前已被此骑手超时释放，无法再次接取'),
    };
  }
  return { ok: true };
};

const acceptOrderForRider = async (orderId, rider) => {
  const riderCheck = await validateRiderCanAccept(rider);
  if (!riderCheck.ok) return riderCheck;

  const order = await getOrderById(orderId, false);
  const orderCheck = validateOrderAcceptableForRider(order, rider);
  if (!orderCheck.ok) {
    return { ok: false, status: orderCheck.error.statusCode, message: orderCheck.error.message };
  }

  const now = new Date();
  const updateData = {
    status: 'accepted',
    rider: rider._id,
    acceptedAt: now,
  };

  const updatedOrder = await updateWithOptimisticLock(
    Order,
    orderId,
    order.__v,
    updateData,
    { status: 'pending' }
  );

  await Rider.updateOne(
    { _id: rider._id, 'todayStats.date': new Date().setHours(0, 0, 0, 0) },
    { $inc: { 'todayStats.ordersAccepted': 1 } },
    { upsert: false }
  );
  await ensureTodayStats(rider._id);

  return { ok: true, data: updatedOrder };
};

const validateStatusTransition = (from, to) => {
  return !!VALID_TRANSITIONS[from] && VALID_TRANSITIONS[from].includes(to);
};

const calculateTimeoutDeduction = (order, deliveredAt) => {
  if (!order.promisedDeliveryTime || deliveredAt <= order.promisedDeliveryTime) {
    return 0;
  }
  const timeoutMinutes = Math.ceil(
    (deliveredAt - new Date(order.promisedDeliveryTime)) / (1000 * 60)
  );
  return Math.min(
    timeoutMinutes * TIMEOUT_DEDUCTION_RATE_PER_MIN,
    order.deliveryFee * TIMEOUT_DEDUCTION_MAX_RATIO
  );
};

const updateOrderStatusForRider = async (orderId, rider, newStatus, extra = {}) => {
  const order = await getOrderById(orderId, false);
  if (!order) {
    throw new NotFoundError('订单不存在');
  }

  if (order.rider && order.rider.toString() !== rider._id.toString()) {
    throw new ForbiddenError('无权操作此订单');
  }

  if (!validateStatusTransition(order.status, newStatus)) {
    throw new ValidationError(`无法从 ${order.status} 流转到 ${newStatus}`);
  }

  const now = new Date();
  const updateData = { status: newStatus };

  if (newStatus === 'delivering') {
    updateData.pickedUpAt = now;
  }

  let timeoutDeduction = 0;
  if (newStatus === 'delivered') {
    updateData.deliveredAt = now;
    timeoutDeduction = calculateTimeoutDeduction(order, now);
    updateData.timeoutDeduction = timeoutDeduction;
  }

  if (newStatus === 'cancelled') {
    updateData.cancelledAt = now;
    updateData.cancelReason = extra.reason || '骑手取消';
  }

  const updatedOrder = await updateWithOptimisticLock(
    Order,
    orderId,
    order.__v,
    updateData,
    { status: order.status }
  );

  if (newStatus === 'delivered') {
    const actualEarnings = updatedOrder.deliveryFee - (updatedOrder.timeoutDeduction || 0);
    await Rider.updateOne(
      { _id: rider._id },
      {
        $inc: {
          'todayStats.ordersDelivered': 1,
          'todayStats.totalDistance': updatedOrder.distance,
          'todayStats.totalEarnings': actualEarnings,
        },
      }
    );
  }

  return { ok: true, data: updatedOrder };
};

const reassignOrderToPool = async (order, timeoutMinutes, now = new Date()) => {
  const riderId = order.rider && order.rider._id ? order.rider._id : order.rider;

  if (!order.status || !['accepted', 'delivering'].includes(order.status)) {
    throw new ValidationError(`订单状态为 ${order.status}，无法改派`);
  }

  const historyEntry = {
    rider: riderId,
    acceptedAt: order.acceptedAt,
    pickedUpAt: order.pickedUpAt,
    releasedAt: now,
    releaseReason: 'timeout_auto_reassign',
    timeoutMinutes,
  };

  const updateData = {
    status: 'pending',
    rider: null,
    acceptedAt: null,
    pickedUpAt: null,
    reassignCount: (order.reassignCount || 0) + 1,
    promisedDeliveryTime: new Date(now.getTime() + REASSIGN_PROMISED_MINUTES * 60 * 1000),
  };

  const updatedOrder = await updateWithOptimisticLock(
    Order,
    order._id,
    order.__v,
    updateData,
    { status: order.status },
    {
      arrayPush: {
        previousRiders: {
          $each: [historyEntry],
        },
      },
    }
  );

  return updatedOrder;
};

module.exports = {
  VALID_TRANSITIONS,
  DEFAULT_PROMISED_MINUTES,
  REASSIGN_PROMISED_MINUTES,
  createOrder,
  getPendingOrders,
  getOrderById,
  getOrdersByRider,
  validateOrderAcceptableForRider,
  acceptOrderForRider,
  validateStatusTransition,
  calculateTimeoutDeduction,
  updateOrderStatusForRider,
  reassignOrderToPool,
};
