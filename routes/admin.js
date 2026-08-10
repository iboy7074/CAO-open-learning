const express = require("express");
const Profile = require("../models/Profile");
const User = require("../models/User");
const Completion = require("../models/Completion");
const { verifyToken } = require("../middleware/auth");
const { notifyAdminsOnTelegram } = require("../notify");

const router = express.Router();

router.use(verifyToken("admin"));

/* ---------- GET /api/admin/registrations ---------- (list of completed profiles) */
router.get("/registrations", async (req, res) => {
  const list = await Profile.find().sort({ createdAt: -1 });
  res.json(list);
});

/* ---------- DELETE /api/admin/registrations/:id ---------- */
router.delete("/registrations/:id", async (req, res) => {
  const profile = await Profile.findByIdAndDelete(req.params.id);
  if (profile) {
    await User.deleteOne({ email: profile.email });
    await Completion.deleteMany({ email: profile.email });
  }
  res.json({ message: "Deleted." });
});

/* ---------- DELETE /api/admin/registrations ---------- (clear all) */
router.delete("/registrations", async (req, res) => {
  await Profile.deleteMany({});
  await User.deleteMany({});
  await Completion.deleteMany({});
  res.json({ message: "All registrations cleared." });
});

/* ---------- POST /api/admin/registrations/:id/resend ---------- */
router.post("/registrations/:id/resend", async (req, res) => {
  const d = await Profile.findById(req.params.id);
  if (!d) return res.status(404).json({ error: "Not found." });
  const results = await notifyAdminsOnTelegram(d.toObject());
  res.json({ results });
});

module.exports = router;
