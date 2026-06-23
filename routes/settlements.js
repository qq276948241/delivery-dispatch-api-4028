const express = require('express');
const router = express.Router();
const { auth, stationMasterAuth } = require('../middleware/auth');
const {
  calculateDailySettlement,
  getMySettlement,
  getMySettlementRange,
  settleDaily,
  getZoneSettlements,
} = require('../controllers/settlementController');

router.post('/calculate', auth, calculateDailySettlement);
router.get('/me', auth, getMySettlement);
router.get('/me/range', auth, getMySettlementRange);
router.post('/settle', auth, stationMasterAuth, settleDaily);
router.get('/zone', auth, stationMasterAuth, getZoneSettlements);

module.exports = router;
