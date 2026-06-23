const express = require('express');
const router = express.Router();
const { auth, stationMasterAuth } = require('../middleware/auth');
const {
  register,
  login,
  goOnline,
  goOffline,
  updateLocation,
  getMyProfile,
  getTodayStats,
  getNearbyRiders,
  getMyTimeoutHistory,
  recordTimeout,
  clearTimeoutHistory,
} = require('../controllers/riderController');

router.post('/register', register);
router.post('/login', login);
router.post('/online', auth, goOnline);
router.post('/offline', auth, goOffline);
router.post('/location', auth, updateLocation);
router.get('/me', auth, getMyProfile);
router.get('/stats/today', auth, getTodayStats);
router.get('/timeouts/me', auth, getMyTimeoutHistory);
router.post('/timeouts/record', auth, stationMasterAuth, recordTimeout);
router.post('/timeouts/clear/:riderId?', auth, clearTimeoutHistory);
router.get('/nearby', getNearbyRiders);

module.exports = router;
