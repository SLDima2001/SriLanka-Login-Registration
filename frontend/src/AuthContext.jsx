import React, { createContext, useState, useEffect } from "react";
import axios from "axios";

// Create Authentication Context
export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load user from localStorage on app startup and check expiry
  useEffect(() => {
    const checkAuthStatus = () => {
      try {
        const storedUser = localStorage.getItem("user");
        const storedSubscription = localStorage.getItem("subscription");
        const loginTime = localStorage.getItem("loginTime");

        if (storedUser && loginTime) {
          const currentTime = Date.now();
          const sessionDuration = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

          // Check if session has expired
          if (currentTime - parseInt(loginTime) < sessionDuration) {
            setUser(JSON.parse(storedUser)); // Restore session

            // Restore subscription if exists
            if (storedSubscription) {
              try {
                setSubscription(JSON.parse(storedSubscription));
              } catch (error) {
                console.error("Error parsing stored subscription:", error);
                localStorage.removeItem("subscription");
              }
            }
          } else {
            // Session expired, clear storage
            localStorage.removeItem("user");
            localStorage.removeItem("subscription");
            localStorage.removeItem("loginTime");
            localStorage.removeItem("userEmail");
          }
        }
      } catch (error) {
        console.error("Error checking auth status:", error);
        // Clear potentially corrupted data
        localStorage.removeItem("user");
        localStorage.removeItem("subscription");
        localStorage.removeItem("loginTime");
        localStorage.removeItem("userEmail");
      } finally {
        setIsLoading(false);
      }
    };

    checkAuthStatus();
  }, []);

  // Function to check subscription status and return detailed info
  // REPLACE the checkSubscriptionStatus function in your AuthContext.js with this:

  const checkSubscriptionStatus = async (userData) => {
    try {
      console.log('Checking subscription status for:', userData.email);

      const response = await axios.post('http://localhost:5555/api/user/check-subscription', {
        email: userData.email,
        userId: userData.userId || userData._id
      });

      if (response.data.success) {
        console.log('Subscription check result:', response.data);

        // ✅ FIXED: Return exact response from backend
        return {
          hasSubscription: response.data.hasSubscription,
          hasActiveSubscription: response.data.hasActiveSubscription,
          isPremiumUser: response.data.isPremiumUser,
          isFreeUser: response.data.isFreeUser,
          isNonActivated: response.data.isNonActivated,
          userExists: response.data.userExists,
          subscription: response.data.subscription
        };
      } else {
        console.log('Error checking subscription:', response.data.message);
        return {
          hasSubscription: false,
          hasActiveSubscription: false,
          isPremiumUser: false,
          isFreeUser: false,
          isNonActivated: true, // Default to non-activated if error
          userExists: true,
          subscription: null
        };
      }
    } catch (error) {
      console.error('Error checking subscription status:', error);
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
  };

// REPLACE the login function in your AuthContext.js with this fixed version:

const login = async (userData, loginResponse = null) => {
  try {
    setUser(userData);
    localStorage.setItem("user", JSON.stringify(userData));
    localStorage.setItem("loginTime", Date.now().toString());

    // Clean up old userEmail key if it exists
    localStorage.removeItem("userEmail");

    console.log('🔍 Processing login for user:', userData.email);

    // ✅ CRITICAL FIX: Use server response directly when available
    if (loginResponse && loginResponse.redirectTo) {
      console.log('🎯 Using server redirect instruction:', loginResponse.redirectTo);
      console.log('Server subscription status:', loginResponse.subscriptionStatus);
      
      // Store subscription data if provided (or null for non-activated users)
      if (loginResponse.subscription) {
        setSubscription(loginResponse.subscription);
        localStorage.setItem("subscription", JSON.stringify(loginResponse.subscription));
        console.log('✅ Subscription data stored from server:', loginResponse.subscription);
      } else {
        // ✅ CRITICAL: Explicitly set null for non-activated users
        setSubscription(null);
        localStorage.removeItem("subscription");
        console.log('⚠️ No subscription found - user is NON-ACTIVATED');
      }

      // Return status based on server response
      return {
        hasSubscription: !!loginResponse.subscription,
        hasActiveSubscription: loginResponse.subscriptionStatus === 'premium',
        isPremiumUser: loginResponse.subscriptionStatus === 'premium',
        isFreeUser: loginResponse.subscriptionStatus === 'free',
        isNonActivated: loginResponse.subscriptionStatus === 'non-activated' || 
                        loginResponse.subscriptionStatus === 'expired',
        subscription: loginResponse.subscription,
        redirectTo: loginResponse.redirectTo
      };
    }

    // Fallback: Check subscription status manually (shouldn't be needed with fixed backend)
    console.log('⚠️ No server response, checking subscription status manually...');
    const subscriptionResult = await checkSubscriptionStatus(userData);

    // Store subscription data based on check result
    if (subscriptionResult.subscription) {
      setSubscription(subscriptionResult.subscription);
      localStorage.setItem("subscription", JSON.stringify(subscriptionResult.subscription));
      console.log('✅ Subscription data stored from manual check:', subscriptionResult.subscription);
    } else {
      setSubscription(null);
      localStorage.removeItem("subscription");
      console.log('⚠️ No subscription found - user is NON-ACTIVATED');
    }

    // Determine redirect based on subscription status
    let redirectTo = 'subscription'; // Default for non-activated users

    if (subscriptionResult.isPremiumUser) {
      redirectTo = 'business-profile';
      console.log('🔷 Premium user detected, redirecting to Business Profile');
    } else if (subscriptionResult.isFreeUser) {
      redirectTo = 'business-profile';
      console.log('🔶 Free user detected, redirecting to Business Profile');
    } else {
      redirectTo = 'subscription';
      console.log('⭕ Non-activated user detected, redirecting to Subscription Page');
    }

    return {
      ...subscriptionResult,
      redirectTo
    };

  } catch (error) {
    console.error('❌ Error during enhanced login:', error);
    // ✅ Always default to non-activated on error
    setSubscription(null);
    localStorage.removeItem("subscription");
    
    return {
      hasSubscription: false,
      hasActiveSubscription: false,
      isPremiumUser: false,
      isFreeUser: false,
      isNonActivated: true, // Default to non-activated on error
      subscription: null,
      redirectTo: 'subscription'
    };
  }
};

  // Logout function
  const logout = () => {
    setUser(null);
    setSubscription(null);
    localStorage.removeItem("user");
    localStorage.removeItem("subscription");
    localStorage.removeItem("loginTime");
    localStorage.removeItem("userEmail");
  };

  // Check if user is authenticated
  const isAuthenticated = () => {
    return !isLoading && user !== null;
  };

  // Check if user is premium
  const isPremiumUser = () => {
    return subscription &&
      subscription.planId === '2' &&
      subscription.planName === 'Premium Plan' &&
      subscription.status === 'active' &&
      (!subscription.endDate || new Date(subscription.endDate) > new Date());
  };

  // Check if user is on free plan
  const isFreeUser = () => {
    return subscription &&
      subscription.planId === '1' &&
      subscription.planName === 'Free Plan' &&
      subscription.status === 'active';
  };

  // NEW: Check if user is non-activated (no subscription)
  const isNonActivated = () => {
    return !subscription || subscription === null;
  };

  // UPDATED: Check if user should see subscription page
  const shouldShowSubscriptionPage = () => {
    return isNonActivated(); // Only non-activated users should see subscription page
  };

  // UPDATED: Check if user can access business features
  const canAccessBusinessFeatures = () => {
    return isPremiumUser() || isFreeUser(); // Both premium and free users can access
  };

  // Get subscription limits
  const getSubscriptionLimits = () => {
    if (isPremiumUser()) {
      return { maxBusinesses: 3, maxOffers: 9 };
    } else if (isFreeUser()) {
      return { maxBusinesses: 1, maxOffers: 3 };
    }
    return { maxBusinesses: 0, maxOffers: 0 }; // Non-activated users have no limits
  };

  // Check if we're still loading
  const isAuthLoading = () => {
    return isLoading;
  };

  // Function to manually refresh subscription status
  const refreshSubscription = async () => {
    if (!user) return null;

    const result = await checkSubscriptionStatus(user);

    if (result.subscription) {
      setSubscription(result.subscription);
      localStorage.setItem("subscription", JSON.stringify(result.subscription));
    } else {
      setSubscription(null);
      localStorage.removeItem("subscription");
    }

    return result;
  };

  // Function to get current user's subscription (for other components)
  const getCurrentUserSubscription = async () => {
    if (!user) return {
      hasSubscription: false,
      hasActiveSubscription: false,
      isPremiumUser: false,
      isFreeUser: false,
      isNonActivated: true,
      subscription: null
    };
    return await checkSubscriptionStatus(user);
  };

  // NEW: Function to get user type string for display
  const getUserTypeString = () => {
    if (isPremiumUser()) return 'Premium User';
    if (isFreeUser()) return 'Free User';
    if (isNonActivated()) return 'Non-Activated User';
    return 'Unknown';
  };

  return (
    <AuthContext.Provider value={{
      user,
      subscription,
      login,
      logout,
      isAuthenticated,
      isAuthLoading,
      isLoading,
      isPremiumUser,
      isFreeUser,
      isNonActivated, // NEW
      shouldShowSubscriptionPage,
      canAccessBusinessFeatures,
      getSubscriptionLimits,
      checkSubscriptionStatus,
      getCurrentUserSubscription,
      refreshSubscription,
      getUserTypeString // NEW
    }}>
      {children}
    </AuthContext.Provider>
  );
};