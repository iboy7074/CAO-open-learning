const express = require("express");
const bcrypt = require("bcryptjs");
const Admin = require("../models/Admin");
const Video = require("../models/Video");

const router = express.Router();

const SAMPLE_VIDEOS = [
  { title: "Learn Python - Full Course for Beginners", category: "Tech", source: "youtube", youtubeId: "rfscVS0vtbw" },
  { title: "Cyber Security Full Course for Beginners", category: "Cybersecurity", source: "youtube", youtubeId: "U_P23SqJaDc" },
  { title: "Getting Started with Figma: 1-Hour UI Design Course", category: "Design", source: "youtube", youtubeId: "nq19w0d5o0U" },
  { title: "The Foundations of Entrepreneurship - Full Course", category: "Business", source: "youtube", youtubeId: "UEngvxZ11sw" }
];

/* GET /api/seed?secret=YOUR_SEED_SECRET
   Visit this URL once from a browser (phone is fine) to create admin accounts
   and seed sample videos - an alternative to Render's Shell/One-Off Jobs, which
   can be a paid-only feature on some plans. Protected by SEED_SECRET so randoms
   can't trigger it just by finding the URL. */
router.get("/seed", async (req, res) => {
  if (!process.env.SEED_SECRET || req.query.secret !== process.env.SEED_SECRET) {
    return res.status(403).json({ error: "Forbidden. Set SEED_SECRET in your .env and pass ?secret=... matching it." });
  }

  const log = [];

  const adminPairs = (process.env.SEED_ADMIN_ACCOUNTS || "").split(",").map(s => s.trim()).filter(Boolean);
  for (const pair of adminPairs) {
    const [username, password] = pair.split(":");
    if (!username || !password) continue;
    const existing = await Admin.findOne({ username });
    if (existing) { log.push(`Admin '${username}' already exists, skipped.`); continue; }
    const passwordHash = await bcrypt.hash(password, 10);
    await Admin.create({ username, passwordHash });
    log.push(`Created admin: ${username}`);
  }

  const videoCount = await Video.countDocuments();
  if (videoCount === 0) {
    for (const v of SAMPLE_VIDEOS) await Video.create({ ...v, addedBy: "seed-endpoint" });
    log.push(`Seeded ${SAMPLE_VIDEOS.length} sample videos.`);
  } else {
    log.push("Videos already exist, skipped.");
  }

  res.json({ message: "Seed complete.", log });
});

module.exports = router;
