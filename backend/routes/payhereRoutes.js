import express from 'express';
import { payhereConfig, generatePayHereHash, verifyPayHereHash } from '../services/payhereService.js';
import { Subscription } from '../models/index.js';
import {
  handleInitialPaymentWithRecurring,
  handleRecurringPaymentNotification,
  handleSubscriptionCancellationNotification,
  handleInitialSubscription,
  handleRecurringPayment,
  handleSubscriptionCancellation
} from '../services/subscriptionService.js';

const router = express.Router();

// Create PayHere Payment
router.post('/create-payhere-payment', async (req, res) => {
  try {
    console.log('🚀 PayHere Payment Creation Started');

    const { amount, currency = 'LKR', planId, customerData } = req.body;

    if (!payhereConfig.merchantId || !payhereConfig.merchantSecret) {
      console.error('❌ PayHere configuration missing');
      return res.status(500).json({
        success: false,
        error: 'PayHere configuration invalid'
      });
    }

    const numAmount = parseFloat(amount);
    if (!amount || isNaN(numAmount) || numAmount < 1) {
      return res.status(400).json({
        success: false,
        error: 'Amount must be at least LKR 1.00'
      });
    }

    if (!customerData?.name || !customerData?.email) {
      return res.status(400).json({
        success: false,
        error: 'Customer name and email are required'
      });
    }

    const timestamp = Date.now();
    const randomSuffix = Math.floor(Math.random() * 1000);
    const orderId = `ORDER_${timestamp}_${randomSuffix}`;

    const formattedAmount = numAmount.toFixed(2);
    const formattedCurrency = currency.toUpperCase();

    const nameParts = customerData.name.trim().split(/\s+/);
    const firstName = nameParts[0] || 'Customer';
    const lastName = nameParts.slice(1).join(' ') || 'User';

    let cleanPhone = customerData.phoneNumber?.trim() || '0771234567';
    if (!cleanPhone.startsWith('0')) {
      cleanPhone = '0' + cleanPhone;
    }

    const hash = generatePayHereHash(
      payhereConfig.merchantId,
      orderId,
      formattedAmount,
      formattedCurrency,
      payhereConfig.merchantSecret
    );

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

// Create PayHere Recurring Payment
router.post('/create-payhere-recurring-payment', async (req, res) => {
  try {
    console.log('🔄 PayHere Recurring Payment Creation Started');

    const { amount, currency = 'LKR', planId, customerData, enableAutoRenew = true } = req.body;

    if (!payhereConfig.merchantId || !payhereConfig.merchantSecret) {
      console.error('❌ PayHere configuration missing');
      return res.status(500).json({
        success: false,
        error: 'PayHere configuration invalid'
      });
    }

    const numAmount = parseFloat(amount);
    if (!amount || isNaN(numAmount) || numAmount < 1) {
      return res.status(400).json({
        success: false,
        error: 'Amount must be at least LKR 1.00'
      });
    }

    if (planId === '1') {
      return res.status(400).json({
        success: false,
        error: 'Auto-renewal is only available for Premium plans'
      });
    }

    if (!customerData?.name || !customerData?.email) {
      return res.status(400).json({
        success: false,
        error: 'Customer name and email are required'
      });
    }

    const timestamp = Date.now();
    const randomSuffix = Math.floor(Math.random() * 1000);
    const orderId = `RECURRING_${timestamp}_${randomSuffix}`;

    const formattedAmount = numAmount.toFixed(2);
    const formattedCurrency = currency.toUpperCase();

    const nameParts = customerData.name.trim().split(/\s+/);
    const firstName = nameParts[0] || 'Customer';
    const lastName = nameParts.slice(1).join(' ') || 'User';

    let cleanPhone = customerData.phoneNumber?.trim() || '0771234567';
    if (!cleanPhone.startsWith('0')) {
      cleanPhone = '0' + cleanPhone;
    }

    const hash = generatePayHereHash(
      payhereConfig.merchantId,
      orderId,
      formattedAmount,
      formattedCurrency,
      payhereConfig.merchantSecret
    );

    const paymentData = {
      sandbox: payhereConfig.mode === 'sandbox',
      merchant_id: payhereConfig.merchantId,
      return_url: payhereConfig.returnUrl,
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
      custom_2: 'monthly_recurring',
      recurrence: '1 Month',
      duration: '12 Month',
      startup_fee: '0.00',
      recurring: 'optional'
    };

    console.log('✅ PayHere recurring payment data prepared');
    console.log('Order ID:', orderId);
    console.log('Amount:', formattedAmount, formattedCurrency);
    console.log('Recurring enabled:', enableAutoRenew);

    res.json({
      success: true,
      orderId: orderId,
      paymentData: paymentData,
      amount: formattedAmount,
      currency: formattedCurrency,
      recurring: enableAutoRenew,
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

// PayHere Notification Handler
router.post('/payhere-notify', express.urlencoded({ extended: true }), async (req, res) => {
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

    if (status_code === '2') {
      console.log('✅ Payment successful! Processing subscription...');

      try {
        const planId = custom_1?.replace('plan_', '') || '2';

        const existingSubscription = await Subscription.findOne({ payhereOrderId: order_id });

        if (existingSubscription) {
          console.log('ℹ️ Subscription record already exists for this order');
        } else {
          const subscription = new Subscription({
            userId: null,
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
            endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
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

    res.status(200).send('OK');

  } catch (error) {
    console.error('❌ Error processing PayHere notification:', error);
    res.status(500).send('Server error');
  }
});

// PayHere Recurring Notification Handler
router.post('/payhere-recurring-notify', express.urlencoded({ extended: true }), async (req, res) => {
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
      recurring_token,
      subscription_id,
      event_type
    } = req.body;

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
    console.log(`🔄 Event Type: ${event_type}`);

    if (event_type === 'SUBSCRIPTION_PAYMENT') {
      await handleRecurringPayment(req.body);
    } else if (event_type === 'SUBSCRIPTION_CANCELLED') {
      await handleSubscriptionCancellation(req.body);
    } else if (status_code === '2') {
      await handleInitialSubscription(req.body);
    }

    res.status(200).send('OK');

  } catch (error) {
    console.error('❌ Error processing PayHere recurring notification:', error);
    res.status(500).send('Server error');
  }
});

// Enhanced PayHere Notification Handler
router.post('/payhere-notify-enhanced', express.urlencoded({ extended: true }), async (req, res) => {
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
      recurring_token,
      subscription_id,
      event_type,
      next_occurrence_date
    } = req.body;

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

    if (event_type === 'SUBSCRIPTION_PAYMENT') {
      console.log('🔄 Processing recurring payment...');
      await handleRecurringPaymentNotification(req.body);
    } else if (event_type === 'SUBSCRIPTION_CANCELLED') {
      console.log('❌ Processing subscription cancellation...');
      await handleSubscriptionCancellationNotification(req.body);
    } else if (status_code === '2') {
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

// Debug PayHere Hash
router.get('/debug-payhere-hash/:orderId/:amount', (req, res) => {
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

// Get Payment Status
router.get('/payhere-status/:orderId', async (req, res) => {
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

// Create PayHere Payment with Auto-Renewal Option
router.post('/create-payhere-payment-with-auto-renewal', async (req, res) => {
  try {
    const { amount, currency = 'LKR', planId, customerData, enableAutoRenew = false } = req.body;

    if (enableAutoRenew && planId === '1') {
      return res.status(400).json({
        success: false,
        error: 'Auto-renewal is only available for Premium plans'
      });
    }

    if (enableAutoRenew && planId === '2') {
      req.body.enableAutoRenew = true;
      return await createPayHereRecurringPayment(req, res);
    } else {
      // Use regular payment creation logic here
    }

  } catch (error) {
    console.error('Error creating payment with auto-renewal option:', error);
    res.status(500).json({
      success: false,
      error: 'Payment creation failed'
    });
  }
});

// Check Payment Status
router.get('/check-payment-status/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;

    console.log(`🔍 Checking payment status for order: ${orderId}`);

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

export default router;