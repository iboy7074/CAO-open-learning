/* All secrets used here come from process.env - never sent to the browser. */

function buildTelegramMessage(d) {
  return `🔔 NEW STUDENT PROFILE
━━━━━━━━━━━━━━━━━━━━━━━
👤 USER NAME  : ${d.username}
📧 EMAIL      : ${d.email}
🎂 AGE        : ${d.age}
🎓 COLLEGE    : ${d.college}
📍 PLACE      : ${d.place}
🏢 DISTRICT   : ${d.district}
🗺 STATE      : ${d.state}
🌍 COUNTRY    : ${d.country}
🏠 ADDRESS    : ${d.address}
📞 PHONE NO   : ${d.phone}
❤️ PASSION    : ${d.passion}
━━━━━━━━━━━━━━━━━━━━━━━
🕐 TIME       : ${new Date().toLocaleString("en-GB", { timeZone: "Asia/Kolkata" })}`;
}

async function notifyAdminsOnTelegram(d) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = (process.env.TELEGRAM_ADMIN_CHAT_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
  if (!token || !chatIds.length) return ["⚠ Telegram not configured"];

  const results = [];
  for (const chatId of chatIds) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: buildTelegramMessage(d) })
      });
      const j = await res.json();
      results.push(j.ok ? `✅ ${chatId}` : `❌ ${chatId}: ${j.description}`);
    } catch (e) {
      results.push(`❌ ${chatId}: network error`);
    }
  }
  return results;
}

/* Sends a one-time sign-in code to the user's email using EmailJS's REST API.
   This runs on the server, so the EmailJS private key never reaches the browser. */
async function emailOtpToUser({ email, otp }) {
  const serviceId = process.env.EMAILJS_SERVICE_ID;
  const templateId = process.env.EMAILJS_OTP_TEMPLATE_ID;
  const publicKey = process.env.EMAILJS_PUBLIC_KEY;
  const privateKey = process.env.EMAILJS_PRIVATE_KEY;

  if (!serviceId || !templateId || !publicKey) {
    return "⚠ EmailJS not configured - OTP not emailed";
  }

  try {
    const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: serviceId,
        template_id: templateId,
        user_id: publicKey,
        accessToken: privateKey || undefined,
        template_params: {
          to_email: email,
          otp_code: otp,
          expires_in: "10 minutes"
        }
      })
    });
    if (!res.ok) {
      const text = await res.text();
      return `❌ Email failed: ${text}`;
    }
    return `✅ Code sent to ${email}`;
  } catch (e) {
    return `❌ Email failed: ${e.message}`;
  }
}

module.exports = { notifyAdminsOnTelegram, emailOtpToUser };
