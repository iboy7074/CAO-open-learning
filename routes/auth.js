const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");

const User = require("../models/User");
const Admin = require("../models/Admin");
const { genOtp } = require("../genOtp");
const { emailOtpToUser } = require("../notify");

const router = express.Router();

const registerLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 8 });
const verifyLimiter    = rateLimit({ windowMs: 15 * 60 * 1000, max: 15 });
const loginLimiter     = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
const adminLoginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

const OTP_TTL_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 5;

/* ---------- POST /api/auth/register ---------- (step 1 of first-time signup) */
router.post("/auth/register", registerLimiter, async (req, res) => {
  try {
    const username = (req.body.username || "").trim();
    const email = (req.body.email || "").trim().toLowerCase();
    const password = req.body.password || "";

    if (!username || !email || !password) {
      return res.status(400).json({ error: "Username, email, and password are required." });
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Enter a valid email." });
    if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });

    const usernameTaken = await User.findOne({ username: new RegExp(`^${username}$`, "i"), isVerified: true });
    if (usernameTaken) return res.status(409).json({ error: "That username is already taken." });

    const existingByEmail = await User.findOne({ email });
    if (existingByEmail && existingByEmail.isVerified) {
      return res.status(409).json({ error: "That email is already registered. Try logging in instead." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const otp = genOtp();
    const otpHash = await bcrypt.hash(otp, 10);
    const otpExpires = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    // Upsert an unverified user record - lets someone retry registration if they never confirmed the OTP
    await User.findOneAndUpdate(
      { email },
      { email, username, passwordHash, isVerified: false, otpHash, otpExpires, otpAttempts: 0 },
      { upsert: true, new: true }
    );

    const emailStatus = await emailOtpToUser({ email, otp });
    res.json({ message: "Code sent.", emailStatus });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not start registration. Try again." });
  }
});

/* ---------- POST /api/auth/verify-register ---------- (step 2: confirm email with the OTP) */
router.post("/auth/verify-register", verifyLimiter, async (req, res) => {
  try {
    const email = (req.body.email || "").trim().toLowerCase();
    const otp = (req.body.otp || "").trim();
    if (!email || !otp) return res.status(400).json({ error: "Email and code are required." });

    const user = await User.findOne({ email });
    if (!user || !user.otpHash || !user.otpExpires) {
      return res.status(400).json({ error: "No pending registration for this email." });
    }
    if (user.otpExpires < new Date()) return res.status(400).json({ error: "Code expired. Register again." });
    if (user.otpAttempts >= MAX_OTP_ATTEMPTS) return res.status(429).json({ error: "Too many attempts. Register again for a new code." });

    const ok = await bcrypt.compare(otp, user.otpHash);
    if (!ok) {
      user.otpAttempts += 1;
      await user.save();
      return res.status(401).json({ error: "Incorrect code." });
    }

    user.isVerified = true;
    user.otpHash = undefined;
    user.otpExpires = undefined;
    user.otpAttempts = 0;
    await user.save();

    const token = jwt.sign({ email: user.email, role: "student" }, process.env.JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, email: user.email, username: user.username });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Verification failed. Try again." });
  }
});

/* ---------- POST /api/auth/login ---------- (returning students: username + password) */
router.post("/auth/login", loginLimiter, async (req, res) => {
  try {
    const username = (req.body.username || "").trim();
    const password = req.body.password || "";
    if (!username || !password) return res.status(400).json({ error: "Username and password are required." });

    const user = await User.findOne({ username: new RegExp(`^${username}$`, "i") });
    if (!user || !user.isVerified) return res.status(401).json({ error: "Invalid username or password." });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Invalid username or password." });

    const token = jwt.sign({ email: user.email, role: "student" }, process.env.JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, email: user.email, username: user.username });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Login failed. Try again." });
  }
});

/* ---------- POST /api/admin/login ---------- (unchanged) */
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
