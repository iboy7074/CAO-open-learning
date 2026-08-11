const express = require("express");
const multer = require("multer");
const Video = require("../models/Video");
const Completion = require("../models/Completion");
const { verifyToken } = require("../middleware/auth");
const { uploadVideoToTelegram, resolveTelegramFileUrl } = require("../telegramStorage");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 45 * 1024 * 1024 } // 45MB - stays under Telegram's 50MB bot upload limit
});

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

function shapeVideo(v, viewerEmail) {
  const obj = v.toObject();
  return {
    _id: obj._id,
    title: obj.title,
    category: obj.category,
    source: obj.source,
    youtubeId: obj.youtubeId,
    hasThumbnail: obj.source === "telegram" ? !!obj.telegramThumbFileId : false,
    addedBy: obj.addedBy,
    createdAt: obj.createdAt,
    likeCount: (obj.likes || []).length,
    liked: viewerEmail ? (obj.likes || []).includes(viewerEmail) : false
    // telegramFileId / telegramThumbFileId intentionally never sent to the client -
    // the stream/thumbnail routes handle those server-side
  };
}

/* ---------- GET /api/videos ---------- (student or admin) */
router.get("/", verifyToken(), async (req, res) => {
  const videos = await Video.find().sort({ createdAt: -1 });
  if (req.user.role === "student") {
    const completed = await Completion.find({ email: req.user.email }).select("videoId");
    const completedIds = new Set(completed.map(c => String(c.videoId)));
    return res.json(videos.map(v => ({ ...shapeVideo(v, req.user.email), completed: completedIds.has(String(v._id)) })));
  }
  res.json(videos.map(v => shapeVideo(v, null)));
});

/* ---------- GET /api/videos/:id/stream ---------- (student only, Telegram-hosted videos) */
router.get("/:id/stream", verifyToken("student"), async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video || video.source !== "telegram" || !video.telegramFileId) {
      return res.status(404).json({ error: "Video not found." });
    }
    const fileUrl = await resolveTelegramFileUrl(video.telegramFileId);

    // Proxy the bytes through our server (with Range support so seeking/scrubbing works)
    const range = req.headers.range;
    const upstream = await fetch(fileUrl, range ? { headers: { Range: range } } : {});

    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      if (["content-type", "content-length", "content-range", "accept-ranges"].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });
    if (!res.hasHeader("Accept-Ranges")) res.setHeader("Accept-Ranges", "bytes");

    const reader = upstream.body.getReader();
    const pump = () => reader.read().then(({ done, value }) => {
      if (done) return res.end();
      res.write(Buffer.from(value));
      return pump();
    }).catch(() => res.end());
    pump();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not stream video." });
  }
});

/* ---------- GET /api/videos/:id/thumbnail ---------- (auto-generated frame from Telegram) */
router.get("/:id/thumbnail", verifyToken(), async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video || video.source !== "telegram" || !video.telegramThumbFileId) {
      return res.status(404).end();
    }
    const fileUrl = await resolveTelegramFileUrl(video.telegramThumbFileId);
    const upstream = await fetch(fileUrl);
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.end(buf);
  } catch (e) {
    res.status(404).end();
  }
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

/* ---------- POST /api/videos/:id/like ---------- (toggle) */
router.post("/:id/like", verifyToken("student"), async (req, res) => {
  const video = await Video.findById(req.params.id);
  if (!video) return res.status(404).json({ error: "Video not found." });

  const email = req.user.email;
  const idx = video.likes.indexOf(email);
  if (idx >= 0) {
    video.likes.splice(idx, 1);
  } else {
    video.likes.push(email);
  }
  await video.save();
  res.json({ liked: idx < 0, likeCount: video.likes.length });
});

/* ---------- POST /api/videos ---------- (admin only, add a YouTube link) */
router.post("/", verifyToken("admin"), async (req, res) => {
  const { title, category, url } = req.body;
  const youtubeId = extractYouTubeId(url);
  if (!title || !category || !youtubeId) {
    return res.status(400).json({ error: "Title, category, and a valid YouTube URL/ID are required." });
  }
  const video = await Video.create({ title, category, source: "youtube", youtubeId, addedBy: req.user.username });
  res.status(201).json(shapeVideo(video, null));
});

/* ---------- POST /api/videos/upload ---------- (admin only, real video file -> Telegram storage) */
router.post("/upload", verifyToken("admin"), upload.single("file"), async (req, res) => {
  try {
    const { title, category } = req.body;
    if (!title || !category || !req.file) {
      return res.status(400).json({ error: "Title, category, and a video file are required." });
    }
    if (!req.file.mimetype.startsWith("video/")) {
      return res.status(400).json({ error: "Only video files are allowed." });
    }

    const { fileId, thumbFileId } = await uploadVideoToTelegram(req.file.buffer, req.file.originalname, req.file.mimetype);
    const video = await Video.create({
      title, category, source: "telegram", telegramFileId: fileId, telegramThumbFileId: thumbFileId, addedBy: req.user.username
    });
    res.status(201).json(shapeVideo(video, null));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Upload failed." });
  }
});

/* ---------- DELETE /api/videos/:id ---------- (admin only) */
router.delete("/:id", verifyToken("admin"), async (req, res) => {
  await Video.findByIdAndDelete(req.params.id);
  await Completion.deleteMany({ videoId: req.params.id });
  res.json({ message: "Deleted." });
});

module.exports = router;
