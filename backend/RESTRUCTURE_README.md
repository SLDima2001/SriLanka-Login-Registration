# Backend Restructuring Documentation

## Overview
The original `index.js` file has been restructured into a modular architecture for better maintainability, scalability, and organization. All functionality has been preserved and separated into logical modules.

## New File Structure

```
backend/
├── index_restructured.js          # Main application entry point
├── models/                        # Database models
│   ├── index.js                  # Model exports
│   ├── Admin.js                  # Admin model
│   ├── User.js                   # User model
│   ├── Subscription.js           # Subscription models
│   ├── Business.js               # Business model
│   └── Offer.js                  # Offer model
├── services/                      # Business logic services
│   ├── emailService.js           # Email functionality
│   ├── payhereService.js         # PayHere payment processing
│   └── subscriptionService.js    # Subscription management
├── routes/                        # API route handlers
│   ├── authRoutes.js             # Authentication routes
│   ├── adminRoutes.js            # Admin management routes
│   ├── payhereRoutes.js          # PayHere payment routes
│   ├── subscriptionRoutes.js     # Subscription management routes
│   ├── businessRoutes.js         # Business management routes
│   ├── offerRoutes.js            # Offer management routes
│   ├── adminOfferRoutes.js       # Admin offer review routes
│   ├── userRoutes.js             # User utility routes
│   └── planRoutes.js             # Plan information routes
└── utils/                         # Utility functions
    └── cronJobs.js               # Scheduled tasks
```

## Key Changes

### 1. Models Separation
- **Admin.js**: Admin user schema and model
- **User.js**: Regular user schema with auto-increment
- **Subscription.js**: All subscription-related schemas (Subscription, SubscriptionLog, SubscriptionHistory)
- **Business.js**: Business entity schema
- **Offer.js**: Offer/promotion schema
- **index.js**: Centralized model exports

### 2. Services Layer
- **emailService.js**: All email functionality including welcome, renewal, approval notifications
- **payhereService.js**: PayHere payment processing, hash generation, validation
- **subscriptionService.js**: Subscription business logic, payment handlers, renewal processing

### 3. Route Organization
- **authRoutes.js**: User registration, login, password reset
- **adminRoutes.js**: Admin authentication and management
- **payhereRoutes.js**: Payment creation, notifications, status checking
- **subscriptionRoutes.js**: Subscription management, cancellations, downgrades
- **businessRoutes.js**: Business CRUD operations
- **offerRoutes.js**: Offer CRUD operations for users
- **adminOfferRoutes.js**: Admin offer review and approval
- **userRoutes.js**: User utility functions, debugging, token verification
- **planRoutes.js**: Plan information endpoints

### 4. Utilities
- **cronJobs.js**: All scheduled tasks including renewal checks, cancellation processing, cleanup

## Route Mapping

### Authentication Routes (`/api/auth`)
- `POST /register` - User registration
- `POST /login` - User login
- `POST /forgot-password` - Password reset request
- `POST /reset-password/:token` - Password reset
- `GET /users` - Get all users (admin)
- `PUT /users/:id` - Update user
- `DELETE /users/:id` - Delete user

### Admin Routes (`/api/admin`)
- `POST /login` - Admin login
- `POST /register` - Admin registration
- `GET /admins` - Get all admins
- `PUT /admins/:id` - Update admin
- `DELETE /admins/:id` - Delete admin

### PayHere Routes (`/api/payhere`)
- `POST /create-payhere-payment` - Create payment
- `POST /create-payhere-recurring-payment` - Create recurring payment
- `POST /payhere-notify` - Payment notification handler
- `POST /payhere-recurring-notify` - Recurring payment notifications
- `GET /payhere-status/:orderId` - Check payment status

### Subscription Routes (`/api/subscription`)
- `POST /check-subscription` - Check user subscription status
- `POST /cancel-auto-renewal` - Cancel auto-renewal
- `POST /reactivate-auto-renewal` - Reactivate auto-renewal
- `POST /schedule-cancellation` - Schedule subscription cancellation
- `POST /schedule-downgrade` - Schedule plan downgrade
- `POST /process-downgrades` - Process scheduled downgrades

### Business Routes (`/api/businesses`)
- `GET /user/:userId` - Get user's businesses
- `POST /` - Create new business
- `PUT /:id` - Update business
- `DELETE /:id` - Delete business
- `GET /stats/:userId` - Get business statistics

### Offer Routes (`/api/offers`)
- `GET /user/:userId` - Get user's offers
- `POST /` - Create new offer
- `PUT /:id` - Update offer
- `DELETE /:id` - Delete offer
- `GET /stats/:userId` - Get offer statistics

### Admin Offer Routes (`/api/admin/offers`)
- `GET /` - Get all offers for review
- `PATCH /:id/approve` - Approve offer
- `PATCH /:id/decline` - Decline offer
- `DELETE /:id` - Delete offer
- `PUT /:id` - Update offer (admin)

### User Routes (`/api/user`)
- `POST /activate-free-plan` - Activate free plan
- `GET /:userId/usage-limits` - Get usage limits
- `GET /verify-token` - Verify authentication token
- `GET /profile/:userId` - Get user profile

### Plan Routes (`/api/plans`)
- `GET /` - Get available plans
- `GET /with-renewal` - Get plans with renewal info

## Migration Guide

### To use the restructured version:

1. **Backup your current index.js**:
   ```bash
   cp index.js index_backup.js
   ```

2. **Replace the main file**:
   ```bash
   cp index_restructured.js index.js
   ```

3. **Verify all dependencies are installed**:
   ```bash
   npm install
   ```

4. **Test the application**:
   ```bash
   npm start
   ```

## Benefits of Restructuring

### 1. **Maintainability**
- Each module has a single responsibility
- Easier to locate and fix bugs
- Cleaner code organization

### 2. **Scalability**
- Easy to add new features
- Modular architecture supports team development
- Clear separation of concerns

### 3. **Testability**
- Individual modules can be tested in isolation
- Easier to mock dependencies
- Better test coverage

### 4. **Reusability**
- Services can be reused across different routes
- Models are centrally managed
- Utilities are shared

### 5. **Debugging**
- Easier to trace issues to specific modules
- Better error handling and logging
- Clear module boundaries

## Important Notes

### 1. **No Functionality Lost**
- All original functionality is preserved
- All routes work exactly as before
- All business logic is maintained

### 2. **Database Compatibility**
- All models remain the same
- No database migration required
- Existing data is fully compatible

### 3. **API Compatibility**
- All existing API endpoints work unchanged
- Client applications require no modifications
- Same request/response formats

### 4. **Environment Variables**
- Same environment variables required
- No additional configuration needed
- PayHere settings remain the same

## Troubleshooting

### Common Issues:

1. **Import Errors**:
   - Ensure all files are in correct directories
   - Check import paths in index.js

2. **Missing Dependencies**:
   - Run `npm install` to ensure all packages are installed
   - Check package.json for any missing dependencies

3. **Route Not Found**:
   - Verify route files are properly imported in index.js
   - Check route path mappings

4. **Database Connection**:
   - Ensure MongoDB connection string is correct
   - Verify models are properly imported

## Future Enhancements

The modular structure makes it easy to add:

1. **Middleware**: Authentication, validation, logging
2. **Testing**: Unit tests, integration tests
3. **Documentation**: API documentation with Swagger
4. **Monitoring**: Performance monitoring, health checks
5. **Caching**: Redis integration for better performance

## Conclusion

This restructuring provides a solid foundation for future development while maintaining all existing functionality. The modular approach makes the codebase more professional, maintainable, and scalable.