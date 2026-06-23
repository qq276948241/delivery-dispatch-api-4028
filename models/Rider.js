const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const riderSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  password: {
    type: String,
    required: true,
    minlength: 6,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  idCard: {
    type: String,
    unique: true,
    sparse: true,
  },
  vehicleType: {
    type: String,
    enum: ['electric', 'motorcycle', 'bicycle'],
    default: 'electric',
  },
  zone: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Zone',
  },
  isOnline: {
    type: Boolean,
    default: false,
  },
  isStationMaster: {
    type: Boolean,
    default: false,
  },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point',
    },
    coordinates: {
      type: [Number],
      default: [0, 0],
    },
  },
  lastLocationUpdate: {
    type: Date,
  },
  todayStats: {
    date: {
      type: Date,
      default: Date.now,
    },
    ordersAccepted: {
      type: Number,
      default: 0,
    },
    ordersDelivered: {
      type: Number,
      default: 0,
    },
    totalDistance: {
      type: Number,
      default: 0,
    },
    totalEarnings: {
      type: Number,
      default: 0,
    },
    timeoutsCount: {
      type: Number,
      default: 0,
    },
  },
  dispatchPriority: {
    type: Number,
    default: 100,
    min: 0,
    max: 100,
  },
  timeoutHistory: [
    {
      orderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order',
        required: true,
      },
      timeoutAt: {
        type: Date,
        default: Date.now,
      },
      timeoutMinutes: {
        type: Number,
        required: true,
      },
      autoReassigned: {
        type: Boolean,
        default: true,
      },
      expired: {
        type: Boolean,
        default: false,
      },
    },
  ],
  lastTimeoutAt: {
    type: Date,
  },
  cooldownUntil: {
    type: Date,
  },
}, {
  timestamps: true,
});

riderSchema.index({ location: '2dsphere' });
riderSchema.index({ dispatchPriority: -1 });

riderSchema.virtual('isInCooldown').get(function () {
  return this.cooldownUntil && this.cooldownUntil > new Date();
});

riderSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

riderSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('Rider', riderSchema);
