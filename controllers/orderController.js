const Order = require('../models/Order');
const Zone = require('../models/Zone');
const Rider = require('../models/Rider');
const { generateOrderNo, calculateDistance, calculateDeliveryFee } = require('../utils/helpers');

const addTimeoutMarkToRider = async (riderId, orderId, timeoutMinutes, autoReassigned = true) => {
  const penaltyPerTimeout = 10;
  const cooldownMinutesPerTimeout = 15;
  const now = new Date();

  const rider = await Rider.findById(riderId);
  if (!rider) return null;

  const timeoutRecord = {
    orderId,
    timeoutAt: now,
    timeoutMinutes,
    autoReassigned,
    expired: false,
  };

  rider.timeoutHistory.push(timeoutRecord);
  rider.lastTimeoutAt = now;

  const recentTimeouts = rider.timeoutHistory.filter(
    (t) => !t.expired && now - new Date(t.timeoutAt) < 24 * 60 * 60 * 1000
  ).length;

  rider.todayStats.timeoutsCount = (rider.todayStats.timeoutsCount || 0) + 1;
  rider.dispatchPriority = Math.max(0, 100 - recentTimeouts * penaltyPerTimeout);

  const totalCooldown = recentTimeouts * cooldownMinutesPerTimeout;
  rider.cooldownUntil = new Date(now.getTime() + totalCooldown * 60 * 1000);

  await rider.save();
  return rider;
};

const scanAndReassignTimeoutOrders = async () => {
  const now = new Date();
  const batchSize = 50;
  const reassigned = [];
  let hasMore = true;
  let skip = 0;

  while (hasMore) {
    const timeoutOrders = await Order.find({
      status: { $in: ['accepted', 'delivering'] },
      promisedDeliveryTime: { $lt: now },
      rider: { $exists: true, $ne: null },
    })
      .populate('rider', '_id')
      .skip(skip)
      .limit(batchSize);

    if (timeoutOrders.length === 0) {
      hasMore = false;
      break;
    }

    for (const order of timeoutOrders) {
      try {
        const timeoutMinutes = Math.ceil((now - new Date(order.promisedDeliveryTime)) / (1000 * 60));
        const riderId = order.rider._id || order.rider;

        order.status = 'pending';
        order.previousRiders = order.previousRiders || [];
        order.previousRiders.push({
          rider: riderId,
          acceptedAt: order.acceptedAt,
          pickedUpAt: order.pickedUpAt,
          releasedAt: now,
          releaseReason: 'timeout_auto_reassign',
          timeoutMinutes,
        });
        order.rider = null;
        order.acceptedAt = null;
        order.pickedUpAt = null;
        order.reassignCount = (order.reassignCount || 0) + 1;
        order.promisedDeliveryTime = new Date(now.getTime() + 30 * 60 * 1000);

        await order.save();

        await addTimeoutMarkToRider(riderId, order._id, timeoutMinutes, true);
        reassigned.push({ orderId: order._id, orderNo: order.orderNo, timeoutMinutes });
      } catch (err) {
        console.error(`[Reassign] 订单 ${order._id} 改派失败:`, err.message);
      }
    }

    skip += batchSize;
    if (timeoutOrders.length < batchSize) hasMore = false;
  }

  const result = {
    scannedAt: now,
    totalReassigned: reassigned.length,
    reassigned,
  };
  if (reassigned.length > 0) {
    console.log(`[TimeoutScanner] ${now.toISOString()} 改派 ${reassigned.length} 笔超时订单`);
  }
  return result;
};

const triggerTimeoutScan = async (req, res) => {
  try {
    const result = await scanAndReassignTimeoutOrders();
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const createOrder = async (req, res) => {
  try {
    const { merchant, customer, items, orderAmount } = req.body;

    if (!merchant || !customer || !items || !orderAmount) {
      return res.status(400).json({ message: '缺少必要字段' });
    }

    const distance = calculateDistance(merchant.location.coordinates, customer.location.coordinates);
    const deliveryFee = calculateDeliveryFee(distance);

    const point = {
      type: 'Point',
      coordinates: merchant.location.coordinates,
    };

    const zone = await Zone.findOne({
      boundary: {
        $geoIntersects: { $geometry: point },
      },
    });

    const order = new Order({
      orderNo: generateOrderNo(),
      merchant,
      customer,
      items,
      orderAmount,
      distance,
      deliveryFee,
      zone: zone ? zone._id : null,
      promisedDeliveryTime: new Date(Date.now() + 45 * 60 * 1000),
    });

    await order.save();
    res.status(201).json(order);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getPendingOrders = async (req, res) => {
  try {
    const { zoneId, longitude, latitude, maxDistance = 5000 } = req.query;
    const query = { status: 'pending' };

    if (zoneId) {
      query.zone = zoneId;
    }

    if (longitude && latitude) {
      query['merchant.location'] = {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [parseFloat(longitude), parseFloat(latitude)],
          },
          $maxDistance: parseInt(maxDistance),
        },
      };
    }

    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .limit(50);

    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const acceptOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const rider = req.rider;

    if (!rider.isOnline) {
      return res.status(400).json({ message: '骑手未上线，无法接单' });
    }

    const now = new Date();
    if (rider.cooldownUntil && new Date(rider.cooldownUntil) > now) {
      const remainingMinutes = Math.ceil((new Date(rider.cooldownUntil) - now) / (1000 * 60));
      return res.status(403).json({
        message: `骑手处于超时冷却期，剩余 ${remainingMinutes} 分钟后可接单`,
        cooldownUntil: rider.cooldownUntil,
        remainingMinutes,
      });
    }

    if (rider.dispatchPriority < 20) {
      return res.status(403).json({
        message: '骑手优先级过低，暂无法接单，请联系站长处理',
        dispatchPriority: rider.dispatchPriority,
      });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: '订单不存在' });
    }

    if (order.status !== 'pending') {
      return res.status(400).json({ message: '订单已被接取或已取消' });
    }

    if (order.previousRiders && order.previousRiders.some(
      (p) => p.rider && p.rider.toString() === rider._id.toString()
    )) {
      return res.status(400).json({ message: '该订单此前已被此骑手超时释放，无法再次接取' });
    }

    const deliveringCount = await Order.countDocuments({
      rider: rider._id,
      status: { $in: ['accepted', 'delivering'] },
    });

    const maxConcurrent = rider.dispatchPriority >= 80 ? 6 : rider.dispatchPriority >= 50 ? 4 : 2;
    if (deliveringCount >= maxConcurrent) {
      return res.status(400).json({
        message: `同时配送订单数已达上限（${maxConcurrent}），请先完成已有订单`,
        currentCount: deliveringCount,
        maxConcurrent,
      });
    }

    order.status = 'accepted';
    order.rider = rider._id;
    order.acceptedAt = new Date();

    await order.save();

    await Rider.updateOne(
      { _id: rider._id, 'todayStats.date': new Date().setHours(0, 0, 0, 0) },
      { $inc: { 'todayStats.ordersAccepted': 1 } },
      { upsert: false }
    );

    const updatedRider = await Rider.findById(rider._id);
    if (!updatedRider.todayStats || updatedRider.todayStats.date.toDateString() !== new Date().toDateString()) {
      updatedRider.todayStats = {
        date: new Date(),
        ordersAccepted: 1,
        ordersDelivered: 0,
        totalDistance: 0,
        totalEarnings: 0,
        timeoutsCount: 0,
      };
      await updatedRider.save();
    }

    res.json(order);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const updateOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;
    const rider = req.rider;

    const validTransitions = {
      accepted: ['delivering', 'cancelled'],
      delivering: ['delivered', 'cancelled'],
    };

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: '订单不存在' });
    }

    if (order.rider && order.rider.toString() !== rider._id.toString()) {
      return res.status(403).json({ message: '无权操作此订单' });
    }

    if (!validTransitions[order.status] || !validTransitions[order.status].includes(status)) {
      return res.status(400).json({ message: `无法从 ${order.status} 流转到 ${status}` });
    }

    order.status = status;

    if (status === 'delivering') {
      order.pickedUpAt = new Date();
    }

    if (status === 'delivered') {
      order.deliveredAt = new Date();
      if (order.promisedDeliveryTime && order.deliveredAt > order.promisedDeliveryTime) {
        const timeoutMinutes = Math.ceil((order.deliveredAt - order.promisedDeliveryTime) / (1000 * 60));
        order.timeoutDeduction = Math.min(timeoutMinutes * 0.5, order.deliveryFee * 0.5);
      }
      const actualEarnings = order.deliveryFee - order.timeoutDeduction;
      await Rider.updateOne(
        { _id: rider._id },
        {
          $inc: {
            'todayStats.ordersDelivered': 1,
            'todayStats.totalDistance': order.distance,
            'todayStats.totalEarnings': actualEarnings,
          },
        }
      );
    }

    if (status === 'cancelled') {
      order.cancelledAt = new Date();
      order.cancelReason = req.body.reason || '骑手取消';
    }

    await order.save();
    res.json(order);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getOrderDetail = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findById(orderId)
      .populate('rider', 'name phone')
      .populate('zone', 'name');

    if (!order) {
      return res.status(404).json({ message: '订单不存在' });
    }

    res.json(order);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getMyOrders = async (req, res) => {
  try {
    const { status } = req.query;
    const query = { rider: req.rider._id };
    if (status) query.status = status;

    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .limit(100);

    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  createOrder,
  getPendingOrders,
  acceptOrder,
  updateOrderStatus,
  getOrderDetail,
  getMyOrders,
  scanAndReassignTimeoutOrders,
  triggerTimeoutScan,
  addTimeoutMarkToRider,
};
