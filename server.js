
const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const https = require("https");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = String(process.env.ADMIN_PASSWORD || "").trim();
const SESSION_SECRET = String(process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"));

const FACEBOOK_URL =
  "https://www.facebook.com/share/1JHonUUaCA/?mibextid=wwXIfr";
const ZALO_URL = "https://zalo.me/0818249250";
const TIKTOK_URL =
  "https://www.tiktok.com/@huyftsupport?_r=1&_t=ZS-94olc9q74ba";

const FF_URL = process.env.FF_URL || "https://ff.garena.com/vn/";
const FF_MAX_URL = process.env.FF_MAX_URL || "https://ff.garena.com/vn/";
const FF_ANDROID_PACKAGE =
  process.env.FF_ANDROID_PACKAGE || "com.dts.freefireth";
const FFMAX_ANDROID_PACKAGE =
  process.env.FFMAX_ANDROID_PACKAGE || "com.dts.freefiremax";
const FF_IOS_SCHEME = process.env.FF_IOS_SCHEME || "freefire://";
const FFMAX_IOS_SCHEME = process.env.FFMAX_IOS_SCHEME || "freefiremax://";
const FF_IOS_APPID = process.env.FF_IOS_APPID || "1300146617";
const FFMAX_IOS_APPID = process.env.FFMAX_IOS_APPID || "1480516829";

const STORE_PATH = path.join(__dirname, "keys.json");
const LOGO_PATH = path.join(__dirname, "logo.png");
const rateMap = new Map();

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const GITHUB_REPO = process.env.GITHUB_REPO || "";
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";
const GITHUB_DATA_PATH = process.env.GITHUB_DATA_PATH || "keys.json";
const ADMIN_ROUTE = String(process.env.ADMIN_ROUTE || "nhimne").replace(/^\/+|\/+$/g, "") || "nhimne";

let keys = {};
let storeReady = false;
let saveQueue = Promise.resolve();

function loadLocalStore() {
  try {
    if (!fs.existsSync(STORE_PATH)) return {};
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveLocalStore() {
  fs.writeFileSync(STORE_PATH, JSON.stringify(keys, null, 2), "utf8");
}

function hasGithubStore() {
  return Boolean(GITHUB_TOKEN && GITHUB_REPO && GITHUB_DATA_PATH);
}

function getStoreMode() {
  return hasGithubStore() ? "github" : "local";
}

function githubRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.github.com",
        path: apiPath,
        method,
        timeout: 10000,
        headers: {
          "User-Agent": "aimtrickhead-panel",
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json"
        }
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          let parsed = {};
          try {
            parsed = JSON.parse(data || "{}");
          } catch {
            parsed = {};
          }

          if (res.statusCode >= 200 && res.statusCode < 300) {
            return resolve(parsed);
          }

          const err = new Error(parsed.message || `GitHub ${res.statusCode}`);
          err.statusCode = res.statusCode;
          err.payload = parsed;
          reject(err);
        });
      }
    );

    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("GitHub request timeout")));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function readGithubStore() {
  const apiPath = `/repos/${encodeURIComponent(
    GITHUB_REPO.split("/")[0]
  )}/${encodeURIComponent(GITHUB_REPO.split("/")[1])}/contents/${GITHUB_DATA_PATH
    .split("/")
    .map(encodeURIComponent)
    .join("/")}?ref=${encodeURIComponent(GITHUB_BRANCH)}`;

  try {
    const file = await githubRequest("GET", apiPath);
    const content = Buffer.from(file.content || "", "base64").toString("utf8");
    const parsed = JSON.parse(content || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    if (err.statusCode === 404) {
      const empty = {};
      await writeGithubStore(empty);
      return empty;
    }
    throw err;
  }
}

async function writeGithubStore(store) {
  const apiPath = `/repos/${encodeURIComponent(
    GITHUB_REPO.split("/")[0]
  )}/${encodeURIComponent(GITHUB_REPO.split("/")[1])}/contents/${GITHUB_DATA_PATH
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;

  let sha = undefined;
  try {
    const existing = await githubRequest(
      "GET",
      `${apiPath}?ref=${encodeURIComponent(GITHUB_BRANCH)}`
    );
    sha = existing.sha;
  } catch (err) {
    if (err.statusCode !== 404) throw err;
  }

  const body = {
    message: "DANG cập nhật key",
    content: Buffer.from(JSON.stringify(store, null, 2), "utf8").toString("base64"),
    branch: GITHUB_BRANCH
  };
  if (sha) body.sha = sha;

  await githubRequest("PUT", apiPath, body);
}

function normalizeKeyItem(item) {
  if (!item || typeof item !== "object") return null;

  if (!Array.isArray(item.devices)) item.devices = [];
  if (item.device && !item.devices.includes(item.device)) item.devices.push(item.device);

  if (typeof item.usesLeft !== "number") {
    if (typeof item.uses === "number") item.usesLeft = Number(item.uses || 0);
    else item.usesLeft = 0;
  }

  if (typeof item.totalDevices !== "number") {
    item.totalDevices = Math.max(
      item.devices.length,
      item.devices.length + Number(item.usesLeft || 0)
    );
  }

  item.usesLeft = Math.max(0, Number(item.usesLeft || 0));
  item.totalDevices = Math.max(item.devices.length, Number(item.totalDevices || 0));
  item.expireAt = Number(item.expireAt || 0);
  item.createdAt = Number(item.createdAt || Date.now());

  delete item.device;
  delete item.uses;

  return item;
}

function normalizeAllStore(store) {
  const out = {};
  Object.keys(store || {}).forEach((k) => {
    const normalized = normalizeKeyItem(store[k]);
    if (normalized) out[k] = normalized;
  });
  return out;
}

async function initStore() {
  try {
    if (hasGithubStore()) {
      keys = normalizeAllStore(await readGithubStore());
      console.log("Store ready: GitHub");
    } else {
      keys = normalizeAllStore(loadLocalStore());
      saveLocalStore();
      console.log("Store ready: local file");
    }
  } catch (err) {
    console.error("Store init failed, fallback local:", err.message);
    keys = normalizeAllStore(loadLocalStore());
    saveLocalStore();
  }
  storeReady = true;
}

async function persistStoreSnapshot(snapshot) {
  try {
    if (hasGithubStore()) {
      await writeGithubStore(snapshot);
    } else {
      fs.writeFileSync(STORE_PATH, JSON.stringify(snapshot, null, 2), "utf8");
    }
  } catch (err) {
    console.error("Persist snapshot failed:", err.message);
    fs.writeFileSync(STORE_PATH, JSON.stringify(snapshot, null, 2), "utf8");
  }
}

async function saveStore(options = {}) {
  const background = !!options.background;
  keys = normalizeAllStore(keys);
  const snapshot = JSON.parse(JSON.stringify(keys));
  saveQueue = saveQueue
    .then(() => persistStoreSnapshot(snapshot))
    .catch((err) => {
      console.error("Save store queue failed:", err.message);
    });
  if (!background) return saveQueue;
  return Promise.resolve();
}

app.use((req, res, next) => {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.use((req, res, next) => {
  if (!storeReady && !req.path.startsWith("/healthz")) {
    return res.status(503).json({ ok: false, msg: "Store đang khởi động" });
  }
  next();
});

app.use((req, res, next) => {
  const ip =
    (req.headers["x-forwarded-for"] || "")
      .toString()
      .split(",")[0]
      .trim() || req.socket.remoteAddress || "unknown";

  const pathKey = req.path || "/";
  const now = Date.now();
  const limitMap = {
    "/api/check": { windowMs: 60000, limit: 12 },
    "/api/status": { windowMs: 25000, limit: 30 },
    "/api/create": { windowMs: 60000, limit: 20 },
    "/api/delete": { windowMs: 60000, limit: 20 },
    "/api/list": { windowMs: 30000, limit: 40 }
  };
  const activeRule = limitMap[pathKey] || { windowMs: 15000, limit: 90 };
  const bucketKey = ip + "::" + pathKey;

  if (!rateMap.has(bucketKey)) rateMap.set(bucketKey, []);
  const arr = rateMap.get(bucketKey).filter((t) => now - t < activeRule.windowMs);
  arr.push(now);
  rateMap.set(bucketKey, arr);

  if (Math.random() < 0.02) {
    for (const [k, values] of rateMap.entries()) {
      const filtered = values.filter((t) => now - t < 120000);
      if (filtered.length) rateMap.set(k, filtered);
      else rateMap.delete(k);
    }
  }

  if (arr.length > activeRule.limit) {
    return res.status(429).json({ ok: false, msg: "Thao tác quá nhanh, chờ xíu rồi thử lại" });
  }

  next();
});

function isAdmin(req) {
  const adminKey = String(req.headers["x-admin-key"] || "").trim();
  return !!ADMIN_KEY && adminKey === ADMIN_KEY;
}

function genKey() {
  const a = Math.random().toString(36).slice(2, 6).toUpperCase();
  const b = Math.random().toString(36).slice(2, 6).toUpperCase();
  return "ATH-" + a + "-" + b;
}

function formatVNTime(ms) {
  return new Date(ms).toLocaleString("vi-VN");
}

function signText(text) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(text).digest("hex");
}

function createSessionToken(key, device, expireAt) {
  const issuedAt = Date.now();
  const payload = `${key}|${device}|${expireAt}|${issuedAt}`;
  const sig = signText(payload);
  return Buffer.from(`${payload}|${sig}`, "utf8").toString("base64url");
}

function verifySessionToken(token) {
  try {
    const raw = Buffer.from(token, "base64url").toString("utf8");
    const parts = raw.split("|");
    if (parts.length !== 5) return null;

    const key = parts[0];
    const device = parts[1];
    const expireAt = parts[2];
    const issuedAt = parts[3];
    const sig = parts[4];

    const payload = `${key}|${device}|${expireAt}|${issuedAt}`;
    if (sig !== signText(payload)) return null;

    return {
      key,
      device,
      expireAt: Number(expireAt),
      issuedAt: Number(issuedAt)
    };
  } catch {
    return null;
  }
}

function renderLogo(size, radius) {
  const r = radius || Math.round(size * 0.28);
  if (fs.existsSync(LOGO_PATH)) {
    return `<img src="/logo.png" alt="AimTrickHead Logo" style="width:${size}px;height:${size}px;object-fit:cover;display:block;border-radius:${r}px">`;
  }
  return `<div style="width:${size}px;height:${size}px;border-radius:${r}px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#8c52ff,#ff70c7);font-size:${Math.round(size * 0.4)}px;color:#fff">⚡</div>`;
}

function iconFacebook() {
  return `<img src="https://upload.wikimedia.org/wikipedia/commons/5/51/Facebook_f_logo_%282019%29.svg" alt="Facebook" style="width:18px;height:18px;display:block;border-radius:999px">`;
}

function iconZalo() {
  return `<img src="https://upload.wikimedia.org/wikipedia/commons/9/91/Icon_of_Zalo.svg" alt="Zalo" style="width:20px;height:20px;display:block;border-radius:6px">`;
}

function baseStyles() {
  return `
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Alata&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
    html{
      -webkit-text-size-adjust:100%;touch-action:manipulation;
      width:100%;height:100%;min-height:100%;overflow:hidden;overscroll-behavior:none;
      overscroll-behavior-y:none;background:#08090c;position:fixed;inset:0;
    }
    :root{
      --line:rgba(255,255,255,.09);
      --violet:#e7dcff;
      --violet2:#c8b2ff;
      --pink:#8f6cff;
      --muted:#b7adca;
      --ok:#c5e8d2;
      --err:#ffb0c4;
      --gold:#e4cd97;
      --glass:rgba(10,11,14,.92);
      --glass2:rgba(255,255,255,.018);
      --panelEdge:rgba(255,255,255,.07);
      --panelSoft:rgba(255,255,255,.018);
      --shadow:0 36px 120px rgba(0,0,0,.58);
    }
    *{font-family:"Alata", Arial, sans-serif}
    body{
      margin:0;width:100%;height:100%;min-height:100%;color:#fff;overflow:hidden;
      position:fixed;inset:0;overscroll-behavior:none;overscroll-behavior-y:none;isolation:isolate;
      -webkit-overflow-scrolling:auto;background-color:#08090c;
      contain:strict;
      background:
        radial-gradient(circle at 14% 10%, rgba(212,198,160,.07), transparent 24%),
        radial-gradient(circle at 86% 16%, rgba(120,122,132,.045), transparent 22%),
        radial-gradient(circle at 50% 100%, rgba(88,84,70,.09), transparent 32%),
        linear-gradient(160deg,#06070a,#0d0f13,#090b10);
    }
    body:before{
      content:"";position:fixed;inset:0;pointer-events:none;opacity:.22;
      background:linear-gradient(transparent, rgba(255,255,255,.03), transparent);
      background-size:100% 5px;animation:scan 9s linear infinite;
    }
    body:after{
      content:"";position:fixed;inset:-15%;pointer-events:none;opacity:.22;
      background:
        radial-gradient(circle at 20% 20%, rgba(255,255,255,.06) 1px, transparent 1.5px),
        radial-gradient(circle at 80% 70%, rgba(255,255,255,.05) 1px, transparent 1.6px);
      background-size:22px 22px, 28px 28px;
      animation:moveDots 22s linear infinite;
    }
    .bgAura{
      position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:0;
    }
    .orb{
      position:absolute;border-radius:50%;filter:blur(18px);opacity:.26;animation:floatOrb 16s ease-in-out infinite;
    }
    .orb.o1{width:180px;height:180px;left:-40px;top:12%;background:rgba(205,186,138,.12)}
    .orb.o2{width:220px;height:220px;right:-60px;top:30%;background:rgba(136,140,152,.10);animation-delay:-6s}
    .orb.o3{width:200px;height:200px;left:30%;bottom:-90px;background:rgba(170,148,102,.08);animation-delay:-10s}
    @keyframes scan{from{transform:translateY(-100%)}to{transform:translateY(100%)}}
    @keyframes moveDots{from{transform:translateY(0)}to{transform:translateY(80px)}}
    @keyframes glow{
      0%{box-shadow:0 0 18px rgba(209,187,138,.10),0 0 36px rgba(255,255,255,.025)}
      50%{box-shadow:0 0 34px rgba(209,187,138,.16),0 0 68px rgba(255,255,255,.045)}
      100%{box-shadow:0 0 18px rgba(209,187,138,.10),0 0 36px rgba(255,255,255,.025)}
    }
    @keyframes pulseText{
      0%{text-shadow:0 0 10px rgba(209,187,138,.12)}
      50%{text-shadow:0 0 18px rgba(255,255,255,.10)}
      100%{text-shadow:0 0 10px rgba(209,187,138,.12)}
    }
    @keyframes neonBar{
      0%{background-position:0% 50%}
      100%{background-position:200% 50%}
    }
    @keyframes popIn{
      0%{opacity:0;transform:scale(.96)}
      100%{opacity:1;transform:scale(1)}
    }
    @keyframes floatOrb{
      0%,100%{transform:translate3d(0,0,0)}
      50%{transform:translate3d(18px,-24px,0)}
    }
    .wrap{
      position:relative;z-index:1;
      width:100%;height:100vh;height:100dvh;min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;
      padding:max(12px,env(safe-area-inset-top)) max(12px,env(safe-area-inset-right)) max(12px,env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left));
      overflow:hidden;background:transparent;
    }
    .card{
      width:min(94vw,560px);height:min(calc(100dvh - 12px),980px);max-height:calc(100dvh - 12px);overflow:auto;
      contain:layout paint style;
      border-radius:32px;background:linear-gradient(180deg, rgba(15,16,19,.94), rgba(8,9,12,.96));
      border:1px solid var(--panelEdge);animation:glow 10s infinite;
      backdrop-filter:blur(20px) saturate(1.01);
      box-shadow:var(--shadow), inset 0 1px 0 rgba(255,255,255,.04), inset 0 -1px 0 rgba(255,255,255,.02);
      overscroll-behavior:contain;-webkit-overflow-scrolling:touch;
      position:relative;
    }
    .card::-webkit-scrollbar{width:0;height:0}
    .top{
      padding:18px 18px 15px;border-bottom:1px solid rgba(255,255,255,.05);
      position:sticky;top:0;z-index:8;overflow:hidden;backdrop-filter:blur(20px) saturate(120%);
      background:linear-gradient(180deg,rgba(14,15,18,.985),rgba(14,15,18,.90))
    }
    .top::before{
      content:"";position:absolute;inset:auto -10% -60% auto;width:280px;height:280px;
      background:radial-gradient(circle, rgba(168,132,255,.14), transparent 65%);
      pointer-events:none
    }
    .top::after{
      content:"";position:absolute;left:-20%;top:-1px;width:140%;height:4px;
      background:linear-gradient(90deg,transparent,rgba(255,255,255,.06),rgba(201,176,122,.22),transparent);
      background-size:200% 100%;animation:neonBar 4.8s linear infinite
    }
    .brand{display:flex;align-items:center;gap:14px}
    .logoBox{
      width:74px;height:74px;border-radius:22px;overflow:hidden;
      box-shadow:0 12px 36px rgba(0,0,0,.26), inset 0 1px 0 rgba(255,255,255,.05);flex:0 0 74px;
      background:rgba(255,255,255,.028)
    }
    .title{margin:0;font-size:clamp(23px,5vw,31px);color:var(--violet);letter-spacing:.45px;animation:pulseText 7s infinite;font-weight:700}
    .sub{margin:6px 0 0;color:var(--muted);font-size:13px}
    .credit{margin-top:10px;color:var(--gold);font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;opacity:.92}
    .content{padding:24px 18px 20px;flex:1;overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;scrollbar-width:none}
    .content::-webkit-scrollbar{width:0;height:0}
    .loginStrip{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px;position:relative;z-index:1}
    .loginStrip span,.statChip{border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);box-shadow:inset 0 1px 0 rgba(255,255,255,.06);}
    .loginStrip span{padding:7px 10px;border-radius:999px;font-size:11px;color:#e9e1d2;letter-spacing:.92px;text-transform:uppercase}
    .quickStats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:12px 0 14px}
    .statChip{padding:11px 12px;border-radius:18px;backdrop-filter:blur(10px)}
    .statLabel{display:block;font-size:11px;color:#beaed8;margin-bottom:4px}
    .statChip strong{font-size:14px;color:#fff}
    .loginHero{
      position:relative;
      padding:28px 0 8px;border-radius:0;
      background:transparent;
      border:none;
      overflow:visible;
      box-shadow:none;
      animation:popIn .45s ease;
      display:grid;gap:14px;
    }
    .loginHero:before{
      content:"";position:absolute;right:-40px;top:-40px;width:180px;height:180px;border-radius:50%;
      background:radial-gradient(circle, rgba(228,205,151,.10), transparent 70%);
      pointer-events:none;
    }
    .loginHero:after{
      content:"";position:absolute;left:-30px;bottom:-30px;width:180px;height:180px;border-radius:50%;
      background:radial-gradient(circle, rgba(166,130,255,.16), transparent 70%);
      pointer-events:none;
    }
    .loginIntro{position:relative;z-index:1;margin-bottom:20px}
    .loginTitle{font-size:24px;color:#fff;margin:0 0 6px;letter-spacing:.38px}
    .loginHint{margin:0;color:#cfc6db;font-size:13px;line-height:1.7;max-width:560px}
    .loginFrame{
      position:relative;padding:2px 0 0;
    }
    .loginFrame::before{
      content:"";position:absolute;left:0;right:0;top:-4px;height:1px;
      background:linear-gradient(90deg,transparent,rgba(255,255,255,.12),rgba(214,196,154,.28),transparent);
      opacity:.9;pointer-events:none
    }
    .loginFrame::after{
      content:"";position:absolute;left:0;right:0;bottom:-10px;height:1px;
      background:linear-gradient(90deg,transparent,rgba(255,255,255,.05),transparent);
      opacity:.8;pointer-events:none
    }
    .loginStrip{
      display:flex;gap:10px;flex-wrap:wrap;margin-top:4px
    }
    .loginChip{
      display:inline-flex;align-items:center;gap:8px;padding:10px 12px;border-radius:999px;
      background:linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.022));
      border:1px solid rgba(255,255,255,.08);font-size:12px;color:#f1ece3;
      box-shadow:inset 0 1px 0 rgba(255,255,255,.03), 0 8px 18px rgba(0,0,0,.10);
    }
    .input{
      width:100%;height:66px;border:none;outline:none;border-radius:20px;padding:0 18px;
      color:#fff;background:linear-gradient(180deg, rgba(255,255,255,.055), rgba(255,255,255,.022));border:1px solid rgba(255,255,255,.08);font-size:15px;
      box-shadow:inset 0 1px 0 rgba(255,255,255,.03), 0 16px 32px rgba(0,0,0,.12)
    }
    .input:focus{
      border-color:rgba(200,107,255,.52);box-shadow:0 0 0 3px rgba(200,107,255,.08)
    }
    .btn,.smallBtn,.tab,.gameBtn{
      border:none;color:#fff;cursor:pointer;font-weight:700;border-radius:16px
    }
    .btn{
      width:100%;height:62px;margin-top:16px;
      background:linear-gradient(90deg,#9f7cff,#e4cd97,#f4ecde);
      background-size:200% 100%;animation:neonBar 4.6s linear infinite;
      box-shadow:0 18px 36px rgba(0,0,0,.26)
    }
    .btn:hover,.gameBtn:hover,.smallBtn:hover{transform:translateY(-1px)}
    .smallBtn{
      height:38px;padding:0 12px;background:rgba(255,255,255,.08);border:1px solid var(--line)
    }
    .msg{min-height:22px;margin-top:12px;text-align:center;font-size:14px}
    .ok{color:var(--ok)}
    .err{color:var(--err)}
    .hidden{display:none!important}
    .topLine{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px}
    .pill{
      display:inline-flex;align-items:center;gap:8px;padding:10px 12px;border-radius:999px;
      background:linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.03));border:1px solid var(--line);font-size:12px;color:#efe5cf;box-shadow:inset 0 1px 0 rgba(255,255,255,.04)
    }
    .noticeBox{
      margin-top:12px;padding:13px 14px;border-radius:16px;background:linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.03));
      border:1px solid var(--line);font-size:13px;color:#efe7ff;line-height:1.6
    }
    .tabs{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:22px 0 18px}
    .tab{height:56px;border-radius:18px;border:1px solid var(--line);background:rgba(255,255,255,.05);font-size:14px;padding:0 10px}
    .tab.active{background:linear-gradient(90deg,#a684ff,#e4cd97,#f3ebdf)}
    .tabPane{display:none}
    .tabPane.active{display:block}
    .tile{
      padding:16px;border-radius:24px;margin-bottom:12px;
      background:linear-gradient(180deg, rgba(255,255,255,.040), rgba(255,255,255,.016));
      border:1px solid rgba(255,255,255,.065);position:relative;overflow:hidden;
      transition:transform .24s ease, box-shadow .24s ease, border-color .24s ease;
      box-shadow:inset 0 1px 0 rgba(255,255,255,.02)
    }
    .tile:hover{transform:translateY(-2px);box-shadow:0 18px 36px rgba(0,0,0,.20);border-color:rgba(201,176,122,.14)}
    .tile::before{
      content:"";position:absolute;width:140px;height:140px;right:-40px;bottom:-40px;
      background:radial-gradient(circle, rgba(201,176,122,.07), transparent 65%)
    }
    .row{display:flex;align-items:center;justify-content:space-between;gap:12px;position:relative;z-index:1}
    .name{margin:0;font-size:16px}
    .desc{margin:6px 0 0;color:#c1b9d4;font-size:12px;line-height:1.5}
    .switch{position:relative;width:58px;height:32px;flex:0 0 58px}
    .switch input{display:none}
    .slider{
      position:absolute;inset:0;border-radius:999px;background:rgba(255,255,255,.10);
      border:1px solid rgba(255,255,255,.08);transition:.25s;cursor:pointer
    }
    .slider:before{
      content:"";position:absolute;width:24px;height:24px;left:4px;top:3px;border-radius:50%;
      background:#fff;transition:.25s
    }
    .switch input:checked + .slider{
      background:linear-gradient(90deg,#7a818f,#d0b277);box-shadow:0 0 18px rgba(201,176,122,.18)
    }
    .switch input:checked + .slider:before{transform:translateX(25px)}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .socialBtn,.gameBtn{
      display:flex;align-items:center;justify-content:center;gap:10px;height:52px;border-radius:16px;
      text-decoration:none;color:#fff;background:rgba(255,255,255,.07);border:1px solid var(--line);font-weight:700
    }
    .gameBtn{
      background:linear-gradient(90deg,rgba(108,112,122,.24),rgba(201,176,122,.16));
      box-shadow:0 10px 22px rgba(183,124,255,.12)
    }
    .socialBtn:hover,.gameBtn:hover{box-shadow:0 0 18px rgba(201,176,122,.10)}
    .footer{margin-top:10px;text-align:center;font-size:12px;color:#b9b0c9;line-height:1.7}
    .liveFx{
      margin-top:14px;padding:44px 16px 16px;border-radius:24px;
      background:
        linear-gradient(180deg, rgba(7,12,24,.96), rgba(15,10,31,.90)),
        radial-gradient(circle at top right, rgba(97,180,255,.08), transparent 28%);
      border:1px solid rgba(160,132,255,.18);color:#f1e8ff;font-size:12px;min-height:148px;
      white-space:pre-wrap;line-height:1.7;position:relative;overflow:hidden;
      box-shadow:inset 0 0 0 1px rgba(255,255,255,.03), 0 18px 40px rgba(4,0,18,.28);
      font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;
    }
    .liveFx::before{
      content:"";position:absolute;inset:0;background:linear-gradient(180deg, transparent, rgba(255,255,255,.03), transparent);
      background-size:100% 90px;animation:scan 7s linear infinite;pointer-events:none;opacity:.46;
    }
    .liveFx::after{
      content:"";position:absolute;left:-20%;top:32px;width:60%;height:1px;background:linear-gradient(90deg, transparent, rgba(220,225,255,.58), transparent);
      box-shadow:0 0 18px rgba(220,225,255,.16);animation:neonBar 4.1s linear infinite;pointer-events:none;
    }
    .liveFxHud{
      position:absolute;left:14px;right:14px;top:10px;display:flex;align-items:center;justify-content:space-between;
      font-size:10px;color:#9bc6ff;letter-spacing:1px;text-transform:uppercase;opacity:.92
    }
    .hudDots{display:flex;gap:6px;align-items:center}
    .hudDots span{width:8px;height:8px;border-radius:50%;display:block;background:rgba(255,255,255,.16)}
    .hudDots span:nth-child(1){background:#c8c2d6;box-shadow:0 0 10px rgba(200,194,214,.28)}
    .hudDots span:nth-child(2){background:#d6c49a;box-shadow:0 0 10px rgba(214,196,154,.24)}
    .hudDots span:nth-child(3){background:#ece7d7;box-shadow:0 0 10px rgba(236,231,215,.20)}

    .liveFx.activePulse{
      border-color:rgba(123,221,255,.45);
      box-shadow:inset 0 0 0 1px rgba(255,255,255,.04), 0 0 0 1px rgba(122,206,255,.10), 0 18px 40px rgba(4,0,18,.32), 0 0 30px rgba(98,178,255,.16);
    }
    .fxLine{display:block;opacity:0;transform:translateY(6px);animation:fxLineIn .34s ease forwards}
    .fxCursor{
      display:inline-block;width:9px;height:15px;margin-left:6px;vertical-align:-2px;border-radius:2px;
      background:linear-gradient(180deg,#8ad0ff,#ffffff);box-shadow:0 0 10px rgba(138,208,255,.45);
      animation:blinkCursor .9s steps(1) infinite;
    }
    .fxLine.ok{color:#aef7d1}.fxLine.warn{color:#ffd98b}.fxLine.info{color:#b9e0ff}
    .fxLine:nth-child(2){animation-delay:.06s}
    .fxLine:nth-child(3){animation-delay:.12s}
    .fxLine:nth-child(4){animation-delay:.18s}
    .fxLine:nth-child(5){animation-delay:.24s}
    .fxLine:nth-child(6){animation-delay:.30s}
    .sliderWrap{margin-top:10px}
    .rangeLabel{
      display:flex;align-items:center;justify-content:space-between;font-size:12px;color:#e5dcf5;margin-bottom:8px
    }
    input[type=range]{width:100%;accent-color:#c86bff}
    .toast{
      position:fixed;left:50%;bottom:18px;transform:translateX(-50%) translateY(20px);
      min-width:220px;max-width:92vw;padding:14px 16px;border-radius:16px;background:rgba(12,15,24,.95);
      border:1px solid var(--line);color:#fff;text-align:center;z-index:120;opacity:0;pointer-events:none;
      transition:.25s
    }
    .toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
    .toast.ok{color:var(--ok)}
    .toast.err{color:var(--err)}
    .loadingLayer{
      position:fixed;inset:0;z-index:9999;
      display:flex;align-items:center;justify-content:center;flex-direction:column;
      background:
        radial-gradient(circle at center, rgba(170,90,255,.18), transparent 30%),
        linear-gradient(160deg,#030207,#0b0612,#05040b);
      transition:opacity .55s ease, visibility .55s ease;
    }
    .loadingLayer.hide{opacity:0;visibility:hidden}
    .loadingLogo{
      width:172px;height:172px;border-radius:28px;overflow:hidden;
      box-shadow:0 0 30px rgba(209,187,138,.16),0 0 70px rgba(255,111,216,.12);
      animation:glow 3s infinite, popIn .7s ease;
      background:rgba(255,255,255,.028);position:relative
    }
    .loadingLogo::after{
      content:"";position:absolute;inset:0;border-radius:28px;border:1px solid rgba(255,255,255,.09)
    }
    .loadingText{
      margin-top:18px;font-size:16px;color:var(--violet);font-weight:800;letter-spacing:1px;
      animation:pulseText 2s infinite;
    }
    .loadingSub{margin-top:8px;color:#cfc7b6;font-size:12px;letter-spacing:.5px}
    .loadingBar{
      width:min(260px,72vw);height:8px;border-radius:999px;margin-top:16px;background:rgba(255,255,255,.08);overflow:hidden;border:1px solid rgba(255,255,255,.08)
    }
    .loadingBar > span{
      display:block;height:100%;width:35%;
      background:linear-gradient(90deg,#a684ff,#e4cd97,#f4ecde);
      border-radius:999px;animation:neonBar 1.2s linear infinite;background-size:200% 100%
    }

    .fxOverlay{
      position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;
      background:rgba(3,8,20,.62);backdrop-filter:blur(10px);padding:24px;
      transition:opacity .25s ease, visibility .25s ease
    }
    .fxOverlay.hidden{opacity:0;visibility:hidden;pointer-events:none}
    .fxGlow{
      position:absolute;width:180px;height:180px;border-radius:50%;
      background:radial-gradient(circle, rgba(255,255,255,.92) 0%, rgba(215,214,235,.38) 24%, rgba(130,132,160,.12) 50%, transparent 70%);
      filter:blur(6px);top:22%;left:50%;transform:translateX(-50%);pointer-events:none
    }
    .fxOverlayCard{
      position:relative;z-index:1;width:min(680px,92vw);min-height:300px;border-radius:30px;
      display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;
      background:linear-gradient(180deg, rgba(18,18,24,.88), rgba(10,10,16,.92));
      border:1px solid rgba(255,255,255,.10);box-shadow:0 24px 72px rgba(0,0,0,.42), inset 0 1px 0 rgba(255,255,255,.03);
      overflow:hidden;padding:32px
    }
    .fxOverlayCard::before,.fxOverlayCard::after{content:"";position:absolute;border-radius:50%;background:rgba(82,123,255,.10);filter:blur(18px)}
    .fxOverlayCard::before{width:140px;height:140px;left:12%;top:18%}
    .fxOverlayCard::after{width:120px;height:120px;right:12%;bottom:18%}
    .fxOverlayTitle{font-size:clamp(36px,9vw,58px);font-weight:800;letter-spacing:1px}
    .fxOverlaySub{margin-top:12px;font-size:clamp(16px,3.5vw,22px);color:#d6e0ff}
    .prepCard{min-height:320px}
    .prepSpinner{width:82px;height:82px;border-radius:50%;border:4px solid rgba(255,255,255,.16);border-top-color:#fff;animation:spin .9s linear infinite;margin-bottom:18px}
    .prepBar{width:min(320px,72vw);height:10px;border-radius:999px;margin-top:18px;background:rgba(255,255,255,.08);overflow:hidden;border:1px solid rgba(255,255,255,.09)}
    .prepBar span{display:block;height:100%;width:45%;background:linear-gradient(90deg,#8bb4ff,#ffffff,#8bb4ff);background-size:200% 100%;animation:neonBar 1s linear infinite}
    .homeScreen{width:min(1100px,96vw);height:min(calc(100dvh - 24px),980px);min-height:calc(100dvh - 24px);display:flex;align-items:stretch;position:relative}
    .homeGlass{flex:1;border-radius:32px;background:linear-gradient(180deg, rgba(8,14,34,.58), rgba(8,14,34,.40));border:1px solid rgba(255,255,255,.10);backdrop-filter:blur(18px);box-shadow:0 24px 90px rgba(0,0,0,.35);padding:28px;display:flex;flex-direction:column;justify-content:space-between;overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;position:relative;contain:layout paint style;background-clip:padding-box}
    .homeGlass::before{content:"";position:absolute;inset:auto -10% 55% auto;width:360px;height:360px;border-radius:50%;background:radial-gradient(circle, rgba(126,168,255,.22), transparent 68%);pointer-events:none}
    .heroRow{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;flex-wrap:wrap}
    .heroIntro{max-width:620px}
    .heroTitle{margin:0;font-size:clamp(34px,7vw,68px);line-height:1.02}
    .heroNote{margin-top:14px;color:#cfd8ef;font-size:15px;max-width:540px;line-height:1.7}
    .loginPanel{margin-top:24px;width:min(560px,100%);padding:0;border-radius:0;background:transparent;border:none;box-shadow:none}

    .tabs{position:sticky;top:0;z-index:2;padding-top:2px;background:linear-gradient(180deg,rgba(11,8,18,.95),rgba(11,8,18,.72) 70%,transparent)}
    .tab{backdrop-filter:blur(10px)}
    .tab.active{box-shadow:0 0 0 1px rgba(255,255,255,.08),0 10px 28px rgba(183,124,255,.18)}
    .tile{position:relative;overflow:hidden}
    .tile:before{content:"";position:absolute;inset:0 auto 0 -30%;width:32%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.05),transparent);transform:skewX(-18deg);animation:tileSweep 6.8s linear infinite;pointer-events:none}
    .liveFx{position:sticky;bottom:0;z-index:2;background:linear-gradient(180deg,rgba(10,8,18,.35),rgba(10,8,18,.96) 16%,rgba(10,8,18,.98));padding-bottom:calc(10px + env(safe-area-inset-bottom));margin-bottom:-6px}
    .liveFxHud{display:flex;align-items:center;justify-content:space-between;gap:10px}
    .fxMeta{display:flex;align-items:center;gap:8px;font-size:10px;color:#d6c8aa;letter-spacing:.9px;text-transform:uppercase}
    .fxMeter{width:54px;height:6px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden;position:relative}
    .fxMeter:before{content:"";position:absolute;inset:0;width:72%;background:linear-gradient(90deg,#bea6ff,#e4cd97);animation:meterRun 2s linear infinite}
    .btn,.gameBtn,.socialBtn,.smallBtn{position:relative;overflow:hidden}
    .btn:before,.gameBtn:before,.socialBtn:before,.smallBtn:before{content:"";position:absolute;inset:0 auto 0 -42%;width:34%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.18),transparent);transform:skewX(-20deg)}
    .btn:hover:before,.gameBtn:hover:before,.socialBtn:hover:before,.smallBtn:hover:before{animation:btnSweep .9s ease}
    @keyframes tileSweep{0%{transform:translateX(0) skewX(-18deg);opacity:0}10%{opacity:1}100%{transform:translateX(520%) skewX(-18deg);opacity:0}}
    @keyframes meterRun{0%{transform:translateX(-40%)}100%{transform:translateX(55%)}}
    @keyframes btnSweep{0%{transform:translateX(0) skewX(-20deg);opacity:0}20%{opacity:1}100%{transform:translateX(520%) skewX(-20deg);opacity:0}}

    
    .card::before{
      content:"";position:absolute;inset:0;border-radius:32px;padding:1px;
      background:linear-gradient(135deg, rgba(255,255,255,.10), rgba(255,255,255,.025) 22%, rgba(214,196,154,.16) 56%, rgba(255,255,255,.03) 88%);
      -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
      -webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none;opacity:.9;
    }
    .luxBar{
      background:linear-gradient(90deg, rgba(255,255,255,.045), rgba(214,196,154,.08), rgba(255,255,255,.03));
      border:1px solid rgba(255,255,255,.07);
      box-shadow:inset 0 1px 0 rgba(255,255,255,.04);
    }
    .pill{
      background:linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.028));
      border:1px solid rgba(255,255,255,.08);
    }
    .tile,.noticeBox,.statChip,.socialBtn,.gameBtn,.tab{
      box-shadow:inset 0 1px 0 rgba(255,255,255,.035), 0 12px 28px rgba(0,0,0,.12);
    }
    .liveFx{
      border-top:1px solid rgba(255,255,255,.06);
      box-shadow:0 -16px 44px rgba(0,0,0,.18);
    }
    .liveFx::before{
      content:"";position:absolute;left:16px;right:16px;top:0;height:1px;
      background:linear-gradient(90deg, transparent, rgba(214,196,154,.30), transparent);
      pointer-events:none;
    }
    .fxMeter:before{background:linear-gradient(90deg,#cdb8ff,#e4cd97,#f5eee4)}
    .loadingText,.title{font-weight:400}
    .statusBatteryRemoved{display:none!important}
    .statusLabel{display:none!important}
    .statusTime:empty{display:none!important}

    .btn,.smallBtn,.socialBtn,.gameBtn,.tab{transition:transform .18s ease, box-shadow .18s ease, background .18s ease, border-color .18s ease}
    .btn:hover,.smallBtn:hover,.socialBtn:hover,.gameBtn:hover,.tab:hover{transform:translateY(-1px);box-shadow:0 10px 24px rgba(0,0,0,.18)}
    .btn:active,.smallBtn:active,.socialBtn:active,.gameBtn:active,.tab:active{transform:scale(.985)}
    @keyframes spin{to{transform:rotate(360deg)}}
    @keyframes fxLineIn{
      0%{opacity:0;transform:translateY(6px)}
      100%{opacity:1;transform:translateY(0)}
    }
    @keyframes blinkCursor{
      0%,49%{opacity:1}
      50%,100%{opacity:.15}
    }

    @media (max-width:560px){
      .tabs{grid-template-columns:repeat(3,1fr)}
      .grid2{grid-template-columns:1fr}
      .wrap{padding:0}
      .card{
        width:100vw;max-width:100vw;height:100dvh;max-height:100dvh;
        border-radius:0;border-left:none;border-right:none;border-top:none
      }
      .homeScreen{width:100vw;height:100dvh;min-height:100dvh}
      .homeGlass{border-radius:0;padding:20px 16px 18px;border-left:none;border-right:none;border-top:none}
      .brand{align-items:flex-start}
      .top{padding-top:calc(16px + env(safe-area-inset-top));}
      .content{padding:14px 14px calc(20px + env(safe-area-inset-bottom))}
      .toast{bottom:calc(14px + env(safe-area-inset-bottom))}
    }
  </style>
  `;
}

function renderHomeHtml() {
  return `
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
  <meta name="theme-color" content="#05040b">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="mobile-web-app-capable" content="yes">
  ${baseStyles()}
  <title>AimTrickHead</title>
</head>
<body>
  <div class="bgAura"><div class="orb o1"></div><div class="orb o2"></div><div class="orb o3"></div></div>
  <div class="wrap">
    <div class="homeScreen">
      <div class="homeGlass">
        <div class="heroRow">
          <div class="heroIntro">
            <div class="brand">
              <div class="logoBox">${renderLogo(78, 24)}</div>
              <div>
                <div class="pill">✦ VIP ACTIVE</div>
                <h1 class="heroTitle">AimTrickHead<br>Secure Panel</h1>
                <div class="credit">CRE HUY FANTA · AIMTRICKHEAD UPDATE</div>
              </div>
            </div>
            <p class="heroNote">PANEL.</p>
          </div>
          <div class="pill">huy mkt</div>
        </div>
        <div class="loginPanel">
          <div class="loginIntro">
            <h2 class="loginTitle">Truy cập nhanh</h2>
            <p class="loginHint">kkk.</p>
          </div>
          <div class="grid2" style="margin-top:10px">
            <a class="gameBtn" href="/panel"> Panel</a>
            <a class="socialBtn" href="/${ADMIN_ROUTE}">Admin</a>
          </div>
          <div class="grid2" style="margin-top:12px">
            <a class="socialBtn" href="${ZALO_URL}" target="_blank" rel="noopener noreferrer">${iconZalo()} <span>Zalo</span></a>
            <a class="socialBtn" href="${FACEBOOK_URL}" target="_blank" rel="noopener noreferrer">${iconFacebook()} <span>Facebook</span></a>
          </div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>
  `;
}

function renderPanelHtml() {
  return `
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
  <meta name="theme-color" content="#05040b">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="mobile-web-app-capable" content="yes">
  <title>AimTrickHead Signature</title>
  ${baseStyles()}
</head>
<body>
  <div class="bgAura"><div class="orb o1"></div><div class="orb o2"></div><div class="orb o3"></div></div>
  <div class="statusBar">
    <div class="statusTime" id="statusTime"></div>
    <div class="statusMeta">
      <span class="statusDot"></span>
      <span class="statusLabel">PREMIUM AIM TRICK HEAD</span>
      
    </div>
  </div>

  <div class="loadingLayer" id="loadingLayer">
    <div class="loadingLogo">${renderLogo(172, 28)}</div>
    <div class="loadingText">AimTrickHead </div>
    <div class="loadingSub">Đang Tải Chờ Xíu...</div>
    <div class="loadingBar"><span></span></div>
  </div>

  <div class="wrap">
    <div class="card">
      <div class="top">
        <div class="brand">
          <div class="logoBox">${renderLogo(74, 22)}</div>
          <div>
            <h1 class="title">AimTrickHead Signature</h1>
            <div class="sub">Key Active By Huy Fanta</div>
            <div class="credit">CRE HUY FANTA · AimTrickHead</div>
          </div>
        </div>
      </div>

      <div class="content">
        <div class="luxBar"><div class="luxLeft"><span class="luxDot"></span><span>Update Aim Trick Head Mobile</span></div><div class="luxRight"></div></div>
        <div id="loginView" class="loginHero" style="padding:10px 0 0;background:transparent;border:none;border-radius:0;box-shadow:none">
          <div class="loginFrame">
          <div class="loginIntro">
            <h2 class="loginTitle">Đăng nhập Key Đi Mấy Ní</h2>
            <p class="loginHint">
             APP Hỗ Trợ Kéo Tâm Trên ADR - iOS AimTrickHead.
            </p>
          </div>
          
          <input id="keyInput" class="input" placeholder="Nhập Key Vào Đây Đi Nè">
          <button class="btn" onclick="dangNhap()">Đăng nhập</button>
          <div class="grid2" style="margin-top:10px">
            <a class="socialBtn" href="${ZALO_URL}" target="_blank" rel="noopener noreferrer">${iconZalo()} <span>Zalo</span></a>
            <a class="socialBtn" href="${FACEBOOK_URL}" target="_blank" rel="noopener noreferrer">${iconFacebook()} <span>Facebook</span></a>
          </div>
          <div id="msg" class="msg"></div>
          </div>
        </div>

        <div id="panelView" class="hidden">
          <div class="topLine">
            <div class="pill">✦ VIP ACTIVE</div>
            <button class="smallBtn" onclick="dangXuat()">Thoát</button>
          </div>

          <div class="quickStats">
            <div class="statChip"><span class="statLabel">Support</span><strong>Hỗ Trợ FF</strong></div>
            <div class="statChip"><span class="statLabel">Support</span><strong>Hỗ Trợ FFMAX</strong></div>
            <div class="statChip"><span class="statLabel">Device</span><strong>All Mobile</strong></div>
          </div>

          <div class="noticeBox" id="keyNotice">
            Key đang hoạt động.
          </div>

          <div class="tabs">
            <button class="tab active" data-tab="tab1">Main</button>
            <button class="tab" data-tab="tab2">Optimize+</button>
            <button class="tab" data-tab="tab3">Game</button>
            <button class="tab" data-tab="tab4">Social</button>
            <button class="tab" data-tab="tab6">TikTok</button>
          </div>

          <div id="tab1" class="tabPane active">
            <div class="tile"><div class="row"><div><p class="name">AimTrickHead</p><p class="desc">Chức Năng Hỗ Trợ Kéo Tâm Trong APP</p></div><label class="switch"><input type="checkbox" id="f2" onchange="toggleFx(this,'AimTrickHead')"><span class="slider"></span></label></div></div>
            <div class="tile"><div class="row"><div><p class="name">Bám Đầu</p><p class="desc">Tác dụng hỗ trợ bám</p></div><label class="switch"><input type="checkbox" id="f3" onchange="toggleFx(this,'Bám Đầu')"><span class="slider"></span></label></div></div>
            <div class="tile"><div class="row"><div><p class="name">Nhẹ Tâm</p><p class="desc">Tác dụng nhẹ tâm</p></div><label class="switch"><input type="checkbox" id="f4" onchange="toggleFx(this,'Nhẹ Tâm')"><span class="slider"></span></label></div></div>
          </div>

          <div id="tab2" class="tabPane">
            <div class="tile"><div class="row"><div><p class="name">Tối Ưu Mạnh</p><p class="desc">Tăng phản hồi ngay sau khi bật nhen</p></div><label class="switch"><input type="checkbox" id="f5" onchange="toggleFx(this,'Tối Ưu Mạnh')"><span class="slider"></span></label></div></div>
            <div class="tile"><div class="row"><div><p class="name">Buff Nhạy x Nhẹ Tâm</p><p class="desc">Tối ưu cảm giác kéo và độ mượt</p></div><label class="switch"><input type="checkbox" id="f6" onchange="toggleFx(this,'Buff Nhạy x Nhẹ Tâm')"><span class="slider"></span></label></div></div>
            <div class="tile"><div class="row"><div><p class="name">Game Boost</p><p class="desc">Tối Ưu Mượt Game </p></div><label class="switch"><input type="checkbox" id="f7" onchange="toggleFx(this,'Game Boost')"><span class="slider"></span></label></div></div>
            <div class="tile"><div class="row"><div><p class="name">Nhẹ Tâm + Fix Rung</p><p class="desc">Giảm Rung Nhẹ</p></div><label class="switch"><input type="checkbox" id="f1" onchange="toggleFx(this,'Nhẹ Tâm + Fix Rung')"><span class="slider"></span></label></div></div>
            <div class="tile">
              <p class="name">Sensi Control</p>
              <p class="desc">Sensi Mobile</p>
              <div class="sliderWrap">
                <div class="rangeLabel"><span>Level</span><span id="sensiValue">60</span></div>
                <input type="range" min="1" max="120" value="60" id="sensiRange" oninput="updateSensi(this.value)">
              </div>
            </div>
          </div>

          <div id="tab3" class="tabPane">
            <div class="grid2">
              <button class="gameBtn" onclick="prepGame('FF')">🎮 <span>Free Fire</span></button>
              <button class="gameBtn" onclick="prepGame('FFMAX')">🔥 <span>FF MAX</span></button>
            </div>
            <div class="footer">BẬT XONG RỒI CHIẾN NHÉ.</div>
          </div>

          <div id="tab4" class="tabPane">
            <div class="grid2">
              <a class="socialBtn" href="${ZALO_URL}" target="_blank" rel="noopener noreferrer">${iconZalo()} <span>Liên hệ Zalo</span></a>
              <a class="socialBtn" href="${FACEBOOK_URL}" target="_blank" rel="noopener noreferrer">${iconFacebook()} <span>Facebook</span></a>
            </div>
            <div class="footer">Mua Key Vĩnh Viễn Hoặc Hỗ Trợ Liên Hệ.</div>
          </div>

          <div id="tab6" class="tabPane">
            <div class="grid2">
              <a class="socialBtn" href="${TIKTOK_URL}" target="_blank" rel="noopener noreferrer">🎵 <span>TikTok</span></a>
              <a class="socialBtn" href="${ZALO_URL}" target="_blank" rel="noopener noreferrer">${iconZalo()} <span>Liên hệ Admin</span></a>
            </div>
            <div class="footer">
              Theo Dõi Thông Tin Về APP , Files Aimlock , Kéo Tâm.<br>
              Key Vĩnh Viễn Liên Hệ.
            </div>
          </div>

          <div class="liveFx" id="liveFxBox"><span class="fxLine">⚡ Chờ kích hoạt module...</span></div>
        </div>
      </div>
    </div>
  </div>


  <div id="fxOverlay" class="fxOverlay hidden">
    <div class="fxGlow"></div>
    <div class="fxOverlayCard">
      <div class="fxOverlayTitle" id="fxOverlayTitle">ĐÃ BẬT</div>
      <div class="fxOverlaySub" id="fxOverlaySub">Chức năng đang hoạt động</div>
    </div>
  </div>

  <div id="gamePrepOverlay" class="fxOverlay hidden">
    <div class="fxGlow"></div>
    <div class="fxOverlayCard prepCard">
      <div class="prepSpinner"></div>
      <div class="fxOverlayTitle" id="gamePrepTitle">ĐANG SETUP</div>
      <div class="fxOverlaySub" id="gamePrepSub">Đang cấu hình tính năng...</div>
      <div class="prepBar"><span></span></div>
    </div>
  </div>

  <div id="gameDoneOverlay" class="fxOverlay hidden">
    <div class="fxGlow"></div>
    <div class="fxOverlayCard">
      <div class="fxOverlayTitle">ĐÃ SETUP XONG</div>
      <div class="fxOverlaySub" id="gameDoneSub">Thoát ra và vào game là được nhé bro</div>
    </div>
  </div>

  <div id="toast" class="toast"></div>

  <script>
    const msg = document.getElementById("msg");
    const loginView = document.getElementById("loginView");
    const panelView = document.getElementById("panelView");
    const toast = document.getElementById("toast");
    const liveFxBox = document.getElementById("liveFxBox");
    const fxOverlay = document.getElementById("fxOverlay");
    const fxOverlayTitle = document.getElementById("fxOverlayTitle");
    const fxOverlaySub = document.getElementById("fxOverlaySub");
    const gamePrepOverlay = document.getElementById("gamePrepOverlay");
    const gamePrepTitle = document.getElementById("gamePrepTitle");
    const gamePrepSub = document.getElementById("gamePrepSub");
    const gameDoneOverlay = document.getElementById("gameDoneOverlay");
    const gameDoneSub = document.getElementById("gameDoneSub");
    const sensiValue = document.getElementById("sensiValue");
    const loadingLayer = document.getElementById("loadingLayer");
    const keyNotice = document.getElementById("keyNotice");
    const statusTime = document.getElementById("statusTime");
    const statusBatteryRemoved = document.getElementById("statusBatteryRemoved");

    const FF_ANDROID_PACKAGE = ${JSON.stringify(FF_ANDROID_PACKAGE)};
    const FFMAX_ANDROID_PACKAGE = ${JSON.stringify(FFMAX_ANDROID_PACKAGE)};
    const FF_IOS_SCHEME = ${JSON.stringify(FF_IOS_SCHEME)};
    const FFMAX_IOS_SCHEME = ${JSON.stringify(FFMAX_IOS_SCHEME)};
    const FF_URL = ${JSON.stringify(FF_URL)};
    const FF_MAX_URL = ${JSON.stringify(FF_MAX_URL)};
    const FF_IOS_STORE = ${JSON.stringify("https://apps.apple.com/app/id" + FF_IOS_APPID)};
    const FFMAX_IOS_STORE = ${JSON.stringify("https://apps.apple.com/app/id" + FFMAX_IOS_APPID)};

    let fxTimer = null;
    let codeTimer = null;
    let codeRunToken = 0;


    function updateStatusBar() {
      const now = new Date();
      statusTime.textContent = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
    }

    async function updateBattery() {
      try {
        if (!navigator.getBattery) return;
        const battery = await navigator.getBattery();
        const paint = function() {
          statusBatteryRemoved.textContent = Math.round(battery.level * 100) + "%";
        };
        paint();
        battery.addEventListener("levelchange", paint);
      } catch (e) {}
    }

    function lockAppShellScroll() {
      let startY = 0;
      document.addEventListener("touchstart", function (e) {
        startY = e.touches && e.touches[0] ? e.touches[0].clientY : 0;
      }, { passive: true });

      document.addEventListener("touchmove", function (e) {
        const target = e.target && e.target.closest ? e.target.closest(".card,.homeGlass") : null;
        if (!target) {
          e.preventDefault();
          return;
        }
        const currentY = e.touches && e.touches[0] ? e.touches[0].clientY : startY;
        const delta = currentY - startY;
        const atTop = target.scrollTop <= 0;
        const atBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 1;
        if ((atTop && delta > 0) || (atBottom && delta < 0)) {
          e.preventDefault();
        }
      }, { passive: false });
    }

    function hideLoading() {
      setTimeout(function () {
        loadingLayer.classList.add("hide");
      }, 1800);
    }

    function showToast(text, type) {
      toast.className = "toast show " + (type || "");
      toast.textContent = text || "";
      setTimeout(function () { toast.className = "toast"; }, 2200);
    }

    function getDevice() {
      let id = localStorage.getItem("ath_device");
      if (!id) {
        id = "web-" + Math.random().toString(36).slice(2, 12);
        localStorage.setItem("ath_device", id);
      }
      return id;
    }

    function setMsg(text, type) {
      msg.textContent = text || "";
      msg.className = "msg " + (type || "");
    }

    function saveSession(data) {
      localStorage.setItem("ath_session", data.token || "");
      localStorage.setItem("ath_key", data.key || "");
    }

    function getSession() { return localStorage.getItem("ath_session"); }
    function getSavedKey() { return localStorage.getItem("ath_key") || ""; }
    function clearSession() {
      localStorage.removeItem("ath_session");
      localStorage.removeItem("ath_key");
    }

    function msToViDuration(ms) {
      if (ms <= 0) return "0 phút";
      const totalMinutes = Math.floor(ms / 60000);
      const days = Math.floor(totalMinutes / (60 * 24));
      const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
      const minutes = totalMinutes % 60;
      const parts = [];
      if (days) parts.push(days + " ngày");
      if (hours) parts.push(hours + " giờ");
      if (minutes || parts.length === 0) parts.push(minutes + " phút");
      return parts.slice(0, 3).join(" ");
    }

    function buildNotice(data) {
      const keyText = data.key || getSavedKey() || "Đang hoạt động";
      const remainText = msToViDuration((data.expireAt || 0) - Date.now());
      keyNotice.innerHTML =
        '<b>Key:</b> ' + keyText +
        '<br><b>Hiệu lực còn:</b> ' + remainText +
        '<br><b>Hết hạn lúc:</b> ' + (data.expireText || "--");
    }

    function escapeHtml(text) {
      return String(text)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    }

    function writeFx(lines) {
      const hud = '<div class="liveFxHud"><div class="hudDots"><span></span><span></span><span></span></div><div class="fxMeta"><span>runtime monitor</span><span class="fxMeter"></span><span>locked</span></div></div>';
      const body = lines.map(function(line){
        if (typeof line === "string") {
          return '<span class="fxLine">' + escapeHtml(line) + '</span>';
        }
        const tone = line && line.tone ? " " + line.tone : "";
        const value = line && line.text ? line.text : "";
        return '<span class="fxLine' + tone + '">' + escapeHtml(value) + '</span>';
      }).join("");
      liveFxBox.innerHTML = hud + body + '<span class="fxCursor"></span>';
    }

    function makeStamp() {
      const now = new Date();
      const h = String(now.getHours()).padStart(2, "0");
      const m = String(now.getMinutes()).padStart(2, "0");
      const s = String(now.getSeconds()).padStart(2, "0");
      return h + ":" + m + ":" + s;
    }

    function randomHex(size) {
      return Math.random().toString(16).slice(2, 2 + size).toUpperCase().padEnd(size, "0");
    }

    function runFxSequence(lines, interval, onDone) {
      const token = ++codeRunToken;
      let index = 0;
      function step() {
        if (token !== codeRunToken) return;
        writeFx(lines.slice(0, index + 1));
        index += 1;
        if (index < lines.length) {
          codeTimer = setTimeout(step, interval);
        } else if (typeof onDone === "function") {
          codeTimer = setTimeout(function () {
            if (token === codeRunToken) onDone();
          }, 900);
        }
      }
      step();
    }

    function startFxFeed() {
      clearInterval(fxTimer);
      liveFxBox.classList.remove("activePulse");
      const lines = [
        [{ text: "[" + makeStamp() + "] runtime.idle => premium-ready", tone: "info" }, { text: "↳ state cache verified", tone: "ok" }, { text: "↳ running app", tone: "ok" }, { text: "↳Freefire smooth", tone: "ok" }, { text: "↳ shell depth = 4.0", tone: "info" }],
        [{ text: "[" + makeStamp() + "] ui.pipeline => stable", tone: "info" }, { text: "↳  stream active", tone: "ok" }, { text: "↳ auto update", tone: "ok" }, { text: "↳ com.dts.ffth", tone: "info" }, { text: "↳ OK", tone: "ok" }],
        [{ text: "[" + makeStamp() + "] mobile.profile => online", tone: "info" }, { text: "↳ update all", tone: "ok" }, { text: "↳ sensivity on", tone: "ok" }, { text: "↳com.dts.ffmax", tone: "ok" }, { text: "↳ overscroll bounce = 0", tone: "ok" }],
        [{ text: "[" + makeStamp() + "] optimize.stream => armed", tone: "info" }, { text: "↳online", tone: "ok" }, { text: "↳ module  ready", tone: "ok" }, { text: "↳ cache drift = 0.00", tone: "info" }, { text: "↳ freefire lock fps", tone: "ok" }],
        [{ text: "[" + makeStamp() + "] premium.tabs => elite", tone: "info" }, { text: "↳ on files", tone: "ok" }, { text: "↳ smooth render ", tone: "ok" }, { text: "↳ shell locked", tone: "warn" }, { text: "↳ lock fps", tone: "ok" }]
      ];
      let i = 0;
      writeFx(lines[0]);
      fxTimer = setInterval(function () {
        writeFx(lines[i % lines.length]);
        i++;
      }, 1900);
    }

    function simulateCodeRun(label, isOn) {
      clearInterval(fxTimer);
      clearTimeout(codeTimer);
      liveFxBox.classList.add("activePulse");
      const moduleName = label.replaceAll(" ", "_").toLowerCase();
      const seq = [
        { text: "[" + makeStamp() + "] > wake.runtime --shell=ath-v4", tone: "info" },
        { text: "[" + makeStamp() + "] > select.module --name=" + moduleName, tone: "info" },
        { text: "[" + makeStamp() + "] > auth.runtime --token=" + randomHex(8), tone: "info" },
        { text: "[" + makeStamp() + "] > mount.profile --tier=vip-signature", tone: "ok" },
        { text: "[" + makeStamp() + "] > patch.touch --vector=" + randomHex(6), tone: "ok" },
        { text: "[" + makeStamp() + "] > patch.motion --curve=" + randomHex(5), tone: "ok" },
        { text: "[" + makeStamp() + "] > patch.visual --layer=glass-core-s", tone: "ok" },
        { text: "[" + makeStamp() + "] > patch.viewport --bounce=off --mode=fixed", tone: "ok" },
        { text: "[" + makeStamp() + "] > patch.render --alpha=" + (isOn ? "0.96" : "0.22"), tone: "info" },
        { text: "[" + makeStamp() + "] > sync.kernel --pulse=" + randomHex(4), tone: "info" },
        { text: "[" + makeStamp() + "] > lock.viewport --mode=app-shell", tone: "ok" },
        { text: "[" + makeStamp() + "] > attach_runtime --mode=" + (isOn ? "enable" : "disable"), tone: "warn" },
        { text: "[" + makeStamp() + "] > verify.commit --hash=" + randomHex(10), tone: "info" },
        { text: isOn ? "[" + makeStamp() + "] > status => ACTIVE • LOCKED • STABLE" : "[" + makeStamp() + "] > status => OFF • RELEASED • SAFE", tone: isOn ? "ok" : "warn" }
      ];
      runFxSequence(seq, 92, function () {
        liveFxBox.classList.remove("activePulse");
        startFxFeed();
      });
    }

    function tryOpenUrl(url) {
      try {
        const iframe = document.createElement("iframe");
        iframe.style.display = "none";
        iframe.src = url;
        document.body.appendChild(iframe);
        setTimeout(function () {
          iframe.remove();
        }, 1200);
      } catch (e) {}
      try {
        window.location.href = url;
      } catch (e) {}
    }

    function launchGame(target) {
      const isMax = target === "FFMAX";
      const fallback = isMax ? FF_MAX_URL : FF_URL;
      if (isAndroid()) {
        const packageId = isMax ? FFMAX_ANDROID_PACKAGE : FF_ANDROID_PACKAGE;
        const intentUrl = "intent://launch#Intent;scheme=package;package=" + packageId + ";end";
        tryOpenUrl(intentUrl);
        setTimeout(function () {
          window.location.href = fallback;
        }, 900);
        return;
      }
      if (isIOS()) {
        const scheme = isMax ? FFMAX_IOS_SCHEME : FF_IOS_SCHEME;
        tryOpenUrl(scheme);
        return;
      }
      window.open(fallback, "_blank", "noopener,noreferrer");
    }

    function moPanel(data) {
      loginView.classList.add("hidden");
      panelView.classList.remove("hidden");
      buildNotice(data);
      taiTrangThai();
      startFxFeed();
    }

    function dangXuat() {
      clearSession();
      clearInterval(fxTimer);
      clearTimeout(codeTimer);
      panelView.classList.add("hidden");
      loginView.classList.remove("hidden");
      document.getElementById("keyInput").value = "";
      setMsg("", "");
      showToast("Đã thoát", "err");
    }

    async function dangNhap() {
      const key = document.getElementById("keyInput").value.trim();
      if (!key) {
        setMsg("Vui lòng nhập key.", "err");
        return;
      }
      setMsg("Đang kiểm tra key...");
      try {
        const res = await fetch("/api/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: key, device: getDevice() })
        });
        const data = await res.json();
        if (!data.ok) {
          setMsg(data.msg || "Đăng nhập thất bại.", "err");
          return;
        }
        saveSession({ token: data.token, key: key });
        data.key = key;
        setMsg("Đăng nhập thành công.", "ok");
        showToast("Đăng nhập thành công", "ok");
        moPanel(data);
      } catch (e) {
        setMsg("Không thể kết nối tới máy chủ.", "err");
      }
    }

    function showBigFx(label, isOn) {
      fxOverlayTitle.textContent = isOn ? "ĐÃ BẬT" : "ĐÃ TẮT";
      fxOverlaySub.textContent = label + (isOn ? " đang hoạt động" : " đã ngừng hoạt động");
      fxOverlay.classList.remove("hidden");
      clearTimeout(window.__fxOverlayTimer);
      window.__fxOverlayTimer = setTimeout(function () {
        fxOverlay.classList.add("hidden");
      }, 1600);
    }

    function toggleFx(el, label) {
      luuTrangThai();
      simulateCodeRun(label, el.checked);
      showToast(label + (el.checked ? " đã bật" : " đã tắt"), el.checked ? "ok" : "err");
      showBigFx(label, el.checked);
    }

    function updateSensi(val) {
      sensiValue.textContent = val;
      localStorage.setItem("ath_sensi", String(val));
      simulateCodeRun("Sensi_" + val, true);
    }

    function luuTrangThai() {
      const state = {
        f1: document.getElementById("f1") ? document.getElementById("f1").checked : false,
        f2: document.getElementById("f2") ? document.getElementById("f2").checked : false,
        f3: document.getElementById("f3") ? document.getElementById("f3").checked : false,
        f4: document.getElementById("f4") ? document.getElementById("f4").checked : false,
        f5: document.getElementById("f5") ? document.getElementById("f5").checked : false,
        f6: document.getElementById("f6") ? document.getElementById("f6").checked : false,
        f7: document.getElementById("f7") ? document.getElementById("f7").checked : false
      };
      localStorage.setItem("ath_state", JSON.stringify(state));
    }

    function taiTrangThai() {
      try {
        const state = JSON.parse(localStorage.getItem("ath_state") || "{}");
        ["f1","f2","f3","f4","f5","f6","f7"].forEach(function (id) {
          const el = document.getElementById(id);
          if (el) el.checked = !!state[id];
        });
        const savedSensi = localStorage.getItem("ath_sensi") || "60";
        const sensiRange = document.getElementById("sensiRange");
        if (sensiRange) sensiRange.value = savedSensi;
        sensiValue.textContent = savedSensi;
      } catch (e) {}
    }

    function isAndroid() {
      return /Android/i.test(navigator.userAgent || "");
    }

    function isIOS() {
      return /iPhone|iPad|iPod/i.test(navigator.userAgent || "");
    }

    function prepGame(target) {
      const pretty = target === "FFMAX" ? "FF MAX" : "FREE FIRE";
      gamePrepTitle.textContent = "ĐANG SETUP " + pretty;
      gamePrepSub.textContent = "Đang đồng bộ preset, module và trạng thái đã bật";
      gamePrepOverlay.classList.remove("hidden");
      gameDoneOverlay.classList.add("hidden");
      simulateCodeRun("launch_" + pretty, true);
      showToast("Đang setup " + pretty, "ok");
      setTimeout(function () {
        gamePrepOverlay.classList.add("hidden");
        gameDoneSub.textContent = pretty + " đã setup xong. Đang mở game, nếu lỗi thì thoát app vô game nhe.";
        gameDoneOverlay.classList.remove("hidden");
        showToast(pretty + " đã setup xong", "ok");
        setTimeout(function () {
          launchGame(target);
        }, 550);
        setTimeout(function () {
          gameDoneOverlay.classList.add("hidden");
        }, 2300);
      }, 2600);
    }

    document.querySelectorAll(".tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.querySelectorAll(".tab").forEach(function (b) { b.classList.remove("active"); });
        document.querySelectorAll(".tabPane").forEach(function (p) { p.classList.remove("active"); });
        btn.classList.add("active");
        const pane = document.getElementById(btn.dataset.tab);
        if (pane) pane.classList.add("active");
      });
    });

    window.addEventListener("touchmove", function () {}, { passive: true });

    window.addEventListener("load", async function () {
      hideLoading();
      const token = getSession();
      if (!token) return;
      try {
        const res = await fetch("/api/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: token, device: getDevice() })
        });
        const data = await res.json();
        if (data.ok) {
          data.key = getSavedKey();
          moPanel(data);
        } else {
          clearSession();
        }
      } catch (e) {}
    });
  </script>
</body>
</html>
  `;
}

function renderAdminHtml() {
  return `
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
  <meta name="theme-color" content="#05040b">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="mobile-web-app-capable" content="yes">
  <title>Admin</title>
  ${baseStyles()}
</head>
<body>
  <div class="bgAura"><div class="orb o1"></div><div class="orb o2"></div><div class="orb o3"></div></div>
  <div class="wrap">
    <div class="card" style="max-width:760px">
      <div class="top">
        <div class="brand">
          <div class="logoBox">${renderLogo(74,22)}</div>
          <div>
            <h1 class="title">Ad</h1>
            <div class="sub">88</div>
            <div class="credit">CRE HUY FANTA · AIM TRICK HEAD</div>
          </div>
        </div>
      </div>
      <div class="content">
        <div class="loginHero">
          <input id="adminKey" class="input" type="password" placeholder="Admin Key">
          <input id="customKey" class="input" style="margin-top:10px" placeholder="Key muốn tạo (để trống = tự random)">
          <div class="grid2" style="margin-top:10px">
            <input id="uses" class="input" type="number" value="1" placeholder="Số thiết bị tối đa">
            <input id="days" class="input" type="number" value="30" placeholder="Số ngày sử dụng">
          </div>
          <div class="grid2" style="margin-top:10px">
            <button class="btn" style="margin-top:0" onclick="taoKey()">Tạo Key</button>
            <button class="smallBtn" style="height:56px" onclick="taiDanhSach()">Tải danh sách key</button>
          </div>
          <div id="result" class="msg" style="margin-top:12px"></div>
          <div id="list" style="margin-top:14px"></div>
        </div>
      </div>
    </div>
  </div>

  <script>
    async function taoKey() {
      const adminKey = document.getElementById("adminKey").value.trim();
      const customKey = document.getElementById("customKey").value.trim();
      const uses = Number(document.getElementById("uses").value || 50);
      const days = Number(document.getElementById("days").value || 30);
      const result = document.getElementById("result");
      result.innerHTML = "Đang tạo key...";
      try {
        const res = await fetch("/api/create", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-admin-key": adminKey
          },
          body: JSON.stringify({ key: customKey, uses: uses, days: days })
        });
        const data = await res.json();
        if (!data.ok) {
          result.innerHTML = '<span class="err">⛔ ' + (data.error || "Tạo key thất bại") + '</span>';
          return;
        }
        result.innerHTML =
          '<span class="ok">✅ Tạo thành công</span><br>' +
          '🔑 Key: <b>' + data.key + '</b><br>' +
          '📱 Số thiết bị tối đa: ' + data.totalDevices + '<br>' +
          '⏳ Hết hạn: ' + data.expireText;
        taiDanhSach();
      } catch (e) {
        result.innerHTML = '<span class="err">❌ Lỗi mạng</span>';
      }
    }

    async function taiDanhSach() {
      const adminKey = document.getElementById("adminKey").value.trim();
      const box = document.getElementById("list"); 
      box.innerHTML = "Đang tải...";
      try {
        const res = await fetch("/api/list", {
          headers: {
            "x-admin-key": adminKey
          }
        });
        const data = await res.json();
        if (!data.ok) {
          box.innerHTML = '<span class="err">⛔ ' + (data.error || "Không tải được") + '</span>';
          return;
        }
        const entries = data.items || [];
        if (!entries.length) {
          box.innerHTML = "Chưa có key nào.";
          return;
        }
        let html = "";
        for (const v of entries) {
          html +=
            '<div class="tile">' +
            '<div><b>Key:</b> ' + v.key + '</div>' +
            '<div><b>Lượt thiết bị còn:</b> ' + v.usesLeft + '</div>' +
            '<div><b>Đã dùng:</b> ' + v.usedDevices + ' / ' + v.totalDevices + '</div>' +
            '<div><b>Hết hạn:</b> ' + new Date(v.expireAt).toLocaleString("vi-VN") + '</div>' +
            '<button class="smallBtn" style="margin-top:10px;background:#7a1734;border:none" onclick="xoaKey(\\'' + v.key + '\\')">Xóa key</button>' +
            '</div>';
        }
        box.innerHTML = html;
      } catch (e) {
        box.innerHTML = '<span class="err">❌ Lỗi mạng</span>';
      }
    }

    async function xoaKey(key) {
      const adminKey = document.getElementById("adminKey").value.trim();
      await fetch("/api/delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": adminKey
        },
        body: JSON.stringify({ key: key })
      });
      taiDanhSach();
    }
  </script>
</body>
</html>
  `;
}

app.get("/healthz", (req, res) => {
  res.json({
    ok: true,
    storeMode: getStoreMode(),
    githubConfigured: hasGithubStore()
  });
});

app.get("/", (req, res) => {
  res.send(renderHomeHtml());
});

app.get("/panel", (req, res) => {
  res.send(renderPanelHtml());
});

app.get("/" + ADMIN_ROUTE, (req, res) => {
  res.send(renderAdminHtml());
});

app.post("/api/create", async (req, res) => {
  if (!isAdmin(req)) {
    return res.status(401).json({ ok: false, error: "Sai admin key" });
  }

  const customKey = String(req.body.key || "").trim();
  const totalDevices = Math.max(1, Number(req.body.uses || 50));
  const days = Math.max(1, Number(req.body.days || 30));
  const key = customKey || genKey();
  const expireAt = Date.now() + days * 24 * 60 * 60 * 1000;

  keys[key] = {
    usesLeft: totalDevices,
    totalDevices: totalDevices,
    devices: [],
    expireAt: expireAt,
    createdAt: Date.now()
  };
  await saveStore();

  return res.json({
    ok: true,
    key,
    uses: totalDevices,
    totalDevices,
    expireAt,
    expireText: formatVNTime(expireAt)
  });
});

app.get("/api/check", (req, res) => {
  return res.json({ ok: true, msg: "API check hoạt động, hãy dùng POST để kiểm tra key" });
});

app.post("/api/check", async (req, res) => {
  const key = String(req.body.key || "").trim();
  const device = String(req.body.device || "").trim();

  if (!key || !device) {
    return res.json({ ok: false, msg: "Thiếu key hoặc thiết bị" });
  }

  const item = normalizeKeyItem(keys[key]);
  if (!item) {
    return res.json({ ok: false, msg: "Key không tồn tại" });
  }

  if (Date.now() >= item.expireAt) {
    return res.json({ ok: false, msg: "Key đã hết hạn" });
  }

  const alreadyUsed = item.devices.includes(device);
  let changed = false;

  if (!alreadyUsed) {
    if (item.usesLeft <= 0) {
      return res.json({ ok: false, msg: "Key đã hết lượt thiết bị" });
    }
    item.devices.push(device);
    item.usesLeft -= 1;
    changed = true;
  }

  keys[key] = item;
  if (changed) {
    saveStore({ background: true }).catch((err) => {
      console.error("Background save failed:", err.message);
    });
  }

  const token = createSessionToken(key, device, item.expireAt);

  return res.json({
    ok: true,
    msg: "Đăng nhập thành công",
    key,
    token,
    expireAt: item.expireAt,
    expireText: formatVNTime(item.expireAt),
    usesLeft: item.usesLeft,
    usedDevices: item.devices.length,
    totalDevices: item.totalDevices
  });
});

app.post("/api/status", async (req, res) => {
  const token = String(req.body.token || "").trim();
  const device = String(req.body.device || "").trim();

  if (!token || !device) {
    return res.json({ ok: false, msg: "Thiếu phiên đăng nhập" });
  }

  const parsed = verifySessionToken(token);
  if (!parsed) {
    return res.json({ ok: false, msg: "Phiên không hợp lệ" });
  }

  if (parsed.device !== device) {
    return res.json({ ok: false, msg: "Phiên không đúng thiết bị" });
  }

  const item = normalizeKeyItem(keys[parsed.key]);
  if (!item) {
    return res.json({ ok: false, msg: "Key không tồn tại" });
  }

  if (Date.now() >= item.expireAt) {
    return res.json({ ok: false, msg: "Key đã hết hạn" });
  }

  if (!item.devices.includes(device)) {
    return res.json({ ok: false, msg: "Thiết bị chưa được cấp quyền cho key này" });
  }

  keys[parsed.key] = item;

  return res.json({
    ok: true,
    key: parsed.key,
    expireAt: item.expireAt,
    expireText: formatVNTime(item.expireAt),
    usesLeft: item.usesLeft,
    usedDevices: item.devices.length,
    totalDevices: item.totalDevices
  });
});

app.get("/api/list", async (req, res) => {
  if (!isAdmin(req)) {
    return res.status(401).json({ ok: false, error: "Sai admin key" });
  }

  const items = Object.entries(keys).map(([key, raw]) => {
    const value = normalizeKeyItem(raw);
    keys[key] = value;
    return {
      key,
      usesLeft: value.usesLeft,
      usedDevices: value.devices.length,
      totalDevices: value.totalDevices,
      expireAt: value.expireAt,
      expireText: formatVNTime(value.expireAt)
    };
  });

  return res.json({ ok: true, items });
});

app.post("/api/delete", async (req, res) => {
  if (!isAdmin(req)) {
    return res.status(401).json({ ok: false, error: "Sai admin key" });
  }

  const key = String(req.body.key || "").trim();
  if (!keys[key]) {
    return res.json({ ok: false, error: "Không tìm thấy key" });
  }

  delete keys[key];
  await saveStore();
  return res.json({ ok: true, msg: "Đã xóa key" });
});

initStore().finally(() => {
  app.listen(PORT, () => {
    console.log("Server chạy tại port " + PORT);
    console.log("thua2");
  });
});
