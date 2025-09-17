import express from 'express';
import { Offer, Business, User, Subscription } from '../models/index.js';
import { sendOfferApprovalNotification, sendOfferEditNotification, sendOfferStartNotification } from '../services/emailService.js';

const router = express.Router();

// Get all offers for a user
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const offers = await Offer.find({ userId: parseInt(userId) })
      .populate('businessId', 'name')
      .sort({ createdAt: -1 });

    const offersWithStatus = offers.map(offer => {
      const now = new Date();
      const startDate = offer.startDate ? new Date(offer.startDate) : null;
      const endDate = offer.endDate ? new Date(offer.endDate) : null;

      let computedStatus = offer.adminStatus;

      if (offer.adminStatus === 'approved') {
        if (startDate && startDate > now) {
          computedStatus = 'approved-scheduled';
        } else if (endDate && endDate < now) {
          computedStatus = 'approved-expired';
        } else if (!offer.isActive) {
          computedStatus = 'approved-inactive';
        } else {
          computedStatus = 'approved-active';
        }
      }

      return {
        ...offer.toObject(),
        computedStatus,
        canEdit: offer.adminStatus === 'pending' || offer.adminStatus === 'declined'
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
router.post('/', async (req, res) => {
  try {
    const { userId, businessId, title, discount, category, startDate, endDate, isActive } = req.body;

    if (!userId || !businessId || !title || !discount) {
      return res.status(400).json({
        success: false,
        message: 'User ID, business ID, title, and discount are required'
      });
    }

    const business = await Business.findOne({ _id: businessId, userId: userId });
    if (!business) {
      return res.status(400).json({
        success: false,
        message: 'Business not found or does not belong to this user'
      });
    }

    console.log(`🎯 Offer creation attempt for userId: ${userId}, business: ${business.name}`);

    const user = await User.findOne({ userId: userId });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

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

    const existingOffersCount = await Offer.countDocuments({
      userId: userId,
      adminStatus: 'approved',
      isActive: true
    });

    console.log(`📊 Existing approved offers count: ${existingOffersCount}`);

    const now = new Date();
    const isPremium = activeSubscription.planId === '2' &&
      activeSubscription.status === 'active' &&
      (!activeSubscription.endDate || new Date(activeSubscription.endDate) > now);

    const maxOffers = isPremium ? 9 : 3;
    const planType = isPremium ? 'Premium' : 'Free';

    console.log(`📋 Plan analysis: ${planType} plan allows ${maxOffers} approved offers`);

    if (existingOffersCount >= maxOffers) {
      console.log(`❌ Approved offer limit reached: ${existingOffersCount}/${maxOffers}`);
      return res.status(400).json({
        success: false,
        message: `${planType} plan allows maximum ${maxOffers} approved offer${maxOffers > 1 ? 's' : ''} (highlight ad${maxOffers > 1 ? 's' : ''}). You have ${existingOffersCount}/${maxOffers} approved offers.`,
        planUpgradeRequired: !isPremium,
        currentCount: existingOffersCount,
        maxAllowed: maxOffers,
        planType: planType,
        hint: isPremium ? 'Wait for admin approval or consider deactivating an existing offer.' : 'Upgrade to Premium to create up to 3 offers.'
      });
    }

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

    const offer = new Offer({
      userId,
      businessId,
      title,
      discount,
      category,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      isActive: isActive !== undefined ? isActive : true,
      adminStatus: 'pending',
      updatedAt: new Date()
    });

    await offer.save();

    await offer.populate('businessId', 'name');

    console.log(`✅ Offer created and submitted for approval: ${offer.title} (ID: ${offer.offerId})`);

    res.json({
      success: true,
      message: `Offer submitted successfully and is pending admin approval. You'll be notified once it's reviewed.`,
      offer: offer,
      planInfo: {
        planType: planType,
        approvedOffersUsed: existingOffersCount,
        maxOffers: maxOffers,
        canCreateMore: existingOffersCount < maxOffers
      },
      pendingApproval: true
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

// Update offer
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { businessId, title, discount, category, startDate, endDate, isActive, requiresReapproval } = req.body;

    const existingOffer = await Offer.findById(id);
    if (!existingOffer) {
      return res.status(404).json({
        success: false,
        message: 'Offer not found'
      });
    }

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

    const contentChanged = (
      existingOffer.title !== title ||
      existingOffer.discount !== discount ||
      existingOffer.category !== category ||
      (existingOffer.startDate?.toISOString().split('T')[0] !== startDate) ||
      (existingOffer.endDate?.toISOString().split('T')[0] !== endDate) ||
      existingOffer.businessId.toString() !== businessId
    );

    console.log(`Offer ${id} edit attempt:`, {
      contentChanged,
      currentStatus: existingOffer.adminStatus,
      title: { old: existingOffer.title, new: title },
      discount: { old: existingOffer.discount, new: discount }
    });

    let statusReset = false;
    if (contentChanged && (existingOffer.adminStatus === 'approved' || existingOffer.adminStatus === 'declined')) {
      updateData.adminStatus = 'pending';
      updateData.adminComments = '';
      updateData.reviewedBy = null;
      updateData.reviewedAt = null;
      statusReset = true;

      console.log(`🔄 Offer ${id} content changed - resetting status from ${existingOffer.adminStatus} to pending`);
    }

    const updatedOffer = await Offer.findByIdAndUpdate(id, updateData, { new: true })
      .populate('businessId', 'name');

    if (!updatedOffer) {
      return res.status(404).json({
        success: false,
        message: 'Failed to update offer'
      });
    }

    if (statusReset) {
      try {
        const user = await User.findOne({ userId: updatedOffer.userId });
        if (user) {
          await sendOfferEditNotification(user, updatedOffer, existingOffer.adminStatus);
          console.log(`📧 Edit notification sent to ${user.email}`);
        } else {
          console.log(`⚠️ User not found for userId: ${updatedOffer.userId}`);
        }
      } catch (emailError) {
        console.error('❌ Failed to send edit notification email:', emailError);
      }
    }

    let message = 'Offer updated successfully';
    if (statusReset) {
      message = 'Offer updated successfully and resubmitted for admin approval';
    } else if (existingOffer.adminStatus === 'declined') {
      message = 'Offer updated successfully';
    }

    res.json({
      success: true,
      message: message,
      offer: updatedOffer,
      statusReset: statusReset,
      previousStatus: existingOffer.adminStatus,
      contentChanged: contentChanged
    });

  } catch (error) {
    console.error('❌ Error updating offer:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update offer',
      error: error.message
    });
  }
});

// Delete offer
router.delete('/:id', async (req, res) => {
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

// Get offer status history
router.get('/:id/status-history', async (req, res) => {
  try {
    const { id } = req.params;

    const offer = await Offer.findById(id)
      .populate('businessId', 'name')
      .select('title adminStatus reviewedBy reviewedAt updatedAt createdAt adminComments');

    if (!offer) {
      return res.status(404).json({
        success: false,
        message: 'Offer not found'
      });
    }

    const wasResubmitted = offer.updatedAt && offer.reviewedAt &&
      new Date(offer.updatedAt) > new Date(offer.reviewedAt);

    res.json({
      success: true,
      offer: {
        id: offer._id,
        title: offer.title,
        business: offer.businessId.name,
        currentStatus: offer.adminStatus,
        wasResubmitted: wasResubmitted,
        lastUpdated: offer.updatedAt,
        lastReviewed: offer.reviewedAt,
        reviewedBy: offer.reviewedBy,
        adminComments: offer.adminComments,
        created: offer.createdAt
      }
    });

  } catch (error) {
    console.error('Error fetching offer status history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch offer status history'
    });
  }
});

// Toggle offer status
router.patch('/:id/toggle-status', async (req, res) => {
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

// Get offer statistics
router.get('/stats/:userId', async (req, res) => {
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

// Send offer notification
router.post('/send-offer-notification', async (req, res) => {
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

// Check offer notifications
router.get('/check-offer-notifications', async (req, res) => {
  try {
    const today = new Date();
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));
    const endOfDay = new Date(today.setHours(23, 59, 59, 999));

    const offersStartingToday = await Offer.find({
      startDate: {
        $gte: startOfDay,
        $lte: endOfDay
      },
      isActive: true
    }).populate('businessId', 'name');

    let notificationsSent = 0;

    for (const offer of offersStartingToday) {
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

export default router;