/* Run with: npm run seed
   Creates admin accounts (hashed) from SEED_ADMIN_ACCOUNTS in .env,
   and seeds a handful of real, working educational YouTube videos
   so the Learning Portal isn't empty on first launch. */
require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const Admin = require("./models/Admin");
const Video = require("./models/Video");

const SAMPLE_VIDEOS = [
  { title: "Learn Python - Full Course for Beginners", category: "Tech", source: "youtube", youtubeId: "rfscVS0vtbw" },
  { title: "Cyber Security Full Course for Beginners", category: "Cybersecurity", source: "youtube", youtubeId: "U_P23SqJaDc" },
  { title: "Getting Started with Figma: 1-Hour UI Design Course", category: "Design", source: "youtube", youtubeId: "nq19w0d5o0U" },
  { title: "The Foundations of Entrepreneurship - Full Course", category: "Business", source: "youtube", youtubeId: "UEngvxZ11sw" }
];

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB for seeding...");

  const adminPairs = (process.env.SEED_ADMIN_ACCOUNTS || "").split(",").map(s => s.trim()).filter(Boolean);
  for (const pair of adminPairs) {
    const [username, password] = pair.split(":");
    if (!username || !password) continue;
    const existing = await Admin.findOne({ username });
    if (existing) { console.log(`Admin '${username}' already exists, skipping.`); continue; }
    const passwordHash = await bcrypt.hash(password, 10);
    await Admin.create({ username, passwordHash });
    console.log(`✅ Created admin: ${username}`);
  }

  const videoCount = await Video.countDocuments();
  if (videoCount === 0) {
    for (const v of SAMPLE_VIDEOS) {
      await Video.create({ ...v, addedBy: "seed-script" });
    }
    console.log(`✅ Seeded ${SAMPLE_VIDEOS.length} sample videos.`);
  } else {
    console.log("Videos already exist, skipping video seed.");
  }

  console.log("Done.");
  process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });
