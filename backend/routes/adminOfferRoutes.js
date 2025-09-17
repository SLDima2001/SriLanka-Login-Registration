import express from 'express';
import { Offer, User } from '../models/index.js';
import { sendOfferApprovalNotification } from '../services/emailService.js';

const router = express.Router();

// Get all offers for admin review
router.get('/', async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;

    let filter = {};
    if (status && ['pending', 'approved', 'declined'].includes(status)) {
      filter.adminStatus = status;
    }

    console.log(`📋 Fetching admin offers with filter:`, filter);

    const offers = await Offer.find(filter)
      .populate('businessId', 'name category address phone email website')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const totalOffers = await Offer.countDocuments(filter);

    const offersWithUserDetails = await Promise.all(offers.map(async (offer) => {
      try {
        const user = await User.findOne({ userId: offer.userId }).select('firstName lastName email businessName userType');

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
          userDetails: user ? {
            userId: user.userId,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            businessName: user.businessName,
            userType: user.userType
          } : {
            userId: offer.userId,
            firstName: 'Unknown',
            lastName: 'User',
            email: 'N/A',
            businessName: 'N/A',
            userType: 'N/A'
          },
          computedStatus
        };
      } catch (error) {
        console.error(`Error fetching user details for userId ${offer.userId}:`, error);
        return {
          ...offer.toObject(),
          userDetails: {
            userId: offer.userId,
            firstName: 'Error',
            lastName: 'Loading',
            email: 'N/A',
            businessName: 'N/A',
            userType: 'N/A'
          },
          computedStatus: offer.adminStatus
        };
      }
    }));

    console.log(`✅ Fetched ${offersWithUserDetails.length} offers for admin`);

    res.json({
      success: true,
      offers: offersWithUserDetails,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalOffers / limit),
        totalOffers,
        limit: parseInt(limit)
      },
      counts: {
        pending: await Offer.countDocuments({ adminStatus: 'pending' }),
        approved: await Offer.countDocuments({ adminStatus: 'approved' }),
        declined: await Offer.countDocuments({ adminStatus: 'declined' })
      }
    });
  } catch (error) {
    console.error('❌ Error fetching admin offers:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch offers for admin review',
      error: error.message
    });
  }
});

// Approve offer
router.patch('/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const { adminComments, reviewedBy } = req.body;

    console.log(`🔄 Approving offer ${id} by ${reviewedBy || 'Admin'}`);

    const offer = await Offer.findByIdAndUpdate(
      id,
      {
        adminStatus: 'approved',
        adminComments: adminComments || '',
        reviewedBy: reviewedBy || 'Admin',
        reviewedAt: new Date(),
        updatedAt: new Date()
      },
      { new: true }
    ).populate('businessId', 'name');

    if (!offer) {
      console.log(`❌ Offer not found: ${id}`);
      return res.status(404).json({
        success: false,
        message: 'Offer not found'
      });
    }

    console.log(`✅ Offer approved: ${offer.title} by ${reviewedBy || 'Admin'}`);

    const user = await User.findOne({ userId: offer.userId });

    if (user && user.email) {
      try {
        await sendOfferApprovalNotification({
          ...offer.toObject(),
          userId: user,
          businessId: offer.businessId
        }, 'approved');
        console.log(`📧 Approval notification sent to ${user.email}`);
      } catch (emailError) {
        console.error('Failed to send approval notification:', emailError);
      }
    } else {
      console.log(`⚠️ User not found for userId: ${offer.userId}`);
    }

    res.json({
      success: true,
      message: 'Offer approved successfully',
      offer: offer
    });
  } catch (error) {
    console.error('❌ Error approving offer:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve offer',
      error: error.message
    });
  }
});

// Decline offer
router.patch('/:id/decline', async (req, res) => {
  try {
    const { id } = req.params;
    const { adminComments, reviewedBy } = req.body;

    if (!adminComments || adminComments.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Admin comments are required when declining an offer'
      });
    }

    console.log(`🔄 Declining offer ${id} by ${reviewedBy || 'Admin'}`);

    const offer = await Offer.findByIdAndUpdate(
      id,
      {
        adminStatus: 'declined',
        adminComments: adminComments,
        reviewedBy: reviewedBy || 'Admin',
        reviewedAt: new Date(),
        updatedAt: new Date()
      },
      { new: true }
    ).populate('businessId', 'name');

    if (!offer) {
      console.log(`❌ Offer not found: ${id}`);
      return res.status(404).json({
        success: false,
        message: 'Offer not found'
      });
    }

    console.log(`❌ Offer declined: ${offer.title} by ${reviewedBy || 'Admin'}`);

    const user = await User.findOne({ userId: offer.userId });

    if (user && user.email) {
      try {
        await sendOfferApprovalNotification({
          ...offer.toObject(),
          userId: user,
          businessId: offer.businessId
        }, 'declined');
        console.log(`📧 Decline notification sent to ${user.email}`);
      } catch (emailError) {
        console.error('Failed to send decline notification:', emailError);
      }
    } else {
      console.log(`⚠️ User not found for userId: ${offer.userId}`);
    }

    res.json({
      success: true,
      message: 'Offer declined successfully',
      offer: offer
    });
  } catch (error) {
    console.error('❌ Error declining offer:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to decline offer',
      error: error.message
    });
  }
});

// Delete offer
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    console.log(`🗑️ Deleting offer ${id}`);

    const offer = await Offer.findById(id).populate('businessId', 'name');

    if (!offer) {
      console.log(`❌ Offer not found: ${id}`);
      return res.status(404).json({
        success: false,
        message: 'Offer not found'
      });
    }

    await Offer.findByIdAndDelete(id);

    console.log(`✅ Offer deleted: ${offer.title} (ID: ${offer.offerId})`);

    res.json({
      success: true,
      message: 'Offer deleted successfully',
      deletedOffer: {
        id: offer._id,
        title: offer.title,
        businessName: offer.businessId?.name || 'Unknown'
      }
    });
  } catch (error) {
    console.error('❌ Error deleting offer:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete offer',
      error: error.message
    });
  }
});

// Update offer (admin edit)
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, discount, category, startDate, endDate, isActive } = req.body;

    if (!title || !discount) {
      return res.status(400).json({
        success: false,
        message: 'Title and discount are required'
      });
    }

    console.log(`✏️ Admin editing offer ${id}`);

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
      isActive: isActive !== undefined ? isActive : true,
      updatedAt: new Date()
    };

    if (startDate !== undefined) {
      updateData.startDate = startDate ? new Date(startDate) : null;
    }

    if (endDate !== undefined) {
      updateData.endDate = endDate ? new Date(endDate) : null;
    }

    const updatedOffer = await Offer.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    ).populate('businessId', 'name');

    if (!updatedOffer) {
      console.log(`❌ Offer not found: ${id}`);
      return res.status(404).json({
        success: false,
        message: 'Offer not found'
      });
    }

    console.log(`✅ Offer updated by admin: ${updatedOffer.title}`);

    res.json({
      success: true,
      message: 'Offer updated successfully by admin',
      offer: updatedOffer
    });

  } catch (error) {
    console.error('❌ Error updating offer (admin):', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update offer',
      error: error.message
    });
  }
});

export default router;