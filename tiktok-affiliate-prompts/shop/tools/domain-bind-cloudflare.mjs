// ผูกโดเมนร้าน (ค่าเริ่มต้น `kopwang.com`) = deploy ร้านเข้า **บัญชี Cloudflare ของเจ้าของร้านเอง** พร้อม
// `custom_domain = true` ⇒ Cloudflare สร้าง DNS record + ใบรับรอง TLS ให้เอง แล้วอัปโหลดไฟล์สินค้าเข้า R2
//
// วิธีใช้:
//   1) สร้าง Cloudflare API token แบบจำกัดสิทธิ์ (ดูรายการสิทธิ์ด้านล่าง) แล้วเซฟเป็นไฟล์
//      `shop/.secrets/CLOUDFLARE_API_TOKEN`  ← ไฟล์เดียว · ห้าม commit · ห้ามพิมพ์ลงแชท
//   2) `node tools/check-cf-token.mjs`  ← ตรวจสิทธิ์โทเคนก่อน (บอกว่าขาดข้อไหน · exit 1 ถ้าไม่ครบ)
//   3) `node tools/domain-bind-cloudflare.mjs`
//      - เปลี่ยนโดเมน: `DOMAIN=example.com node tools/domain-bind-cloudflare.mjs`
//      - ไม่เอา www: `NO_WWW=1 …`
//      - โซนอยู่คนละบัญชี (ผูก custom domain ไม่ได้): ใช้ `NO_ROUTE=1 APP_ORIGIN=https://kopwang.com …`
//        = deploy ขึ้น workers.dev แต่ลิงก์ในอีเมลเป็นโดเมนจริง (ต้องมี CNAME proxy ในโซนที่ถือโดเมนชี้มาที่ workers.dev)
//      - โทเคนไม่มีสิทธิ์ R2 (403) แต่สร้าง bucket/อัปโหลดเองในแดชบอร์ดแล้ว: `R2_READY=1 …` (ข้ามขั้นที่ต้องใช้สิทธิ์ R2)
//      - โทเคนไม่มี **Zone · Workers Routes:Edit** ([[routes]] จะโดน 403) แต่มี Workers Scripts:Edit:
//        `BIND=api …` = deploy แบบไม่มี routes แล้วผูกโดเมนด้วย `PUT /accounts/{id}/workers/domains` แทน
//      - ตรวจ config เฉย ๆ ไม่แตะ Cloudflare: `D1_ID=<uuid เดิม> GEN_ONLY=1 …`
//
// สิทธิ์ของโทเคนที่ต้องมี (My Profile → API Tokens → Create Custom Token):
//   Account: **Workers Scripts:Edit** · **Workers R2 Storage:Edit** · **D1:Edit**
//   Zone (kopwang.com): **Zone:Read** (ให้สคริปต์หา account/zone เจอ) · **Workers Routes:Edit**
//   ⚠️ `custom_domain = true` ต้องมี **Workers Routes:Edit ระดับโซน** — Workers Scripts:Edit อย่างเดียวไม่พอ
//      (Cloudflare สร้าง DNS record + ใบรับรองให้เอง จึงไม่ต้องให้สิทธิ์ DNS:Edit)
//
// ⚠️ ตัวนี้ deploy เข้าบัญชีคุณเอง ⇒ D1/R2 เป็น **ฐานว่างใหม่** (ออเดอร์/ลูกค้าที่อยู่บนที่โฮสต์เดิมไม่ย้ายตาม)
//    และโค้ดอ่านค่าจาก env ทั้งหมด ⇒ secrets ถูก `wrangler secret put` จากไฟล์ใน `.secrets/` ให้อัตโนมัติ
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { zoneProblemHint } from "./zone-diag.mjs";

const SHOP = new URL("../", import.meta.url).pathname;
process.chdir(SHOP);

const DOMAIN = String(process.env.DOMAIN || "kopwang.com").trim().toLowerCase();
const WITH_WWW = process.env.NO_WWW !== "1" && DOMAIN.split(".").length === 2;
const TOKEN_FILE = process.env.TOKEN_FILE || ".secrets/CLOUDFLARE_API_TOKEN";
const D1_NAME = process.env.D1_NAME || "promptpack-orders";
const R2_NAME = process.env.R2_NAME || "promptpack-files";
const PDF_KEY = "prompt-pack.pdf";
// ต้องอยู่ที่ **รากโปรเจกต์** เท่านั้น: wrangler หา path ของ `main`/assets เทียบกับโฟลเดอร์ของไฟล์ config
const CFG = "wrangler.domain.toml";
const GEN_ONLY = process.env.GEN_ONLY === "1";
// NO_ROUTE=1 = deploy ขึ้น workers.dev ก่อนโดยยังไม่ผูกโดเมน (ใช้เมื่อโซนยังไม่ active)
//   · APP_ORIGIN จะถูกตั้งเป็น URL ของ workers.dev เอง · พอโซน active แล้วรันใหม่โดยไม่ต้อง NO_ROUTE เพื่อผูกโดเมน
const NO_ROUTE = process.env.NO_ROUTE === "1";
// R2_READY=1 = เจ้าของร้านสร้าง bucket + อัปโหลดไฟล์สินค้าทางแดชบอร์ดเองแล้ว ⇒ ข้ามขั้นที่ต้องใช้สิทธิ์ R2 ของโทเคน
//   (ต้องมี bucket `${R2_NAME}` และไฟล์ `prompt-pack.pdf` ในบัญชีนี้ก่อน ไม่งั้นร้านจะดาวน์โหลดไม่ได้)
const R2_READY = process.env.R2_READY === "1";
// BIND=api = ผูกโดเมนด้วย **Workers Custom Domains API** (`PUT /accounts/{id}/workers/domains`)
//   ใช้เมื่อโทเคนไม่มี **Zone · Workers Routes:Edit** ([[routes]] ของ wrangler จะโดน 403) แต่มี Workers Scripts:Edit
//   — deploy แบบไม่มี routes แล้วผูกโฮสต์ผ่าน API แทน (ผลลัพธ์เท่ากับ custom_domain = true)
const BIND_API = process.env.BIND === "api";
// APP_ORIGIN=... = ตั้งที่อยู่ในลิงก์อีเมลเอง (ใช้เมื่อโดเมนชี้มาที่นี่ด้วย CNAME proxy
// แทน custom domain — เช่นโซนอยู่คนละบัญชี จึงผูก custom domain ไม่ได้ แต่ยังอยากให้ลิงก์เป็นโดเมนจริง)
const ORIGIN_OVERRIDE = String(process.env.APP_ORIGIN || "").trim().replace(/\/+$/, "");
const WORKER_NAME = "promptpack-shop";

// ชื่อตัวแปรที่จะ “ตั้งเป็น secret” — ต้องไม่ซ้ำกับ [vars] ใน wrangler.toml (ไม่งั้น deploy จะชนกัน)
const SECRETS = [
  "PROMPTPAY_OPTIONS", "PROMPTPAY_LABELS", "PROMPTPAY_NAME",
  "PRODUCT_NAME", "PRICE_SATANG", "ADMIN_TOKEN", "DOWNLOAD_SIGNING_KEY",
  "RESEND_API_KEY", "EASYSLIP_API_KEY", "MAIL_FROM", "NOTIFY_EMAIL",
];
const VAR_KEYS_TO_DROP = new Set([...SECRETS, "PROMPTPAY_ID", "PROMPTPAY_BANK", "APP_ORIGIN", "REPLY_TO"]);

const log = (...a) => console.log(...a);
const die = (m) => { console.error("\n❌ " + m); process.exit(1); };
if (ORIGIN_OVERRIDE && !/^https:\/\/[^/]+$/i.test(ORIGIN_OVERRIDE)) die(`APP_ORIGIN ต้องเป็น https://โดเมน (ห้ามมี path) — ได้: ${ORIGIN_OVERRIDE}`);

/* ── 0) โทเคน ────────────────────────────────────────────────────────── */
const MAYBE_TOKEN = fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, "utf8").trim() : "";
if (!MAYBE_TOKEN && !(GEN_ONLY && process.env.D1_ID)) {
  die(`ไม่พบไฟล์ ${TOKEN_FILE}\n   สร้าง Cloudflare API token (สิทธิ์ตามหัวไฟล์นี้) แล้วเซฟค่าลงไฟล์นั้นก่อน\n   ตัวอย่าง:  nano ${TOKEN_FILE}   (บรรทัดเดียว ไม่ต้องมีเครื่องหมายคำพูด)`);
}
const TOKEN = MAYBE_TOKEN;
if (TOKEN) log(`🔑 อ่านโทเคนจาก ${TOKEN_FILE} — ${TOKEN.length} ตัว · sha256(8) = ${crypto.createHash("sha256").update(TOKEN).digest("hex").slice(0, 8)} (ไม่พิมพ์ค่าจริง)`);
else log(`🧪 โหมดตรวจ config อย่างเดียว (GEN_ONLY + D1_ID) — ไม่ใช้โทเคน ไม่แตะ Cloudflare`);
log(`🎯 เป้าหมาย: ${DOMAIN}${WITH_WWW ? ` + www.${DOMAIN}` : ""}\n`);

// CF_API_BASE ใช้สำหรับทดสอบกับ mock server ในเครื่อง (ปกติไม่ต้องตั้ง)
const API_BASE = process.env.CF_API_BASE || "https://api.cloudflare.com/client/v4";
const api = async (method, p, body) => {
  const r = await fetch(API_BASE + p, {
    method,
    headers: { authorization: "Bearer " + TOKEN, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok && json.success !== false, json };
};

/* ── 1) ตรวจโทเคน + หา account/zone ─────────────────────────────────── */
let ACC = process.env.CLOUDFLARE_ACCOUNT_ID || "";
let ZONE_ID = "";
if (!GEN_ONLY) {
  // ⚠️ โทเคนแบบ account-owned จะได้ 401 จาก /user/tokens/verify ทั้งที่ใช้ได้ ⇒ ต้องลองเส้นทางระดับบัญชีด้วย
  const v = await api("GET", "/user/tokens/verify");
  if (v.ok) log(`✅ โทเคนใช้งานได้ (แบบ user-level · status: ${v.json?.result?.status || "active"})`);
  else {
    let acc = ACC;
    if (!acc) {
      const a = await api("GET", "/accounts?per_page=1");
      acc = a.json?.result?.[0]?.id || "";
    }
    const av = acc ? await api("GET", `/accounts/${acc}/tokens/verify`) : null;
    if (!av?.ok) die(`โทเคนใช้ไม่ได้ (HTTP ${v.status}) — ${JSON.stringify(v.json?.errors || v.json)}\n   เช็คว่าคัดลอกมาครบทั้งเส้น และ token ยัง active`);
    ACC = acc;
    log(`✅ โทเคนใช้งานได้ (แบบ account-owned · status: ${av.json?.result?.status || "active"} — /user/tokens/verify จะได้ 401 เป็นปกติ)`);
  }

  const z = await api("GET", `/zones?name=${encodeURIComponent(DOMAIN)}`);
  const zone = z.json?.result?.[0];
  if (!zone) die(`โทเคนไม่เห็นโซน ${DOMAIN} — ต้องมีสิทธิ์ Zone:Read บนโซนนี้ และโดเมนต้องอยู่ในบัญชีเดียวกับโทเคน\n   (ตรวจ: Cloudflare → ${DOMAIN} → Overview ว่าอยู่บัญชีที่สร้างโทเคนไหม)`);
  // สิทธิ์ระดับโซนที่ต้องมีจริงสำหรับ custom domain: Workers Routes:Edit (ตรวจตอน deploy จะได้ error ชัด)
  ZONE_ID = zone.id;
  // ⚠️ โทเคนระดับผู้ใช้ที่เห็นหลายบัญชี: `/accounts?per_page=1` คืนบัญชีแรกซึ่งอาจไม่ใช่บัญชีของโซน
  //    ⇒ ถ้าไม่ได้ระบุ CLOUDFLARE_ACCOUNT_ID มาเอง ให้ยึด account ของโซน (ไม่งั้น D1/R2/Worker จะไปเกิดผิดบัญชี
  //      แล้วผูก custom domain ไม่สำเร็จเพราะ routes ต้องอยู่ในบัญชีของโซน)
  const zoneAcc = zone.account?.id || "";
  if (zoneAcc && !process.env.CLOUDFLARE_ACCOUNT_ID && ACC && ACC !== zoneAcc) {
    log(`ℹ️ โทเคนนี้เห็นหลายบัญชี — ใช้ account ของโซน ${DOMAIN}: ${zoneAcc.slice(0, 8)}… (เดิม ${ACC.slice(0, 8)}…)`);
    ACC = zoneAcc;
  }
  ACC = ACC || zoneAcc;
  if (!ACC) die("หา account id ไม่ได้ — ใส่ CLOUDFLARE_ACCOUNT_ID เองได้");
  // โซนต้อง active ก่อน ไม่งั้น custom_domain จะผูกไม่สำเร็จ (Workers Routes บนโซนที่ยัง pending ไม่ได้)
  if (!NO_ROUTE && String(zone.status || "").toLowerCase() !== "active") {
    const msg = (await zoneProblemHint(zone, { domain: DOMAIN, tokenFile: TOKEN_FILE })) +
      `\n   (ถ้าตั้งใจ deploy แบบยังไม่ผูกโดเมน: NO_ROUTE=1 จะข้ามการตรวจนี้)`;
    if (process.env.ALLOW_PENDING_ZONE !== "1") die(msg);
    log(`⚠️ โซนยังไม่ active — ข้ามไปต่อเพราะ ALLOW_PENDING_ZONE=1 (custom domain อาจไม่ผูก)`);
  } else if (NO_ROUTE) {
    log(`⚠️ NO_ROUTE=1 → ไม่ผูกโดเมน (โซนสถานะ ${zone.status}) — deploy ขึ้น workers.dev แทน`);
  }
  log(`✅ เจอโซน ${DOMAIN} (zone ${zone.id.slice(0, 8)}…) ในบัญชี ${ACC.slice(0, 8)}… · ตรวจว่ามีเรคคอร์ดชนกับโดเมนไหม: ${await hasConflictingRootRecord(ACC, ZONE_ID)}`);
}

async function hasConflictingRootRecord() {
  const r = await api("GET", `/zones/${ZONE_ID}/dns_records?name=${encodeURIComponent(DOMAIN)}`);
  // โทเคนอาจไม่มี DNS:Read (ไม่บังคับ) — อย่าบอกว่า “ไม่มีเรคคอร์ดชน” ทั้งที่อ่านไม่ได้
  if (!r.ok) return `ตรวจไม่ได้ (โทเคนไม่มี DNS:Read — HTTP ${r.status}) · ไม่กระทบการผูกโดเมน เพราะ Cloudflare สร้างเรคคอร์ดให้เอง`;
  const bad = (r.json?.result || []).filter((x) => x.type === "A" || x.type === "AAAA" || x.type === "CNAME");
  return bad.length ? `⚠️ มี ${bad.map((b) => b.type).join("/")} อยู่แล้ว — custom domain อาจสร้างไม่ได้ ต้องลบก่อน` : "ยังไม่มี A/AAAA/CNAME ที่ root (สร้าง custom domain ได้)";
}

/* ── 1.5) ตรวจสิทธิ์โทเคนให้ครบก่อนสร้างอะไรจริง ──────────────────────── */
// ตรวจทุกข้อที่ต้องใช้ (Workers Scripts · D1 · R2 · Workers Routes · Zone:Read) แล้วบอกว่าขาดข้อไหน
// ก่อนจะไปพลาดกลางทางตอน deploy — ข้ามได้ด้วย SKIP_PREFLIGHT=1
if (!GEN_ONLY && process.env.SKIP_PREFLIGHT !== "1") {
  log("\n🔎 ตรวจสิทธิ์โทเคนก่อนเริ่มสร้าง D1/R2 (ข้ามด้วย SKIP_PREFLIGHT=1)…");
  const pf = spawnSync(process.execPath, ["tools/check-cf-token.mjs"], {
    stdio: "inherit",
    env: { ...process.env, TOKEN_FILE, DOMAIN, CLOUDFLARE_ACCOUNT_ID: ACC, SKIP_ZONE_ACTIVE: NO_ROUTE ? "1" : "", SKIP_R2: R2_READY ? "1" : "" },
  });
  if (pf.status !== 0) {
    die("สิทธิ์โทเคนยังไม่ครบ — ดูข้อที่ขาดในตารางด้านบน\n   แก้ที่ dash.cloudflare.com/profile/api-tokens → Edit token → ติ๊กสิทธิ์ที่ขาด → Save\n   แล้วรันคำสั่งเดิมซ้ำ (หรือ SKIP_PREFLIGHT=1 ถ้าอยากลองต่อเอง)");
  }
  log("✅ สิทธิ์ครบทุกข้อ — เริ่ม deploy ได้");
}

/* ── 2) สร้าง D1 + R2 (มีอยู่แล้วก็ใช้ตัวเดิม) ─────────────────────────── */
let D1_ID = process.env.D1_ID || "";
if (!GEN_ONLY) {
  const created = await api("POST", `/accounts/${ACC}/d1/database`, { name: D1_NAME });
  if (created.ok) { D1_ID = created.json.result.uuid; log(`✅ สร้าง D1 "${D1_NAME}" → ${D1_ID}`); }
  else {
    const list = await api("GET", `/accounts/${ACC}/d1/database`);
    const found = (list.json?.result || []).find((d) => d.name === D1_NAME);
    if (!found) die(`สร้าง D1 ไม่ได้ และหา "${D1_NAME}" ไม่เจอ — ${JSON.stringify(created.json?.errors || created.json)}\n   ⚠️ ถ้าเป็น 10000/Authentication error: โทเคน “อ่าน” ได้แต่ “สร้าง” ไม่ได้ ⇒ ต้องเป็น **Account · D1 · Edit**\n   ตรวจก่อนด้วย: TOKEN_FILE=${TOKEN_FILE} PROBE_EDIT=1 node tools/check-cf-token.mjs`);
    D1_ID = found.uuid; log(`ℹ️ ใช้ D1 เดิม "${D1_NAME}" → ${D1_ID}`);
  }
  const b = R2_READY ? { ok: false, json: {} } : await api("POST", `/accounts/${ACC}/r2/buckets`, { name: R2_NAME });
  if (R2_READY) log(`ℹ️ R2_READY=1 → ข้ามการสร้าง bucket (ใช้อันที่คุณสร้างเอง: ${R2_NAME} + ${PDF_KEY} ต้องมีอยู่แล้ว)`);
  else if (b.ok) log(`✅ สร้าง R2 "${R2_NAME}"`);
  else if (/exist/i.test(JSON.stringify(b.json?.errors || ""))) log(`ℹ️ ใช้ R2 เดิม "${R2_NAME}"`);
  else if ((b.json?.errors || []).some((e) => e.code === 10042)) die("R2 ยังไม่ได้เปิดใช้ในบัญชีนี้ (code 10042) — ไม่ใช่ปัญหาสิทธิ์ของโทเคน\n   เปิดที่ dash.cloudflare.com → R2 Object Storage → Enable แล้วรันคำสั่งเดิมซ้ำ");
  else die(`สร้าง R2 ไม่ได้ — ${JSON.stringify(b.json?.errors || b.json)} (ต้องมีสิทธิ์ Workers R2 Storage:Edit)`);
}
if (!D1_ID) die("ไม่มี D1_ID — ใส่ D1_ID=<uuid> หรือรันโดยไม่ตั้ง GEN_ONLY");

/* ── 3) สร้าง config สำหรับ deploy (ไม่แก้ wrangler.toml ต้นฉบับ) ────────── */
const src = fs.readFileSync("wrangler.toml", "utf8").split("\n");
const out = [];
let inVars = false;
for (const line of src) {
  if (/^\[vars\]/.test(line)) inVars = true;
  else if (/^\[/.test(line)) inVars = false;
  const key = (line.match(/^([A-Z0-9_]+)\s*=/) || [])[1];
  if (inVars && key && VAR_KEYS_TO_DROP.has(key)) continue; // ตัวที่จะตั้งเป็น secret — ห้ามซ้ำ
  if (/^database_id\s*=/.test(line)) { out.push(`database_id = "${D1_ID}"`); continue; }
  if (/^bucket_name\s*=/.test(line)) { out.push(`bucket_name = "${R2_NAME}"`); continue; }
  if (/^name\s*=/.test(line)) {
    out.push(`name = "promptpack-shop"`);
    out.push("keep_vars = true   # อย่าลบ secret/var เดิมตอน deploy (ต้องเป็นคีย์ระดับบนสุด — ก่อน [vars])");
    continue;
  }
  out.push(line);
}
if (!NO_ROUTE && !BIND_API) {
  out.push("");
  out.push("[[routes]]");
  out.push(`pattern = "${DOMAIN}"`);
  out.push("custom_domain = true");
  if (WITH_WWW) {
    out.push("");
    out.push("[[routes]]");
    out.push(`pattern = "www.${DOMAIN}"`);
    out.push("custom_domain = true");
  }
}
fs.writeFileSync(CFG, out.join("\n") + "\n");
log(`✅ เขียน config สำหรับ deploy: ${CFG} (routes: ${NO_ROUTE ? "ไม่มี (NO_ROUTE=1)" : BIND_API ? "ไม่มี — จะผูกโดเมนผ่าน Custom Domains API" : `${DOMAIN}${WITH_WWW ? ` + www.${DOMAIN}` : ""}`})`);

if (GEN_ONLY) {
  log("\n🧪 GEN_ONLY=1 → หยุดแค่นี้ (ไม่ได้แตะ Cloudflare) · ตรวจ config ต่อได้ด้วย:");
  log(`   npx wrangler deploy --dry-run -c ${CFG}`);
  process.exit(0);
}

/* ── 4) deploy + secrets + ไฟล์สินค้า ─────────────────────────────────── */
const ENV = { ...process.env, CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: ACC };
const run = (args, input) => {
  log(`\n▶ npx wrangler ${args.join(" ")}`);
  const r = spawnSync("npx", ["--yes", "wrangler", ...args], { stdio: [input === undefined ? "inherit" : "pipe", "inherit", "inherit"], env: ENV, input });
  if (r.status !== 0) die(`wrangler ${args[0]} ล้มเหลว (exit ${r.status}) — อ่านข้อความด้านบน\n   ถ้าเป็น “Authentication error” = โทเคนขาดสิทธิ์: ที่พบบ่อยสุดคือลืม **Workers Routes:Edit (ระดับโซน)** ซึ่งจำเป็นสำหรับ custom domain`);
};

// deploy — โหมด NO_ROUTE ต้องเก็บ stdout ไว้หา URL ของ workers.dev
let deployOut = "";
if (NO_ROUTE) {
  log(`\n▶ npx wrangler deploy -c ${CFG}`);
  const r = spawnSync("npx", ["--yes", "wrangler", "deploy", "-c", CFG], { encoding: "utf8", env: ENV });
  deployOut = (r.stdout || "") + (r.stderr || "");
  process.stdout.write(deployOut);
  if (r.status !== 0) die(`wrangler deploy ล้มเหลว (exit ${r.status}) — อ่านข้อความด้านบน`);
} else {
  run(["deploy", "-c", CFG]);
}

/* ── 4.05) BIND=api → ผูกโดเมนผ่าน Workers Custom Domains API ────────── */
if (BIND_API && !NO_ROUTE) {
  for (const host of [DOMAIN, ...(WITH_WWW ? [`www.${DOMAIN}`] : [])]) {
    const r = await api("PUT", `/accounts/${ACC}/workers/domains`, { zone_id: ZONE_ID, hostname: host, service: WORKER_NAME, environment: "production" });
    if (!r.ok) die(`ผูก custom domain ${host} ไม่สำเร็จ — ${JSON.stringify(r.json?.errors || r.json)}\n` +
      `   ⚠️ ต้องมีสิทธิ์ **Workers Scripts:Edit** (และโซน ${DOMAIN} ต้องอยู่บัญชีนี้) · ถ้าอยากให้ Cloudflare สร้างเรคคอร์ดผ่าน [[routes]] แทน\n` +
      `      ให้เพิ่ม **Zone ${DOMAIN} · Workers Routes:Edit** ที่โทเคน แล้วรันใหม่โดยไม่ใส่ BIND=api`);
    log(`✅ ผูก custom domain ${host} → ${WORKER_NAME} (cert ${String(r.json?.result?.cert_id || "-").slice(0, 8)}…)`);
  }
}

/* ── 4.1) หา origin จริง (โดเมน หรือ workers.dev) ───────────────────── */
// ORIGIN = ที่อยู่ในลิงก์อีเมล · PROBE = ที่จะยิงตรวจสุขภาพ (ต้องเป็นที่ที่ตอบได้จริงตอนนี้)
let ORIGIN = ORIGIN_OVERRIDE || `https://${DOMAIN}`;
let PROBE = ORIGIN;
if (NO_ROUTE) {
  const sub = await api("GET", `/accounts/${ACC}/workers/subdomain`);
  const subName = sub.json?.result?.subdomain || "";
  const fromApi = subName ? `https://${WORKER_NAME}.${subName}.workers.dev` : "";
  const fromOut = (deployOut.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/i) || [])[0] || "";
  PROBE = fromApi || fromOut;
  if (!PROBE) die("NO_ROUTE=1 แต่หา URL ของ workers.dev ไม่ได้\n   เปิดใช้ subdomain ที่ dash → Workers & Pages → Your subdomain แล้วรันซ้ำ\n   หรือรันครั้งต่อไปแบบไม่ใส่ NO_ROUTE เมื่อโซน active");
  ORIGIN = ORIGIN_OVERRIDE || PROBE;
  log(`ℹ️ origin สำหรับลิงก์ในอีเมล: ${ORIGIN}${PROBE !== ORIGIN ? ` · ตรวจสุขภาพที่ ${PROBE}` : ""}`);
}

const stamp = new Date().toISOString();
fs.writeFileSync(".secrets/APP_ORIGIN", ORIGIN); // ที่อยู่ในบัญชีตัวเองใช้ APP_ORIGIN ได้ (Sites สงวนชื่อนี้)
for (const name of [...SECRETS, "APP_ORIGIN"]) {
  const f = `.secrets/${name}`;
  if (!fs.existsSync(f)) { log(`⚠️ ข้าม secret ${name} — ไม่มีไฟล์ ${f}`); continue; }
  run(["secret", "put", name, "-c", CFG], fs.readFileSync(f, "utf8"));
}
log(`✅ secrets ตั้งครบ (${stamp}) — APP_ORIGIN=${ORIGIN}`);

if (R2_READY) log(`ℹ️ R2_READY=1 → ข้ามการอัปโหลด ${PDF_KEY}`);
else if (fs.existsSync("build/prompt-pack.pdf")) {
  // ⚠️ ต้องมี --remote เท่านั้น ไม่งั้น wrangler จะอัปโหลดเข้า R2 จำลองในเครื่อง (ขึ้น “Resource location: local”)
  run(["r2", "object", "put", `${R2_NAME}/${PDF_KEY}`, "--file", "build/prompt-pack.pdf", "--content-type", "application/pdf", "--remote"]);
  log(`✅ อัปโหลดไฟล์สินค้า ${PDF_KEY} (${fs.statSync("build/prompt-pack.pdf").size} ไบต์) ขึ้น R2 "${R2_NAME}"`);
}

/* ── 5) ตรวจปลายทาง ─────────────────────────────────────────────────── */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
log(NO_ROUTE ? `\n⏳ ตรวจ ${PROBE}/api/health (workers.dev พร้อมเกือบทันที)…` : `\n⏳ รอใบรับรอง/DNS ของ ${DOMAIN} พร้อม (สูงสุด ~3 นาที)…`);
let health = null;
for (let i = 1; i <= 18; i++) {
  try {
    const r = await fetch(`${PROBE}/api/health`, { redirect: "follow" });
    if (r.status === 200) { health = await r.json(); break; }
    log(`   รอบ ${i}: HTTP ${r.status} — รอต่อ…`);
  } catch (e) { log(`   รอบ ${i}: ${String(e.message || e).slice(0, 80)} — รอต่อ…`); }
  await wait(NO_ROUTE ? 3000 : 10000);
}
if (!health) die(`ยังยิง ${PROBE}/api/health ไม่ผ่าน — ดูสถานะที่ Cloudflare → Workers & Pages → ${WORKER_NAME}`);
log(`✅ ${PROBE}/api/health = 200 · ราคา ${health.price_satang} สตางค์ · พร้อมเพย์ ${health.payment?.promptpay_options?.length || 0} ช่อง · D1=${health.storage?.d1} R2=${health.storage?.r2} · อีเมล=${health.email_configured} · แจ้งร้าน=${health.notify_configured} · app_origin=${health.app_origin}`);

for (const p of ["/", "/order", "/30day", "/free", "/links", "/retrieve", "/terms", "/privacy", "/refund"]) {
  const r = await fetch(`${PROBE}${p}`).catch(() => null);
  log(`   ${(r?.status === 200 ? "✅" : "❌")} ${p} → ${r ? r.status : "error"}`);
}
log(`\n🎉 เสร็จ: ร้านอยู่บน ${ORIGIN} แล้ว`);
if (NO_ROUTE) log(`   📌 ยังไม่ผูก ${DOMAIN} — พอโซน active แล้วรัน \`node tools/domain-bind-cloudflare.mjs\` อีกครั้ง (ไม่ต้องใส่ NO_ROUTE)`);
log("   ตรวจต่อ (กินออเดอร์/อีเมลจริง 1 ใบ แต่ลบให้เอง):");
log(`   BASE=${ORIGIN} node tools/prod-go-live.mjs`);
log("   และที่ต้องทำด้วยมือ: สแกน build/scan-test.html → ต้องขึ้นชื่อบัญชีร้าน");
