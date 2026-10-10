import mongoose from 'mongoose';

// An account. role: 'admin' manages everyone; status: 'pending' (waiting for the
// admin), 'active', 'disabled'. accessUntil: last day the account may use the
// app (null = no limit). The password is stored only as a scrypt hash.
const UserSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, default: '' },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['admin', 'user'], default: 'user' },
    status: { type: String, enum: ['pending', 'active', 'disabled'], default: 'pending' },
    accessUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    // bumped on password reset / disable: signs every old session out
    sessionVersion: { type: Number, default: 1 },
  },
  { timestamps: true }
);

export default mongoose.models.User || mongoose.model('User', UserSchema);
