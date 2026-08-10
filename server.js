require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const videoRoutes = require("./routes/videos");
const profileRoutes = require("./routes/profile");

const app = express();
app.use(express.json());

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error("Not allowed by CORS"));
  }
}));

app.get("/api/health", (req, res) => res.json({ ok: true }));
app.use("/api", authRoutes);            // /api/auth/request-otp, /api/auth/verify-otp, /api/admin/login
app.use("/api/admin", adminRoutes);     // /api/admin/registrations...
app.use("/api/videos", videoRoutes);    // /api/videos...
app.use("/api/profile", profileRoutes); // /api/profile

const PORT = process.env.PORT || 4000;

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log("✅ MongoDB connected");
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
  })
  .catch(err => {
    console.error("❌ MongoDB connection failed:", err.message);
    process.exit(1);
  });
