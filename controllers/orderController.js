const {
  createOrder: createOrderSvc,
  getPendingOrders: getPendingOrdersSvc,
  acceptOrderForRider,
  updateOrderStatusForRider,
  getOrderById,
  getOrdersByRider,
} = require('../services/orderService');
const { scanAndReassignTimeoutOrders } = require('../services/timeoutService');

const createOrder = async (req, res) => {
  try {
    const { merchant, customer, items, orderAmount } = req.body;
    if (!merchant || !customer || !items || !orderAmount) {
      return res.status(400).json({ message: '缺少必要字段' });
    }
    const order = await createOrderSvc(req.body);
    res.status(201).json(order);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getPendingOrders = async (req, res) => {
  try {
    const orders = await getPendingOrdersSvc(req.query);
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const acceptOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const result = await acceptOrderForRider(orderId, req.rider);
    if (!result.ok) {
      const body = { message: result.message };
      if (result.data) Object.assign(body, result.data);
      return res.status(result.status).json(body);
    }
    res.json(result.data);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        message: error.message,
        error: error.name,
        ...(error.meta && { meta: error.meta }),
      });
    }
    res.status(500).json({ message: error.message });
  }
};

const updateOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status, reason } = req.body;
    if (!status) {
      return res.status(400).json({ message: '请提供目标状态 status' });
    }
    const result = await updateOrderStatusForRider(orderId, req.rider, status, { reason });
    res.json(result.data);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        message: error.message,
        error: error.name,
        ...(error.meta && { meta: error.meta }),
      });
    }
    res.status(500).json({ message: error.message });
  }
};

const getOrderDetail = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await getOrderById(orderId, true);
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
    const orders = await getOrdersByRider(req.rider._id, status);
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const triggerTimeoutScan = async (req, res) => {
  try {
    const result = await scanAndReassignTimeoutOrders();
    res.json(result);
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
  triggerTimeoutScan,
};
