/* Uses your existing Telegram bot as free video storage.
   Videos are sent to a private chat/channel (TELEGRAM_STORAGE_CHAT_ID),
   Telegram gives back a file_id, and we stream the bytes back through
   our own server whenever a student watches it (so the bot token never
   reaches the browser and links never "expire" from the student's view). */

const BOT_TOKEN = () => process.env.TELEGRAM_BOT_TOKEN;
const STORAGE_CHAT_ID = () => process.env.TELEGRAM_STORAGE_CHAT_ID;

/* Upload a video buffer to Telegram, return { fileId, thumbFileId, messageId } */
async function uploadVideoToTelegram(buffer, filename, mimetype) {
  if (!BOT_TOKEN() || !STORAGE_CHAT_ID()) {
    throw new Error("Telegram storage not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_STORAGE_CHAT_ID missing).");
  }

  const form = new FormData();
  form.append("chat_id", STORAGE_CHAT_ID());
  form.append("video", new Blob([buffer], { type: mimetype || "video/mp4" }), filename || "video.mp4");
  form.append("supports_streaming", "true");

  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN()}/sendVideo`, {
    method: "POST",
    body: form
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error("Telegram upload failed: " + (data.description || "unknown error"));
  }

  const video = data.result.video || data.result.document;
  const thumb = video.thumbnail || video.thumb; // Telegram auto-generates a frame as the thumbnail
  return { fileId: video.file_id, thumbFileId: thumb ? thumb.file_id : null, messageId: data.result.message_id };
}

/* Resolve a Telegram file_id to a temporary direct download URL */
async function resolveTelegramFileUrl(fileId) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN()}/getFile?file_id=${fileId}`);
  const data = await res.json();
  if (!data.ok) {
    throw new Error("Telegram getFile failed: " + (data.description || "unknown error"));
  }
  return `https://api.telegram.org/file/bot${BOT_TOKEN()}/${data.result.file_path}`;
}

module.exports = { uploadVideoToTelegram, resolveTelegramFileUrl };
