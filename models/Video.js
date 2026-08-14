const mongoose = require("mongoose");

const videoSchema = new mongoose.Schema({
  title:      { type: String, required: true },
  category:   { type: String, required: true },
  source:     { type: String, enum: ["youtube", "telegram", "r2"], required: true },
  youtubeId:      { type: String }, // set when source === "youtube"
  telegramFileId: { type: String }, // set when source === "telegram" (legacy, kept for old uploads - max ~19MB)
  telegramThumbFileId: { type: String }, // auto-generated frame from Telegram, if available
  r2Key:      { type: String }, // set when source === "r2" - object key in the Cloudflare R2 bucket (supports up to 1GB)
  fileSizeBytes: { type: Number }, // set when source === "r2", for display purposes
  addedBy:    { type: String, required: true },
  likes:      { type: [String], default: [] }, // emails of students who liked it
}, { timestamps: true });

module.exports = mongoose.model("Video", videoSchema);
