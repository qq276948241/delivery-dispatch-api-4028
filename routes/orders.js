const express = require('express');
const router = express.Router();
const { auth, stationMasterAuth } = require('../middleware/auth');
const {
  createOrder,
  getPendingOrders,
  acceptOrder,
  updateOrderStatus,
  getOrderDetail,
  getMyOrders,
  triggerTimeoutScan,
} = require('../controllers/orderController');

router.post('/', createOrder);
router.get('/pending', getPendingOrders);
router.get('/my', auth, getMyOrders);
router.post('/timeout/scan', auth, stationMasterAuth, triggerTimeoutScan);
router.get('/:orderId', getOrderDetail);
router.post('/:orderId/accept', auth, acceptOrder);
router.put('/:orderId/status', auth, updateOrderStatus);

module.exports = router;
