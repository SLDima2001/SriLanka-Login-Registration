import express from 'express';
import { Subscription, SubscriptionLog, SubscriptionHistory, User, Business, Offer } from '../models/index.js';
import { sendSubscriptionCancelledEmail } from '../services/emailService.js';
import { getDowngradeImpactAnalysis, getUserName } from '../services/subscriptionService.js';

const router = express.Router();

// Check User Subscription
router.post('/check-subscription', async (req, res) => {
  try {
    const { email, userId } = req.body;

    if (!email && !userId) {
      return res.status(400).json({
        success: false,
        message: 'Email or userId is required'
      });
    }

    console.log('🔍 Checking subscription for email:', email, 'userId:', userId);

    let user = null;
    if (userId) {
      user = await User.findOne({ userId: userId });
    } else if (email) {
      user = await User.findOne({ email: email.toLowerCase().trim() });
    }

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

    const subscription = await Subscription.findOne({
      $or: [
        { userId: user.userId },
        { userEmail: user.email.toLowerCase().trim() }
      ]
    }).sort({ createdAt: -1 });

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

    if (!subscription) {
      console.log('➡️  User is NON-ACTIVATED (no subscription record found)');
      return res.json({
        success: true,
        hasSubscription: false,
        hasActiveSubscription: false,
        isPremiumUser: false,
        isFreeUser: false,
        isNonActivated: true,
        userExists: true,
        subscription: null
      });
    }

    const now = new Date();

    const isActivePremium = subscription.planId === '2' &&
      subscription.status === 'active' &&
      (!subscription.endDate || new Date(subscription.endDate) > now);

    const isActiveFree = subscription.planId === '1' &&
      subscription.status === 'active';

    console.log('📊 Subscription analysis:', {
      planId: subscription.planId,
      status: subscription.status,
      endDate: subscription.endDate,
      isActivePremium,
      isActiveFree
    });

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
        hasActiveSubscription: false,
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
      console.log('➡️  User has EXPIRED/INACTIVE subscription');
      return res.json({
        success: true,
        hasSubscription: true,
        hasActiveSubscription: false,
        isPremiumUser: false,
        isFreeUser: false,
        isNonActivated: true,
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

// Cancel Auto-Renewal
router.post('/cancel-auto-renewal', async (req, res) => {
  try {
    const { userId, userEmail } = req.body;

    if (!userId && !userEmail) {
      return res.status(400).json({
        success: false,
        message: 'User ID or email is required'
      });
    }

    const subscription = await Subscription.findOne({
      $or: [
        { userId: userId },
        { userEmail: userEmail?.toLowerCase().trim() }
      ],
      status: 'active',
      autoRenew: true
    });

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'Active auto-renewal subscription not found'
      });
    }

    subscription.autoRenew = false;
    subscription.nextBillingDate = null;
    subscription.updatedAt = new Date();

    await subscription.save();

    const user = await User.findOne({ userId: subscription.userId });
    if (user) {
      await sendSubscriptionCancelledEmail(user, subscription);
    }

    res.json({
      success: true,
      message: 'Auto-renewal cancelled successfully. Your subscription will remain active until the end date.',
      subscription: {
        endDate: subscription.endDate,
        autoRenew: subscription.autoRenew
      }
    });

  } catch (error) {
    console.error('Error cancelling auto-renewal:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel auto-renewal'
    });
  }
});

// Reactivate Auto-Renewal
router.post('/reactivate-auto-renewal', async (req, res) => {
  try {
    const { userId, userEmail } = req.body;

    const subscription = await Subscription.findOne({
      $or: [
        { userId: userId },
        { userEmail: userEmail?.toLowerCase().trim() }
      ],
      status: 'active',
      planId: '2'
    });

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'Active premium subscription not found'
      });
    }

    if (!subscription.payhereRecurringToken) {
      return res.status(400).json({
        success: false,
        message: 'This subscription does not support auto-renewal. Please create a new subscription.'
      });
    }

    subscription.autoRenew = true;
    subscription.nextBillingDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    subscription.renewalAttempts = 0;
    subscription.updatedAt = new Date();

    await subscription.save();

    res.json({
      success: true,
      message: 'Auto-renewal reactivated successfully',
      subscription: {
        nextBillingDate: subscription.nextBillingDate,
        autoRenew: subscription.autoRenew
      }
    });

  } catch (error) {
    console.error('Error reactivating auto-renewal:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reactivate auto-renewal'
    });
  }
});

// Get Renewal History
router.get('/renewal-history/:userId', async (req, res) => {
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

// Check Subscription with Renewal
router.post('/check-subscription-with-renewal', async (req, res) => {
  try {
    const { email, userId } = req.body;

    if (!email && !userId) {
      return res.status(400).json({
        success: false,
        message: 'Email or userId is required'
      });
    }

    console.log('Checking subscription with auto-renewal for:', email, 'userId:', userId);

    let user = null;
    if (userId) {
      user = await User.findOne({ userId: userId });
    } else if (email) {
      user = await User.findOne({ email: email.toLowerCase().trim() });
    }

    if (!user) {
      console.log('User not found in database');
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

    const subscription = await Subscription.findOne({
      $or: [
        { userId: user.userId },
        { userEmail: user.email.toLowerCase().trim() }
      ]
    }).sort({ createdAt: -1 });

    if (!subscription) {
      console.log('No subscription found for this user');
      return res.json({
        success: true,
        hasSubscription: false,
        hasActiveSubscription: false,
        isPremiumUser: false,
        isFreeUser: false,
        isNonActivated: true,
        userExists: true,
        subscription: null
      });
    }

    const now = new Date();

    let subscriptionStatus = {
      hasSubscription: true,
      hasActiveSubscription: false,
      isPremiumUser: false,
      isFreeUser: false,
      isNonActivated: false,
      userExists: true,
      autoRenewal: {
        enabled: subscription.autoRenew || false,
        nextBillingDate: subscription.nextBillingDate,
        renewalAttempts: subscription.renewalAttempts || 0,
        maxAttempts: subscription.maxRenewalAttempts || 3,
        status: subscription.status
      }
    };

    const isActivePremium = subscription.planId === '2' &&
      subscription.status === 'active' &&
      (!subscription.endDate || new Date(subscription.endDate) > now);

    const isActiveFree = subscription.planId === '1' &&
      subscription.status === 'active';

    const isPendingRenewal = subscription.status === 'pending_renewal' &&
      subscription.autoRenew &&
      subscription.renewalAttempts < subscription.maxRenewalAttempts;

    if (isActivePremium || isPendingRenewal) {
      subscriptionStatus.isPremiumUser = true;
      subscriptionStatus.hasActiveSubscription = true;

      if (isPendingRenewal) {
        subscriptionStatus.renewalWarning = true;
        subscriptionStatus.message = `Payment renewal pending (attempt ${subscription.renewalAttempts}/${subscription.maxRenewalAttempts})`;
      }
    } else if (isActiveFree) {
      subscriptionStatus.isFreeUser = true;
    } else {
      subscriptionStatus.isNonActivated = true;
    }

    subscriptionStatus.subscription = {
      planId: subscription.planId,
      planName: subscription.planName,
      status: subscription.status,
      billingCycle: subscription.billingCycle,
      endDate: subscription.endDate,
      paymentMethod: subscription.paymentMethod,
      amount: subscription.amount,
      currency: subscription.currency,
      autoRenew: subscription.autoRenew,
      nextBillingDate: subscription.nextBillingDate,
      renewalAttempts: subscription.renewalAttempts,
      hasRecurringToken: !!subscription.payhereRecurringToken
    };

    console.log('Subscription status with auto-renewal:', subscriptionStatus);

    res.json({
      success: true,
      ...subscriptionStatus
    });

  } catch (error) {
    console.error('Error checking subscription with renewal:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while checking subscription'
    });
  }
});

// Schedule Cancellation
router.post('/schedule-cancellation', async (req, res) => {
  try {
    const { userId, userEmail, reason } = req.body;

    const subscription = await Subscription.findOne({
      $or: [
        { userId: userId },
        { userEmail: userEmail }
      ],
      status: 'active',
      planId: '2'
    });

    if (!subscription) {
      return res.json({
        success: false,
        message: 'No active premium subscription found'
      });
    }

    if (subscription.cancellationScheduled) {
      return res.json({
        success: false,
        message: 'Cancellation is already scheduled for this subscription'
      });
    }

    const updateResult = await Subscription.updateOne(
      { _id: subscription._id },
      {
        $set: {
          cancellationScheduled: true,
          cancellationScheduledDate: new Date(),
          cancellationReason: reason || 'User requested cancellation',
          cancellationEffectiveDate: subscription.nextBillingDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          autoRenew: false,
          updatedAt: new Date()
        }
      }
    );

    if (updateResult.modifiedCount > 0) {
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

// Cancel Scheduled Cancellation
router.post('/cancel-scheduled-cancellation', async (req, res) => {
  try {
    const { userId } = req.body;

    const updateResult = await Subscription.updateOne(
      {
        userId: userId,
        status: 'active',
        cancellationScheduled: true
      },
      {
        $unset: {
          cancellationScheduled: '',
          cancellationScheduledDate: '',
          cancellationReason: '',
          cancellationEffectiveDate: ''
        },
        $set: {
          autoRenew: true,
          updatedAt: new Date()
        }
      }
    );

    if (updateResult.modifiedCount > 0) {
      await SubscriptionLog.create({
        userId: userId,
        action: 'cancellation_cancelled',
        details: {
          reactivatedDate: new Date(),
          autoRenewalRestored: true
        },
        timestamp: new Date()
      });

      res.json({
        success: true,
        message: 'Subscription reactivated successfully! Your premium features will continue and auto-renewal has been re-enabled.'
      });
    } else {
      res.json({
        success: false,
        message: 'No scheduled cancellation found to cancel'
      });
    }

  } catch (error) {
    console.error('Error cancelling scheduled cancellation:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while reactivating subscription'
    });
  }
});

// Get Cancellation Details
router.get('/cancellation-details/:userId', async (req, res) => {
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

// Check Subscription with Cancellation
router.post('/check-with-cancellation', async (req, res) => {
  try {
    const { email, userId } = req.body;

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

    const now = new Date();
    const isExpired = subscription.endDate && new Date(subscription.endDate) < now;

    const isInGracePeriod = subscription.cancellationScheduled &&
      subscription.status === 'active' &&
      subscription.cancellationEffectiveDate &&
      new Date(subscription.cancellationEffectiveDate) > now;

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

    let cancellationInfo = null;
    if (subscription.cancellationScheduled) {
      cancellationInfo = {
        scheduledDate: subscription.cancellationScheduledDate,
        effectiveDate: subscription.cancellationEffectiveDate,
        reason: subscription.cancellationReason,
        daysRemaining: Math.ceil((new Date(subscription.cancellationEffectiveDate) - now) / (1000 * 60 * 60 * 24))
      };
    }

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

// Schedule Downgrade
router.post('/schedule-downgrade', async (req, res) => {
  try {
    const { userId, userEmail, reason, targetPlan = 'free' } = req.body;

    console.log('📝 Downgrade request received:', { userId, userEmail, reason, targetPlan });

    if (!userId && !userEmail) {
      return res.status(400).json({
        success: false,
        message: 'Either userId or userEmail is required'
      });
    }

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Reason for downgrade is required'
      });
    }

    const subscription = await Subscription.findOne({
      $or: [
        { userId: userId },
        { userEmail: userEmail }
      ],
      status: 'active',
      planId: '2'
    });

    if (!subscription) {
      return res.status(400).json({
        success: false,
        message: 'No active premium subscription found'
      });
    }

    if (subscription.downgradeScheduled) {
      const effectiveDate = new Date(subscription.downgradeEffectiveDate).toLocaleDateString();
      return res.status(400).json({
        success: false,
        message: `Downgrade is already scheduled for this subscription. Your subscription will end on ${effectiveDate} and switch to Free plan.`,
        alreadyScheduled: true,
        effectiveDate: subscription.downgradeEffectiveDate
      });
    }

    const effectiveDate = subscription.nextBillingDate || 
                         new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const updateResult = await Subscription.updateOne(
      { _id: subscription._id },
      {
        $set: {
          downgradeScheduled: true,
          downgradeScheduledDate: new Date(),
          downgradeReason: reason.trim(),
          downgradeEffectiveDate: effectiveDate,
          downgradeTargetPlan: targetPlan,
          autoRenew: false,
          updatedAt: new Date()
        }
      }
    );

    if (updateResult.modifiedCount > 0) {
      await SubscriptionHistory.create({
        userId: userId,
        userEmail: userEmail || subscription.userEmail,
        action: 'downgrade_scheduled',
        fromPlan: subscription.planName,
        toPlan: 'Free Plan',
        reason: reason.trim(),
        scheduledDate: new Date(),
        effectiveDate: effectiveDate,
        notes: `User requested downgrade: ${reason.trim()}`
      });

      await SubscriptionLog.create({
        subscriptionId: subscription._id,
        userId: userId,
        userEmail: userEmail || subscription.userEmail,
        action: 'downgrade_scheduled',
        details: {
          reason: reason.trim(),
          scheduledDate: new Date(),
          effectiveDate: effectiveDate,
          targetPlan: targetPlan,
          remainingDays: Math.ceil((effectiveDate - new Date()) / (1000 * 60 * 60 * 24))
        },
        timestamp: new Date()
      });

      const formattedEffectiveDate = effectiveDate.toLocaleDateString();
      const daysRemaining = Math.ceil((effectiveDate - new Date()) / (1000 * 60 * 60 * 24));

      res.json({
        success: true,
        message: `Downgrade scheduled successfully! You'll continue to enjoy Premium features until ${formattedEffectiveDate} (${daysRemaining} days remaining), then your account will automatically switch to the Free plan.`,
        effectiveDate: effectiveDate,
        formattedEffectiveDate: formattedEffectiveDate,
        daysRemaining: daysRemaining,
        targetPlan: 'Free Plan'
      });
    } else {
      res.status(500).json({
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

// Cancel Scheduled Downgrade
router.post('/cancel-scheduled-downgrade', async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'UserId is required'
      });
    }

    console.log('🔄 Cancelling scheduled downgrade for userId:', userId);

    const subscription = await Subscription.findOne({
      userId: userId,
      status: 'active',
      downgradeScheduled: true
    });

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'No scheduled downgrade found for this subscription'
      });
    }

    const updateResult = await Subscription.updateOne(
      { _id: subscription._id },
      {
        $unset: {
          downgradeScheduled: '',
          downgradeScheduledDate: '',
          downgradeReason: '',
          downgradeEffectiveDate: '',
          downgradeTargetPlan: ''
        },
        $set: {
          autoRenew: true,
          updatedAt: new Date()
        }
      }
    );

    if (updateResult.modifiedCount > 0) {
      await SubscriptionHistory.create({
        userId: userId,
        userEmail: subscription.userEmail,
        action: 'downgrade_cancelled',
        fromPlan: 'Scheduled Free Plan',
        toPlan: subscription.planName,
        reason: 'User cancelled scheduled downgrade',
        effectiveDate: new Date(),
        notes: 'User decided to keep Premium subscription'
      });

      await SubscriptionLog.create({
        subscriptionId: subscription._id,
        userId: userId,
        userEmail: subscription.userEmail,
        action: 'downgrade_cancelled',
        details: {
          cancelledDate: new Date(),
          autoRenewalRestored: true,
          previousEffectiveDate: subscription.downgradeEffectiveDate
        },
        timestamp: new Date()
      });

      console.log('✅ Downgrade cancellation successful');

      res.json({
        success: true,
        message: 'Downgrade cancelled successfully! Your Premium subscription will continue and auto-renewal has been re-enabled.'
      });
    } else {
      res.status(500).json({
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

// Get Downgrade Impact
router.get('/downgrade-impact/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'UserId is required'
      });
    }

    console.log('📊 Calculating downgrade impact for userId:', userId);

    const businesses = await Business.find({ userId: parseInt(userId), status: 'active' });
    const offers = await Offer.find({ userId: parseInt(userId), status: 'active' });

    const currentBusinesses = businesses.length;
    const currentOffers = offers.length;

    const freeLimits = { maxBusinesses: 1, maxOffers: 3 };

    const businessesToRemove = Math.max(0, currentBusinesses - freeLimits.maxBusinesses);
    const offersToRemove = Math.max(0, currentOffers - freeLimits.maxOffers);

    console.log('📈 Impact calculation:', {
      currentBusinesses,
      currentOffers,
      businessesToRemove,
      offersToRemove
    });

    res.json({
      success: true,
      currentBusinesses,
      currentOffers,
      businessesToRemove,
      offersToRemove,
      freeLimits
    });

  } catch (error) {
    console.error('❌ Error calculating downgrade impact:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while calculating downgrade impact'
    });
  }
});

// Process Scheduled Downgrades
router.post('/process-downgrades', async (req, res) => {
  try {
    console.log('🔄 Processing scheduled downgrades...');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const subscriptionsToDowngrade = await Subscription.find({
      downgradeScheduled: true,
      downgradeEffectiveDate: { $lte: today },
      status: 'active'
    });

    console.log(`📋 Found ${subscriptionsToDowngrade.length} subscriptions to downgrade`);

    const results = [];

    for (const subscription of subscriptionsToDowngrade) {
      try {
        const freeSubscription = new Subscription({
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

        const businesses = await Business.find({ userId: subscription.userId, status: 'active' })
          .sort({ createdAt: 1 });
        const offers = await Offer.find({ userId: subscription.userId, status: 'active' })
          .sort({ createdAt: 1 });

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
            offersSuspended: Math.max(0, offers.length - 3)
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

// Check Subscription with Downgrade
router.post('/check-subscription-with-downgrade', async (req, res) => {
  try {
    const { email, userId } = req.body;

    console.log('🔍 Checking subscription with downgrade info for:', { email, userId });

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

    const now = new Date();
    const isExpired = subscription.endDate && subscription.endDate < now;
    const isActive = subscription.status === 'active' && !isExpired;

    const isPremium = isActive && subscription.planId === '2';
    const isFree = isActive && subscription.planId === '1';

    const isInGracePeriod = subscription.downgradeScheduled && 
                           subscription.downgradeEffectiveDate && 
                           subscription.downgradeEffectiveDate > now &&
                           subscription.planId === '2';

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

// Reactivate Content
router.post('/reactivate-content', async (req, res) => {
  try {
    const { userId, userEmail } = req.body;

    console.log('🔄 Reactivating suspended content for user:', userId);

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

export default router;