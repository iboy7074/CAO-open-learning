const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");

const User = require("../models/User");
const Admin = require("../models/Admin");
const { genOtp } = require("../genOtp");
const { emailOtpToUser } = require("../notify");

const router = express.Router();

const otpRequestLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5 });   // 5 codes / 15 min per IP
const otpVerifyLimiter  = rateLimit({ windowMs: 15 * 60 * 1000, max: 15 });  // 15 attempts / 15 min per IP
const adminLoginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

const OTP_TTL_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 5;

/* ---------- POST /api/auth/request-otp ---------- */
router.post("/auth/request-otp", otpRequestLimiter, async (req, res) => {
  try {
    const email = (req.body.email || "").trim().toLowerCase();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ error: "A valid email is required." });
    }

    const otp = genOtp();
    const otpHash = await bcrypt.hash(otp, 10);
    const otpExpires = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    await User.findOneAndUpdate(
      { email },
      { email, otpHash, otpExpires, otpAttempts: 0 },
      { upsert: true, new: true }
    );

    const emailStatus = await emailOtpToUser({ email, otp });
    res.json({ message: "Code sent.", emailStatus });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not send code. Try again." });
  }
});

/* ---------- POST /api/auth/verify-otp ---------- */
router.post("/auth/verify-otp", otpVerifyLimiter, async (req, res) => {
  try {
    const email = (req.body.email || "").trim().toLowerCase();
    const otp = (req.body.otp || "").trim();
    if (!email || !otp) return res.status(400).json({ error: "Email and code are required." });

    const user = await User.findOne({ email });
    if (!user || !user.otpHash || !user.otpExpires) {
      return res.status(400).json({ error: "No code was requested for this email." });
    }
    if (user.otpExpires < new Date()) {
      return res.status(400).json({ error: "Code expired. Request a new one." });
    }
    if (user.otpAttempts >= MAX_OTP_ATTEMPTS) {
      return res.status(429).json({ error: "Too many attempts. Request a new code." });
    }

    const ok = await bcrypt.compare(otp, user.otpHash);
    if (!ok) {
      user.otpAttempts += 1;
      await user.save();
      return res.status(401).json({ error: "Incorrect code." });
    }

    // Consume the OTP so it can't be reused
    user.otpHash = undefined;
    user.otpExpires = undefined;
    user.otpAttempts = 0;
    await user.save();

    const token = jwt.sign({ email: user.email, role: "student" }, process.env.JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, email: user.email });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Verification failed. Try again." });
  }
});

/* ---------- POST /api/admin/login ---------- */
router.post("/admin/login", adminLoginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Username and password required." });

    const admin = await Admin.findOne({ username });
    if (!admin) return res.status(401).json({ error: "Invalid admin credentials." });

    const ok = await bcrypt.compare(password, admin.passwordHash);
    if (!ok) return res.status(401).json({ error: "Invalid admin credentials." });

    const token = jwt.sign({ username: admin.username, role: "admin" }, process.env.JWT_SECRET, { expiresIn: "1d" });
    res.json({ token, username: admin.username });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Login failed. Try again." });
  }
});

module.exports = router;
