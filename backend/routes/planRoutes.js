import express from 'express';

const router = express.Router();

// Get Plans
router.get('/', (req, res) => {
  const plans = [
    {
      id: 1,
      name: 'Free Plan',
      monthlyPrice: 0,
      features: ['1 highlight ad', 'Standard position in listings', 'Add one discount or promo code', 'Set start and end date for promotions'],
      description: 'Perfect for individuals getting started',
      popular: false
    },
    {
      id: 2,
      name: 'Premium Plan',
      monthlyPrice: 150,
      features: ['3 highlight ads', 'Priority position in listings and category pages', 'Multiple Promotions can be added', 'Premium Features'],
      description: 'Ideal for growing businesses',
      popular: true
    }
  ];

  res.json({ plans });
});

// Get Plans with Renewal Info
router.get('/with-renewal', (req, res) => {
  const plans = [
    {
      id: 1,
      name: 'Free Plan',
      monthlyPrice: 0,
      features: ['1 highlight ad', 'Standard position in listings', 'Add one discount or promo code', 'Set start and end date for promotions'],
      description: 'Perfect for individuals getting started',
      popular: false,
      autoRenewal: false
    },
    {
      id: 2,
      name: 'Premium Plan',
      monthlyPrice: 150,
      features: ['3 highlight ads', 'Priority position in listings and category pages', 'Multiple Promotions can be added', 'Premium Features', 'Auto-renewal available'],
      description: 'Ideal for growing businesses with automatic monthly billing',
      popular: true,
      autoRenewal: true,
      autoRenewalBenefits: [
        'Never miss premium features',
        'Automatic monthly payments',
        'Cancel anytime',
        'Email notifications for all transactions'
      ]
    }
  ];

  res.json({ plans });
});

export default router;