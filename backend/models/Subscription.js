import mongoose from 'mongoose';

const subscriptionLogSchema = new mongoose.Schema({
  subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription' },
  userId: { type: Number, required: true },
  userEmail: { type: String, required: true },
  action: {
    type: String,
    enum: [
      'created', 'renewed', 'cancelled', 'cancellation_scheduled',
      'cancellation_cancelled', 'auto_downgrade_to_free', 'payment_failed'
    ],
    required: true
  },
  details: { type: mongoose.Schema.Types.Mixed },
  timestamp: { type: Date, default: Date.now }
});

const subscriptionSchema = new mongoose.Schema({
  subscriptionId: Number,
  userId: { type: Number, ref: 'User', required: true },
  userEmail: { type: String, required: true },
  planId: { type: String, required: true },
  planName: { type: String, required: true },
  status: { 
    type: String, 
    enum: ['active', 'inactive', 'cancelled', 'expired'], 
    default: 'active' 
  },
  billingCycle: { 
    type: String, 
    enum: ['monthly', 'yearly'], 
    default: 'monthly' 
  },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'LKR' },
  
  // Billing dates
  startDate: { type: Date, default: Date.now },
  endDate: { type: Date },
  nextBillingDate: { type: Date },
  
  // Payment info
  paymentMethod: { type: String, default: 'payhere' },
  lastPaymentDate: { type: Date },
  payhereOrderId: { type: String },
  payherePaymentId: { type: String },
  payhereRecurringToken: { type: String },
  
  // Auto-renewal
  autoRenew: { type: Boolean, default: true },
  renewalAttempts: { type: Number, default: 0 },
  maxRenewalAttempts: { type: Number, default: 3 },
  renewalHistory: [{
    renewalDate: Date,
    amount: Number,
    status: String,
    paymentId: String,
    failureReason: String,
    attempt: Number
  }],
  
  // Cancellation scheduling fields
  cancellationScheduled: { type: Boolean, default: false },
  cancellationScheduledDate: { type: Date },
  cancellationReason: { type: String },
  cancellationEffectiveDate: { type: Date },
  cancellationProcessedDate: { type: Date },
  
  // Downgrade scheduling fields
  downgradeScheduled: { type: Boolean, default: false },
  downgradeScheduledDate: { type: Date },
  downgradeReason: { type: String },
  downgradeEffectiveDate: { type: Date },
  downgradeTargetPlan: { type: String },
  downgradeProcessedDate: { type: Date },
  
  // Grace period fields
  isInGracePeriod: { type: Boolean, default: false },
  gracePeriodStartDate: { type: Date },
  gracePeriodEndDate: { type: Date },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const subscriptionHistorySchema = new mongoose.Schema({
  userId: { type: Number, required: true },
  userEmail: { type: String, required: true },
  action: { 
    type: String, 
    enum: [
      'upgrade', 
      'downgrade', 
      'renewal', 
      'cancellation', 
      'expiry', 
      'reactivation', 
      'downgrade_scheduled', 
      'downgrade_processed',
      'downgrade_cancelled'
    ],
    required: true 
  },
  fromPlan: { type: String },
  toPlan: { type: String },
  reason: { type: String },
  effectiveDate: { type: Date },
  scheduledDate: { type: Date },
  amount: { type: Number, default: 0 },
  notes: { type: String },
  createdAt: { type: Date, default: Date.now }
});

subscriptionHistorySchema.index({ userId: 1, createdAt: -1 });
subscriptionHistorySchema.index({ userEmail: 1, createdAt: -1 });
subscriptionHistorySchema.index({ action: 1 });

const Subscription = mongoose.model('Subscription', subscriptionSchema);
const SubscriptionLog = mongoose.model('SubscriptionLog', subscriptionLogSchema);
const SubscriptionHistory = mongoose.model('SubscriptionHistory', subscriptionHistorySchema);

export { Subscription, SubscriptionLog, SubscriptionHistory };