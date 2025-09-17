import express from 'express';
import { User, Subscription, Business, Offer } from '../models/index.js';

const router = express.Router();

// Activate Free Plan
router.post('/activate-free-plan', async (req, res) => {
  try {
    const { userId, userEmail, userName } = req.body;

    if (!userEmail) {
      return res.status(400).json({
        success: false,
        message: 'User email is required'
      });
    }

    console.log('🆓 Attempting to activate free plan for:', userEmail);

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
      endDate: null
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

// Get User Usage Limits
router.get('/:userId/usage-limits', async (req, res) => {
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

    const currentApprovedOffers = await Offer.countDocuments({
      userId: parseInt(userId),
      adminStatus: 'approved',
      isActive: true
    });

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
          pending: pendingOffers
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

// Debug User Subscription
router.get('/debug/user-subscription/:email', async (req, res) => {
  try {
    const { email } = req.params;

    console.log('🔍 DEBUG: Checking user and subscriptions for:', email);

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    console.log('User found:', user ? {
      userId: user.userId,
      email: user.email,
      firstName: user.firstName,
      createdAt: user.createdAt
    } : 'NOT FOUND');

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

// Clean User Subscriptions
router.delete('/debug/clean-user-subscriptions/:email', async (req, res) => {
  try {
    const { email } = req.params;

    console.log('🧹 CLEANUP: Removing all subscriptions for:', email);

    const user = await User.findOne({ email: email.toLowerCase().trim() });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

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

// Token verification middleware
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Access token is required'
    });
  }

  try {
    next();
  } catch (error) {
    return res.status(403).json({
      success: false,
      message: 'Invalid or expired token'
    });
  }
};

// Verify Token
router.get('/verify-token', verifyToken, async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    console.log('Token verification request received');
    console.log('Token:', token.substring(0, 10) + '...');

    res.json({
      success: true,
      message: 'Token is valid',
      user: null
    });

  } catch (error) {
    console.error('Token verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Token verification failed'
    });
  }
});

// Get User Profile by ID
router.get('/profile/:userId', verifyToken, async (req, res) => {
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

// Get User Profile by Email
router.post('/profile-by-email', verifyToken, async (req, res) => {
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

export default router;