# CAO Open Learning — Backend

Real backend for the CAO Open Learning frontend, with a passwordless flow:
**Email Sign-in (OTP) → Profile Form → Learning Portal → Videos.**

## What changed vs. the old client-only version
- No passwords anywhere in the student flow — sign-in is a 6-digit code emailed to you, hashed with bcrypt and expired after 10 minutes.
- Telegram bot token and EmailJS keys live in server `.env`, never shipped to the browser.
- Student and admin sessions use signed JWTs.
- OTP request/verify endpoints are rate-limited to slow down abuse.
- The Learning Portal is seeded with 4 real, working YouTube courses so it's not empty on first run.

## 1. Create a free MongoDB Atlas cluster
1. Go to https://www.mongodb.com/cloud/atlas/register and make a free account.
2. Create a free (M0) cluster.
3. Database Access → add a user with a password.
4. Network Access → allow access from anywhere (`0.0.0.0/0`) for now — fine for a college project.
5. Connect → Drivers → copy the connection string, looks like:
   `mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/`

## 2. Set up your `.env`
```
cp .env.example .env
```
Fill in:
- `MONGODB_URI` — from step 1
- `JWT_SECRET` — any long random string (e.g. generate with `openssl rand -hex 32`)
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_ADMIN_CHAT_IDS` — from BotFather
- `EMAILJS_SERVICE_ID` / `EMAILJS_OTP_TEMPLATE_ID` / `EMAILJS_PUBLIC_KEY` / `EMAILJS_PRIVATE_KEY` — from your EmailJS dashboard (Account → API Keys for the private key)
- `SEED_ADMIN_ACCOUNTS` — set real usernames/passwords, format `user:pass,user:pass` (admins still log in with username+password, only students use OTP)
- `ALLOWED_ORIGINS` — the URL(s) your frontend will be hosted at

Your EmailJS OTP template must contain these variables: `{{to_email}}`, `{{otp_code}}`,
`{{expires_in}}`, with `{{to_email}}` set as the template's "To email" field. Something like:

> Subject: Your CAO Open Learning sign-in code
> Body: Your code is **{{otp_code}}**. It expires in {{expires_in}}.

## 3. Install & seed
```
npm install
npm run seed     # creates hashed admin accounts + 4 real sample videos
```

## 4. Run locally
```
npm start
```
Server runs on `http://localhost:4000` (or whatever `PORT` you set).

## 5. Deploy for real
Render.com (free tier) is the easiest fit since this needs a persistent server, not
a stateless serverless function:
1. Push this `cao-backend` folder to a GitHub repo.
2. On render.com → New → Web Service → connect the repo.
3. Build command: `npm install`, Start command: `npm start`.
4. Add all the same `.env` variables under Render's Environment tab.
5. After first deploy, run `npm run seed` once via Render's Shell tab.
6. Copy your Render URL (e.g. `https://cao-backend.onrender.com`).

## 6. Point the frontend at it
In `index.html`, set:
```js
const API_BASE = "https://cao-backend.onrender.com/api";
```
Then host `index.html` on GitHub Pages or Vercel as before.

## Flow
1. **Email Sign-in** — student enters email → gets a 6-digit code → enters it → gets a session (JWT).
2. **Profile Form** — first-time sign-in prompts for college/address/phone/etc. Submitting notifies admins on Telegram.
3. **Learning Portal** — unlocked once signed in and profile is complete.
4. **Videos** — search, filter by category, watch, like, share, mark completed — YouTube links or real uploaded files.

## Video storage: YouTube links + real uploads via Telegram

Admins can add videos two ways:
- **YouTube link** — same as before, just paste a URL.
- **Upload a real video file** — the server sends it to a private Telegram channel your bot
  is admin of, and streams it back to students on demand through your own server (so the
  bot token never reaches the browser). Max 45MB per file (Telegram bot API's upload limit).

### Set up the storage channel
1. In Telegram, create a **private channel** (not a group) — e.g. "CAO Video Storage".
2. Add your bot as an **admin** of that channel (Channel settings → Administrators → Add Admin → search your bot).
3. Send any message in the channel, then forward it to **@RawDataBot** — it'll reply with
   JSON containing a `"chat":{"id": -1001234567890, ...}` field. That number is your chat ID.
4. Set `TELEGRAM_STORAGE_CHAT_ID` in `.env` to that number (it's negative, keep the `-`).

Students never see this channel — it's just cold storage. Their view is the Learning Portal streaming endpoint.

## Likes & sharing
- Students can like/unlike any video (heart icon, both on the card and inside the player).
- Share button uses the native share sheet on mobile, or copies a deep link
  (`yoursite.com/?video=<id>`) to the clipboard on desktop. Opening that link while signed in
  jumps straight to that video.

## Notes
- Render's free tier sleeps after inactivity — first request after idle takes ~30s to wake up.
- Rotate `JWT_SECRET`, admin passwords, and the Telegram bot token before sharing this
  publicly if they were ever exposed in the old client-only version.
- OTPs are single-use and expire in 10 minutes; a wrong code 5 times in a row locks that
  code out until a new one is requested.

