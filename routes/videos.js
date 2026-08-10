const express = require("express");
const Video = require("../models/Video");
const Completion = require("../models/Completion");
const { verifyToken } = require("../middleware/auth");

const router = express.Router();

function extractYouTubeId(input) {
  input = (input || "").trim();
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([\w-]{11})/,
    /(?:youtu\.be\/)([\w-]{11})/,
    /(?:youtube\.com\/embed\/)([\w-]{11})/,
    /(?:youtube\.com\/shorts\/)([\w-]{11})/
  ];
  for (const p of patterns) {
    const m = input.match(p);
    if (m) return m[1];
  }
  if (/^[\w-]{11}$/.test(input)) return input;
  return null;
}

/* ---------- GET /api/videos ---------- (any logged-in student OR admin) */
router.get("/", verifyToken(), async (req, res) => {
  const videos = await Video.find().sort({ createdAt: -1 });
  if (req.user.role !== "student") {
    // Admins just need the raw list for the Manage Videos panel - no per-user completion state.
    return res.json(videos);
  }
  const completed = await Completion.find({ email: req.user.email }).select("videoId");
  const completedIds = new Set(completed.map(c => String(c.videoId)));
  res.json(videos.map(v => ({ ...v.toObject(), completed: completedIds.has(String(v._id)) })));
});

/* ---------- POST /api/videos/:id/complete ---------- (toggle) */
router.post("/:id/complete", verifyToken("student"), async (req, res) => {
  const existing = await Completion.findOne({ email: req.user.email, videoId: req.params.id });
  if (existing) {
    await existing.deleteOne();
    return res.json({ completed: false });
  }
  await Completion.create({ email: req.user.email, videoId: req.params.id });
  res.json({ completed: true });
});

/* ---------- POST /api/videos ---------- (admin only) */
router.post("/", verifyToken("admin"), async (req, res) => {
  const { title, category, url } = req.body;
  const youtubeId = extractYouTubeId(url);
  if (!title || !category || !youtubeId) {
    return res.status(400).json({ error: "Title, category, and a valid YouTube URL/ID are required." });
  }
  const video = await Video.create({ title, category, youtubeId, addedBy: req.user.username });
  res.status(201).json(video);
});

/* ---------- DELETE /api/videos/:id ---------- (admin only) */
router.delete("/:id", verifyToken("admin"), async (req, res) => {
  await Video.findByIdAndDelete(req.params.id);
  await Completion.deleteMany({ videoId: req.params.id });
  res.json({ message: "Deleted." });
});

module.exports = router;
