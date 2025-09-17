import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { User, Admin, Subscription } from '../models/index.js';
import { sendStatusEmail, sendWelcomeEmail } from '../services/emailService.js';

const router = express.Router();
const resetTokens = new Map();

// User Registration
router.post('/register', async (req, res) => {
  try {
    const existingUser = await User.findOne({ email: req.body.email });
    if (existingUser) {
      return res.json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    const hashedPassword = await bcrypt.hash(req.body.password, 10);

    const user = new User({
      ...req.body,
      password: hashedPassword,
      status: 'approved'
    });

    await user.save();
    console.log('✅ User registered successfully:', user.email, 'userId:', user.userId);

    try {
      await sendWelcomeEmail(user);
    } catch (emailError) {
      console.error('❌ Welcome email failed (registration still successful):', emailError);
    }

    console.log('🔄 User registered with NO subscription - user is non-activated');

    res.json({
      success: true,
      message: 'Registration successful! Please sign in to choose your subscription plan.',
      userId: user.userId,
      emailSent: true,
      subscriptionCreated: false
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

// User Login
router.post('/login', async (req, res) => {
  try {
    const user = await User.findOne({ email: req.body.email });
    if (!user) return res.json({ success: false, message: 'User not found' });

    const isMatch = await bcrypt.compare(req.body.password, user.password);
    if (!isMatch) return res.json({ success: false, message: 'Invalid credentials' });

    if (user.status !== 'approved') {
      return res.json({ success: false, message: 'Your account is not approved yet.' });
    }

    console.log('🔐 User logged in:', user.email, 'userId:', user.userId);

    console.log('🔍 Checking subscription status for redirect...');

    const subscription = await Subscription.findOne({
      $or: [
        { userId: user.userId },
        { userEmail: user.email.toLowerCase().trim() }
      ]
    }).sort({ createdAt: -1 });

    let redirectTo = 'subscription';
    let subscriptionStatus = 'non-activated';

    if (subscription) {
      const now = new Date();

      const isActivePremium = subscription.planId === '2' &&
        subscription.status === 'active' &&
        (!subscription.endDate || new Date(subscription.endDate) > now);

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
        redirectTo = 'subscription';
        subscriptionStatus = 'expired';
        console.log('➡️  User has expired/inactive subscription, redirecting to Subscription Page');
      }
    } else {
      redirectTo = 'subscription';
      subscriptionStatus = 'non-activated';
      console.log('➡️  Non-activated user detected, redirecting to Subscription Page');
    }

    const { password, ...userData } = user.toObject();

    res.json({
      success: true,
      message: 'Login successful!',
      status: user.status,
      user: userData,
      subscriptionStatus: subscriptionStatus,
      redirectTo: redirectTo,
      subscription: subscription ? {
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

// Forgot Password
router.post('/forgot-password', async (req, res) => {
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

// Reset Password
router.post('/reset-password/:token', async (req, res) => {
  const stored = resetTokens.get(req.params.token);
  if (!stored || stored.expiry < Date.now()) return res.json({ success: false, message: 'Invalid or expired token' });

  const user = await User.findOne({ email: stored.email });
  if (!user) return res.json({ success: false, message: 'User not found' });

  user.password = await bcrypt.hash(req.body.password, 10);
  await user.save();

  resetTokens.delete(req.params.token);
  res.json({ success: true, message: 'Password reset successful' });
});

// Get All Users
router.get('/users', async (req, res) => {
  try {
    const users = await User.find({}, '-password').lean();

    const usersWithSubscriptions = await Promise.all(users.map(async (user) => {
      try {
        const subscription = await Subscription.findOne({
          userId: user.userId
        }).sort({ createdAt: -1 }).lean();

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

          const isExpired = endDate && endDate < now;

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

        return {
          ...user,
          subscription: subscriptionInfo
        };

      } catch (subscriptionError) {
        console.error(`Error fetching subscription for user ${user.userId}:`, subscriptionError);
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

// Get User Subscription Details
router.get('/user/:userId/subscription-details', async (req, res) => {
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

// Delete User
router.delete('/users/:id', async (req, res) => {
  try {
    const deletedUser = await User.findByIdAndDelete(req.params.id);
    if (!deletedUser) return res.status(404).json({ success: false, message: 'User not found' });

    res.json({ success: true, message: 'User deleted successfully!' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error deleting user', error: error.message });
  }
});

// Update User Status (Approve/Decline)
router.patch('/users/:id/:action', async (req, res) => {
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

// Update User
router.put('/users/:id', async (req, res) => {
  try {
    const { firstName, lastName, address, email, phone, businessName, businessRegNo, businessAddress, userType } = req.body;

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

export default router;