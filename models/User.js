const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
  username:     { type: String, required: true, unique: true, trim: true },
  passwordHash: { type: String, required: true },
  isVerified:   { type: Boolean, default: false }, // becomes true once the signup OTP is confirmed
  otpHash:      { type: String },
  otpExpires:   { type: Date },
  otpAttempts:  { type: Number, default: 0 }, // resets on new OTP request, guards against guessing
}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);
