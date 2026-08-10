const express = require("express");
const Profile = require("../models/Profile");
const { verifyToken } = require("../middleware/auth");
const { notifyAdminsOnTelegram } = require("../notify");

const router = express.Router();

router.use(verifyToken("student"));

/* ---------- GET /api/profile ---------- */
router.get("/", async (req, res) => {
  const profile = await Profile.findOne({ email: req.user.email });
  res.json(profile || null);
});

/* ---------- POST /api/profile ---------- (create or update) */
router.post("/", async (req, res) => {
  try {
    const { username, age, college, place, district, state, country, address, phone, passion } = req.body;
    if (!username || !age || !college || !place || !district || !state ||
        !country || !address || !phone || !passion) {
      return res.status(400).json({ error: "All fields are required." });
    }

    const wasNew = !(await Profile.findOne({ email: req.user.email }));

    const profile = await Profile.findOneAndUpdate(
      { email: req.user.email },
      { email: req.user.email, username, age, college, place, district, state, country, address, phone, passion },
      { upsert: true, new: true }
    );

    if (wasNew) {
      await notifyAdminsOnTelegram({ ...profile.toObject() });
    }

    res.json(profile);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not save profile. Try again." });
  }
});

module.exports = router;
