import React, { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../src/AuthContext';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { subscriptionUtils } from '../src/subscriptionUtils';

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
  const [showNotificationBanner, setShowNotificationBanner] = useState(true);

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

  // Enhanced offer status helper
  const getOfferStatusDisplay = (offer) => {
    const now = new Date();
    const startDate = offer.startDate ? new Date(offer.startDate) : null;
    const endDate = offer.endDate ? new Date(offer.endDate) : null;

    // Admin status takes priority
    switch (offer.adminStatus) {
      case 'pending':
        return {
          status: 'Pending Review',
          color: '#ffc107',
          backgroundColor: '#fff3cd',
          borderColor: '#ffeaa7',
          icon: '⏳',
          message: 'Your offer is waiting for admin approval',
          canEdit: true,
          canToggle: false
        };

      case 'declined':
        return {
          status: 'Declined',
          color: '#dc3545',
          backgroundColor: '#f8d7da',
          borderColor: '#f5c6cb',
          icon: '❌',
          message: offer.adminComments ? `Declined: ${offer.adminComments}` : 'Offer was declined by admin',
          canEdit: true,
          canToggle: false
        };

      case 'approved':
        // For approved offers, check time-based status
        if (startDate && startDate > now) {
          return {
            status: 'Approved - Scheduled',
            color: '#17a2b8',
            backgroundColor: '#d1ecf1',
            borderColor: '#bee5eb',
            icon: '📅',
            message: `Approved! Will start on ${startDate.toLocaleDateString()}`,
            canEdit: false,
            canToggle: true
          };
        } else if (endDate && endDate < now) {
          return {
            status: 'Expired',
            color: '#6c757d',
            backgroundColor: '#e2e3e5',
            borderColor: '#d6d8db',
            icon: '⏰',
            message: 'Offer has expired',
            canEdit: false,
            canToggle: false
          };
        } else if (!offer.isActive) {
          return {
            status: 'Approved - Inactive',
            color: '#fd7e14',
            backgroundColor: '#fee2d5',
            borderColor: '#fdd5b5',
            icon: '⏸️',
            message: 'Approved but manually deactivated',
            canEdit: false,
            canToggle: true
          };
        } else {
          return {
            status: 'Live',
            color: '#28a745',
            backgroundColor: '#d4edda',
            borderColor: '#c3e6cb',
            icon: '✅',
            message: 'Your offer is live and visible to customers!',
            canEdit: false,
            canToggle: true
          };
        }

      default:
        return {
          status: 'Unknown',
          color: '#6c757d',
          backgroundColor: '#e2e3e5',
          borderColor: '#d6d8db',
          icon: '❓',
          message: 'Status unknown',
          canEdit: false,
          canToggle: false
        };
    }
  };

  // Get offers summary
  const getOffersSummary = () => {
    const pending = offers.filter(o => o.adminStatus === 'pending').length;
    const approved = offers.filter(o => o.adminStatus === 'approved').length;
    const declined = offers.filter(o => o.adminStatus === 'declined').length;
    const live = offers.filter(o => {
      const statusInfo = getOfferStatusDisplay(o);
      return statusInfo.status === 'Live';
    }).length;

    return { pending, approved, declined, live, total: offers.length };
  };

  // Toast notification system
  const showToastNotification = (message, type = 'info') => {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 16px 20px;
      background: ${type === 'success' ? '#d4edda' : type === 'error' ? '#f8d7da' : '#d1ecf1'};
      color: ${type === 'success' ? '#155724' : type === 'error' ? '#721c24' : '#0c5460'};
      border: 1px solid ${type === 'success' ? '#c3e6cb' : type === 'error' ? '#f5c6cb' : '#bee5eb'};
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 9999;
      max-width: 400px;
      font-family: inherit;
      font-size: 14px;
      transition: all 0.3s ease;
    `;
    toast.textContent = message;

    document.body.appendChild(toast);

    setTimeout(() => {
      if (toast.parentNode) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.parentNode.removeChild(toast), 300);
      }
    }, 5000);
  };

  // Helper function to get subscription limits
  const getSubscriptionLimits = () => {
    console.log('Current subscription:', subscription);

    if (subscription.planName &&
      subscription.planName.toLowerCase() === 'premium' &&
      subscription.status === 'active' &&
      !isSubscriptionExpired()) {
      return {
        maxBusinesses: 3,
        maxOffers: 9
      };
    }

    return subscriptionUtils.getSubscriptionLimits(subscription);
  };

  const canAddBusiness = () => {
    return subscriptionUtils.canAddBusiness(businesses.length, subscription);
  };

  const canAddOffer = () => {
    return subscriptionUtils.canAddOffer(offers.length, subscription);
  };

  const getLimitMessage = (type) => {
    if (type === 'business') {
      return subscriptionUtils.getLimitMessage('business', businesses.length, subscription);
    } else if (type === 'offer') {
      return subscriptionUtils.getLimitMessage('offer', offers.length, subscription);
    }
  };

  const isFreeUser = () => {
    return subscriptionUtils.isFreeUser(subscription);
  };

  const isPremiumUser = () => {
    return subscriptionUtils.isPremiumUser(subscription);
  };

  const isSubscriptionExpired = () => {
    if (!subscription || !subscription.endDate) return false;
    return new Date() > new Date(subscription.endDate);
  };

  const hasActiveSubscription = () => {
    if (!subscription) return false;
    if (subscription.planId === '1') return true;
    if (!subscription.endDate) return subscription.status === 'active';
    return subscription.status === 'active' && !isSubscriptionExpired();
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

      const profileResponse = await axios.post(
        'http://localhost:5555/api/user/profile-by-email',
        { email: user.email },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (profileResponse.data.success) {
        const userData = profileResponse.data.user;
        setUserDetails(userData);
        setProfileForm(userData);

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
        console.log('Debugging offers data from server:', response.data.offers.map(o => ({
          id: o._id,
          title: o.title,
          businessId: o.businessId,
          businessName: o.businessId?.name || 'No name populated'
        })));
        setOffers(response.data.offers);
      }
    } catch (error) {
      console.error('Error fetching offers:', error);
      setOffers([]);
    }
  };

  const fetchSubscription = async (userId) => {
    try {
      console.log('Fetching subscription for userId:', userId);

      const response = await axios.post('http://localhost:5555/api/user/check-subscription', {
        userId: userId,
        email: user.email
      });

      console.log('Subscription response:', response.data);

      if (response.data.success && response.data.subscription) {
        const subscriptionData = response.data.subscription;
        setSubscription({
          planId: subscriptionData.planId,
          planName: subscriptionData.planName,
          status: subscriptionData.status,
          billingCycle: subscriptionData.billingCycle,
          endDate: subscriptionData.endDate,
          paymentMethod: subscriptionData.paymentMethod
        });
      } else {
        setSubscription({
          planId: '1',
          planName: 'Free',
          status: 'active',
          billingCycle: 'monthly',
          endDate: null,
          paymentMethod: 'free'
        });
      }
    } catch (error) {
      console.error('Error fetching subscription:', error);
      setSubscription({
        planId: '1',
        planName: 'Free',
        status: 'active',
        billingCycle: 'monthly',
        endDate: null,
        paymentMethod: 'free'
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
        showToastNotification('Profile updated successfully!', 'success');
      }
    } catch (error) {
      console.error('Error updating profile:', error);
      showToastNotification('Failed to update profile', 'error');
    }
  };

  const handleDeleteAccount = async () => {
    try {
      const response = await axios.delete(
        `http://localhost:5555/api/auth/users/${userDetails._id}`
      );

      if (response.data.success) {
        showToastNotification('Account deleted successfully', 'success');
        logout();
        navigate('/');
      }
    } catch (error) {
      console.error('Error deleting account:', error);
      showToastNotification('Failed to delete account', 'error');
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
          showToastNotification('Business updated successfully!', 'success');
        }
      } else {
        if (!subscriptionUtils.canAddBusiness(businesses.length, subscription)) {
          const limitMessage = subscriptionUtils.getLimitMessage('business', businesses.length, subscription);
          showToastNotification(limitMessage + ' Please upgrade to Premium to add more businesses.', 'error');
          return;
        }

        const response = await axios.post(
          'http://localhost:5555/api/businesses',
          { ...businessForm, userId: userDetails.userId }
        );
        if (response.data.success) {
          await fetchBusinesses(userDetails.userId);
          showToastNotification('Business created successfully!', 'success');
        }
      }
      setShowBusinessModal(false);
      setEditingBusiness(null);
      setBusinessForm({
        name: '', address: '', phone: '', email: '', website: '', category: '',
        socialMediaLinks: '', operatingHours: '', businessType: '',
        registrationNumber: '', taxId: ''
      });
    } catch (error) {
      console.error('Error saving business:', error);
      showToastNotification(error.response?.data?.message || 'Failed to save business', 'error');
    }
  };

  const handleOfferSubmit = async () => {
    try {
      if (offerForm.startDate && offerForm.endDate) {
        const startDate = new Date(offerForm.startDate);
        const endDate = new Date(offerForm.endDate);

        if (startDate >= endDate) {
          showToastNotification('End date must be after start date!', 'error');
          return;
        }
      }

      if (editingOffer) {
        // EDITING EXISTING OFFER
        const response = await axios.put(
          `http://localhost:5555/api/offers/${editingOffer._id}`,
          {
            ...offerForm,
            userId: userDetails.userId,
            // Add flag to indicate this is an edit that needs re-approval
            requiresReapproval: true
          }
        );

        if (response.data.success) {
          await fetchOffers(userDetails.userId);

          // Show different messages based on status reset
          if (response.data.statusReset) {
            showToastNotification('Offer updated successfully! It will need admin re-approval before going live again.', 'info');
          } else if (editingOffer.adminStatus === 'declined') {
            showToastNotification('Offer updated successfully! It has been resubmitted for admin review.', 'info');
          } else {
            showToastNotification('Offer updated successfully!', 'success');
          }
        }
      } else {
        // CREATING NEW OFFER
        if (!subscriptionUtils.canAddOffer(offers.length, subscription)) {
          const limitMessage = subscriptionUtils.getLimitMessage('offer', offers.length, subscription);
          showToastNotification(limitMessage + ' Please upgrade to Premium to add more offers.', 'error');
          return;
        }

        const response = await axios.post(
          'http://localhost:5555/api/offers',
          { ...offerForm, userId: userDetails.userId }
        );

        if (response.data.success) {
          if (response.data.pendingApproval) {
            showToastNotification('Offer submitted successfully! It will be visible once approved by admin.', 'info');
          } else {
            await sendOfferNotification(offerForm);
            showToastNotification('Offer created successfully! Email notification sent.', 'success');
          }
          await fetchOffers(userDetails.userId);
        }
      }

      setShowOfferModal(false);
      setEditingOffer(null);
      setOfferForm({
        businessId: '', title: '', discount: '', startDate: '',
        endDate: '', category: '', isActive: true
      });
    } catch (error) {
      console.error('Error saving offer:', error);
      showToastNotification(error.response?.data?.message || 'Failed to save offer', 'error');
    }
  };

  const sendOfferNotification = async (offerData) => {
    try {
      const business = businesses.find(b => b._id === offerData.businessId);
      const startDate = new Date(offerData.startDate);
      const today = new Date();

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
          showToastNotification('Business deleted successfully!', 'success');
        }
      } catch (error) {
        console.error('Error deleting business:', error);
        showToastNotification('Failed to delete business', 'error');
      }
    }
  };

  const handleDeleteOffer = async (offerId) => {
    if (window.confirm('Are you sure you want to delete this offer?')) {
      try {
        const response = await axios.delete(`http://localhost:5555/api/offers/${offerId}`);
        if (response.data.success) {
          await fetchOffers(userDetails.userId);
          showToastNotification('Offer deleted successfully!', 'success');
        }
      } catch (error) {
        console.error('Error deleting offer:', error);
        showToastNotification('Failed to delete offer', 'error');
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
        showToastNotification('Offer status updated successfully!', 'success');
      }
    } catch (error) {
      console.error('Error toggling offer status:', error);
      showToastNotification('Failed to update offer status', 'error');
    }
  };

  const handleSubscriptionNavigation = () => {
    if (isPremiumUser() && hasActiveSubscription()) {
      showToastNotification('You already have the Premium plan - the best package available!', 'info');
      return;
    }

    if (isPremiumUser() && !hasActiveSubscription()) {
      navigate('/SubscriptionPage');
      return;
    }

    if (isFreeUser()) {
      navigate('/SubscriptionPage');
      return;
    }

    navigate('/SubscriptionPage');
  };

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
      status: subscription.planName || 'Free',
      message: 'Manage your subscription',
      showUpgrade: true,
      buttonText: 'Manage Subscription'
    };
  };

  const isOfferCurrentlyActive = (offer) => {
    const now = new Date();
    const startDate = offer.startDate ? new Date(offer.startDate) : null;
    const endDate = offer.endDate ? new Date(offer.endDate) : null;

    if (startDate && startDate > now) return false;
    if (endDate && endDate < now) return false;

    return offer.isActive;
  };

  // Notification Banner Component
  const OfferNotificationBanner = () => {
    const summary = getOffersSummary();

    if (!showNotificationBanner || (summary.pending === 0 && summary.declined === 0)) {
      return null;
    }

    return (
      <div style={styles.notificationBanner}>
        <div style={styles.bannerContent}>
          <span style={styles.bannerIcon}>📢</span>
          <div style={styles.bannerText}>
            {summary.pending > 0 && (
              <span>
                {summary.pending} offer{summary.pending > 1 ? 's' : ''} pending admin review
                {summary.declined > 0 && ', '}
              </span>
            )}
            {summary.declined > 0 && (
              <span style={{ color: '#dc3545' }}>
                {summary.declined} offer{summary.declined > 1 ? 's' : ''} declined
              </span>
            )}
          </div>
        </div>
        <button
          style={styles.bannerClose}
          onClick={() => setShowNotificationBanner(false)}
        >
          ×
        </button>
      </div>
    );
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
  const summary = getOffersSummary();

  // Debugging data before render
  console.log('Debugging before render:');
  console.log('Businesses array:', businesses.map(b => ({ id: b._id, name: b.name })));
  console.log('Offers array:', offers.map(o => ({
    id: o._id,
    title: o.title,
    businessId: o.businessId,
    businessPopulated: typeof o.businessId === 'object' ? o.businessId : null
  })));

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
            <p style={{ margin: 0, color: '#28a745', fontSize: '0.8rem', fontWeight: '600' }}>
              {subscription.planName || 'Free'} Plan
            </p>
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
                      onChange={(e) => setProfileForm({ ...profileForm, [field]: e.target.value })}
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
                      onChange={(e) => setProfileForm({ ...profileForm, [field]: e.target.value })}
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
                style={subscriptionUtils.canAddBusiness(businesses.length, subscription) ? styles.addButton : styles.disabledButton}
                onClick={() => {
                  if (!subscriptionUtils.canAddBusiness(businesses.length, subscription)) {
                    const limitMessage = subscriptionUtils.getLimitMessage('business', businesses.length, subscription);
                    showToastNotification(limitMessage + ' Please upgrade to Premium to add more businesses.', 'error');
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

                  setEditingBusiness(null);
                  setShowBusinessModal(true);
                }}
                disabled={!subscriptionUtils.canAddBusiness(businesses.length, subscription)}
              >
                {subscriptionUtils.canAddBusiness(businesses.length, subscription) ? 'Add New Business' : 'Limit Reached'}
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
                <div style={styles.headerTitleRow}>
                  <h3>Offers & Promotions ({summary.total})</h3>
                  <div style={styles.offersSummaryStats}>
                    {summary.live > 0 && (
                      <span style={styles.summaryBadge.live}>
                        {summary.live} Live
                      </span>
                    )}
                    {summary.pending > 0 && (
                      <span style={styles.summaryBadge.pending}>
                        {summary.pending} Pending
                      </span>
                    )}
                    {summary.declined > 0 && (
                      <span style={styles.summaryBadge.declined}>
                        {summary.declined} Declined
                      </span>
                    )}
                  </div>
                </div>
                <p style={styles.limitText}>{getLimitMessage('offer')}</p>

                {/* Show notification banner */}
                <OfferNotificationBanner />
              </div>

              <button
                style={subscriptionUtils.canAddOffer(offers.length, subscription) ? styles.addButton : styles.disabledButton}
                onClick={() => {
                  if (businesses.length === 0) {
                    showToastNotification('Please create a business first before adding offers!', 'error');
                    return;
                  }
                  if (!subscriptionUtils.canAddOffer(offers.length, subscription)) {
                    const limitMessage = subscriptionUtils.getLimitMessage('offer', offers.length, subscription);
                    showToastNotification(limitMessage + ' Please upgrade to Premium to add more offers.', 'error');
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

                  setEditingOffer(null);
                  setShowOfferModal(true);
                }}
                disabled={!subscriptionUtils.canAddOffer(offers.length, subscription)}
              >
                {subscriptionUtils.canAddOffer(offers.length, subscription) ? 'Create New Offer' : 'Limit Reached'}
              </button>
            </div>

            {offers.length === 0 ? (
              <div style={styles.emptyState}>
                <p>No offers found. Create your first offer to attract customers!</p>
              </div>
            ) : (
              <div style={styles.offersGrid}>
                {offers.map((offer) => {
                  const statusInfo = getOfferStatusDisplay(offer);

                  // FIXED: Multiple ways to get business name
                  let businessName = 'Business not found';

                  // Method 1: If server populated the business data (recommended)
                  if (offer.businessId && typeof offer.businessId === 'object' && offer.businessId.name) {
                    businessName = offer.businessId.name;
                  }
                  // Method 2: Search in local businesses array as fallback
                  else {
                    const business = businesses.find(b => b._id.toString() === (offer.businessId._id || offer.businessId).toString());
                    if (business) {
                      businessName = business.name;
                    }
                  }

                  return (
                    <div key={offer._id} style={styles.offerCard}>
                      <div style={styles.offerHeader}>
                        <h4>{offer.title}</h4>
                        <div style={{
                          ...styles.statusBadge,
                          color: statusInfo.color,
                          backgroundColor: statusInfo.backgroundColor,
                          border: `1px solid ${statusInfo.borderColor}`,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '6px 12px',
                          borderRadius: '6px',
                          fontSize: '0.8rem',
                          fontWeight: '600'
                        }}>
                          <span>{statusInfo.icon}</span>
                          {statusInfo.status}
                        </div>
                      </div>

                      <div style={styles.offerContent}>
                        <p style={styles.discount}>{offer.discount} OFF</p>
                        {/* FIXED: Display business name with better debugging */}
                        <p><strong>Business:</strong> {businessName}</p>
                        {/* Show debug info in development */}
                        {process.env.NODE_ENV === 'development' && (
                          <p style={{ fontSize: '0.7rem', color: '#6c757d', fontStyle: 'italic' }}>
                            Debug: BusinessId = {typeof offer.businessId === 'object' ? offer.businessId._id : offer.businessId}
                          </p>
                        )}
                        <p><strong>Category:</strong> {offer.category}</p>

                        {offer.startDate && (
                          <p><strong>Start Date:</strong> {new Date(offer.startDate).toLocaleDateString()}</p>
                        )}
                        {offer.endDate && (
                          <p><strong>End Date:</strong> {new Date(offer.endDate).toLocaleDateString()}</p>
                        )}

                        {/* Admin review information */}
                        {offer.reviewedBy && offer.reviewedAt && (
                          <div style={styles.reviewInfo}>
                            <p style={{ fontSize: '0.85rem', color: '#6c757d', margin: '8px 0 4px 0' }}>
                              <strong>Reviewed by:</strong> {offer.reviewedBy} on {new Date(offer.reviewedAt).toLocaleDateString()}
                            </p>
                          </div>
                        )}

                        {/* Status message */}
                        <div style={{
                          ...styles.statusMessage,
                          backgroundColor: statusInfo.backgroundColor,
                          border: `1px solid ${statusInfo.borderColor}`,
                          color: statusInfo.color,
                          padding: '12px',
                          borderRadius: '6px',
                          margin: '12px 0',
                          fontSize: '0.9rem'
                        }}>
                          {statusInfo.message}
                        </div>

                        {/* Admin comments for declined offers */}
                        {offer.adminStatus === 'declined' && offer.adminComments && (
                          <div style={styles.adminComments}>
                            <p style={{ fontSize: '0.85rem', fontWeight: 'bold', margin: '8px 0 4px 0', color: '#dc3545' }}>
                              Reason for decline:
                            </p>
                            <p style={{ fontSize: '0.85rem', color: '#721c24', fontStyle: 'italic', margin: '0' }}>
                              "{offer.adminComments}"
                            </p>
                          </div>
                        )}
                      </div>

                      <div style={styles.offerActions}>
                        {/* Only show edit button for pending or declined offers */}
                        {statusInfo.canEdit && (
                          <button
                            style={styles.editBtn}
                            onClick={() => {
                              setEditingOffer(offer);
                              // FIXED: Handle both populated and non-populated businessId
                              const businessId = typeof offer.businessId === 'object' ? offer.businessId._id : offer.businessId;
                              setOfferForm({
                                businessId: businessId,
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
                        )}

                        {/* Only show toggle button for approved offers */}
                        {statusInfo.canToggle && (
                          <button
                            style={styles.toggleBtn}
                            onClick={() => toggleOfferStatus(offer._id, offer.isActive)}
                          >
                            {offer.isActive ? 'Deactivate' : 'Activate'}
                          </button>
                        )}

                        {/* Always show delete button */}
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
                    <p style={styles.premiumText}>{subscriptionStatus.message}</p>
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
            <h3 style={{ fontSize: '40px', textAlign: 'center', color: '#0063B4' }}>{editingBusiness ? 'Edit Business' : 'Add New Business'}</h3>
            <div style={styles.modalForm}>
              {Object.entries({
                'Business Name*': 'name',
                'Business Type': 'businessType',
                'Category': 'category',
                'Address': 'address',
                'Phone': 'phone',
                'Email': 'email',
                'Website': 'website',
                'Operating Hours': 'operatingHours',
                'Social Media Links': 'socialMediaLinks',

              }).map(([label, field]) => (
                <div key={field} style={styles.formGroup}>
                  <label>{label}</label>
                  {field === 'businessType' ? (
                    <select
                      value={businessForm[field] || ''}
                      onChange={(e) => setBusinessForm({ ...businessForm, [field]: e.target.value })}
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
                      onChange={(e) => setBusinessForm({ ...businessForm, [field]: e.target.value })}
                      style={styles.input}
                      placeholder="e.g., Mon-Fri 9AM-6PM, Sat 10AM-4PM"
                    />
                  ) : field === 'socialMediaLinks' ? (
                    <textarea
                      value={businessForm[field]}
                      onChange={(e) => setBusinessForm({ ...businessForm, [field]: e.target.value })}
                      style={styles.textarea}
                      placeholder="Facebook, Instagram, LinkedIn URLs (one per line)"
                      rows="3"
                    />
                  ) : (
                    <input
                      type={field === 'email' ? 'email' : field === 'website' ? 'url' : 'text'}
                      value={businessForm[field]}
                      onChange={(e) => setBusinessForm({ ...businessForm, [field]: e.target.value })}
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
            <h3 style={{ fontSize: '40px', textAlign: 'center', color: '#0063B4' }}>{editingOffer ? 'Edit Offer' : 'Create New Offer'}</h3>
            <div style={styles.modalForm}>
              <div style={styles.formGroup}>
                <label>Select Business</label>
                <select
                  value={offerForm.businessId}
                  onChange={(e) => setOfferForm({ ...offerForm, businessId: e.target.value })}
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
                  onChange={(e) => setOfferForm({ ...offerForm, title: e.target.value })}
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
                  onChange={(e) => setOfferForm({ ...offerForm, discount: e.target.value })}
                  style={styles.input}
                  placeholder="e.g., 20% or $10"
                  required
                />
              </div>

              <div style={styles.formGroup}>
                <label>Category</label>
                <select
                  value={offerForm.category}
                  onChange={(e) => setOfferForm({ ...offerForm, category: e.target.value })}
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
                    onChange={(e) => setOfferForm({ ...offerForm, startDate: e.target.value })}
                    style={styles.input}
                    min={new Date().toISOString().split('T')[0]}
                  />
                </div>

                <div style={styles.formGroup}>
                  <label>End Date</label>
                  <input
                    type="date"
                    value={offerForm.endDate}
                    onChange={(e) => setOfferForm({ ...offerForm, endDate: e.target.value })}
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
                    onChange={(e) => setOfferForm({ ...offerForm, isActive: e.target.checked })}
                    style={{ marginRight: '8px' }}
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

      {/* CSS Styles */}
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
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
  headerTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    flexWrap: 'wrap'
  },
  offersSummaryStats: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap'
  },
  summaryBadge: {
    live: {
      backgroundColor: '#d4edda',
      color: '#155724',
      border: '1px solid #c3e6cb',
      padding: '4px 8px',
      borderRadius: '4px',
      fontSize: '0.75rem',
      fontWeight: '600'
    },
    pending: {
      backgroundColor: '#fff3cd',
      color: '#856404',
      border: '1px solid #ffeaa7',
      padding: '4px 8px',
      borderRadius: '4px',
      fontSize: '0.75rem',
      fontWeight: '600'
    },
    declined: {
      backgroundColor: '#f8d7da',
      color: '#721c24',
      border: '1px solid #f5c6cb',
      padding: '4px 8px',
      borderRadius: '4px',
      fontSize: '0.75rem',
      fontWeight: '600'
    }
  },
  notificationBanner: {
    backgroundColor: '#fff3cd',
    border: '1px solid #ffeaa7',
    borderRadius: '8px',
    padding: '12px 16px',
    margin: '12px 0',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  bannerContent: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  bannerIcon: {
    fontSize: '1.2em'
  },
  bannerText: {
    fontSize: '0.9rem',
    color: '#856404'
  },
  bannerClose: {
    background: 'none',
    border: 'none',
    fontSize: '1.5rem',
    cursor: 'pointer',
    color: '#856404',
    padding: '0',
    width: '24px',
    height: '24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
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
  statusBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    whiteSpace: 'nowrap'
  },
  statusMessage: {
    borderRadius: '6px',
    padding: '12px',
    margin: '12px 0',
    fontSize: '0.9rem',
    lineHeight: '1.4'
  },
  reviewInfo: {
    borderTop: '1px solid #e9ecef',
    paddingTop: '12px',
    marginTop: '12px'
  },
  adminComments: {
    backgroundColor: '#fff3cd',
    border: '1px solid #ffeaa7',
    borderRadius: '6px',
    padding: '12px',
    margin: '12px 0'
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
  }
};

export default BusinessUserProfile;