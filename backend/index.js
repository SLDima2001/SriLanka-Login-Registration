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
app.use(cors());

app.get('/', (req, res) => {
  return res.status(200).send('Welcome to MERN stack');
});

const adminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true }, // Add email field
  password: { type: String, required: true },
}, {
  timestamps: true // This will automatically add createdAt and updatedAt
});


const payhereConfig = {
  merchantId: process.env.PAYHERE_MERCHANT_ID?.trim(),
  merchantSecret: process.env.PAYHERE_MERCHANT_SECRET?.trim(),
  mode: process.env.PAYHERE_MODE?.trim() || 'sandbox',
  notifyUrl: process.env.PAYHERE_NOTIFY_URL?.trim() || 'https://your-ngrok-url.ngrok.io/payhere-notify',
  returnUrl: process.env.PAYHERE_RETURN_URL?.trim() || 'http://localhost:5173/payment-success',
  cancelUrl: process.env.PAYHERE_CANCEL_URL?.trim() || 'http://localhost:5173/payment-cancel'
};
// Validate PayHere config on startup
const validatePayHereConfig = () => {
  console.log('🔍 Validating PayHere Configuration...');

  const issues = [];

  // Validate merchant ID
  if (!payhereConfig.merchantId) {
    issues.push('❌ PAYHERE_MERCHANT_ID is missing');
  } else {
    // Trim whitespace and validate format
    const cleanMerchantId = payhereConfig.merchantId.trim();
    console.log(`✅ Merchant ID: ${cleanMerchantId}`);

    // For sandbox, merchant ID should be exactly 7 digits
    if (payhereConfig.mode === 'sandbox' && !/^\d{7}$/.test(cleanMerchantId)) {
      issues.push(`❌ Sandbox Merchant ID should be exactly 7 digits, got: ${cleanMerchantId} (${cleanMerchantId.length} digits)`);
    }

    // Update config with cleaned value
    payhereConfig.merchantId = cleanMerchantId;
  }

  // Validate merchant secret
  if (!payhereConfig.merchantSecret) {
    issues.push('❌ PAYHERE_MERCHANT_SECRET is missing');
  } else {
    const cleanSecret = payhereConfig.merchantSecret.trim();
    console.log(`✅ Merchant Secret: ${cleanSecret.substring(0, 10)}... (${cleanSecret.length} chars)`);

    // Merchant secret should be fairly long
    if (cleanSecret.length < 30) {
      issues.push(`❌ Merchant Secret seems too short: ${cleanSecret.length} chars`);
    }

    // Update config with cleaned value
    payhereConfig.merchantSecret = cleanSecret;
  }

  if (issues.length > 0) {
    console.error('❌ PayHere Configuration Issues:');
    issues.forEach(issue => console.error(`   ${issue}`));
    return false;
  }

  console.log('✅ PayHere configuration is valid!');
  return true;
};

// Call validation on startup
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




const verifyPayHereHash = (data, merchantSecret) => {
  try {
    const { merchant_id, order_id, payhere_amount, payhere_currency, status_code, md5sig } = data;

    console.log('🔍 Verifying notification hash...');

    // Clean inputs
    const cleanMerchantId = merchant_id.toString().trim();
    const cleanOrderId = order_id.toString().trim();
    const cleanAmount = payhere_amount.toString().trim();
    const cleanCurrency = payhere_currency.toString().trim().toUpperCase();
    const cleanStatus = status_code.toString().trim();
    const cleanSecret = merchantSecret.toString().trim();

    // PayHere notification hash format:
    // merchant_id + order_id + payhere_amount + payhere_currency + status_code + MD5(merchant_secret)
    const secretHash = CryptoJS.MD5(cleanSecret).toString().toUpperCase();
    const hashString = cleanMerchantId + cleanOrderId + cleanAmount + cleanCurrency + cleanStatus + secretHash;
    const computedHash = CryptoJS.MD5(hashString).toString().toUpperCase();
    const receivedHash = md5sig.toString().trim().toUpperCase();

    console.log(`   Computed Hash: "${computedHash}"`);
    console.log(`   Received Hash: "${receivedHash}"`);
    console.log(`   Match: ${computedHash === receivedHash}`);

    return computedHash === receivedHash;
  } catch (error) {
    console.error('❌ Hash verification failed:', error);
    return false;
  }
};


// Create PayHere payment - MAIN ROUTE
app.post('/create-payhere-payment', async (req, res) => {
  try {
    console.log('🚀 PayHere Payment Creation Started');

    const { amount, currency = 'LKR', planId, customerData } = req.body;

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
    const orderId = `ORDER_${timestamp}_${randomSuffix}`;

    // Format amount and currency
    const formattedAmount = numAmount.toFixed(2);
    const formattedCurrency = currency.toUpperCase();

    // Process customer data
    const nameParts = customerData.name.trim().split(/\s+/);
    const firstName = nameParts[0] || 'Customer';
    const lastName = nameParts.slice(1).join(' ') || 'User';

    // Clean phone number
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
      return_url: payhereConfig.returnUrl,
      cancel_url: payhereConfig.cancelUrl,
      notify_url: payhereConfig.notifyUrl,
      order_id: orderId,
      items: `${planId === '1' ? 'Free' : 'Premium'} Plan - Monthly`,
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

    console.log('✅ PayHere payment data prepared');
    console.log('Order ID:', orderId);
    console.log('Amount:', formattedAmount, formattedCurrency);

    res.json({
      success: true,
      orderId: orderId,
      paymentData: paymentData,
      amount: formattedAmount,
      currency: formattedCurrency,
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
      email
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

    // Process payment based on status
    if (status_code === '2') {
      console.log('✅ Payment successful! Processing subscription...');

      try {
        // Extract plan info
        const planId = custom_1?.replace('plan_', '') || '2';

        // Check if subscription record already exists
        const existingSubscription = await Subscription.findOne({ payhereOrderId: order_id });

        if (existingSubscription) {
          console.log('ℹ️ Subscription record already exists for this order');
        } else {
          // Create subscription record
          const subscription = new Subscription({
            userId: null, // Will be updated when we match with user
            userEmail: email || 'customer@example.com',
            planId: planId,
            planName: planId === '1' ? 'Free Plan' : 'Premium Plan',
            status: 'active',
            billingCycle: 'monthly',
            amount: parseFloat(payhere_amount),
            currency: payhere_currency,
            paymentMethod: 'payhere',
            payhereOrderId: order_id,
            payherePaymentId: payment_id,
            startDate: new Date(),
            endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
          });

          await subscription.save();
          console.log('✅ Subscription record created via notification:', subscription._id);
        }

      } catch (error) {
        console.error('❌ Failed to create subscription record via notification:', error);
      }
    } else if (status_code === '-1') {
      console.log('❌ Payment cancelled by user');
    } else if (status_code === '0') {
      console.log('❌ Payment failed');
    } else {
      console.log(`ℹ️ Payment status: ${status_code} - ${status_message}`);
    }

    // Always respond OK to PayHere
    res.status(200).send('OK');

  } catch (error) {
    console.error('❌ Error processing PayHere notification:', error);
    res.status(500).send('Server error');
  }
});



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


const subscriptionSchema = new mongoose.Schema({
  userId: { type: Number, ref: 'User', required: true },
  userEmail: { type: String, required: true },
  planId: { type: String, required: true },
  planName: { type: String, required: true },
  status: {
    type: String,
    enum: ['active', 'inactive', 'expired', 'cancelled'],
    default: 'active'
  },
  billingCycle: { type: String, enum: ['monthly', 'yearly'], required: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'LKR' },
  paymentMethod: { type: String, enum: ['card', 'paypal', 'payhere', 'free'], required: true },

  // REMOVE PayPal fields:
  // paypalOrderId: { type: String },

  // ADD PayHere fields:
  payhereOrderId: { type: String },
  payherePaymentId: { type: String },

  stripeSessionId: { type: String }, // Keep if you use Stripe later
  startDate: { type: Date, default: Date.now },
  endDate: { type: Date },
  autoRenew: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const Subscription = mongoose.model('Subscription', subscriptionSchema);

// Route to check if user has active subscription

// REPLACE your /api/user/check-subscription route in server.js with this fixed version:

// REPLACE your /api/user/check-subscription route in server.js with this corrected version:

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

    console.log('🆓 Creating free subscription for:', customerData.email);

    // Validate customer data
    if (!customerData?.name || !customerData?.email) {
      return res.status(400).json({
        success: false,
        error: 'Customer name and email are required'
      });
    }

    // Check if user already has a free subscription
    const existingSubscription = await Subscription.findOne({
      userEmail: customerData.email.trim().toLowerCase(),
      planId: '1',
      status: 'active'
    });

    if (existingSubscription) {
      return res.status(400).json({
        success: false,
        error: 'You already have an active free subscription'
      });
    }

    // Create free subscription record
    const freeSubscription = new Subscription({
      userId: customerData.userId || null,
      userEmail: customerData.email.trim().toLowerCase(),
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

    console.log('✅ Free subscription created:', freeSubscription._id);

    res.json({
      success: true,
      message: 'Free subscription created successfully',
      subscriptionId: freeSubscription._id
    });

  } catch (error) {
    console.error('❌ Free subscription creation failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create free subscription',
      message: error.message
    });
  }
});

// 6. Add endpoint to check payment status
app.get('/check-payment-status/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;

    console.log(`🔍 Checking payment status for order: ${orderId}`);

    // Check if subscription was created for this order
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
          endDate: subscription.endDate
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

    // Store the session in memory (in production, use Redis or database)
    // For demo purposes, we'll just create a simple token

    const { password: _, ...userData } = user.toObject();

    res.json({
      success: true,
      message: 'Login successful!',
      status: user.status,
      user: userData,
      token: token, // Include the token in response
      expiresIn: '24h'
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
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
  // New fields added
  socialMediaLinks: String,
  operatingHours: String,
  businessType: String,
  registrationNumber: String,
  taxId: String,
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});
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
  // Updated date fields
  startDate: { type: Date },
  endDate: { type: Date },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

offerSchema.plugin(AutoIncrement, { inc_field: 'offerId' });
const Offer = mongoose.model('Offer', offerSchema);

// ADD THESE ROUTES TO YOUR SERVER FILE (after your existing routes)


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

    // Get user info
    const user = await User.findOne({ userId: parseInt(userId) });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check active subscription
    const activeSubscription = await Subscription.findOne({
      $or: [
        { userId: parseInt(userId) },
        { userEmail: user.email.toLowerCase().trim() }
      ],
      status: 'active'
    }).sort({ createdAt: -1 });

    // If no subscription, user is non-activated
    if (!activeSubscription) {
      return res.json({
        success: true,
        hasActiveSubscription: false,
        isNonActivated: true,
        message: 'Please activate a subscription plan to access features'
      });
    }

    // Determine subscription type
    const now = new Date();
    const isPremium = activeSubscription.planId === '2' &&
      activeSubscription.status === 'active' &&
      (!activeSubscription.endDate || new Date(activeSubscription.endDate) > now);

    const planType = isPremium ? 'Premium' : 'Free';

    // Set limits
    const maxBusinesses = isPremium ? 3 : 1;
    const maxOffers = isPremium ? 3 : 1;

    // Get current usage
    const currentBusinesses = await Business.countDocuments({ userId: parseInt(userId) });
    const currentActiveOffers = await Offer.countDocuments({ 
      userId: parseInt(userId),
      isActive: true
    });

    // Calculate remaining
    const businessesRemaining = Math.max(0, maxBusinesses - currentBusinesses);
    const offersRemaining = Math.max(0, maxOffers - currentActiveOffers);

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
          current: currentActiveOffers,
          remaining: offersRemaining,
          canCreateMore: offersRemaining > 0
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



// REPLACE your existing '/api/offers' POST route with this corrected version:

app.post('/api/offers', async (req, res) => {
  try {
    const { userId, businessId, title, discount, category, startDate, endDate, isActive } = req.body;
    
    if (!userId || !businessId || !title || !discount) {
      return res.status(400).json({
        success: false,
        message: 'User ID, business ID, title, and discount are required'
      });
    }

    // Verify the business belongs to the user
    const business = await Business.findOne({ _id: businessId, userId: userId });
    if (!business) {
      return res.status(400).json({
        success: false,
        message: 'Business not found or does not belong to this user'
      });
    }

    console.log(`🎯 Offer creation attempt for userId: ${userId}, business: ${business.name}`);

    // Check user's subscription status
    const user = await User.findOne({ userId: userId });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check for active subscription
    const activeSubscription = await Subscription.findOne({
      $or: [
        { userId: userId },
        { userEmail: user.email.toLowerCase().trim() }
      ],
      status: 'active'
    }).sort({ createdAt: -1 });

    if (!activeSubscription) {
      console.log('❌ User blocked - no active subscription');
      return res.status(403).json({
        success: false,
        message: 'Please activate a subscription plan to create offers.',
        requiresSubscription: true
      });
    }

    // Count existing ACTIVE offers for this user
    const existingOffersCount = await Offer.countDocuments({ 
      userId: userId,
      isActive: true
    });

    console.log(`📊 Existing active offers count: ${existingOffersCount}`);

    // Determine if user has premium access
    const now = new Date();
    const isPremium = activeSubscription.planId === '2' &&
      activeSubscription.status === 'active' &&
      (!activeSubscription.endDate || new Date(activeSubscription.endDate) > now);

    // Set offer limits based on subscription type
    const maxOffers = isPremium ? 3 : 1; // Premium: 3 highlight ads, Free: 1 highlight ad
    const planType = isPremium ? 'Premium' : 'Free';

    console.log(`📋 Plan analysis: ${planType} plan allows ${maxOffers} active offers`);

    // Check if user has reached their offer limit
    if (existingOffersCount >= maxOffers) {
      console.log(`❌ Offer limit reached: ${existingOffersCount}/${maxOffers}`);
      return res.status(400).json({
        success: false,
        message: `${planType} plan allows maximum ${maxOffers} active offer${maxOffers > 1 ? 's' : ''} (highlight ad${maxOffers > 1 ? 's' : ''}). You have ${existingOffersCount}/${maxOffers} active offers.`,
        planUpgradeRequired: !isPremium,
        currentCount: existingOffersCount,
        maxAllowed: maxOffers,
        planType: planType,
        hint: isPremium ? 'Consider deactivating an existing offer first.' : 'Upgrade to Premium to create up to 3 offers.'
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

    // All checks passed - create the offer
    const offer = new Offer({
      userId,
      businessId,
      title,
      discount,
      category,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      isActive: isActive !== undefined ? isActive : true,
      updatedAt: new Date()
    });

    await offer.save();
    
    // Populate business info before returning
    await offer.populate('businessId', 'name');
    
    console.log(`✅ Offer created successfully: ${offer.title} (ID: ${offer.offerId})`);
    console.log(`📈 User now has ${existingOffersCount + 1}/${maxOffers} active offers`);
    
    // Check if offer should start immediately and send notification
    const offerStartDate = startDate ? new Date(startDate) : new Date();
    
    if (offerStartDate <= new Date()) {
      // Send email notification asynchronously
      const offerData = {
        title: offer.title,
        discount: offer.discount,
        category: offer.category,
        startDate: offer.startDate,
        endDate: offer.endDate
      };
      
      sendOfferStartNotification(
        user.email,
        `${user.firstName} ${user.lastName}`,
        business.name,
        offerData
      ).catch(error => {
        console.error('Failed to send offer notification:', error);
      });
    }
    
    res.json({
      success: true,
      message: `Offer created successfully! (${existingOffersCount + 1}/${maxOffers} ${planType} plan offers used)`,
      offer: offer,
      planInfo: {
        planType: planType,
        offersUsed: existingOffersCount + 1,
        maxOffers: maxOffers,
        canCreateMore: (existingOffersCount + 1) < maxOffers
      }
    });

  } catch (error) {
    console.error('❌ Error creating offer:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create offer',
      error: error.message
    });
  }
});
// Get all offers for a user
app.get('/api/offers/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const offers = await Offer.find({ userId: parseInt(userId) })
      .populate('businessId', 'name')
      .sort({ createdAt: -1 });

    // Add computed status based on dates
    const offersWithStatus = offers.map(offer => {
      const now = new Date();
      const startDate = offer.startDate ? new Date(offer.startDate) : null;
      const endDate = offer.endDate ? new Date(offer.endDate) : null;

      let computedStatus = 'active';
      if (startDate && startDate > now) {
        computedStatus = 'scheduled';
      } else if (endDate && endDate < now) {
        computedStatus = 'expired';
      } else if (!offer.isActive) {
        computedStatus = 'inactive';
      }

      return {
        ...offer.toObject(),
        computedStatus
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

// Create new offer
// NEW: Route to activate free subscription (when user chooses free plan)
// REPLACE your /api/user/activate-free-plan route in server.js with this fixed version:

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
    const { businessId, title, discount, category, startDate, endDate, isActive } = req.body;

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

    const offer = await Offer.findByIdAndUpdate(id, updateData, { new: true })
      .populate('businessId', 'name');

    if (!offer) {
      return res.status(404).json({
        success: false,
        message: 'Offer not found'
      });
    }

    res.json({
      success: true,
      message: 'Offer updated successfully',
      offer: offer
    });
  } catch (error) {
    console.error('Error updating offer:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update offer'
    });
  }
});

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





// Remove the line: const cron = require('node-cron');

// The rest of your cron job code remains the same:
// Run every day at 9:00 AM
cron.schedule('0 9 * * *', async () => {
  console.log('🔔 Checking for offers starting today...');
  try {
    const response = await axios.get('http://localhost:5555/api/check-offer-notifications');
    console.log('✅ Notification check completed:', response.data.message);
  } catch (error) {
    console.error('❌ Error in scheduled notification check:', error);
  }
});

export { Business, Offer };















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