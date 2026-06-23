const jwt = require('jsonwebtoken');
const Rider = require('../models/Rider');

const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ message: '未提供认证令牌' });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const rider = await Rider.findById(decoded.riderId).select('-password');
    if (!rider) {
      return res.status(401).json({ message: '骑手不存在' });
    }
    req.rider = rider;
    next();
  } catch (error) {
    res.status(401).json({ message: '认证失败' });
  }
};

const stationMasterAuth = async (req, res, next) => {
  try {
    if (!req.rider.isStationMaster) {
      return res.status(403).json({ message: '需要站长权限' });
    }
    next();
  } catch (error) {
    res.status(500).json({ message: '服务器错误' });
  }
};

module.exports = { auth, stationMasterAuth };
