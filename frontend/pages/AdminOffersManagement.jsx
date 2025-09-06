import React, { useState, useEffect, useContext } from 'react';
import axios from 'axios';
import { AdminAuthContext } from '../src/AdminAuthContext';
import NavBar from '../component/Navbar';

const AdminOffersManagement = () => {
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [counts, setCounts] = useState({
    pending: 0,
    approved: 0,
    declined: 0
  });
  const [selectedOffer, setSelectedOffer] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [actionType, setActionType] = useState('');
  const [adminComments, setAdminComments] = useState('');
  const [processing, setProcessing] = useState(false);
  
  // NEW: Edit offer states
  const [showEditModal, setShowEditModal] = useState(false);
  const [editOfferData, setEditOfferData] = useState({
    title: '',
    discount: '',
    category: '',
    startDate: '',
    endDate: '',
    isActive: true
  });

  const { adminUser, isAdminLoggedIn, logoutAdmin } = useContext(AdminAuthContext);

  // Complete styles object
  const styles = {
    container: {
      minHeight: '100vh',
      width: '100%',
      backgroundColor: '#f8f9fa',
      fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
      padding: '20px',
      boxSizing: 'border-box',
    },
    header: {
      background: 'linear-gradient(135deg, #007bff, #6610f2)',
      color: 'white',
      padding: '30px',
      borderRadius: '12px',
      textAlign: 'center',
      marginBottom: '30px',
      boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
    },
    headerTitle: {
      margin: '0 0 10px 0',
      fontSize: 'clamp(1.8rem, 4vw, 2.5rem)',
      fontWeight: '700',
    },
    headerSubtitle: {
      margin: '0',
      fontSize: 'clamp(1rem, 2vw, 1.1rem)',
      opacity: '0.9',
    },
    loadingSpinner: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '60px 20px',
      color: '#6c757d',
    },
    spinner: {
      width: '40px',
      height: '40px',
      border: '4px solid #e3e3e3',
      borderTop: '4px solid #007bff',
      borderRadius: '50%',
      animation: 'spin 1s linear infinite',
      marginBottom: '15px',
    },
    spinnerSmall: {
      display: 'inline-block',
      width: '16px',
      height: '16px',
      border: '2px solid transparent',
      borderTop: '2px solid currentColor',
      borderRadius: '50%',
      animation: 'spin 1s linear infinite',
      marginRight: '8px',
    },
    errorMessage: {
      backgroundColor: '#f8d7da',
      color: '#721c24',
      border: '1px solid #f5c6cb',
      borderRadius: '8px',
      padding: '15px',
      marginBottom: '20px',
      display: 'flex',
      alignItems: 'center',
    },
    errorIcon: {
      marginRight: '10px',
      fontSize: '1.2rem',
    },
    filterTabs: {
      display: 'flex',
      gap: '10px',
      marginBottom: '30px',
      background: 'white',
      padding: '10px',
      borderRadius: '12px',
      boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
      overflowX: 'auto',
      border: '1px solid #e9ecef',
    },
    filterTab: {
      padding: '12px 20px',
      border: 'none',
      background: '#f8f9fa',
      color: '#6c757d',
      borderRadius: '8px',
      cursor: 'pointer',
      fontWeight: '500',
      fontSize: '14px',
      transition: 'all 0.3s ease',
      whiteSpace: 'nowrap',
      minWidth: 'fit-content',
    },
    filterTabActive: {
      background: '#007bff',
      color: 'white',
      boxShadow: '0 2px 4px rgba(0, 123, 255, 0.3)',
    },
    offersList: {
      display: 'flex',
      flexDirection: 'column',
      gap: '20px',
    },
    noOffers: {
      textAlign: 'center',
      padding: '60px 20px',
      background: 'white',
      borderRadius: '12px',
      boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
      color: '#6c757d',
      border: '1px solid #e9ecef',
    },
    noOffersIcon: {
      fontSize: '4rem',
      marginBottom: '20px',
    },
    offerCard: {
      background: 'white',
      borderRadius: '12px',
      boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
      overflow: 'hidden',
      transition: 'transform 0.3s ease, box-shadow 0.3s ease',
      border: '1px solid #e9ecef',
    },
    offerCardHeader: {
      background: 'linear-gradient(135deg, #f8f9fa, #e9ecef)',
      padding: '20px',
      borderBottom: '1px solid #dee2e6',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      flexWrap: 'wrap',
      gap: '15px',
    },
    offerTitleSection: {
      flex: '1',
      minWidth: '250px',
    },
    offerTitle: {
      margin: '0 0 10px 0',
      color: '#212529',
      fontSize: 'clamp(1.2rem, 3vw, 1.5rem)',
      fontWeight: '600',
      lineHeight: '1.3',
    },
    offerDiscount: {
      background: 'linear-gradient(135deg, #28a745, #20c997)',
      color: 'white',
      padding: '8px 16px',
      borderRadius: '20px',
      fontWeight: '700',
      fontSize: '1.1rem',
      display: 'inline-block',
      boxShadow: '0 2px 4px rgba(40, 167, 69, 0.3)',
    },
    statusBadge: {
      padding: '6px 12px',
      borderRadius: '20px',
      fontSize: '0.85rem',
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
    },
    statusPending: {
      backgroundColor: '#fff3cd',
      color: '#856404',
      border: '1px solid #ffeaa7',
    },
    statusApproved: {
      backgroundColor: '#d4edda',
      color: '#155724',
      border: '1px solid #c3e6cb',
    },
    statusDeclined: {
      backgroundColor: '#f8d7da',
      color: '#721c24',
      border: '1px solid #f5c6cb',
    },
    offerCardBody: {
      padding: '25px',
    },
    detailsGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
      gap: '25px',
      marginBottom: '25px',
    },
    detailSection: {
      background: '#f8f9fa',
      padding: '20px',
      borderRadius: '8px',
      borderLeft: '4px solid #007bff',
    },
    sectionTitle: {
      margin: '0 0 15px 0',
      color: '#007bff',
      fontSize: '1.1rem',
      fontWeight: '600',
      borderBottom: '2px solid #007bff',
      paddingBottom: '5px',
    },
    detailItem: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: '10px',
      paddingBottom: '8px',
      borderBottom: '1px solid #e9ecef',
    },
    detailItemLast: {
      marginBottom: '0',
      borderBottom: 'none',
      paddingBottom: '0',
    },
    label: {
      fontWeight: '600',
      color: '#495057',
      minWidth: '120px',
      flexShrink: '0',
    },
    value: {
      color: '#212529',
      textAlign: 'right',
      flex: '1',
      marginLeft: '15px',
      wordBreak: 'break-word',
    },
    adminComments: {
      fontStyle: 'italic',
      textAlign: 'left',
      background: '#fff',
      padding: '10px',
      borderRadius: '4px',
      borderLeft: '3px solid #ffc107',
    },
    adminReviewSection: {
      background: '#e7f3ff',
      padding: '20px',
      borderRadius: '8px',
      borderLeft: '4px solid #0066cc',
      marginBottom: '20px',
    },
    offerActions: {
      display: 'flex',
      gap: '10px',
      justifyContent: 'center',
      paddingTop: '20px',
      borderTop: '1px solid #dee2e6',
      flexWrap: 'wrap',
    },
    btn: {
      padding: '10px 20px',
      border: 'none',
      borderRadius: '8px',
      fontWeight: '600',
      fontSize: '0.9rem',
      cursor: 'pointer',
      transition: 'all 0.3s ease',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: '120px',
      textDecoration: 'none',
    },
    btnApprove: {
      background: 'linear-gradient(135deg, #28a745, #20c997)',
      color: 'white',
      boxShadow: '0 4px 6px rgba(40, 167, 69, 0.3)',
    },
    btnDecline: {
      background: 'linear-gradient(135deg, #dc3545, #e83e8c)',
      color: 'white',
      boxShadow: '0 4px 6px rgba(220, 53, 69, 0.3)',
    },
    btnEdit: {
      background: 'linear-gradient(135deg, #ffc107, #fd7e14)',
      color: 'white',
      boxShadow: '0 4px 6px rgba(255, 193, 7, 0.3)',
    },
    btnDelete: {
      background: 'linear-gradient(135deg, #6c757d, #495057)',
      color: 'white',
      boxShadow: '0 4px 6px rgba(108, 117, 125, 0.3)',
    },
    btnSecondary: {
      background: '#6c757d',
      color: 'white',
      boxShadow: '0 4px 6px rgba(108, 117, 125, 0.3)',
    },
    modalOverlay: {
      position: 'fixed',
      top: '0',
      left: '0',
      right: '0',
      bottom: '0',
      background: 'rgba(0, 0, 0, 0.6)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: '1000',
      backdropFilter: 'blur(4px)',
    },
    modal: {
      background: 'white',
      borderRadius: '12px',
      width: '90%',
      maxWidth: '600px',
      maxHeight: '90vh',
      overflowY: 'auto',
      boxShadow: '0 20px 40px rgba(0, 0, 0, 0.3)',
      animation: 'modalAppear 0.3s ease-out',
    },
    modalHeader: {
      padding: '25px',
      borderBottom: '1px solid #dee2e6',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      background: 'linear-gradient(135deg, #f8f9fa, #e9ecef)',
      borderRadius: '12px 12px 0 0',
    },
    modalTitle: {
      margin: '0',
      color: '#212529',
      fontSize: '1.4rem',
      fontWeight: '600',
    },
    modalClose: {
      background: 'none',
      border: 'none',
      fontSize: '1.5rem',
      color: '#6c757d',
      cursor: 'pointer',
      padding: '5px',
      borderRadius: '50%',
      width: '35px',
      height: '35px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'all 0.3s ease',
    },
    modalBody: {
      padding: '25px',
    },
    offerSummary: {
      background: '#f8f9fa',
      padding: '20px',
      borderRadius: '8px',
      marginBottom: '25px',
      borderLeft: '4px solid #007bff',
    },
    modalFooter: {
      padding: '20px 25px',
      borderTop: '1px solid #dee2e6',
      display: 'flex',
      gap: '15px',
      justifyContent: 'flex-end',
      background: '#f8f9fa',
      borderRadius: '0 0 12px 12px',
      flexWrap: 'wrap',
    },
    textarea: {
      width: '100%',
      padding: '12px',
      border: '2px solid #e9ecef',
      borderRadius: '8px',
      fontFamily: 'inherit',
      fontSize: '0.95rem',
      lineHeight: '1.5',
      resize: 'vertical',
      transition: 'border-color 0.3s ease, box-shadow 0.3s ease',
      boxSizing: 'border-box',
    },
    input: {
      width: '100%',
      padding: '12px',
      border: '2px solid #e9ecef',
      borderRadius: '8px',
      fontFamily: 'inherit',
      fontSize: '0.95rem',
      transition: 'border-color 0.3s ease, box-shadow 0.3s ease',
      boxSizing: 'border-box',
    },
    formGroup: {
      marginBottom: '20px',
    },
    formLabel: {
      display: 'block',
      marginBottom: '8px',
      fontWeight: '600',
      color: '#495057',
    },
    validationError: {
      color: '#dc3545',
      fontSize: '0.85rem',
      marginTop: '5px',
      marginBottom: '0',
    },
  };

  useEffect(() => {
    fetchOffers();
  }, [filter]);

  useEffect(() => {
    if (!isAdminLoggedIn()) {
      console.log('Admin not logged in');
    }
  }, [isAdminLoggedIn]);

  const fetchOffers = async () => {
    try {
      setLoading(true);
      setError('');
      
      const response = await axios.get('http://localhost:5555/api/admin/offers', {
        params: {
          status: filter === 'all' ? undefined : filter,
          limit: 50
        }
      });

      if (response.data.success) {
        setOffers(response.data.offers);
        setCounts(response.data.counts);
      } else {
        setError('Failed to fetch offers');
      }
    } catch (error) {
      console.error('Error fetching offers:', error);
      setError(error.response?.data?.message || 'Error fetching offers');
    } finally {
      setLoading(false);
    }
  };

  const openActionModal = (offer, action) => {
    setSelectedOffer(offer);
    setActionType(action);
    setAdminComments('');
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setSelectedOffer(null);
    setActionType('');
    setAdminComments('');
  };

  const openEditModal = (offer) => {
    setSelectedOffer(offer);
    setEditOfferData({
      title: offer.title || '',
      discount: offer.discount || '',
      category: offer.category || '',
      startDate: offer.startDate ? new Date(offer.startDate).toISOString().split('T')[0] : '',
      endDate: offer.endDate ? new Date(offer.endDate).toISOString().split('T')[0] : '',
      isActive: offer.isActive !== undefined ? offer.isActive : true
    });
    setShowEditModal(true);
  };

  const closeEditModal = () => {
    setShowEditModal(false);
    setSelectedOffer(null);
    setEditOfferData({
      title: '',
      discount: '',
      category: '',
      startDate: '',
      endDate: '',
      isActive: true
    });
  };

  const handleEditOffer = async () => {
    if (!selectedOffer || !editOfferData.title || !editOfferData.discount) {
      alert('Please fill in all required fields');
      return;
    }

    try {
      setProcessing(true);
      
      const response = await axios.put(`http://localhost:5555/api/admin/offers/${selectedOffer._id}`, editOfferData);

      if (response.data.success) {
        alert('Offer updated successfully!');
        closeEditModal();
        fetchOffers();
      } else {
        alert(response.data.message || 'Failed to update offer');
      }
    } catch (error) {
      console.error('Error updating offer:', error);
      alert(error.response?.data?.message || 'Error updating offer');
    } finally {
      setProcessing(false);
    }
  };

  const handleDeleteOffer = async (offerId) => {
    if (!window.confirm('Are you sure you want to delete this offer? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await axios.delete(`http://localhost:5555/api/admin/offers/${offerId}`);

      if (response.data.success) {
        alert('Offer deleted successfully!');
        fetchOffers();
      } else {
        alert(response.data.message || 'Failed to delete offer');
      }
    } catch (error) {
      console.error('Error deleting offer:', error);
      alert(error.response?.data?.message || 'Error deleting offer');
    }
  };

  const handleAction = async () => {
    if (!selectedOffer || !actionType) return;

    if (actionType === 'decline' && !adminComments.trim()) {
      alert('Please provide comments when declining an offer');
      return;
    }

    try {
      setProcessing(true);
      
      const endpoint = `http://localhost:5555/api/admin/offers/${selectedOffer._id}/${actionType}`;
      const response = await axios.patch(endpoint, {
        adminComments: adminComments.trim(),
        reviewedBy: adminUser?.username || 'Admin'
      });

      if (response.data.success) {
        alert(`Offer ${actionType}d successfully!`);
        closeModal();
        fetchOffers();
      } else {
        alert(response.data.message || `Failed to ${actionType} offer`);
      }
    } catch (error) {
      console.error(`Error ${actionType}ing offer:`, error);
      alert(error.response?.data?.message || `Error ${actionType}ing offer`);
    } finally {
      setProcessing(false);
    }
  };

  const getStatusBadge = (status) => {
    const statusConfig = {
      'pending': { style: { ...styles.statusBadge, ...styles.statusPending }, text: 'Pending Review' },
      'approved': { style: { ...styles.statusBadge, ...styles.statusApproved }, text: 'Approved' },
      'approved-active': { style: { ...styles.statusBadge, ...styles.statusApproved }, text: 'Live' },
      'approved-scheduled': { style: { ...styles.statusBadge, ...styles.statusApproved }, text: 'Scheduled' },
      'approved-expired': { style: { ...styles.statusBadge, ...styles.statusDeclined }, text: 'Expired' },
      'approved-inactive': { style: { ...styles.statusBadge, ...styles.statusPending }, text: 'Inactive' },
      'declined': { style: { ...styles.statusBadge, ...styles.statusDeclined }, text: 'Declined' }
    };

    const config = statusConfig[status] || statusConfig['pending'];
    return <span style={config.style}>{config.text}</span>;
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getFilteredOffers = () => {
    if (filter === 'all') return offers;
    return offers.filter(offer => offer.adminStatus === filter);
  };

  const getAvailableActions = (offer) => {
    const actions = [];
    
    // Always allow edit and delete
    actions.push(
      <button 
        key="edit"
        style={styles.btnEdit}
        onClick={() => openEditModal(offer)}
        title="Edit offer details"
        onMouseOver={(e) => {
          e.target.style.background = 'linear-gradient(135deg, #e0a800, #e8650e)';
          e.target.style.transform = 'translateY(-2px)';
        }}
        onMouseOut={(e) => {
          e.target.style.background = 'linear-gradient(135deg, #ffc107, #fd7e14)';
          e.target.style.transform = 'translateY(0)';
        }}
      >
        Edit
      </button>,
      <button 
        key="delete"
        style={styles.btnDelete}
        onClick={() => handleDeleteOffer(offer._id)}
        title="Delete offer permanently"
        onMouseOver={(e) => {
          e.target.style.background = 'linear-gradient(135deg, #545b62, #343a40)';
          e.target.style.transform = 'translateY(-2px)';
        }}
        onMouseOut={(e) => {
          e.target.style.background = 'linear-gradient(135deg, #6c757d, #495057)';
          e.target.style.transform = 'translateY(0)';
        }}
      >
        Delete
      </button>
    );

    // Add approve/decline actions based on current status
    if (offer.adminStatus === 'pending') {
      actions.unshift(
        <button 
          key="approve"
          style={styles.btnApprove}
          onClick={() => openActionModal(offer, 'approve')}
          title="Approve this offer"
          onMouseOver={(e) => {
            e.target.style.background = 'linear-gradient(135deg, #218838, #1ea37f)';
            e.target.style.transform = 'translateY(-2px)';
          }}
          onMouseOut={(e) => {
            e.target.style.background = 'linear-gradient(135deg, #28a745, #20c997)';
            e.target.style.transform = 'translateY(0)';
          }}
        >
          Approve
        </button>,
        <button 
          key="decline"
          style={styles.btnDecline}
          onClick={() => openActionModal(offer, 'decline')}
          title="Decline this offer"
          onMouseOver={(e) => {
            e.target.style.background = 'linear-gradient(135deg, #c82333, #d91a72)';
            e.target.style.transform = 'translateY(-2px)';
          }}
          onMouseOut={(e) => {
            e.target.style.background = 'linear-gradient(135deg, #dc3545, #e83e8c)';
            e.target.style.transform = 'translateY(0)';
          }}
        >
          Decline
        </button>
      );
    } else if (offer.adminStatus === 'approved') {
      actions.unshift(
        <button 
          key="decline"
          style={styles.btnDecline}
          onClick={() => openActionModal(offer, 'decline')}
          title="Decline this approved offer"
          onMouseOver={(e) => {
            e.target.style.background = 'linear-gradient(135deg, #c82333, #d91a72)';
            e.target.style.transform = 'translateY(-2px)';
          }}
          onMouseOut={(e) => {
            e.target.style.background = 'linear-gradient(135deg, #dc3545, #e83e8c)';
            e.target.style.transform = 'translateY(0)';
          }}
        >
          Decline
        </button>
      );
    } else if (offer.adminStatus === 'declined') {
      actions.unshift(
        <button 
          key="approve"
          style={styles.btnApprove}
          onClick={() => openActionModal(offer, 'approve')}
          title="Approve this declined offer"
          onMouseOver={(e) => {
            e.target.style.background = 'linear-gradient(135deg, #218838, #1ea37f)';
            e.target.style.transform = 'translateY(-2px)';
          }}
          onMouseOut={(e) => {
            e.target.style.background = 'linear-gradient(135deg, #28a745, #20c997)';
            e.target.style.transform = 'translateY(0)';
          }}
        >
          Re-approve
        </button>
      );
    }

    return actions;
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingSpinner}>
          <div style={styles.spinner}></div>
          <p>Loading offers...</p>
        </div>
        <style>
          {`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}
        </style>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <NavBar adminUser={adminUser} logoutAdmin={logoutAdmin} />

      {/* <div style={styles.header}>
        <h1 style={styles.headerTitle}>Admin Offers Management</h1>
        <p style={styles.headerSubtitle}>Review, approve, edit, and manage all offers</p>
      </div> */}

      {error && (
        <div style={styles.errorMessage}>
          <span style={styles.errorIcon}>⚠️</span>
          {error}
        </div>
      )}

      {/* Filter Tabs */}
      <div style={styles.filterTabs}>
        {['all', 'pending', 'approved', 'declined'].map((filterType) => (
          <button 
            key={filterType}
            style={{
              ...styles.filterTab,
              ...(filter === filterType ? styles.filterTabActive : {})
            }}
            onClick={() => setFilter(filterType)}
            onMouseOver={(e) => {
              if (filter !== filterType) {
                e.target.style.backgroundColor = '#e9ecef';
                e.target.style.color = '#495057';
              }
            }}
            onMouseOut={(e) => {
              if (filter !== filterType) {
                e.target.style.backgroundColor = '#f8f9fa';
                e.target.style.color = '#6c757d';
              }
            }}
          >
            {filterType === 'all' ? `All Offers (${offers.length})` : 
             `${filterType.charAt(0).toUpperCase() + filterType.slice(1)} (${counts[filterType] || 0})`}
          </button>
        ))}
      </div>

      {/* Offers List */}
      <div style={styles.offersList}>
        {getFilteredOffers().length === 0 ? (
          <div style={styles.noOffers}>
            <div style={styles.noOffersIcon}>📋</div>
            <h3>No offers found</h3>
            <p>No offers match the current filter criteria.</p>
          </div>
        ) : (
          getFilteredOffers().map(offer => (
            <div key={offer._id} style={styles.offerCard}>
              <div style={styles.offerCardHeader}>
                <div style={styles.offerTitleSection}>
                  <h3 style={styles.offerTitle}>{offer.title}</h3>
                  <div style={styles.offerDiscount}>{offer.discount} OFF</div>
                </div>
                <div>
                  {getStatusBadge(offer.computedStatus)}
                </div>
              </div>

              <div style={styles.offerCardBody}>
                <div style={styles.detailsGrid}>
                  {/* Business Details */}
                  <div style={styles.detailSection}>
                    <h4 style={styles.sectionTitle}>Business Details</h4>
                    <div style={styles.detailItem}>
                      <span style={styles.label}>Business Name:</span>
                      <span style={styles.value}>{offer.businessId?.name || 'N/A'}</span>
                    </div>
                    <div style={styles.detailItem}>
                      <span style={styles.label}>Category:</span>
                      <span style={styles.value}>{offer.businessId?.category || offer.category || 'N/A'}</span>
                    </div>
                    <div style={styles.detailItem}>
                      <span style={styles.label}>Address:</span>
                      <span style={styles.value}>{offer.businessId?.address || 'N/A'}</span>
                    </div>
                    <div style={styles.detailItem}>
                      <span style={styles.label}>Phone:</span>
                      <span style={styles.value}>{offer.businessId?.phone || 'N/A'}</span>
                    </div>
                    <div style={{...styles.detailItem, ...styles.detailItemLast}}>
                      <span style={styles.label}>Email:</span>
                      <span style={styles.value}>{offer.businessId?.email || 'N/A'}</span>
                    </div>
                  </div>

                  {/* User Details */}
                  <div style={styles.detailSection}>
                    <h4 style={styles.sectionTitle}>User Details</h4>
                    <div style={styles.detailItem}>
                      <span style={styles.label}>User ID:</span>
                      <span style={styles.value}>#{offer.userDetails?.userId}</span>
                    </div>
                    <div style={styles.detailItem}>
                      <span style={styles.label}>Name:</span>
                      <span style={styles.value}>
                        {offer.userDetails?.firstName} {offer.userDetails?.lastName}
                      </span>
                    </div>
                    <div style={styles.detailItem}>
                      <span style={styles.label}>Email:</span>
                      <span style={styles.value}>{offer.userDetails?.email}</span>
                    </div>
                    <div style={styles.detailItem}>
                      <span style={styles.label}>Business Name:</span>
                      <span style={styles.value}>{offer.userDetails?.businessName || 'N/A'}</span>
                    </div>
                    <div style={{...styles.detailItem, ...styles.detailItemLast}}>
                      <span style={styles.label}>User Type:</span>
                      <span style={styles.value}>{offer.userDetails?.userType}</span>
                    </div>
                  </div>

                  {/* Offer Details */}
                  <div style={styles.detailSection}>
                    <h4 style={styles.sectionTitle}>Offer Details</h4>
                    <div style={styles.detailItem}>
                      <span style={styles.label}>Offer ID:</span>
                      <span style={styles.value}>#{offer.offerId}</span>
                    </div>
                    <div style={styles.detailItem}>
                      <span style={styles.label}>Start Date:</span>
                      <span style={styles.value}>{formatDate(offer.startDate)}</span>
                    </div>
                    <div style={styles.detailItem}>
                      <span style={styles.label}>End Date:</span>
                      <span style={styles.value}>{formatDate(offer.endDate)}</span>
                    </div>
                    <div style={styles.detailItem}>
                      <span style={styles.label}>Created:</span>
                      <span style={styles.value}>{formatDate(offer.createdAt)}</span>
                    </div>
                    <div style={{...styles.detailItem, ...styles.detailItemLast}}>
                      <span style={styles.label}>Active:</span>
                      <span style={styles.value}>{offer.isActive ? 'Yes' : 'No'}</span>
                    </div>
                  </div>
                </div>

                {/* Admin Review Section */}
                {(offer.adminStatus === 'approved' || offer.adminStatus === 'declined') && (
                  <div style={styles.adminReviewSection}>
                    <h4 style={styles.sectionTitle}>Admin Review</h4>
                    <div style={styles.detailItem}>
                      <span style={styles.label}>Reviewed by:</span>
                      <span style={styles.value}>{offer.reviewedBy || 'N/A'}</span>
                    </div>
                    <div style={styles.detailItem}>
                      <span style={styles.label}>Review Date:</span>
                      <span style={styles.value}>{formatDate(offer.reviewedAt)}</span>
                    </div>
                    {offer.adminComments && (
                      <div style={{...styles.detailItem, ...styles.detailItemLast}}>
                        <span style={styles.label}>Comments:</span>
                        <span style={{...styles.value, ...styles.adminComments}}>{offer.adminComments}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Enhanced Action Buttons */}
                <div style={styles.offerActions}>
                  {getAvailableActions(offer)}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Action Modal (Approve/Decline) */}
      {showModal && (
        <div style={styles.modalOverlay} onClick={(e) => {
          if (e.target === e.currentTarget) closeModal();
        }}>
          <div style={styles.modal}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>
                {actionType === 'approve' ? 'Approve Offer' : 'Decline Offer'}
              </h3>
              <button 
                style={styles.modalClose}
                onClick={closeModal}
                onMouseOver={(e) => {
                  e.target.style.backgroundColor = '#f8f9fa';
                  e.target.style.color = '#495057';
                }}
                onMouseOut={(e) => {
                  e.target.style.backgroundColor = 'transparent';
                  e.target.style.color = '#6c757d';
                }}
              >
                ×
              </button>
            </div>
            
            <div style={styles.modalBody}>
              <div style={styles.offerSummary}>
                <h4 style={{margin: '0 0 10px 0', color: '#007bff', fontSize: '1.2rem'}}>
                  "{selectedOffer?.title}"
                </h4>
                <p style={{margin: '5px 0', color: '#495057'}}>
                  Business: {selectedOffer?.businessId?.name}
                </p>
                <p style={{margin: '5px 0', color: '#495057'}}>
                  Discount: {selectedOffer?.discount} OFF
                </p>
                <p style={{margin: '5px 0', color: '#495057'}}>
                  Current Status: <strong>{selectedOffer?.adminStatus}</strong>
                </p>
              </div>

              <div style={{marginBottom: '20px'}}>
                <label 
                  htmlFor="adminComments"
                  style={styles.formLabel}
                >
                  {actionType === 'approve' ? 'Comments (Optional)' : 'Comments (Required)'}
                </label>
                <textarea
                  id="adminComments"
                  value={adminComments}
                  onChange={(e) => setAdminComments(e.target.value)}
                  placeholder={
                    actionType === 'approve' 
                      ? "Add any approval comments or notes..."
                      : "Please explain why this offer is being declined..."
                  }
                  rows="4"
                  style={{
                    ...styles.textarea,
                    ...(actionType === 'decline' && !adminComments.trim() ? 
                        {borderColor: '#dc3545'} : {})
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = '#007bff';
                    e.target.style.boxShadow = '0 0 0 3px rgba(0, 123, 255, 0.1)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = '#e9ecef';
                    e.target.style.boxShadow = 'none';
                  }}
                />
                {actionType === 'decline' && !adminComments.trim() && (
                  <p style={styles.validationError}>
                    Comments are required when declining an offer
                  </p>
                )}
              </div>
            </div>

            <div style={styles.modalFooter}>
              <button 
                style={styles.btnSecondary}
                onClick={closeModal}
                disabled={processing}
              >
                Cancel
              </button>
              <button 
                style={{
                  ...styles.btn,
                  ...(actionType === 'approve' ? styles.btnApprove : styles.btnDecline),
                  ...(processing || (actionType === 'decline' && !adminComments.trim()) ? 
                      {opacity: '0.6', cursor: 'not-allowed'} : {})
                }}
                onClick={handleAction}
                disabled={processing || (actionType === 'decline' && !adminComments.trim())}
              >
                {processing ? (
                  <>
                    <span style={styles.spinnerSmall}></span>
                    Processing...
                  </>
                ) : (
                  `${actionType === 'approve' ? 'Approve' : 'Decline'} Offer`
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && (
        <div style={styles.modalOverlay} onClick={(e) => {
          if (e.target === e.currentTarget) closeEditModal();
        }}>
          <div style={styles.modal}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>Edit Offer</h3>
              <button 
                style={styles.modalClose}
                onClick={closeEditModal}
                onMouseOver={(e) => {
                  e.target.style.backgroundColor = '#f8f9fa';
                  e.target.style.color = '#495057';
                }}
                onMouseOut={(e) => {
                  e.target.style.backgroundColor = 'transparent';
                  e.target.style.color = '#6c757d';
                }}
              >
                ×
              </button>
            </div>
            
            <div style={styles.modalBody}>
              <div style={styles.offerSummary}>
                <h4 style={{margin: '0 0 10px 0', color: '#007bff', fontSize: '1.2rem'}}>
                  Editing: "{selectedOffer?.title}"
                </h4>
                <p style={{margin: '5px 0', color: '#495057'}}>
                  Business: {selectedOffer?.businessId?.name}
                </p>
                <p style={{margin: '5px 0', color: '#495057'}}>
                  Current Status: <strong>{selectedOffer?.adminStatus}</strong>
                </p>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.formLabel}>Title *</label>
                <input
                  type="text"
                  value={editOfferData.title}
                  onChange={(e) => setEditOfferData({...editOfferData, title: e.target.value})}
                  placeholder="Enter offer title"
                  style={styles.input}
                  required
                  onFocus={(e) => {
                    e.target.style.borderColor = '#007bff';
                    e.target.style.boxShadow = '0 0 0 3px rgba(0, 123, 255, 0.1)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = '#e9ecef';
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.formLabel}>Discount *</label>
                <input
                  type="text"
                  value={editOfferData.discount}
                  onChange={(e) => setEditOfferData({...editOfferData, discount: e.target.value})}
                  placeholder="e.g., 20%, $50, Buy 1 Get 1"
                  style={styles.input}
                  required
                  onFocus={(e) => {
                    e.target.style.borderColor = '#007bff';
                    e.target.style.boxShadow = '0 0 0 3px rgba(0, 123, 255, 0.1)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = '#e9ecef';
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.formLabel}>Category</label>
                <input
                  type="text"
                  value={editOfferData.category}
                  onChange={(e) => setEditOfferData({...editOfferData, category: e.target.value})}
                  placeholder="Enter category (optional)"
                  style={styles.input}
                  onFocus={(e) => {
                    e.target.style.borderColor = '#007bff';
                    e.target.style.boxShadow = '0 0 0 3px rgba(0, 123, 255, 0.1)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = '#e9ecef';
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.formLabel}>Start Date</label>
                <input
                  type="date"
                  value={editOfferData.startDate}
                  onChange={(e) => setEditOfferData({...editOfferData, startDate: e.target.value})}
                  style={styles.input}
                  onFocus={(e) => {
                    e.target.style.borderColor = '#007bff';
                    e.target.style.boxShadow = '0 0 0 3px rgba(0, 123, 255, 0.1)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = '#e9ecef';
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.formLabel}>End Date</label>
                <input
                  type="date"
                  value={editOfferData.endDate}
                  onChange={(e) => setEditOfferData({...editOfferData, endDate: e.target.value})}
                  style={styles.input}
                  onFocus={(e) => {
                    e.target.style.borderColor = '#007bff';
                    e.target.style.boxShadow = '0 0 0 3px rgba(0, 123, 255, 0.1)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = '#e9ecef';
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </div>

              <div style={styles.formGroup}>
                <label style={{...styles.formLabel, display: 'flex', alignItems: 'center', gap: '10px'}}>
                  <input
                    type="checkbox"
                    checked={editOfferData.isActive}
                    onChange={(e) => setEditOfferData({...editOfferData, isActive: e.target.checked})}
                    style={{width: 'auto'}}
                  />
                  Active Offer
                </label>
              </div>
            </div>

            <div style={styles.modalFooter}>
              <button 
                style={styles.btnSecondary}
                onClick={closeEditModal}
                disabled={processing}
              >
                Cancel
              </button>
              <button 
                style={{
                  ...styles.btnEdit,
                  ...(processing || !editOfferData.title || !editOfferData.discount ? 
                      {opacity: '0.6', cursor: 'not-allowed'} : {})
                }}
                onClick={handleEditOffer}
                disabled={processing || !editOfferData.title || !editOfferData.discount}
              >
                {processing ? (
                  <>
                    <span style={styles.spinnerSmall}></span>
                    Updating...
                  </>
                ) : (
                  'Update Offer'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CSS Animations */}
      <style>
        {`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }

          @keyframes modalAppear {
            from {
              opacity: 0;
              transform: scale(0.9) translateY(-20px);
            }
            to {
              opacity: 1;
              transform: scale(1) translateY(0);
            }
          }

          /* Mobile responsive styles */
          @media (max-width: 768px) {
            .offer-card:hover {
              transform: none !important;
            }
            
            .filter-tabs {
              overflow-x: auto;
              -webkit-overflow-scrolling: touch;
            }
            
            .filter-tabs::-webkit-scrollbar {
              display: none;
            }
            
            .details-grid {
              grid-template-columns: 1fr !important;
            }
            
            .detail-item {
              flex-direction: column !important;
              align-items: flex-start !important;
            }
            
            .value {
              text-align: left !important;
              margin-left: 0 !important;
              margin-top: 5px;
            }
            
            .offer-actions {
              flex-direction: column !important;
            }
            
            .btn {
              width: 100% !important;
              min-width: auto !important;
            }
            
            .modal-footer {
              flex-direction: column !important;
            }
          }

          @media (max-width: 480px) {
            .filter-tab {
              min-width: 120px !important;
            }
          }

          /* Hover effects for desktop */
          @media (min-width: 769px) {
            .offer-card:hover {
              transform: translateY(-2px) !important;
              box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15) !important;
            }
          }

          /* Focus styles for accessibility */
          .btn:focus,
          .filter-tab:focus,
          .modal-close:focus {
            outline: 2px solid #007bff !important;
            outline-offset: 2px !important;
          }

          /* Smooth scrolling */
          .offers-list {
            scroll-behavior: smooth;
          }
        `}
      </style>
    </div>
  );
};

export default AdminOffersManagement;