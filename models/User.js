const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  email:      { type: String, required: true, unique: true, lowercase: true, trim: true },
  otpHash:    { type: String },
  otpExpires: { type: Date },
  otpAttempts:{ type: Number, default: 0 }, // resets on new OTP request, guards against guessing
}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);
