const mongoose = require("mongoose");

const profileSchema = new mongoose.Schema({
  email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
  username: { type: String, required: true, trim: true },
  age:      { type: String, required: true },
  college:  { type: String, required: true },
  place:    { type: String, required: true },
  district: { type: String, required: true },
  state:    { type: String, required: true },
  country:  { type: String, required: true },
  address:  { type: String, required: true },
  phone:    { type: String, required: true },
  passion:  { type: String, required: true },
}, { timestamps: true });

module.exports = mongoose.model("Profile", profileSchema);
