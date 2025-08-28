import React, { createContext, useState, useEffect } from "react";
import axios from "axios";

// Create Authentication Context
export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true); // Add loading state

  // Load user from localStorage on app startup and check expiry
  useEffect(() => {
    const checkAuthStatus = () => {
      try {
        const storedUser = localStorage.getItem("user");
        const loginTime = localStorage.getItem("loginTime");
        
        if (storedUser && loginTime) {
          const currentTime = Date.now();
          const sessionDuration = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
          
          // Check if session has expired
          if (currentTime - parseInt(loginTime) < sessionDuration) {
            setUser(JSON.parse(storedUser)); // Restore session
          } else {
            // Session expired, clear storage
            localStorage.removeItem("user");
            localStorage.removeItem("loginTime");
            localStorage.removeItem("userEmail"); // Clean up old userEmail key if exists
          }
        }
      } catch (error) {
        console.error("Error checking auth status:", error);
        // Clear potentially corrupted data
        localStorage.removeItem("user");
        localStorage.removeItem("loginTime");
        localStorage.removeItem("userEmail");
      } finally {
        setIsLoading(false); // Set loading to false after checking
      }
    };

    checkAuthStatus();
  }, []);

  // Function to check if user has an active subscription
  const checkSubscriptionStatus = async (userData) => {
    try {
      console.log('Checking subscription status for:', userData.email);
      
      // Make API call to check if user has any active subscription
      const response = await axios.post('http://localhost:5555/api/user/check-subscription', {
        email: userData.email,
        userId: userData.userId || userData._id
      });

      if (response.data.success) {
        console.log('Subscription check result:', response.data.hasActiveSubscription);
        return response.data.hasActiveSubscription;
      } else {
        console.log('No subscription found for user');
        return false;
      }
    } catch (error) {
      console.error('Error checking subscription status:', error);
      // If API call fails, assume no subscription (safer approach)
      return false;
    }
  };

  // Enhanced login function with subscription check
  const login = async (userData) => {
    try {
      setUser(userData);
      localStorage.setItem("user", JSON.stringify(userData));
      localStorage.setItem("loginTime", Date.now().toString()); // Store login time
      
      // Clean up old userEmail key if it exists
      localStorage.removeItem("userEmail");

      // Check subscription status
      const hasActiveSubscription = await checkSubscriptionStatus(userData);
      
      console.log('Login completed. Has active subscription:', hasActiveSubscription);
      
      // Return subscription status so SignIn component can handle routing
      return hasActiveSubscription;
      
    } catch (error) {
      console.error('Error during enhanced login:', error);
      // If subscription check fails, still complete login but assume no subscription
      return false;
    }
  };

  // Logout function
  const logout = () => {
    setUser(null);
    localStorage.removeItem("user");
    localStorage.removeItem("loginTime");
    localStorage.removeItem("userEmail"); // Clean up old userEmail key if exists
  };

  // Check if user is authenticated (only return true if not loading and user exists)
  const isAuthenticated = () => {
    return !isLoading && user !== null;
  };

  // Check if we're still loading
  const isAuthLoading = () => {
    return isLoading;
  };

  // Function to manually check current user's subscription (for other components)
  const getCurrentUserSubscription = async () => {
    if (!user) return false;
    return await checkSubscriptionStatus(user);
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      login, 
      logout, 
      isAuthenticated, 
      isAuthLoading,
      isLoading,
      checkSubscriptionStatus,
      getCurrentUserSubscription
    }}>
      {children}
    </AuthContext.Provider>
  );
};