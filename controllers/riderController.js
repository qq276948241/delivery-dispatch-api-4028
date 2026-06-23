const jwt = require('jsonwebtoken');
const Rider = require('../models/Rider');
const Order = require('../models/Order');

const register = async (req, res) => {
  try {
    const { phone, password, name, idCard, vehicleType, zone } = req.body;

    if (!phone || !password || !name) {
      return res.status(400).json({ message: '手机号、密码、姓名为必填项' });
    }

    const existingRider = await Rider.findOne({ phone });
    if (existingRider) {
      return res.status(400).json({ message: '该手机号已注册' });
    }

    const rider = new Rider({
      phone,
      password,
      name,
      idCard,
      vehicleType,
      zone,
      todayStats: {
        date: new Date(),
        ordersAccepted: 0,
        ordersDelivered: 0,
        totalDistance: 0,
        totalEarnings: 0,
      },
    });

    await rider.save();

    const token = jwt.sign(
      { riderId: rider._id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    rider.password = undefined;
    res.status(201).json({ rider, token });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const login = async (req, res) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({ message: '请提供手机号和密码' });
    }

    const rider = await Rider.findOne({ phone });
    if (!rider) {
      return res.status(401).json({ message: '手机号或密码错误' });
    }

    const isPasswordValid = await rider.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: '手机号或密码错误' });
    }

    const token = jwt.sign(
      { riderId: rider._id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    rider.password = undefined;
    res.json({ rider, token });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const goOnline = async (req, res) => {
  try {
    const rider = await Rider.findByIdAndUpdate(
      req.rider._id,
      { isOnline: true },
      { new: true }
    ).select('-password');

    res.json(rider);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const goOffline = async (req, res) => {
  try {
    const activeOrders = await Order.countDocuments({
      rider: req.rider._id,
      status: { $in: ['accepted', 'delivering'] },
    });

    if (activeOrders > 0) {
      return res.status(400).json({ message: '还有未完成订单，无法下线' });
    }

    const rider = await Rider.findByIdAndUpdate(
      req.rider._id,
      { isOnline: false },
      { new: true }
    ).select('-password');

    res.json(rider);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const updateLocation = async (req, res) => {
  try {
    const { longitude, latitude } = req.body;

    if (longitude === undefined || latitude === undefined) {
      return res.status(400).json({ message: '请提供经纬度' });
    }

    const rider = await Rider.findByIdAndUpdate(
      req.rider._id,
      {
        'location.coordinates': [longitude, latitude],
        lastLocationUpdate: new Date(),
      },
      { new: true }
    ).select('-password');

    res.json(rider);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getMyProfile = async (req, res) => {
  try {
    const rider = await Rider.findById(req.rider._id)
      .populate('zone', 'name')
      .select('-password');

    res.json(rider);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getTodayStats = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const rider = await Rider.findById(req.rider._id);

    let stats;
    if (rider.todayStats && rider.todayStats.date.toDateString() === new Date().toDateString()) {
      stats = rider.todayStats;
    } else {
      stats = {
        date: new Date(),
        ordersAccepted: 0,
        ordersDelivered: 0,
        totalDistance: 0,
        totalEarnings: 0,
      };
    }

    const deliveringCount = await Order.countDocuments({
      rider: req.rider._id,
      status: { $in: ['accepted', 'delivering'] },
    });

    res.json({ ...stats.toObject ? stats.toObject() : stats, deliveringCount });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getNearbyRiders = async (req, res) => {
  try {
    const { longitude, latitude, maxDistance = 3000, zoneId } = req.query;

    if (!longitude || !latitude) {
      return res.status(400).json({ message: '请提供经纬度' });
    }

    const query = {
      isOnline: true,
      location: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [parseFloat(longitude), parseFloat(latitude)],
          },
          $maxDistance: parseInt(maxDistance),
        },
      },
    };

    if (zoneId) {
      query.zone = zoneId;
    }

    const riders = await Rider.find(query)
      .select('-password -todayStats')
      .limit(30);

    res.json(riders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  register,
  login,
  goOnline,
  goOffline,
  updateLocation,
  getMyProfile,
  getTodayStats,
  getNearbyRiders,
};
