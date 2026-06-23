const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  orderNo: {
    type: String,
    required: true,
    unique: true,
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'delivering', 'delivered', 'cancelled'],
    default: 'pending',
  },
  merchant: {
    name: { type: String, required: true },
    phone: { type: String, required: true },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        required: true,
      },
    },
    address: { type: String, required: true },
  },
  customer: {
    name: { type: String, required: true },
    phone: { type: String, required: true },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        required: true,
      },
    },
    address: { type: String, required: true },
  },
  zone: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Zone',
  },
  rider: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Rider',
  },
  items: [
    {
      name: String,
      quantity: Number,
      price: Number,
    },
  ],
  orderAmount: {
    type: Number,
    required: true,
  },
  deliveryFee: {
    type: Number,
    default: 0,
  },
  distance: {
    type: Number,
    default: 0,
  },
  promisedDeliveryTime: {
    type: Date,
  },
  acceptedAt: {
    type: Date,
  },
  pickedUpAt: {
    type: Date,
  },
  deliveredAt: {
    type: Date,
  },
  cancelledAt: {
    type: Date,
  },
  cancelReason: {
    type: String,
  },
  timeoutDeduction: {
    type: Number,
    default: 0,
  },
  reassignCount: {
    type: Number,
    default: 0,
  },
  previousRiders: [
    {
      rider: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Rider',
      },
      acceptedAt: Date,
      pickedUpAt: Date,
      releasedAt: {
        type: Date,
        default: Date.now,
      },
      releaseReason: {
        type: String,
        enum: ['timeout_auto_reassign', 'manual_cancel', 'other'],
      },
      timeoutMinutes: Number,
    },
  ],
}, {
  timestamps: true,
  versionKey: '__v',
});

orderSchema.index({ 'merchant.location': '2dsphere' });
orderSchema.index({ 'customer.location': '2dsphere' });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ status: 1, __v: 1 });
orderSchema.index({ rider: 1, status: 1 });

module.exports = mongoose.model('Order', orderSchema);
