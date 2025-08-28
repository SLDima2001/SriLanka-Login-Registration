import React, { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../src/AuthContext';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

const BusinessUserProfile = () => {
  const { user, logout } = useContext(AuthContext);
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('profile');
  const [userDetails, setUserDetails] = useState({});
  const [businesses, setBusinesses] = useState([]);
  const [offers, setOffers] = useState([]);
  const [subscription, setSubscription] = useState({});
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Modal states
  const [showBusinessModal, setShowBusinessModal] = useState(false);
  const [showOfferModal, setShowOfferModal] = useState(false);
  const [editingBusiness, setEditingBusiness] = useState(null);
  const [editingOffer, setEditingOffer] = useState(null);

  // Form states
  const [businessForm, setBusinessForm] = useState({
    name: '',
    address: '',
    phone: '',
    email: '',
    website: '',
    category: '',
    socialMediaLinks: '',
    operatingHours: '',
    businessType: '',
    registrationNumber: '',
    taxId: ''
  });

  const [offerForm, setOfferForm] = useState({
    businessId: '',
    title: '',
    discount: '',
    startDate: '',
    endDate: '',
    category: '',
    isActive: true
  });

  const [profileForm, setProfileForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    address: '',
    businessName: '',
    businessRegNo: '',
    businessAddress: '',
    userType: ''
  });

  // Helper function to get subscription limits
  const getSubscriptionLimits = () => {
    const plan = subscription.plan || 'Free';
    if (plan.toLowerCase() === 'premium') {
      return {
        maxBusinesses: 3,
        maxOffers: 9
      };
    }
    return {
      maxBusinesses: 1,
      maxOffers: 3
    };
  };

  // Helper function to check if user can add more businesses
  const canAddBusiness = () => {
    const limits = getSubscriptionLimits();
    return businesses.length < limits.maxBusinesses;
  };

  // Helper function to check if user can add more offers
  const canAddOffer = () => {
    const limits = getSubscriptionLimits();
    return offers.length < limits.maxOffers;
  };

  // Helper function to get limit message
  const getLimitMessage = (type) => {
    const limits = getSubscriptionLimits();
    const plan = subscription.plan || 'Free';
    
    if (type === 'business') {
      return `${plan} plan allows maximum ${limits.maxBusinesses} business${limits.maxBusinesses > 1 ? 'es' : ''}. You have ${businesses.length}/${limits.maxBusinesses} businesses.`;
    } else if (type === 'offer') {
      return `${plan} plan allows maximum ${limits.maxOffers} offers. You have ${offers.length}/${limits.maxOffers} offers.`;
    }
  };

  // Check if user is currently a free user
  const isFreeUser = () => {
    return !subscription.plan || subscription.plan.toLowerCase() === 'free';
  };

  // Check if user is currently a premium user
  const isPremiumUser = () => {
    return subscription.plan && subscription.plan.toLowerCase() === 'premium';
  };

  // Check if subscription is expired or about to expire
  const isSubscriptionExpired = () => {
    if (!subscription.endDate) return false;
    const now = new Date();
    const endDate = new Date(subscription.endDate);
    return now > endDate;
  };

  // Check if user has an active subscription (not expired)
  const hasActiveSubscription = () => {
    if (!subscription.plan || subscription.plan.toLowerCase() === 'free') return false;
    if (!subscription.endDate) return true; // Lifetime subscription
    return !isSubscriptionExpired();
  };

  useEffect(() => {
    if (user && user.email) {
      fetchUserProfile();
    }
  }, [user]);

  const fetchUserProfile = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      
      // Fetch user profile
      const profileResponse = await axios.post(
        'http://localhost:5555/api/user/profile-by-email',
        { email: user.email },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (profileResponse.data.success) {
        const userData = profileResponse.data.user;
        setUserDetails(userData);
        setProfileForm(userData);
        
        // Fetch user's businesses and offers
        await fetchBusinesses(userData.userId);
        await fetchOffers(userData.userId);
        await fetchSubscription(userData.userId);
        await fetchNotifications(userData.userId);
      }
    } catch (error) {
      console.error('Error fetching user profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchBusinesses = async (userId) => {
    try {
      const response = await axios.get(`http://localhost:5555/api/businesses/user/${userId}`);
      if (response.data.success) {
        setBusinesses(response.data.businesses);
      }
    } catch (error) {
      console.error('Error fetching businesses:', error);
      setBusinesses([]);
    }
  };

  const fetchOffers = async (userId) => {
    try {
      const response = await axios.get(`http://localhost:5555/api/offers/user/${userId}`);
      if (response.data.success) {
        setOffers(response.data.offers);
      }
    } catch (error) {
      console.error('Error fetching offers:', error);
      setOffers([]);
    }
  };

  const fetchSubscription = async (userId) => {
    try {
      const response = await axios.get(`http://localhost:5555/api/subscription/user/${userId}`);
      if (response.data.success) {
        setSubscription(response.data.subscription);
      }
    } catch (error) {
      console.error('Error fetching subscription:', error);
      setSubscription({
        plan: 'Free',
        nextBillingDate: null,
        status: 'active'
      });
    }
  };

  const fetchNotifications = async (userId) => {
    try {
      const response = await axios.get(`http://localhost:5555/api/notifications/user/${userId}`);
      if (response.data.success) {
        setNotifications(response.data.notifications);
      }
    } catch (error) {
      console.error('Error fetching notifications:', error);
      setNotifications([]);
    }
  };

  const handleProfileUpdate = async () => {
    try {
      const response = await axios.put(
        `http://localhost:5555/api/auth/users/${userDetails._id}`,
        profileForm
      );

      if (response.data.success) {
        setUserDetails(response.data.user);
        setEditMode(false);
        alert('Profile updated successfully!');
      }
    } catch (error) {
      console.error('Error updating profile:', error);
      alert('Failed to update profile');
    }
  };

  const handleDeleteAccount = async () => {
    try {
      const response = await axios.delete(
        `http://localhost:5555/api/auth/users/${userDetails._id}`
      );

      if (response.data.success) {
        alert('Account deleted successfully');
        logout();
        navigate('/');
      }
    } catch (error) {
      console.error('Error deleting account:', error);
      alert('Failed to delete account');
    }
  };

  const handleBusinessSubmit = async () => {
    try {
      if (editingBusiness) {
        const response = await axios.put(
          `http://localhost:5555/api/businesses/${editingBusiness._id}`,
          { ...businessForm, userId: userDetails.userId }
        );
        if (response.data.success) {
          await fetchBusinesses(userDetails.userId);
          alert('Business updated successfully!');
        }
      } else {
        // Check limit before creating new business
        if (!canAddBusiness()) {
          alert(getLimitMessage('business') + ' Please upgrade to Premium to add more businesses.');
          return;
        }
        
        const response = await axios.post(
          'http://localhost:5555/api/businesses',
          { ...businessForm, userId: userDetails.userId }
        );
        if (response.data.success) {
          await fetchBusinesses(userDetails.userId);
          alert('Business created successfully!');
        }
      }
      setShowBusinessModal(false);
      setEditingBusiness(null);
      setBusinessForm({ 
        name: '', 
        address: '', 
        phone: '', 
        email: '', 
        website: '', 
        category: '',
        socialMediaLinks: '',
        operatingHours: '',
        businessType: '',
        registrationNumber: '',
        taxId: ''
      });
    } catch (error) {
      console.error('Error saving business:', error);
      alert('Failed to save business');
    }
  };

  const handleOfferSubmit = async () => {
    try {
      // Validate dates
      if (offerForm.startDate && offerForm.endDate) {
        const startDate = new Date(offerForm.startDate);
        const endDate = new Date(offerForm.endDate);
        
        if (startDate >= endDate) {
          alert('End date must be after start date!');
          return;
        }
      }

      if (editingOffer) {
        const response = await axios.put(
          `http://localhost:5555/api/offers/${editingOffer._id}`,
          { ...offerForm, userId: userDetails.userId }
        );
        if (response.data.success) {
          await fetchOffers(userDetails.userId);
          alert('Offer updated successfully!');
        }
      } else {
        // Check limit before creating new offer
        if (!canAddOffer()) {
          alert(getLimitMessage('offer') + ' Please upgrade to Premium to add more offers.');
          return;
        }
        
        const response = await axios.post(
          'http://localhost:5555/api/offers',
          { ...offerForm, userId: userDetails.userId }
        );
        
        if (response.data.success) {
          // Send email notification for new offer
          await sendOfferNotification(offerForm);
          await fetchOffers(userDetails.userId);
          alert('Offer created successfully! Email notification sent.');
        }
      }
      setShowOfferModal(false);
      setEditingOffer(null);
      setOfferForm({ 
        businessId: '', 
        title: '', 
        discount: '', 
        startDate: '', 
        endDate: '', 
        category: '', 
        isActive: true 
      });
    } catch (error) {
      console.error('Error saving offer:', error);
      alert('Failed to save offer');
    }
  };

  // Send email notification when offer starts
  const sendOfferNotification = async (offerData) => {
    try {
      const business = businesses.find(b => b._id === offerData.businessId);
      const startDate = new Date(offerData.startDate);
      const today = new Date();
      
      // If start date is today or in the past, send notification immediately
      if (startDate <= today) {
        await axios.post('http://localhost:5555/api/send-offer-notification', {
          userEmail: userDetails.email,
          userName: `${userDetails.firstName} ${userDetails.lastName}`,
          businessName: business?.name || 'Your Business',
          offerTitle: offerData.title,
          discount: offerData.discount,
          startDate: offerData.startDate,
          endDate: offerData.endDate
        });
        console.log('Offer notification sent immediately');
      } else {
        // Schedule notification for start date (you might want to implement this with a job queue)
        console.log('Offer notification scheduled for:', startDate);
      }
    } catch (error) {
      console.error('Error sending offer notification:', error);
    }
  };

  const handleDeleteBusiness = async (businessId) => {
    if (window.confirm('Are you sure you want to delete this business?')) {
      try {
        const response = await axios.delete(`http://localhost:5555/api/businesses/${businessId}`);
        if (response.data.success) {
          await fetchBusinesses(userDetails.userId);
          alert('Business deleted successfully!');
        }
      } catch (error) {
        console.error('Error deleting business:', error);
        alert('Failed to delete business');
      }
    }
  };

  const handleDeleteOffer = async (offerId) => {
    if (window.confirm('Are you sure you want to delete this offer?')) {
      try {
        const response = await axios.delete(`http://localhost:5555/api/offers/${offerId}`);
        if (response.data.success) {
          await fetchOffers(userDetails.userId);
          alert('Offer deleted successfully!');
        }
      } catch (error) {
        console.error('Error deleting offer:', error);
        alert('Failed to delete offer');
      }
    }
  };

  const toggleOfferStatus = async (offerId, currentStatus) => {
    try {
      const response = await axios.patch(
        `http://localhost:5555/api/offers/${offerId}/toggle-status`,
        { isActive: !currentStatus }
      );
      if (response.data.success) {
        await fetchOffers(userDetails.userId);
        alert('Offer status updated successfully!');
      }
    } catch (error) {
      console.error('Error toggling offer status:', error);
      alert('Failed to update offer status');
    }
  };

  // Handle subscription page navigation
  const handleSubscriptionNavigation = () => {
    // Premium users cannot access subscription page (they have the best plan)
    if (isPremiumUser() && hasActiveSubscription()) {
      alert('You already have the Premium plan - the best package available!');
      return;
    }
    
    // If premium subscription expired, allow access to subscription page
    if (isPremiumUser() && !hasActiveSubscription()) {
      navigate('/subscription');
      return;
    }
    
    // Free users can access subscription page
    if (isFreeUser()) {
      navigate('/subscription');
      return;
    }
    
    // Default navigation for other cases
    navigate('/subscription');
  };

  // Get subscription status display
  const getSubscriptionStatusDisplay = () => {
    if (isPremiumUser() && hasActiveSubscription()) {
      return {
        status: 'Premium (Active)',
        message: 'You have the best plan available!',
        showUpgrade: false,
        buttonText: 'Already Premium'
      };
    }
    
    if (isPremiumUser() && !hasActiveSubscription()) {
      return {
        status: 'Premium (Expired)',
        message: 'Your premium subscription has expired. Renew to continue enjoying premium features.',
        showUpgrade: true,
        buttonText: 'Renew Premium'
      };
    }
    
    if (isFreeUser()) {
      return {
        status: 'Free Plan',
        message: 'Upgrade to Premium to unlock more businesses and offers!',
        showUpgrade: true,
        buttonText: 'Upgrade to Premium'
      };
    }
    
    return {
      status: subscription.plan || 'Free',
      message: 'Manage your subscription',
      showUpgrade: true,
      buttonText: 'Manage Subscription'
    };
  };

  // Check if offer is currently active based on dates
  const isOfferCurrentlyActive = (offer) => {
    const now = new Date();
    const startDate = offer.startDate ? new Date(offer.startDate) : null;
    const endDate = offer.endDate ? new Date(offer.endDate) : null;
    
    if (startDate && startDate > now) return false; // Not started yet
    if (endDate && endDate < now) return false; // Already ended
    
    return offer.isActive; // Return the manual active status
  };

  if (loading) {
    return (
      <div style={styles.loading}>
        <div style={styles.spinner}></div>
        <p>Loading profile...</p>
      </div>
    );
  }

  const subscriptionStatus = getSubscriptionStatusDisplay();

  return (
    <div style={styles.container}>
      {/* Header Section */}
      <div style={styles.header}>
        <div style={styles.profileSection}>
          <img 
            src="https://via.placeholder.com/60" 
            alt="Profile" 
            style={styles.avatar}
          />
          <div style={styles.userInfo}>
            <h2 style={styles.userName}>
              {userDetails.firstName} {userDetails.lastName}
            </h2>
            <p style={styles.userEmail}>{userDetails.email}</p>
          </div>
        </div>
        <div style={styles.headerActions}>
          <button 
            style={styles.logoutButton}
            onClick={() => {
              if (window.confirm('Are you sure you want to logout?')) {
                logout();
                navigate('/');
              }
            }}
          >
            Logout
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div style={styles.tabs}>
        {['profile', 'businesses', 'offers', 'subscription', 'notifications'].map((tab) => (
          <button 
            key={tab}
            style={activeTab === tab ? styles.activeTab : styles.tab}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Content Area */}
      <div style={styles.content}>
        {/* Profile Tab */}
        {activeTab === 'profile' && (
          <div style={styles.section}>
            <div style={styles.sectionHeader}>
              <h3>Profile Information</h3>
              <div>
                {editMode ? (
                  <>
                    <button style={styles.saveButton} onClick={handleProfileUpdate}>
                      Save Changes
                    </button>
                    <button style={styles.cancelButton} onClick={() => setEditMode(false)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button style={styles.editButton} onClick={() => setEditMode(true)}>
                    Edit Profile
                  </button>
                )}
              </div>
            </div>
            
            <div style={styles.profileGrid}>
              {Object.entries({
                'First Name': 'firstName',
                'Last Name': 'lastName', 
                'Email': 'email',
                'Phone': 'phone',
                'Address': 'address',
                'User Type': 'userType'
              }).map(([label, field]) => (
                <div key={field} style={styles.formGroup}>
                  <label>{label}</label>
                  {field === 'userType' ? (
                    <select
                      value={profileForm[field] || ''}
                      onChange={(e) => setProfileForm({...profileForm, [field]: e.target.value})}
                      disabled={!editMode}
                      style={editMode ? styles.input : styles.disabledInput}
                    >
                      <option value="">Select Type</option>
                      <option value="Individual">Individual</option>
                      <option value="Company">Company</option>
                      <option value="Agency">Agency</option>
                    </select>
                  ) : (
                    <input
                      type={field === 'email' ? 'email' : field === 'phone' ? 'tel' : 'text'}
                      value={profileForm[field] || ''}
                      onChange={(e) => setProfileForm({...profileForm, [field]: e.target.value})}
                      disabled={!editMode}
                      style={editMode ? styles.input : styles.disabledInput}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Businesses Tab */}
        {activeTab === 'businesses' && (
          <div style={styles.section}>
            <div style={styles.sectionHeader}>
              <div>
                <h3>My Businesses ({businesses.length})</h3>
                <p style={styles.limitText}>{getLimitMessage('business')}</p>
              </div>
              <button 
                style={canAddBusiness() ? styles.addButton : styles.disabledButton}
                onClick={() => {
                  if (!canAddBusiness()) {
                    alert(getLimitMessage('business') + ' Please upgrade to Premium to add more businesses.');
                    return;
                  }
                  setBusinessForm({ 
                    name: '', 
                    address: '', 
                    phone: '', 
                    email: '', 
                    website: '', 
                    category: '',
                    socialMediaLinks: '',
                    operatingHours: '',
                    businessType: '',
                    registrationNumber: '',
                    taxId: ''
                  });
                  setShowBusinessModal(true);
                }}
                disabled={!canAddBusiness()}
              >
                {canAddBusiness() ? 'Add New Business' : 'Limit Reached'}
              </button>
            </div>
            
            <div style={styles.businessGrid}>
              {businesses.length === 0 ? (
                <div style={styles.emptyState}>
                  <p>No businesses found. Create your first business to get started!</p>
                </div>
              ) : (
                businesses.map((business) => (
                  <div key={business._id} style={styles.businessCard}>
                    <div style={styles.businessIcon}>
                      {business.name.charAt(0).toUpperCase()}
                    </div>
                    <div style={styles.businessInfo}>
                      <h4>{business.name}</h4>
                      <p><strong>Category:</strong> {business.category}</p>
                      <p><strong>Type:</strong> {business.businessType}</p>
                      <p><strong>Phone:</strong> {business.phone}</p>
                      <p><strong>Email:</strong> {business.email}</p>
                      {business.website && (
                        <p><strong>Website:</strong> <a href={business.website} target="_blank" rel="noopener noreferrer">{business.website}</a></p>
                      )}
                      <p><strong>Operating Hours:</strong> {business.operatingHours || 'Not specified'}</p>
                      <p style={styles.statusActive}>Active</p>
                    </div>
                    <div style={styles.businessActions}>
                      <button 
                        style={styles.editBtn}
                        onClick={() => {
                          setEditingBusiness(business);
                          setBusinessForm({
                            name: business.name,
                            address: business.address || '',
                            phone: business.phone || '',
                            email: business.email || '',
                            website: business.website || '',
                            category: business.category || '',
                            socialMediaLinks: business.socialMediaLinks || '',
                            operatingHours: business.operatingHours || '',
                            businessType: business.businessType || '',
                            registrationNumber: business.registrationNumber || '',
                            taxId: business.taxId || ''
                          });
                          setShowBusinessModal(true);
                        }}
                      >
                        Edit
                      </button>
                      <button 
                        style={styles.deleteBtn}
                        onClick={() => handleDeleteBusiness(business._id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Offers Tab */}
        {activeTab === 'offers' && (
          <div style={styles.section}>
            <div style={styles.sectionHeader}>
              <div>
                <h3>Offers & Promotions ({offers.length})</h3>
                <p style={styles.limitText}>{getLimitMessage('offer')}</p>
              </div>
              <button 
                style={canAddOffer() ? styles.addButton : styles.disabledButton}
                onClick={() => {
                  if (businesses.length === 0) {
                    alert('Please create a business first before adding offers!');
                    return;
                  }
                  if (!canAddOffer()) {
                    alert(getLimitMessage('offer') + ' Please upgrade to Premium to add more offers.');
                    return;
                  }
                  setOfferForm({ 
                    businessId: '', 
                    title: '', 
                    discount: '', 
                    startDate: '', 
                    endDate: '', 
                    category: '', 
                    isActive: true 
                  });
                  setShowOfferModal(true);
                }}
                disabled={!canAddOffer()}
              >
                {canAddOffer() ? 'Create New Offer' : 'Limit Reached'}
              </button>
            </div>
            
            {offers.length === 0 ? (
              <div style={styles.emptyState}>
                <p>No offers found. Create your first offer to attract customers!</p>
              </div>
            ) : (
              <div style={styles.offersGrid}>
                {offers.map((offer) => {
                  const isCurrentlyActive = isOfferCurrentlyActive(offer);
                  const startDate = offer.startDate ? new Date(offer.startDate) : null;
                  const endDate = offer.endDate ? new Date(offer.endDate) : null;
                  const now = new Date();
                  
                  return (
                    <div key={offer._id} style={styles.offerCard}>
                      <div style={styles.offerHeader}>
                        <h4>{offer.title}</h4>
                        <span style={isCurrentlyActive ? styles.statusActive : styles.statusInactive}>
                          {startDate && startDate > now 
                            ? 'Scheduled' 
                            : endDate && endDate < now 
                            ? 'Expired' 
                            : isCurrentlyActive 
                            ? 'Active' 
                            : 'Inactive'}
                        </span>
                      </div>
                      <div style={styles.offerContent}>
                        <p style={styles.discount}>{offer.discount} OFF</p>
                        <p><strong>Business:</strong> {businesses.find(b => b._id === offer.businessId)?.name || 'Unknown'}</p>
                        <p><strong>Category:</strong> {offer.category}</p>
                        {offer.startDate && (
                          <p><strong>Start Date:</strong> {new Date(offer.startDate).toLocaleDateString()}</p>
                        )}
                        {offer.endDate && (
                          <p><strong>End Date:</strong> {new Date(offer.endDate).toLocaleDateString()}</p>
                        )}
                      </div>
                      <div style={styles.offerActions}>
                        <button 
                          style={styles.editBtn}
                          onClick={() => {
                            setEditingOffer(offer);
                            setOfferForm({
                              businessId: offer.businessId,
                              title: offer.title,
                              discount: offer.discount,
                              startDate: offer.startDate ? offer.startDate.split('T')[0] : '',
                              endDate: offer.endDate ? offer.endDate.split('T')[0] : '',
                              category: offer.category || '',
                              isActive: offer.isActive
                            });
                            setShowOfferModal(true);
                          }}
                        >
                          Edit
                        </button>
                        <button 
                          style={styles.toggleBtn}
                          onClick={() => toggleOfferStatus(offer._id, offer.isActive)}
                        >
                          {offer.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                        <button 
                          style={styles.deleteBtn}
                          onClick={() => handleDeleteOffer(offer._id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Subscription Tab */}
        {activeTab === 'subscription' && (
          <div style={styles.section}>
            <h3>Subscription Management</h3>
            <div style={styles.subscriptionCard}>
              <div style={styles.subscriptionStatus}>
                <h4>{subscriptionStatus.status}</h4>
                {subscription.nextBillingDate && (
                  <p>Next billing date: {new Date(subscription.nextBillingDate).toLocaleDateString()}</p>
                )}
                {subscription.endDate && (
                  <p>
                    Subscription ends: {new Date(subscription.endDate).toLocaleDateString()}
                    {isSubscriptionExpired() && <span style={styles.expiredText}> (Expired)</span>}
                  </p>
                )}
              </div>
              
              {/* Plan Limits Information */}
              <div style={styles.planLimits}>
                <h5>Current Plan Limits:</h5>
                <ul>
                  <li>Businesses: {businesses.length}/{getSubscriptionLimits().maxBusinesses}</li>
                  <li>Offers: {offers.length}/{getSubscriptionLimits().maxOffers}</li>
                </ul>
              </div>
              
              <div style={styles.subscriptionMessage}>
                <p>{subscriptionStatus.message}</p>
              </div>
              
              <div style={styles.subscriptionActions}>
                {subscriptionStatus.showUpgrade ? (
                  <>
                    <button 
                      style={styles.upgradeButton}
                      onClick={handleSubscriptionNavigation}
                    >
                      {subscriptionStatus.buttonText}
                    </button>
                    {isFreeUser() && (
                      <p style={styles.upgradeNote}>
                        Upgrade to Premium to get 3 businesses and 9 offers!
                      </p>
                    )}
                    {isPremiumUser() && !hasActiveSubscription() && (
                      <p style={styles.upgradeNote}>
                        Renew your Premium subscription to restore full access.
                      </p>
                    )}
                  </>
                ) : (
                  <div style={styles.premiumMessage}>
                    <p style={styles.premiumText}>🎉 {subscriptionStatus.message}</p>
                    <button 
                      style={styles.disabledButton}
                      disabled
                    >
                      {subscriptionStatus.buttonText}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Notifications Tab */}
        {activeTab === 'notifications' && (
          <div style={styles.section}>
            <div style={styles.sectionHeader}>
              <h3>Push Notifications</h3>
            </div>
            
            {notifications.length === 0 ? (
              <div style={styles.emptyState}>
                <p>No notifications found.</p>
              </div>
            ) : (
              <div style={styles.notificationsList}>
                {notifications.map((notification, index) => (
                  <div key={index} style={styles.notificationItem}>
                    <div>
                      <p><strong>Date:</strong> {notification.sentDate}</p>
                      <p><strong>Audience:</strong> {notification.audience}</p>
                    </div>
                    <span style={styles.statusSent}>{notification.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Business Modal */}
      {showBusinessModal && (
        <div style={styles.modal}>
          <div style={styles.modalContent}>
            <h3>{editingBusiness ? 'Edit Business' : 'Add New Business'}</h3>
            <div style={styles.modalForm}>
              {Object.entries({
                'Business Name': 'name',
                'Business Type': 'businessType',
                'Category': 'category',
                'Address': 'address',
                'Phone': 'phone',
                'Email': 'email',
                'Website': 'website',
                'Operating Hours': 'operatingHours',
                'Social Media Links': 'socialMediaLinks',
                'Registration Number': 'registrationNumber',
                'Tax ID': 'taxId'
              }).map(([label, field]) => (
                <div key={field} style={styles.formGroup}>
                  <label>{label}</label>
                  {field === 'businessType' ? (
                    <select
                      value={businessForm[field] || ''}
                      onChange={(e) => setBusinessForm({...businessForm, [field]: e.target.value})}
                      style={styles.input}
                    >
                      <option value="">Select Business Type</option>
                      <option value="Restaurant">Restaurant</option>
                      <option value="Retail">Retail</option>
                      <option value="Service">Service</option>
                      <option value="Manufacturing">Manufacturing</option>
                      <option value="Healthcare">Healthcare</option>
                      <option value="Education">Education</option>
                      <option value="Technology">Technology</option>
                      <option value="Other">Other</option>
                    </select>
                  ) : field === 'operatingHours' ? (
                    <input
                      type="text"
                      value={businessForm[field]}
                      onChange={(e) => setBusinessForm({...businessForm, [field]: e.target.value})}
                      style={styles.input}
                      placeholder="e.g., Mon-Fri 9AM-6PM, Sat 10AM-4PM"
                    />
                  ) : field === 'socialMediaLinks' ? (
                    <textarea
                      value={businessForm[field]}
                      onChange={(e) => setBusinessForm({...businessForm, [field]: e.target.value})}
                      style={styles.textarea}
                      placeholder="Facebook, Instagram, LinkedIn URLs (one per line)"
                      rows="3"
                    />
                  ) : (
                    <input
                      type={field === 'email' ? 'email' : field === 'website' ? 'url' : 'text'}
                      value={businessForm[field]}
                      onChange={(e) => setBusinessForm({...businessForm, [field]: e.target.value})}
                      style={styles.input}
                      placeholder={`Enter ${label.toLowerCase()}`}
                      required={field === 'name'}
                    />
                  )}
                </div>
              ))}
            </div>
            <div style={styles.modalActions}>
              <button style={styles.saveButton} onClick={handleBusinessSubmit}>
                {editingBusiness ? 'Update' : 'Create'}
              </button>
              <button 
                style={styles.cancelButton} 
                onClick={() => {
                  setShowBusinessModal(false);
                  setEditingBusiness(null);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Offer Modal */}
      {showOfferModal && (
        <div style={styles.modal}>
          <div style={styles.modalContent}>
            <h3>{editingOffer ? 'Edit Offer' : 'Create New Offer'}</h3>
            <div style={styles.modalForm}>
              <div style={styles.formGroup}>
                <label>Select Business</label>
                <select
                  value={offerForm.businessId}
                  onChange={(e) => setOfferForm({...offerForm, businessId: e.target.value})}
                  style={styles.input}
                  required
                >
                  <option value="">Select a business</option>
                  {businesses.map((business) => (
                    <option key={business._id} value={business._id}>
                      {business.name}
                    </option>
                  ))}
                </select>
              </div>
              
              <div style={styles.formGroup}>
                <label>Offer Title</label>
                <input
                  type="text"
                  value={offerForm.title}
                  onChange={(e) => setOfferForm({...offerForm, title: e.target.value})}
                  style={styles.input}
                  placeholder="Enter offer title"
                  required
                />
              </div>

              <div style={styles.formGroup}>
                <label>Discount</label>
                <input
                  type="text"
                  value={offerForm.discount}
                  onChange={(e) => setOfferForm({...offerForm, discount: e.target.value})}
                  style={styles.input}
                  placeholder="e.g., 20% or $10"
                  required
                />
              </div>

              <div style={styles.formGroup}>
                <label>Category</label>
                <select
                  value={offerForm.category}
                  onChange={(e) => setOfferForm({...offerForm, category: e.target.value})}
                  style={styles.input}
                >
                  <option value="">Select category</option>
                  <option value="Food & Dining">Food & Dining</option>
                  <option value="Shopping">Shopping</option>
                  <option value="Services">Services</option>
                  <option value="Entertainment">Entertainment</option>
                  <option value="Health & Beauty">Health & Beauty</option>
                  <option value="Travel">Travel</option>
                  <option value="Education">Education</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              
              <div style={styles.dateRow}>
                <div style={styles.formGroup}>
                  <label>Start Date</label>
                  <input
                    type="date"
                    value={offerForm.startDate}
                    onChange={(e) => setOfferForm({...offerForm, startDate: e.target.value})}
                    style={styles.input}
                    min={new Date().toISOString().split('T')[0]}
                  />
                </div>
                
                <div style={styles.formGroup}>
                  <label>End Date</label>
                  <input
                    type="date"
                    value={offerForm.endDate}
                    onChange={(e) => setOfferForm({...offerForm, endDate: e.target.value})}
                    style={styles.input}
                    min={offerForm.startDate || new Date().toISOString().split('T')[0]}
                  />
                </div>
              </div>
              
              <div style={styles.formGroup}>
                <label>
                  <input
                    type="checkbox"
                    checked={offerForm.isActive}
                    onChange={(e) => setOfferForm({...offerForm, isActive: e.target.checked})}
                    style={{marginRight: '8px'}}
                  />
                  Active
                </label>
              </div>
            </div>
            <div style={styles.modalActions}>
              <button style={styles.saveButton} onClick={handleOfferSubmit}>
                {editingOffer ? 'Update' : 'Create'}
              </button>
              <button 
                style={styles.cancelButton} 
                onClick={() => {
                  setShowOfferModal(false);
                  setEditingOffer(null);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div style={styles.modal}>
          <div style={styles.modalContent}>
            <h3>Delete Account</h3>
            <p>Are you sure you want to delete your account? This action cannot be undone.</p>
            <div style={styles.modalActions}>
              <button style={styles.deleteButton} onClick={handleDeleteAccount}>
                Yes, Delete My Account
              </button>
              <button style={styles.cancelButton} onClick={() => setShowDeleteConfirm(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    width: '100vw',
    backgroundColor: '#f8f9fa',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'auto'
  },
  loading: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    width: '100vw'
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '4px solid #f3f3f3',
    borderTop: '4px solid #007bff',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'white',
    padding: '1.5rem 2rem',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    flexWrap: 'wrap',
    gap: '1rem'
  },
  profileSection: {
    display: 'flex',
    alignItems: 'center',
    minWidth: '200px'
  },
  avatar: {
    width: '60px',
    height: '60px',
    borderRadius: '50%',
    marginRight: '15px',
    objectFit: 'cover'
  },
  userInfo: {
    display: 'flex',
    flexDirection: 'column'
  },
  userName: {
    margin: '0 0 5px 0',
    fontSize: '1.5rem',
    fontWeight: '600',
    color: '#212529'
  },
  userEmail: {
    margin: 0,
    color: '#6c757d',
    fontSize: '0.9rem'
  },
  headerActions: {
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap'
  },
  logoutButton: {
    padding: '10px 20px',
    backgroundColor: '#dc3545',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.9rem',
    fontWeight: '500',
    transition: 'all 0.2s ease'
  },
  tabs: {
    display: 'flex',
    backgroundColor: 'white',
    boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
    overflowX: 'auto',
    WebkitOverflowScrolling: 'touch'
  },
  tab: {
    flex: '1',
    minWidth: '120px',
    padding: '16px 12px',
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontSize: '0.9rem',
    fontWeight: '500',
    color: '#6c757d',
    borderBottom: '3px solid transparent',
    transition: 'all 0.2s ease',
    textTransform: 'capitalize'
  },
  activeTab: {
    flex: '1',
    minWidth: '120px',
    padding: '16px 12px',
    backgroundColor: 'transparent',
    color: '#007bff',
    border: 'none',
    cursor: 'pointer',
    fontSize: '0.9rem',
    fontWeight: '600',
    borderBottom: '3px solid #007bff',
    transition: 'all 0.2s ease',
    textTransform: 'capitalize'
  },
  content: {
    flex: '1',
    padding: '2rem',
    overflow: 'auto',
    maxWidth: '100%'
  },
  section: {
    width: '100%',
    backgroundColor: 'white',
    borderRadius: '12px',
    padding: '2rem',
    boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
    border: '1px solid #e9ecef'
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '2rem',
    paddingBottom: '1rem',
    borderBottom: '2px solid #f8f9fa',
    flexWrap: 'wrap',
    gap: '1rem'
  },
  limitText: {
    margin: '0.5rem 0 0 0',
    fontSize: '0.85rem',
    color: '#6c757d',
    fontStyle: 'italic'
  },
  profileGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '1.5rem',
    marginBottom: '2rem'
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  input: {
    padding: '12px 16px',
    border: '2px solid #e9ecef',
    borderRadius: '8px',
    fontSize: '0.95rem',
    transition: 'border-color 0.2s ease',
    fontFamily: 'inherit',
    outline: 'none'
  },
  disabledInput: {
    padding: '12px 16px',
    border: '2px solid #f8f9fa',
    borderRadius: '8px',
    fontSize: '0.95rem',
    backgroundColor: '#f8f9fa',
    color: '#6c757d',
    cursor: 'not-allowed'
  },
  textarea: {
    padding: '12px 16px',
    border: '2px solid #e9ecef',
    borderRadius: '8px',
    fontSize: '0.95rem',
    minHeight: '100px',
    resize: 'vertical',
    fontFamily: 'inherit',
    outline: 'none',
    transition: 'border-color 0.2s ease'
  },
  dateRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '1rem'
  },
  editButton: {
    padding: '10px 20px',
    backgroundColor: '#007bff',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.9rem',
    fontWeight: '500',
    transition: 'background-color 0.2s ease'
  },
  saveButton: {
    padding: '10px 20px',
    backgroundColor: '#28a745',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.9rem',
    fontWeight: '500',
    marginRight: '10px',
    transition: 'background-color 0.2s ease'
  },
  cancelButton: {
    padding: '10px 20px',
    backgroundColor: '#6c757d',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.9rem',
    fontWeight: '500',
    transition: 'background-color 0.2s ease'
  },
  dangerZone: {
    borderTop: '2px solid #dc3545',
    paddingTop: '2rem',
    marginTop: '2rem'
  },
  deleteButton: {
    padding: '12px 24px',
    backgroundColor: '#dc3545',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.9rem',
    fontWeight: '500',
    transition: 'background-color 0.2s ease'
  },
  addButton: {
    padding: '12px 24px',
    backgroundColor: '#28a745',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.9rem',
    fontWeight: '500',
    transition: 'background-color 0.2s ease'
  },
  disabledButton: {
    padding: '12px 24px',
    backgroundColor: '#6c757d',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'not-allowed',
    fontSize: '0.9rem',
    fontWeight: '500',
    opacity: 0.6
  },
  businessGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
    gap: '1.5rem'
  },
  businessCard: {
    display: 'flex',
    flexDirection: 'column',
    padding: '1.5rem',
    border: '2px solid #e9ecef',
    borderRadius: '12px',
    backgroundColor: '#fff',
    transition: 'all 0.2s ease',
    boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
  },
  businessIcon: {
    width: '50px',
    height: '50px',
    borderRadius: '12px',
    backgroundColor: '#007bff',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 'bold',
    fontSize: '1.2rem',
    marginBottom: '1rem',
    alignSelf: 'flex-start'
  },
  businessInfo: {
    flex: '1',
    marginBottom: '1rem'
  },
  businessActions: {
    display: 'flex',
    gap: '0.5rem',
    flexWrap: 'wrap'
  },
  editBtn: {
    padding: '8px 16px',
    backgroundColor: '#007bff',
    color: 'white',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: '500',
    transition: 'background-color 0.2s ease'
  },
  deleteBtn: {
    padding: '8px 16px',
    backgroundColor: '#dc3545',
    color: 'white',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: '500',
    transition: 'background-color 0.2s ease'
  },
  toggleBtn: {
    padding: '8px 16px',
    backgroundColor: '#ffc107',
    color: '#212529',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: '500',
    transition: 'background-color 0.2s ease'
  },
  offersGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
    gap: '1.5rem'
  },
  offerCard: {
    border: '2px solid #e9ecef',
    borderRadius: '12px',
    backgroundColor: '#fff',
    padding: '1.5rem',
    transition: 'all 0.2s ease',
    boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
  },
  offerHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '1rem',
    flexWrap: 'wrap',
    gap: '0.5rem'
  },
  offerContent: {
    marginBottom: '1rem'
  },
  discount: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    color: '#28a745',
    margin: '0.5rem 0'
  },
  offerActions: {
    display: 'flex',
    gap: '0.5rem',
    flexWrap: 'wrap'
  },
  statusActive: {
    color: '#28a745',
    fontWeight: '600',
    fontSize: '0.85rem',
    backgroundColor: '#d4edda',
    padding: '4px 8px',
    borderRadius: '4px',
    border: '1px solid #c3e6cb'
  },
  statusInactive: {
    color: '#dc3545',
    fontWeight: '600',
    fontSize: '0.85rem',
    backgroundColor: '#f8d7da',
    padding: '4px 8px',
    borderRadius: '4px',
    border: '1px solid #f5c6cb'
  },
  statusSent: {
    color: '#17a2b8',
    fontWeight: '600',
    fontSize: '0.85rem',
    backgroundColor: '#d1ecf1',
    padding: '4px 8px',
    borderRadius: '4px',
    border: '1px solid #bee5eb'
  },
  subscriptionCard: {
    padding: '2rem',
    border: '2px solid #e9ecef',
    borderRadius: '12px',
    backgroundColor: '#f8f9fa',
    maxWidth: '600px'
  },
  subscriptionStatus: {
    marginBottom: '1.5rem',
    padding: '1rem',
    backgroundColor: 'white',
    borderRadius: '8px',
    border: '1px solid #e9ecef'
  },
  expiredText: {
    color: '#dc3545',
    fontWeight: 'bold'
  },
  planLimits: {
    margin: '1.5rem 0',
    padding: '1rem',
    backgroundColor: 'white',
    borderRadius: '8px',
    border: '1px solid #e9ecef'
  },
  subscriptionMessage: {
    margin: '1rem 0',
    padding: '1rem',
    backgroundColor: '#e7f3ff',
    borderRadius: '8px',
    border: '1px solid #bee5eb'
  },
  subscriptionActions: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
    marginTop: '1.5rem'
  },
  upgradeButton: {
    padding: '12px 24px',
    backgroundColor: '#28a745',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.9rem',
    fontWeight: '500',
    transition: 'background-color 0.2s ease'
  },
  premiumMessage: {
    textAlign: 'center',
    padding: '1.5rem',
    backgroundColor: '#d4edda',
    borderRadius: '8px',
    border: '1px solid #c3e6cb'
  },
  premiumText: {
    margin: '0 0 1rem 0',
    fontSize: '1.1rem',
    fontWeight: '600',
    color: '#155724'
  },
  upgradeNote: {
    margin: '0.5rem 0 0 0',
    fontSize: '0.9rem',
    color: '#6c757d',
    fontStyle: 'italic',
    textAlign: 'center'
  },
  notificationsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem'
  },
  notificationItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1rem',
    border: '1px solid #e9ecef',
    borderRadius: '8px',
    backgroundColor: '#f8f9fa',
    flexWrap: 'wrap',
    gap: '0.5rem'
  },
  emptyState: {
    textAlign: 'center',
    padding: '3rem 1rem',
    color: '#6c757d',
    backgroundColor: '#f8f9fa',
    borderRadius: '12px',
    border: '2px dashed #dee2e6'
  },
  modal: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '1rem'
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: '12px',
    width: '100%',
    maxWidth: '600px',
    maxHeight: '90vh',
    overflow: 'auto',
    boxShadow: '0 20px 40px rgba(0,0,0,0.1)'
  },
  modalForm: {
    padding: '2rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem'
  },
  modalActions: {
    display: 'flex',
    gap: '1rem',
    padding: '1.5rem 2rem',
    borderTop: '1px solid #e9ecef',
    justifyContent: 'flex-end',
    flexWrap: 'wrap'
  },
  // Responsive styles
  '@media (max-width: 768px)': {
    container: {
      padding: 0
    },
    header: {
      flexDirection: 'column',
      alignItems: 'stretch',
      gap: '1rem',
      padding: '1rem'
    },
    profileSection: {
      justifyContent: 'center'
    },
    headerActions: {
      justifyContent: 'center'
    },
    content: {
      padding: '1rem'
    },
    profileGrid: {
      gridTemplateColumns: '1fr'
    },
    businessGrid: {
      gridTemplateColumns: '1fr'
    },
    offersGrid: {
      gridTemplateColumns: '1fr'
    },
    dateRow: {
      gridTemplateColumns: '1fr'
    },
    sectionHeader: {
      flexDirection: 'column',
      alignItems: 'stretch',
      textAlign: 'center'
    },
    modalContent: {
      margin: '1rem',
      maxWidth: 'calc(100vw - 2rem)'
    }
  }
}

export default BusinessUserProfile;