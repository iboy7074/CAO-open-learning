const express = require("express");
const multer = require("multer");
const Video = require("../models/Video");
const Completion = require("../models/Completion");
const { verifyToken } = require("../middleware/auth");
const { uploadVideoToTelegram, resolveTelegramFileUrl } = require("../telegramStorage");
const { getUploadUrl, getDownloadUrl, deleteObject } = require("../r2Storage");

const router = express.Router();

// Legacy path only - small clips still uploaded the old way stay playable.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 19 * 1024 * 1024 } // 19MB, safely under Telegram's 20MB bot download cap
});

const MAX_R2_UPLOAD_BYTES = 1024 * 1024 * 1024; // 1GB

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
    fileSizeBytes: obj.fileSizeBytes,
    addedBy: obj.addedBy,
    createdAt: obj.createdAt,
    likeCount: (obj.likes || []).length,
    liked: viewerEmail ? (obj.likes || []).includes(viewerEmail) : false
    // telegramFileId / telegramThumbFileId / r2Key intentionally never sent to the client -
    // the stream/thumbnail/play routes handle those server-side
  };
}

/* ---------- GET /api/videos/public ---------- (no login needed — browse-only catalog for the homepage) */
router.get("/public", async (req, res) => {
  const videos = await Video.find().sort({ createdAt: -1 });
  res.json(videos.map(v => shapeVideo(v, null)));
});

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

/* =====================================================================
   REAL FILE UPLOADS (up to 1GB) via Cloudflare R2 - direct browser-to-bucket
   ===================================================================== */

/* ---------- POST /api/videos/upload-url ---------- (admin only, step 1: get a presigned PUT URL) */
router.post("/upload-url", verifyToken("admin"), async (req, res) => {
  try {
    const { filename, contentType, fileSizeBytes } = req.body;
    if (!filename || !contentType) return res.status(400).json({ error: "filename and contentType are required." });
    if (!contentType.startsWith("video/")) return res.status(400).json({ error: "Only video files are allowed." });
    if (fileSizeBytes && fileSizeBytes > MAX_R2_UPLOAD_BYTES) {
      return res.status(413).json({ error: "Video is too large. Max 1GB." });
    }

    const safeName = String(filename).replace(/[^a-zA-Z0-9_.-]/g, "_");
    const key = `videos/${Date.now()}-${safeName}`;
    const uploadUrl = await getUploadUrl(key, contentType);
    res.json({ uploadUrl, key });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Could not prepare upload." });
  }
});

/* ---------- POST /api/videos/confirm-upload ---------- (admin only, step 3: save metadata after the direct upload finished) */
router.post("/confirm-upload", verifyToken("admin"), async (req, res) => {
  try {
    const { title, category, key, fileSizeBytes } = req.body;
    if (!title || !category || !key) return res.status(400).json({ error: "title, category, and key are required." });

    const video = await Video.create({
      title, category, source: "r2", r2Key: key, fileSizeBytes, addedBy: req.user.username
    });
    res.status(201).json(shapeVideo(video, null));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not save video." });
  }
});

/* ---------- GET /api/videos/:id/play ---------- (student only, R2-hosted videos: get a temporary direct stream URL) */
router.get("/:id/play", verifyToken("student"), async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video || video.source !== "r2" || !video.r2Key) {
      return res.status(404).json({ error: "Video not found." });
    }
    const url = await getDownloadUrl(video.r2Key);
    res.json({ url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Could not load video." });
  }
});

/* =====================================================================
   LEGACY: small clips uploaded via the old Telegram-storage path (<19MB)
   ===================================================================== */

/* ---------- GET /api/videos/:id/stream ---------- (student only, Telegram-hosted videos) */
router.get("/:id/stream", verifyToken("student"), async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video || video.source !== "telegram" || !video.telegramFileId) {
      return res.status(404).json({ error: "Video not found." });
    }

    let fileUrl;
    try {
      fileUrl = await resolveTelegramFileUrl(video.telegramFileId);
    } catch (e) {
      console.error("resolveTelegramFileUrl failed:", e.message);
      return res.status(502).json({ error: "This video can't be streamed (likely too large for Telegram's bot download limit)." });
    }

    const range = req.headers.range;
    const upstream = await fetch(fileUrl, range ? { headers: { Range: range } } : {});

    if (!upstream.ok && upstream.status !== 206) {
      return res.status(502).json({ error: "Telegram couldn't serve this file (status " + upstream.status + ")." });
    }

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

/* ---------- GET /api/videos/:id/thumbnail ---------- (public - just a preview frame, Telegram uploads only) */
router.get("/:id/thumbnail", async (req, res) => {
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

/* ---------- POST /api/videos/upload ---------- (admin only, legacy small-clip path -> Telegram) */
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

/* =====================================================================
   SHARED
   ===================================================================== */

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

/* ---------- DELETE /api/videos/:id ---------- (admin only) */
router.delete("/:id", verifyToken("admin"), async (req, res) => {
  const video = await Video.findById(req.params.id);
  if (video && video.source === "r2" && video.r2Key) {
    try { await deleteObject(video.r2Key); } catch (e) { console.error("R2 delete failed:", e.message); }
  }
  await Video.findByIdAndDelete(req.params.id);
  await Completion.deleteMany({ videoId: req.params.id });
  res.json({ message: "Deleted." });
});

module.exports = router;
