import axios from 'axios';

export const subscriptionUtils = {
  // UPDATED: Check if a user has an active subscription - handles three user types
  checkUserSubscription: async (userEmail, userId) => {
    try {
      console.log('Checking subscription for:', userEmail, 'userId:', userId);

      const response = await axios.post('http://localhost:5555/api/user/check-subscription', {
        email: userEmail,
        userId: userId
      });

      console.log('Subscription check response:', response.data);

      if (response.data.success) {
        return {
          hasSubscription: response.data.hasSubscription || false,
          hasActiveSubscription: response.data.hasActiveSubscription || false,
          isPremiumUser: response.data.isPremiumUser || false,
          isFreeUser: response.data.isFreeUser || false,
          isNonActivated: response.data.isNonActivated || false, // NEW
          userExists: response.data.userExists || true,
          subscription: response.data.subscription || null
        };
      }

      return {
        hasSubscription: false,
        hasActiveSubscription: false,
        isPremiumUser: false,
        isFreeUser: false,
        isNonActivated: true, // Default to non-activated
        userExists: true,
        subscription: null
      };

    } catch (error) {
      console.error('Error checking subscription:', error);
      return {
        hasSubscription: false,
        hasActiveSubscription: false,
        isPremiumUser: false,
        isFreeUser: false,
        isNonActivated: true,
        userExists: true,
        subscription: null
      };
    }
  },

  // UPDATED: Get subscription limits based on plan - handles three types
  getSubscriptionLimits: (subscription) => {
    if (!subscription) {
      return { maxBusinesses: 0, maxOffers: 0 }; // Non-activated users can't create anything
    }

    // Premium plan limits - FIXED: 3 businesses, 9 offers
    if (subscription.planId === '2' && 
        subscription.status === 'active' &&
        (!subscription.endDate || new Date(subscription.endDate) > new Date())) {
      return { maxBusinesses: 3, maxOffers: 9 }; // PREMIUM: 3 businesses, 9 offers
    }

    // Free plan limits - FIXED: 1 business, 3 offers
    if (subscription.planId === '1' && subscription.status === 'active') {
      return { maxBusinesses: 1, maxOffers: 3 }; // FREE: 1 business, 3 offers
    }

    // Default to no access for expired/inactive subscriptions
    return { maxBusinesses: 0, maxOffers: 0 };
  },

  // UPDATED: Check if user can add more businesses
  canAddBusiness: (currentCount, subscription) => {
    const limits = subscriptionUtils.getSubscriptionLimits(subscription);
    console.log(`Business limit check: ${currentCount}/${limits.maxBusinesses} (can add: ${currentCount < limits.maxBusinesses})`);
    return currentCount < limits.maxBusinesses;
  },

  // UPDATED: Check if user can add more offers
  canAddOffer: (currentCount, subscription) => {
    const limits = subscriptionUtils.getSubscriptionLimits(subscription);
    console.log(`Offer limit check: ${currentCount}/${limits.maxOffers} (can add: ${currentCount < limits.maxOffers})`);
    return currentCount < limits.maxOffers;
  },

  // UPDATED: Get limit message for display
  getLimitMessage: (type, currentCount, subscription) => {
    const limits = subscriptionUtils.getSubscriptionLimits(subscription);
    
    if (!subscription) {
      return `Please activate a subscription plan to create ${type === 'business' ? 'businesses' : 'offers'}.`;
    }
    
    const planName = subscription.planName || 'Unknown';

    if (type === 'business') {
      return `${planName} allows maximum ${limits.maxBusinesses} business${limits.maxBusinesses !== 1 ? 'es' : ''}. You have ${currentCount}/${limits.maxBusinesses} businesses.`;
    } else if (type === 'offer') {
      return `${planName} allows maximum ${limits.maxOffers} offers. You have ${currentCount}/${limits.maxOffers} offers.`;
    }
  },

  // UPDATED: Check if user is premium
  isPremiumUser: (subscription) => {
    return subscription &&
           subscription.planId === '2' &&
           subscription.status === 'active' &&
           (!subscription.endDate || new Date(subscription.endDate) > new Date());
  },

  // UPDATED: Check if user is free user
  isFreeUser: (subscription) => {
    return subscription &&
           subscription.planId === '1' &&
           subscription.status === 'active';
  },

  // NEW: Check if user is non-activated
  isNonActivated: (subscription) => {
    return !subscription || subscription === null;
  },

  // UPDATED: Check if user should see subscription page
  shouldShowSubscriptionPage: (subscriptionResult) => {
    // Only non-activated users should see subscription page
    return subscriptionResult.isNonActivated;
  },

  // UPDATED: Check if user can access business features  
  canAccessBusinessFeatures: (subscriptionResult) => {
    // Both premium and free users can access business features
    return subscriptionResult.isPremiumUser || subscriptionResult.isFreeUser;
  },

  // Create subscription record after successful payment
  createSubscriptionRecord: async (subscriptionData) => {
    try {
      console.log('Creating subscription record:', subscriptionData);
      const response = await axios.post('http://localhost:5555/create-subscription-record', subscriptionData);
      console.log('Subscription record created:', response.data);
      return response.data;
    } catch (error) {
      console.error('Error creating subscription record:', error);
      throw error;
    }
  },

  // Get subscription plans
  getSubscriptionPlans: async () => {
    try {
      const response = await axios.get('http://localhost:5555/plans');
      return response.data.plans || [];
    } catch (error) {
      console.error('Error fetching plans:', error);
      return [];
    }
  },

  // Enhanced PayHere payment creation with better error handling
  createPayHerePayment: async (paymentData) => {
    try {
      console.log('Creating PayHere payment...');
      console.log('Payment data being sent:', {
        amount: paymentData.amount,
        currency: paymentData.currency,
        planId: paymentData.planId,
        billingCycle: paymentData.billingCycle,
        customerName: paymentData.customerData?.name,
        customerEmail: paymentData.customerData?.email,
        customerPhone: paymentData.customerData?.phoneNumber
      });

      // Validate required fields before sending
      if (!paymentData.amount || paymentData.amount < 10) {
        throw new Error('Amount must be at least LKR 10.00');
      }

      if (!paymentData.customerData?.name?.trim()) {
        throw new Error('Customer name is required');
      }

      if (!paymentData.customerData?.email?.trim()) {
        throw new Error('Customer email is required');
      }

      if (!paymentData.customerData?.phoneNumber?.trim()) {
        throw new Error('Customer phone number is required');
      }

      // Email format validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(paymentData.customerData.email.trim())) {
        throw new Error('Invalid email format');
      }

      // Make API call with timeout
      const response = await axios.post('http://localhost:5555/create-payhere-payment', paymentData, {
        timeout: 30000, // 30 second timeout
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });

      console.log('PayHere API response:', {
        success: response.data.success,
        orderId: response.data.orderId,
        amount: response.data.amount,
        hasPaymentData: !!response.data.paymentData
      });

      if (!response.data.success) {
        throw new Error(response.data.error || 'Payment creation failed');
      }

      if (!response.data.paymentData) {
        throw new Error('No payment data received from server');
      }

      // Validate critical payment fields
      const requiredFields = ['merchant_id', 'order_id', 'amount', 'currency', 'hash'];
      const missingFields = requiredFields.filter(field => !response.data.paymentData[field]);

      if (missingFields.length > 0) {
        throw new Error(`Missing payment fields: ${missingFields.join(', ')}`);
      }

      console.log('PayHere payment created successfully');
      return response.data;

    } catch (error) {
      console.error('PayHere payment creation failed:');

      if (error.response) {
        // Server responded with error
        console.error('Server Error Response:', {
          status: error.response.status,
          data: error.response.data
        });

        const errorMessage = error.response.data?.error ||
          error.response.data?.message ||
          `Server error: ${error.response.status}`;
        throw new Error(errorMessage);
      } else if (error.request) {
        // Network error
        console.error('Network Error:', error.request);
        throw new Error('Network error: Unable to reach payment server');
      } else {
        // Other error
        console.error('Error:', error.message);
        throw error;
      }
    }
  },

  // UPDATED: Format subscription status for display - handles three types
  formatSubscriptionStatus: (subscription) => {
    if (!subscription) return 'Non-Activated User';

    const status = subscription.status?.charAt(0).toUpperCase() +
      (subscription.status?.slice(1) || '');
    const planName = subscription.planName || 'Unknown Plan';

    if (subscription.endDate) {
      const endDate = new Date(subscription.endDate);
      const now = new Date();
      const daysLeft = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));

      if (daysLeft > 0) {
        return `${planName} (${status}) - ${daysLeft} days remaining`;
      } else {
        return `${planName} (Expired)`;
      }
    }

    return `${planName} (${status})`;
  },

  // Check if subscription is about to expire (within 7 days)
  isSubscriptionExpiring: (subscription) => {
    if (!subscription || !subscription.endDate) return false;

    const endDate = new Date(subscription.endDate);
    const now = new Date();
    const daysLeft = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));

    return daysLeft <= 7 && daysLeft > 0;
  },

  // NEW: Create free subscription (for users who choose free plan)
  createFreeSubscription: async (userData) => {
    try {
      console.log('Creating free subscription for user:', userData.email);
      
      const response = await axios.post('http://localhost:5555/create-free-subscription', {
        customerData: {
          userId: userData.userId || userData._id,
          email: userData.email,
          name: `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || 'User'
        }
      });

      if (response.data.success) {
        console.log('Free subscription created successfully');
        return response.data;
      } else {
        console.error('Failed to create free subscription:', response.data.error);
        return { success: false, error: response.data.error };
      }
    } catch (error) {
      console.error('Error creating free subscription:', error);
      return { success: false, error: error.message };
    }
  },

  // NEW: Get user type string for display
  getUserTypeString: (subscription) => {
    if (!subscription) return 'Non-Activated User';
    
    if (subscription.planId === '2' && subscription.status === 'active') {
      return 'Premium User';
    } else if (subscription.planId === '1' && subscription.status === 'active') {
      return 'Free User';
    }
    
    return 'Non-Activated User';
  },

  // Validate payment data before submission
  validatePaymentData: (formData, plans, user) => {
    const errors = [];

    // Check if plan is selected
    if (!formData.selectedPlan) {
      errors.push('Please select a subscription plan');
    }

    // Check customer data
    if (!formData.name?.trim()) {
      errors.push('Full name is required');
    }

    if (!formData.email?.trim()) {
      errors.push('Email address is required');
    } else {
      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(formData.email.trim())) {
        errors.push('Please enter a valid email address');
      }
    }

    if (!formData.phoneNumber?.trim()) {
      errors.push('Phone number is required');
    } else {
      // Validate Sri Lankan phone number format
      const cleanPhone = formData.phoneNumber.replace(/\D/g, '');
      if (cleanPhone.length < 9 || cleanPhone.length > 12) {
        errors.push('Please enter a valid Sri Lankan phone number');
      }
    }

    // Check agreement
    if (!formData.agreement) {
      errors.push('Please agree to the terms and conditions');
    }

    // Validate selected plan
    if (formData.selectedPlan) {
      const selectedPlan = plans.find(plan => plan.id === parseInt(formData.selectedPlan));
      if (!selectedPlan) {
        errors.push('Selected plan is not valid');
      } else {
        const amount = selectedPlan.monthlyPrice; // Only monthly now

        if (amount > 0 && amount < 10) {
          errors.push('Payment amount must be at least LKR 10.00');
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors: errors
    };
  },

  // Format phone number for PayHere
  formatPhoneForPayHere: (phoneNumber) => {
    if (!phoneNumber) return '0771234567'; // Fallback

    // Remove all non-digits
    let cleanPhone = phoneNumber.toString().replace(/\D/g, '');

    // Handle different formats
    if (cleanPhone.startsWith('94')) {
      return '0' + cleanPhone.substring(2);
    } else if (cleanPhone.startsWith('0')) {
      return cleanPhone;
    } else if (cleanPhone.length >= 9) {
      return '0' + cleanPhone;
    }

    // Fallback for invalid numbers
    return '0771234567';
  },

  // Debug payment submission
  debugPaymentSubmission: (paymentData) => {
    console.log('=== PAYMENT SUBMISSION DEBUG ===');
    console.log('1. Payment Data Structure:', typeof paymentData);
    console.log('2. Payment Data Keys:', Object.keys(paymentData || {}));

    if (paymentData) {
      console.log('3. Required Fields Check:');
      const requiredFields = ['amount', 'currency', 'planId', 'customerData'];
      requiredFields.forEach(field => {
        console.log(`   ${field}: ${paymentData[field] ? 'OK' : 'MISSING'} (${typeof paymentData[field]})`);
      });

      if (paymentData.customerData) {
        console.log('4. Customer Data Check:');
        const customerFields = ['name', 'email', 'phoneNumber'];
        customerFields.forEach(field => {
          const value = paymentData.customerData[field];
          console.log(`   ${field}: ${value ? 'OK' : 'MISSING'} (${typeof value}) - "${value}"`);
        });
      }

      console.log('5. Amount Validation:');
      console.log(`   Amount: ${paymentData.amount}`);
      console.log(`   Is Number: ${!isNaN(paymentData.amount)}`);
      console.log(`   Is >= 10: ${parseFloat(paymentData.amount) >= 10}`);
    }

    console.log('=====================================');
  },

  // Submit form to PayHere with enhanced error handling
  submitToPayHere: (paymentData, onSuccess, onError) => {
    try {
      console.log('Submitting to PayHere...');

      // Validate payment data structure
      if (!paymentData || typeof paymentData !== 'object') {
        throw new Error('Invalid payment data structure');
      }

      // Check required PayHere fields
      const requiredFields = [
        'merchant_id', 'return_url', 'cancel_url', 'notify_url',
        'order_id', 'items', 'currency', 'amount',
        'first_name', 'last_name', 'email', 'phone',
        'address', 'city', 'country', 'hash'
      ];

      const missingFields = requiredFields.filter(field =>
        !paymentData[field] || paymentData[field].toString().trim() === ''
      );

      if (missingFields.length > 0) {
        throw new Error(`Missing PayHere fields: ${missingFields.join(', ')}`);
      }

      // Create form element
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = 'https://sandbox.payhere.lk/pay/checkout';
      form.target = '_self';
      form.style.display = 'none';

      // Add all fields to form
      let fieldCount = 0;
      Object.entries(paymentData).forEach(([key, value]) => {
        if (value !== null && value !== undefined && value !== '') {
          const input = document.createElement('input');
          input.type = 'hidden';
          input.name = key;
          input.value = value.toString().trim();
          form.appendChild(input);
          fieldCount++;
        }
      });

      if (fieldCount === 0) {
        throw new Error('No valid fields to submit to PayHere');
      }

      // Add to DOM and submit
      document.body.appendChild(form);

      console.log(`Submitting form with ${fieldCount} fields to PayHere`);
      console.log(`URL: ${form.action}`);

      // Submit form
      form.submit();

      // Call success callback
      if (onSuccess) onSuccess();

      // Cleanup after delay
      setTimeout(() => {
        try {
          if (document.body.contains(form)) {
            document.body.removeChild(form);
          }
        } catch (cleanupError) {
          console.error('Form cleanup error:', cleanupError);
        }
      }, 5000);

    } catch (error) {
      console.error('PayHere form submission error:', error);
      if (onError) onError(error);
      throw error;
    }
  },

  // Check PayHere payment status
  checkPaymentStatus: async (orderId) => {
    try {
      const response = await axios.get(`http://localhost:5555/payhere-status/${orderId}`);
      return response.data;
    } catch (error) {
      console.error('Error checking payment status:', error);
      return { success: false, status: 'unknown' };
    }
  },

  // Test PayHere configuration
  testPayHereConfig: async () => {
    try {
      console.log('Testing PayHere configuration...');

      const testPaymentData = {
        amount: 100,
        currency: 'LKR',
        planId: '2',
        customerData: {
          name: 'Test User',
          email: 'test@example.com',
          phoneNumber: '0771234567',
          address: 'Test Address',
          userId: null
        }
      };

      const result = await subscriptionUtils.createPayHerePayment(testPaymentData);
      console.log('PayHere configuration test passed');
      return { success: true, data: result };

    } catch (error) {
      console.error('PayHere configuration test failed:', error.message);
      return { success: false, error: error.message };
    }
  }
};