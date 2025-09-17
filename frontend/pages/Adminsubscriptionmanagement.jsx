import React, { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';

// Mock NavBar component since it's not provided
const NavBar = ({ adminUser, logoutAdmin }) => (
  <div style={{ 
    background: '#667eea', 
    color: 'white', 
    padding: '1rem 2rem', 
    display: 'flex', 
    justifyContent: 'space-between', 
    alignItems: 'center',
    marginBottom: '2rem',
    borderRadius: '12px'
  }}>
    <h2 style={{ margin: 0 }}>Admin Dashboard</h2>
    <div>
      <span style={{ marginRight: '1rem' }}>Welcome, {adminUser?.username || 'Admin'}</span>
      <button 
        onClick={logoutAdmin}
        style={{
          background: 'rgba(255,255,255,0.2)',
          border: 'none',
          color: 'white',
          padding: '0.5rem 1rem',
          borderRadius: '6px',
          cursor: 'pointer'
        }}
      >
        Logout
      </button>
    </div>
  </div>
);

// Mock AdminAuthContext since it's not available in this environment
const AdminAuthContext = React.createContext({
  adminUser: { username: 'Admin' },
  isLoading: false,
  logoutAdmin: () => console.log('Logout clicked')
});

const AdminSubscriptionsManagement = () => {
  // State declarations
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [filter, setFilter] = useState('all');
  const [stats, setStats] = useState({
    totalAutoRenewal: 0,
    activeAutoRenewal: 0,
    pendingRenewal: 0,
    failedRenewal: 0
  });
  const [monitoring, setMonitoring] = useState({
    dueTomorrow: 0,
    dueThisWeek: 0,
    failedRenewals: 0,
    cancelledDueToFailure: 0,
    totalAutoRenewalSubscriptions: 0
  });
  const [pagination, setPagination] = useState({
    currentPage: 1,
    totalPages: 1,
    totalItems: 0,
    limit: 20
  });
  const [selectedSubscription, setSelectedSubscription] = useState(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  const { adminUser, isLoading, logoutAdmin } = useContext(AdminAuthContext);
  const navigate = useNavigate();

  // FIXED: Correct API base URL for your backend
  const API_BASE_URL = 'http://localhost:5555';

  // Styles object
  const styles = {
    container: {
      fontSize: '16px',
      minHeight: '100vh',
      backgroundColor: '#f8fafc',
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      padding: '2rem',
    },
    header: {
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      color: 'white',
      padding: '2rem',
      borderRadius: '16px',
      textAlign: 'center',
      marginBottom: '2rem',
      boxShadow: '0 10px 25px rgba(102, 126, 234, 0.25)',
    },
    headerTitle: {
      margin: '0 0 0.5rem 0',
      fontSize: '2.5rem',
      fontWeight: '700',
    },
    headerSubtitle: {
      margin: '0',
      fontSize: '1.2rem',
      opacity: '0.9',
    },
    statsContainer: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: '1.5rem',
      marginBottom: '2rem',
    },
    statCard: {
      background: 'white',
      padding: '1.5rem',
      borderRadius: '12px',
      boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
      textAlign: 'center',
    },
    statNumber: {
      fontSize: '2.5rem',
      fontWeight: '800',
      margin: '0 0 0.5rem 0',
      background: 'linear-gradient(135deg, #667eea, #764ba2)',
      backgroundClip: 'text',
      WebkitBackgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
    },
    statLabel: {
      fontSize: '0.875rem',
      fontWeight: '600',
      color: '#64748b',
      textTransform: 'uppercase',
    },
    monitoringContainer: {
      background: 'white',
      padding: '2rem',
      borderRadius: '16px',
      boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
      marginBottom: '2rem',
    },
    monitoringTitle: {
      margin: '0 0 1.5rem 0',
      color: '#1e293b',
      fontSize: '1.5rem',
      fontWeight: '700',
    },
    monitoringGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: '1rem',
    },
    monitoringItem: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '1rem',
      background: '#f8fafc',
      borderRadius: '8px',
    },
    loadingContainer: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '4rem 2rem',
      textAlign: 'center',
    },
    spinner: {
      width: '48px',
      height: '48px',
      border: '4px solid #e2e8f0',
      borderTop: '4px solid #667eea',
      borderRadius: '50%',
      animation: 'spin 1s linear infinite',
      marginBottom: '1rem',
    },
    alert: {
      padding: '1rem 1.5rem',
      borderRadius: '8px',
      marginBottom: '1rem',
      display: 'flex',
      alignItems: 'center',
    },
    alertError: {
      backgroundColor: '#fef2f2',
      color: '#dc2626',
      border: '1px solid #fecaca',
    },
    alertSuccess: {
      backgroundColor: '#f0fdf4',
      color: '#16a34a',
      border: '1px solid #bbf7d0',
    },
    filterTabs: {
      display: 'flex',
      gap: '0.5rem',
      marginBottom: '2rem',
      background: 'white',
      padding: '0.5rem',
      borderRadius: '12px',
      boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
      overflowX: 'auto',
    },
    filterTab: {
      padding: '0.75rem 1.5rem',
      border: 'none',
      background: 'transparent',
      color: '#6b7280',
      borderRadius: '8px',
      cursor: 'pointer',
      fontWeight: '600',
      fontSize: '0.875rem',
      whiteSpace: 'nowrap',
      transition: 'all 0.2s ease',
    },
    filterTabActive: {
      background: '#667eea',
      color: 'white',
    },
    subscriptionCard: {
      background: 'white',
      borderRadius: '16px',
      boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
      marginBottom: '1.5rem',
      overflow: 'hidden',
    },
    cardHeader: {
      background: '#f8fafc',
      padding: '1.5rem',
      borderBottom: '1px solid #e2e8f0',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      flexWrap: 'wrap',
      gap: '1rem',
    },
    cardTitle: {
      margin: '0 0 0.5rem 0',
      color: '#1e293b',
      fontSize: '1.5rem',
      fontWeight: '700',
    },
    planBadge: {
      background: '#3b82f6',
      color: 'white',
      padding: '0.25rem 0.75rem',
      borderRadius: '12px',
      fontSize: '0.875rem',
      fontWeight: '600',
    },
    statusBadge: {
      padding: '0.5rem 1rem',
      borderRadius: '20px',
      fontSize: '0.75rem',
      fontWeight: '700',
      textTransform: 'uppercase',
    },
    statusActive: { backgroundColor: '#d1fae5', color: '#059669' },
    statusInactive: { backgroundColor: '#fef3c7', color: '#d97706' },
    statusCancelled: { backgroundColor: '#fecaca', color: '#dc2626' },
    statusPendingRenewal: { backgroundColor: '#ddd6fe', color: '#7c3aed' },
    statusPaymentFailed: { backgroundColor: '#fecaca', color: '#dc2626' },
    cardBody: {
      padding: '2rem',
    },
    sectionsContainer: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
      gap: '1.5rem',
      marginBottom: '2rem',
    },
    section: {
      background: '#f8fafc',
      padding: '1.5rem',
      borderRadius: '12px',
      border: '1px solid #e2e8f0',
    },
    sectionTitle: {
      margin: '0 0 1rem 0',
      color: '#1e293b',
      fontSize: '1.125rem',
      fontWeight: '700',
    },
    detailRow: {
      display: 'flex',
      justifyContent: 'space-between',
      marginBottom: '0.75rem',
      paddingBottom: '0.75rem',
      borderBottom: '1px solid #f1f5f9',
    },
    detailLabel: {
      fontWeight: '600',
      color: '#475569',
      fontSize: '0.875rem',
    },
    detailValue: {
      color: '#1e293b',
      fontSize: '0.875rem',
      fontWeight: '500',
      textAlign: 'right',
    },
    actions: {
      display: 'flex',
      gap: '1rem',
      justifyContent: 'center',
      paddingTop: '1rem',
      borderTop: '1px solid #e2e8f0',
    },
    button: {
      padding: '0.75rem 1.5rem',
      border: 'none',
      borderRadius: '8px',
      fontWeight: '600',
      cursor: 'pointer',
      fontSize: '0.875rem',
      transition: 'all 0.2s ease',
    },
    buttonPrimary: {
      background: '#3b82f6',
      color: 'white',
    },
    buttonSecondary: {
      background: '#f1f5f9',
      color: '#475569',
    },
    noData: {
      textAlign: 'center',
      padding: '4rem 2rem',
      color: '#64748b',
    },
    pagination: {
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      gap: '1rem',
      marginTop: '2rem',
      padding: '2rem',
      background: 'white',
      borderRadius: '12px',
    },
    paginationButton: {
      padding: '0.5rem 1rem',
      border: '1px solid #d1d5db',
      borderRadius: '6px',
      background: 'white',
      cursor: 'pointer',
    },
    modal: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
    },
    modalContent: {
      background: 'white',
      borderRadius: '16px',
      width: '90%',
      maxWidth: '600px',
      maxHeight: '90vh',
      overflow: 'auto',
    },
    modalHeader: {
      padding: '2rem',
      borderBottom: '1px solid #e2e8f0',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    modalBody: {
      padding: '2rem',
    },
  };

  // Utility functions
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return 'Invalid Date';
    }
  };

  const formatCurrency = (amount, currency = 'USD') => {
    if (!amount && amount !== 0) return 'N/A';
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency || 'USD'
      }).format(amount);
    } catch {
      return `${amount} ${currency}`;
    }
  };

  const getStatusBadge = (status) => {
    const statusStyles = {
      active: styles.statusActive,
      inactive: styles.statusInactive,
      cancelled: styles.statusCancelled,
      pending_renewal: styles.statusPendingRenewal,
      payment_failed: styles.statusPaymentFailed,
    };

    const statusText = {
      active: 'Active',
      inactive: 'Inactive',
      cancelled: 'Cancelled',
      pending_renewal: 'Pending Renewal',
      payment_failed: 'Payment Failed',
    };

    return (
      <span style={{...styles.statusBadge, ...statusStyles[status]}}>
        {statusText[status] || status}
      </span>
    );
  };

  // API functions
  const fetchSubscriptions = async () => {
    try {
      setLoading(true);
      setError('');

      const params = new URLSearchParams({
        page: pagination.currentPage.toString(),
        limit: pagination.limit.toString(),
      });

      if (filter !== 'all') {
        params.append('status', filter);
      }

      const url = `${API_BASE_URL}/api/admin/auto-renewal-subscriptions?${params}`;
      console.log('Fetching from:', url);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.success) {
        setSubscriptions(data.subscriptions || []);
        setStats(data.stats || {});
        setPagination(data.pagination || {
          currentPage: 1,
          totalPages: 1,
          totalItems: 0,
          limit: 20
        });
      } else {
        setError(data.message || 'Failed to fetch subscriptions');
      }
    } catch (error) {
      console.error('Fetch error:', error);
      setError(`Failed to fetch subscriptions: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const fetchMonitoringData = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/renewal-monitoring`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setMonitoring(data.monitoring || {});
        }
      }
    } catch (error) {
      console.error('Monitoring fetch error:', error);
    }
  };

  const testConnection = async () => {
    try {
      setError('');
      const response = await fetch(`${API_BASE_URL}/api/admin/test`, {
        credentials: 'include',
      });
      
      if (response.ok) {
        const data = await response.json();
        setSuccess(`Connection successful! Found ${data.counts?.total || 0} subscriptions`);
        setTimeout(() => setSuccess(''), 3000);
      } else {
        setError(`Connection failed: ${response.status}`);
      }
    } catch (error) {
      setError(`Connection failed: ${error.message}`);
    }
  };

  // Event handlers
  const handleFilterChange = (newFilter) => {
    setFilter(newFilter);
    setPagination(prev => ({ ...prev, currentPage: 1 }));
  };

  const handlePageChange = (newPage) => {
    setPagination(prev => ({ ...prev, currentPage: newPage }));
  };

  const openModal = (subscription) => {
    setSelectedSubscription(subscription);
    setShowDetailsModal(true);
  };

  const closeModal = () => {
    setSelectedSubscription(null);
    setShowDetailsModal(false);
  };

  // Effects
  useEffect(() => {
    fetchSubscriptions();
    fetchMonitoringData();
  }, [filter, pagination.currentPage]);

  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(''), 5000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  // Filter subscriptions
  const filteredSubscriptions = filter === 'all' 
    ? subscriptions 
    : subscriptions.filter(sub => sub.status === filter);

  // Render loading state
  if (loading) {
    return (
      <div style={styles.container}>
        <NavBar adminUser={adminUser} logoutAdmin={logoutAdmin} />
        <div style={styles.loadingContainer}>
          <div style={styles.spinner}></div>
          <p>Loading subscriptions...</p>
          <button 
            onClick={testConnection}
            style={{...styles.button, ...styles.buttonPrimary, marginTop: '1rem'}}
          >
            Test Connection
          </button>
        </div>
        <style jsx>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <NavBar adminUser={adminUser} logoutAdmin={logoutAdmin} />
      
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.headerTitle}>Subscription Management</h1>
        <p style={styles.headerSubtitle}>Monitor and manage auto-renewal subscriptions</p>
      </div>

      {/* Statistics */}
      <div style={styles.statsContainer}>
        <div style={styles.statCard}>
          <div style={styles.statNumber}>{stats.activeAutoRenewal || 0}</div>
          <div style={styles.statLabel}>Active Subscriptions</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statNumber}>{stats.pendingRenewal || 0}</div>
          <div style={styles.statLabel}>Pending Renewal</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statNumber}>{stats.failedRenewal || 0}</div>
          <div style={styles.statLabel}>Payment Failed</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statNumber}>{stats.totalAutoRenewal || 0}</div>
          <div style={styles.statLabel}>Total Auto-Renewal</div>
        </div>
      </div>

      {/* Monitoring */}
      <div style={styles.monitoringContainer}>
        <h2 style={styles.monitoringTitle}>Renewal Monitoring</h2>
        <div style={styles.monitoringGrid}>
          <div style={styles.monitoringItem}>
            <span>Due Tomorrow:</span>
            <strong>{monitoring.dueTomorrow || 0}</strong>
          </div>
          <div style={styles.monitoringItem}>
            <span>Due This Week:</span>
            <strong>{monitoring.dueThisWeek || 0}</strong>
          </div>
          <div style={styles.monitoringItem}>
            <span>Failed Renewals:</span>
            <strong>{monitoring.failedRenewals || 0}</strong>
          </div>
          <div style={styles.monitoringItem}>
            <span>Cancelled (30 days):</span>
            <strong>{monitoring.cancelledDueToFailure || 0}</strong>
          </div>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div style={{...styles.alert, ...styles.alertError}}>
          <span style={{marginRight: '8px'}}>⚠️</span>
          <div style={{flex: 1}}>
            <div>{error}</div>
            <button 
              onClick={testConnection}
              style={{
                ...styles.button,
                ...styles.buttonSecondary,
                marginTop: '0.5rem',
                fontSize: '0.75rem'
              }}
            >
              Test Connection
            </button>
          </div>
        </div>
      )}

      {success && (
        <div style={{...styles.alert, ...styles.alertSuccess}}>
          <span style={{marginRight: '8px'}}>✅</span>
          {success}
        </div>
      )}

      {/* Filter Tabs */}
      <div style={styles.filterTabs}>
        {['all', 'active', 'pending_renewal', 'payment_failed', 'cancelled'].map((filterType) => (
          <button
            key={filterType}
            style={{
              ...styles.filterTab,
              ...(filter === filterType ? styles.filterTabActive : {})
            }}
            onClick={() => handleFilterChange(filterType)}
          >
            {filterType === 'all' 
              ? `All (${subscriptions.length})`
              : `${filterType.replace('_', ' ')} (${subscriptions.filter(s => s.status === filterType).length})`
            }
          </button>
        ))}
      </div>

      {/* Subscriptions List */}
      {filteredSubscriptions.length === 0 ? (
        <div style={styles.noData}>
          <h3>No subscriptions found</h3>
          <p>
            {subscriptions.length === 0 
              ? 'No subscription data available. Check your backend connection.'
              : 'No subscriptions match the current filter.'
            }
          </p>
          {subscriptions.length === 0 && (
            <button 
              onClick={testConnection}
              style={{...styles.button, ...styles.buttonPrimary, marginTop: '1rem'}}
            >
              Test Connection
            </button>
          )}
        </div>
      ) : (
        filteredSubscriptions.map(subscription => (
          <div key={subscription._id} style={styles.subscriptionCard}>
            <div style={styles.cardHeader}>
              <div>
                <h3 style={styles.cardTitle}>
                  {subscription.userDetails?.firstName || 'Unknown'} {subscription.userDetails?.lastName || 'User'}
                </h3>
                <div style={styles.planBadge}>{subscription.planName || 'Unknown Plan'}</div>
              </div>
              <div>
                {getStatusBadge(subscription.status)}
              </div>
            </div>

            <div style={styles.cardBody}>
              <div style={styles.sectionsContainer}>
                {/* Subscription Info */}
                <div style={styles.section}>
                  <h4 style={styles.sectionTitle}>Subscription Details</h4>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Plan ID:</span>
                    <span style={styles.detailValue}>{subscription.planId}</span>
                  </div>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Amount:</span>
                    <span style={styles.detailValue}>
                      {formatCurrency(subscription.amount, subscription.currency)}
                    </span>
                  </div>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Auto Renew:</span>
                    <span style={styles.detailValue}>
                      {subscription.autoRenew ? 'Yes' : 'No'}
                    </span>
                  </div>
                  <div style={{...styles.detailRow, borderBottom: 'none'}}>
                    <span style={styles.detailLabel}>Created:</span>
                    <span style={styles.detailValue}>
                      {formatDate(subscription.createdAt || subscription.startDate)}
                    </span>
                  </div>
                </div>

                {/* User Info */}
                <div style={styles.section}>
                  <h4 style={styles.sectionTitle}>User Information</h4>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Email:</span>
                    <span style={styles.detailValue}>
                      {subscription.userDetails?.email || subscription.userEmail || 'N/A'}
                    </span>
                  </div>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Business:</span>
                    <span style={styles.detailValue}>
                      {subscription.userDetails?.businessName || 'N/A'}
                    </span>
                  </div>
                  <div style={{...styles.detailRow, borderBottom: 'none'}}>
                    <span style={styles.detailLabel}>User ID:</span>
                    <span style={styles.detailValue}>{subscription.userId || 'N/A'}</span>
                  </div>
                </div>

                {/* Renewal Info */}
                <div style={styles.section}>
                  <h4 style={styles.sectionTitle}>Renewal Information</h4>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Next Billing:</span>
                    <span style={styles.detailValue}>
                      {formatDate(subscription.nextBillingDate)}
                    </span>
                  </div>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Days Until:</span>
                    <span style={styles.detailValue}>
                      {subscription.daysUntilRenewal !== null && subscription.daysUntilRenewal !== undefined
                        ? `${subscription.daysUntilRenewal} days`
                        : 'N/A'
                      }
                    </span>
                  </div>
                  <div style={{...styles.detailRow, borderBottom: 'none'}}>
                    <span style={styles.detailLabel}>Payment Token:</span>
                    <span style={styles.detailValue}>
                      {subscription.payhereRecurringToken ? 'Active' : 'None'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div style={styles.actions}>
                <button
                  onClick={() => openModal(subscription)}
                  style={{...styles.button, ...styles.buttonPrimary}}
                >
                  View Details
                </button>
                <button
                  onClick={() => {
                    const email = subscription.userDetails?.email || subscription.userEmail;
                    if (email) {
                      window.open(`mailto:${email}`, '_blank');
                    }
                  }}
                  style={{...styles.button, ...styles.buttonSecondary}}
                >
                  Contact User
                </button>
              </div>
            </div>
          </div>
        ))
      )}

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div style={styles.pagination}>
          <button
            onClick={() => handlePageChange(pagination.currentPage - 1)}
            disabled={pagination.currentPage === 1}
            style={styles.paginationButton}
          >
            Previous
          </button>

          {[...Array(pagination.totalPages)].map((_, index) => (
            <button
              key={index + 1}
              onClick={() => handlePageChange(index + 1)}
              style={{
                ...styles.paginationButton,
                ...(pagination.currentPage === index + 1 ? { background: '#667eea', color: 'white' } : {})
              }}
            >
              {index + 1}
            </button>
          ))}

          <button
            onClick={() => handlePageChange(pagination.currentPage + 1)}
            disabled={pagination.currentPage === pagination.totalPages}
            style={styles.paginationButton}
          >
            Next
          </button>
        </div>
      )}

      {/* Modal */}
      {showDetailsModal && selectedSubscription && (
        <div style={styles.modal} onClick={(e) => e.target === e.currentTarget && closeModal()}>
          <div style={styles.modalContent}>
            <div style={styles.modalHeader}>
              <h3>Subscription Details</h3>
              <button
                onClick={closeModal}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '1.5rem',
                  cursor: 'pointer'
                }}
              >
                ×
              </button>
            </div>
            <div style={styles.modalBody}>
              <div style={{marginBottom: '2rem'}}>
                <h4>{selectedSubscription.planName}</h4>
                <p><strong>User:</strong> {selectedSubscription.userDetails?.firstName} {selectedSubscription.userDetails?.lastName}</p>
                <p><strong>Email:</strong> {selectedSubscription.userDetails?.email || selectedSubscription.userEmail}</p>
                <p><strong>Status:</strong> {getStatusBadge(selectedSubscription.status)}</p>
              </div>
              
              <div style={styles.sectionsContainer}>
                <div style={styles.section}>
                  <h4 style={styles.sectionTitle}>Technical Details</h4>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Subscription ID:</span>
                    <span style={styles.detailValue}>{selectedSubscription._id}</span>
                  </div>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Plan ID:</span>
                    <span style={styles.detailValue}>{selectedSubscription.planId}</span>
                  </div>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Payment Method:</span>
                    <span style={styles.detailValue}>{selectedSubscription.paymentMethod || 'PayHere'}</span>
                  </div>
                  <div style={{...styles.detailRow, borderBottom: 'none'}}>
                    <span style={styles.detailLabel}>Created:</span>
                    <span style={styles.detailValue}>{formatDate(selectedSubscription.createdAt)}</span>
                  </div>
                </div>

                <div style={styles.section}>
                  <h4 style={styles.sectionTitle}>Billing Information</h4>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Amount:</span>
                    <span style={styles.detailValue}>
                      {formatCurrency(selectedSubscription.amount, selectedSubscription.currency)}
                    </span>
                  </div>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Billing Cycle:</span>
                    <span style={styles.detailValue}>{selectedSubscription.billingCycle || 'monthly'}</span>
                  </div>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Start Date:</span>
                    <span style={styles.detailValue}>{formatDate(selectedSubscription.startDate)}</span>
                  </div>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>End Date:</span>
                    <span style={styles.detailValue}>{formatDate(selectedSubscription.endDate)}</span>
                  </div>
                  <div style={{...styles.detailRow, borderBottom: 'none'}}>
                    <span style={styles.detailLabel}>Next Billing:</span>
                    <span style={styles.detailValue}>{formatDate(selectedSubscription.nextBillingDate)}</span>
                  </div>
                </div>
              </div>

              {selectedSubscription.renewalAttempts > 0 && (
                <div style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '8px',
                  padding: '1rem',
                  marginTop: '1rem'
                }}>
                  <h4 style={{ color: '#dc2626', margin: '0 0 0.5rem 0' }}>Payment Issues</h4>
                  <p><strong>Renewal Attempts:</strong> {selectedSubscription.renewalAttempts}</p>
                  <p><strong>Max Attempts:</strong> {selectedSubscription.maxRenewalAttempts || 3}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        
        .subscription-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 16px rgba(0, 0, 0, 0.15);
        }
        
        .button:hover {
          opacity: 0.9;
          transform: translateY(-1px);
        }
        
        @media (max-width: 768px) {
          .stats-container {
            grid-template-columns: repeat(2, 1fr) !important;
          }
          
          .sections-container {
            grid-template-columns: 1fr !important;
          }
          
          .monitoring-grid {
            grid-template-columns: 1fr !important;
          }
          
          .card-header {
            flex-direction: column !important;
            align-items: flex-start !important;
          }
          
          .actions {
            flex-direction: column !important;
          }
          
          .filter-tabs {
            overflow-x: auto;
          }
        }
        
        @media (max-width: 480px) {
          .container {
            padding: 1rem !important;
          }
          
          .stats-container {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
};

export default AdminSubscriptionsManagement;