const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const {
  register,
  login,
  goOnline,
  goOffline,
  updateLocation,
  getMyProfile,
  getTodayStats,
  getNearbyRiders,
} = require('../controllers/riderController');

router.post('/register', register);
router.post('/login', login);
router.post('/online', auth, goOnline);
router.post('/offline', auth, goOffline);
router.post('/location', auth, updateLocation);
router.get('/me', auth, getMyProfile);
router.get('/stats/today', auth, getTodayStats);
router.get('/nearby', getNearbyRiders);

module.exports = router;
