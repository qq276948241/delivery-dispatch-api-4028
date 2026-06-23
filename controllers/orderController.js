const Order = require('../models/Order');
const Zone = require('../models/Zone');
const Rider = require('../models/Rider');
const { generateOrderNo, calculateDistance, calculateDeliveryFee } = require('../utils/helpers');

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

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: '订单不存在' });
    }

    if (order.status !== 'pending') {
      return res.status(400).json({ message: '订单已被接取或已取消' });
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
};
