const mongoose = require("mongoose");

const videoSchema = new mongoose.Schema({
  title:      { type: String, required: true },
  category:   { type: String, required: true },
  youtubeId:  { type: String, required: true },
  addedBy:    { type: String, required: true },
}, { timestamps: true });

module.exports = mongoose.model("Video", videoSchema);
