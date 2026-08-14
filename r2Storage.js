/* Cloudflare R2 (S3-compatible object storage) as real video storage.
   Free tier: 10GB storage, and R2 charges NO egress/bandwidth fees at all -
   which is exactly what large video streaming needs.

   Key design point: the browser uploads/downloads DIRECTLY to/from R2 using
   short-lived presigned URLs that this server generates. The actual video
   bytes never pass through our Render server, so there's no risk of running
   out of memory or hitting a request timeout on a 1GB file. */

const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

function client() {
  return new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
    }
  });
}

function checkConfigured() {
  if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY || !process.env.R2_BUCKET_NAME) {
    throw new Error("Cloudflare R2 not configured (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME missing).");
  }
}

/* A presigned URL the admin's browser can PUT the raw video file to, directly. Expires in 15 min. */
async function getUploadUrl(key, contentType) {
  checkConfigured();
  const cmd = new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, ContentType: contentType });
  return getSignedUrl(client(), cmd, { expiresIn: 900 });
}

/* A presigned URL a student's <video> tag can stream from, directly. Expires in 1 hour. */
async function getDownloadUrl(key) {
  checkConfigured();
  const cmd = new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key });
  return getSignedUrl(client(), cmd, { expiresIn: 3600 });
}

async function deleteObject(key) {
  checkConfigured();
  const cmd = new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key });
  await client().send(cmd);
}

module.exports = { getUploadUrl, getDownloadUrl, deleteObject };
