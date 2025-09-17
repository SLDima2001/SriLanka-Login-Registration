import mongoose from 'mongoose';
import AutoIncrementFactory from 'mongoose-sequence';

const AutoIncrement = AutoIncrementFactory(mongoose);

const businessSchema = new mongoose.Schema({
  businessId: Number,
  userId: { type: Number, ref: 'User', required: true },
  name: { type: String, required: true },
  address: String,
  phone: String,
  email: String,
  website: String,
  category: String,
  socialMediaLinks: String,
  operatingHours: String,
  businessType: String,
  registrationNumber: String,
  taxId: String,
  
  // Enhanced status management for plan limitations
  status: { type: String, enum: ['active', 'inactive', 'suspended'], default: 'active' },
  suspendedDate: Date,
  suspensionReason: String,
  displayOrder: { type: Number, default: 0 },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

businessSchema.plugin(AutoIncrement, { inc_field: 'businessId' });
const Business = mongoose.model('Business', businessSchema);

export default Business;