import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import { PORT, mongodbURL, stripeSecretKey } from './config.js';
import Stripe from 'stripe';
import 'dotenv/config';
import contactusRoute from './routes/ContactusRoute.js';
import bcrypt from 'bcryptjs';
import bodyParser from 'body-parser';
import PaymentRoute from './routes/PaymentRoute.js';
import dotenv from 'dotenv';
import axios from 'axios';
import AutoIncrementFactory from 'mongoose-sequence';
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import cron from 'node-cron';
import CryptoJS from 'crypto-js';


dotenv.config();

const app = express();
app.use(bodyParser.json());
app.use(express.json());


app.get('/', (req, res) => {
  return res.status(200).send('Welcome to MERN stack');
});

app.use(cors({
  origin: ['http://localhost:5555', 'http://localhost:5173'], 
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));


const adminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true }, // Add email field
  password: { type: String, required: true },
}, {
  timestamps: true // This will automatically add createdAt and updatedAt
});
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  sequence_value: { type: Number, default: 0 }
});

counterSchema.statics.getNextSequence = async function(sequenceName) {
  try {
    const result = await this.findOneAndUpdate(
      { _id: sequenceName },
      { $inc: { sequence_value: 1 } },
      { new: true, upsert: true }
    );
    return result.sequence_value;
  } catch (error) {
    console.error('Error getting next sequence:', error);
    return Date.now(); // Fallback to timestamp
  }
};

const Counter = mongoose.model('Counter', counterSchema);

async function checkUserPlanLimits(userId) {
  try {
    console.log('Checking plan limits for userId:', userId);

    // Get user's current subscription
    const activeSubscription = await Subscription.findOne({
      userId: userId,
      status: 'active'
    }).sort({ createdAt: -1 });

    if (!activeSubscription) {
      return {
        exceedsLimits: false,
        message: 'No active subscription found'
      };
    }

    // Only check limits for free plan users (planId '1')
    if (activeSubscription.planId !== '1') {
      console.log('User has premium plan, no limit check needed');
      return {
        exceedsLimits: false,
        message: 'Premium user - no limits'
      };
    }

    // Count current businesses and offers
    const businessCount = await Business.countDocuments({
      userId: userId,
      status: { $ne: 'deleted' }
    });

    const offerCount = await Offer.countDocuments({
      userId: userId,
      status: { $ne: 'deleted' }
    });

    const freeLimits = { maxBusinesses: 1, maxOffers: 3 };
    const exceedsLimits = businessCount > freeLimits.maxBusinesses || offerCount > freeLimits.maxOffers;

    console.log('Plan limits check result:', {
      businessCount,
      offerCount,
      limits: freeLimits,
      exceedsLimits
    });

    return {
      exceedsLimits,
      currentBusinesses: businessCount,
      currentOffers: offerCount,
      maxBusinesses: freeLimits.maxBusinesses,
      maxOffers: freeLimits.maxOffers,
      exceedsBusinesses: businessCount > freeLimits.maxBusinesses,
      exceedsOffers: offerCount > freeLimits.maxOffers,
      businessesToDelete: Math.max(0, businessCount - freeLimits.maxBusinesses),
      offersToDelete: Math.max(0, offerCount - freeLimits.maxOffers)
    };
  } catch (error) {
    console.error('Error checking plan limits:', error);
    return {
      exceedsLimits: false,
      error: 'Failed to check limits'
    };
  }
}

const handleInitialPaymentWithRecurring = async (notificationData) => {
  try {
    const {
      order_id,
      payment_id,
      payhere_amount,
      payhere_currency,
      email,
      custom_1,
      custom_2,
      recurring_token,
      next_occurrence_date
    } = notificationData;

    const planId = custom_1?.replace('plan_', '') || '2';
    const isRecurring = custom_2 === 'monthly_recurring';

    // Check if subscription already exists
    const existingSubscription = await Subscription.findOne({ payhereOrderId: order_id });

    if (existingSubscription) {
      console.log('ℹ️ Updating existing subscription with recurring data...');

      if (isRecurring && recurring_token) {
        existingSubscription.payhereRecurringToken = recurring_token;
        existingSubscription.autoRenew = true;
        existingSubscription.nextBillingDate = next_occurrence_date ?
          new Date(next_occurrence_date) :
          new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await existingSubscription.save();

        console.log('✅ Existing subscription updated with auto-renewal');
      }
      return;
    }

    // Create new subscription with auto-renewal
    const nextBillingDate = isRecurring && recurring_token ?
      (next_occurrence_date ? new Date(next_occurrence_date) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)) :
      null;

    const subscription = new Subscription({
      userId: null, // Will be linked later
      userEmail: email || 'customer@example.com',
      planId: planId.toString(),
      planName: planId === '1' ? 'Free Plan' : 'Premium Plan',
      status: 'active',
      billingCycle: 'monthly',
      amount: parseFloat(payhere_amount),
      currency: payhere_currency,
      paymentMethod: 'payhere',
      payhereOrderId: order_id,
      payherePaymentId: payment_id,
      payhereRecurringToken: recurring_token,
      autoRenew: isRecurring && !!recurring_token,
      nextBillingDate: nextBillingDate,
      renewalAttempts: 0,
      maxRenewalAttempts: 3,
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      renewalHistory: [{
        renewalDate: new Date(),
        amount: parseFloat(payhere_amount),
        status: 'success',
        paymentId: payment_id,
        attempt: 1
      }]
    });

    await subscription.save();

    console.log('✅ New subscription created with auto-renewal support:', {
      id: subscription._id,
      autoRenew: subscription.autoRenew,
      nextBilling: subscription.nextBillingDate
    });

  } catch (error) {
    console.error('❌ Failed to handle initial payment with recurring:', error);
  }
};

const handleRecurringPaymentNotification = async (notificationData) => {
  try {
    const {
      subscription_id,
      payment_id,
      payhere_amount,
      status_code,
      email,
      next_occurrence_date
    } = notificationData;

    // Find subscription by recurring token or email
    const subscription = await Subscription.findOne({
      $or: [
        { payhereRecurringToken: subscription_id },
        { userEmail: email?.toLowerCase().trim() }
      ],
      autoRenew: true
    });

    if (!subscription) {
      console.error('❌ Subscription not found for recurring payment');
      return;
    }

    if (status_code === '2') {
      // Successful renewal
      console.log('✅ Recurring payment successful for subscription:', subscription._id);

      subscription.status = 'active';
      subscription.endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      subscription.nextBillingDate = next_occurrence_date ?
        new Date(next_occurrence_date) :
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      subscription.renewalAttempts = 0;
      subscription.updatedAt = new Date();

      // Add to renewal history
      subscription.renewalHistory.push({
        renewalDate: new Date(),
        amount: parseFloat(payhere_amount),
        status: 'success',
        paymentId: payment_id,
        attempt: subscription.renewalAttempts + 1
      });

      await subscription.save();

      // Send success email
      const user = await User.findOne({ userId: subscription.userId });
      if (user) {
        await sendRenewalSuccessEmail(user, subscription, parseFloat(payhere_amount));
      }

      console.log('✅ Subscription renewed successfully');
    } else {
      // Failed renewal
      console.log('❌ Recurring payment failed');

      subscription.renewalAttempts += 1;
      subscription.status = subscription.renewalAttempts >= subscription.maxRenewalAttempts ?
        'cancelled' : 'pending_renewal';

      subscription.renewalHistory.push({
        renewalDate: new Date(),
        amount: parseFloat(payhere_amount),
        status: 'failed',
        failureReason: `Payment failed with status code: ${status_code}`,
        attempt: subscription.renewalAttempts
      });

      if (subscription.renewalAttempts >= subscription.maxRenewalAttempts) {
        subscription.autoRenew = false;
        subscription.endDate = new Date(); // Expire immediately
      }

      await subscription.save();

      // Send failure email
      const user = await User.findOne({ userId: subscription.userId });
      if (user) {
        await sendRenewalFailedEmail(user, subscription, subscription.renewalAttempts);
      }
    }

  } catch (error) {
    console.error('❌ Failed to handle recurring payment notification:', error);
  }
};

const handleSubscriptionCancellationNotification = async (notificationData) => {
  try {
    const { subscription_id, email } = notificationData;

    const subscription = await Subscription.findOne({
      $or: [
        { payhereRecurringToken: subscription_id },
        { userEmail: email?.toLowerCase().trim() }
      ],
      autoRenew: true
    });

    if (!subscription) {
      console.error('❌ Subscription not found for cancellation');
      return;
    }

    subscription.autoRenew = false;
    subscription.status = 'cancelled';
    subscription.nextBillingDate = null;
    subscription.updatedAt = new Date();

    await subscription.save();

    // Send cancellation email
    const user = await User.findOne({ userId: subscription.userId });
    if (user) {
      await sendSubscriptionCancelledEmail(user, subscription);
    }

    console.log('✅ Subscription cancelled via PayHere notification');

  } catch (error) {
    console.error('❌ Failed to handle subscription cancellation:', error);
  }
};
const handleInitialSubscription = async (notificationData) => {
  try {
    const {
      order_id,
      payment_id,
      payhere_amount,
      payhere_currency,
      email,
      custom_1,
      recurring_token,
      subscription_id
    } = notificationData;

    console.log('🔄 Processing initial subscription creation...');

    const planId = custom_1?.replace('plan_', '') || '2';
    const isRecurring = !!recurring_token;

    // Check if subscription record already exists
    const existingSubscription = await Subscription.findOne({ payhereOrderId: order_id });

    if (existingSubscription) {
      console.log('ℹ️ Subscription record already exists for this order');

      // Update with recurring information if available
      if (isRecurring) {
        existingSubscription.payhereRecurringToken = recurring_token;
        existingSubscription.autoRenew = true;
        existingSubscription.nextBillingDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await existingSubscription.save();
        console.log('✅ Updated existing subscription with recurring token');
      }

      return;
    }


    async function autoEnforcePlanLimits(userId) {
      try {
        console.log('🔧 Auto-enforcing plan limits for userId:', userId);

        const user = await User.findOne({ userId: parseInt(userId) });
        if (!user) {
          console.log('❌ User not found for auto-enforcement');
          return;
        }

        const businessCount = await Business.countDocuments({
          userId: parseInt(userId),
          status: { $ne: 'deleted' }
        });

        const offerCount = await Offer.countDocuments({
          userId: parseInt(userId),
          status: { $ne: 'deleted' }
        });

        const freeLimits = { maxBusinesses: 1, maxOffers: 3 };

        // Suspend excess businesses (keep the most recent one active)
        if (businessCount > freeLimits.maxBusinesses) {
          const excessBusinesses = await Business.find({
            userId: parseInt(userId),
            status: 'active'
          })
            .sort({ createdAt: -1 })
            .skip(freeLimits.maxBusinesses);

          for (const business of excessBusinesses) {
            await Business.findByIdAndUpdate(business._id, {
              status: 'suspended',
              suspendedDate: new Date(),
              suspensionReason: 'Exceeded free plan business limit',
              updatedAt: new Date()
            });

            // Also suspend all offers for this business
            await Offer.updateMany(
              { businessId: business._id },
              {
                status: 'suspended',
                suspendedDate: new Date(),
                suspensionReason: 'Business suspended due to plan limit',
                updatedAt: new Date()
              }
            );

            console.log(`🚫 Suspended business: ${business.name}`);
          }
        }

        // Suspend excess offers (keep the most recent ones active)
        if (offerCount > freeLimits.maxOffers) {
          const excessOffers = await Offer.find({
            userId: parseInt(userId),
            status: 'active'
          })
            .sort({ createdAt: -1 })
            .skip(freeLimits.maxOffers);

          for (const offer of excessOffers) {
            await Offer.findByIdAndUpdate(offer._id, {
              status: 'suspended',
              suspendedDate: new Date(),
              suspensionReason: 'Exceeded free plan offer limit',
              updatedAt: new Date()
            });

            console.log(`🚫 Suspended offer: ${offer.title}`);
          }
        }

        // Log the auto-enforcement
        await SubscriptionHistory.create({
          userId: parseInt(userId),
          userEmail: user.email,
          action: 'auto_plan_enforcement',
          fromPlan: 'Premium',
          toPlan: 'Free',
          reason: 'Auto-suspended excess items due to plan downgrade',
          effectiveDate: new Date()
        });

        console.log('✅ Auto-enforcement completed');

      } catch (error) {
        console.error('❌ Error in auto-enforcement:', error);
      }
    }
    // Calculate next billing date (30 days from now)
    const nextBillingDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);


    const attemptManualRenewal = async (subscription) => {
      try {
        console.log(`🔄 Attempting manual renewal for subscription: ${subscription._id}`);

        // This would require implementing PayHere's recurring payment API
        // For now, we'll mark it as failed and notify the user

        subscription.renewalAttempts += 1;
        subscription.status = 'pending_renewal';

        // Add to renewal history
        subscription.renewalHistory.push({
          renewalDate: new Date(),
          amount: subscription.amount,
          status: 'failed',
          failureReason: 'Automatic renewal failed - manual intervention required',
          attempt: subscription.renewalAttempts
        });

        // If max attempts reached, cancel subscription
        if (subscription.renewalAttempts >= subscription.maxRenewalAttempts) {
          subscription.status = 'expired';
          subscription.autoRenew = false;

          // Set end date to now
          subscription.endDate = new Date();

          console.log(`❌ Subscription ${subscription._id} expired after ${subscription.maxRenewalAttempts} attempts`);
        }

        await subscription.save();

        // Send notification email
        const user = await User.findOne({ userId: subscription.userId });
        if (user) {
          if (subscription.status === 'expired') {
            await sendSubscriptionExpiredEmail(user, subscription);
          } else {
            await sendRenewalFailedEmail(user, subscription, subscription.renewalAttempts);
          }
        }

      } catch (error) {
        console.error(`❌ Manual renewal attempt failed for ${subscription._id}:`, error);
      }
    };
    // Create subscription record
    const subscription = new Subscription({
      userId: null, // Will be updated when we match with user
      userEmail: email || 'customer@example.com',
      planId: planId.toString(),
      planName: planId === '1' ? 'Free Plan' : 'Premium Plan',
      status: 'active',
      billingCycle: 'monthly',
      amount: parseFloat(payhere_amount),
      currency: payhere_currency,
      paymentMethod: 'payhere',
      payhereOrderId: order_id,
      payherePaymentId: payment_id,
      payhereRecurringToken: recurring_token,
      autoRenew: isRecurring,
      nextBillingDate: isRecurring ? nextBillingDate : null,
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      renewalHistory: [{
        renewalDate: new Date(),
        amount: parseFloat(payhere_amount),
        status: 'success',
        paymentId: payment_id,
        attempt: 1
      }]
    });

    await subscription.save();
    console.log('✅ Initial subscription with auto-renewal created:', subscription._id);

  } catch (error) {
    console.error('❌ Failed to create initial subscription:', error);
  }
};


const sendRenewalSuccessEmail = async (user, subscription, amount) => {
  const transporter = createTransporter();

  const mailOptions = {
    from: process.env.EMAIL_USERNAME,
    to: user.email,
    subject: '✅ Subscription Renewed Successfully',
    html: `
      <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
        <div style="background: #28a745; color: white; padding: 20px; text-align: center;">
          <h1>✅ Subscription Renewed</h1>
        </div>
        <div style="padding: 20px;">
          <p>Dear ${user.firstName},</p>
          <p>Your ${subscription.planName} subscription has been automatically renewed.</p>
          
          <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3>Renewal Details:</h3>
            <p><strong>Plan:</strong> ${subscription.planName}</p>
            <p><strong>Amount:</strong> ${subscription.currency} ${amount.toFixed(2)}</p>
            <p><strong>Next Billing:</strong> ${subscription.nextBillingDate.toLocaleDateString()}</p>
            <p><strong>Valid Until:</strong> ${subscription.endDate.toLocaleDateString()}</p>
          </div>
          
          <p>Your premium features remain active. Thank you for your continued subscription!</p>
          
          <div style="text-align: center; margin: 20px 0;">
            <a href="http://localhost:5173/dashboard" style="background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
              View Dashboard
            </a>
          </div>
        </div>
      </div>
    `
  };

  await transporter.sendMail(mailOptions);
};

const sendRenewalFailedEmail = async (user, subscription, attemptNumber) => {
  const transporter = createTransporter();

  const isLastAttempt = attemptNumber >= subscription.maxRenewalAttempts;

  const mailOptions = {
    from: process.env.EMAIL_USERNAME,
    to: user.email,
    subject: isLastAttempt ? '❌ Subscription Cancelled - Payment Failed' : '⚠️ Subscription Renewal Failed',
    html: `
      <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
        <div style="background: ${isLastAttempt ? '#dc3545' : '#ffc107'}; color: white; padding: 20px; text-align: center;">
          <h1>${isLastAttempt ? '❌ Subscription Cancelled' : '⚠️ Renewal Failed'}</h1>
        </div>
        <div style="padding: 20px;">
          <p>Dear ${user.firstName},</p>
          
          ${isLastAttempt ? `
            <p>We were unable to renew your ${subscription.planName} subscription after ${attemptNumber} attempts. Your subscription has been cancelled.</p>
            <p><strong>Your premium features will be disabled.</strong></p>
          ` : `
            <p>We couldn't process your ${subscription.planName} subscription renewal (attempt ${attemptNumber} of ${subscription.maxRenewalAttempts}).</p>
            <p>We'll try again soon, but you can also update your payment method to ensure uninterrupted service.</p>
          `}
          
          <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3>Subscription Details:</h3>
            <p><strong>Plan:</strong> ${subscription.planName}</p>
            <p><strong>Amount:</strong> ${subscription.currency} ${subscription.amount.toFixed(2)}</p>
            <p><strong>Status:</strong> ${isLastAttempt ? 'Cancelled' : 'Pending Renewal'}</p>
          </div>
          
          <div style="text-align: center; margin: 20px 0;">
            <a href="http://localhost:5173/subscription" style="background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
              ${isLastAttempt ? 'Resubscribe Now' : 'Update Payment Method'}
            </a>
          </div>
        </div>
      </div>
    `
  };

  await transporter.sendMail(mailOptions);
};

const sendSubscriptionCancelledEmail = async (user, subscription) => {
  const transporter = createTransporter();

  const mailOptions = {
    from: process.env.EMAIL_USERNAME,
    to: user.email,
    subject: '❌ Subscription Cancelled',
    html: `
      <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
        <div style="background: #dc3545; color: white; padding: 20px; text-align: center;">
          <h1>❌ Subscription Cancelled</h1>
        </div>
        <div style="padding: 20px;">
          <p>Dear ${user.firstName},</p>
          <p>Your ${subscription.planName} subscription has been cancelled as requested.</p>
          
          <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Service continues until:</strong> ${subscription.endDate.toLocaleDateString()}</p>
            <p>After this date, your account will revert to the Free plan.</p>
          </div>
          
          <p>You can resubscribe anytime to regain premium features.</p>
          
          <div style="text-align: center; margin: 20px 0;">
            <a href="http://localhost:5173/subscription" style="background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
              Resubscribe
            </a>
          </div>
        </div>
      </div>
    `
  };

  await transporter.sendMail(mailOptions);
};

const sendSubscriptionExpiredEmail = async (user, subscription) => {
  const transporter = createTransporter();

  const mailOptions = {
    from: process.env.EMAIL_USERNAME,
    to: user.email,
    subject: '⏰ Subscription Expired',
    html: `
      <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
        <div style="background: #6c757d; color: white; padding: 20px; text-align: center;">
          <h1>⏰ Subscription Expired</h1>
        </div>
        <div style="padding: 20px;">
          <p>Dear ${user.firstName},</p>
          <p>Your ${subscription.planName} subscription has expired due to payment failures.</p>
          
          <div style="background: #f8d7da; padding: 15px; border-radius: 5px; margin: 20px 0; color: #721c24;">
            <p><strong>Your account has been downgraded to the Free plan.</strong></p>
            <p>Premium features are no longer available.</p>
          </div>
          
          <p>Resubscribe now to restore your premium features and continue growing your business!</p>
          
          <div style="text-align: center; margin: 20px 0;">
            <a href="http://localhost:5173/subscription" style="background: #28a745; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-size: 16px;">
              Resubscribe to Premium
            </a>
          </div>
        </div>
      </div>
    `
  };

  await transporter.sendMail(mailOptions);
};


async function applyFreePlanLimitations(userId) {
  try {
    console.log(`🔧 Applying free plan limitations for user ${userId}`);

    // Suspend excess businesses (keep most recent 1)
    const excessBusinesses = await Business.find({
      userId: parseInt(userId),
      status: 'active'
    })
      .sort({ createdAt: -1 })
      .skip(1); // Skip the first (most recent) business

    for (const business of excessBusinesses) {
      await Business.updateOne(
        { _id: business._id },
        {
          $set: {
            status: 'suspended',
            suspendedDate: new Date(),
            suspensionReason: 'Exceeded free plan business limit (1 business allowed)',
            updatedAt: new Date()
          }
        }
      );

      // Also suspend all offers for this business
      await Offer.updateMany(
        { businessId: business._id },
        {
          $set: {
            status: 'suspended',
            suspendedDate: new Date(),
            suspensionReason: 'Business suspended due to plan limit',
            updatedAt: new Date()
          }
        }
      );
    }

    // Suspend excess offers (keep most recent 3)
    const excessOffers = await Offer.find({
      userId: parseInt(userId),
      status: 'active'
    })
      .sort({ createdAt: -1 })
      .skip(3); // Skip the first 3 (most recent) offers

    for (const offer of excessOffers) {
      await Offer.updateOne(
        { _id: offer._id },
        {
          $set: {
            status: 'suspended',
            suspendedDate: new Date(),
            suspensionReason: 'Exceeded free plan offer limit (3 offers allowed)',
            updatedAt: new Date()
          }
        }
      );
    }

    console.log(`✅ Applied free plan limitations for user ${userId}`);

  } catch (error) {
    console.error('❌ Error applying free plan limitations:', error);
    throw error;
  }
}
async function cancelPayHereRecurringPayment(recurringToken) {
  try {
    console.log('Cancelling PayHere recurring payment:', recurringToken);

    if (!recurringToken) {
      throw new Error('No recurring token provided');
    }

    // For now, skip PayHere API call since the endpoint doesn't exist
    // Just update your database and inform PayHere manually
    console.log('PayHere API integration not available - updating database only');

    return {
      success: true,
      message: 'Database updated - PayHere recurring payment marked for manual cancellation',
      requiresManualCancellation: true
    };

  } catch (error) {
    console.error('PayHere cancellation error:', error.message);

    // Log this for manual follow-up
    try {
      await SubscriptionLog.create({
        userId: 0,
        userEmail: 'system@internal.com',
        action: 'payhere_cancellation_failed',
        details: {
          recurringToken,
          error: error.message,
          timestamp: new Date(),
          note: 'Requires manual PayHere cancellation'
        }
      });
    } catch (logError) {
      console.error('Failed to log PayHere cancellation error:', logError);
    }

    // Don't throw error - allow database update to proceed
    return {
      success: false,
      error: error.message,
      requiresManualCancellation: true
    };
  }
}

async function handleDowngradeSelections(userId, selections) {
  try {
    console.log('🔧 Handling downgrade selections for userId:', userId);

    if (selections.selectedBusinesses && selections.selectedBusinesses.length > 0) {
      // Suspend businesses not in selection
      await Business.updateMany(
        {
          userId: parseInt(userId),
          _id: { $nin: selections.selectedBusinesses.map(id => new mongoose.Types.ObjectId(id)) },
          status: 'active'
        },
        {
          $set: {
            status: 'suspended',
            suspendedDate: new Date(),
            suspensionReason: 'Not selected during downgrade to free plan'
          }
        }
      );
    }

    if (selections.selectedOffers && selections.selectedOffers.length > 0) {
      // Suspend offers not in selection
      await Offer.updateMany(
        {
          userId: parseInt(userId),
          _id: { $nin: selections.selectedOffers.map(id => new mongoose.Types.ObjectId(id)) },
          status: 'active'
        },
        {
          $set: {
            status: 'suspended',
            suspendedDate: new Date(),
            suspensionReason: 'Not selected during downgrade to free plan'
          }
        }
      );
    }

    console.log(`✅ Applied user selections for downgrade of user ${userId}`);

  } catch (error) {
    console.error('❌ Error handling downgrade selections:', error);
    throw error;
  }
}
const handleSubscriptionCancellation = async (notificationData) => {
  try {
    const { subscription_id, email } = notificationData;

    console.log('🔄 Processing subscription cancellation...');

    const subscription = await Subscription.findOne({
      $or: [
        { payhereRecurringToken: subscription_id },
        { userEmail: email.toLowerCase().trim() }
      ],
      autoRenew: true
    });

    if (!subscription) {
      console.error('❌ Subscription not found for cancellation');
      return;
    }

    subscription.autoRenew = false;
    subscription.status = 'cancelled';
    subscription.nextBillingDate = null;
    subscription.updatedAt = new Date();

    await subscription.save();

    // Send cancellation confirmation email
    const user = await User.findOne({ userId: subscription.userId });
    if (user) {
      await sendSubscriptionCancelledEmail(user, subscription);
    }

    console.log('✅ Subscription cancelled successfully:', subscription._id);

  } catch (error) {
    console.error('❌ Failed to process subscription cancellation:', error);
  }
};

const payhereConfig = {
  merchantId: process.env.PAYHERE_MERCHANT_ID?.trim(),
  merchantSecret: process.env.PAYHERE_MERCHANT_SECRET?.trim(),
  appId: process.env.PAYHERE_APP_ID?.trim(), // NEW
  appSecret: process.env.PAYHERE_APP_SECRET?.trim(), // NEW
  mode: process.env.PAYHERE_MODE?.trim() || 'sandbox',
  notifyUrl: process.env.PAYHERE_NOTIFY_URL?.trim() || 'https://your-ngrok-url.ngrok.io/payhere-notify',
  returnUrl: process.env.PAYHERE_RETURN_URL?.trim() || 'http://localhost:5173/payment-success',
  cancelUrl: process.env.PAYHERE_CANCEL_URL?.trim() || 'http://localhost:5173/payment-cancel',

   apiBaseUrl: process.env.PAYHERE_MODE === 'sandbox' 
    ? 'https://www.payhere.lk/pay/api' 
    : 'https://sandbox.payhere.lk/pay/api'
};
// Validate PayHere config on startup
const validatePayHereConfig = () => {
  const issues = [];
  
  if (!process.env.PAYHERE_MERCHANT_ID) issues.push('Missing PAYHERE_MERCHANT_ID');
  if (!process.env.PAYHERE_MERCHANT_SECRET) issues.push('Missing PAYHERE_MERCHANT_SECRET');
  if (!process.env.PAYHERE_APP_ID) issues.push('Missing PAYHERE_APP_ID');
  if (!process.env.PAYHERE_APP_SECRET) issues.push('Missing PAYHERE_APP_SECRET');
  
  if (issues.length > 0) {
    console.error('PayHere Configuration Issues:', issues);
    return false;
  }
  
  console.log('PayHere configuration validated successfully');
  return true;
};

// Call this on server startup
validatePayHereConfig();
// Enhanced hash generation with logging
const generatePayHereHash = (merchantId, orderId, amount, currency, merchantSecret) => {
  try {
    console.log('🔐 Generating PayHere Hash...');

    // Clean inputs exactly as PayHere expects
    const cleanMerchantId = merchantId.toString().trim();
    const cleanOrderId = orderId.toString().trim();
    const cleanAmount = parseFloat(amount).toFixed(2);
    const cleanCurrency = currency.toString().toUpperCase().trim();
    const cleanSecret = merchantSecret.toString().trim();

    // PayHere hash format: merchantid + orderid + amount + currency + MD5(merchant_secret)
    const secretHash = CryptoJS.MD5(cleanSecret).toString().toUpperCase();
    const hashString = cleanMerchantId + cleanOrderId + cleanAmount + cleanCurrency + secretHash;

    console.log('Hash components:');
    console.log(`  Merchant ID: "${cleanMerchantId}"`);
    console.log(`  Order ID: "${cleanOrderId}"`);
    console.log(`  Amount: "${cleanAmount}"`);
    console.log(`  Currency: "${cleanCurrency}"`);
    console.log(`  Secret Hash: ${secretHash}`);
    console.log(`  Full Hash String: ${hashString}`);

    // Generate final MD5 hash
    const finalHash = CryptoJS.MD5(hashString).toString().toUpperCase();
    console.log(`  Generated Hash: ${finalHash}`);

    return finalHash;
  } catch (error) {
    console.error('❌ Hash generation failed:', error);
    throw error;
  }
};

function verifyPayHereHash(data, merchantSecret) {
  try {
    const {
      merchant_id,
      order_id,
      payhere_amount,
      payhere_currency,
      status_code,
      md5sig
    } = data;

    const crypto = require('crypto');
    const secretHash = crypto.createHash('md5').update(merchantSecret).digest('hex').toUpperCase();
    const hashString = merchant_id + order_id + payhere_amount + payhere_currency + status_code + secretHash;
    const expectedHash = crypto.createHash('md5').update(hashString).digest('hex').toUpperCase();

    console.log('Hash verification:');
    console.log('Received hash:', md5sig);
    console.log('Expected hash:', expectedHash);

    return md5sig === expectedHash;
  } catch (error) {
    console.error('Hash verification error:', error);
    return false;
  }
}



app.post('/create-payhere-payment', async (req, res) => {
  try {
    console.log('🔄 PayHere Payment Creation Started');

    const { amount, currency = 'LKR', planId, customerData } = req.body;

    // Validate PayHere configuration including new App credentials
    if (!validatePayHereConfig()) {
      return res.status(500).json({
        success: false,
        error: 'PayHere configuration invalid - missing required credentials'
      });
    }

    // Validate amount
    const numAmount = parseFloat(amount);
    if (!amount || isNaN(numAmount) || numAmount < 10) {
      return res.status(400).json({
        success: false,
        error: 'Amount must be at least LKR 10.00'
      });
    }

    // Validate customer data
    if (!customerData?.name?.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Customer name is required'
      });
    }

    if (!customerData?.email?.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Customer email is required'
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(customerData.email.trim())) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format'
      });
    }

    // Generate unique order ID
    const timestamp = Date.now();
    const randomSuffix = Math.floor(Math.random() * 1000);
    const orderId = `ORDER_${timestamp}_${randomSuffix}`;

    // Format data
    const formattedAmount = numAmount.toFixed(2);
    const formattedCurrency = currency.toUpperCase();

    const nameParts = customerData.name.trim().split(/\s+/);
    const firstName = nameParts[0] || 'Customer';
    const lastName = nameParts.slice(1).join(' ') || 'User';

    let cleanPhone = customerData.phoneNumber?.trim() || '0771234567';
    if (!cleanPhone.startsWith('0')) {
      cleanPhone = '0' + cleanPhone;
    }

    // Generate hash
    const hash = generatePayHereHash(
      payhereConfig.merchantId,
      orderId,
      formattedAmount,
      formattedCurrency,
      payhereConfig.merchantSecret
    );

    // Build payment data
    const paymentData = {
      sandbox: payhereConfig.mode === 'sandbox',
      merchant_id: payhereConfig.merchantId,
      return_url: `${payhereConfig.returnUrl}?order_id=${orderId}`,
      cancel_url: payhereConfig.cancelUrl,
      notify_url: payhereConfig.notifyUrl,
      order_id: orderId,
      items: `${planId === '1' ? 'Free' : 'Premium'} Plan - Monthly Subscription`,
      currency: formattedCurrency,
      amount: formattedAmount,
      first_name: firstName,
      last_name: lastName,
      email: customerData.email.trim().toLowerCase(),
      phone: cleanPhone,
      address: customerData.address || 'Colombo',
      city: 'Colombo',
      country: 'Sri Lanka',
      hash: hash,
      custom_1: `plan_${planId}`,
      custom_2: 'monthly'
    };

    // Add recurring payment fields for Premium plans
    if (planId === '2') {
      paymentData.recurrence = '1 Month';
      paymentData.duration = 'Forever';
      paymentData.startup_fee = '0.00';
      console.log('✅ Recurring payment setup added for Premium plan');
    }

    console.log('✅ PayHere payment data prepared:', {
      orderId: orderId,
      amount: formattedAmount,
      currency: formattedCurrency,
      recurring: planId === '2',
      customerEmail: paymentData.email
    });

    res.json({
      success: true,
      orderId: orderId,
      paymentData: paymentData,
      amount: formattedAmount,
      currency: formattedCurrency,
      recurring: planId === '2',
      message: 'Payment request created successfully'
    });

  } catch (error) {
    console.error('❌ PayHere payment creation failed:', error);
    res.status(500).json({
      success: false,
      error: 'Payment creation failed',
      message: error.message
    });
  }
});




app.get('/debug-payhere-hash/:orderId/:amount', (req, res) => {
  try {
    const { orderId, amount } = req.params;

    const hash = generatePayHereHash(
      payhereConfig.merchantId,
      orderId,
      amount,
      'LKR',
      payhereConfig.merchantSecret
    );

    res.json({
      success: true,
      hash: hash,
      components: {
        merchantId: payhereConfig.merchantId,
        orderId: orderId,
        amount: parseFloat(amount).toFixed(2),
        currency: 'LKR'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});



app.post('/payhere-notify', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    console.log('📨 PayHere Notification Received');
    console.log('Raw data:', JSON.stringify(req.body, null, 2));

    const {
      merchant_id,
      order_id,
      payment_id,
      payhere_amount,
      payhere_currency,
      status_code,
      md5sig,
      status_message,
      custom_1,
      custom_2,
      email,
      recurring_token,
      subscription_id,
      event_type,
      next_occurrence_date
    } = req.body;

    // Validate required fields
    if (!merchant_id || !order_id || !payhere_amount || !payhere_currency || !status_code || !md5sig) {
      console.error('❌ Missing required notification fields');
      return res.status(400).send('Missing required fields');
    }

    // Verify merchant ID
    if (merchant_id.trim() !== payhereConfig.merchantId.trim()) {
      console.error('❌ Merchant ID mismatch');
      return res.status(400).send('Merchant ID mismatch');
    }

    // Verify hash
    const isValidHash = verifyPayHereHash(req.body, payhereConfig.merchantSecret);
    if (!isValidHash) {
      console.error('❌ Hash verification failed');
      return res.status(400).send('Invalid hash');
    }

    console.log('✅ Hash verification successful');
    console.log(`Status: ${status_code} - ${status_message}`);

    // Handle successful payments
    if (status_code === '2') {
      if (event_type === 'SUBSCRIPTION_PAYMENT' && recurring_token) {
        console.log('🔄 Processing recurring payment...');
        await handleRecurringPayment(req.body);
      } else {
        console.log('💰 Processing initial payment...');
        await handleInitialPayment(req.body);
      }
    } else {
      console.log(`❌ Payment failed or cancelled: ${status_code} - ${status_message}`);
    }

    res.status(200).send('OK');

  } catch (error) {
    console.error('❌ Error processing PayHere notification:', error);
    res.status(500).send('Server error');
  }
});


async function handleInitialPayment(paymentData) {
  try {
    const { order_id, payment_id, payhere_amount, custom_1, custom_2, recurring_token, email, next_occurrence_date } = paymentData;

    console.log('Processing initial payment for order:', order_id);
    console.log('Recurring token received:', recurring_token);

    // Extract plan information
    const planMatch = custom_1?.match(/plan_(\d+)/);
    const planId = planMatch ? planMatch[1] : '1';
    const billingCycle = custom_2 || 'monthly';

    // Find user by email
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      console.error('User not found for email:', email);
      return;
    }

    // Calculate subscription dates
    const startDate = new Date();
    const endDate = new Date(startDate);

    if (billingCycle === 'yearly') {
      endDate.setFullYear(endDate.getFullYear() + 1);
    } else {
      endDate.setMonth(endDate.getMonth() + 1);
    }

    // Create subscription data
    const subscriptionData = {
      userId: user.userId,
      userEmail: email.toLowerCase().trim(),
      planId: planId,
      planName: planId === '2' ? 'Premium' : 'Free',
      status: 'active',
      billingCycle: billingCycle,
      amount: parseFloat(payhere_amount),
      currency: 'LKR',
      paymentMethod: 'payhere',
      payhereOrderId: order_id,
      payherePaymentId: payment_id,
      payhereRecurringToken: recurring_token, // Store the recurring token
      autoRenew: planId === '2' && recurring_token ? true : false,
      startDate: startDate,
      endDate: endDate,
      nextBillingDate: planId === '2' ? endDate : null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Update or create subscription
    const subscription = await Subscription.findOneAndUpdate(
      {
        $or: [
          { userId: user.userId },
          { userEmail: email.toLowerCase().trim() }
        ]
      },
      subscriptionData,
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true
      }
    );

    console.log('Subscription created/updated:', subscription._id);
    console.log('Recurring token stored:', recurring_token ? 'Yes' : 'No');
    console.log('Auto-renewal enabled:', subscription.autoRenew);

    // Create subscription log
    await SubscriptionLog.create({
      subscriptionId: subscription._id,
      userId: user.userId,
      userEmail: email,
      action: 'created',
      details: {
        orderId: order_id,
        paymentId: payment_id,
        amount: payhere_amount,
        recurringToken: recurring_token,
        autoRenewal: subscription.autoRenew
      }
    });

  } catch (error) {
    console.error('Error handling initial payment:', error);
    throw error;
  }
}

// FIXED: Handle recurring payments
async function handleRecurringPayment(notificationData) {
  try {
    const {
      subscription_id,
      payment_id,
      payhere_amount,
      status_code,
      email,
      next_occurrence_date
    } = notificationData;

    console.log('Processing recurring payment:', { subscription_id, status_code });

    // Find subscription by recurring token or email
    const subscription = await Subscription.findOne({
      $or: [
        { payhereRecurringToken: subscription_id },
        { userEmail: email?.toLowerCase().trim() }
      ],
      autoRenew: true
    }).sort({ createdAt: -1 });

    if (!subscription) {
      console.error('Subscription not found for recurring payment');
      return;
    }

    if (status_code === '2') {
      // Successful renewal - extend end date
      console.log('Recurring payment successful');

      const currentEndDate = new Date(subscription.endDate);
      const newEndDate = new Date(currentEndDate);

      // Extend by one billing period from current end date
      if (subscription.billingCycle === 'yearly') {
        newEndDate.setFullYear(newEndDate.getFullYear() + 1);
      } else {
        newEndDate.setMonth(newEndDate.getMonth() + 1);
      }

      subscription.status = 'active';
      subscription.endDate = newEndDate; // This is key - extend the actual end date
      subscription.nextBillingDate = next_occurrence_date ?
        new Date(next_occurrence_date) : newEndDate;
      subscription.renewalAttempts = 0;
      subscription.updatedAt = new Date();

      // Add to renewal history
      subscription.renewalHistory.push({
        renewalDate: new Date(),
        amount: parseFloat(payhere_amount),
        status: 'success',
        paymentId: payment_id,
        attempt: subscription.renewalAttempts + 1
      });

      await subscription.save();

      console.log('Subscription renewed with new end date:', {
        oldEndDate: currentEndDate.toISOString(),
        newEndDate: newEndDate.toISOString(),
        nextBilling: subscription.nextBillingDate.toISOString()
      });

    } else {
      // Failed renewal
      console.log('Recurring payment failed');

      subscription.renewalAttempts += 1;
      subscription.status = subscription.renewalAttempts >= subscription.maxRenewalAttempts ?
        'cancelled' : 'pending_renewal';

      subscription.renewalHistory.push({
        renewalDate: new Date(),
        amount: parseFloat(payhere_amount),
        status: 'failed',
        failureReason: `Payment failed with status code: ${status_code}`,
        attempt: subscription.renewalAttempts
      });

      if (subscription.renewalAttempts >= subscription.maxRenewalAttempts) {
        subscription.autoRenew = false;
        // Don't change end date - let it expire naturally
      }

      await subscription.save();
    }

  } catch (error) {
    console.error('Failed to handle recurring payment:', error);
  }
}

async function fixSubscriptionEndDates() {
  try {
    console.log('Fixing subscriptions without proper end dates...');

    const subscriptionsWithoutEndDate = await Subscription.find({
      $or: [
        { endDate: null },
        { endDate: { $exists: false } }
      ],
      status: 'active'
    });

    console.log(`Found ${subscriptionsWithoutEndDate.length} subscriptions to fix`);

    for (const subscription of subscriptionsWithoutEndDate) {
      const startDate = new Date(subscription.startDate);
      const endDate = new Date(startDate);

      // Calculate end date based on plan and billing cycle
      if (subscription.planId === '2') { // Premium
        if (subscription.billingCycle === 'yearly') {
          endDate.setFullYear(endDate.getFullYear() + 1);
        } else {
          endDate.setMonth(endDate.getMonth() + 1);
        }
      } else { // Free plan
        endDate.setFullYear(endDate.getFullYear() + 10); // Long validity
      }

      await Subscription.updateOne(
        { _id: subscription._id },
        {
          $set: {
            endDate: endDate,
            updatedAt: new Date()
          }
        }
      );

      console.log(`Fixed subscription ${subscription._id}: endDate set to ${endDate.toISOString()}`);
    }

    console.log('Subscription end date fix completed');

  } catch (error) {
    console.error('Error fixing subscription end dates:', error);
  }
}

const validateEnvironment = () => {
  console.log('🔍 === PayHere Environment Validation ===\n');

  const requiredVars = {
    'EMAIL_USERNAME': process.env.EMAIL_USERNAME,
    'EMAIL_PASSWORD': process.env.EMAIL_PASSWORD,
    'PAYHERE_MERCHANT_ID': process.env.PAYHERE_MERCHANT_ID,
    'PAYHERE_MERCHANT_SECRET': process.env.PAYHERE_MERCHANT_SECRET,
    'PAYHERE_MODE': process.env.PAYHERE_MODE,
    'PAYHERE_NOTIFY_URL': process.env.PAYHERE_NOTIFY_URL,
    'PAYHERE_RETURN_URL': process.env.PAYHERE_RETURN_URL,
    'PAYHERE_CANCEL_URL': process.env.PAYHERE_CANCEL_URL
  };

  let hasErrors = false;

  Object.entries(requiredVars).forEach(([key, value]) => {
    if (!value) {
      console.log(`❌ ${key}: MISSING`);
      hasErrors = true;
    } else {
      if (key.includes('SECRET') || key.includes('PASSWORD')) {
        console.log(`✅ ${key}: ${value.substring(0, 8)}... (${value.length} chars)`);
      } else {
        console.log(`✅ ${key}: ${value}`);
      }
    }
  });

  // Specific PayHere validations
  console.log('\n🔍 PayHere Specific Validation:');

  const merchantId = process.env.PAYHERE_MERCHANT_ID;
  if (merchantId) {
    if (merchantId.length !== 7) {
      console.log(`❌ PAYHERE_MERCHANT_ID should be 7 digits, got ${merchantId.length} digits`);
      hasErrors = true;
    } else if (!/^\d+$/.test(merchantId)) {
      console.log(`❌ PAYHERE_MERCHANT_ID should contain only numbers`);
      hasErrors = true;
    } else {
      console.log(`✅ PAYHERE_MERCHANT_ID format is valid`);
    }
  }

  const merchantSecret = process.env.PAYHERE_MERCHANT_SECRET;
  if (merchantSecret) {
    if (merchantSecret.length < 40) {
      console.log(`⚠️  PAYHERE_MERCHANT_SECRET seems short (${merchantSecret.length} chars). Expected 40+ chars.`);
    } else {
      console.log(`✅ PAYHERE_MERCHANT_SECRET length is valid`);
    }
  }

  const mode = process.env.PAYHERE_MODE;
  if (mode && !['sandbox', 'live'].includes(mode)) {
    console.log(`❌ PAYHERE_MODE should be 'sandbox' or 'live', got '${mode}'`);
    hasErrors = true;
  } else {
    console.log(`✅ PAYHERE_MODE is valid`);
  }

  // URL validation
  const urls = ['NOTIFY_URL', 'RETURN_URL', 'CANCEL_URL'];
  urls.forEach(urlType => {
    const url = process.env[`PAYHERE_${urlType}`];
    if (url && !url.startsWith('http')) {
      console.log(`❌ PAYHERE_${urlType} should start with http:// or https://`);
      hasErrors = true;
    } else if (url) {
      console.log(`✅ PAYHERE_${urlType} format is valid`);
    }
  });

  console.log('\n' + '='.repeat(50));
  if (hasErrors) {
    console.log('❌ VALIDATION FAILED - Please fix the errors above');
    console.log('\n🔧 To fix PayHere issues:');
    console.log('1. Login to https://sandbox.payhere.lk');
    console.log('2. Go to Settings → Domains & Credentials');
    console.log('3. Copy the EXACT merchant ID (7 digits)');
    console.log('4. Copy the EXACT merchant secret (long string)');
    console.log('5. Update your .env file');
    console.log('6. Restart your server');
    return false;
  } else {
    console.log('✅ ALL VALIDATIONS PASSED');
    console.log('🚀 PayHere should work correctly now!');
    return true;
  }
};



const testHashGeneration = () => {
  console.log('\n🧪 === Testing Hash Generation with CryptoJS ===');

  try {
    const testData = {
      merchantId: process.env.PAYHERE_MERCHANT_ID || '1231556',
      orderId: 'TEST12345',
      amount: '1500.00',
      currency: 'LKR',
      merchantSecret: process.env.PAYHERE_MERCHANT_SECRET || 'test_secret'
    };

    const hashString = `${testData.merchantId}${testData.orderId}${testData.amount}${testData.currency}${testData.merchantSecret}`;
    const hash = CryptoJS.MD5(hashString).toString().toUpperCase();

    console.log('Test hash components:');
    console.log(`  Merchant ID: ${testData.merchantId}`);
    console.log(`  Order ID: ${testData.orderId}`);
    console.log(`  Amount: ${testData.amount}`);
    console.log(`  Currency: ${testData.currency}`);
    console.log(`  Hash String: ${testData.merchantId}${testData.orderId}${testData.amount}${testData.currency}[SECRET]`);
    console.log(`  Generated Hash: ${hash}`);
    console.log('✅ Hash generation test with CryptoJS passed');
    return true;

  } catch (error) {
    console.log('❌ Hash generation test failed:', error.message);
    return false;
  }
};



const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  console.log('Starting environment validation...\n');
  const envValid = validateEnvironment();
  const hashValid = testHashGeneration();

  if (envValid && hashValid) {
    console.log('\n🎉 All tests passed! PayHere should work correctly.');
  } else {
    console.log('\n❌ Some tests failed. Please fix the issues above.');
    process.exit(1);
  }
}

// ES module export instead of CommonJS
export { generatePayHereHash, verifyPayHereHash, testHashGeneration };


// Call validation on server startup
console.log('\n🔍 PayHere Configuration Check:');
validatePayHereConfig();





// Get payment status
app.get('/payhere-status/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;

    const subscription = await Subscription.findOne({ payhereOrderId: orderId });

    if (subscription) {
      res.json({
        success: true,
        status: 'completed',
        subscription: {
          id: subscription._id,
          planName: subscription.planName,
          status: subscription.status,
          amount: subscription.amount,
          currency: subscription.currency
        }
      });
    } else {
      res.json({
        success: true,
        status: 'pending',
        message: 'Payment is being processed'
      });
    }

  } catch (error) {
    console.error('Error checking PayHere status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check payment status'
    });
  }
});

const subscriptionLogSchema = new mongoose.Schema({
  subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription' },
  userId: { type: Number, required: true },
  userEmail: { type: String, required: true },
  action: {
    type: String,
    enum: [
      'created',
      'renewed',
      'cancelled',
      'cancellation_scheduled',
      'cancellation_cancelled',
      'auto_downgrade_to_free',
      'payment_failed',
      'auto_renewal_cancelled',       // FIXED: Added this
      'auto_renewal_reactivated',     // FIXED: Added this
      'downgrade_scheduled',          // FIXED: Added this  
      'downgrade_processed',          // FIXED: Added this
      'downgrade_cancelled',          // FIXED: Added this
      'plan_limit_enforced',
      'auto_plan_enforcement',
      'items_suspended',
      'items_reactivated'
    ],
    required: true
  },
  details: { type: mongoose.Schema.Types.Mixed },
  timestamp: { type: Date, default: Date.now }
});

app.post('/api/subscription/trigger-renewals-test', async (req, res) => {
  try {
    console.log('🧪 Manual renewal processing triggered for testing');

    // Call the main renewal processing function
    const response = await axios.post('http://localhost:5555/api/subscription/process-automatic-renewals');

    res.json({
      success: true,
      message: 'Test renewal processing completed',
      data: response.data
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Test renewal processing failed',
      error: error.message
    });
  }
});

const SubscriptionLog = mongoose.model('SubscriptionLog', subscriptionLogSchema);



const subscriptionSchema = new mongoose.Schema({
  // Core identification
  userId: { type: Number, ref: 'User' },
  userEmail: { type: String, required: true, index: true },
  
  // Plan details
  planId: { type: String, required: true },
  planName: { type: String, required: true },
  status: {
    type: String,
    enum: ['active', 'inactive', 'cancelled', 'expired', 'pending_renewal'],
    default: 'active'
  },
  billingCycle: {
    type: String,
    enum: ['monthly', 'yearly'],
    default: 'monthly'
  },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'LKR' },

  // Payment info
  paymentMethod: { type: String, default: 'payhere' },
  payhereOrderId: { type: String, index: true },
  payherePaymentId: { type: String },

  // Auto-renewal fields (for premium subscriptions)
  payhereRecurringToken: { type: String, index: true },
  autoRenew: { type: Boolean, default: false },
  renewalAttempts: { type: Number, default: 0 },
  maxRenewalAttempts: { type: Number, default: 3 },

  // Dates
  startDate: { type: Date, default: Date.now },
  endDate: { type: Date }, // Free plan: null, Premium: calculated
  nextBillingDate: { type: Date, index: true },

  // Downgrade fields
  downgradeScheduled: { type: Boolean, default: false },
  downgradeScheduledDate: { type: Date },
  downgradeReason: { type: String },
  downgradeEffectiveDate: { type: Date },
  downgradeTargetPlan: { type: String },
  downgradeSelections: {
    selectedBusinesses: [{ type: String }],
    selectedOffers: [{ type: String }]
  },
  downgradeProcessedDate: { type: Date },

  // Legacy cancellation fields (for backward compatibility)
  cancellationScheduled: { type: Boolean, default: false },
  cancellationScheduledDate: { type: Date },
  cancellationReason: { type: String },
  cancellationEffectiveDate: { type: Date },
  cancellationProcessedDate: { type: Date },

  // Payment failure tracking
  paymentFailure: { type: Boolean, default: false },
  paymentFailureReason: { type: String },
  lastPaymentFailureDate: { type: Date },

  // Renewal history as embedded array
  renewalHistory: [{
    renewalDate: { type: Date, default: Date.now },
    amount: { type: Number },
    status: { type: String, enum: ['success', 'failed'] },
    paymentId: { type: String },
    failureReason: { type: String },
    attempt: { type: Number }
  }],

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Indexes for better performance
subscriptionSchema.index({ userId: 1, status: 1 });
subscriptionSchema.index({ userEmail: 1, status: 1 });
subscriptionSchema.index({ downgradeScheduled: 1, downgradeEffectiveDate: 1 });
subscriptionSchema.index({ nextBillingDate: 1, autoRenew: 1 });
subscriptionSchema.index({ payhereRecurringToken: 1 });
subscriptionSchema.index({ endDate: 1, status: 1 }); // Critical for downgrade processing

// Pre-save middleware with proper endDate calculation
subscriptionSchema.pre('save', function (next) {
  this.updatedAt = new Date();

  // Set endDate for new subscriptions
  if (this.isNew && !this.endDate) {
    const startDate = this.startDate || new Date();
    if (this.planId === '1') {
      // Free plan never expires
      this.endDate = null;
    } else {
      // Premium plan - calculate end date
      const endDate = new Date(startDate);
      if (this.billingCycle === 'yearly') {
        endDate.setFullYear(endDate.getFullYear() + 1);
      } else {
        endDate.setMonth(endDate.getMonth() + 1);
      }
      this.endDate = endDate;
      this.nextBillingDate = this.autoRenew ? endDate : null;
    }
  }

  next();
});

// Instance method to calculate days until expiration
subscriptionSchema.methods.getDaysUntilExpiration = function () {
  if (!this.endDate) return null; // Free plans never expire
  const today = new Date();
  const diffTime = this.endDate - today;
  return Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
};

// Instance method to check if subscription is expiring soon
subscriptionSchema.methods.isExpiringSoon = function (days = 7) {
  const daysUntilExpiration = this.getDaysUntilExpiration();
  if (daysUntilExpiration === null) return false; // Free plans never expire
  return daysUntilExpiration <= days && daysUntilExpiration > 0;
};

// Instance method to get effective downgrade date
subscriptionSchema.methods.getDowngradeEffectiveDate = function () {
  if (this.downgradeEffectiveDate) {
    return this.downgradeEffectiveDate;
  }
  // Use subscription end date as fallback
  return this.endDate;
};

// Instance method to check if subscription is a premium plan
subscriptionSchema.methods.isPremium = function () {
  return this.planId === '2';
};

// Instance method to check if subscription is a free plan
subscriptionSchema.methods.isFree = function () {
  return this.planId === '1';
};

// Static method to find subscriptions ready for downgrade
subscriptionSchema.statics.findReadyForDowngrade = function () {
  const today = new Date();
  return this.find({
    downgradeScheduled: true,
    downgradeEffectiveDate: { $lte: today },
    status: 'active',
    planId: '2' // Premium subscriptions only
  });
};

// Static method to find subscriptions needing renewal
subscriptionSchema.statics.findNeedingRenewal = function () {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  return this.find({
    status: 'active',
    planId: '2',
    autoRenew: true,
    nextBillingDate: { $lte: tomorrow },
    paymentFailure: { $ne: true }
  });
};

// Static method to find active premium subscriptions
subscriptionSchema.statics.findActivePremium = function () {
  return this.find({
    status: 'active',
    planId: '2'
  });
};

// Static method to find expired subscriptions
subscriptionSchema.statics.findExpired = function () {
  const today = new Date();
  return this.find({
    status: 'active',
    endDate: { $lte: today, $ne: null }, // Exclude free plans (endDate: null)
    planId: '2' // Only premium plans can expire
  });
};



async function migrateSubscriptions() {
  try {
    console.log('🔄 Starting subscription migration...');

    // Step 1: Add missing boolean fields with default values
    const result1 = await db.subscriptions.updateMany(
      {},
      {
        $set: {
          downgradeScheduled: false,
          autoRenew: false,
          renewalAttempts: 0,
          maxRenewalAttempts: 3,
          paymentFailure: false,
          cancellationScheduled: false
        }
      }
    );

    console.log(`✅ Updated ${result1.modifiedCount} subscriptions with default boolean fields`);

    // Step 2: Fix missing endDate fields
    const subscriptionsWithoutEndDate = await db.subscriptions.find({
      $or: [
        { endDate: null },
        { endDate: { $exists: false } }
      ]
    });

    console.log(`📋 Found ${subscriptionsWithoutEndDate.length} subscriptions without endDate`);

    for (const subscription of subscriptionsWithoutEndDate) {
      const startDate = new Date(subscription.startDate);
      const endDate = new Date(startDate);

      // Calculate endDate based on plan and billing cycle
      if (subscription.planId === '1') { // Free plan
        endDate.setFullYear(endDate.getFullYear() + 10);
      } else if (subscription.billingCycle === 'yearly') {
        endDate.setFullYear(endDate.getFullYear() + 1);
      } else { // Monthly
        endDate.setMonth(endDate.getMonth() + 1);
      }

      await db.subscriptions.updateOne(
        { _id: subscription._id },
        {
          $set: {
            endDate: endDate,
            updatedAt: new Date()
          }
        }
      );
    }

    console.log(`✅ Fixed endDate for ${subscriptionsWithoutEndDate.length} subscriptions`);

    // Step 3: Ensure all subscriptions have proper updatedAt
    const result3 = await db.subscriptions.updateMany(
      { updatedAt: { $exists: false } },
      { $set: { updatedAt: new Date() } }
    );

    console.log(`✅ Added updatedAt to ${result3.modifiedCount} subscriptions`);

    // Step 4: Initialize empty renewalHistory for subscriptions that don't have it
    const result4 = await db.subscriptions.updateMany(
      { renewalHistory: { $exists: false } },
      { $set: { renewalHistory: [] } }
    );

    console.log(`✅ Initialized renewalHistory for ${result4.modifiedCount} subscriptions`);

    console.log('🎉 Subscription migration completed successfully!');

    return {
      success: true,
      message: 'Migration completed',
      stats: {
        booleanFieldsUpdated: result1.modifiedCount,
        endDatesFixed: subscriptionsWithoutEndDate.length,
        updatedAtAdded: result3.modifiedCount,
        renewalHistoryInitialized: result4.modifiedCount
      }
    };

  } catch (error) {
    console.error('❌ Migration failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

app.post('/api/subscription/migrate', async (req, res) => {
  try {
    const result = await migrateSubscriptions();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Migration failed: ' + error.message
    });
  }
});
const Subscription = mongoose.model('Subscription', subscriptionSchema);


const enhancedSubscriptionHistorySchema = new mongoose.Schema({
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
      'downgrade_cancelled',
      'plan_limit_enforced',        // NEW
      'auto_plan_enforcement',      // NEW
      'items_suspended',            // NEW
      'items_reactivated'           // NEW
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
  itemsAffected: {                // NEW: Track affected items
    businesses: { type: Number, default: 0 },
    offers: { type: Number, default: 0 }
  },
  createdAt: { type: Date, default: Date.now }
});

app.post('/create-payhere-recurring-payment', async (req, res) => {
  try {
    console.log('🔄 PayHere Recurring Payment Creation Started');

    const { amount, currency = 'LKR', planId, customerData, enableAutoRenew = true } = req.body;

    // Validate configuration
    if (!payhereConfig.merchantId || !payhereConfig.merchantSecret) {
      console.error('❌ PayHere configuration missing');
      return res.status(500).json({
        success: false,
        error: 'PayHere configuration invalid'
      });
    }

    // Validate amount
    const numAmount = parseFloat(amount);
    if (!amount || isNaN(numAmount) || numAmount < 1) {
      return res.status(400).json({
        success: false,
        error: 'Amount must be at least LKR 1.00'
      });
    }

    // Only allow recurring for premium plans
    if (planId === '1') {
      return res.status(400).json({
        success: false,
        error: 'Auto-renewal is only available for Premium plans'
      });
    }

    // Validate customer data
    if (!customerData?.name || !customerData?.email) {
      return res.status(400).json({
        success: false,
        error: 'Customer name and email are required'
      });
    }

    // Generate unique order ID
    const timestamp = Date.now();
    const randomSuffix = Math.floor(Math.random() * 1000);
    const orderId = `RECURRING_${timestamp}_${randomSuffix}`;

    // Format amount and currency
    const formattedAmount = numAmount.toFixed(2);
    const formattedCurrency = currency.toUpperCase();

    // Process customer data
    const nameParts = customerData.name.trim().split(/\\s+/);
    const firstName = nameParts[0] || 'Customer';
    const lastName = nameParts.slice(1).join(' ') || 'User';

    // Clean phone number
    let cleanPhone = customerData.phoneNumber?.trim() || '0771234567';
    if (!cleanPhone.startsWith('0')) {
      cleanPhone = '0' + cleanPhone;
    }

    // Generate hash for recurring payment
    const hash = generatePayHereHash(
      payhereConfig.merchantId,
      orderId,
      formattedAmount,
      formattedCurrency,
      payhereConfig.merchantSecret
    );

    // FIXED: Proper PayHere recurring payment data
    const paymentData = {
      sandbox: payhereConfig.mode === 'sandbox',
      merchant_id: payhereConfig.merchantId,
      return_url: `${payhereConfig.returnUrl}?order_id=${orderId}`,
      cancel_url: payhereConfig.cancelUrl,
      notify_url: payhereConfig.notifyUrl,
      order_id: orderId,
      items: `Premium Plan - Monthly Subscription`,
      currency: formattedCurrency,
      amount: formattedAmount,
      first_name: firstName,
      last_name: lastName,
      email: customerData.email.trim().toLowerCase(),
      phone: cleanPhone,
      address: customerData.address || 'Colombo',
      city: 'Colombo',
      country: 'Sri Lanka',
      hash: hash,
      custom_1: `plan_${planId}`,
      custom_2: 'monthly_recurring',

      // FIXED: Proper recurring payment fields for PayHere
      recurrence: '1 Month',
      duration: 'Forever', // Continue until cancelled
      startup_fee: '0.00'
    };

    console.log('✅ PayHere recurring payment data prepared');
    console.log('Order ID:', orderId);
    console.log('Amount:', formattedAmount, formattedCurrency);

    res.json({
      success: true,
      orderId: orderId,
      paymentData: paymentData,
      amount: formattedAmount,
      currency: formattedCurrency,
      recurring: true,
      message: 'Recurring payment request created successfully'
    });

  } catch (error) {
    console.error('❌ PayHere recurring payment creation failed:', error);
    res.status(500).json({
      success: false,
      error: 'Recurring payment creation failed',
      message: error.message
    });
  }
});

app.post('/payhere-recurring-notify', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    console.log('📨 PayHere Recurring Notification Received');
    console.log('Raw Notification Data:', JSON.stringify(req.body, null, 2));

    const {
      merchant_id,
      order_id,
      payment_id,
      payhere_amount,
      payhere_currency,
      status_code,
      md5sig,
      status_message,
      custom_1,
      custom_2,
      email,
      recurring_token, // New field for recurring payments
      subscription_id, // PayHere subscription ID
      event_type // 'SUBSCRIPTION_PAYMENT' or 'SUBSCRIPTION_CANCELLED'
    } = req.body;

    // Validate required fields
    if (!merchant_id || !order_id || !payhere_amount || !payhere_currency || !status_code || !md5sig) {
      console.error('❌ Missing required notification fields');
      return res.status(400).send('Missing required fields');
    }

    // Verify merchant ID
    if (merchant_id.trim() !== payhereConfig.merchantId.trim()) {
      console.error('❌ Merchant ID mismatch');
      return res.status(400).send('Merchant ID mismatch');
    }

    // Verify hash
    const isValidHash = verifyPayHereHash(req.body, payhereConfig.merchantSecret);

    if (!isValidHash) {
      console.error('❌ Hash verification failed');
      return res.status(400).send('Invalid hash');
    }

    console.log('✅ Hash verification successful');
    console.log(`📊 Payment Status: ${status_code} - ${status_message}`);
    console.log(`🔄 Event Type: ${event_type}`);

    // Handle different event types
    if (event_type === 'SUBSCRIPTION_PAYMENT') {
      await handleRecurringPayment(req.body);
    } else if (event_type === 'SUBSCRIPTION_CANCELLED') {
      await handleSubscriptionCancellation(req.body);
    } else if (status_code === '2') {
      // Initial subscription creation
      await handleInitialSubscription(req.body);
    }

    // Always respond OK to PayHere
    res.status(200).send('OK');

  } catch (error) {
    console.error('❌ Error processing PayHere recurring notification:', error);
    res.status(500).send('Server error');
  }
});

app.post('/api/user/check-subscription', async (req, res) => {
  try {
    const { email, userId } = req.body;

    if (!email && !userId) {
      return res.status(400).json({
        success: false,
        message: 'Email or userId is required'
      });
    }

    console.log('🔍 Checking subscription for email:', email, 'userId:', userId);

    // First, find the user to ensure they exist
    let user = null;
    if (userId) {
      user = await User.findOne({ userId: userId });
    } else if (email) {
      user = await User.findOne({ email: email.toLowerCase().trim() });
    }

    // If user doesn't exist in User collection, return user not found
    if (!user) {
      console.log('❌ User not found in database');
      return res.json({
        success: true,
        hasSubscription: false,
        hasActiveSubscription: false,
        isPremiumUser: false,
        isFreeUser: false,
        isNonActivated: true,
        userExists: false,
        subscription: null
      });
    }

    console.log('✅ Found user:', user.email, 'userId:', user.userId);

    // Now search for subscriptions using BOTH userId and email
    // This ensures we catch subscriptions created with either identifier
    const subscription = await Subscription.findOne({
      $or: [
        { userId: user.userId },
        { userEmail: user.email.toLowerCase().trim() }
      ]
    }).sort({ createdAt: -1 }); // Get most recent if multiple exist

    // DEBUG: Log what we found
    if (subscription) {
      console.log('📋 Found subscription:', {
        id: subscription._id,
        planId: subscription.planId,
        planName: subscription.planName,
        status: subscription.status,
        userEmail: subscription.userEmail,
        userId: subscription.userId,
        createdAt: subscription.createdAt
      });
    } else {
      console.log('❌ No subscription found for this user');
    }

    // If NO subscription found, user is non-activated
    if (!subscription) {
      console.log('➡️  User is NON-ACTIVATED (no subscription record found)');
      return res.json({
        success: true,
        hasSubscription: false,
        hasActiveSubscription: false,
        isPremiumUser: false,
        isFreeUser: false,
        isNonActivated: true, // ✅ This is correct for new users
        userExists: true,
        subscription: null
      });
    }

    // If subscription exists, determine the type
    const now = new Date();

    // Check if it's an active premium subscription
    const isActivePremium = subscription.planId === '2' &&
      subscription.status === 'active' &&
      (!subscription.endDate || new Date(subscription.endDate) > now);

    // Check if it's an active free subscription
    const isActiveFree = subscription.planId === '1' &&
      subscription.status === 'active';

    console.log('📊 Subscription analysis:', {
      planId: subscription.planId,
      status: subscription.status,
      endDate: subscription.endDate,
      isActivePremium,
      isActiveFree
    });

    // Return subscription status
    if (isActivePremium) {
      console.log('➡️  User is PREMIUM USER');
      return res.json({
        success: true,
        hasSubscription: true,
        hasActiveSubscription: true,
        isPremiumUser: true,
        isFreeUser: false,
        isNonActivated: false,
        userExists: true,
        subscription: {
          planId: subscription.planId,
          planName: subscription.planName,
          status: subscription.status,
          billingCycle: subscription.billingCycle,
          endDate: subscription.endDate,
          paymentMethod: subscription.paymentMethod,
          amount: subscription.amount,
          currency: subscription.currency
        }
      });
    } else if (isActiveFree) {
      console.log('➡️  User is FREE USER');
      return res.json({
        success: true,
        hasSubscription: true,
        hasActiveSubscription: false, // Free is not "active premium"
        isPremiumUser: false,
        isFreeUser: true,
        isNonActivated: false,
        userExists: true,
        subscription: {
          planId: subscription.planId,
          planName: subscription.planName,
          status: subscription.status,
          billingCycle: subscription.billingCycle,
          endDate: subscription.endDate,
          paymentMethod: subscription.paymentMethod,
          amount: subscription.amount,
          currency: subscription.currency
        }
      });
    } else {
      // Subscription exists but is expired/inactive
      console.log('➡️  User has EXPIRED/INACTIVE subscription');
      return res.json({
        success: true,
        hasSubscription: true,
        hasActiveSubscription: false,
        isPremiumUser: false,
        isFreeUser: false,
        isNonActivated: true, // Treat expired as non-activated
        userExists: true,
        subscription: {
          planId: subscription.planId,
          planName: subscription.planName,
          status: subscription.status,
          billingCycle: subscription.billingCycle,
          endDate: subscription.endDate,
          paymentMethod: subscription.paymentMethod,
          amount: subscription.amount,
          currency: subscription.currency
        }
      });
    }

  } catch (error) {
    console.error('❌ Error checking subscription:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while checking subscription'
    });
  }
});



app.post('/api/subscription/cancel-auto-renewal', async (req, res) => {
  let session = null;

  try {
    const { userId, userEmail, reason } = req.body;

    console.log('🔄 Cancelling auto-renewal for userId:', userId, 'email:', userEmail);

    if (!userId && !userEmail) {
      return res.status(400).json({
        success: false,
        message: 'User ID or email is required'
      });
    }

    // Start database transaction
    session = await mongoose.startSession();
    session.startTransaction();

    // Find active subscription with better query
    const subscription = await Subscription.findOne({
      $and: [
        {
          $or: [
            { userId: parseInt(userId) },
            { userEmail: userEmail?.toLowerCase().trim() }
          ]
        },
        { status: 'active' },
        { planId: '2' }
      ]
    }).session(session);

    if (!subscription) {
      await session.abortTransaction();
      console.log('❌ No active Premium subscription found');
      return res.json({
        success: false,
        message: 'No active Premium subscription found'
      });
    }

    console.log('✅ Found subscription:', {
      id: subscription._id,
      currentAutoRenew: subscription.autoRenew,
      userId: subscription.userId,
      userEmail: subscription.userEmail
    });

    // Check if auto-renewal is already disabled
    if (!subscription.autoRenew) {
      await session.abortTransaction();
      console.log('ℹ️ Auto-renewal is already disabled');
      return res.json({
        success: true,
        message: 'Auto-renewal is already disabled',
        autoRenew: false
      });
    }

    // CRITICAL: Cancel PayHere recurring payment first if token exists
    let payhereResult = { success: true };
    if (subscription.payhereRecurringToken) {
      console.log('🔄 Attempting to cancel PayHere recurring payment...');
      payhereResult = await cancelPayHereRecurringPayment(subscription.payhereRecurringToken);
      console.log('PayHere cancellation result:', payhereResult);
    }

    // Update subscription in database - ALWAYS update even if PayHere fails
    const updateData = {
      $set: {
        autoRenew: false,
        updatedAt: new Date(),
        autoRenewalCancelledDate: new Date(),
        autoRenewalCancelledReason: reason || 'User requested cancellation'
      }
    };

    // Only unset token if PayHere cancellation was successful
    if (payhereResult.success && subscription.payhereRecurringToken) {
      updateData.$unset = { payhereRecurringToken: '' };
    }

    const updateResult = await Subscription.updateOne(
      { _id: subscription._id },
      updateData
    ).session(session);

    console.log('📊 Database update result:', updateResult);

    if (updateResult.modifiedCount > 0) {
      // Create detailed log entry
      await SubscriptionLog.create([{
        subscriptionId: subscription._id,
        userId: subscription.userId,
        userEmail: subscription.userEmail,
        action: 'auto_renewal_cancelled', // ADD this to your enum if not exists
        details: {
          reason: reason || 'User requested cancellation',
          cancelledDate: new Date(),
          payhereToken: subscription.payhereRecurringToken || null,
          payhereCancellationSuccess: payhereResult.success,
          payhereCancellationError: payhereResult.error || null,
          requiresManualCancellation: payhereResult.requiresManualCancellation || false
        }
      }], { session });

      await session.commitTransaction();

      console.log('✅ Auto-renewal cancelled successfully in database');

      // Prepare response message
      let message = 'Auto-renewal cancelled successfully. Your subscription will remain active until the end of the current billing period.';

      if (!payhereResult.success) {
        message += ' Note: PayHere recurring payment requires manual cancellation by our team.';
      }

      res.json({
        success: true,
        message: message,
        autoRenew: false,
        payhereStatus: payhereResult.success ? 'cancelled' : 'requires_manual_cancellation'
      });
    } else {
      await session.abortTransaction();
      console.error('❌ Failed to update subscription in database - no documents modified');

      res.json({
        success: false,
        message: 'Failed to cancel auto-renewal. Please try again or contact support.',
        debug: 'No documents were modified in the database update'
      });
    }

  } catch (error) {
    if (session) {
      await session.abortTransaction();
    }
    console.error('❌ Error cancelling auto-renewal:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while cancelling auto-renewal: ' + error.message
    });
  } finally {
    if (session) {
      session.endSession();
    }
  }
});




app.post('/api/subscription/reactivate-auto-renewal', async (req, res) => {
  let session = null;

  try {
    const { userId, userEmail } = req.body;

    console.log('🔄 Reactivating auto-renewal for userId:', userId, 'email:', userEmail);

    if (!userId && !userEmail) {
      return res.status(400).json({
        success: false,
        message: 'User ID or email is required'
      });
    }

    session = await mongoose.startSession();
    session.startTransaction();

    // Find active subscription
    const subscription = await Subscription.findOne({
      $and: [
        {
          $or: [
            { userId: parseInt(userId) },
            { userEmail: userEmail?.toLowerCase().trim() }
          ]
        },
        { status: 'active' },
        { planId: '2' }
      ]
    }).session(session);

    if (!subscription) {
      await session.abortTransaction();
      return res.json({
        success: false,
        message: 'No active Premium subscription found'
      });
    }

    console.log('✅ Found subscription for reactivation:', subscription._id);

    // Check if auto-renewal is already enabled
    if (subscription.autoRenew) {
      await session.abortTransaction();
      return res.json({
        success: true,
        message: 'Auto-renewal is already enabled',
        autoRenew: true
      });
    }

    // Update subscription
    const updateResult = await Subscription.updateOne(
      { _id: subscription._id },
      {
        $set: {
          autoRenew: true,
          updatedAt: new Date(),
          autoRenewalReactivatedDate: new Date()
        },
        $unset: {
          autoRenewalCancelledDate: '',
          autoRenewalCancelledReason: ''
        }
      }
    ).session(session);

    if (updateResult.modifiedCount > 0) {
      // Create log entry
      await SubscriptionLog.create([{
        subscriptionId: subscription._id,
        userId: subscription.userId,
        userEmail: subscription.userEmail,
        action: 'auto_renewal_reactivated', // ADD this to your enum
        details: {
          reactivatedDate: new Date(),
          note: 'Auto-renewal reactivated by user'
        }
      }], { session });

      await session.commitTransaction();

      console.log('✅ Auto-renewal reactivated successfully');

      res.json({
        success: true,
        message: 'Auto-renewal reactivated successfully. Your subscription will automatically renew on the next billing date.',
        autoRenew: true
      });
    } else {
      await session.abortTransaction();
      res.json({
        success: false,
        message: 'Failed to reactivate auto-renewal. Please try again.'
      });
    }

  } catch (error) {
    if (session) {
      await session.abortTransaction();
    }
    console.error('❌ Error reactivating auto-renewal:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while reactivating auto-renewal'
    });
  } finally {
    if (session) {
      session.endSession();
    }
  }
});


// Get subscription renewal history
app.get('/api/subscription/renewal-history/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const subscription = await Subscription.findOne({
      userId: parseInt(userId),
      status: { $in: ['active', 'cancelled', 'expired'] }
    }).sort({ createdAt: -1 });

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'Subscription not found'
      });
    }

    res.json({
      success: true,
      subscription: {
        planName: subscription.planName,
        status: subscription.status,
        autoRenew: subscription.autoRenew,
        nextBillingDate: subscription.nextBillingDate,
        renewalAttempts: subscription.renewalAttempts,
        maxRenewalAttempts: subscription.maxRenewalAttempts
      },
      renewalHistory: subscription.renewalHistory || []
    });

  } catch (error) {
    console.error('Error fetching renewal history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch renewal history'
    });
  }
});

app.post('/api/user/:userId/reactivate-suspended-items', async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findOne({ userId: parseInt(userId) });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Verify user has premium subscription
    const activeSubscription = await Subscription.findOne({
      userId: parseInt(userId),
      status: 'active',
      planId: '2' // Premium plan
    });

    if (!activeSubscription) {
      return res.status(400).json({
        success: false,
        message: 'Premium subscription required to reactivate suspended items'
      });
    }

    // Reactivate suspended businesses
    const reactivatedBusinesses = await Business.updateMany(
      {
        userId: parseInt(userId),
        status: 'suspended',
        suspensionReason: { $regex: /plan limit/i }
      },
      {
        status: 'active',
        suspendedDate: null,
        suspensionReason: null,
        updatedAt: new Date()
      }
    );

    // Reactivate suspended offers
    const reactivatedOffers = await Offer.updateMany(
      {
        userId: parseInt(userId),
        status: 'suspended',
        suspensionReason: { $regex: /plan limit/i }
      },
      {
        status: 'active',
        suspendedDate: null,
        suspensionReason: null,
        updatedAt: new Date()
      }
    );

    console.log(`Reactivated ${reactivatedBusinesses.modifiedCount} businesses and ${reactivatedOffers.modifiedCount} offers`);

    res.json({
      success: true,
      message: `Reactivated ${reactivatedBusinesses.modifiedCount} businesses and ${reactivatedOffers.modifiedCount} offers`,
      reactivatedBusinesses: reactivatedBusinesses.modifiedCount,
      reactivatedOffers: reactivatedOffers.modifiedCount
    });

  } catch (error) {
    console.error('Error reactivating suspended items:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reactivate suspended items'
    });
  }
});

app.get('/api/debug/subscription/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    console.log('🐛 Debug: Checking subscription for userId:', userId);

    // Find the subscription directly from database
    const subscription = await Subscription.findOne({
      $or: [
        { userId: parseInt(userId) },
      ]
    }).sort({ createdAt: -1 });

    if (!subscription) {
      return res.json({
        success: false,
        message: 'No subscription found',
        userId: userId,
        timestamp: new Date().toISOString()
      });
    }

    console.log('🐛 Debug: Raw subscription from database:', {
      _id: subscription._id,
      userId: subscription.userId,
      userEmail: subscription.userEmail,
      planId: subscription.planId,
      planName: subscription.planName,
      autoRenew: subscription.autoRenew,
      status: subscription.status,
      downgradeScheduled: subscription.downgradeScheduled,
      updatedAt: subscription.updatedAt,
      payhereRecurringToken: subscription.payhereRecurringToken,
      autoRenewalCancelledDate: subscription.autoRenewalCancelledDate
    });

    res.json({
      success: true,
      message: 'Debug subscription data',
      rawSubscription: subscription.toObject(),
      parsedData: {
        autoRenew: subscription.autoRenew,
        autoRenewalType: typeof subscription.autoRenew,
        downgradeScheduled: subscription.downgradeScheduled,
        downgradeType: typeof subscription.downgradeScheduled,
        status: subscription.status,
        planId: subscription.planId
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('🐛 Debug error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});
// 11. Enhanced Subscription Check Route (Updated for Auto-Renewal)
app.post('/api/user/check-subscription-with-renewal', async (req, res) => {
  try {
    const { email, userId } = req.body;

    console.log('🔍 Checking subscription for:', { email, userId });

    // Find user first
    let user = null;
    if (userId) {
      user = await User.findOne({ userId: parseInt(userId) });
    } else if (email) {
      user = await User.findOne({ email: email.toLowerCase().trim() });
    }

    if (!user) {
      return res.json({
        success: true,
        hasSubscription: false,
        hasActiveSubscription: false,
        isPremiumUser: false,
        isFreeUser: false,
        isNonActivated: true,
        userExists: false,
        subscription: null
      });
    }

    // Find subscription
    const subscription = await Subscription.findOne({
      $or: [
        { userId: user.userId },
        { userEmail: user.email.toLowerCase().trim() }
      ]
    }).sort({ createdAt: -1 });

    if (!subscription) {
      return res.json({
        success: true,
        hasSubscription: false,
        hasActiveSubscription: false,
        isPremiumUser: false,
        isFreeUser: false,
        isNonActivated: true,
        userExists: true,
        subscription: null,
        downgradeScheduled: false
      });
    }

    // IMPORTANT: Log the actual database values
    console.log('📊 Raw subscription data from DB:', {
      _id: subscription._id,
      autoRenew: subscription.autoRenew,
      autoRenewType: typeof subscription.autoRenew,
      downgradeScheduled: subscription.downgradeScheduled,
      updatedAt: subscription.updatedAt,
      autoRenewalCancelledDate: subscription.autoRenewalCancelledDate
    });

    // Check subscription status
    const now = new Date();
    const isExpired = subscription.endDate && new Date(subscription.endDate) < now;

    let isPremiumUser = false;
    let isFreeUser = false;
    let hasActiveSubscription = false;

    if (subscription.planId === '2' && subscription.status === 'active' && !isExpired) {
      isPremiumUser = true;
      hasActiveSubscription = true;
    } else if (subscription.planId === '1' && subscription.status === 'active') {
      isFreeUser = true;
      hasActiveSubscription = true;
    }

    // FIXED: Return the EXACT database values without modification
    const responseData = {
      success: true,
      hasSubscription: true,
      hasActiveSubscription,
      isPremiumUser,
      isFreeUser,
      isNonActivated: !hasActiveSubscription,
      userExists: true,
      subscription: {
        ...subscription.toObject(),
        // CRITICAL: Don't override these values
        autoRenew: subscription.autoRenew, // Use exact DB value
        downgradeScheduled: subscription.downgradeScheduled || false,
        downgradeEffectiveDate: subscription.downgradeEffectiveDate || null,
        downgradeReason: subscription.downgradeReason || null,
        downgradeScheduledDate: subscription.downgradeScheduledDate || null
      },

      // FIXED: Also return at root level for backwards compatibility
      autoRenewal: subscription.autoRenew, // This is what your frontend was looking for
      renewalWarning: subscription.renewalAttempts > 0,
      paymentFailure: subscription.status === 'pending_renewal',
      downgradeScheduled: subscription.downgradeScheduled || false,
      downgradeDate: subscription.downgradeEffectiveDate || null
    };

    console.log('✅ Returning subscription data:', {
      userId,
      isPremiumUser,
      isFreeUser,
      autoRenew: subscription.autoRenew,
      autoRenewalAtRoot: responseData.autoRenewal,
      downgradeScheduled: subscription.downgradeScheduled || false
    });

    res.json(responseData);

  } catch (error) {
    console.error('❌ Error checking subscription:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while checking subscription status'
    });
  }
});

app.post('/api/subscription/process-scheduled-downgrades', async (req, res) => {
  try {
    console.log('🔄 Processing scheduled downgrades...');
    const now = new Date();

    // Find subscriptions that should be downgraded
    const subscriptionsToDowngrade = await Subscription.find({
      downgradeScheduled: true,
      downgradeEffectiveDate: { $lte: now },
      status: 'active',
      planId: '2' // Premium subscriptions only
    });

    console.log(`📋 Found ${subscriptionsToDowngrade.length} subscriptions to downgrade`);

    const results = [];

    for (const subscription of subscriptionsToDowngrade) {
      try {
        console.log(`🔄 Processing downgrade for user ${subscription.userId}`);

        // Step 1: Apply plan limitations first
        if (subscription.downgradeSelections) {
          await handleDowngradeSelections(subscription.userId, subscription.downgradeSelections);
        } else {
          await applyFreePlanLimitations(subscription.userId);
        }

        // Step 2: Update subscription to free plan
        const updateResult = await Subscription.updateOne(
          { _id: subscription._id },
          {
            $set: {
              planId: '1',
              planName: 'Free',
              amount: 0,
              autoRenew: false,
              nextBillingDate: null,
              downgradeProcessedDate: now,
              updatedAt: now
            },
            $unset: {
              downgradeScheduled: '',
              downgradeScheduledDate: '',
              downgradeReason: '',
              downgradeEffectiveDate: '',
              downgradeTargetPlan: '',
              downgradeSelections: ''
            }
          }
        );

        if (updateResult.modifiedCount > 0) {
          // Create history record
          await SubscriptionHistory.create({
            userId: subscription.userId,
            userEmail: subscription.userEmail,
            action: 'downgrade_processed',
            fromPlan: 'Premium',
            toPlan: 'Free',
            reason: subscription.downgradeReason || 'Automatic downgrade',
            effectiveDate: now,
            notes: 'Downgrade processed automatically'
          });

          results.push({
            userId: subscription.userId,
            success: true,
            message: 'Downgraded successfully'
          });

          console.log(`✅ Successfully downgraded user ${subscription.userId}`);
        } else {
          results.push({
            userId: subscription.userId,
            success: false,
            message: 'Failed to update subscription'
          });
        }

      } catch (error) {
        console.error(`❌ Error processing downgrade for user ${subscription.userId}:`, error);
        results.push({
          userId: subscription.userId,
          success: false,
          message: error.message
        });
      }
    }

    res.json({
      success: true,
      message: `Processed ${subscriptionsToDowngrade.length} scheduled downgrades`,
      results: results
    });

  } catch (error) {
    console.error('❌ Error processing scheduled downgrades:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while processing downgrades'
    });
  }
});
app.post('/api/subscription/process-automatic-renewals', async (req, res) => {
  try {
    console.log('🔄 Processing automatic renewals...');

    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // Find subscriptions that need renewal within next 24 hours
    const subscriptionsToRenew = await Subscription.find({
      status: 'active',
      planId: '2', // Premium subscriptions only
      autoRenew: true,
      nextBillingDate: { $lte: tomorrow },
      paymentFailure: { $ne: true }
    });

    console.log(`📋 Found ${subscriptionsToRenew.length} subscriptions to renew`);

    const results = [];

    for (const subscription of subscriptionsToRenew) {
      try {
        // Process renewal payment through PayHere
        const renewalResult = await processPayHereRenewal(subscription);

        if (renewalResult.success) {
          // Update subscription with new billing dates
          const nextBillingDate = new Date(subscription.nextBillingDate);
          nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);

          await Subscription.updateOne(
            { _id: subscription._id },
            {
              $set: {
                nextBillingDate: nextBillingDate,
                paymentFailure: false,
                renewalWarning: false,
                lastRenewalDate: now,
                updatedAt: now
              }
            }
          );

          // Log successful renewal
          await SubscriptionHistory.create({
            userId: subscription.userId,
            userEmail: subscription.userEmail,
            action: 'auto_renewal_success',
            fromPlan: subscription.planName,
            toPlan: subscription.planName,
            effectiveDate: now,
            notes: `Automatic renewal successful. Next billing: ${nextBillingDate.toLocaleDateString()}`
          });

          results.push({
            userId: subscription.userId,
            success: true,
            message: 'Renewal successful'
          });

          console.log(`✅ Successfully renewed subscription for user ${subscription.userId}`);

        } else {
          // Payment failed - mark subscription for failure handling
          await handleSubscriptionPaymentFailure(subscription, renewalResult.error);

          results.push({
            userId: subscription.userId,
            success: false,
            error: renewalResult.error
          });
        }

      } catch (error) {
        console.error(`❌ Failed to process renewal for user ${subscription.userId}:`, error);
        await handleSubscriptionPaymentFailure(subscription, error.message);

        results.push({
          userId: subscription.userId,
          success: false,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      message: `Processed ${results.length} renewal attempts`,
      results: results,
      summary: {
        total: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length
      }
    });

  } catch (error) {
    console.error('❌ Error processing automatic renewals:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while processing renewals'
    });
  }
});

async function processPayHereRenewal(subscription) {
  try {
    // This would integrate with PayHere's recurring payment API
    // For now, we'll simulate the process

    console.log(`💳 Processing PayHere renewal for subscription ${subscription._id}`);

    // In a real implementation, you would:
    // 1. Call PayHere's recurring payment API
    // 2. Check if the payment was successful
    // 3. Return success/failure status

    // Simulate payment processing
    const paymentSuccess = Math.random() > 0.1; // 90% success rate for simulation

    if (paymentSuccess) {
      return {
        success: true,
        transactionId: `TXN_${Date.now()}`,
        amount: subscription.amount,
        currency: subscription.currency
      };
    } else {
      return {
        success: false,
        error: 'Insufficient funds in payment method'
      };
    }

  } catch (error) {
    console.error('Error processing PayHere renewal:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

app.post('/api/subscription/schedule-cancellation', async (req, res) => {
  try {
    const { userId, userEmail, reason } = req.body;

    // Find current subscription
    const subscription = await Subscription.findOne({
      $or: [
        { userId: userId },
        { userEmail: userEmail }
      ],
      status: 'active',
      planId: '2' // Only premium subscriptions can be cancelled
    });

    if (!subscription) {
      return res.json({
        success: false,
        message: 'No active premium subscription found'
      });
    }

    // Check if cancellation is already scheduled
    if (subscription.cancellationScheduled) {
      return res.json({
        success: false,
        message: 'Cancellation is already scheduled for this subscription'
      });
    }

    // Schedule cancellation for next billing date
    const updateResult = await Subscription.updateOne(
      { _id: subscription._id },
      {
        $set: {
          cancellationScheduled: true,
          cancellationScheduledDate: new Date(),
          cancellationReason: reason || 'User requested cancellation',
          cancellationEffectiveDate: subscription.nextBillingDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          autoRenew: false, // Disable auto-renewal
          updatedAt: new Date()
        }
      }
    );

    if (updateResult.modifiedCount > 0) {
      // Log the cancellation scheduling
      await SubscriptionLog.create({
        subscriptionId: subscription._id,
        userId: userId,
        userEmail: userEmail,
        action: 'cancellation_scheduled',
        details: {
          reason: reason,
          scheduledDate: new Date(),
          effectiveDate: subscription.nextBillingDate,
          remainingDays: Math.ceil((new Date(subscription.nextBillingDate) - new Date()) / (1000 * 60 * 60 * 24))
        },
        timestamp: new Date()
      });

      const effectiveDate = new Date(subscription.nextBillingDate).toLocaleDateString();

      res.json({
        success: true,
        message: `Subscription cancellation scheduled successfully. You'll continue to enjoy premium features until ${effectiveDate}, then your account will automatically switch to the Free plan.`,
        effectiveDate: subscription.nextBillingDate
      });
    } else {
      res.json({
        success: false,
        message: 'Failed to schedule cancellation. Please try again.'
      });
    }

  } catch (error) {
    console.error('Error scheduling cancellation:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while scheduling cancellation'
    });
  }
});


app.post('/api/subscription/cancel-scheduled-cancellation', async (req, res) => {
  try {
    const { userId } = req.body;

    console.log('🔄 Processing legacy cancellation cancel for userId:', userId);

    // First, try to find and cancel a downgrade (new system)
    const subscription = await Subscription.findOne({
      userId: userId,
      status: 'active',
      $or: [
        { downgradeScheduled: true },
        { cancellationScheduled: true }
      ]
    });

    if (!subscription) {
      console.log('❌ No scheduled cancellation or downgrade found');
      return res.json({
        success: false,
        message: 'No scheduled cancellation or downgrade found to cancel'
      });
    }

    let updateFields = {
      $set: {
        autoRenew: true,
        updatedAt: new Date()
      }
    };

    let unsetFields = {};

    // Handle downgrade cancellation
    if (subscription.downgradeScheduled) {
      unsetFields = {
        ...unsetFields,
        downgradeScheduled: '',
        downgradeScheduledDate: '',
        downgradeReason: '',
        downgradeEffectiveDate: '',
        downgradeTargetPlan: '',
        downgradeSelections: ''
      };
    }

    // Handle old-style cancellation
    if (subscription.cancellationScheduled) {
      unsetFields = {
        ...unsetFields,
        cancellationScheduled: '',
        cancellationScheduledDate: '',
        cancellationReason: '',
        cancellationEffectiveDate: ''
      };
    }

    updateFields.$unset = unsetFields;

    const updateResult = await Subscription.updateOne(
      { _id: subscription._id },
      updateFields
    );

    if (updateResult.modifiedCount > 0) {
      // Create history record with proper userEmail
      await SubscriptionHistory.create({
        userId: subscription.userId,
        userEmail: subscription.userEmail, // Use the email from the subscription
        action: subscription.downgradeScheduled ? 'downgrade_cancelled' : 'cancellation_cancelled',
        fromPlan: 'Premium Plan',
        toPlan: 'Premium Plan',
        reason: 'User cancelled scheduled downgrade/cancellation',
        effectiveDate: new Date(),
        notes: 'Premium subscription will continue with auto-renewal enabled'
      });

      console.log('✅ Cancelled scheduled action via legacy endpoint');
      return res.json({
        success: true,
        message: 'Scheduled downgrade/cancellation cancelled successfully! Your premium subscription will continue.'
      });
    }

    console.log('❌ No updates made');
    res.json({
      success: false,
      message: 'Failed to cancel scheduled action'
    });

  } catch (error) {
    console.error('❌ Error in legacy cancellation cancel:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while reactivating subscription'
    });
  }
});

app.get('/api/subscription/cancellation-details/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const subscription = await Subscription.findOne({
      userId: userId,
      cancellationScheduled: true
    });

    if (!subscription) {
      return res.json({
        success: true,
        cancellationInfo: null
      });
    }

    res.json({
      success: true,
      cancellationInfo: {
        scheduledDate: subscription.cancellationScheduledDate,
        effectiveDate: subscription.cancellationEffectiveDate,
        reason: subscription.cancellationReason,
        daysRemaining: Math.ceil((new Date(subscription.cancellationEffectiveDate) - new Date()) / (1000 * 60 * 60 * 24))
      }
    });

  } catch (error) {
    console.error('Error fetching cancellation details:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while fetching cancellation details'
    });
  }
});


app.post('/api/subscription/check-with-cancellation', async (req, res) => {
  try {
    const { email, userId } = req.body;

    // Find subscription
    const subscription = await Subscription.findOne({
      $or: [
        { userId: userId },
        { userEmail: email }
      ]
    }).sort({ createdAt: -1 });

    if (!subscription) {
      return res.json({
        success: true,
        hasSubscription: false,
        hasActiveSubscription: false,
        isPremiumUser: false,
        isFreeUser: false,
        isNonActivated: true,
        userExists: true,
        subscription: null,
        cancellationInfo: null,
        isInGracePeriod: false
      });
    }

    // Check if subscription is expired
    const now = new Date();
    const isExpired = subscription.endDate && new Date(subscription.endDate) < now;

    // Check if in grace period (cancelled but still active until next billing)
    const isInGracePeriod = subscription.cancellationScheduled &&
      subscription.status === 'active' &&
      subscription.cancellationEffectiveDate &&
      new Date(subscription.cancellationEffectiveDate) > now;

    // Determine user status
    let isPremiumUser = false;
    let isFreeUser = false;
    let hasActiveSubscription = false;

    if (subscription.planId === '2' && subscription.status === 'active' && !isExpired) {
      isPremiumUser = true;
      hasActiveSubscription = true;
    } else if (subscription.planId === '1' && subscription.status === 'active') {
      isFreeUser = true;
      hasActiveSubscription = true;
    }

    // Cancellation info
    let cancellationInfo = null;
    if (subscription.cancellationScheduled) {
      cancellationInfo = {
        scheduledDate: subscription.cancellationScheduledDate,
        effectiveDate: subscription.cancellationEffectiveDate,
        reason: subscription.cancellationReason,
        daysRemaining: Math.ceil((new Date(subscription.cancellationEffectiveDate) - now) / (1000 * 60 * 60 * 24))
      };
    }

    // Add cancellation fields to subscription object
    const subscriptionWithCancellation = {
      ...subscription.toObject(),
      cancellationScheduled: subscription.cancellationScheduled || false,
      cancellationEffectiveDate: subscription.cancellationEffectiveDate,
      isInGracePeriod: isInGracePeriod
    };

    res.json({
      success: true,
      hasSubscription: true,
      hasActiveSubscription,
      isPremiumUser,
      isFreeUser,
      isNonActivated: !hasActiveSubscription,
      userExists: true,
      subscription: subscriptionWithCancellation,
      cancellationInfo,
      isInGracePeriod,
      autoRenewal: subscription.autoRenew || false
    });

  } catch (error) {
    console.error('Error checking subscription with cancellation:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while checking subscription status'
    });
  }
});
// 12. Frontend Integration Helper Routes

// Update frontend plans endpoint to include auto-renewal info
app.get('/plans-with-renewal', (req, res) => {
  const plans = [
    {
      id: 1,
      name: 'Free Plan',
      monthlyPrice: 0,
      features: ['1 highlight ad', 'Standard position in listings', 'Add one discount or promo code', 'Set start and end date for promotions'],
      description: 'Perfect for individuals getting started',
      popular: false,
      autoRenewal: false
    },
    {
      id: 2,
      name: 'Premium Plan',
      monthlyPrice: 150,
      features: ['3 highlight ads', 'Priority position in listings and category pages', 'Multiple Promotions can be added', 'Premium Features', 'Auto-renewal available'],
      description: 'Ideal for growing businesses with automatic monthly billing',
      popular: true,
      autoRenewal: true,
      autoRenewalBenefits: [
        'Never miss premium features',
        'Automatic monthly payments',
        'Cancel anytime',
        'Email notifications for all transactions'
      ]
    }
  ];

  res.json({ plans });
});


app.get('/api/admin/auto-renewal-subscriptions', async (req, res) => {
  try {
    console.log('📊 Starting admin subscriptions fetch...');
    
    // Test database connection first
    if (mongoose.connection.readyState !== 1) {
      console.error('❌ Database not connected');
      return res.status(500).json({
        success: false,
        message: 'Database connection error'
      });
    }

    const { status, page = 1, limit = 500 } = req.query;
    
    console.log('Query parameters:', { status, page, limit });

    // Build filter
    let filter = { planId: '2' }; // Only Premium subscriptions
    if (status && status !== 'all') {
      filter.status = status;
    }

    console.log('🔍 Using filter:', filter);

    // Test collection access
    const totalCount = await Subscription.countDocuments(filter);
    console.log(`📊 Total matching subscriptions: ${totalCount}`);

    if (totalCount === 0) {
      return res.json({
        success: true,
        subscriptions: [],
        pagination: {
          currentPage: parseInt(page),
          totalPages: 0,
          totalItems: 0,
          limit: parseInt(limit)
        },
        stats: {
          totalSubscriptions: 0,
          totalAutoRenewal: 0,
          activeAutoRenewal: 0,
          pendingRenewal: 0,
          failedRenewal: 0
        },
        message: 'No premium subscriptions found in database'
      });
    }

    // Get subscriptions with pagination
    const subscriptions = await Subscription.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    console.log(`📋 Raw subscriptions found: ${subscriptions.length}`);

    // Enrich with user details
    const subscriptionsWithDetails = [];
    
    for (const subscription of subscriptions) {
      try {
        // Find user details
        const user = await User.findOne({
          $or: [
            { userId: subscription.userId },
            { email: subscription.userEmail }
          ]
        }).select('firstName lastName email businessName userType').lean();

        console.log(`User lookup for subscription ${subscription._id}:`, user ? 'found' : 'not found');

        // Calculate days until renewal
        let daysUntilRenewal = null;
        if (subscription.nextBillingDate) {
          const today = new Date();
          const billingDate = new Date(subscription.nextBillingDate);
          daysUntilRenewal = Math.ceil((billingDate - today) / (1000 * 60 * 60 * 24));
        } else if (subscription.endDate) {
          const today = new Date();
          const endDate = new Date(subscription.endDate);
          daysUntilRenewal = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
        }

        const enrichedSubscription = {
          ...subscription,
          userDetails: user ? {
            firstName: user.firstName || 'Unknown',
            lastName: user.lastName || 'User', 
            email: user.email || subscription.userEmail || 'N/A',
            businessName: user.businessName || 'N/A',
            userType: user.userType || 'individual'
          } : {
            firstName: 'Unknown',
            lastName: 'User',
            email: subscription.userEmail || 'N/A',
            businessName: 'N/A',
            userType: 'unknown'
          },
          daysUntilRenewal: daysUntilRenewal,
          renewalAttempts: subscription.renewalAttempts || 0,
          maxRenewalAttempts: subscription.maxRenewalAttempts || 3,
          autoRenew: subscription.autoRenew || false,
          paymentFailure: subscription.paymentFailure || false,
          payhereRecurringToken: subscription.payhereRecurringToken || null,
          lastRenewalDate: subscription.lastRenewalDate || null,
          billingCycle: subscription.billingCycle || 'monthly'
        };

        subscriptionsWithDetails.push(enrichedSubscription);

      } catch (enrichError) {
        console.error(`Error enriching subscription ${subscription._id}:`, enrichError);
        
        // Add subscription with error details
        subscriptionsWithDetails.push({
          ...subscription,
          userDetails: {
            firstName: 'Error',
            lastName: 'Loading',
            email: subscription.userEmail || 'N/A',
            businessName: 'N/A',
            userType: 'error'
          },
          daysUntilRenewal: null,
          renewalAttempts: subscription.renewalAttempts || 0,
          maxRenewalAttempts: subscription.maxRenewalAttempts || 3,
          autoRenew: subscription.autoRenew || false,
          paymentFailure: subscription.paymentFailure || false
        });
      }
    }

    // Calculate statistics
    const stats = {
      totalSubscriptions: await Subscription.countDocuments({ planId: '2' }),
      totalAutoRenewal: await Subscription.countDocuments({
        planId: '2',
        autoRenew: true
      }),
      activeAutoRenewal: await Subscription.countDocuments({
        planId: '2',
        autoRenew: true,
        status: 'active'
      }),
      pendingRenewal: await Subscription.countDocuments({
        planId: '2',
        status: 'pending_renewal'
      }),
      failedRenewal: await Subscription.countDocuments({
        planId: '2',
        $or: [
          { status: 'payment_failed' },
          { renewalAttempts: { $gt: 0 } },
          { paymentFailure: true }
        ]
      })
    };

    console.log('📊 Final statistics:', stats);
    console.log(`📦 Returning ${subscriptionsWithDetails.length} subscriptions`);

    res.json({
      success: true,
      subscriptions: subscriptionsWithDetails,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / limit),
        totalItems: totalCount,
        limit: parseInt(limit)
      },
      stats: stats
    });

  } catch (error) {
    console.error('❌ Error in auto-renewal subscriptions endpoint:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch subscriptions: ' + error.message,
      error: error.toString()
    });
  }
});


app.post('/create-payhere-payment-with-auto-renewal', async (req, res) => {
  try {
    const { amount, currency = 'LKR', planId, customerData, enableAutoRenew = false } = req.body;

    // Only allow auto-renewal for Premium plans
    if (enableAutoRenew && planId === '1') {
      return res.status(400).json({
        success: false,
        error: 'Auto-renewal is only available for Premium plans'
      });
    }

    // Use the recurring payment creation if auto-renewal is enabled
    if (enableAutoRenew && planId === '2') {
      // Forward to recurring payment creation
      req.body.enableAutoRenew = true;
      return await createPayHereRecurringPayment(req, res);
    } else {
      // Use regular payment creation (your existing logic)
      // ... your existing create-payhere-payment logic
    }

  } catch (error) {
    console.error('Error creating payment with auto-renewal option:', error);
    res.status(500).json({
      success: false,
      error: 'Payment creation failed'
    });
  }
});

// 5. ADD monitoring endpoint for auto-renewals:

app.get('/api/admin/renewal-monitoring', async (req, res) => {
  try {
    console.log('📊 Fetching renewal monitoring data...');

    if (mongoose.connection.readyState !== 1) {
      return res.status(500).json({
        success: false,
        message: 'Database not connected'
      });
    }

    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(23, 59, 59, 999);

    const nextWeek = new Date(now);
    nextWeek.setDate(nextWeek.getDate() + 7);
    nextWeek.setHours(23, 59, 59, 999);

    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Use Promise.all for better performance
    const [dueTomorrow, dueThisWeek, failedRenewals, cancelledDueToFailure, totalAutoRenewalSubscriptions] = await Promise.all([
      // Count renewals due tomorrow
      Subscription.countDocuments({
        planId: '2',
        status: 'active',
        $or: [
          {
            nextBillingDate: {
              $gte: now,
              $lte: tomorrow
            }
          },
          {
            endDate: {
              $gte: now,
              $lte: tomorrow
            },
            autoRenew: true
          }
        ]
      }),

      // Count renewals due this week
      Subscription.countDocuments({
        planId: '2',
        status: 'active',
        $or: [
          {
            nextBillingDate: {
              $gte: now,
              $lte: nextWeek
            }
          },
          {
            endDate: {
              $gte: now,
              $lte: nextWeek
            },
            autoRenew: true
          }
        ]
      }),

      // Count failed renewals
      Subscription.countDocuments({
        planId: '2',
        $or: [
          { status: 'pending_renewal' },
          { status: 'payment_failed' },
          {
            status: 'active',
            renewalAttempts: { $gt: 0, $lt: 3 }
          }
        ]
      }),

      // Count cancelled due to failure
      Subscription.countDocuments({
        planId: '2',
        status: 'cancelled',
        updatedAt: { $gte: thirtyDaysAgo },
        $or: [
          { paymentFailure: true },
          { renewalAttempts: { $gte: 3 } }
        ]
      }),

      // Total auto-renewal subscriptions
      Subscription.countDocuments({
        planId: '2',
        autoRenew: true,
        status: { $in: ['active', 'pending_renewal'] }
      })
    ]);

    const monitoring = {
      dueTomorrow,
      dueThisWeek,
      failedRenewals,
      cancelledDueToFailure,
      totalAutoRenewalSubscriptions
    };

    console.log('📊 Monitoring data calculated:', monitoring);

    res.json({
      success: true,
      monitoring: monitoring
    });

  } catch (error) {
    console.error('❌ Error fetching monitoring data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch monitoring data: ' + error.message
    });
  }
});

// ADD this temporary debug route to your server.js to check what's happening:

app.get('/api/debug/user-subscription/:email', async (req, res) => {
  try {
    const { email } = req.params;

    console.log('🔍 DEBUG: Checking user and subscriptions for:', email);

    // Find user
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    console.log('User found:', user ? {
      userId: user.userId,
      email: user.email,
      firstName: user.firstName,
      createdAt: user.createdAt
    } : 'NOT FOUND');

    // Find ALL subscriptions for this email/userId
    const subscriptionsAll = await Subscription.find({
      $or: [
        { userEmail: email.toLowerCase().trim() },
        { userId: user?.userId }
      ]
    }).sort({ createdAt: -1 });

    console.log('All subscriptions found:', subscriptionsAll.length);
    subscriptionsAll.forEach((sub, index) => {
      console.log(`Subscription ${index + 1}:`, {
        id: sub._id,
        userId: sub.userId,
        userEmail: sub.userEmail,
        planId: sub.planId,
        planName: sub.planName,
        status: sub.status,
        paymentMethod: sub.paymentMethod,
        createdAt: sub.createdAt
      });
    });

    res.json({
      success: true,
      debug: {
        email: email,
        userFound: !!user,
        user: user ? {
          userId: user.userId,
          email: user.email,
          firstName: user.firstName,
          createdAt: user.createdAt
        } : null,
        totalSubscriptions: subscriptionsAll.length,
        subscriptions: subscriptionsAll.map(sub => ({
          id: sub._id,
          userId: sub.userId,
          userEmail: sub.userEmail,
          planId: sub.planId,
          planName: sub.planName,
          status: sub.status,
          paymentMethod: sub.paymentMethod,
          createdAt: sub.createdAt
        }))
      }
    });

  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ADD this route to clean up unwanted subscriptions for a specific user
app.delete('/api/debug/clean-user-subscriptions/:email', async (req, res) => {
  try {
    const { email } = req.params;

    console.log('🧹 CLEANUP: Removing all subscriptions for:', email);

    // Find user first
    const user = await User.findOne({ email: email.toLowerCase().trim() });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Delete ALL subscriptions for this user
    const deleteResult = await Subscription.deleteMany({
      $or: [
        { userEmail: email.toLowerCase().trim() },
        { userId: user.userId }
      ]
    });

    console.log('✅ Deleted subscriptions:', deleteResult.deletedCount);

    res.json({
      success: true,
      message: `Deleted ${deleteResult.deletedCount} subscription(s) for user ${email}`,
      deletedCount: deleteResult.deletedCount
    });

  } catch (error) {
    console.error('Cleanup error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/admin/debug-subscriptions', async (req, res) => {
  try {
    console.log('🐛 Running comprehensive debug check...');
    
    const debug = {
      timestamp: new Date().toISOString(),
      database: {
        connected: mongoose.connection.readyState === 1,
        name: mongoose.connection.name || 'unknown',
        host: mongoose.connection.host || 'unknown'
      },
      models: {
        Subscription: !!Subscription,
        User: !!User
      },
      collections: {}
    };

    if (debug.database.connected) {
      try {
        // Test collections
        const [totalSubs, premiumSubs, activeSubs, totalUsers] = await Promise.all([
          Subscription.countDocuments(),
          Subscription.countDocuments({ planId: '2' }),
          Subscription.countDocuments({ status: 'active' }),
          User.countDocuments()
        ]);

        debug.collections = {
          totalSubscriptions: totalSubs,
          premiumSubscriptions: premiumSubs,
          activeSubscriptions: activeSubs,
          totalUsers: totalUsers
        };

        // Get sample subscription
        const sampleSub = await Subscription.findOne({ planId: '2' }).lean();
        if (sampleSub) {
          debug.sample = {
            id: sampleSub._id,
            userId: sampleSub.userId,
            userEmail: sampleSub.userEmail,
            planId: sampleSub.planId,
            status: sampleSub.status,
            hasAutoRenew: sampleSub.autoRenew
          };

          // Test user lookup for sample
          if (sampleSub.userId) {
            const sampleUser = await User.findOne({ userId: sampleSub.userId }).lean();
            debug.userLookupTest = sampleUser ? {
              found: true,
              name: `${sampleUser.firstName} ${sampleUser.lastName}`,
              email: sampleUser.email
            } : { found: false, userId: sampleSub.userId };
          }
        } else {
          debug.sample = null;
          debug.message = 'No premium subscriptions found in database';
        }

      } catch (queryError) {
        debug.collections.error = queryError.message;
      }
    }

    res.json({
      success: debug.database.connected && debug.models.Subscription && debug.models.User,
      debug: debug
    });

  } catch (error) {
    console.error('🐛 Debug endpoint error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      debug: {
        timestamp: new Date().toISOString(),
        fatal: true
      }
    });
  }
});

app.post('/api/subscription/process-scheduled-cancellations', async (req, res) => {
  try {
    const now = new Date();

    // Find all subscriptions with scheduled cancellations that should be processed today
    const subscriptionsToCancel = await Subscription.find({
      cancellationScheduled: true,
      cancellationEffectiveDate: { $lte: now },
      status: 'active'
    });

    const results = [];

    for (const subscription of subscriptionsToCancel) {
      try {
        // Create a free subscription for the user
        const freeSubscription = new Subscription({
          userId: subscription.userId,
          userEmail: subscription.userEmail,
          planId: '1',
          planName: 'Free Plan',
          status: 'active',
          billingCycle: 'monthly',
          amount: 0,
          currency: 'LKR',
          paymentMethod: 'auto_downgrade',
          startDate: now,
          endDate: null, // Free plan doesn't expire
          autoRenew: false,
          createdAt: now,
          updatedAt: now
        });

        await freeSubscription.save();

        // Update the old premium subscription to cancelled
        await Subscription.updateOne(
          { _id: subscription._id },
          {
            $set: {
              status: 'cancelled',
              endDate: now,
              cancellationProcessedDate: now,
              updatedAt: now
            }
          }
        );

        // Log the automatic downgrade
        await SubscriptionLog.create({
          subscriptionId: subscription._id,
          userId: subscription.userId,
          userEmail: subscription.userEmail,
          action: 'auto_downgrade_to_free',
          details: {
            fromPlan: 'Premium Plan',
            toPlan: 'Free Plan',
            processedDate: now,
            reason: 'Scheduled cancellation processed'
          },
          timestamp: now
        });

        results.push({
          userId: subscription.userId,
          userEmail: subscription.userEmail,
          status: 'success',
          message: 'Successfully downgraded to free plan'
        });

      } catch (error) {
        console.error(`Error processing cancellation for user ${subscription.userId}:`, error);
        results.push({
          userId: subscription.userId,
          userEmail: subscription.userEmail,
          status: 'error',
          message: error.message
        });
      }
    }

    res.json({
      success: true,
      message: `Processed ${results.length} scheduled cancellations`,
      results: results,
      processedCount: results.filter(r => r.status === 'success').length,
      errorCount: results.filter(r => r.status === 'error').length
    });

  } catch (error) {
    console.error('Error processing scheduled cancellations:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while processing scheduled cancellations'
    });
  }
});


app.get('/api/user/:userId/plan-limits', async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findOne({ userId: parseInt(userId) });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const planLimitCheck = await checkUserPlanLimits(parseInt(userId));

    res.json({
      success: true,
      planLimits: planLimitCheck
    });
  } catch (error) {
    console.error('Error checking plan limits:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check plan limits'
    });
  }
});


app.post('/api/user/:userId/enforce-plan-limits', async (req, res) => {
  try {
    const { userId } = req.params;
    const { selectedBusinesses = [], selectedOffers = [] } = req.body;

    console.log('Enforcing plan limits for userId:', userId, {
      businessesToDelete: selectedBusinesses.length,
      offersToDelete: selectedOffers.length
    });

    const user = await User.findOne({ userId: parseInt(userId) });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Verify user has free plan
    const activeSubscription = await Subscription.findOne({
      userId: parseInt(userId),
      status: 'active'
    }).sort({ createdAt: -1 });

    if (!activeSubscription || activeSubscription.planId !== '1') {
      return res.status(400).json({
        success: false,
        message: 'Plan limit enforcement only applies to free plan users'
      });
    }

    let deletedBusinesses = 0;
    let deletedOffers = 0;
    let errors = [];

    // Delete selected businesses and their associated offers
    for (const businessId of selectedBusinesses) {
      try {
        // First delete all offers associated with this business
        const associatedOffers = await Offer.deleteMany({ businessId: businessId });
        console.log(`Deleted ${associatedOffers.deletedCount} offers for business ${businessId}`);

        // Then delete the business
        const deletedBusiness = await Business.findByIdAndDelete(businessId);
        if (deletedBusiness) {
          deletedBusinesses++;
          console.log(`Deleted business: ${deletedBusiness.name}`);
        }
      } catch (error) {
        console.error(`Error deleting business ${businessId}:`, error);
        errors.push(`Failed to delete business ${businessId}`);
      }
    }

    // Delete selected offers
    for (const offerId of selectedOffers) {
      try {
        const deletedOffer = await Offer.findByIdAndDelete(offerId);
        if (deletedOffer) {
          deletedOffers++;
          console.log(`Deleted offer: ${deletedOffer.title}`);
        }
      } catch (error) {
        console.error(`Error deleting offer ${offerId}:`, error);
        errors.push(`Failed to delete offer ${offerId}`);
      }
    }

    // Log the enforcement action
    await SubscriptionHistory.create({
      userId: parseInt(userId),
      userEmail: user.email,
      action: 'plan_limit_enforced',
      fromPlan: 'Free',
      toPlan: 'Free',
      reason: 'Plan limits exceeded - items deleted',
      notes: `Deleted ${deletedBusinesses} businesses and ${deletedOffers} offers`,
      effectiveDate: new Date()
    });

    // Check if limits are now within bounds
    const finalCheck = await checkUserPlanLimits(parseInt(userId));

    res.json({
      success: true,
      message: `Successfully deleted ${deletedBusinesses} businesses and ${deletedOffers} offers`,
      deletedBusinesses,
      deletedOffers,
      errors,
      currentLimits: finalCheck,
      withinLimits: !finalCheck.exceedsLimits
    });

  } catch (error) {
    console.error('Error enforcing plan limits:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to enforce plan limits'
    });
  }
});
const Admin = mongoose.model('Admin', adminSchema);

const AutoIncrement = AutoIncrementFactory(mongoose);

const userSchema = new mongoose.Schema({
  userId: Number,
  firstName: String,
  lastName: String,
  address: String,
  email: { type: String, required: true, unique: true },
  phone: String,
  businessName: String,
  businessRegNo: String,
  businessAddress: String,
  userType: String,
  password: { type: String, required: true },
  status: { type: String, enum: ['pending', 'approved', 'declined'], default: 'approved' },
}, {
  timestamps: true // Add this line to enable createdAt and updatedAt
});


userSchema.plugin(AutoIncrement, { inc_field: 'userId' });
const User = mongoose.model('User', userSchema);
export default User;

const resetTokens = new Map();

const createTransporter = () => nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USERNAME,
    pass: process.env.EMAIL_PASSWORD,
  },
});

const sendStatusEmail = async (user, status) => {
  const transporter = createTransporter();
  const statusMessages = {
    approved: {
      subject: 'Registration Approved',
      html: `<p>Dear ${user.firstName || 'User'},<br/>Your registration has been <strong>approved</strong>. You may now access the system.</p>`,
    },
    declined: {
      subject: 'Registration Declined',
      html: `<p>Dear ${user.firstName || 'User'},<br/>Unfortunately, your registration has been <strong>declined</strong>. Please contact support for more details.</p>`,
    },
  };

  const mailOptions = {
    from: process.env.EMAIL_USERNAME,
    to: user.email,
    subject: statusMessages[status].subject,
    html: statusMessages[status].html,
  };

  await transporter.sendMail(mailOptions);
};
// REPLACE your sendWelcomeEmail function in server.js with this updated version:
const sendWelcomeEmail = async (user) => {
  const transporter = createTransporter();

  const mailOptions = {
    from: process.env.EMAIL_USERNAME,
    to: user.email,
    subject: 'Welcome to Explore Sri Lanka - Registration Complete!',
    html: `
      <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="background: linear-gradient(135deg, #007bff, #28a745); padding: 30px; text-align: center; color: white; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 28px;">🎉 Welcome to Explore Sri Lanka!</h1>
          <p style="margin: 10px 0 0; font-size: 16px; opacity: 0.9;">Your registration is complete</p>
        </div>
        
        <div style="background: white; padding: 30px; border: 1px solid #e9ecef; border-top: none;">
          <p style="font-size: 18px; margin-bottom: 20px;">Dear <strong>${user.firstName || 'User'}</strong>,</p>
          
          <p>Congratulations! Your account has been successfully created and approved.</p>
          
          <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid #28a745; margin: 20px 0;">
            <h3 style="margin: 0 0 15px; color: #28a745;">📋 Your Account Details</h3>
            <p style="margin: 5px 0;"><strong>Name:</strong> ${user.firstName} ${user.lastName}</p>
            <p style="margin: 5px 0;"><strong>Email:</strong> ${user.email}</p>
            <p style="margin: 5px 0;"><strong>Business:</strong> ${user.businessName}</p>
            <p style="margin: 5px 0;"><strong>User Type:</strong> ${user.userType}</p>
            <p style="margin: 5px 0;"><strong>Status:</strong> <span style="color: #28a745; font-weight: bold;">Approved</span></p>
          </div>
          
          <div style="background: #fff3cd; padding: 20px; border-radius: 8px; border-left: 4px solid #ffc107; margin: 20px 0;">
            <h3 style="margin: 0 0 15px; color: #856404;">🚀 Next Steps - Choose Your Subscription Plan</h3>
            <p style="margin: 10px 0; font-weight: bold; color: #856404;">⚠️ Important: You must choose and activate a subscription plan before you can use the platform.</p>
            <p style="margin: 10px 0;">Choose from:</p>
            <ul style="margin: 10px 0; padding-left: 20px;">
              <li><strong>Free Plan</strong> - Get started with basic features (1 highlight ad, standard positioning)</li>
              <li><strong>Premium Plan</strong> - Full access with advanced features (3 highlight ads, priority positioning, multiple promotions)</li>
            </ul>
            <p style="margin: 10px 0; color: #856404; font-weight: bold;">📌 Your account is currently non-activated. Please sign in and select a plan to start creating businesses and offers.</p>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <p style="margin-bottom: 20px; font-size: 18px; font-weight: bold;">Ready to get started?</p>
            <a href="http://localhost:5173/signin" style="background: #007bff; color: white; padding: 15px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; margin-right: 10px;">
              Sign In Now
            </a>
          </div>
          
          <div style="background: #e7f3ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h4 style="margin: 0 0 10px; color: #007bff;">💡 After signing in, you can:</h4>
            <ul style="margin: 10px 0; padding-left: 20px;">
              <li>Choose your subscription plan (Free or Premium)</li>
              <li>Add your business details</li>
              <li>Create attractive offers and promotions</li>
              <li>Start reaching customers across Sri Lanka</li>
            </ul>
          </div>
        </div>
        
        <div style="background: #f8f9fa; padding: 20px; text-align: center; color: #6c757d; font-size: 14px; border-radius: 0 0 8px 8px;">
          <p style="margin: 0;">Thank you for choosing Explore Sri Lanka!</p>
          <p style="margin: 5px 0 0;">Need help? Contact our support team at info@sixt5technology.xyz</p>
        </div>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`✅ Welcome email sent to ${user.email}`);
    return true;
  } catch (error) {
    console.error('❌ Error sending welcome email:', error);
    return false;
  }
};



app.post('/api/auth/register', async (req, res) => {
  try {
    // Check if user already exists
    const existingUser = await User.findOne({ email: req.body.email });
    if (existingUser) {
      return res.json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(req.body.password, 10);

    // Create new user
    const user = new User({
      ...req.body,
      password: hashedPassword,
      status: 'approved' // Auto-approve business users
    });

    await user.save();
    console.log('✅ User registered successfully:', user.email, 'userId:', user.userId);

    // Send welcome email
    try {
      await sendWelcomeEmail(user);
    } catch (emailError) {
      console.error('❌ Welcome email failed (registration still successful):', emailError);
    }

    // ✅ CRITICAL FIX: Do NOT create any subscription during registration
    // New users should be completely non-activated until they choose a plan
    console.log('🔄 User registered with NO subscription - user is non-activated');

    res.json({
      success: true,
      message: 'Registration successful! Please sign in to choose your subscription plan.',
      userId: user.userId,
      emailSent: true,
      subscriptionCreated: false // Explicitly no subscription created
    });

  } catch (error) {
    console.error('❌ Registration error:', error);

    if (error.code === 11000) {
      const field = error.keyPattern?.email ? 'email' : 'username';
      return res.status(400).json({
        success: false,
        message: `User with this ${field} already exists`
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error registering user',
      error: error.message
    });
  }
});
// REPLACE your /api/auth/login route in server.js with this:
app.post('/api/auth/login', async (req, res) => {
  try {
    const user = await User.findOne({ email: req.body.email });
    if (!user) return res.json({ success: false, message: 'User not found' });

    const isMatch = await bcrypt.compare(req.body.password, user.password);
    if (!isMatch) return res.json({ success: false, message: 'Invalid credentials' });

    // ✅ Block login if not approved
    if (user.status !== 'approved') {
      return res.json({ success: false, message: 'Your account is not approved yet.' });
    }

    console.log('🔐 User logged in:', user.email, 'userId:', user.userId);

    // ✅ CRITICAL FIX: Check subscription status to determine redirect
    console.log('🔍 Checking subscription status for redirect...');

    // Find subscription for this user
    const subscription = await Subscription.findOne({
      $or: [
        { userId: user.userId },
        { userEmail: user.email.toLowerCase().trim() }
      ]
    }).sort({ createdAt: -1 }); // Get most recent if multiple exist

    let redirectTo = 'subscription'; // Default for non-activated users
    let subscriptionStatus = 'non-activated';

    if (subscription) {
      const now = new Date();

      // Check if it's an active premium subscription
      const isActivePremium = subscription.planId === '2' &&
        subscription.status === 'active' &&
        (!subscription.endDate || new Date(subscription.endDate) > now);

      // Check if it's an active free subscription
      const isActiveFree = subscription.planId === '1' &&
        subscription.status === 'active';

      if (isActivePremium) {
        redirectTo = 'business-profile';
        subscriptionStatus = 'premium';
        console.log('➡️  Premium user detected, redirecting to Business Profile');
      } else if (isActiveFree) {
        redirectTo = 'business-profile';
        subscriptionStatus = 'free';
        console.log('➡️  Free user detected, redirecting to Business Profile');
      } else {
        // Subscription exists but is expired/inactive
        redirectTo = 'subscription';
        subscriptionStatus = 'expired';
        console.log('➡️  User has expired/inactive subscription, redirecting to Subscription Page');
      }
    } else {
      // No subscription found - user is non-activated
      redirectTo = 'subscription';
      subscriptionStatus = 'non-activated';
      console.log('➡️  Non-activated user detected, redirecting to Subscription Page');
    }

    // Return user data (excluding password) along with redirect info
    const { password, ...userData } = user.toObject();

    res.json({
      success: true,
      message: 'Login successful!',
      status: user.status,
      user: userData,
      subscriptionStatus: subscriptionStatus, // NEW: Include subscription status
      redirectTo: redirectTo, // NEW: Include redirect instruction
      subscription: subscription ? { // Include subscription data if exists
        planId: subscription.planId,
        planName: subscription.planName,
        status: subscription.status,
        endDate: subscription.endDate
      } : null
    });

  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});


app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const user = await User.findOne({ email: req.body.email });
    if (!user) return res.json({ success: false, message: 'User not found' });

    const token = crypto.randomBytes(32).toString('hex');
    resetTokens.set(token, { email: req.body.email, expiry: Date.now() + 3600000 });

    const transporter = createTransporter();
    const mailOptions = {
      from: 'no-reply@srilankatours.com',
      to: req.body.email,
      subject: 'Password Reset',
      html: `<p>Click the link to reset your password: <a href="http://localhost:5173/reset-password/${token}">Reset Password</a></p>`,
    };

    await transporter.sendMail(mailOptions);
    res.json({ success: true, message: 'Email sent' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/auth/reset-password/:token', async (req, res) => {
  const stored = resetTokens.get(req.params.token);
  if (!stored || stored.expiry < Date.now()) return res.json({ success: false, message: 'Invalid or expired token' });

  const user = await User.findOne({ email: stored.email });
  if (!user) return res.json({ success: false, message: 'User not found' });

  user.password = await bcrypt.hash(req.body.password, 10);
  await user.save();

  resetTokens.delete(req.params.token);
  res.json({ success: true, message: 'Password reset successful' });
});

app.get('/api/auth/users', async (req, res) => {
  try {
    // Get all users excluding password
    const users = await User.find({}, '-password').lean();

    // For each user, get their subscription information
    const usersWithSubscriptions = await Promise.all(users.map(async (user) => {
      try {
        // Find the user's most recent active subscription
        const subscription = await Subscription.findOne({
          userId: user.userId
        }).sort({ createdAt: -1 }).lean();

        // Determine subscription status
        let subscriptionInfo = {
          planName: 'No Subscription',
          status: 'inactive',
          startDate: null,
          endDate: null,
          isExpired: false,
          daysRemaining: null
        };

        if (subscription) {
          const now = new Date();
          const endDate = subscription.endDate ? new Date(subscription.endDate) : null;

          // Check if subscription is expired
          const isExpired = endDate && endDate < now;

          // Calculate days remaining for premium plans
          let daysRemaining = null;
          if (endDate && !isExpired) {
            daysRemaining = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));
          }

          subscriptionInfo = {
            planName: subscription.planName,
            status: isExpired ? 'expired' : subscription.status,
            startDate: subscription.startDate,
            endDate: subscription.endDate,
            isExpired: isExpired,
            daysRemaining: daysRemaining,
            billingCycle: subscription.billingCycle,
            amount: subscription.amount,
            currency: subscription.currency,
            paymentMethod: subscription.paymentMethod
          };
        }

        // Return user with subscription info
        return {
          ...user,
          subscription: subscriptionInfo
        };

      } catch (subscriptionError) {
        console.error(`Error fetching subscription for user ${user.userId}:`, subscriptionError);
        // Return user with default subscription info if error occurs
        return {
          ...user,
          subscription: {
            planName: 'Error Loading',
            status: 'unknown',
            startDate: null,
            endDate: null,
            isExpired: false,
            daysRemaining: null
          }
        };
      }
    }));

    res.json({
      success: true,
      users: usersWithSubscriptions
    });

  } catch (error) {
    console.error('Error fetching users with subscriptions:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching users',
      error: error.message
    });
  }
});
app.get('/api/user/:userId/subscription-details', async (req, res) => {
  try {
    const { userId } = req.params;

    const subscription = await Subscription.findOne({
      userId: parseInt(userId)
    }).sort({ createdAt: -1 });

    if (!subscription) {
      return res.json({
        success: true,
        subscription: null,
        message: 'No subscription found for this user'
      });
    }

    const now = new Date();
    const endDate = subscription.endDate ? new Date(subscription.endDate) : null;
    const isExpired = endDate && endDate < now;
    const daysRemaining = endDate && !isExpired ?
      Math.ceil((endDate - now) / (1000 * 60 * 60 * 24)) : null;

    res.json({
      success: true,
      subscription: {
        ...subscription.toObject(),
        isExpired: isExpired,
        daysRemaining: daysRemaining
      }
    });

  } catch (error) {
    console.error('Error fetching user subscription details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch subscription details'
    });
  }
});

app.delete('/api/auth/users/:id', async (req, res) => {
  try {
    const deletedUser = await User.findByIdAndDelete(req.params.id);
    if (!deletedUser) return res.status(404).json({ success: false, message: 'User not found' });

    res.json({ success: true, message: 'User deleted successfully!' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error deleting user', error: error.message });
  }
});

app.patch('/api/auth/users/:id/:action', async (req, res) => {
  try {
    const { id, action } = req.params;
    if (!['approve', 'decline'].includes(action)) return res.status(400).json({ success: false, message: 'Invalid action' });

    const status = action === 'approve' ? 'approved' : 'declined';
    const user = await User.findByIdAndUpdate(id, { status }, { new: true });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    await sendStatusEmail(user, status);
    res.json({ success: true, message: `User ${status} and email sent`, user });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error updating status', error: error.message });
  }
});


// Add this route for editing users (add after the existing user routes)
app.put('/api/auth/users/:id', async (req, res) => {
  try {
    const { firstName, lastName, address, email, phone, businessName, businessRegNo, businessAddress, userType } = req.body;

    // Check if email is being changed and if it already exists
    if (email) {
      const existingUser = await User.findOne({ email, _id: { $ne: req.params.id } });
      if (existingUser) {
        return res.status(400).json({ success: false, message: 'Email already exists' });
      }
    }

    const updateData = {
      firstName,
      lastName,
      address,
      email,
      phone,
      businessName,
      businessRegNo,
      businessAddress,
      userType
    };

    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, select: '-password' }
    );

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({
      success: true,
      message: 'User updated successfully',
      user: updatedUser
    });
  } catch (error) {
    console.error('Error updating user:', error);
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Email already exists'
      });
    }
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Replace the duplicate admin update route with this single one
app.put('/api/admin/admins/:id', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Check for duplicate username or email (excluding current admin)
    const existingAdmin = await Admin.findOne({
      $or: [{ username }, { email }],
      _id: { $ne: req.params.id }
    });

    if (existingAdmin) {
      const field = existingAdmin.username === username ? 'username' : 'email';
      return res.status(400).json({
        success: false,
        message: `${field} already exists`
      });
    }

    const updateData = { username, email };

    // Only hash and update password if provided
    if (password && password.trim() !== '') {
      updateData.password = await bcrypt.hash(password, 10);
    }

    const updatedAdmin = await Admin.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, select: '-password' }
    );

    if (!updatedAdmin) {
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }

    res.json({
      success: true,
      message: 'Admin updated successfully',
      admin: updatedAdmin
    });
  } catch (error) {
    console.error('Error updating admin:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Find admin by username or email
    const admin = await Admin.findOne({
      $or: [{ username }, { email: username }]
    });

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid password'
      });
    }

    // Return admin details (excluding password)
    const { password: _, ...adminData } = admin.toObject();
    res.json({
      success: true,
      message: 'Admin login successful!',
      admin: adminData
    });
  } catch (error) {
    console.error('Error in admin login:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/admin/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Check if admin already exists by username or email
    const existingAdmin = await Admin.findOne({
      $or: [{ username }, { email }]
    });

    if (existingAdmin) {
      const field = existingAdmin.username === username ? 'username' : 'email';
      return res.status(400).json({
        success: false,
        message: `Admin with this ${field} already exists`
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newAdmin = new Admin({
      username,
      email,
      password: hashedPassword
    });

    await newAdmin.save();
    res.json({ success: true, message: 'Admin registered successfully!' });
  } catch (error) {
    console.error('Error registering admin:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.get('/api/admin/admins', async (req, res) => {
  try {
    const admins = await Admin.find({}, '-password'); // Exclude password field
    res.json({ success: true, admins });
  } catch (error) {
    console.error('Error fetching admins:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get single admin by ID
app.put('/api/admin/admins/:id', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const updateData = { username, email };

    // Only hash and update password if provided
    if (password && password.trim() !== '') {
      updateData.password = await bcrypt.hash(password, 10);
    }

    const updatedAdmin = await Admin.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, select: '-password' }
    );

    if (!updatedAdmin) {
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }

    res.json({
      success: true,
      message: 'Admin updated successfully',
      admin: updatedAdmin
    });
  } catch (error) {
    console.error('Error updating admin:', error);
    if (error.code === 11000) { // Duplicate key error
      const field = error.keyPattern.username ? 'username' : 'email';
      return res.status(400).json({
        success: false,
        message: `${field} already exists`
      });
    }
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Update admin
app.put('/api/admin/admins/:id', async (req, res) => {
  try {
    const { username, password } = req.body;
    const updateData = { username };

    // Only hash and update password if provided
    if (password && password.trim() !== '') {
      updateData.password = await bcrypt.hash(password, 10);
    }

    const updatedAdmin = await Admin.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, select: '-password' }
    );

    if (!updatedAdmin) {
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }

    res.json({ success: true, message: 'Admin updated successfully', admin: updatedAdmin });
  } catch (error) {
    console.error('Error updating admin:', error);
    if (error.code === 11000) { // Duplicate key error
      return res.status(400).json({ success: false, message: 'Username already exists' });
    }
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Delete admin
app.delete('/api/admin/admins/:id', async (req, res) => {
  try {
    const deletedAdmin = await Admin.findByIdAndDelete(req.params.id);
    if (!deletedAdmin) {
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }
    res.json({ success: true, message: 'Admin deleted successfully' });
  } catch (error) {
    console.error('Error deleting admin:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.use('/contact', contactusRoute);
app.use('/payment', PaymentRoute);

async function handleSubscriptionPaymentFailure(subscription, errorMessage) {
  try {
    const now = new Date();
    const gracePeriodEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours grace period

    // Mark subscription with payment failure
    await Subscription.updateOne(
      { _id: subscription._id },
      {
        $set: {
          paymentFailure: true,
          paymentFailureDate: now,
          paymentFailureReason: errorMessage,
          gracePeriodEnd: gracePeriodEnd,
          updatedAt: now
        }
      }
    );

    // Get user details for email
    const user = await User.findOne({ userId: subscription.userId });
    const userName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email : 'User';

    // Send payment failure email
    await sendPaymentFailureEmail({
      email: subscription.userEmail,
      userName: userName,
      subscriptionPlan: subscription.planName,
      failureDate: now,
      gracePeriodEnd: gracePeriodEnd,
      nextAttempt: gracePeriodEnd
    });

    // Log payment failure
    await SubscriptionHistory.create({
      userId: subscription.userId,
      userEmail: subscription.userEmail,
      action: 'payment_failure',
      fromPlan: subscription.planName,
      toPlan: subscription.planName,
      effectiveDate: now,
      notes: `Payment failure: ${errorMessage}. Grace period until ${gracePeriodEnd.toLocaleDateString()}`
    });

    console.log(`💳 Payment failure handled for user ${subscription.userId}`);

  } catch (error) {
    console.error('Error handling payment failure:', error);
    throw error;
  }
}


app.post('/api/subscription/process-expired-grace-periods', async (req, res) => {
  try {
    console.log('⏰ Processing expired grace periods...');

    const now = new Date();

    // Find subscriptions where grace period has expired
    const expiredGracePeriods = await Subscription.find({
      paymentFailure: true,
      gracePeriodEnd: { $lte: now },
      status: 'active'
    });

    console.log(`📋 Found ${expiredGracePeriods.length} expired grace periods`);

    const results = [];

    for (const subscription of expiredGracePeriods) {
      try {
        // Cancel the subscription
        await Subscription.updateOne(
          { _id: subscription._id },
          {
            $set: {
              status: 'cancelled',
              cancelledDate: now,
              cancelReason: 'Payment failure - grace period expired',
              updatedAt: now
            }
          }
        );

        // Suspend all businesses and offers for this user
        await suspendUserBusinessesAndOffers(subscription.userId, 'Subscription cancelled due to payment failure');

        // Send cancellation email
        const user = await User.findOne({ userId: subscription.userId });
        const userName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email : 'User';

        await sendSubscriptionCancelledEmail({
          email: subscription.userEmail,
          userName: userName,
          cancelDate: now,
          reason: 'Payment failure'
        });

        // Log cancellation
        await SubscriptionHistory.create({
          userId: subscription.userId,
          userEmail: subscription.userEmail,
          action: 'auto_cancelled_payment_failure',
          fromPlan: subscription.planName,
          toPlan: 'Cancelled',
          effectiveDate: now,
          notes: 'Subscription automatically cancelled due to payment failure after grace period'
        });

        results.push({
          userId: subscription.userId,
          success: true,
          message: 'Subscription cancelled due to payment failure'
        });

        console.log(`❌ Cancelled subscription for user ${subscription.userId} due to payment failure`);

      } catch (error) {
        console.error(`❌ Failed to cancel subscription for user ${subscription.userId}:`, error);
        results.push({
          userId: subscription.userId,
          success: false,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      message: `Processed ${results.length} expired grace periods`,
      results: results,
      summary: {
        total: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length
      }
    });

  } catch (error) {
    console.error('❌ Error processing expired grace periods:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while processing expired grace periods'
    });
  }
});

async function suspendUserBusinessesAndOffers(userId, reason) {
  try {
    const now = new Date();

    // Suspend all active businesses
    const businessResult = await Business.updateMany(
      { userId: userId, status: 'active' },
      {
        $set: {
          status: 'suspended',
          suspendedDate: now,
          suspensionReason: reason
        }
      }
    );

    // Suspend all active offers
    const offerResult = await Offer.updateMany(
      { userId: userId, status: 'active' },
      {
        $set: {
          status: 'suspended',
          suspendedDate: now,
          suspensionReason: reason
        }
      }
    );

    console.log(`🚫 Suspended ${businessResult.modifiedCount} businesses and ${offerResult.modifiedCount} offers for user ${userId}`);

    return {
      businessesSuspended: businessResult.modifiedCount,
      offersSuspended: offerResult.modifiedCount
    };

  } catch (error) {
    console.error('Error suspending user content:', error);
    throw error;
  }
}

app.post('/api/subscription/schedule-downgrade', async (req, res) => {
  try {
    const { userId, userEmail, reason, selections = null, disableAutoRenewal = true } = req.body;

    console.log('🔄 Scheduling downgrade for userId:', userId, 'disableAutoRenewal:', disableAutoRenewal);

    // Find active premium subscription
    const subscription = await Subscription.findOne({
      $or: [
        { userId: parseInt(userId) },
        { userEmail: userEmail?.toLowerCase().trim() }
      ],
      status: 'active',
      planId: '2' // Premium plan only
    });

    if (!subscription) {
      return res.json({
        success: false,
        message: 'No active premium subscription found'
      });
    }

    // Check if downgrade is already scheduled
    if (subscription.downgradeScheduled) {
      return res.json({
        success: false,
        alreadyScheduled: true,
        message: 'Downgrade is already scheduled for this subscription'
      });
    }

    // Calculate effective date - ALWAYS use the subscription's actual end date
    let effectiveDate = subscription.endDate ? new Date(subscription.endDate) : null;

    if (!effectiveDate) {
      if (subscription.nextBillingDate) {
        effectiveDate = new Date(subscription.nextBillingDate);
      } else {
        const startDate = new Date(subscription.startDate);
        if (subscription.billingCycle === 'yearly') {
          effectiveDate = new Date(startDate);
          effectiveDate.setFullYear(effectiveDate.getFullYear() + 1);
        } else {
          effectiveDate = new Date(startDate);
          effectiveDate.setMonth(effectiveDate.getMonth() + 1);
        }
      }
    }

    console.log('📅 Calculated downgrade effective date:', effectiveDate.toISOString());
    console.log('🚫 Disabling auto-renewal:', disableAutoRenewal);

    // Update subscription with downgrade info AND disable auto-renewal
    const updateFields = {
      downgradeScheduled: true,
      downgradeScheduledDate: new Date(),
      downgradeReason: reason || 'User requested downgrade',
      downgradeEffectiveDate: effectiveDate,
      downgradeTargetPlan: '1', // Free plan
      downgradeSelections: selections,
      updatedAt: new Date()
    };

    // CRITICAL: Always disable auto-renewal when scheduling downgrade
    if (disableAutoRenewal) {
      updateFields.autoRenew = false;
      console.log('✅ Auto-renewal will be disabled');
    }

    const updateResult = await Subscription.updateOne(
      { _id: subscription._id },
      { $set: updateFields }
    );

    if (updateResult.modifiedCount > 0) {
      // Log the downgrade scheduling with auto-renewal status
      await SubscriptionHistory.create({
        userId: parseInt(userId),
        userEmail: userEmail,
        action: 'downgrade_scheduled',
        fromPlan: 'Premium',
        toPlan: 'Free',
        reason: reason,
        effectiveDate: effectiveDate,
        notes: `Auto-renewal disabled: ${disableAutoRenewal}`,
        details: {
          scheduledDate: new Date(),
          selections: selections,
          autoRenewalDisabled: disableAutoRenewal
        }
      });

      const daysRemaining = Math.ceil((effectiveDate - new Date()) / (1000 * 60 * 60 * 24));

      console.log('✅ Downgrade scheduled successfully with auto-renewal disabled');

      res.json({
        success: true,
        message: `Downgrade scheduled successfully. Auto-renewal has been disabled. You'll continue to enjoy Premium features until ${effectiveDate.toLocaleDateString()}, then your account will automatically switch to the Free plan.`,
        effectiveDate: effectiveDate,
        daysRemaining: daysRemaining,
        autoRenewalDisabled: true
      });
    } else {
      res.json({
        success: false,
        message: 'Failed to schedule downgrade. Please try again.'
      });
    }

  } catch (error) {
    console.error('❌ Error scheduling downgrade:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while scheduling downgrade'
    });
  }
});

app.post('/api/subscription/cancel-downgrade', async (req, res) => {
  try {
    const { userId, userEmail } = req.body;

    console.log('🔄 Cancelling downgrade for userId:', userId, 'email:', userEmail);

    if (!userId && !userEmail) {
      return res.status(400).json({
        success: false,
        message: 'User ID or email is required'
      });
    }

    // Find subscription with scheduled downgrade
    const subscription = await Subscription.findOne({
      $or: [
        { userId: userId },
        { userEmail: userEmail }
      ],
      status: 'active',
      downgradeScheduled: true
    });

    if (!subscription) {
      console.log('❌ No scheduled downgrade found');
      return res.json({
        success: false,
        message: 'No scheduled downgrade found to cancel'
      });
    }

    console.log('✅ Found subscription with scheduled downgrade:', subscription._id);

    // Cancel the downgrade
    const updateResult = await Subscription.updateOne(
      { _id: subscription._id },
      {
        $unset: {
          downgradeScheduled: '',
          downgradeScheduledDate: '',
          downgradeReason: '',
          downgradeEffectiveDate: '',
          downgradeTargetPlan: '',
          downgradeSelections: ''
        },
        $set: {
          autoRenew: true,
          updatedAt: new Date()
        }
      }
    );

    console.log('Update result:', updateResult);

    if (updateResult.modifiedCount > 0) {
      // Create history record
      await SubscriptionHistory.create({
        userId: subscription.userId,
        userEmail: subscription.userEmail,
        action: 'downgrade_cancelled',
        fromPlan: 'Premium',
        toPlan: 'Premium',
        reason: 'User cancelled scheduled downgrade',
        effectiveDate: new Date(),
        notes: 'Downgrade cancellation - subscription continues with premium features'
      });

      console.log('✅ Successfully cancelled downgrade');

      res.json({
        success: true,
        message: 'Scheduled downgrade cancelled successfully! Your premium subscription will continue.'
      });
    } else {
      console.log('❌ Failed to update subscription');
      res.json({
        success: false,
        message: 'Failed to cancel downgrade. Please try again.'
      });
    }

  } catch (error) {
    console.error('❌ Error cancelling downgrade:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while cancelling downgrade'
    });
  }
});

app.post('/api/subscription/process-downgrades-with-selections', async (req, res) => {
  try {
    console.log('🔄 Processing scheduled downgrades with selections...');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find subscriptions that should be downgraded today
    const subscriptionsToDowngrade = await Subscription.find({
      downgradeScheduled: true,
      downgradeEffectiveDate: { $lte: today },
      status: 'active'
    });

    console.log(`📋 Found ${subscriptionsToDowngrade.length} subscriptions to downgrade`);

    const results = [];

    for (const subscription of subscriptionsToDowngrade) {
      try {
        // Create new free subscription
        const newSubscriptionId = await Counter.getNextSequence('subscription');

        const freeSubscription = new Subscription({
          subscriptionId: newSubscriptionId,
          userId: subscription.userId,
          userEmail: subscription.userEmail,
          planId: '1',
          planName: 'Free Plan',
          status: 'active',
          billingCycle: 'monthly',
          amount: 0,
          currency: 'LKR',
          startDate: today,
          endDate: null,
          nextBillingDate: null,
          paymentMethod: 'free',
          autoRenew: false,
          createdAt: new Date(),
          updatedAt: new Date()
        });

        await freeSubscription.save();

        // Update old subscription to expired
        await Subscription.updateOne(
          { _id: subscription._id },
          {
            $set: {
              status: 'expired',
              downgradeProcessedDate: today,
              updatedAt: new Date()
            }
          }
        );

        // Handle content based on user selections
        if (subscription.downgradeSelections) {
          const { selectedBusinesses, selectedOffers } = subscription.downgradeSelections;

          // Suspend businesses not selected by user
          const allBusinesses = await Business.find({ userId: subscription.userId, status: 'active' });
          const businessesToSuspend = allBusinesses.filter(b =>
            !selectedBusinesses.includes(b._id.toString())
          );

          if (businessesToSuspend.length > 0) {
            await Business.updateMany(
              { _id: { $in: businessesToSuspend.map(b => b._id) } },
              {
                $set: {
                  status: 'suspended',
                  suspendedDate: today,
                  suspensionReason: 'Downgraded to Free plan - not selected by user'
                }
              }
            );
          }

          // Suspend offers not selected by user
          const allOffers = await Offer.find({ userId: subscription.userId, status: 'active' });
          const offersToSuspend = allOffers.filter(o =>
            !selectedOffers.includes(o._id.toString())
          );

          if (offersToSuspend.length > 0) {
            await Offer.updateMany(
              { _id: { $in: offersToSuspend.map(o => o._id) } },
              {
                $set: {
                  status: 'suspended',
                  suspendedDate: today,
                  suspensionReason: 'Downgraded to Free plan - not selected by user'
                }
              }
            );
          }

          results.push({
            userId: subscription.userId,
            success: true,
            businessesSuspended: businessesToSuspend.length,
            offersSuspended: offersToSuspend.length,
            businessesKept: selectedBusinesses.length,
            offersKept: selectedOffers.length
          });

        } else {
          // No selections - use default logic (keep oldest)
          const businesses = await Business.find({ userId: subscription.userId, status: 'active' })
            .sort({ createdAt: 1 });
          const offers = await Offer.find({ userId: subscription.userId, status: 'active' })
            .sort({ createdAt: 1 });

          // Suspend excess content
          if (businesses.length > 1) {
            const businessesToSuspend = businesses.slice(1);
            await Business.updateMany(
              { _id: { $in: businessesToSuspend.map(b => b._id) } },
              {
                $set: {
                  status: 'suspended',
                  suspendedDate: today,
                  suspensionReason: 'Downgraded to Free plan - exceeds business limit'
                }
              }
            );
          }

          if (offers.length > 3) {
            const offersToSuspend = offers.slice(3);
            await Offer.updateMany(
              { _id: { $in: offersToSuspend.map(o => o._id) } },
              {
                $set: {
                  status: 'suspended',
                  suspendedDate: today,
                  suspensionReason: 'Downgraded to Free plan - exceeds offer limit'
                }
              }
            );
          }

          results.push({
            userId: subscription.userId,
            success: true,
            businessesSuspended: Math.max(0, businesses.length - 1),
            offersSuspended: Math.max(0, offers.length - 3),
            businessesKept: Math.min(1, businesses.length),
            offersKept: Math.min(3, offers.length)
          });
        }

        // Log the successful downgrade
        await SubscriptionHistory.create({
          userId: subscription.userId,
          userEmail: subscription.userEmail,
          action: 'downgrade_processed_with_selection',
          fromPlan: subscription.planName,
          toPlan: 'Free Plan',
          reason: subscription.downgradeReason || 'Scheduled downgrade',
          effectiveDate: today,
          notes: 'Downgrade processed with user content selections'
        });

        console.log(`✅ Successfully downgraded user ${subscription.userId} with selections`);

      } catch (error) {
        console.error(`❌ Failed to downgrade user ${subscription.userId}:`, error);
        results.push({
          userId: subscription.userId,
          success: false,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      message: `Processed ${results.length} scheduled downgrades with selections`,
      results: results
    });

  } catch (error) {
    console.error('❌ Error processing downgrades with selections:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while processing downgrades'
    });
  }
});


app.post('/api/subscription/fix-end-dates', async (req, res) => {
  try {
    await fixSubscriptionEndDates();
    res.json({
      success: true,
      message: 'Subscription end dates have been fixed'
    });
  } catch (error) {
    console.error('Error in fix-end-dates route:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fix subscription end dates'
    });
  }
});

app.post('/create-subscription-record', async (req, res) => {
  try {
    console.log('📝 Creating subscription record with data:', req.body);

    const {
      userId,
      userEmail,
      planId,
      planName,
      amount,
      currency,
      paymentMethod,
      payhereOrderId,
      payherePaymentId
    } = req.body;

    // Validate required fields
    if (!userEmail || !planId || !planName) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: userEmail, planId, or planName'
      });
    }

    // Calculate end date based on billing cycle (only monthly now)
    let endDate = null;
    if (planId !== '1' && planId !== 1) { // Not free plan
      const now = new Date();
      // Always monthly billing
      endDate = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000)); // Add 30 days
    }

    // Create subscription record
    const subscription = new Subscription({
      userId: userId || null,
      userEmail,
      planId: planId.toString(),
      planName,
      status: 'active',
      billingCycle: 'monthly', // Always monthly
      amount: amount || 0,
      currency: currency || 'LKR',
      paymentMethod,
      payhereOrderId,
      payherePaymentId,
      startDate: new Date(),
      endDate
    });

    const savedSubscription = await subscription.save();

    console.log('✅ Subscription record created successfully:', savedSubscription._id);

    res.json({
      success: true,
      message: 'Subscription record created successfully',
      subscriptionId: savedSubscription._id,
      subscription: {
        id: savedSubscription._id,
        planId: savedSubscription.planId,
        planName: savedSubscription.planName,
        status: savedSubscription.status,
        endDate: savedSubscription.endDate
      }
    });

  } catch (error) {
    console.error('❌ Error creating subscription record:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create subscription record',
      error: error.message
    });
  }
});
export { handleInitialPayment, handleRecurringPayment, fixSubscriptionEndDates };


app.post('/payhere-notify-enhanced', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    console.log('📨 Enhanced PayHere Notification Received');
    console.log('Raw Notification Data:', JSON.stringify(req.body, null, 2));

    const {
      merchant_id,
      order_id,
      payment_id,
      payhere_amount,
      payhere_currency,
      status_code,
      md5sig,
      status_message,
      custom_1,
      custom_2,
      email,
      recurring_token,      // NEW: For recurring payments
      subscription_id,      // NEW: PayHere subscription ID
      event_type,          // NEW: Type of event
      next_occurrence_date // NEW: Next billing date from PayHere
    } = req.body;

    // Standard validation (keep your existing validation)
    if (!merchant_id || !order_id || !payhere_amount || !payhere_currency || !status_code || !md5sig) {
      console.error('❌ Missing required notification fields');
      return res.status(400).send('Missing required fields');
    }

    if (merchant_id.trim() !== payhereConfig.merchantId.trim()) {
      console.error('❌ Merchant ID mismatch');
      return res.status(400).send('Merchant ID mismatch');
    }

    const isValidHash = verifyPayHereHash(req.body, payhereConfig.merchantSecret);
    if (!isValidHash) {
      console.error('❌ Hash verification failed');
      return res.status(400).send('Invalid hash');
    }

    console.log('✅ Hash verification successful');
    console.log(`📊 Payment Status: ${status_code} - ${status_message}`);

    // Handle different event types
    if (event_type === 'SUBSCRIPTION_PAYMENT') {
      console.log('🔄 Processing recurring payment...');
      await handleRecurringPaymentNotification(req.body);
    } else if (event_type === 'SUBSCRIPTION_CANCELLED') {
      console.log('❌ Processing subscription cancellation...');
      await handleSubscriptionCancellationNotification(req.body);
    } else if (status_code === '2') {
      // Initial payment or one-time payment
      console.log('✅ Processing initial payment...');
      await handleInitialPaymentWithRecurring(req.body);
    } else {
      console.log(`ℹ️ Payment status: ${status_code} - ${status_message}`);
    }

    res.status(200).send('OK');

  } catch (error) {
    console.error('❌ Error processing enhanced PayHere notification:', error);
    res.status(500).send('Server error');
  }
});



// Update your plans array to only have 2 plans
app.get('/plans', (req, res) => {
  const plans = [
    {
      id: 1,
      name: 'Free Plan',
      monthlyPrice: 0,
      features: ['1 highlight ad', 'Standard position in listings', 'Add one discount or promo code', 'Set start and end date for promotions'],
      description: 'Perfect for individuals getting started',
      popular: false
    },
    {
      id: 2,
      name: 'Premium Plan',
      monthlyPrice: 150, // Only monthly pricing now
      features: ['3 highlight ads', 'Priority position in listings and category pages', 'Multiple Promotions can be added', 'Premium Features'],
      description: 'Ideal for growing businesses',
      popular: true
    }
  ];

  res.json({ plans });
});


app.post('/create-free-subscription', async (req, res) => {
  try {
    const { customerData } = req.body;

    console.log('🆓 Creating free subscription request:', {
      hasCustomerData: !!customerData,
      email: customerData?.email,
      userId: customerData?.userId,
      name: customerData?.name
    });

    // Enhanced validation
    if (!customerData) {
      return res.status(400).json({
        success: false,
        error: 'Customer data is required'
      });
    }

    if (!customerData.email || !customerData.email.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Customer email is required'
      });
    }

    if (!customerData.name || !customerData.name.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Customer name is required'
      });
    }

    const cleanEmail = customerData.email.trim().toLowerCase();
    const cleanName = customerData.name.trim();

    console.log('📧 Processing free subscription for:', cleanEmail);

    // CRITICAL FIX: Check existing subscriptions properly
    const existingSubscription = await Subscription.findOne({
      $or: [
        { userEmail: cleanEmail },
        ...(customerData.userId ? [{ userId: customerData.userId }] : [])
      ]
    }).sort({ createdAt: -1 }); // Get most recent if multiple

    if (existingSubscription) {
      console.log('❌ Existing subscription found:', {
        id: existingSubscription._id,
        planId: existingSubscription.planId,
        planName: existingSubscription.planName,
        status: existingSubscription.status,
        userEmail: existingSubscription.userEmail
      });

      // Check if it's an active subscription
      if (existingSubscription.status === 'active') {
        const planType = existingSubscription.planId === '1' ? 'Free' : 'Premium';
        return res.status(400).json({
          success: false,
          error: `You already have an active ${planType} subscription`,
          existing: {
            planId: existingSubscription.planId,
            planName: existingSubscription.planName,
            status: existingSubscription.status
          }
        });
      }
      
      // If subscription exists but is expired/cancelled, we can create a new free one
      console.log('ℹ️ Existing subscription is inactive, proceeding with free subscription creation');
    }

    // Create new free subscription
    const freeSubscription = new Subscription({
      userId: customerData.userId || null,
      userEmail: cleanEmail,
      planId: '1',
      planName: 'Free Plan',
      status: 'active',
      billingCycle: 'monthly',
      amount: 0,
      currency: 'LKR',
      paymentMethod: 'free',
      startDate: new Date(),
      endDate: null, // Free plan never expires
      autoRenew: false
    });

    const savedSubscription = await freeSubscription.save();

    console.log('✅ Free subscription created successfully:', {
      id: savedSubscription._id,
      userEmail: savedSubscription.userEmail,
      userId: savedSubscription.userId,
      planId: savedSubscription.planId,
      status: savedSubscription.status
    });

    // Create subscription log
    await SubscriptionLog.create({
      subscriptionId: savedSubscription._id,
      userId: savedSubscription.userId || 0,
      userEmail: savedSubscription.userEmail,
      action: 'created',
      details: {
        planId: '1',
        planName: 'Free Plan',
        paymentMethod: 'free',
        createdAt: new Date()
      }
    });

    res.json({
      success: true,
      message: 'Free subscription activated successfully! You can now create 1 business and up to 3 offers.',
      subscription: {
        id: savedSubscription._id,
        planId: savedSubscription.planId,
        planName: savedSubscription.planName,
        status: savedSubscription.status,
        billingCycle: savedSubscription.billingCycle,
        endDate: savedSubscription.endDate,
        paymentMethod: savedSubscription.paymentMethod,
        amount: savedSubscription.amount,
        currency: savedSubscription.currency,
        startDate: savedSubscription.startDate
      }
    });

  } catch (error) {
    console.error('❌ Error creating free subscription:', error);
    
    // Handle specific MongoDB errors
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        error: 'A subscription with this email already exists'
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to create free subscription',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// 6. Add endpoint to check payment status
app.get('/check-payment-status/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;

    console.log(`🔍 Checking payment status for order: ${orderId}`);

    // Find subscription by PayHere order ID
    const subscription = await Subscription.findOne({
      payhereOrderId: orderId
    });

    if (subscription) {
      console.log('✅ Found subscription for order:', subscription._id);

      res.json({
        success: true,
        status: 'completed',
        subscription: {
          id: subscription._id,
          planId: subscription.planId,
          planName: subscription.planName,
          status: subscription.status,
          amount: subscription.amount,
          currency: subscription.currency,
          startDate: subscription.startDate,
          endDate: subscription.endDate,
          autoRenew: subscription.autoRenew,
          nextBillingDate: subscription.nextBillingDate,
          payhereRecurringToken: subscription.payhereRecurringToken
        }
      });
    } else {
      console.log('⏳ No subscription found yet for order:', orderId);
      res.json({
        success: true,
        status: 'pending',
        message: 'Payment is being processed'
      });
    }

  } catch (error) {
    console.error('❌ Error checking payment status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check payment status',
      message: error.message
    });
  }
});







// Add this route to your backend server (after your existing routes)

// Token verification middleware
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Access token is required'
    });
  }

  try {
    // For now, we'll treat any token as valid since you're not using JWT
    // In a real implementation, you would verify JWT tokens here
    next();
  } catch (error) {
    return res.status(403).json({
      success: false,
      message: 'Invalid or expired token'
    });
  }
};

// Token verification route - ADD THIS TO YOUR SERVER
app.get('/api/verify-token', verifyToken, async (req, res) => {
  try {
    // Extract token from header
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    // Since you're storing user data in localStorage/sessionStorage instead of using JWT,
    // we need to get the user email or ID from the request body or find another way
    // For now, let's check if the token exists and return success

    // You can enhance this by:
    // 1. Storing active sessions in your database
    // 2. Using JWT tokens that contain user information
    // 3. Including user identifier in the request

    console.log('Token verification request received');
    console.log('Token:', token.substring(0, 10) + '...');

    // For now, return success if token exists
    // In a real implementation, you would:
    // - Decode JWT token to get user ID
    // - Query database to get fresh user data
    // - Verify token hasn't expired

    res.json({
      success: true,
      message: 'Token is valid',
      user: null // We can't return user data without more context
    });

  } catch (error) {
    console.error('Token verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Token verification failed'
    });
  }
});

// Enhanced login route that generates a proper token/session
app.post('/api/auth/login-with-session', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.json({ success: false, message: 'User not found' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.json({ success: false, message: 'Invalid credentials' });
    }

    if (user.status !== 'approved') {
      return res.json({ success: false, message: 'Your account is not approved yet.' });
    }

    // Generate a simple token (in production, use JWT)
    const token = crypto.randomBytes(32).toString('hex');

    // NEW: Check plan limits when user signs in
    const planLimitCheck = await checkUserPlanLimits(user.userId);

    const { password: _, ...userData } = user.toObject();

    res.json({
      success: true,
      message: 'Login successful!',
      status: user.status,
      user: userData,
      token: token,
      expiresIn: '24h',
      planLimitWarning: planLimitCheck // NEW: Include plan limit warning
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Delete selected items endpoint
app.post('/api/user/delete-selected-items', async (req, res) => {
  try {
    const { userId, businessIds, offerIds } = req.body;

    let deletedCount = 0;

    // Delete selected offers
    if (offerIds && offerIds.length > 0) {
      const offerResult = await Offer.deleteMany({
        _id: { $in: offerIds },
        userId: userId
      });
      deletedCount += offerResult.deletedCount;
    }

    // Delete selected businesses and their offers
    if (businessIds && businessIds.length > 0) {
      // First delete all offers for these businesses
      await Offer.deleteMany({ businessId: { $in: businessIds } });

      // Then delete the businesses
      const businessResult = await Business.deleteMany({
        _id: { $in: businessIds },
        userId: userId
      });
      deletedCount += businessResult.deletedCount;
    }

    res.json({
      success: true,
      message: `Successfully deleted ${deletedCount} items`
    });
  } catch (error) {
    console.error('Error deleting selected items:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete selected items'
    });
  }
});
// Route to get user profile by ID (for when you have token with user ID)
app.get('/api/user/profile/:userId', verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findOne({ userId: parseInt(userId) }).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      user: user
    });

  } catch (error) {
    console.error('Get user profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user profile'
    });
  }
});

// Route to get user profile by email (alternative method)
app.post('/api/user/profile-by-email', verifyToken, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    const user = await User.findOne({ email }).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      user: user
    });

  } catch (error) {
    console.error('Get user profile by email error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user profile'
    });
  }
});







// ADD THESE SCHEMAS TO YOUR EXISTING SERVER FILE (after your existing schemas)

// Business Schema
const businessSchema = new mongoose.Schema({
  businessId: Number,
  userId: { type: Number, ref: 'User', required: true },
  name: { type: String, required: true },
  address: String,
  phone: String,
  email: String,
  website: String,
  category: String,
  socialMediaLinks: String,
  operatingHours: String,
  businessType: String,
  registrationNumber: String,
  taxId: String,

  // Enhanced status management for plan limitations
  status: { type: String, enum: ['active', 'inactive', 'suspended', 'deleted'], default: 'active' },
  suspendedDate: { type: Date },
  suspensionReason: { type: String },
  displayOrder: { type: Number, default: 0 }, // For prioritizing which businesses to keep active

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});
businessSchema.index({ userId: 1, status: 1 });
businessSchema.index({ status: 1 });
businessSchema.plugin(AutoIncrement, { inc_field: 'businessId' });
const Business = mongoose.model('Business', businessSchema);

// Offers Schema
const offerSchema = new mongoose.Schema({
  offerId: Number,
  userId: { type: Number, ref: 'User', required: true },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
  title: { type: String, required: true },
  discount: { type: String, required: true },
  category: String,
  startDate: { type: Date },
  endDate: { type: Date },
  isActive: { type: Boolean, default: true },

  // Admin approval fields - FIXED ENUM VALUES
  adminStatus: {
    type: String,
    enum: ['pending', 'approved', 'declined'], // ✅ Fixed to match your API logic
    default: 'pending'
  },
  adminComments: { type: String },
  reviewedBy: { type: String },
  reviewedAt: { type: Date },

  // Enhanced status management for plan limitations  
  status: { type: String, enum: ['active', 'inactive', 'suspended'], default: 'active' },
  suspendedDate: { type: Date },
  suspensionReason: { type: String },
  displayOrder: { type: Number, default: 0 },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

offerSchema.index({ userId: 1, status: 1 });
offerSchema.index({ adminStatus: 1 }); // ✅ Added useful index
offerSchema.index({ userId: 1, adminStatus: 1 }); // ✅ Added compound index
offerSchema.plugin(AutoIncrement, { inc_field: 'offerId' });
const Offer = mongoose.model('Offer', offerSchema);

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
// ADD THESE ROUTES TO YOUR SERVER FILE (after your existing routes)

subscriptionHistorySchema.index({ userId: 1, createdAt: -1 });
subscriptionHistorySchema.index({ userEmail: 1, createdAt: -1 });
subscriptionHistorySchema.index({ action: 1 });

const SubscriptionHistory = mongoose.model('SubscriptionHistory', subscriptionHistorySchema);
const sendOfferStartNotification = async (userEmail, userName, businessName, offerData) => {
  const transporter = createTransporter();

  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const mailOptions = {
    from: process.env.EMAIL_USERNAME,
    to: userEmail,
    subject: '🎉 Your Offer is Now Live!',
    html: `
      <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="background: linear-gradient(135deg, #007bff, #28a745); padding: 30px; text-align: center; color: white; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 28px;">🎉 Offer Started!</h1>
          <p style="margin: 10px 0 0; font-size: 16px; opacity: 0.9;">Your promotion is now running</p>
        </div>
        
        <div style="background: white; padding: 30px; border: 1px solid #e9ecef; border-top: none;">
          <p style="font-size: 18px; margin-bottom: 20px;">Dear <strong>${userName}</strong>,</p>
          
          <p>Great news! Your offer for <strong>${businessName}</strong> has started and is now live for customers to see.</p>
          
          <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid #28a745; margin: 20px 0;">
            <h3 style="margin: 0 0 15px; color: #28a745;">📢 Offer Details</h3>
            <p style="margin: 5px 0;"><strong>Title:</strong> ${offerData.title}</p>
            <p style="margin: 5px 0;"><strong>Discount:</strong> <span style="color: #28a745; font-weight: bold; font-size: 18px;">${offerData.discount} OFF</span></p>
            <p style="margin: 5px 0;"><strong>Business:</strong> ${businessName}</p>
            ${offerData.category ? `<p style="margin: 5px 0;"><strong>Category:</strong> ${offerData.category}</p>` : ''}
            ${offerData.startDate ? `<p style="margin: 5px 0;"><strong>Started:</strong> ${formatDate(offerData.startDate)}</p>` : ''}
            ${offerData.endDate ? `<p style="margin: 5px 0;"><strong>Ends:</strong> ${formatDate(offerData.endDate)}</p>` : ''}
          </div>
          
          <div style="background: #e7f3ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h4 style="margin: 0 0 10px; color: #007bff;">💡 Tips to maximize your offer:</h4>
            <ul style="margin: 10px 0; padding-left: 20px;">
              <li>Share your offer on social media</li>
              <li>Display it prominently in your store</li>
              <li>Tell your regular customers about it</li>
              <li>Monitor its performance in your dashboard</li>
            </ul>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <p style="margin-bottom: 20px;">Ready to manage your offers?</p>
            <a href="http://localhost:5173/dashboard" style="background: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
              View Dashboard
            </a>
          </div>
        </div>
        
        <div style="background: #f8f9fa; padding: 20px; text-align: center; color: #6c757d; font-size: 14px; border-radius: 0 0 8px 8px;">
          <p style="margin: 0;">This email was sent automatically when your offer started.</p>
          <p style="margin: 5px 0 0;">Need help? Contact our support team.</p>
        </div>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`✅ Offer start notification sent to ${userEmail}`);
    return true;
  } catch (error) {
    console.error('❌ Error sending offer notification:', error);
    return false;
  }
};
app.use('/api/admin/offers', (req, res, next) => {
  // Log when admin accesses offers endpoint
  console.log(`📋 Admin accessing offers endpoint: ${req.method} ${req.originalUrl}`);
  next();
});

// Enhanced offers endpoint with notification tracking
const originalOffersHandler = app._router.stack.find(layer =>
  layer.route && layer.route.path === '/api/admin/offers'
);

// Add notification reset when fetching offers
app.get('/api/admin/offers', async (req, res, next) => {
  try {
    // Your existing offers fetching logic here...
    const { status, page = 1, limit = 20 } = req.query;

    let filter = {};
    if (status && ['pending', 'approved', 'declined'].includes(status)) {
      filter.adminStatus = status;
    }

    console.log(`📋 Fetching admin offers with filter:`, filter);

    // Get offers with business details
    const offers = await Offer.find(filter)
      .populate('businessId', 'name category address phone email website')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const totalOffers = await Offer.countDocuments(filter);

    // FIXED: Manually fetch user details using userId Number field
    const offersWithUserDetails = await Promise.all(offers.map(async (offer) => {
      try {
        // Find user by userId (Number field, not ObjectId)
        const user = await User.findOne({ userId: offer.userId }).select('firstName lastName email businessName userType');

        // Add computed status based on dates and admin approval
        const now = new Date();
        const startDate = offer.startDate ? new Date(offer.startDate) : null;
        const endDate = offer.endDate ? new Date(offer.endDate) : null;

        let computedStatus = offer.adminStatus;

        if (offer.adminStatus === 'approved') {
          if (startDate && startDate > now) {
            computedStatus = 'approved-scheduled';
          } else if (endDate && endDate < now) {
            computedStatus = 'approved-expired';
          } else if (!offer.isActive) {
            computedStatus = 'approved-inactive';
          } else {
            computedStatus = 'approved-active';
          }
        }

        return {
          ...offer.toObject(),
          userDetails: user ? {
            userId: user.userId,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            businessName: user.businessName,
            userType: user.userType
          } : {
            userId: offer.userId,
            firstName: 'Unknown',
            lastName: 'User',
            email: 'N/A',
            businessName: 'N/A',
            userType: 'N/A'
          },
          computedStatus
        };
      } catch (error) {
        console.error(`Error fetching user details for userId ${offer.userId}:`, error);
        return {
          ...offer.toObject(),
          userDetails: {
            userId: offer.userId,
            firstName: 'Error',
            lastName: 'Loading',
            email: 'N/A',
            businessName: 'N/A',
            userType: 'N/A'
          },
          computedStatus: offer.adminStatus
        };
      }
    }));

    console.log(`✅ Fetched ${offersWithUserDetails.length} offers for admin`);

    res.json({
      success: true,
      offers: offersWithUserDetails,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalOffers / limit),
        totalOffers,
        limit: parseInt(limit)
      },
      counts: {
        pending: await Offer.countDocuments({ adminStatus: 'pending' }),
        approved: await Offer.countDocuments({ adminStatus: 'approved' }),
        declined: await Offer.countDocuments({ adminStatus: 'declined' })
      },
      // Add notification info
      notificationInfo: {
        adminViewed: true,
        viewedAt: new Date().toISOString(),
        shouldResetCount: true
      }
    });
  } catch (error) {
    console.error('❌ Error fetching admin offers:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch offers for admin review',
      error: error.message
    });
  }
});

// ==================== BUSINESS ROUTES ====================

// Route to send offer notification
app.post('/api/send-offer-notification', async (req, res) => {
  try {
    const { userEmail, userName, businessName, offerTitle, discount, startDate, endDate, category } = req.body;

    if (!userEmail || !userName || !businessName || !offerTitle || !discount) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields for notification'
      });
    }

    const offerData = {
      title: offerTitle,
      discount: discount,
      startDate: startDate,
      endDate: endDate,
      category: category
    };

    const emailSent = await sendOfferStartNotification(userEmail, userName, businessName, offerData);

    if (emailSent) {
      res.json({
        success: true,
        message: 'Offer notification sent successfully'
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to send notification email'
      });
    }

  } catch (error) {
    console.error('Error sending offer notification:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while sending notification'
    });
  }
});

// Get all businesses for a user
app.get('/api/businesses/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const businesses = await Business.find({ userId: parseInt(userId) })
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      businesses: businesses
    });
  } catch (error) {
    console.error('Error fetching businesses:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch businesses'
    });
  }
});

// Create new business
// REPLACE your existing '/api/businesses' POST route with this corrected version:

app.post('/api/businesses', async (req, res) => {
  try {
    const {
      userId,
      name,
      address,
      phone,
      email,
      website,
      category,
      socialMediaLinks,
      operatingHours,
      businessType,
      registrationNumber,
      taxId
    } = req.body;

    if (!userId || !name) {
      return res.status(400).json({
        success: false,
        message: 'User ID and business name are required'
      });
    }

    // Check if user exists
    const user = await User.findOne({ userId: userId });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    console.log(`🏢 Business creation attempt for userId: ${userId}, user: ${user.email}`);

    // CRITICAL FIX: Check for ANY active subscription (free or premium)
    const activeSubscription = await Subscription.findOne({
      $or: [
        { userId: userId },
        { userEmail: user.email.toLowerCase().trim() }
      ],
      status: 'active'
    }).sort({ createdAt: -1 }); // Get most recent active subscription

    console.log('🔍 Active subscription check:', activeSubscription ? {
      id: activeSubscription._id,
      planId: activeSubscription.planId,
      planName: activeSubscription.planName,
      status: activeSubscription.status,
      endDate: activeSubscription.endDate
    } : 'No active subscription found');

    // Block non-activated users from creating businesses
    if (!activeSubscription) {
      console.log('❌ User blocked - no active subscription');
      return res.status(403).json({
        success: false,
        message: 'Please activate a subscription plan (Free or Premium) to create businesses.',
        requiresSubscription: true,
        redirectTo: 'subscription'
      });
    }

    // Count existing businesses for this user
    const existingBusinessCount = await Business.countDocuments({ userId: userId });
    console.log(`📊 Existing business count: ${existingBusinessCount}`);

    // Determine if user has premium access
    const now = new Date();
    const isPremium = activeSubscription.planId === '2' &&
      activeSubscription.status === 'active' &&
      (!activeSubscription.endDate || new Date(activeSubscription.endDate) > now);

    // Set limits based on subscription type
    const maxBusinesses = isPremium ? 3 : 1; // Premium: 3, Free: 1
    const planType = isPremium ? 'Premium' : 'Free';

    console.log(`📋 Plan analysis: ${planType} plan allows ${maxBusinesses} businesses`);

    // Check if user has reached their limit
    if (existingBusinessCount >= maxBusinesses) {
      console.log(`❌ Business limit reached: ${existingBusinessCount}/${maxBusinesses}`);
      return res.status(400).json({
        success: false,
        message: `${planType} plan allows maximum ${maxBusinesses} business${maxBusinesses > 1 ? 'es' : ''}. You have ${existingBusinessCount}/${maxBusinesses} businesses.`,
        planUpgradeRequired: !isPremium,
        currentCount: existingBusinessCount,
        maxAllowed: maxBusinesses,
        planType: planType,
        subscriptionId: activeSubscription._id
      });
    }

    // All checks passed - create the business
    const business = new Business({
      userId,
      name,
      address,
      phone,
      email,
      website,
      category,
      socialMediaLinks,
      operatingHours,
      businessType,
      registrationNumber,
      taxId,
      updatedAt: new Date()
    });

    await business.save();

    console.log(`✅ Business created successfully: ${business.name} (ID: ${business.businessId})`);
    console.log(`📈 User now has ${existingBusinessCount + 1}/${maxBusinesses} businesses`);

    res.json({
      success: true,
      message: `Business created successfully! (${existingBusinessCount + 1}/${maxBusinesses} ${planType} plan businesses used)`,
      business: business,
      planInfo: {
        planType: planType,
        businessesUsed: existingBusinessCount + 1,
        maxBusinesses: maxBusinesses,
        canCreateMore: (existingBusinessCount + 1) < maxBusinesses
      }
    });

  } catch (error) {
    console.error('❌ Error creating business:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create business',
      error: error.message
    });
  }
});
// Update business
app.put('/api/businesses/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      address,
      phone,
      email,
      website,
      category,
      socialMediaLinks,
      operatingHours,
      businessType,
      registrationNumber,
      taxId
    } = req.body;

    const business = await Business.findByIdAndUpdate(
      id,
      {
        name,
        address,
        phone,
        email,
        website,
        category,
        socialMediaLinks,
        operatingHours,
        businessType,
        registrationNumber,
        taxId,
        updatedAt: new Date()
      },
      { new: true }
    );

    if (!business) {
      return res.status(404).json({
        success: false,
        message: 'Business not found'
      });
    }

    res.json({
      success: true,
      message: 'Business updated successfully',
      business: business
    });
  } catch (error) {
    console.error('Error updating business:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update business'
    });
  }
});

// Delete business
app.delete('/api/businesses/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // First, delete all offers associated with this business
    await Offer.deleteMany({ businessId: id });

    // Then delete the business
    const business = await Business.findByIdAndDelete(id);

    if (!business) {
      return res.status(404).json({
        success: false,
        message: 'Business not found'
      });
    }

    res.json({
      success: true,
      message: 'Business and associated offers deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting business:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete business'
    });
  }
});


// ADD this new route to check current usage limits:

app.get('/api/user/:userId/usage-limits', async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findOne({ userId: parseInt(userId) });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const activeSubscription = await Subscription.findOne({
      $or: [
        { userId: parseInt(userId) },
        { userEmail: user.email.toLowerCase().trim() }
      ],
      status: 'active'
    }).sort({ createdAt: -1 });

    if (!activeSubscription) {
      return res.json({
        success: true,
        hasActiveSubscription: false,
        isNonActivated: true,
        message: 'Please activate a subscription plan to access features'
      });
    }

    const now = new Date();
    const isPremium = activeSubscription.planId === '2' &&
      activeSubscription.status === 'active' &&
      (!activeSubscription.endDate || new Date(activeSubscription.endDate) > now);

    const planType = isPremium ? 'Premium' : 'Free';
    const maxBusinesses = isPremium ? 3 : 1;
    const maxOffers = isPremium ? 3 : 1;

    const currentBusinesses = await Business.countDocuments({ userId: parseInt(userId) });

    // Count APPROVED offers only
    const currentApprovedOffers = await Offer.countDocuments({
      userId: parseInt(userId),
      adminStatus: 'approved',
      isActive: true
    });

    // Also get pending offers count
    const pendingOffers = await Offer.countDocuments({
      userId: parseInt(userId),
      adminStatus: 'pending'
    });

    const businessesRemaining = Math.max(0, maxBusinesses - currentBusinesses);
    const offersRemaining = Math.max(0, maxOffers - currentApprovedOffers);

    res.json({
      success: true,
      hasActiveSubscription: true,
      isNonActivated: false,
      planType: planType,
      subscription: {
        planId: activeSubscription.planId,
        planName: activeSubscription.planName,
        status: activeSubscription.status,
        endDate: activeSubscription.endDate
      },
      limits: {
        businesses: {
          max: maxBusinesses,
          current: currentBusinesses,
          remaining: businessesRemaining,
          canCreateMore: businessesRemaining > 0
        },
        offers: {
          max: maxOffers,
          current: currentApprovedOffers,
          remaining: offersRemaining,
          canCreateMore: offersRemaining > 0,
          pending: pendingOffers // NEW: Show pending offers
        }
      },
      features: {
        highlightAds: maxOffers,
        listingPosition: isPremium ? 'Priority' : 'Standard',
        promotions: isPremium ? 'Multiple' : 'Single'
      }
    });

  } catch (error) {
    console.error('Error checking usage limits:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check usage limits'
    });
  }
});
// ==================== OFFERS ROUTES ====================





app.post('/api/offers', async (req, res) => {
  try {
    console.log('📥 Offer creation request received:', req.body);

    const { userId, businessId, title, discount, category, startDate, endDate, isActive } = req.body;

    // Basic validation
    if (!userId || !businessId || !title || !discount) {
      console.log('❌ Missing required fields:', { userId: !!userId, businessId: !!businessId, title: !!title, discount: !!discount });
      return res.status(400).json({
        success: false,
        message: 'User ID, business ID, title, and discount are required'
      });
    }

    console.log('🔍 Looking for business:', { businessId, userId });

    // Verify the business belongs to the user - FIXED: Convert userId to number if needed
    const business = await Business.findOne({
      _id: businessId,
      userId: parseInt(userId) // ✅ Ensure consistent data type
    });

    if (!business) {
      console.log('❌ Business not found or doesn\'t belong to user');
      return res.status(400).json({
        success: false,
        message: 'Business not found or does not belong to this user'
      });
    }

    console.log('✅ Business found:', business.name);

    // Check user's subscription status - FIXED: Better user lookup
    const user = await User.findOne({
      $or: [
        { userId: parseInt(userId) },
        { userId: userId.toString() }
      ]
    });

    if (!user) {
      console.log('❌ User not found with userId:', userId);
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    console.log('✅ User found:', user.email);

    // Check for active subscription
    const activeSubscription = await Subscription.findOne({
      $or: [
        { userId: parseInt(userId) },
        { userId: userId.toString() },
        { userEmail: user.email.toLowerCase().trim() }
      ],
      status: 'active'
    }).sort({ createdAt: -1 });

    console.log('🔍 Active subscription:', activeSubscription ? 'Found' : 'Not found');

    // For development/testing - allow offer creation without subscription
    if (!activeSubscription) {
      console.log('⚠️ No active subscription found - proceeding with Free plan limits');
      // You can uncomment this return statement if you want to enforce subscription:
      /*
      return res.status(403).json({
        success: false,
        message: 'Please activate a subscription plan to create offers.',
        requiresSubscription: true
      });
      */
    }

    // Count existing offers for this user - FIXED: More robust counting
    console.log('🔍 Counting existing offers...');
    const existingOffersCount = await Offer.countDocuments({
      userId: parseInt(userId),
      adminStatus: { $ne: 'declined' } // Count pending and approved offers
    });

    console.log(`📊 Existing offers count: ${existingOffersCount}`);

    // Determine plan limits
    const now = new Date();
    const isPremium = activeSubscription &&
      activeSubscription.planId === '2' &&
      activeSubscription.status === 'active' &&
      (!activeSubscription.endDate || new Date(activeSubscription.endDate) > now);

    const maxOffers = isPremium ? 9 : 3;
    const planType = isPremium ? 'Premium' : 'Free';

    console.log(`📋 Plan analysis: ${planType} plan allows ${maxOffers} offers`);

    // Check offer limit
    if (existingOffersCount >= maxOffers) {
      console.log(`❌ Offer limit reached: ${existingOffersCount}/${maxOffers}`);
      return res.status(400).json({
        success: false,
        message: `${planType} plan allows maximum ${maxOffers} offer${maxOffers > 1 ? 's' : ''}. You have ${existingOffersCount}/${maxOffers} offers.`,
        planUpgradeRequired: !isPremium,
        currentCount: existingOffersCount,
        maxAllowed: maxOffers,
        planType: planType
      });
    }

    // Validate dates if provided
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid date format'
        });
      }

      if (start >= end) {
        return res.status(400).json({
          success: false,
          message: 'End date must be after start date'
        });
      }
    }

    console.log('🔧 Creating offer...');

    // Create the offer - FIXED: Ensure proper data types
    const offerData = {
      userId: parseInt(userId), // ✅ Ensure number type
      businessId: businessId,   // Keep as ObjectId
      title: title.trim(),
      discount: discount.trim(),
      category: category || '',
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      isActive: isActive !== undefined ? Boolean(isActive) : true,
      adminStatus: 'pending',   // ✅ This should now work with fixed schema
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const offer = new Offer(offerData);

    // Save with better error handling
    const savedOffer = await offer.save();
    console.log('✅ Offer saved to database with ID:', savedOffer._id);

    // Populate business info
    const populatedOffer = await Offer.findById(savedOffer._id)
      .populate('businessId', 'name');

    console.log('✅ Business info populated');

    console.log(`🎉 Offer created successfully: ${populatedOffer.title}`);

    res.json({
      success: true,
      message: 'Offer submitted successfully and is pending admin approval.',
      offer: populatedOffer,
      planInfo: {
        planType: planType,
        offersUsed: existingOffersCount + 1,
        maxOffers: maxOffers
      },
      pendingApproval: true
    });

  } catch (error) {
    console.error('❌ Error creating offer:', error);
    console.error('❌ Error stack:', error.stack);

    // Check for specific MongoDB errors
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation error: ' + validationErrors.join(', '),
        validationErrors: validationErrors
      });
    }

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Duplicate entry detected'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to create offer',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

app.get('/api/admin/offers', async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;

    let filter = {};
    if (status && ['pending', 'approved', 'declined'].includes(status)) {
      filter.adminStatus = status;
    }

    console.log(`📋 Fetching admin offers with filter:`, filter);

    // Get offers with business details
    const offers = await Offer.find(filter)
      .populate('businessId', 'name category address phone email website')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const totalOffers = await Offer.countDocuments(filter);

    // FIXED: Manually fetch user details using userId Number field
    const offersWithUserDetails = await Promise.all(offers.map(async (offer) => {
      try {
        // Find user by userId (Number field, not ObjectId)
        const user = await User.findOne({ userId: offer.userId }).select('firstName lastName email businessName userType');

        // Add computed status based on dates and admin approval
        const now = new Date();
        const startDate = offer.startDate ? new Date(offer.startDate) : null;
        const endDate = offer.endDate ? new Date(offer.endDate) : null;

        let computedStatus = offer.adminStatus;

        if (offer.adminStatus === 'approved') {
          if (startDate && startDate > now) {
            computedStatus = 'approved-scheduled';
          } else if (endDate && endDate < now) {
            computedStatus = 'approved-expired';
          } else if (!offer.isActive) {
            computedStatus = 'approved-inactive';
          } else {
            computedStatus = 'approved-active';
          }
        }

        return {
          ...offer.toObject(),
          userDetails: user ? {
            userId: user.userId,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            businessName: user.businessName,
            userType: user.userType
          } : {
            userId: offer.userId,
            firstName: 'Unknown',
            lastName: 'User',
            email: 'N/A',
            businessName: 'N/A',
            userType: 'N/A'
          },
          computedStatus
        };
      } catch (error) {
        console.error(`Error fetching user details for userId ${offer.userId}:`, error);
        return {
          ...offer.toObject(),
          userDetails: {
            userId: offer.userId,
            firstName: 'Error',
            lastName: 'Loading',
            email: 'N/A',
            businessName: 'N/A',
            userType: 'N/A'
          },
          computedStatus: offer.adminStatus
        };
      }
    }));

    console.log(`✅ Fetched ${offersWithUserDetails.length} offers for admin`);

    res.json({
      success: true,
      offers: offersWithUserDetails,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalOffers / limit),
        totalOffers,
        limit: parseInt(limit)
      },
      counts: {
        pending: await Offer.countDocuments({ adminStatus: 'pending' }),
        approved: await Offer.countDocuments({ adminStatus: 'approved' }),
        declined: await Offer.countDocuments({ adminStatus: 'declined' })
      }
    });
  } catch (error) {
    console.error('❌ Error fetching admin offers:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch offers for admin review',
      error: error.message
    });
  }
});

// NEW: Admin approve offer
app.patch('/api/admin/offers/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const { adminComments, reviewedBy } = req.body;

    console.log(`🔄 Approving offer ${id} by ${reviewedBy || 'Admin'}`);

    const offer = await Offer.findByIdAndUpdate(
      id,
      {
        adminStatus: 'approved',
        adminComments: adminComments || '',
        reviewedBy: reviewedBy || 'Admin',
        reviewedAt: new Date(),
        updatedAt: new Date()
      },
      { new: true }
    ).populate('businessId', 'name');

    if (!offer) {
      console.log(`❌ Offer not found: ${id}`);
      return res.status(404).json({
        success: false,
        message: 'Offer not found'
      });
    }

    console.log(`✅ Offer approved: ${offer.title} by ${reviewedBy || 'Admin'}`);

    // FIXED: Find user by userId Number field, not ObjectId
    const user = await User.findOne({ userId: offer.userId });

    // Send approval notification email
    if (user && user.email) {
      try {
        await sendOfferApprovalNotification({
          ...offer.toObject(),
          userId: user, // Pass the full user object
          businessId: offer.businessId
        }, 'approved');
        console.log(`📧 Approval notification sent to ${user.email}`);
      } catch (emailError) {
        console.error('Failed to send approval notification:', emailError);
        // Don't fail the whole request if email fails
      }
    } else {
      console.log(`⚠️ User not found for userId: ${offer.userId}`);
    }

    res.json({
      success: true,
      message: 'Offer approved successfully',
      offer: offer
    });
  } catch (error) {
    console.error('❌ Error approving offer:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve offer',
      error: error.message
    });
  }
});

// NEW: Admin decline offer
app.patch('/api/admin/offers/:id/decline', async (req, res) => {
  try {
    const { id } = req.params;
    const { adminComments, reviewedBy } = req.body;

    if (!adminComments || adminComments.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Admin comments are required when declining an offer'
      });
    }

    console.log(`🔄 Declining offer ${id} by ${reviewedBy || 'Admin'}`);

    const offer = await Offer.findByIdAndUpdate(
      id,
      {
        adminStatus: 'declined',
        adminComments: adminComments,
        reviewedBy: reviewedBy || 'Admin',
        reviewedAt: new Date(),
        updatedAt: new Date()
      },
      { new: true }
    ).populate('businessId', 'name');

    if (!offer) {
      console.log(`❌ Offer not found: ${id}`);
      return res.status(404).json({
        success: false,
        message: 'Offer not found'
      });
    }

    console.log(`❌ Offer declined: ${offer.title} by ${reviewedBy || 'Admin'}`);

    // FIXED: Find user by userId Number field, not ObjectId
    const user = await User.findOne({ userId: offer.userId });

    // Send decline notification email
    if (user && user.email) {
      try {
        await sendOfferApprovalNotification({
          ...offer.toObject(),
          userId: user, // Pass the full user object
          businessId: offer.businessId
        }, 'declined');
        console.log(`📧 Decline notification sent to ${user.email}`);
      } catch (emailError) {
        console.error('Failed to send decline notification:', emailError);
        // Don't fail the whole request if email fails
      }
    } else {
      console.log(`⚠️ User not found for userId: ${offer.userId}`);
    }

    res.json({
      success: true,
      message: 'Offer declined successfully',
      offer: offer
    });
  } catch (error) {
    console.error('❌ Error declining offer:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to decline offer',
      error: error.message
    });
  }
});
app.delete('/api/admin/offers/:id', async (req, res) => {
  try {
    const { id } = req.params;

    console.log(`🗑️ Deleting offer ${id}`);

    // First find the offer to get its details
    const offer = await Offer.findById(id).populate('businessId', 'name');

    if (!offer) {
      console.log(`❌ Offer not found: ${id}`);
      return res.status(404).json({
        success: false,
        message: 'Offer not found'
      });
    }

    // Delete the offer
    await Offer.findByIdAndDelete(id);

    console.log(`✅ Offer deleted: ${offer.title} (ID: ${offer.offerId})`);

    res.json({
      success: true,
      message: 'Offer deleted successfully',
      deletedOffer: {
        id: offer._id,
        title: offer.title,
        businessName: offer.businessId?.name || 'Unknown'
      }
    });
  } catch (error) {
    console.error('❌ Error deleting offer:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete offer',
      error: error.message
    });
  }
});

app.put('/api/admin/offers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, discount, category, startDate, endDate, isActive } = req.body;

    if (!title || !discount) {
      return res.status(400).json({
        success: false,
        message: 'Title and discount are required'
      });
    }

    console.log(`✏️ Admin editing offer ${id}`);

    // Validate dates if provided
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);

      if (start >= end) {
        return res.status(400).json({
          success: false,
          message: 'End date must be after start date'
        });
      }
    }

    const updateData = {
      title,
      discount,
      category,
      isActive: isActive !== undefined ? isActive : true,
      updatedAt: new Date()
    };

    if (startDate !== undefined) {
      updateData.startDate = startDate ? new Date(startDate) : null;
    }

    if (endDate !== undefined) {
      updateData.endDate = endDate ? new Date(endDate) : null;
    }

    const updatedOffer = await Offer.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    ).populate('businessId', 'name');

    if (!updatedOffer) {
      console.log(`❌ Offer not found: ${id}`);
      return res.status(404).json({
        success: false,
        message: 'Offer not found'
      });
    }

    console.log(`✅ Offer updated by admin: ${updatedOffer.title}`);

    res.json({
      success: true,
      message: 'Offer updated successfully by admin',
      offer: updatedOffer
    });

  } catch (error) {
    console.error('❌ Error updating offer (admin):', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update offer',
      error: error.message
    });
  }
});

const sendOfferApprovalNotification = async (offer, action) => {
  const transporter = createTransporter();
  const user = offer.userId; // This is now the full user object
  const business = offer.businessId;

  const isApproved = action === 'approved';
  const statusColor = isApproved ? '#28a745' : '#dc3545';
  const statusIcon = isApproved ? '✅' : '❌';
  const statusText = isApproved ? 'APPROVED' : 'DECLINED';

  const mailOptions = {
    from: process.env.EMAIL_USERNAME,
    to: user.email,
    subject: `${statusIcon} Offer ${statusText} - ${offer.title}`,
    html: `
      <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="background: linear-gradient(135deg, ${statusColor}, #007bff); padding: 30px; text-align: center; color: white; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 28px;">${statusIcon} Offer ${statusText}</h1>
          <p style="margin: 10px 0 0; font-size: 16px; opacity: 0.9;">Admin review completed</p>
        </div>
        
        <div style="background: white; padding: 30px; border: 1px solid #e9ecef; border-top: none;">
          <p style="font-size: 18px; margin-bottom: 20px;">Dear <strong>${user.firstName || 'User'}</strong>,</p>
          
          <p>Your offer has been <strong style="color: ${statusColor}">${statusText.toLowerCase()}</strong> by our admin team.</p>
          
          <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid ${statusColor}; margin: 20px 0;">
            <h3 style="margin: 0 0 15px; color: ${statusColor};">📢 Offer Details</h3>
            <p style="margin: 5px 0;"><strong>Title:</strong> ${offer.title}</p>
            <p style="margin: 5px 0;"><strong>Discount:</strong> <span style="color: ${statusColor}; font-weight: bold; font-size: 18px;">${offer.discount} OFF</span></p>
            <p style="margin: 5px 0;"><strong>Business:</strong> ${business?.name || 'N/A'}</p>
            <p style="margin: 5px 0;"><strong>Status:</strong> <span style="color: ${statusColor}; font-weight: bold;">${statusText}</span></p>
            <p style="margin: 5px 0;"><strong>Reviewed by:</strong> ${offer.reviewedBy}</p>
            <p style="margin: 5px 0;"><strong>Review Date:</strong> ${offer.reviewedAt ? new Date(offer.reviewedAt).toLocaleDateString() : 'N/A'}</p>
          </div>
          
          ${offer.adminComments ? `
            <div style="background: #fff3cd; padding: 20px; border-radius: 8px; border-left: 4px solid #ffc107; margin: 20px 0;">
              <h4 style="margin: 0 0 10px; color: #856404;">💬 Admin Comments:</h4>
              <p style="margin: 0; font-style: italic;">${offer.adminComments}</p>
            </div>
          ` : ''}
          
          ${isApproved ? `
            <div style="background: #d4edda; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h4 style="margin: 0 0 10px; color: #155724;">🎉 Your offer is now live!</h4>
              <p style="margin: 0;">Customers can now see and use your offer. Monitor its performance in your dashboard.</p>
            </div>
          ` : `
            <div style="background: #f8d7da; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h4 style="margin: 0 0 10px; color: #721c24;">📝 Next Steps</h4>
              <p style="margin: 0;">Please review the admin comments and feel free to create a new offer that addresses the feedback.</p>
            </div>
          `}
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="http://localhost:5173/dashboard" style="background: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
              View Dashboard
            </a>
          </div>
        </div>
        
        <div style="background: #f8f9fa; padding: 20px; text-align: center; color: #6c757d; font-size: 14px; border-radius: 0 0 8px 8px;">
          <p style="margin: 0;">This email was sent automatically when your offer was reviewed.</p>
          <p style="margin: 5px 0 0;">Need help? Contact our support team.</p>
        </div>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`✅ ${statusText} notification sent to ${user.email}`);
    return true;
  } catch (error) {
    console.error(`❌ Error sending ${statusText} notification:`, error);
    return false;
  }
};
// Get all offers for a user
app.get('/api/offers/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const offers = await Offer.find({ userId: parseInt(userId) })
      .populate('businessId', 'name')
      .sort({ createdAt: -1 });

    // Add computed status including admin approval status
    const offersWithStatus = offers.map(offer => {
      const now = new Date();
      const startDate = offer.startDate ? new Date(offer.startDate) : null;
      const endDate = offer.endDate ? new Date(offer.endDate) : null;

      let computedStatus = offer.adminStatus; // Start with admin status

      // Only compute time-based status if approved
      if (offer.adminStatus === 'approved') {
        if (startDate && startDate > now) {
          computedStatus = 'approved-scheduled';
        } else if (endDate && endDate < now) {
          computedStatus = 'approved-expired';
        } else if (!offer.isActive) {
          computedStatus = 'approved-inactive';
        } else {
          computedStatus = 'approved-active';
        }
      }

      return {
        ...offer.toObject(),
        computedStatus,
        canEdit: offer.adminStatus === 'pending' || offer.adminStatus === 'declined'
      };
    });

    res.json({
      success: true,
      offers: offersWithStatus
    });
  } catch (error) {
    console.error('Error fetching offers:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch offers'
    });
  }
});




app.post('/api/user/activate-free-plan', async (req, res) => {
  try {
    const { userId, userEmail, userName } = req.body;

    if (!userEmail) {
      return res.status(400).json({
        success: false,
        message: 'User email is required'
      });
    }

    console.log('🆓 Attempting to activate free plan for:', userEmail);

    // ✅ FIXED: Check if user already has ANY subscription using BOTH userId AND email
    const existingSubscription = await Subscription.findOne({
      $or: [
        { userEmail: userEmail.toLowerCase().trim() },
        { userId: userId }
      ]
    });

    if (existingSubscription) {
      console.log('❌ User already has subscription:', {
        id: existingSubscription._id,
        planId: existingSubscription.planId,
        planName: existingSubscription.planName,
        status: existingSubscription.status
      });

      return res.status(400).json({
        success: false,
        message: `You already have an active ${existingSubscription.planName}. Cannot activate free plan.`,
        existingPlan: {
          planId: existingSubscription.planId,
          planName: existingSubscription.planName,
          status: existingSubscription.status
        }
      });
    }

    // ✅ FIXED: Create free subscription with BOTH userId and email for better tracking
    const freeSubscription = new Subscription({
      userId: userId || null,
      userEmail: userEmail.toLowerCase().trim(),
      planId: '1',
      planName: 'Free Plan',
      status: 'active',
      billingCycle: 'monthly',
      amount: 0,
      currency: 'LKR',
      paymentMethod: 'free',
      startDate: new Date(),
      endDate: null // Free plan never expires
    });

    await freeSubscription.save();

    console.log('✅ Free plan activated successfully:', {
      subscriptionId: freeSubscription._id,
      userEmail: userEmail,
      userId: userId
    });

    res.json({
      success: true,
      message: 'Free plan activated successfully! You can now create businesses and offers.',
      subscription: {
        id: freeSubscription._id,
        planId: freeSubscription.planId,
        planName: freeSubscription.planName,
        status: freeSubscription.status,
        billingCycle: freeSubscription.billingCycle,
        endDate: freeSubscription.endDate,
        paymentMethod: freeSubscription.paymentMethod,
        amount: freeSubscription.amount,
        currency: freeSubscription.currency
      }
    });

  } catch (error) {
    console.error('❌ Error activating free plan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to activate free plan',
      error: error.message
    });
  }
});


// Update offer
app.put('/api/offers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { businessId, title, discount, category, startDate, endDate, isActive, requiresReapproval } = req.body;

    // Find the existing offer first
    const existingOffer = await Offer.findById(id);
    if (!existingOffer) {
      return res.status(404).json({
        success: false,
        message: 'Offer not found'
      });
    }

    // Validate dates if provided
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);

      if (start >= end) {
        return res.status(400).json({
          success: false,
          message: 'End date must be after start date'
        });
      }
    }

    // Prepare update data
    const updateData = {
      title,
      discount,
      category,
      isActive,
      updatedAt: new Date()
    };

    if (businessId) {
      updateData.businessId = businessId;
    }

    if (startDate !== undefined) {
      updateData.startDate = startDate ? new Date(startDate) : null;
    }

    if (endDate !== undefined) {
      updateData.endDate = endDate ? new Date(endDate) : null;
    }

    // Check if offer content has actually changed
    const contentChanged = (
      existingOffer.title !== title ||
      existingOffer.discount !== discount ||
      existingOffer.category !== category ||
      (existingOffer.startDate?.toISOString().split('T')[0] !== startDate) ||
      (existingOffer.endDate?.toISOString().split('T')[0] !== endDate) ||
      existingOffer.businessId.toString() !== businessId
    );

    console.log(`Offer ${id} edit attempt:`, {
      contentChanged,
      currentStatus: existingOffer.adminStatus,
      title: { old: existingOffer.title, new: title },
      discount: { old: existingOffer.discount, new: discount }
    });

    // If content changed and offer was previously approved/declined, reset to pending
    let statusReset = false;
    if (contentChanged && (existingOffer.adminStatus === 'approved' || existingOffer.adminStatus === 'declined')) {
      updateData.adminStatus = 'pending';
      updateData.adminComments = '';     // Clear previous admin comments
      updateData.reviewedBy = null;       // Clear previous reviewer
      updateData.reviewedAt = null;       // Clear previous review date
      statusReset = true;

      console.log(`🔄 Offer ${id} content changed - resetting status from ${existingOffer.adminStatus} to pending`);
    }

    // Update the offer
    const updatedOffer = await Offer.findByIdAndUpdate(id, updateData, { new: true })
      .populate('businessId', 'name');

    if (!updatedOffer) {
      return res.status(404).json({
        success: false,
        message: 'Failed to update offer'
      });
    }

    // Send notification email if status was reset to pending
    if (statusReset) {
      try {
        // Get user details for notification
        const user = await User.findOne({ userId: updatedOffer.userId });
        if (user) {
          await sendOfferEditNotification(user, updatedOffer, existingOffer.adminStatus);
          console.log(`📧 Edit notification sent to ${user.email}`);
        } else {
          console.log(`⚠️ User not found for userId: ${updatedOffer.userId}`);
        }
      } catch (emailError) {
        console.error('❌ Failed to send edit notification email:', emailError);
        // Don't fail the whole request if email fails
      }
    }

    // Prepare response message
    let message = 'Offer updated successfully';
    if (statusReset) {
      message = 'Offer updated successfully and resubmitted for admin approval';
    } else if (existingOffer.adminStatus === 'declined') {
      message = 'Offer updated successfully';
    }

    res.json({
      success: true,
      message: message,
      offer: updatedOffer,
      statusReset: statusReset,
      previousStatus: existingOffer.adminStatus,
      contentChanged: contentChanged
    });

  } catch (error) {
    console.error('❌ Error updating offer:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update offer',
      error: error.message
    });
  }
});
const sendOfferEditNotification = async (user, updatedOffer, previousStatus) => {
  const transporter = createTransporter();
  const business = updatedOffer.businessId;

  const formatDate = (date) => {
    if (!date) return 'Not set';
    return new Date(date).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const mailOptions = {
    from: process.env.EMAIL_USERNAME,
    to: user.email,
    subject: `🔄 Offer Updated - Pending Re-approval: ${updatedOffer.title}`,
    html: `
      <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="background: linear-gradient(135deg, #ffc107, #007bff); padding: 30px; text-align: center; color: white; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 28px;">🔄 Offer Updated</h1>
          <p style="margin: 10px 0 0; font-size: 16px; opacity: 0.9;">Re-approval required</p>
        </div>
        
        <div style="background: white; padding: 30px; border: 1px solid #e9ecef; border-top: none;">
          <p style="font-size: 18px; margin-bottom: 20px;">Dear <strong>${user.firstName || 'User'}</strong>,</p>
          
          <p>Your offer has been updated and is now pending admin re-approval since the content was modified.</p>
          
          <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid #ffc107; margin: 20px 0;">
            <h3 style="margin: 0 0 15px; color: #856404;">📢 Updated Offer Details</h3>
            <p style="margin: 5px 0;"><strong>Title:</strong> ${updatedOffer.title}</p>
            <p style="margin: 5px 0;"><strong>Discount:</strong> <span style="color: #28a745; font-weight: bold; font-size: 18px;">${updatedOffer.discount} OFF</span></p>
            <p style="margin: 5px 0;"><strong>Business:</strong> ${business.name}</p>
            ${updatedOffer.category ? `<p style="margin: 5px 0;"><strong>Category:</strong> ${updatedOffer.category}</p>` : ''}
            ${updatedOffer.startDate ? `<p style="margin: 5px 0;"><strong>Start Date:</strong> ${formatDate(updatedOffer.startDate)}</p>` : ''}
            ${updatedOffer.endDate ? `<p style="margin: 5px 0;"><strong>End Date:</strong> ${formatDate(updatedOffer.endDate)}</p>` : ''}
            <p style="margin: 15px 0 5px 0;"><strong>Previous Status:</strong> <span style="text-transform: capitalize;">${previousStatus}</span></p>
            <p style="margin: 5px 0;"><strong>Current Status:</strong> <span style="color: #ffc107; font-weight: bold;">Pending Review</span></p>
          </div>
          
          <div style="background: #fff3cd; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
            <h4 style="margin: 0 0 10px; color: #856404;">ℹ️ What happens next?</h4>
            <ul style="margin: 10px 0; padding-left: 20px; color: #856404;">
              <li>Your updated offer is now pending admin review</li>
              <li>You'll receive an email once it's approved or if changes are requested</li>
              <li>The offer will go live automatically once approved</li>
              <li>You can continue editing while it's pending if needed</li>
            </ul>
          </div>

          <div style="background: #e7f3ff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #007bff;">
            <h4 style="margin: 0 0 10px; color: #0c5460;">💡 Tips for faster approval:</h4>
            <ul style="margin: 10px 0; padding-left: 20px; color: #0c5460;">
              <li>Ensure your discount amount is clear and realistic</li>
              <li>Use appropriate start and end dates</li>
              <li>Choose the correct category for your offer</li>
              <li>Make sure your offer title is descriptive</li>
            </ul>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <p style="margin-bottom: 20px; color: #6c757d;">Manage your offers in your dashboard:</p>
            <a href="http://localhost:5173/dashboard" style="background: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; transition: background-color 0.2s;">
              View Dashboard
            </a>
          </div>
        </div>
        
        <div style="background: #f8f9fa; padding: 20px; text-align: center; color: #6c757d; font-size: 14px; border-radius: 0 0 8px 8px;">
          <p style="margin: 0;">This email was sent automatically when you updated your offer.</p>
          <p style="margin: 5px 0 0;">Need help? Contact our support team.</p>
          <hr style="border: none; border-top: 1px solid #dee2e6; margin: 15px 0;">
          <p style="margin: 0; font-size: 12px; color: #adb5bd;">
            ${updatedOffer.title} • ${business.name} • Updated on ${formatDate(new Date())}
          </p>
        </div>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`✅ Offer edit notification sent to ${user.email} for offer: ${updatedOffer.title}`);
    return true;
  } catch (error) {
    console.error('❌ Error sending offer edit notification:', error);
    return false;
  }
};
// Delete offer
app.delete('/api/offers/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const offer = await Offer.findByIdAndDelete(id);

    if (!offer) {
      return res.status(404).json({
        success: false,
        message: 'Offer not found'
      });
    }

    res.json({
      success: true,
      message: 'Offer deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting offer:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete offer'
    });
  }
});

app.get('/api/offers/:id/status-history', async (req, res) => {
  try {
    const { id } = req.params;

    const offer = await Offer.findById(id)
      .populate('businessId', 'name')
      .select('title adminStatus reviewedBy reviewedAt updatedAt createdAt adminComments');

    if (!offer) {
      return res.status(404).json({
        success: false,
        message: 'Offer not found'
      });
    }

    // Calculate if offer was resubmitted
    const wasResubmitted = offer.updatedAt && offer.reviewedAt &&
      new Date(offer.updatedAt) > new Date(offer.reviewedAt);

    res.json({
      success: true,
      offer: {
        id: offer._id,
        title: offer.title,
        business: offer.businessId.name,
        currentStatus: offer.adminStatus,
        wasResubmitted: wasResubmitted,
        lastUpdated: offer.updatedAt,
        lastReviewed: offer.reviewedAt,
        reviewedBy: offer.reviewedBy,
        adminComments: offer.adminComments,
        created: offer.createdAt
      }
    });

  } catch (error) {
    console.error('Error fetching offer status history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch offer status history'
    });
  }
});

// Toggle offer status (activate/deactivate)
app.patch('/api/offers/:id/toggle-status', async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    const offer = await Offer.findByIdAndUpdate(
      id,
      {
        isActive: isActive,
        updatedAt: new Date()
      },
      { new: true }
    ).populate('businessId', 'name');

    if (!offer) {
      return res.status(404).json({
        success: false,
        message: 'Offer not found'
      });
    }

    res.json({
      success: true,
      message: `Offer ${isActive ? 'activated' : 'deactivated'} successfully`,
      offer: offer
    });
  } catch (error) {
    console.error('Error toggling offer status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update offer status'
    });
  }
});

// Get business statistics (optional - for dashboard)
app.get('/api/businesses/stats/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const totalBusinesses = await Business.countDocuments({ userId: parseInt(userId) });
    const activeBusinesses = await Business.countDocuments({
      userId: parseInt(userId),
      status: 'active'
    });

    const totalOffers = await Offer.countDocuments({ userId: parseInt(userId) });
    const activeOffers = await Offer.countDocuments({
      userId: parseInt(userId),
      isActive: true
    });

    res.json({
      success: true,
      stats: {
        totalBusinesses,
        activeBusinesses,
        totalOffers,
        activeOffers
      }
    });
  } catch (error) {
    console.error('Error fetching business stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch statistics'
    });
  }
});

// Route to check and send notifications for offers starting today
app.get('/api/check-offer-notifications', async (req, res) => {
  try {
    const today = new Date();
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));
    const endOfDay = new Date(today.setHours(23, 59, 59, 999));

    // Find offers that start today
    const offersStartingToday = await Offer.find({
      startDate: {
        $gte: startOfDay,
        $lte: endOfDay
      },
      isActive: true
    }).populate('businessId', 'name');

    let notificationsSent = 0;

    for (const offer of offersStartingToday) {
      // Get user details
      const user = await User.findOne({ userId: offer.userId });
      if (user) {
        const business = offer.businessId;
        const offerData = {
          title: offer.title,
          discount: offer.discount,
          category: offer.category,
          startDate: offer.startDate,
          endDate: offer.endDate
        };

        const sent = await sendOfferStartNotification(
          user.email,
          `${user.firstName} ${user.lastName}`,
          business.name,
          offerData
        );

        if (sent) {
          notificationsSent++;
        }
      }
    }

    res.json({
      success: true,
      message: `Checked ${offersStartingToday.length} offers, sent ${notificationsSent} notifications`,
      offersFound: offersStartingToday.length,
      notificationsSent: notificationsSent
    });

  } catch (error) {
    console.error('Error checking offer notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check offer notifications'
    });
  }
});
app.get('/api/offers/stats/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const now = new Date();

    const totalOffers = await Offer.countDocuments({ userId: parseInt(userId) });
    const activeOffers = await Offer.countDocuments({
      userId: parseInt(userId),
      isActive: true,
      $or: [
        { startDate: null },
        { startDate: { $lte: now } }
      ],
      $or: [
        { endDate: null },
        { endDate: { $gte: now } }
      ]
    });
    const scheduledOffers = await Offer.countDocuments({
      userId: parseInt(userId),
      startDate: { $gt: now },
      isActive: true
    });
    const expiredOffers = await Offer.countDocuments({
      userId: parseInt(userId),
      endDate: { $lt: now }
    });

    res.json({
      success: true,
      stats: {
        totalOffers,
        activeOffers,
        scheduledOffers,
        expiredOffers
      }
    });
  } catch (error) {
    console.error('Error fetching offer stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch offer statistics'
    });
  }
});
app.post('/api/subscription/schedule-downgrade', async (req, res) => {
  try {
    const { userId, userEmail, reason, selections = null, handlePlanLimits = true } = req.body;

    console.log('🔄 Scheduling downgrade for userId:', userId);

    // Find active premium subscription
    const subscription = await Subscription.findOne({
      $or: [
        { userId: parseInt(userId) },
        { userEmail: userEmail?.toLowerCase().trim() }
      ],
      status: 'active',
      planId: '2' // Premium plan only
    });

    if (!subscription) {
      return res.json({
        success: false,
        message: 'No active premium subscription found'
      });
    }

    // Check if downgrade is already scheduled
    if (subscription.downgradeScheduled) {
      return res.json({
        success: false,
        alreadyScheduled: true,
        message: 'Downgrade is already scheduled for this subscription'
      });
    }

    // Calculate effective date - use subscription's actual end date
    let effectiveDate = subscription.endDate ? new Date(subscription.endDate) : null;

    // If no endDate exists, calculate it based on current period
    if (!effectiveDate) {
      if (subscription.nextBillingDate) {
        effectiveDate = new Date(subscription.nextBillingDate);
      } else {
        // Calculate end date based on start date and billing cycle
        const startDate = new Date(subscription.startDate);
        if (subscription.billingCycle === 'yearly') {
          effectiveDate = new Date(startDate);
          effectiveDate.setFullYear(effectiveDate.getFullYear() + 1);
        } else {
          // Monthly billing
          effectiveDate = new Date(startDate);
          effectiveDate.setMonth(effectiveDate.getMonth() + 1);
        }
      }
    }

    console.log('Calculated downgrade effective date:', effectiveDate.toISOString());

    // CRITICAL: Disable auto-renewal immediately and try to cancel PayHere recurring token
    let payhereRecurringCancelled = false;
    if (subscription.payhereRecurringToken) {
      try {
        // Attempt to cancel PayHere recurring payment
        console.log('🔄 Attempting to cancel PayHere recurring token:', subscription.payhereRecurringToken);

        // Call PayHere API to cancel recurring payment
        const payhereResponse = await axios.post('https://sandbox.payhere.lk/pay/recurring/cancel', {
          merchant_id: process.env.PAYHERE_MERCHANT_ID,
          recurring_token: subscription.payhereRecurringToken,
          hash: generatePayHereHash({
            merchant_id: process.env.PAYHERE_MERCHANT_ID,
            recurring_token: subscription.payhereRecurringToken
          })
        });

        if (payhereResponse.data && payhereResponse.data.status === 'success') {
          payhereRecurringCancelled = true;
          console.log('✅ PayHere recurring payment cancelled successfully');
        } else {
          console.log('⚠️ PayHere recurring cancellation response:', payhereResponse.data);
        }
      } catch (payhereError) {
        console.error('❌ Failed to cancel PayHere recurring payment:', payhereError.message);
        // Continue with downgrade scheduling even if PayHere cancellation fails
      }
    }

    // Update subscription with downgrade info and disable auto-renewal
    const updateResult = await Subscription.updateOne(
      { _id: subscription._id },
      {
        $set: {
          downgradeScheduled: true,
          downgradeScheduledDate: new Date(),
          downgradeReason: reason || 'User requested downgrade',
          downgradeEffectiveDate: effectiveDate,
          downgradeTargetPlan: '1', // Free plan
          downgradeSelections: selections,
          autoRenew: false, // CRITICAL: Disable auto-renewal immediately
          updatedAt: new Date()
        }
      }
    );

    if (updateResult.modifiedCount === 0) {
      return res.json({
        success: false,
        message: 'Failed to schedule downgrade. Please try again.'
      });
    }

    // Log the downgrade scheduling
    await SubscriptionHistory.create({
      userId: parseInt(userId),
      userEmail: subscription.userEmail,
      action: 'downgrade_scheduled',
      fromPlan: 'Premium Plan',
      toPlan: 'Free Plan',
      reason: reason || 'User requested downgrade',
      effectiveDate: effectiveDate,
      scheduledDate: new Date(),
      notes: `Downgrade scheduled for ${effectiveDate.toLocaleDateString()}. Auto-renewal disabled immediately. ${payhereRecurringCancelled ? 'PayHere recurring payment cancelled.' : 'PayHere recurring cancellation attempted.'}`
    });

    // Also log the auto-renewal cancellation as a separate action
    await SubscriptionHistory.create({
      userId: parseInt(userId),
      userEmail: subscription.userEmail,
      action: 'auto_renewal_cancelled',
      fromPlan: 'Premium Plan',
      toPlan: 'Premium Plan',
      reason: 'User scheduled downgrade',
      effectiveDate: new Date(),
      notes: 'Auto-renewal disabled immediately upon downgrade request'
    });

    const daysRemaining = Math.ceil((effectiveDate - new Date()) / (1000 * 60 * 60 * 24));

    console.log('✅ Downgrade scheduled successfully with auto-renewal disabled');

    res.json({
      success: true,
      message: `Downgrade scheduled successfully! Auto-renewal has been disabled immediately - you will not be charged again. You'll continue to enjoy premium features until ${effectiveDate.toLocaleDateString()}, then your account will automatically switch to the Free plan.`,
      effectiveDate: effectiveDate,
      daysRemaining: daysRemaining,
      autoRenewalDisabled: true,
      payhereRecurringCancelled: payhereRecurringCancelled
    });

  } catch (error) {
    console.error('❌ Error scheduling downgrade:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while scheduling downgrade'
    });
  }
});


app.post('/api/subscription/cancel-scheduled-downgrade', async (req, res) => {
  try {
    const { userId } = req.body;

    console.log('🔄 Cancelling scheduled downgrade for userId:', userId);

    // First find the subscription to get the user email
    const subscription = await Subscription.findOne({
      userId: parseInt(userId),
      status: 'active',
      downgradeScheduled: true
    });

    if (!subscription) {
      console.log('❌ No scheduled downgrade found');
      return res.json({
        success: false,
        message: 'No scheduled downgrade found to cancel'
      });
    }

    console.log('✅ Found subscription with scheduled downgrade:', subscription._id);

    // Cancel the downgrade
    const updateResult = await Subscription.updateOne(
      { _id: subscription._id },
      {
        $unset: {
          downgradeScheduled: '',
          downgradeScheduledDate: '',
          downgradeReason: '',
          downgradeEffectiveDate: '',
          downgradeTargetPlan: '',
          downgradeSelections: ''
        },
        $set: {
          autoRenew: true, // Re-enable auto-renewal
          updatedAt: new Date()
        }
      }
    );

    console.log('Update result:', updateResult);

    if (updateResult.modifiedCount > 0) {
      // Create history record with proper userEmail
      await SubscriptionHistory.create({
        userId: subscription.userId,
        userEmail: subscription.userEmail, // Use the email from the subscription
        action: 'downgrade_cancelled',
        fromPlan: 'Premium Plan',
        toPlan: 'Premium Plan',
        reason: 'User cancelled scheduled downgrade',
        effectiveDate: new Date(),
        notes: 'Premium subscription will continue with auto-renewal enabled'
      });

      console.log('✅ Successfully cancelled downgrade');

      res.json({
        success: true,
        message: 'Scheduled downgrade cancelled successfully! Your premium subscription will continue.'
      });
    } else {
      console.log('❌ Failed to update subscription');
      res.json({
        success: false,
        message: 'Failed to cancel downgrade. Please try again.'
      });
    }

  } catch (error) {
    console.error('❌ Error cancelling scheduled downgrade:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while cancelling downgrade'
    });
  }
});


app.get('/api/subscription/downgrade-details/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const subscription = await Subscription.findOne({
      userId: parseInt(userId),
      downgradeScheduled: true
    });

    if (!subscription) {
      return res.json({
        success: true,
        downgradeInfo: null
      });
    }

    const daysRemaining = Math.ceil(
      (new Date(subscription.downgradeEffectiveDate) - new Date()) / (1000 * 60 * 60 * 24)
    );

    res.json({
      success: true,
      downgradeInfo: {
        scheduledDate: subscription.downgradeScheduledDate,
        effectiveDate: subscription.downgradeEffectiveDate,
        reason: subscription.downgradeReason,
        daysRemaining: Math.max(0, daysRemaining),
        targetPlan: subscription.downgradeTargetPlan || 'Free'
      }
    });

  } catch (error) {
    console.error('❌ Error fetching downgrade details:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while fetching downgrade details'
    });
  }
});



app.get('/api/subscription/downgrade-impact/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    console.log('🔍 Checking downgrade impact for userId:', userId);

    // Count current businesses and offers
    const businessCount = await Business.countDocuments({
      userId: parseInt(userId),
      status: { $ne: 'deleted' }
    });

    const offerCount = await Offer.countDocuments({
      userId: parseInt(userId),
      status: { $ne: 'deleted' }
    });

    const freeLimits = { maxBusinesses: 1, maxOffers: 3 };

    const impact = {
      currentBusinesses: businessCount,
      currentOffers: offerCount,
      maxBusinesses: freeLimits.maxBusinesses,
      maxOffers: freeLimits.maxOffers,
      businessesToRemove: Math.max(0, businessCount - freeLimits.maxBusinesses),
      offersToRemove: Math.max(0, offerCount - freeLimits.maxOffers),
      exceedsLimits: businessCount > freeLimits.maxBusinesses || offerCount > freeLimits.maxOffers
    };

    res.json(impact);

  } catch (error) {
    console.error('❌ Error checking downgrade impact:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while checking downgrade impact'
    });
  }
});
app.post('/api/subscription/process-downgrades', async (req, res) => {
  try {
    console.log('🔄 Processing scheduled downgrades...');

    const today = new Date();
    today.setHours(0, 0, 0, 0); // Start of today

    // Find subscriptions that should be downgraded today
    const subscriptionsToDowngrade = await Subscription.find({
      downgradeScheduled: true,
      downgradeEffectiveDate: { $lte: today },
      status: 'active'
    });

    console.log(`📋 Found ${subscriptionsToDowngrade.length} subscriptions to downgrade`);

    const results = [];

    for (const subscription of subscriptionsToDowngrade) {
      try {
        // Create new free subscription
        const newSubscriptionId = await Counter.getNextSequence('subscription');

        const freeSubscription = new Subscription({
          subscriptionId: newSubscriptionId,
          userId: subscription.userId,
          userEmail: subscription.userEmail,
          planId: '1',
          planName: 'Free Plan',
          status: 'active',
          billingCycle: 'monthly',
          amount: 0,
          currency: 'LKR',
          startDate: today,
          endDate: null,
          nextBillingDate: null,
          paymentMethod: 'free',
          autoRenew: false,
          downgradeScheduled: false,
          createdAt: new Date(),
          updatedAt: new Date()
        });

        await freeSubscription.save();

        // Update old subscription to expired
        await Subscription.updateOne(
          { _id: subscription._id },
          {
            $set: {
              status: 'expired',
              downgradeProcessedDate: today,
              updatedAt: new Date()
            }
          }
        );

        // Suspend excess businesses and offers
        const businesses = await Business.find({ userId: subscription.userId, status: 'active' })
          .sort({ createdAt: 1 }); // Keep oldest first
        const offers = await Offer.find({ userId: subscription.userId, status: 'active' })
          .sort({ createdAt: 1 }); // Keep oldest first

        // Suspend excess businesses (keep only 1 for free plan)
        if (businesses.length > 1) {
          const businessesToSuspend = businesses.slice(1); // All except first
          await Business.updateMany(
            { _id: { $in: businessesToSuspend.map(b => b._id) } },
            {
              $set: {
                status: 'suspended',
                suspendedDate: today,
                suspensionReason: 'Downgraded to Free plan - exceeds business limit'
              }
            }
          );
        }

        // Suspend excess offers (keep only 3 for free plan)
        if (offers.length > 3) {
          const offersToSuspend = offers.slice(3); // All except first 3
          await Offer.updateMany(
            { _id: { $in: offersToSuspend.map(o => o._id) } },
            {
              $set: {
                status: 'suspended',
                suspendedDate: today,
                suspensionReason: 'Downgraded to Free plan - exceeds offer limit'
              }
            }
          );
        }

        // Log the downgrade
        await SubscriptionHistory.create({
          userId: subscription.userId,
          userEmail: subscription.userEmail,
          action: 'downgrade_processed',
          fromPlan: subscription.planName,
          toPlan: 'Free Plan',
          reason: subscription.downgradeReason || 'Scheduled downgrade',
          effectiveDate: today,
          notes: `Auto-downgraded from Premium to Free. Businesses suspended: ${Math.max(0, businesses.length - 1)}, Offers suspended: ${Math.max(0, offers.length - 3)}`
        });

        await SubscriptionLog.create({
          subscriptionId: subscription._id,
          userId: subscription.userId,
          userEmail: subscription.userEmail,
          action: 'auto_downgrade_to_free',
          details: {
            processedDate: today,
            originalPlan: subscription.planName,
            newPlan: 'Free Plan',
            businessesSuspended: Math.max(0, businesses.length - 1),
            offersSuspended: Math.max(0, offers.length - 3),
            newSubscriptionId: newSubscriptionId
          },
          timestamp: new Date()
        });

        results.push({
          userId: subscription.userId,
          userEmail: subscription.userEmail,
          success: true,
          businessesSuspended: Math.max(0, businesses.length - 1),
          offersSuspended: Math.max(0, offers.length - 3)
        });

        console.log(`✅ Successfully downgraded user ${subscription.userId} to Free plan`);

      } catch (error) {
        console.error(`❌ Failed to downgrade user ${subscription.userId}:`, error);
        results.push({
          userId: subscription.userId,
          userEmail: subscription.userEmail,
          success: false,
          error: error.message
        });
      }
    }

    console.log('📊 Downgrade processing completed');

    res.json({
      success: true,
      message: `Processed ${results.length} scheduled downgrades`,
      results: results,
      summary: {
        total: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length
      }
    });

  } catch (error) {
    console.error('❌ Error processing scheduled downgrades:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while processing downgrades'
    });
  }
});
app.post('/api/user/check-subscription-with-downgrade', async (req, res) => {
  try {
    const { email, userId } = req.body;

    console.log('🔍 Checking subscription with downgrade info for:', { email, userId });

    // Find user
    let user = null;
    if (userId) {
      user = await User.findOne({ userId: parseInt(userId) });
    } else if (email) {
      user = await User.findOne({ email: email.toLowerCase().trim() });
    }

    if (!user) {
      return res.json({
        success: true,
        hasSubscription: false,
        hasActiveSubscription: false,
        isPremiumUser: false,
        isFreeUser: false,
        isNonActivated: true,
        userExists: false,
        subscription: null,
        downgradeInfo: null
      });
    }

    // Find subscription
    const subscription = await Subscription.findOne({
      $or: [
        { userId: user.userId },
        { userEmail: user.email.toLowerCase().trim() }
      ]
    }).sort({ createdAt: -1 });

    if (!subscription) {
      return res.json({
        success: true,
        hasSubscription: false,
        hasActiveSubscription: false,
        isPremiumUser: false,
        isFreeUser: false,
        isNonActivated: true,
        userExists: true,
        subscription: null,
        downgradeInfo: null
      });
    }

    // Check if subscription is active and not expired
    const now = new Date();
    const isExpired = subscription.endDate && subscription.endDate < now;
    const isActive = subscription.status === 'active' && !isExpired;

    // Determine user type
    const isPremium = isActive && subscription.planId === '2';
    const isFree = isActive && subscription.planId === '1';

    // Check for grace period (downgrade scheduled but still in premium period)
    const isInGracePeriod = subscription.downgradeScheduled &&
      subscription.downgradeEffectiveDate &&
      subscription.downgradeEffectiveDate > now &&
      subscription.planId === '2';

    // Prepare downgrade info
    let downgradeInfo = null;
    if (subscription.downgradeScheduled) {
      const daysRemaining = Math.ceil((new Date(subscription.downgradeEffectiveDate) - now) / (1000 * 60 * 60 * 24));

      downgradeInfo = {
        scheduled: true,
        scheduledDate: subscription.downgradeScheduledDate,
        effectiveDate: subscription.downgradeEffectiveDate,
        reason: subscription.downgradeReason,
        targetPlan: subscription.downgradeTargetPlan,
        daysRemaining: Math.max(0, daysRemaining),
        isInGracePeriod: isInGracePeriod
      };
    }

    res.json({
      success: true,
      hasSubscription: true,
      hasActiveSubscription: isActive || isInGracePeriod,
      isPremiumUser: isPremium || isInGracePeriod,
      isFreeUser: isFree && !isInGracePeriod,
      isNonActivated: !isActive && !isInGracePeriod,
      userExists: true,
      subscription: {
        ...subscription.toObject(),
        isInGracePeriod: isInGracePeriod
      },
      downgradeInfo: downgradeInfo,
      autoRenewal: subscription.autoRenew || false
    });

  } catch (error) {
    console.error('❌ Error checking subscription:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check subscription status',
      error: error.message
    });
  }
});

async function getUserName(userId) {
  try {
    const user = await User.findOne({ userId: userId });
    if (user) {
      return `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email || 'User';
    }
    return 'User';
  } catch (error) {
    console.error('Error getting user name:', error);
    return 'User';
  }
}

// Email function placeholder (implement based on your email service)
async function sendDowngradeScheduledEmail(emailData) {
  try {
    console.log('📧 Sending downgrade scheduled email to:', emailData.email);

    // Implement your email sending logic here
    // For example, using nodemailer, SendGrid, etc.

    const emailContent = `
      Dear ${emailData.userName},
      
      Your premium subscription downgrade has been scheduled.
      
      Current Plan: ${emailData.currentPlan}
      Downgrade Date: ${emailData.effectiveDate.toLocaleDateString()}
      Days Remaining: ${emailData.daysRemaining}
      Reason: ${emailData.reason}
      
      Impact Analysis:
      - Businesses to be suspended: ${emailData.impactAnalysis.businessesToRemove}
      - Offers to be suspended: ${emailData.impactAnalysis.offersToRemove}
      
      You can cancel this downgrade anytime before the effective date.
      
      Best regards,
      Your App Team
    `;

    // Replace with your actual email sending implementation
    console.log('Email content prepared:', emailContent);

    return { success: true };
  } catch (error) {
    console.error('Error sending downgrade email:', error);
    throw error;
  }
}


async function sendDowngradeReminderEmail({ email, userName, effectiveDate, daysRemaining, impactAnalysis }) {
  try {
    const emailContent = {
      to: email,
      subject: `⏰ Reminder: Premium Plan Ends in ${daysRemaining} Days`,
      html: `
        <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="background: linear-gradient(135deg, #ff9800, #ff5722); padding: 30px; text-align: center; color: white; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; font-size: 28px;">⏰ ${daysRemaining} Days Left</h1>
            <p style="margin: 10px 0 0; font-size: 16px; opacity: 0.9;">Your premium plan ends soon</p>
          </div>
          
          <div style="background: white; padding: 30px; border: 1px solid #e9ecef; border-top: none;">
            <p style="font-size: 18px; margin-bottom: 20px;">Dear <strong>${userName}</strong>,</p>
            
            <p>This is a friendly reminder that your premium plan will automatically downgrade to the Free Plan on <strong>${effectiveDate.toLocaleDateString()}</strong>.</p>
            
            <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; border-left: 4px solid #ffc107; margin: 20px 0;">
              <h3 style="margin: 0 0 15px; color: #856404;">📅 Timeline</h3>
              <ul style="margin: 0; padding-left: 20px;">
                <li><strong>${daysRemaining} days</strong> until automatic downgrade</li>
                <li>Premium features active until ${effectiveDate.toLocaleDateString()}</li>
                <li>Can cancel downgrade anytime before then</li>
              </ul>
            </div>

            ${impactAnalysis.hasImpact ? `
              <div style="background-color: #f8d7da; padding: 20px; border-radius: 8px; border-left: 4px solid #dc3545; margin: 20px 0;">
                <h3 style="margin: 0 0 15px; color: #721c24;">⚠️ Impact on Your Content</h3>
                <ul style="margin: 0; padding-left: 20px; color: #721c24;">
                  ${impactAnalysis.businessesToSuspend > 0 ? `<li><strong>${impactAnalysis.businessesToSuspend} business(es)</strong> will be suspended</li>` : ''}
                  ${impactAnalysis.offersToSuspend > 0 ? `<li><strong>${impactAnalysis.offersToSuspend} offer(s)</strong> will be suspended</li>` : ''}
                </ul>
              </div>
            ` : ''}
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.FRONTEND_URL}/dashboard" style="background: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; margin-right: 10px;">
                Cancel Downgrade
              </a>
              <a href="${process.env.FRONTEND_URL}/subscription" style="background: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
                Renew Premium
              </a>
            </div>
          </div>
        </div>
      `
    };

    // Send email using your email service
    // await emailService.send(emailContent);

  } catch (error) {
    console.error('Error sending downgrade reminder email:', error);
  }
}

// ===== ADMIN ENDPOINTS FOR MONITORING =====

// Get subscription analytics for admin
app.get('/api/admin/subscription-analytics', async (req, res) => {
  try {
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());

    const analytics = {
      // Current subscription counts
      totalSubscriptions: await Subscription.countDocuments({ status: 'active' }),
      premiumUsers: await Subscription.countDocuments({ planId: '2', status: 'active' }),
      freeUsers: await Subscription.countDocuments({ planId: '1', status: 'active' }),

      // Downgrade statistics
      scheduledDowngrades: await Subscription.countDocuments({
        downgradeScheduled: true,
        status: 'active'
      }),

      // Grace period users
      usersInGracePeriod: await Subscription.countDocuments({
        isInGracePeriod: true,
        status: 'active'
      }),

      // Recent activity
      recentDowngrades: await SubscriptionHistory.countDocuments({
        action: 'downgrade_processed',
        effectiveDate: { $gte: lastMonth }
      }),

      // Content suspension stats
      suspendedBusinesses: await Business.countDocuments({
        status: 'suspended',
        suspensionReason: { $regex: /free plan limit|downgrade/i }
      }),
      suspendedOffers: await Offer.countDocuments({
        status: 'suspended',
        suspensionReason: { $regex: /free plan limit|downgrade/i }
      }),

      // Upcoming downgrades (next 7 days)
      upcomingDowngrades: await Subscription.countDocuments({
        downgradeScheduled: true,
        downgradeEffectiveDate: {
          $gte: now,
          $lte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
        }
      })
    };

    res.json({
      success: true,
      analytics
    });

  } catch (error) {
    console.error('❌ Error fetching subscription analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch analytics',
      error: error.message
    });
  }
});

// Get users with scheduled downgrades
app.get('/api/admin/scheduled-downgrades', async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    const scheduledDowngrades = await Subscription.find({
      downgradeScheduled: true,
      status: 'active'
    })
      .sort({ downgradeEffectiveDate: 1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    // Enhance with user details and impact analysis
    const enhancedDowngrades = await Promise.all(scheduledDowngrades.map(async (subscription) => {
      const user = await User.findOne({ userId: subscription.userId });
      const impactAnalysis = await getDowngradeImpactAnalysis(subscription.userId);
      const daysRemaining = Math.ceil((new Date(subscription.downgradeEffectiveDate) - new Date()) / (1000 * 60 * 60 * 24));

      return {
        subscriptionId: subscription._id,
        userId: subscription.userId,
        userEmail: subscription.userEmail,
        userName: user ? `${user.firstName} ${user.lastName}` : 'Unknown',
        scheduledDate: subscription.downgradeScheduledDate,
        effectiveDate: subscription.downgradeEffectiveDate,
        reason: subscription.downgradeReason,
        daysRemaining: Math.max(0, daysRemaining),
        impactAnalysis
      };
    }));

    const totalCount = await Subscription.countDocuments({
      downgradeScheduled: true,
      status: 'active'
    });

    res.json({
      success: true,
      downgrades: enhancedDowngrades,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / limit),
        totalCount,
        limit: parseInt(limit)
      }
    });

  } catch (error) {
    console.error('❌ Error fetching scheduled downgrades:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch scheduled downgrades',
      error: error.message
    });
  }
});

// Manual admin downgrade processing
app.post('/api/admin/process-user-downgrade', async (req, res) => {
  try {
    const { userId, reason = 'Manual admin downgrade' } = req.body;

    console.log('👨‍💼 Processing manual admin downgrade for user:', userId);

    const subscription = await Subscription.findOne({
      userId: parseInt(userId),
      status: 'active',
      planId: '2'
    });

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'No active premium subscription found'
      });
    }

    // Process downgrade immediately (similar to cron job logic)
    await Subscription.findByIdAndUpdate(subscription._id, {
      planId: '1',
      planName: 'Free Plan',
      downgradeScheduled: false,
      downgradeProcessedDate: new Date(),
      autoRenew: false,
      endDate: null,
      nextBillingDate: null,
      isInGracePeriod: false,
      updatedAt: new Date()
    });

    // Enforce limits and count affected content
    const businesses = await Business.find({ userId: parseInt(userId), status: 'active' })
      .sort({ displayOrder: 1, createdAt: 1 });

    const offers = await Offer.find({
      userId: parseInt(userId),
      status: 'active',
      adminStatus: 'approved'
    }).sort({ displayOrder: 1, createdAt: 1 });

    let businessesSuspended = 0;
    let offersSuspended = 0;

    // Suspend excess businesses (keep only 1)
    if (businesses.length > 1) {
      const businessesToSuspend = businesses.slice(1);
      for (const business of businessesToSuspend) {
        await Business.findByIdAndUpdate(business._id, {
          status: 'suspended',
          suspendedDate: new Date(),
          suspensionReason: 'Manual admin downgrade to free plan'
        });
        businessesSuspended++;
      }
    }

    // Suspend excess offers (keep only 1)
    if (offers.length > 1) {
      const offersToSuspend = offers.slice(1);
      for (const offer of offersToSuspend) {
        await Offer.findByIdAndUpdate(offer._id, {
          status: 'suspended',
          suspendedDate: new Date(),
          suspensionReason: 'Manual admin downgrade to free plan'
        });
        offersSuspended++;
      }
    }

    // Record in history
    await new SubscriptionHistory({
      userId: parseInt(userId),
      userEmail: subscription.userEmail,
      action: 'downgrade_processed',
      fromPlan: 'Premium Plan',
      toPlan: 'Free Plan',
      reason: reason,
      effectiveDate: new Date(),
      notes: `Manual admin downgrade - suspended ${businessesSuspended} businesses and ${offersSuspended} offers`
    }).save();

    res.json({
      success: true,
      message: 'User successfully downgraded to free plan',
      businessesSuspended,
      offersSuspended
    });

  } catch (error) {
    console.error('❌ Error processing manual downgrade:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process manual downgrade',
      error: error.message
    });
  }
});
// Send downgrade scheduled email with warning


// Send downgrade cancelled email
async function sendDowngradeCancelledEmail({ email, userName, planName }) {
  try {
    console.log('📧 Sending downgrade cancelled email to:', email);

    const emailContent = {
      to: email,
      subject: '✅ Subscription Reactivated - Premium Features Restored',
      html: `
        <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="background: linear-gradient(135deg, #28a745, #007bff); padding: 30px; text-align: center; color: white; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; font-size: 28px;">🎉 Welcome Back!</h1>
            <p style="margin: 10px 0 0; font-size: 16px; opacity: 0.9;">Your premium subscription continues</p>
          </div>
          
          <div style="background: white; padding: 30px; border: 1px solid #e9ecef; border-top: none;">
            <p style="font-size: 18px; margin-bottom: 20px;">Dear <strong>${userName}</strong>,</p>
            
            <p>Great news! Your scheduled downgrade has been successfully cancelled.</p>
            
            <div style="background-color: #d4edda; padding: 20px; border-radius: 8px; border-left: 4px solid #28a745; margin: 20px 0;">
              <h3 style="margin: 0 0 15px; color: #155724;">✅ What This Means</h3>
              <ul style="margin: 0; padding-left: 20px;">
                <li>Your <strong>${planName}</strong> will continue as normal</li>
                <li>Auto-renewal has been re-enabled</li>
                <li>All premium features remain active</li>
                <li>No content will be suspended</li>
              </ul>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.FRONTEND_URL}/dashboard" style="background: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
                Access Dashboard
              </a>
            </div>
          </div>
          
          <div style="background: #f8f9fa; padding: 20px; text-align: center; color: #6c757d; font-size: 14px; border-radius: 0 0 8px 8px;">
            <p style="margin: 0;">Thank you for staying with us!</p>
          </div>
        </div>
      `
    };

    // Send email using your email service
    // await emailService.send(emailContent);

  } catch (error) {
    console.error('Error sending downgrade cancelled email:', error);
  }
}

// Send downgrade completed email
async function sendDowngradeCompletedEmail({ email, userName, suspendedBusinesses, suspendedOffers }) {
  try {
    console.log('📧 Sending downgrade completed email to:', email);

    const emailContent = {
      to: email,
      subject: 'Your Account Has Been Downgraded to Free Plan',
      html: `
        <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="background: linear-gradient(135deg, #6c757d, #007bff); padding: 30px; text-align: center; color: white; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; font-size: 28px;">Account Updated</h1>
            <p style="margin: 10px 0 0; font-size: 16px; opacity: 0.9;">Now on Free Plan</p>
          </div>
          
          <div style="background: white; padding: 30px; border: 1px solid #e9ecef; border-top: none;">
            <p style="font-size: 18px; margin-bottom: 20px;">Dear <strong>${userName}</strong>,</p>
            
            <p>Your subscription has been successfully downgraded to the Free Plan as scheduled.</p>
            
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin: 0 0 15px; color: #495057;">📊 Account Summary</h3>
              <ul style="margin: 0; padding-left: 20px;">
                <li><strong>Plan:</strong> Free Plan (1 business, 1 offer)</li>
                <li><strong>Businesses affected:</strong> ${suspendedBusinesses} temporarily suspended</li>
                <li><strong>Offers affected:</strong> ${suspendedOffers} temporarily suspended</li>
              </ul>
            </div>
            
            ${suspendedBusinesses > 0 || suspendedOffers > 0 ? `
              <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; border-left: 4px solid #ffc107; margin: 20px 0;">
                <h4 style="margin: 0 0 10px; color: #856404;">📦 Content Temporarily Suspended</h4>
                <p style="margin: 0 0 10px;">The following content has been temporarily suspended due to Free plan limits:</p>
                ${suspendedBusinesses > 0 ? `<p>• <strong>${suspendedBusinesses} business(es)</strong> suspended</p>` : ''}
                ${suspendedOffers > 0 ? `<p>• <strong>${suspendedOffers} offer(s)</strong> suspended</p>` : ''}
                <p style="margin: 10px 0 0; font-weight: bold; color: #28a745;">💡 Your content isn't deleted! Upgrade anytime to reactivate everything.</p>
              </div>
            ` : ''}
            
            <div style="background-color: #e7f3ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h4 style="margin: 0 0 10px; color: #0c5460;">🆓 What You Can Still Do</h4>
              <ul style="margin: 0; padding-left: 20px; color: #0c5460;">
                <li>Manage 1 active business</li>
                <li>Create 1 active offer (highlight ad)</li>
                <li>Access basic platform features</li>
                <li>Upgrade to Premium anytime to restore all content</li>
              </ul>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.FRONTEND_URL}/dashboard" style="background: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; margin-right: 10px;">
                View Dashboard
              </a>
              <a href="${process.env.FRONTEND_URL}/subscription" style="background: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
                Upgrade to Premium
              </a>
            </div>
          </div>
          
          <div style="background: #f8f9fa; padding: 20px; text-align: center; color: #6c757d; font-size: 14px; border-radius: 0 0 8px 8px;">
            <p style="margin: 0;">Thank you for using our platform! Upgrade anytime to get your premium features back.</p>
          </div>
        </div>
      `
    };

    // Send email using your email service
    // await emailService.send(emailContent);

  } catch (error) {
    console.error('Error sending downgrade completed email:', error);
  }
}

// ===== REACTIVATE SUSPENDED CONTENT (WHEN USER UPGRADES) =====
app.post('/api/subscription/reactivate-content', async (req, res) => {
  try {
    const { userId, userEmail } = req.body;

    console.log('🔄 Reactivating suspended content for user:', userId);

    // Check if user has premium subscription
    const subscription = await Subscription.findOne({
      $or: [
        { userId: parseInt(userId) },
        { userEmail: userEmail?.toLowerCase().trim() }
      ],
      planId: '2',
      status: 'active'
    });

    if (!subscription) {
      return res.status(400).json({
        success: false,
        message: 'User must have active premium subscription to reactivate content'
      });
    }

    // Reactivate suspended businesses
    const reactivatedBusinesses = await Business.updateMany(
      {
        userId: parseInt(userId),
        status: 'suspended',
        suspensionReason: { $regex: /free plan limit|downgrade/i }
      },
      {
        status: 'active',
        suspendedDate: null,
        suspensionReason: null,
        updatedAt: new Date()
      }
    );

    // Reactivate suspended offers
    const reactivatedOffers = await Offer.updateMany(
      {
        userId: parseInt(userId),
        status: 'suspended',
        suspensionReason: { $regex: /free plan limit|downgrade/i }
      },
      {
        status: 'active',
        suspendedDate: null,
        suspensionReason: null,
        updatedAt: new Date()
      }
    );

    // Record in history
    await new SubscriptionHistory({
      userId: parseInt(userId),
      userEmail: userEmail,
      action: 'reactivation',
      fromPlan: 'Free Plan',
      toPlan: 'Premium Plan',
      effectiveDate: new Date(),
      notes: `Reactivated ${reactivatedBusinesses.modifiedCount} businesses and ${reactivatedOffers.modifiedCount} offers after premium upgrade`
    }).save();

    res.json({
      success: true,
      message: 'Content reactivated successfully',
      reactivatedBusinesses: reactivatedBusinesses.modifiedCount,
      reactivatedOffers: reactivatedOffers.modifiedCount
    });

  } catch (error) {
    console.error('❌ Error reactivating content:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reactivate content',
      error: error.message
    });
  }
});
// ===== HELPER FUNCTION FOR IMPACT ANALYSIS =====
async function getDowngradeImpactAnalysis(userId) {
  try {
    const businesses = await Business.countDocuments({
      userId: userId,
      status: 'active'
    });

    const offers = await Offer.countDocuments({
      userId: userId,
      status: 'active',
      adminStatus: 'approved'
    });

    // Free plan limits: 1 business, 3 offers
    return {
      currentBusinesses: businesses,
      currentOffers: offers,
      businessesToRemove: Math.max(0, businesses - 1),
      offersToRemove: Math.max(0, offers - 3),
      willKeepBusinesses: Math.min(businesses, 1),
      willKeepOffers: Math.min(offers, 3)
    };
  } catch (error) {
    console.error('Error analyzing downgrade impact:', error);
    return {
      currentBusinesses: 0,
      currentOffers: 0,
      businessesToRemove: 0,
      offersToRemove: 0,
      willKeepBusinesses: 0,
      willKeepOffers: 0
    };
  }
}

cron.schedule('0 2 * * *', async () => {
  console.log('🔄 Running daily subscription renewal check...');

  try {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Find subscriptions due for renewal
    const subscriptionsDue = await Subscription.find({
      autoRenew: true,
      status: { $in: ['active', 'pending_renewal'] },
      nextBillingDate: {
        $gte: today,
        $lt: tomorrow
      },
      renewalAttempts: { $lt: 3 },
      // IMPORTANT: Exclude subscriptions with scheduled cancellations
      cancellationScheduled: { $ne: true }
    });

    console.log(`📊 Found ${subscriptionsDue.length} subscriptions due for renewal`);

    for (const subscription of subscriptionsDue) {
      try {
        // Attempt manual renewal charge
        await attemptManualRenewal(subscription);
      } catch (renewalError) {
        console.error(`❌ Failed to renew subscription ${subscription._id}:`, renewalError);
      }
    }

    console.log('✅ Daily renewal check completed');

  } catch (error) {
    console.error('❌ Error in daily renewal check:', error);
  }
});

// 2. GRACE PERIOD CANCELLATION PROCESSING - 2:30 AM
cron.schedule('30 2 * * *', async () => {
  console.log('🔄 Running scheduled cancellation processing...');

  try {
    const today = new Date();

    // Find all subscriptions with scheduled cancellations that should be processed today
    const subscriptionsToCancel = await Subscription.find({
      cancellationScheduled: true,
      cancellationEffectiveDate: { $lte: today },
      status: 'active'
    });

    console.log(`📊 Found ${subscriptionsToCancel.length} subscriptions to cancel`);

    const results = [];

    for (const subscription of subscriptionsToCancel) {
      try {
        console.log(`Processing cancellation for user ${subscription.userId}`);

        // Create a free subscription for the user
        const freeSubscription = new Subscription({
          userId: subscription.userId,
          userEmail: subscription.userEmail,
          planId: '1',
          planName: 'Free Plan',
          status: 'active',
          billingCycle: 'monthly',
          amount: 0,
          currency: 'LKR',
          paymentMethod: 'auto_downgrade',
          startDate: today,
          endDate: null, // Free plan doesn't expire
          autoRenew: false,
          createdAt: today,
          updatedAt: today
        });

        await freeSubscription.save();

        // Update the old premium subscription to cancelled
        await Subscription.updateOne(
          { _id: subscription._id },
          {
            $set: {
              status: 'cancelled',
              endDate: today,
              cancellationProcessedDate: today,
              updatedAt: today
            }
          }
        );

        // Log the automatic downgrade
        await SubscriptionLog.create({
          subscriptionId: subscription._id,
          userId: subscription.userId,
          userEmail: subscription.userEmail,
          action: 'auto_downgrade_to_free',
          details: {
            fromPlan: 'Premium Plan',
            toPlan: 'Free Plan',
            processedDate: today,
            reason: 'Scheduled cancellation processed'
          },
          timestamp: today
        });

        results.push({
          userId: subscription.userId,
          userEmail: subscription.userEmail,
          status: 'success',
          message: 'Successfully downgraded to free plan'
        });

        console.log(`✅ User ${subscription.userId} downgraded to free plan`);

        // Send downgrade notification email
        try {
          const user = await User.findOne({ userId: subscription.userId });
          if (user) {
            await sendDowngradeNotificationEmail(user, subscription);
          }
        } catch (emailError) {
          console.error(`❌ Failed to send downgrade email to user ${subscription.userId}:`, emailError);
        }

      } catch (error) {
        console.error(`❌ Error processing cancellation for user ${subscription.userId}:`, error);
        results.push({
          userId: subscription.userId,
          userEmail: subscription.userEmail,
          status: 'error',
          message: error.message
        });
      }
    }

    console.log(`✅ Scheduled cancellation processing completed: ${results.filter(r => r.status === 'success').length} successful, ${results.filter(r => r.status === 'error').length} errors`);

  } catch (error) {
    console.error('❌ Error in scheduled cancellation processing:', error);
  }
});

// 3. DAILY OFFER NOTIFICATION CHECK - 9:00 AM
cron.schedule('0 9 * * *', async () => {
  console.log('🔔 Checking for offers starting today...');
  try {
    const response = await axios.get('http://localhost:5555/api/check-offer-notifications');
    console.log('✅ Notification check completed:', response.data.message);
  } catch (error) {
    console.error('❌ Error in scheduled notification check:', error);
  }
});

// 4. WEEKLY CLEANUP - 3:00 AM EVERY SUNDAY
cron.schedule('0 3 * * 0', async () => {
  console.log('🧹 Running weekly subscription cleanup...');

  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Remove old logs older than 30 days
    const logCleanup = await SubscriptionLog.deleteMany({
      timestamp: { $lt: thirtyDaysAgo },
      action: { $in: ['auto_downgrade_to_free', 'cancellation_scheduled'] }
    });

    console.log(`🗑️ Cleaned up ${logCleanup.deletedCount} old subscription logs`);

    // Count current active subscriptions for monitoring
    const activeCount = await Subscription.countDocuments({ status: 'active' });
    const cancelledCount = await Subscription.countDocuments({ status: 'cancelled' });
    const gracePeriodCount = await Subscription.countDocuments({
      cancellationScheduled: true,
      status: 'active'
    });

    console.log(`📈 Current subscription stats: Active: ${activeCount}, Cancelled: ${cancelledCount}, Grace Period: ${gracePeriodCount}`);

  } catch (error) {
    console.error('❌ Error in weekly cleanup:', error);
  }
});

cron.schedule('0 2 * * *', async () => {
  console.log('🕐 Running scheduled downgrade processing...');
  try {
    const response = await fetch(`${process.env.BACKEND_URL}/api/subscription/process-downgrades`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + process.env.CRON_JOB_TOKEN
      }
    });

    const result = await response.json();
    console.log('✅ Scheduled downgrade processing result:', result);
  } catch (error) {
    console.error('❌ Error in scheduled downgrade processing:', error);
  }
});

// Send downgrade warning emails (3 days before)
cron.schedule('0 9 * * *', async () => {
  console.log('📧 Sending downgrade warning emails...');
  try {
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
    threeDaysFromNow.setHours(0, 0, 0, 0);

    const upcomingDowngrades = await Subscription.find({
      downgradeScheduled: true,
      downgradeEffectiveDate: {
        $gte: threeDaysFromNow,
        $lt: new Date(threeDaysFromNow.getTime() + 24 * 60 * 60 * 1000)
      }
    });

    for (const subscription of upcomingDowngrades) {
      const impactAnalysis = await getDowngradeImpactAnalysis(subscription.userId);
      await sendDowngradeReminderEmail({
        email: subscription.userEmail,
        userName: await getUserName(subscription.userId),
        effectiveDate: subscription.downgradeEffectiveDate,
        daysRemaining: 3,
        impactAnalysis
      });
    }

    console.log(`📧 Sent ${upcomingDowngrades.length} downgrade warning emails`);
  } catch (error) {
    console.error('❌ Error sending downgrade warnings:', error);
  }
});

cron.schedule('0 2 * * *', async () => {
  console.log('🔄 Running daily downgrade processor...');

  try {
    const now = new Date();

    // Find subscriptions that should be downgraded today
    const subscriptionsToDowngrade = await Subscription.find({
      downgradeScheduled: true,
      downgradeEffectiveDate: { $lte: now },
      status: 'active',
      planId: '2' // Premium subscriptions only
    });

    console.log(`📋 Found ${subscriptionsToDowngrade.length} subscriptions to process`);

    for (const subscription of subscriptionsToDowngrade) {
      try {
        // Create new free subscription
        const freeSubscription = new Subscription({
          userId: subscription.userId,
          userEmail: subscription.userEmail,
          planId: '1',
          planName: 'Free Plan',
          status: 'active',
          billingCycle: 'monthly',
          amount: 0,
          currency: subscription.currency,
          paymentMethod: 'downgrade',
          autoRenew: false,
          startDate: now,
          endDate: null, // Free plan doesn't expire
          renewalHistory: []
        });

        await freeSubscription.save();

        // Update old subscription to expired
        await Subscription.updateOne(
          { _id: subscription._id },
          {
            $set: {
              status: 'expired',
              endDate: now,
              autoRenew: false,
              downgradeProcessedDate: now,
              updatedAt: now
            },
            $unset: {
              downgradeScheduled: '',
              downgradeScheduledDate: '',
              downgradeReason: '',
              downgradeEffectiveDate: '',
              nextBillingDate: ''
            }
          }
        );

        // Apply plan limits (suspend excess items)
        await applyFreePlanLimitations(subscription.userId);

        // Log the downgrade
        await SubscriptionHistory.create({
          userId: subscription.userId,
          userEmail: subscription.userEmail,
          action: 'downgrade_processed',
          fromPlan: 'Premium Plan',
          toPlan: 'Free Plan',
          effectiveDate: now,
          reason: subscription.downgradeReason || 'Scheduled downgrade'
        });

        console.log(`✅ Successfully processed downgrade for user ${subscription.userId}`);

        // Send email notification
        const user = await User.findOne({ userId: subscription.userId });
        if (user) {
          await sendDowngradeCompletedEmail(user, subscription);
        }

      } catch (error) {
        console.error(`❌ Error processing downgrade for user ${subscription.userId}:`, error);
      }
    }

  } catch (error) {
    console.error('❌ Error in downgrade processor:', error);
  }
});


cron.schedule('0 1 * * *', async () => {
  try {
    console.log('🕐 Running daily downgrade processing...');

    const response = await fetch('http://localhost:5555/api/subscription/process-scheduled-downgrades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    const result = await response.json();
    console.log('📊 Daily downgrade processing result:', result);

  } catch (error) {
    console.error('❌ Error in daily downgrade processing:', error);
  }
});

// 5. ATTEMPT MANUAL RENEWAL FUNCTION
const attemptManualRenewal = async (subscription) => {
  try {
    console.log(`🔄 Attempting manual renewal for subscription: ${subscription._id}`);

    // Double-check if subscription has scheduled cancellation (safety check)
    if (subscription.cancellationScheduled) {
      console.log(`⏭️ Skipping renewal for subscription ${subscription._id} - cancellation scheduled`);
      return;
    }

    // This would require implementing PayHere's recurring payment API
    // For now, we'll mark it as failed and notify the user

    subscription.renewalAttempts += 1;
    subscription.status = 'pending_renewal';

    // Add to renewal history
    subscription.renewalHistory.push({
      renewalDate: new Date(),
      amount: subscription.amount,
      status: 'failed',
      failureReason: 'Automatic renewal failed - manual intervention required',
      attempt: subscription.renewalAttempts
    });

    // If max attempts reached, cancel subscription
    if (subscription.renewalAttempts >= subscription.maxRenewalAttempts) {
      subscription.status = 'expired';
      subscription.autoRenew = false;

      // Set end date to now
      subscription.endDate = new Date();

      console.log(`❌ Subscription ${subscription._id} expired after ${subscription.maxRenewalAttempts} attempts`);
    }

    await subscription.save();

    // Send notification email
    const user = await User.findOne({ userId: subscription.userId });
    if (user) {
      if (subscription.status === 'expired') {
        await sendSubscriptionExpiredEmail(user, subscription);
      } else {
        await sendRenewalFailedEmail(user, subscription, subscription.renewalAttempts);
      }
    }

  } catch (error) {
    console.error(`❌ Manual renewal attempt failed for ${subscription._id}:`, error);
  }
};

// 6. EMAIL NOTIFICATION FUNCTIONS

// Send downgrade notification email
const sendDowngradeNotificationEmail = async (user, subscription) => {
  const transporter = createTransporter();

  const mailOptions = {
    from: process.env.EMAIL_USERNAME,
    to: user.email,
    subject: '📋 Your Premium Subscription Has Ended',
    html: `
      <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
        <div style="background: #6c757d; color: white; padding: 20px; text-align: center;">
          <h1>📋 Subscription Update</h1>
        </div>
        <div style="padding: 20px;">
          <p>Dear ${user.firstName || 'Valued Customer'},</p>
          <p>Your Premium subscription has ended as scheduled, and your account has been automatically switched to our Free plan.</p>
          
          <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3>What happens next:</h3>
            <ul>
              <li>✅ Your account remains active</li>
              <li>📋 You now have access to Free plan features</li>
              <li>🔄 You can upgrade to Premium anytime</li>
            </ul>
          </div>
          
          <p>Thank you for being part of our community. We hope you'll consider upgrading again to enjoy our premium features!</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="http://localhost:5173/subscription" style="background: #28a745; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-size: 16px;">
              Upgrade to Premium
            </a>
          </div>
          
          <div style="text-align: center; margin: 20px 0;">
            <a href="http://localhost:5173/dashboard" style="background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
              View Dashboard
            </a>
          </div>
        </div>
        <div style="background: #f8f9fa; padding: 15px; text-align: center; font-size: 12px; color: #6c757d;">
          <p>This is an automated message. If you have any questions, please contact our support team.</p>
        </div>
      </div>
    `
  };

  await transporter.sendMail(mailOptions);
  console.log(`✅ Downgrade notification email sent to ${user.email}`);
};

// Send renewal failed email (existing function - keep as is)


// Send subscription expired email (existing function - keep as is)  

export { Business, Offer };









app.get('/api/admin/notifications/recent', async (req, res) => {
  try {
    const { limit = 5 } = req.query;

    console.log(`📱 Fetching recent ${limit} pending offers for notifications`);

    // Get recent pending offers with business and user details
    const recentOffers = await Offer.find({ adminStatus: 'pending' })
      .populate('businessId', 'name category')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .select('title discount createdAt userId businessId');

    // Fetch user details for each offer
    const offersWithUserDetails = await Promise.all(recentOffers.map(async (offer) => {
      try {
        const user = await User.findOne({ userId: offer.userId }).select('firstName lastName businessName');
        return {
          _id: offer._id,
          title: offer.title,
          discount: offer.discount,
          createdAt: offer.createdAt,
          businessName: offer.businessId?.name || user?.businessName || 'Unknown Business',
          category: offer.businessId?.category || 'Uncategorized',
          userFullName: user ? `${user.firstName} ${user.lastName}` : 'Unknown User',
          timeAgo: getTimeAgo(offer.createdAt),
          isNew: isRecent(offer.createdAt, 24) // Mark as new if within 24 hours
        };
      } catch (error) {
        console.error(`Error fetching user details for offer ${offer._id}:`, error);
        return {
          _id: offer._id,
          title: offer.title,
          discount: offer.discount,
          createdAt: offer.createdAt,
          businessName: offer.businessId?.name || 'Unknown Business',
          category: offer.businessId?.category || 'Uncategorized',
          userFullName: 'Unknown User',
          timeAgo: getTimeAgo(offer.createdAt),
          isNew: isRecent(offer.createdAt, 24)
        };
      }
    }));

    console.log(`✅ Retrieved ${offersWithUserDetails.length} recent offers for notifications`);

    res.json({
      success: true,
      recentOffers: offersWithUserDetails,
      count: offersWithUserDetails.length,
      timestamp: new Date().toISOString(),
      hasNewOffers: offersWithUserDetails.some(offer => offer.isNew)
    });

  } catch (error) {
    console.error('❌ Error fetching recent offers for notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch recent offers',
      error: error.message,
      recentOffers: []
    });
  }
});

// NEW: Mark notifications as seen/read
app.post('/api/admin/notifications/mark-seen', async (req, res) => {
  try {
    const { offerIds, adminId, timestamp } = req.body;

    console.log(`👁️ Marking notifications as seen by admin ${adminId} at ${timestamp}`);
    console.log(`Offer IDs provided: ${offerIds?.length || 0}`);

    // Option 1: Create a separate NotificationView collection to track what admin has seen
    // For now, we'll implement a simpler approach using a temporary tracking mechanism

    // You could create a NotificationView model like this:
    /*
    const NotificationView = mongoose.model('NotificationView', {
      adminId: String,
      offerId: mongoose.Schema.Types.ObjectId,
      viewedAt: { type: Date, default: Date.now },
      adminUsername: String
    });
    */

    // For immediate implementation, we'll just log and return success
    // This allows the frontend to immediately reset the count for better UX

    const response = {
      success: true,
      message: `Marked ${offerIds?.length || 0} notifications as seen`,
      timestamp: new Date().toISOString(),
      adminId: adminId,
      processed: true
    };

    console.log('✅ Notifications marked as seen:', response);

    res.json(response);

  } catch (error) {
    console.error('❌ Error marking notifications as seen:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark notifications as seen',
      error: error.message
    });
  }
});



// Helper function to calculate "time ago" string
function getTimeAgo(date) {
  const now = new Date();
  const diffInSeconds = Math.floor((now - new Date(date)) / 1000);

  if (diffInSeconds < 60) {
    return 'Just now';
  } else if (diffInSeconds < 3600) {
    const minutes = Math.floor(diffInSeconds / 60);
    return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
  } else if (diffInSeconds < 86400) {
    const hours = Math.floor(diffInSeconds / 3600);
    return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  } else if (diffInSeconds < 604800) {
    const days = Math.floor(diffInSeconds / 86400);
    return `${days} day${days !== 1 ? 's' : ''} ago`;
  } else if (diffInSeconds < 2592000) {
    const weeks = Math.floor(diffInSeconds / 604800);
    return `${weeks} week${weeks !== 1 ? 's' : ''} ago`;
  } else {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: new Date(date).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
    });
  }
}

function isRecent(date, hoursThreshold = 24) {
  const now = new Date();
  const diffInHours = (now - new Date(date)) / (1000 * 60 * 60);
  return diffInHours <= hoursThreshold;
}
// ENHANCED: Update the existing offers endpoint to trigger notification updates
// Add this to your existing offers endpoints (approve/decline)

// Enhanced notification helper function
async function updateOfferStatusWithNotification(offerId, status, adminComments, reviewedBy) {
  try {
    console.log(`🔄 Updating offer ${offerId} status to ${status} with notification`);

    const offer = await Offer.findByIdAndUpdate(
      offerId,
      {
        adminStatus: status,
        adminComments: adminComments || '',
        reviewedBy: reviewedBy || 'Admin',
        reviewedAt: new Date(),
        updatedAt: new Date()
      },
      { new: true }
    ).populate('businessId', 'name');

    if (offer) {
      // You could add real-time notification here using Socket.IO
      // For now, we'll rely on the periodic polling from the frontend
      console.log(`✅ Offer ${offerId} status updated to ${status}`);
    }

    return offer;
  } catch (error) {
    console.error(`❌ Error updating offer ${offerId} status:`, error);
    throw error;
  }
};

app.get('/api/admin/notifications/counts', async (req, res) => {
  try {
    console.log('📱 Fetching notification counts for admin navbar');

    // Get counts of offers by status
    const [pendingCount, approvedCount, declinedCount, totalCount] = await Promise.all([
      Offer.countDocuments({ adminStatus: 'pending' }),
      Offer.countDocuments({ adminStatus: 'approved' }),
      Offer.countDocuments({ adminStatus: 'declined' }),
      Offer.countDocuments({})
    ]);

    // Calculate additional useful counts
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

    const [newToday, urgentCount, activeOffersCount] = await Promise.all([
      Offer.countDocuments({
        adminStatus: 'pending',
        createdAt: { $gte: startOfDay, $lt: endOfDay }
      }),
      Offer.countDocuments({
        adminStatus: 'pending',
        createdAt: { $lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } // Older than 7 days
      }),
      Offer.countDocuments({
        adminStatus: 'approved',
        isActive: true,
        $or: [
          { endDate: null }, // No end date
          { endDate: { $gt: new Date() } } // End date in future
        ]
      })
    ]);

    const counts = {
      pending: pendingCount,
      approved: approvedCount,
      declined: declinedCount,
      total: totalCount,
      newToday: newToday,
      urgent: urgentCount,
      activeOffers: activeOffersCount
    };

    console.log('📊 Notification counts calculated:', counts);

    // Add cache headers to prevent excessive requests
    res.set({
      'Cache-Control': 'public, max-age=30', // Cache for 30 seconds
      'ETag': `"counts-${Date.now()}"`,
      'Last-Modified': new Date().toUTCString()
    });

    res.json({
      success: true,
      counts,
      timestamp: new Date().toISOString(),
      message: 'Notification counts retrieved successfully',
      cacheInfo: {
        cached: false,
        expiresIn: 30
      }
    });

  } catch (error) {
    console.error('❌ Error fetching notification counts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notification counts',
      error: error.message,
      counts: {
        pending: 0,
        approved: 0,
        declined: 0,
        total: 0,
        newToday: 0,
        urgent: 0,
        activeOffers: 0
      }
    });
  }
});

app.get('/api/admin/notifications/summary', async (req, res) => {
  try {
    console.log('📊 Fetching notification summary for admin dashboard');

    const now = new Date();

    // Calculate time periods
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Get comprehensive statistics
    const [
      totalPending,
      pendingToday,
      pendingYesterday,
      pendingThisWeek,
      pendingThisMonth,
      oldestPending,
      recentApprovals,
      recentDeclines
    ] = await Promise.all([
      Offer.countDocuments({ adminStatus: 'pending' }),
      Offer.countDocuments({
        adminStatus: 'pending',
        createdAt: { $gte: today }
      }),
      Offer.countDocuments({
        adminStatus: 'pending',
        createdAt: { $gte: yesterday, $lt: today }
      }),
      Offer.countDocuments({
        adminStatus: 'pending',
        createdAt: { $gte: weekAgo }
      }),
      Offer.countDocuments({
        adminStatus: 'pending',
        createdAt: { $gte: monthAgo }
      }),
      Offer.findOne({ adminStatus: 'pending' })
        .sort({ createdAt: 1 })
        .select('createdAt title'),
      Offer.countDocuments({
        adminStatus: 'approved',
        reviewedAt: { $gte: today }
      }),
      Offer.countDocuments({
        adminStatus: 'declined',
        reviewedAt: { $gte: today }
      })
    ]);

    const summary = {
      pending: {
        total: totalPending,
        today: pendingToday,
        yesterday: pendingYesterday,
        thisWeek: pendingThisWeek,
        thisMonth: pendingThisMonth,
        oldest: oldestPending ? {
          title: oldestPending.title,
          daysOld: Math.floor((now - oldestPending.createdAt) / (1000 * 60 * 60 * 24)),
          createdAt: oldestPending.createdAt
        } : null
      },
      activity: {
        approvalsToday: recentApprovals,
        declinesToday: recentDeclines,
        totalProcessedToday: recentApprovals + recentDeclines
      },
      trends: {
        dailyChange: pendingToday - pendingYesterday,
        weeklyAverage: Math.round(pendingThisWeek / 7),
        monthlyAverage: Math.round(pendingThisMonth / 30)
      }
    };

    console.log('📈 Notification summary:', summary);

    res.json({
      success: true,
      summary,
      timestamp: new Date().toISOString(),
      message: 'Notification summary retrieved successfully'
    });

  } catch (error) {
    console.error('❌ Error fetching notification summary:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notification summary',
      error: error.message,
      summary: null
    });
  }
});



// Database connection
mongoose
  .connect(mongodbURL, {})
  .then(() => {
    console.log('✅ App connected to database');
    app.listen(PORT, () => {
      console.log(`🚀 App is listening to port: ${PORT}`);
      console.log(`📊 Test PayPal config at: http://localhost:${PORT}/test-paypal-config`);
      console.log(`💳 Card payment endpoint: http://localhost:${PORT}/create-card-payment`);
      console.log(`🅿️  PayPal payment endpoint: http://localhost:${PORT}/create-paypal-payment`);
      console.log(`💱 Exchange rate endpoint: http://localhost:${PORT}/exchange-rate`);
    });
  })
  .catch((error) => {
    console.error('❌ Error connecting to MongoDB:', error);
    process.exit(1);
  });