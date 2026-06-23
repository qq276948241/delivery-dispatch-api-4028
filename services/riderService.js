const Rider = require('../models/Rider');
const Order = require('../models/Order');

const PENALTY_PER_TIMEOUT = 10;
const COOLDOWN_MINUTES_PER_TIMEOUT = 15;
const PRIORITY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MIN_PRIORITY_TO_ACCEPT = 20;

const CONCURRENCY_LIMITS = [
  { minPriority: 80, maxOrders: 6 },
  { minPriority: 50, maxOrders: 4 },
  { minPriority: 0, maxOrders: 2 },
];

const getMaxConcurrentOrders = (dispatchPriority) => {
  const rule = CONCURRENCY_LIMITS.find((r) => dispatchPriority >= r.minPriority);
  return rule ? rule.maxOrders : 2;
};

const isInCooldown = (rider, now = new Date()) => {
  return !!(rider.cooldownUntil && new Date(rider.cooldownUntil) > now);
};

const getRemainingCooldownMinutes = (rider, now = new Date()) => {
  if (!isInCooldown(rider, now)) return 0;
  return Math.ceil((new Date(rider.cooldownUntil) - now) / (1000 * 60));
};

const countRecentTimeouts = (rider, now = new Date()) => {
  return (rider.timeoutHistory || []).filter(
    (t) => !t.expired && now - new Date(t.timeoutAt) < PRIORITY_WINDOW_MS
  ).length;
};

const countDeliveringOrders = async (riderId) => {
  return Order.countDocuments({
    rider: riderId,
    status: { $in: ['accepted', 'delivering'] },
  });
};

const addTimeoutMark = async (riderId, orderId, timeoutMinutes, autoReassigned = true) => {
  const now = new Date();
  const rider = await Rider.findById(riderId);
  if (!rider) return null;

  rider.timeoutHistory.push({
    orderId,
    timeoutAt: now,
    timeoutMinutes,
    autoReassigned,
    expired: false,
  });
  rider.lastTimeoutAt = now;

  const recentTimeouts = countRecentTimeouts(rider, now);
  rider.todayStats.timeoutsCount = (rider.todayStats.timeoutsCount || 0) + 1;
  rider.dispatchPriority = Math.max(0, 100 - recentTimeouts * PENALTY_PER_TIMEOUT);

  const totalCooldownMinutes = recentTimeouts * COOLDOWN_MINUTES_PER_TIMEOUT;
  rider.cooldownUntil = new Date(now.getTime() + totalCooldownMinutes * 60 * 1000);

  await rider.save();
  return rider;
};

const clearTimeoutRecords = async (riderId) => {
  const rider = await Rider.findById(riderId);
  if (!rider) return null;

  rider.timeoutHistory = [];
  rider.dispatchPriority = 100;
  rider.cooldownUntil = null;
  rider.lastTimeoutAt = null;
  if (rider.todayStats) {
    rider.todayStats.timeoutsCount = 0;
  }

  await rider.save();
  return rider;
};

const validateRiderCanAccept = async (rider) => {
  const now = new Date();

  if (!rider.isOnline) {
    return { ok: false, status: 400, message: '骑手未上线，无法接单' };
  }

  if (isInCooldown(rider, now)) {
    return {
      ok: false,
      status: 403,
      message: `骑手处于超时冷却期，剩余 ${getRemainingCooldownMinutes(rider, now)} 分钟后可接单`,
      data: {
        cooldownUntil: rider.cooldownUntil,
        remainingMinutes: getRemainingCooldownMinutes(rider, now),
      },
    };
  }

  if (rider.dispatchPriority < MIN_PRIORITY_TO_ACCEPT) {
    return {
      ok: false,
      status: 403,
      message: '骑手优先级过低，暂无法接单，请联系站长处理',
      data: { dispatchPriority: rider.dispatchPriority },
    };
  }

  const deliveringCount = await countDeliveringOrders(rider._id);
  const maxConcurrent = getMaxConcurrentOrders(rider.dispatchPriority);
  if (deliveringCount >= maxConcurrent) {
    return {
      ok: false,
      status: 400,
      message: `同时配送订单数已达上限（${maxConcurrent}），请先完成已有订单`,
      data: { currentCount: deliveringCount, maxConcurrent },
    };
  }

  return { ok: true };
};

const ensureTodayStats = async (riderId) => {
  const rider = await Rider.findById(riderId);
  if (!rider) return null;

  if (!rider.todayStats || rider.todayStats.date.toDateString() !== new Date().toDateString()) {
    rider.todayStats = {
      date: new Date(),
      ordersAccepted: 0,
      ordersDelivered: 0,
      totalDistance: 0,
      totalEarnings: 0,
      timeoutsCount: 0,
    };
    await rider.save();
  }
  return rider;
};

const buildTimeoutStats = (rider, days = 30) => {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - parseInt(days));
  const now = new Date();

  const filtered = (rider.timeoutHistory || []).filter(
    (t) => new Date(t.timeoutAt) >= cutoffDate
  );
  const history = [...filtered]
    .sort((a, b) => new Date(b.timeoutAt) - new Date(a.timeoutAt));

  const stats = {
    totalTimeouts: filtered.length,
    dispatchPriority: rider.dispatchPriority,
    cooldownUntil: rider.cooldownUntil || null,
    isInCooldown: isInCooldown(rider, now),
    lastTimeoutAt: rider.lastTimeoutAt || null,
    todayTimeoutsCount:
      rider.todayStats && rider.todayStats.date.toDateString() === now.toDateString()
        ? rider.todayStats.timeoutsCount || 0
        : 0,
  };

  return { stats, history };
};

module.exports = {
  PENALTY_PER_TIMEOUT,
  COOLDOWN_MINUTES_PER_TIMEOUT,
  PRIORITY_WINDOW_MS,
  MIN_PRIORITY_TO_ACCEPT,
  CONCURRENCY_LIMITS,
  getMaxConcurrentOrders,
  isInCooldown,
  getRemainingCooldownMinutes,
  countRecentTimeouts,
  countDeliveringOrders,
  addTimeoutMark,
  clearTimeoutRecords,
  validateRiderCanAccept,
  ensureTodayStats,
  buildTimeoutStats,
};
