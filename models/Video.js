const mongoose = require("mongoose");

const videoSchema = new mongoose.Schema({
  title:      { type: String, required: true },
  category:   { type: String, required: true },
  source:     { type: String, enum: ["youtube", "telegram"], required: true },
  youtubeId:      { type: String }, // set when source === "youtube"
  telegramFileId: { type: String }, // set when source === "telegram"
  addedBy:    { type: String, required: true },
  likes:      { type: [String], default: [] }, // emails of students who liked it
}, { timestamps: true });

module.exports = mongoose.model("Video", videoSchema);
