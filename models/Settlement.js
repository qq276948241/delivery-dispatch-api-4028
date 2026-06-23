const mongoose = require('mongoose');

const settlementSchema = new mongoose.Schema({
  rider: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Rider',
    required: true,
  },
  date: {
    type: Date,
    required: true,
  },
  orders: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
    },
  ],
  totalOrders: {
    type: Number,
    default: 0,
  },
  baseDeliveryFees: {
    type: Number,
    default: 0,
  },
  distanceBonus: {
    type: Number,
    default: 0,
  },
  timeoutDeductions: {
    type: Number,
    default: 0,
  },
  otherDeductions: {
    type: Number,
    default: 0,
  },
  otherBonuses: {
    type: Number,
    default: 0,
  },
  netEarnings: {
    type: Number,
    default: 0,
  },
  status: {
    type: String,
    enum: ['pending', 'settled'],
    default: 'pending',
  },
  settledAt: {
    type: Date,
  },
}, {
  timestamps: true,
});

settlementSchema.index({ rider: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('Settlement', settlementSchema);
