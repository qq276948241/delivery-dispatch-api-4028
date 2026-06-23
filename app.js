require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const { scanAndReassignTimeoutOrders } = require('./services/timeoutService');

const orderRoutes = require('./routes/orders');
const riderRoutes = require('./routes/riders');
const zoneRoutes = require('./routes/zones');
const settlementRoutes = require('./routes/settlements');

connectDB();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.json({
    message: '外卖骑手调度后台 API',
    version: '1.0.0',
    endpoints: {
      orders: '/api/orders',
      riders: '/api/riders',
      zones: '/api/zones',
      settlements: '/api/settlements',
    },
  });
});

app.use('/api/orders', orderRoutes);
app.use('/api/riders', riderRoutes);
app.use('/api/zones', zoneRoutes);
app.use('/api/settlements', settlementRoutes);

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
const TIMEOUT_SCAN_INTERVAL = parseInt(process.env.TIMEOUT_SCAN_INTERVAL) || 60 * 1000;

const server = app.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
});

let timeoutScannerTimer = null;

const startTimeoutScanner = () => {
  if (timeoutScannerTimer) {
    console.log('[TimeoutScanner] 扫描器已在运行中');
    return;
  }

  const runScan = async () => {
    try {
      if (mongoose.connection && mongoose.connection.readyState === 1) {
        await scanAndReassignTimeoutOrders();
      }
    } catch (err) {
      console.error('[TimeoutScanner] 扫描异常:', err.message);
    }
  };

  runScan();
  timeoutScannerTimer = setInterval(runScan, TIMEOUT_SCAN_INTERVAL);
  console.log(`[TimeoutScanner] 已启动，扫描间隔 ${TIMEOUT_SCAN_INTERVAL / 1000} 秒`);
};

const stopTimeoutScanner = () => {
  if (timeoutScannerTimer) {
    clearInterval(timeoutScannerTimer);
    timeoutScannerTimer = null;
    console.log('[TimeoutScanner] 扫描器已停止');
  }
};

const db = mongoose.connection;
if (db.readyState === 1) {
  startTimeoutScanner();
} else {
  db.once('open', startTimeoutScanner);
}

process.on('SIGTERM', () => {
  console.log('收到 SIGTERM，正在关闭服务...');
  stopTimeoutScanner();
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('收到 SIGINT，正在关闭服务...');
  stopTimeoutScanner();
  server.close(() => process.exit(0));
});

module.exports = app;
