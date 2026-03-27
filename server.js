
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
const ADMIN_KEY = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!ADMIN_KEY || !SESSION_SECRET) {
  throw new Error("Thiếu ADMIN_PASSWORD hoặc SESSION_SECRET trong ENV");
}

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

let keys = {};
let storeReady = false;

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
    message: "Update keys store",
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
      await writeGithubStore(keys);
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

async function saveStore() {
  keys = normalizeAllStore(keys);
  try {
    if (hasGithubStore()) {
      await writeGithubStore(keys);
    } else {
      saveLocalStore();
    }
  } catch (err) {
    console.error("Save store failed:", err.message);
    saveLocalStore();
  }
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

  const now = Date.now();
  const windowMs = 15000;
  const limit = 90;

  if (!rateMap.has(ip)) rateMap.set(ip, []);
  const arr = rateMap.get(ip).filter((t) => now - t < windowMs);
  arr.push(now);
  rateMap.set(ip, arr);

  if (arr.length > limit) {
    return res.status(429).json({ ok: false, msg: "Thao tác quá nhanh" });
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
  return `
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path fill="#1877F2" d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073c0 6.023 4.388 11.015 10.125 11.927v-8.437H7.078v-3.49h3.047V9.41c0-3.017 1.792-4.684 4.533-4.684 1.313 0 2.686.235 2.686.235v2.963H15.83c-1.49 0-1.955.931-1.955 1.886v2.263h3.328l-.532 3.49h-2.796V24C19.612 23.088 24 18.096 24 12.073Z"/>
    <path fill="#fff" d="M16.671 15.563l.532-3.49h-3.328V9.81c0-.955.465-1.886 1.955-1.886h1.514V4.96s-1.373-.235-2.686-.235c-2.741 0-4.533 1.667-4.533 4.684v2.664H7.078v3.49h3.047V24h3.75v-8.437h2.796Z"/>
  </svg>`;
}

function iconZalo() {
  return `
  <svg width="20" height="20" viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <rect x="4" y="4" width="56" height="56" rx="18" fill="#0068FF"/>
    <path d="M17 22h30.5c1.7 0 2.58 2.03 1.42 3.27L28.1 46h18.4c1.9 0 2.73 2.39 1.23 3.56L46 51H17.5c-1.72 0-2.6-2.08-1.38-3.31L36.9 27H17c-1.66 0-2.5-2-1.34-3.2l.03-.03C16.05 22.3 16.5 22 17 22Z" fill="white"/>
  </svg>`;
}

function baseStyles() {
  return `
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Alata&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
    html{-webkit-text-size-adjust:100%;touch-action:manipulation}
    :root{
      --line:rgba(255,255,255,.09);
      --violet:#d8b4ff;
      --violet2:#b77cff;
      --pink:#ff6fd8;
      --muted:#c5bdd4;
      --ok:#93ffc2;
      --err:#ff86ae;
      --gold:#ffd56b;
      --glass:rgba(14,10,24,.78);
      --glass2:rgba(255,255,255,.05);
    }
    *{font-family:"Alata", Arial, sans-serif}
    body{
      margin:0;min-height:100vh;color:#fff;overflow:hidden;
      background:
        radial-gradient(circle at 12% 18%, rgba(170,90,255,.22), transparent 24%),
        radial-gradient(circle at 85% 18%, rgba(255,70,180,.18), transparent 24%),
        radial-gradient(circle at 50% 100%, rgba(135,80,255,.18), transparent 30%),
        linear-gradient(160deg,#040308,#0d0715,#080510);
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
    .orb.o1{width:200px;height:200px;left:-40px;top:12%;background:rgba(183,124,255,.32)}
    .orb.o2{width:240px;height:240px;right:-60px;top:30%;background:rgba(255,111,216,.24);animation-delay:-6s}
    .orb.o3{width:220px;height:220px;left:30%;bottom:-90px;background:rgba(130,96,255,.24);animation-delay:-10s}
    @keyframes scan{from{transform:translateY(-100%)}to{transform:translateY(100%)}}
    @keyframes moveDots{from{transform:translateY(0)}to{transform:translateY(80px)}}
    @keyframes glow{
      0%{box-shadow:0 0 18px rgba(183,124,255,.16),0 0 36px rgba(255,111,216,.05)}
      50%{box-shadow:0 0 34px rgba(183,124,255,.28),0 0 68px rgba(255,111,216,.11)}
      100%{box-shadow:0 0 18px rgba(183,124,255,.16),0 0 36px rgba(255,111,216,.05)}
    }
    @keyframes pulseText{
      0%{text-shadow:0 0 10px rgba(183,124,255,.25)}
      50%{text-shadow:0 0 18px rgba(255,111,216,.25)}
      100%{text-shadow:0 0 10px rgba(183,124,255,.25)}
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
      min-height:100vh;display:flex;align-items:center;justify-content:center;
      padding:18px;overflow:hidden;
    }
    .card{
      width:min(94vw,560px);max-height:calc(100vh - 34px);overflow:auto;
      border-radius:30px;background:var(--glass);
      border:1px solid rgba(215,180,255,.16);animation:glow 4.2s infinite;
      backdrop-filter:blur(16px);
      box-shadow:0 0 26px rgba(183,124,255,.15);
      overscroll-behavior:contain;
      position:relative;
    }
    .card::-webkit-scrollbar{width:0;height:0}
    .top{
      padding:22px 18px 16px;border-bottom:1px solid var(--line);
      position:relative;overflow:hidden
    }
    .top::before{
      content:"";position:absolute;inset:auto -10% -60% auto;width:280px;height:280px;
      background:radial-gradient(circle, rgba(183,124,255,.16), transparent 65%);
      pointer-events:none
    }
    .top::after{
      content:"";position:absolute;left:-20%;top:-1px;width:140%;height:4px;
      background:linear-gradient(90deg,transparent,var(--violet2),var(--pink),transparent);
      background-size:200% 100%;animation:neonBar 3s linear infinite
    }
    .brand{display:flex;align-items:center;gap:14px}
    .logoBox{
      width:74px;height:74px;border-radius:22px;overflow:hidden;
      box-shadow:0 0 18px rgba(183,124,255,.35);flex:0 0 74px;
      background:rgba(255,255,255,.04)
    }
    .title{margin:0;font-size:clamp(23px,5vw,31px);color:var(--violet);animation:pulseText 3s infinite}
    .sub{margin:6px 0 0;color:var(--muted);font-size:13px}
    .credit{margin-top:10px;color:var(--gold);font-size:12px;font-weight:700;letter-spacing:.6px}
    .content{padding:16px}
    .loginHero{
      position:relative;
      padding:18px;border-radius:24px;
      background:linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.03));
      border:1px solid var(--line);
      overflow:hidden;
      animation:popIn .45s ease;
    }
    .loginHero:before{
      content:"";position:absolute;right:-50px;top:-50px;width:180px;height:180px;border-radius:50%;
      background:radial-gradient(circle, rgba(255,111,216,.12), transparent 70%);
    }
    .loginHero:after{
      content:"";position:absolute;left:-40px;bottom:-40px;width:180px;height:180px;border-radius:50%;
      background:radial-gradient(circle, rgba(183,124,255,.12), transparent 70%);
    }
    .loginIntro{position:relative;z-index:1;margin-bottom:14px}
    .loginTitle{font-size:20px;color:#fff;margin:0 0 6px}
    .loginHint{margin:0;color:#cfc6db;font-size:13px;line-height:1.6}
    .input{
      width:100%;height:58px;border:none;outline:none;border-radius:18px;padding:0 16px;
      color:#fff;background:rgba(255,255,255,.06);border:1px solid var(--line);font-size:15px
    }
    .input:focus{
      border-color:rgba(200,107,255,.52);box-shadow:0 0 0 3px rgba(200,107,255,.08)
    }
    .btn,.smallBtn,.tab,.gameBtn{
      border:none;color:#fff;cursor:pointer;font-weight:700;border-radius:16px
    }
    .btn{
      width:100%;height:56px;margin-top:12px;
      background:linear-gradient(90deg,#8c52ff,#c86bff,#ff70c7);
      background-size:200% 100%;animation:neonBar 4s linear infinite;
      box-shadow:0 12px 24px rgba(160,90,255,.18)
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
      background:rgba(255,255,255,.06);border:1px solid var(--line);font-size:12px;color:#f0e6ff
    }
    .noticeBox{
      margin-top:12px;padding:13px 14px;border-radius:16px;background:linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.03));
      border:1px solid var(--line);font-size:13px;color:#efe7ff;line-height:1.6
    }
    .tabs{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin:16px 0 14px}
    .tab{height:44px;border-radius:14px;border:1px solid var(--line);background:rgba(255,255,255,.05);font-size:12px}
    .tab.active{background:linear-gradient(90deg,#8c52ff,#c86bff,#ff70c7)}
    .tabPane{display:none}
    .tabPane.active{display:block}
    .tile{
      padding:16px;border-radius:20px;margin-bottom:12px;
      background:linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.03));
      border:1px solid var(--line);position:relative;overflow:hidden;
      transition:transform .2s ease, box-shadow .2s ease
    }
    .tile:hover{transform:translateY(-2px);box-shadow:0 0 18px rgba(183,124,255,.12)}
    .tile::before{
      content:"";position:absolute;width:140px;height:140px;right:-40px;bottom:-40px;
      background:radial-gradient(circle, rgba(183,124,255,.14), transparent 65%)
    }
    .row{display:flex;align-items:center;justify-content:space-between;gap:12px;position:relative;z-index:1}
    .name{margin:0;font-size:16px}
    .desc{margin:6px 0 0;color:#c1b9d4;font-size:12px;line-height:1.5}
    .switch{position:relative;width:58px;height:32px;flex:0 0 58px}
    .switch input{display:none}
    .slider{
      position:absolute;inset:0;border-radius:999px;background:rgba(255,255,255,.14);
      border:1px solid rgba(255,255,255,.1);transition:.25s;cursor:pointer
    }
    .slider:before{
      content:"";position:absolute;width:24px;height:24px;left:4px;top:3px;border-radius:50%;
      background:#fff;transition:.25s
    }
    .switch input:checked + .slider{
      background:linear-gradient(90deg,#8c52ff,#ff70c7);box-shadow:0 0 18px rgba(200,107,255,.25)
    }
    .switch input:checked + .slider:before{transform:translateX(25px)}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .socialBtn,.gameBtn{
      display:flex;align-items:center;justify-content:center;gap:10px;height:52px;border-radius:16px;
      text-decoration:none;color:#fff;background:rgba(255,255,255,.07);border:1px solid var(--line);font-weight:700
    }
    .gameBtn{
      background:linear-gradient(90deg,rgba(140,82,255,.26),rgba(255,111,216,.20));
      box-shadow:0 10px 22px rgba(183,124,255,.12)
    }
    .socialBtn:hover,.gameBtn:hover{box-shadow:0 0 16px rgba(255,255,255,.08)}
    .footer{margin-top:10px;text-align:center;font-size:12px;color:#b9b0c9;line-height:1.7}
    .liveFx{
      margin-top:10px;padding:12px 14px;border-radius:16px;background:rgba(255,255,255,.05);
      border:1px solid var(--line);color:#f1e8ff;font-size:12px;min-height:96px;
      white-space:pre-wrap;line-height:1.55;
      box-shadow:inset 0 0 0 1px rgba(255,255,255,.03)
    }
    .fxLine{display:block;animation:pulseText 1.6s infinite}
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
      box-shadow:0 0 30px rgba(183,124,255,.28),0 0 70px rgba(255,111,216,.12);
      animation:glow 3s infinite, popIn .7s ease;
      background:rgba(255,255,255,.03);position:relative
    }
    .loadingLogo::after{
      content:"";position:absolute;inset:0;border-radius:28px;border:1px solid rgba(255,255,255,.09)
    }
    .loadingText{
      margin-top:18px;font-size:16px;color:var(--violet);font-weight:800;letter-spacing:1px;
      animation:pulseText 2s infinite;
    }
    .loadingSub{margin-top:8px;color:#cbbddf;font-size:12px}
    .loadingBar{
      width:min(260px,72vw);height:8px;border-radius:999px;margin-top:16px;background:rgba(255,255,255,.08);overflow:hidden;border:1px solid rgba(255,255,255,.08)
    }
    .loadingBar > span{
      display:block;height:100%;width:35%;
      background:linear-gradient(90deg,#8c52ff,#c86bff,#ff70c7);
      border-radius:999px;animation:neonBar 1.2s linear infinite;background-size:200% 100%
    }
    @media (max-width:560px){
      .tabs{grid-template-columns:repeat(3,1fr)}
      .grid2{grid-template-columns:1fr}
      .wrap{padding:12px}
      .card{width:min(96vw,560px);max-height:calc(100vh - 24px)}
      .brand{align-items:flex-start}
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
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  ${baseStyles()}
  <title>AimTrickHead</title>
</head>
<body>
  <div class="bgAura"><div class="orb o1"></div><div class="orb o2"></div><div class="orb o3"></div></div>
  <div class="wrap">
    <div class="card" style="max-width:460px">
      <div class="top">
        <div class="brand">
          <div class="logoBox">${renderLogo(74, 22)}</div>
          <div>
            <h1 class="title">AimTrickHead</h1>
            <div class="sub">Hệ thống đang hoạt động ổn định</div>
            <div class="credit">CRE HUY FANTA</div>
          </div>
        </div>
      </div>
      <div class="content">
        <div class="loginHero">
          <div class="loginIntro">
            <h2 class="loginTitle">Truy cập nhanh</h2>
            <p class="loginHint">Đi vào panel hoặc mở khu vực admin để quản lý key.</p>
          </div>
          <a class="gameBtn" href="/panel" style="margin-bottom:10px">Vào Panel</a>
          <a class="socialBtn" href="/admin">Admin</a>
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
  <title>AimTrickHead VIP</title>
  ${baseStyles()}
</head>
<body>
  <div class="bgAura"><div class="orb o1"></div><div class="orb o2"></div><div class="orb o3"></div></div>

  <div class="loadingLayer" id="loadingLayer">
    <div class="loadingLogo">${renderLogo(172, 28)}</div>
    <div class="loadingText">AimTrickHead VIP</div>
    <div class="loadingSub">Loading secure panel...</div>
    <div class="loadingBar"><span></span></div>
  </div>

  <div class="wrap">
    <div class="card">
      <div class="top">
        <div class="brand">
          <div class="logoBox">${renderLogo(74, 22)}</div>
          <div>
            <h1 class="title">AimTrickHead VIP</h1>
            <div class="sub">Key Acticve By Huy FanTa</div>
            <div class="credit">CRE  HUY FANTA</div>
          </div>
        </div>
      </div>

      <div class="content">
        <div id="loginView" class="loginHero">
          <div class="loginIntro">
            <h2 class="loginTitle">Đăng nhập Key</h2>
            <p class="loginHint">
              Nhập key đã được cấp để mở panel App Hỗ Trợ Kéo Tâm Trên Android Và iOS.
            </p>
          </div>
          <input id="keyInput" class="input" placeholder="Nhập Key Vào Đây">
          <button class="btn" onclick="dangNhap()">Đăng nhập</button>
          <div class="grid2" style="margin-top:10px">
            <a class="socialBtn" href="${ZALO_URL}" target="_blank" rel="noopener noreferrer">${iconZalo()} <span>Zalo</span></a>
            <a class="socialBtn" href="${FACEBOOK_URL}" target="_blank" rel="noopener noreferrer">${iconFacebook()} <span>Facebook</span></a>
          </div>
          <div id="msg" class="msg"></div>
        </div>

        <div id="panelView" class="hidden">
          <div class="topLine">
            <div class="pill">✨ VIP ACTIVE</div>
            <button class="smallBtn" onclick="dangXuat()">Thoát</button>
          </div>

          <div class="noticeBox" id="keyNotice">
            Key đang hoạt động.
          </div>

          <div class="tabs">
            <button class="tab active" data-tab="tab1">Main</button>
            <button class="tab" data-tab="tab2">Optimize</button>
            <button class="tab" data-tab="tab3">Game Boost</button>
            <button class="tab" data-tab="tab4">Social</button>
            <button class="tab" data-tab="tab5">Tools</button>
            <button class="tab" data-tab="tab6">TikTok</button>
          </div>

          <div id="tab1" class="tabPane active">
            <div class="tile"><div class="row"><div><p class="name">AimTrickHead</p><p class="desc">Bật Chức Năng Sau Đó Mở Mục TOOL Để Vào Game</p></div><label class="switch"><input type="checkbox" id="f2" onchange="toggleFx(this,'AimTrickHead')"><span class="slider"></span></label></div></div>
            <div class="tile"><div class="row"><div><p class="name">Bám Đầu</p><p class="desc">Tác dụng phản ngồi ngay sau khi bật</p></div><label class="switch"><input type="checkbox" id="f3" onchange="toggleFx(this,'Bám Đầu')"><span class="slider"></span></label></div></div>
            <div class="tile"><div class="row"><div><p class="name">Nhẹ Tâm</p><p class="desc">Tác dụng phản ngồi ngay sau khi bật</p></div><label class="switch"><input type="checkbox" id="f4" onchange="toggleFx(this,'Nhẹ Tâm')"><span class="slider"></span></label></div></div>
          </div>

          <div id="tab2" class="tabPane">
            <div class="tile"><div class="row"><div><p class="name">Tối Ưu Mạnh</p><p class="desc">Tác dụng phản ngồi ngay sau khi bật</p></div><label class="switch"><input type="checkbox" id="f5" onchange="toggleFx(this,'Tối Ưu Mạnh')"><span class="slider"></span></label></div></div>
            <div class="tile"><div class="row"><div><p class="name">Buff Nhạy x Nhẹ Tâm</p><p class="desc">Tác dụng phản ngồi ngay sau khi bật</p></div><label class="switch"><input type="checkbox" id="f6" onchange="toggleFx(this,'Buff Nhạy x Nhẹ Tâm')"><span class="slider"></span></label></div></div>
            <div class="tile">
              <p class="name">Sensi Control</p>
              <p class="desc">Tác dụng phản ngồi ngay sau khi bật</p>
              <div class="sliderWrap">
                <div class="rangeLabel"><span>Level</span><span id="sensiValue">60</span></div>
                <input type="range" min="1" max="120" value="60" id="sensiRange" oninput="updateSensi(this.value)">
              </div>
            </div>
          </div>

          <div id="tab3" class="tabPane">
            <div class="tile"><div class="row"><div><p class="name">Nhẹ Tâm + Fix Rung</p><p class="desc">Tác dụng phản ngồi ngay sau khi bật</p></div><label class="switch"><input type="checkbox" id="f1" onchange="toggleFx(this,'Nhẹ Tâm + Fix Rung')"><span class="slider"></span></label></div></div>
            <div class="tile"><div class="row"><div><p class="name">Game Boost</p><p class="desc">Tối ưu phản hồi và độ mượt ngay sau khi bật</p></div><label class="switch"><input type="checkbox" id="f7" onchange="toggleFx(this,'Game Boost')"><span class="slider"></span></label></div></div>
          </div>

          <div id="tab4" class="tabPane">
            <div class="grid2">
              <a class="socialBtn" href="${ZALO_URL}" target="_blank" rel="noopener noreferrer">${iconZalo()} <span>Liên hệ Zalo</span></a>
              <a class="socialBtn" href="${FACEBOOK_URL}" target="_blank" rel="noopener noreferrer">${iconFacebook()} <span>Facebook</span></a>
            </div>
            <div class="footer">Mua Key Vĩnh Viễn Hoặc Hỗ Trợ Liên Hệ.</div>
          </div>

          <div id="tab5" class="tabPane">
            <div class="grid2">
              <button class="gameBtn" onclick="openFF()">🎮 <span>Mở Free Fire</span></button>
              <button class="gameBtn" onclick="openFFMax()">🔥 <span>Mở FF MAX</span></button>
            </div>
            <div class="grid2" style="margin-top:10px">
              <a class="socialBtn" href="${FF_URL}" target="_blank" rel="noopener noreferrer">🌐 <span>Trang FF</span></a>
              <a class="socialBtn" href="${FF_MAX_URL}" target="_blank" rel="noopener noreferrer">🌐 <span>Trang FF MAX</span></a>
            </div>
            <div class="footer">Nút game hỗ trợ Android và iPhone. Nếu máy chưa mở thẳng app được sẽ chuyển sang link chính thức.</div>
          </div>

          <div id="tab6" class="tabPane">
            <div class="grid2">
              <a class="socialBtn" href="${TIKTOK_URL}" target="_blank" rel="noopener noreferrer">🎵 <span>TikTok</span></a>
              <a class="socialBtn" href="${ZALO_URL}" target="_blank" rel="noopener noreferrer">${iconZalo()} <span>Liên hệ Admin</span></a>
            </div>
            <div class="footer">
              Kênh tiktok share key trải nghiệm, anh em theo dõi kênh để lấy key sớm nhé.<br>
              Anh em muốn mua key vĩnh viễn cứ liên hệ admin.
            </div>
          </div>

          <div class="liveFx" id="liveFxBox"><span class="fxLine">⚡ Chờ kích hoạt module...</span></div>
        </div>
      </div>
    </div>
  </div>

  <div id="toast" class="toast"></div>

  <script>
    const msg = document.getElementById("msg");
    const loginView = document.getElementById("loginView");
    const panelView = document.getElementById("panelView");
    const toast = document.getElementById("toast");
    const liveFxBox = document.getElementById("liveFxBox");
    const sensiValue = document.getElementById("sensiValue");
    const loadingLayer = document.getElementById("loadingLayer");
    const keyNotice = document.getElementById("keyNotice");

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

    function writeFx(lines) {
      liveFxBox.innerHTML = lines.map(function(line){ return '<span class="fxLine">' + line + '</span>'; }).join("");
    }

    function startFxFeed() {
      clearInterval(fxTimer);
      const lines = [
        ["⚡ Đang Hoạt Động...", "↳ state cache verified", "↳ visual preset locked"],
        ["⚡ Rebinding panel states...", "↳ motion profile attached", "↳ touch response stabilized"],
        ["⚡ Mobile profile online...", "↳ latency route checked", "↳ ui stream healthy"],
        ["⚡ Optimize stream ready...", "↳ tabs warmed up", "↳ module standby ready"],
        ["⚡ Premium tabs active...", "↳ glow engine running", "↳ smooth render maintained"]
      ];
      let i = 0;
      fxTimer = setInterval(function () {
        writeFx(lines[i % lines.length]);
        i++;
      }, 1500);
    }

    function simulateCodeRun(label, isOn) {
      clearTimeout(codeTimer);
      const seq = [
        "> boot_module --name=" + label.replaceAll(" ", "_"),
        "> load_profile --tier=vip",
        "> attach_runtime --mode=" + (isOn ? "enable" : "disable"),
        isOn ? "> status => ACTIVE" : "> status => OFF"
      ];
      writeFx(seq);
      codeTimer = setTimeout(startFxFeed, 2200);
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

    function toggleFx(el, label) {
      luuTrangThai();
      simulateCodeRun(label, el.checked);
      showToast(label + (el.checked ? " đã bật" : " đã tắt"), el.checked ? "ok" : "err");
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

    function openByIntent(pkg, fallbackUrl) {
      if (isAndroid()) {
        const intentUrl = "intent://#Intent;package=" + encodeURIComponent(pkg) + ";end";
        window.location.href = intentUrl;
        setTimeout(function () {
          window.location.href = fallbackUrl;
        }, 1100);
        return;
      }
      window.location.href = fallbackUrl;
    }

    function openFF() {
      showToast("Đang mở Free Fire", "ok");
      if (isIOS()) {
        window.location.href = FF_IOS_SCHEME;
        setTimeout(function () {
          window.location.href = FF_IOS_STORE;
        }, 1100);
        return;
      }
      openByIntent(FF_ANDROID_PACKAGE, FF_URL);
    }

    function openFFMax() {
      showToast("Đang mở FF MAX", "ok");
      if (isIOS()) {
        window.location.href = FFMAX_IOS_SCHEME;
        setTimeout(function () {
          window.location.href = FFMAX_IOS_STORE;
        }, 1100);
        return;
      }
      openByIntent(FFMAX_ANDROID_PACKAGE, FF_MAX_URL);
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
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
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
            <h1 class="title">Admin Tạo Key</h1>
            <div class="sub">NguyenTanHUYADMIN</div>
            <div class="credit">CRE HUY FANTA</div>
          </div>
        </div>
      </div>
      <div class="content">
        <div class="loginHero">
          <input id="adminKey" class="input" type="password" placeholder="Admin Key">
          <input id="customKey" class="input" style="margin-top:10px" placeholder="Key muốn tạo (để trống = tự random)">
          <div class="grid2" style="margin-top:10px">
            <input id="uses" class="input" type="number" value="50" placeholder="Số thiết bị tối đa">
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

app.get("/admin", (req, res) => {
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

  if (!alreadyUsed) {
    if (item.usesLeft <= 0) {
      return res.json({ ok: false, msg: "Key đã hết lượt thiết bị" });
    }
    item.devices.push(device);
    item.usesLeft -= 1;
  }

  keys[key] = item;
  await saveStore();

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
  await saveStore();

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
    console.log("HUY NE");
  });
});
