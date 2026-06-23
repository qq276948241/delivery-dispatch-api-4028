require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const { notFound, errorHandler } = require('./middleware/errorHandler');

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

app.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
});

module.exports = app;
