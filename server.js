const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const Database = require("better-sqlite3");
const crypto = require("crypto");
const path = require("path");

if (!process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET) {
  console.error("Set ADMIN_PASSWORD and SESSION_SECRET environment variables before starting.");
  process.exit(1);
}

const app = express();
const db = new Database(process.env.DB_FILE || "premium-streamers.sqlite");
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS access_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inviter TEXT NOT NULL CHECK(inviter IN ('Elite','Dexil','Daniel')),
    code_hash TEXT NOT NULL UNIQUE,
    code_hint TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    twitch_url TEXT NOT NULL,
    reason TEXT NOT NULL,
    inviter TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pending'
      CHECK(status IN ('Pending','Approved','Rejected')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  name: "pss_admin",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 2 * 60 * 60 * 1000
  }
}));

const applyLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false });
const hashCode = code => crypto.createHash("sha256").update(code.trim()).digest("hex");

// Initial inviter codes are stored only as SHA-256 hashes, not plaintext.
const initialCodes = [
  { inviter: "Elite", hash: "7b79ce46bcd1919fd9d79f3429ac3e766fc8733bab1c50dbf663e907853c2f7b" },
  { inviter: "Dexil", hash: "3d5e554a8268b0baf4ff9d81eb9b77d81e3c3834350caca50c3833da49c6134e" },
  { inviter: "Daniel", hash: "dec1ab2f6d6e994cfe718666751e27a22a3c8c2e7c2708b995fb1e021197136e" }
];
const insertInitialCode = db.prepare(
  "INSERT OR IGNORE INTO access_codes (inviter, code_hash, code_hint, active) VALUES (?, ?, ?, 1)"
);
for (const item of initialCodes) {
  insertInitialCode.run(item.inviter, item.hash, item.hash.slice(-4));
}

const isAdmin = (req, res, next) => req.session && req.session.isAdmin
  ? next() : res.status(401).json({ error: "Please log in as admin." });

app.use(express.static(path.join(__dirname, "public")));

app.post("/api/apply", applyLimiter, (req, res) => {
  const { twitchUrl, reason, inviter, accessCode } = req.body || {};
  const allowedInviters = ["Elite", "Dexil", "Daniel"];
  if (!twitchUrl || !reason || !inviter || !accessCode) {
    return res.status(400).json({ error: "Please complete every field." });
  }
  if (!allowedInviters.includes(inviter)) {
    return res.status(400).json({ error: "Please select who granted you access." });
  }
  // Accept either a Twitch username or a full Twitch channel URL.
  const submittedChannel = String(twitchUrl).trim();
  const normalizedUrl = /^[a-zA-Z0-9_]{1,25}$/.test(submittedChannel)
    ? `https://www.twitch.tv/${submittedChannel}`
    : submittedChannel;
  let parsed;
  try { parsed = new URL(normalizedUrl); } catch { return res.status(400).json({ error: "Enter a Twitch username or a valid Twitch channel link." }); }
  if (!["twitch.tv", "www.twitch.tv"].includes(parsed.hostname.toLowerCase()) || !/^\/[a-zA-Z0-9_]{1,25}\/?$/.test(parsed.pathname)) {
    return res.status(400).json({ error: "Enter a Twitch username or a valid channel link, such as amber_dora." });
  }
  if (String(reason).trim().length < 10 || String(reason).length > 1500) {
    return res.status(400).json({ error: "Please explain why you want to join (at least 10 characters)." });
  }
  if (String(accessCode).length > 100) return res.status(400).json({ error: "Invalid access code. Please check your code and try again." });

  const match = db.prepare("SELECT id FROM access_codes WHERE inviter = ? AND code_hash = ? AND active = 1")
    .get(inviter, hashCode(String(accessCode)));
  if (!match) return res.status(403).json({ error: "Invalid access code for the selected inviter. Please check your code and try again." });

  const result = db.prepare("INSERT INTO applications (twitch_url, reason, inviter) VALUES (?, ?, ?)")
    .run(`https://www.twitch.tv/${parsed.pathname.replaceAll("/", "")}`, reason.trim(), inviter);
  res.json({ success: true, applicationId: result.lastInsertRowid, message: "Your application was submitted and is now pending review." });
});

app.post("/api/admin/login", loginLimiter, (req, res) => {
  const password = String((req.body || {}).password || "");
  const expected = Buffer.from(process.env.ADMIN_PASSWORD);
  const supplied = Buffer.from(password);
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) {
    return res.status(401).json({ error: "Incorrect admin password." });
  }
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: "Could not start admin session." });
    req.session.isAdmin = true;
    res.json({ success: true });
  });
});
app.post("/api/admin/logout", isAdmin, (req, res) => req.session.destroy(() => res.json({ success: true })));
app.get("/api/admin/me", (req, res) => res.json({ loggedIn: !!(req.session && req.session.isAdmin) }));

app.get("/api/admin/applications", isAdmin, (req, res) => {
  const rows = db.prepare("SELECT * FROM applications ORDER BY created_at DESC, id DESC").all();
  res.json(rows);
});
app.patch("/api/admin/applications/:id", isAdmin, (req, res) => {
  const status = String((req.body || {}).status || "");
  if (!["Pending", "Approved", "Rejected"].includes(status)) return res.status(400).json({ error: "Invalid status." });
  const result = db.prepare("UPDATE applications SET status = ? WHERE id = ?").run(status, Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: "Application not found." });
  res.json({ success: true });
});
app.get("/api/admin/codes", isAdmin, (req, res) => {
  res.json(db.prepare("SELECT id, inviter, code_hint, active, created_at FROM access_codes ORDER BY id DESC").all());
});
app.post("/api/admin/codes", isAdmin, (req, res) => {
  const { inviter, code } = req.body || {};
  if (!["Elite", "Dexil", "Daniel"].includes(inviter)) return res.status(400).json({ error: "Choose Elite, Dexil or Daniel." });
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(String(code || ""))) return res.status(400).json({ error: "Code must be 4–40 characters using letters, numbers, _ or -." });
  try {
    db.prepare("INSERT INTO access_codes (inviter, code_hash, code_hint) VALUES (?, ?, ?)")
      .run(inviter, hashCode(code), String(code).slice(-4));
    res.json({ success: true, message: `A new code for ${inviter} was created. Copy it somewhere safe; it will not be shown again.` });
  } catch {
    res.status(409).json({ error: "That code already exists. Create a different one." });
  }
});
app.patch("/api/admin/codes/:id", isAdmin, (req, res) => {
  const active = Number((req.body || {}).active);
  if (![0, 1].includes(active)) return res.status(400).json({ error: "Invalid code state." });
  const result = db.prepare("UPDATE access_codes SET active = ? WHERE id = ?").run(active, Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: "Code not found." });
  res.json({ success: true });
});
app.delete("/api/admin/codes/:id", isAdmin, (req, res) => {
  const result = db.prepare("DELETE FROM access_codes WHERE id = ?").run(Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: "Code not found." });
  res.json({ success: true });
});

app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Premium Streamers Server running on port ${port}`));
