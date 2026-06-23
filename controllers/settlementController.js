const Settlement = require('../models/Settlement');
const Order = require('../models/Order');
const Rider = require('../models/Rider');

const calculateDailySettlement = async (req, res) => {
  try {
    const { date } = req.body;
    const riderId = req.rider._id;

    const targetDate = date ? new Date(date) : new Date();
    targetDate.setHours(0, 0, 0, 0);
    const nextDate = new Date(targetDate);
    nextDate.setDate(nextDate.getDate() + 1);

    const deliveredOrders = await Order.find({
      rider: riderId,
      status: 'delivered',
      deliveredAt: { $gte: targetDate, $lt: nextDate },
    });

    let baseDeliveryFees = 0;
    let distanceBonus = 0;
    let timeoutDeductions = 0;

    deliveredOrders.forEach((order) => {
      baseDeliveryFees += order.deliveryFee;
      if (order.distance > 3) {
        distanceBonus += (order.distance - 3) * 1;
      }
      timeoutDeductions += order.timeoutDeduction || 0;
    });

    const totalOrders = deliveredOrders.length;
    const netEarnings = baseDeliveryFees + distanceBonus - timeoutDeductions;

    const settlement = await Settlement.findOneAndUpdate(
      { rider: riderId, date: targetDate },
      {
        orders: deliveredOrders.map((o) => o._id),
        totalOrders,
        baseDeliveryFees: Math.round(baseDeliveryFees * 100) / 100,
        distanceBonus: Math.round(distanceBonus * 100) / 100,
        timeoutDeductions: Math.round(timeoutDeductions * 100) / 100,
        otherDeductions: 0,
        otherBonuses: 0,
        netEarnings: Math.round(netEarnings * 100) / 100,
        status: 'pending',
      },
      { upsert: true, new: true }
    ).populate('rider', 'name phone');

    res.json(settlement);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getMySettlement = async (req, res) => {
  try {
    const { date } = req.query;
    const riderId = req.rider._id;

    let query = { rider: riderId };
    if (date) {
      const targetDate = new Date(date);
      targetDate.setHours(0, 0, 0, 0);
      query.date = targetDate;
    }

    const settlements = await Settlement.find(query)
      .sort({ date: -1 })
      .populate('orders', 'orderNo deliveryFee distance timeoutDeduction deliveredAt');

    res.json(settlements);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getMySettlementRange = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const riderId = req.rider._id;

    if (!startDate || !endDate) {
      return res.status(400).json({ message: '请提供开始和结束日期' });
    }

    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const settlements = await Settlement.find({
      rider: riderId,
      date: { $gte: start, $lte: end },
    }).sort({ date: 1 });

    const summary = settlements.reduce(
      (acc, s) => {
        acc.totalDays += 1;
        acc.totalOrders += s.totalOrders;
        acc.baseDeliveryFees += s.baseDeliveryFees;
        acc.distanceBonus += s.distanceBonus;
        acc.timeoutDeductions += s.timeoutDeductions;
        acc.otherBonuses += s.otherBonuses;
        acc.otherDeductions += s.otherDeductions;
        acc.netEarnings += s.netEarnings;
        return acc;
      },
      {
        totalDays: 0,
        totalOrders: 0,
        baseDeliveryFees: 0,
        distanceBonus: 0,
        timeoutDeductions: 0,
        otherBonuses: 0,
        otherDeductions: 0,
        netEarnings: 0,
      }
    );

    Object.keys(summary).forEach((key) => {
      if (key !== 'totalDays' && key !== 'totalOrders') {
        summary[key] = Math.round(summary[key] * 100) / 100;
      }
    });

    res.json({ settlements, summary });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const settleDaily = async (req, res) => {
  try {
    const { riderId, date } = req.body;

    if (!riderId || !date) {
      return res.status(400).json({ message: '请提供骑手ID和日期' });
    }

    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);

    const settlement = await Settlement.findOneAndUpdate(
      { rider: riderId, date: targetDate, status: 'pending' },
      { status: 'settled', settledAt: new Date() },
      { new: true }
    ).populate('rider', 'name phone');

    if (!settlement) {
      return res.status(404).json({ message: '未找到待结算记录' });
    }

    res.json(settlement);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getZoneSettlements = async (req, res) => {
  try {
    const { zoneId, date } = req.query;

    if (!zoneId) {
      return res.status(400).json({ message: '请提供区域ID' });
    }

    const riders = await Rider.find({ zone: zoneId }).select('_id');
    const riderIds = riders.map((r) => r._id);

    let query = { rider: { $in: riderIds } };
    if (date) {
      const targetDate = new Date(date);
      targetDate.setHours(0, 0, 0, 0);
      query.date = targetDate;
    }

    const settlements = await Settlement.find(query)
      .populate('rider', 'name phone')
      .sort({ date: -1 });

    res.json(settlements);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  calculateDailySettlement,
  getMySettlement,
  getMySettlementRange,
  settleDaily,
  getZoneSettlements,
};
