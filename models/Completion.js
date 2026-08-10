const mongoose = require("mongoose");

const completionSchema = new mongoose.Schema({
  email:   { type: String, required: true, lowercase: true, trim: true },
  videoId: { type: mongoose.Schema.Types.ObjectId, ref: "Video", required: true },
}, { timestamps: true });

completionSchema.index({ email: 1, videoId: 1 }, { unique: true });

module.exports = mongoose.model("Completion", completionSchema);
