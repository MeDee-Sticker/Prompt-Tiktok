/**
 * 599 Prompt ก๊อปวาง — Shop Worker (Cloudflare Worker, vanilla fetch, no deps)
 * ขาย PDF ราคา 99 บาท · รับเงินเข้าพร้อมเพย์ของร้านโดยตรง (ไม่ต้องมี Payment Gateway)
 * + ลูกค้าแจ้งโอน/แนบสลิป → ร้านกดอนุมัติ (หรือตรวจสลิปอัตโนมัติถ้าตั้งคีย์ EasySlip)
 * + ส่งลิงก์โหลดทางอีเมลอัตโนมัติ (Resend) + ขอลิงก์ซ้ำได้ + หน้าคุมออเดอร์
 *
 * POST /api/checkout              สร้างออเดอร์ + คืน QR พร้อมเพย์ (SVG + payload)
 * GET  /api/order/:id             สถานะออเดอร์ (ให้หน้าขาย polling)
 * POST /api/order/:id/report      ลูกค้าแจ้งโอน + แนบสลิป/วางข้อความ QR → ตรวจอัตโนมัติ + อนุมัติเองถ้าครบเงื่อนไข
 * GET  /paid?order=:id            คืน signed download URL (หลัง paid)
 * GET  /api/download/:token       ดาวน์โหลด PDF จาก R2 (ตรวจลายเซ็น + อายุ + สถานะ paid)
 * POST /api/retrieve              ขอลิงก์โหลดซ้ำด้วยอีเมล (จำกัดจำนวนครั้ง/ชม.)
 * GET  /api/free                  ของแถม: 5 prompt แรกของแพ็ก (metadata + ตัวอย่างเต็ม 1 ชุด)
 * POST /api/free                  เก็บอีเมลผู้สนใจ + ส่ง 5 prompt แรกให้ทางอีเมล (จำกัดจำนวนครั้ง/ชม.)
 * GET/POST /unsubscribe           ยกเลิกรับอีเมล (List-Unsubscribe + one-click · ลายเซ็นผูกกับอีเมล)
 * GET  /api/qr?p=/links           QR (SVG) ของลิงก์ในเว็บนี้ สำหรับหน้าคลังลิงก์ในไบโอ /links
 * POST /api/webhook/omise         (ทางเลือก) callback ของ Omise/Opn เมื่อตั้ง PAYMENT_PROVIDER=omise
 * GET  /api/pack                  เวอร์ชันแพ็กปัจจุบัน + ประวัติเวอร์ชัน (เปิดเผยได้ · หน้าเว็บใช้โชว์ “อัปเดตฟรี”)
 * GET  /api/health                สถานะพร้อมใช้งาน (ไม่เปิดเผยค่าความลับ)
 * GET  /admin/orders              รายการคำสั่งซื้อ (ต้องมี ADMIN_TOKEN)
 * GET  /admin/leads               รายชื่ออีเมลคนที่รับของแถม (ต้องมี ADMIN_TOKEN) · /admin/leads.csv = ไฟล์ส่งออก
 * POST /admin/leads/delete        ลบอีเมลผู้สนใจตามคำขอ (ต้องมี ADMIN_TOKEN)
 * POST /admin/orders/:id/approve  ยืนยันว่าได้รับเงินแล้ว → mark paid + ส่งอีเมลลิงก์โหลด
 * POST /admin/orders/:id/reject   ปฏิเสธ (สลิปไม่ถูกต้อง ฯลฯ)
 * GET  /admin/slip/:id            ดูสลิปที่ลูกค้าแนบ (ต้องมี ADMIN_TOKEN)
 * GET  /admin/pack                เวอร์ชันแพ็กปัจจุบัน + ทะเบียนลูกค้า/สถานะการแจ้งเตือน (ต้องมี ADMIN_TOKEN)
 * POST /admin/pack/publish        ออกรุ่นใหม่ (multipart: file + version …) → เก็บไฟล์เดิมไว้ + ตั้งรุ่นใหม่เป็น current
 * POST /admin/pack/notify         แจ้งลูกค้าคนเดิมว่า “มีเวอร์ชันใหม่” ทีละชุด (เรียกซ้ำได้จนจบ · ต้องมี ADMIN_TOKEN)
 * GET  /admin/pack/customers.csv  ทะเบียนลูกค้าเป็น CSV (ต้องมี ADMIN_TOKEN)
 * GET  /*                         เสิร์ฟหน้า static (index/thank-you/retrieve/legal/admin)
 */

import { buildPromptPayPayload, parsePromptPayOptions, slipReceiverMatches } from "./promptpay.mjs";
import { qrSvg } from "./qr.mjs";
import { FREE_SAMPLES, FREE_SAMPLE_META } from "./free-sample.mjs";
import { PACK_RELEASE, PACK_UPDATE_PROMISE } from "./pack-version.mjs";

const enc = new TextEncoder();
const dec = new TextDecoder();

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });

const b64url = (bytes) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function hmacKey(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, typeof data === "string" ? enc.encode(data) : data));
}
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const safeEqual = (a, b) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};
const isEmail = (s) => typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** คำขอข้ามโดเมน (CSRF) → ปฏิเสธ (ถ้าไม่มี Origin เช่น curl/เทสต์ ถือว่าผ่าน) */
function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

const PAYMENT_PROVIDER = (env) => String(env.PAYMENT_PROVIDER || "promptpay").toLowerCase();
const priceSatang = (env) => Number(env.PRICE_SATANG || 9900);
/** เวลาปัจจุบันในรูปแบบเดียวกับ SQLite datetime('now') (UTC) — ใช้ bind แทนการเขียนฟังก์ชันลงใน SQL */
const sqlNow = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const NEW_ORDER_STATUSES = ["pending", "reported"]; // สถานะที่ยังแก้ไขได้

/* ---------- สร้าง/อัปเดตตารางอัตโนมัติ (idempotent) — กัน deploy ใหม่แล้วเจอ "no such table" ---------- */
// หมายเหตุ: D1 `exec()` แยกคำสั่งตาม "บรรทัด" → ต้องเขียน 1 คำสั่งต่อ 1 บรรทัด ห้ามขึ้นบรรทัดในวงเล็บ
const SCHEMA_SQL = [
  "CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, email TEXT, amount_satang INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'THB', status TEXT NOT NULL DEFAULT 'pending', provider TEXT NOT NULL DEFAULT 'promptpay', charge_id TEXT, qr_content TEXT, qr_image_url TEXT, download_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), paid_at TEXT, emailed_at TEXT);",
  "CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);",
  "CREATE INDEX IF NOT EXISTS idx_orders_charge ON orders(charge_id);",
  "CREATE INDEX IF NOT EXISTS idx_orders_email ON orders(email);",
  "CREATE TABLE IF NOT EXISTS email_log (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT, email TEXT, kind TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));",
  "CREATE INDEX IF NOT EXISTS idx_email_log_email ON email_log(email, kind, created_at);",
  // leads = อีเมลคนที่มารับของแถม 5 prompt ฟรี (หน้า /free) — เก็บเท่าที่จำเป็น: อีเมล + ที่มา + เวลา + hash ของ IP (กันสแปม)
  "CREATE TABLE IF NOT EXISTS leads (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, source TEXT, consent_at TEXT, ip_hash TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), last_sent_at TEXT);",
  "CREATE INDEX IF NOT EXISTS idx_leads_ip ON leads(ip_hash, created_at);",
  // pack_versions = ทะเบียนเวอร์ชันที่เคยออก (เก็บไฟล์เดิมไว้ที่ versions/… ไม่ทับกัน → ย้อนดูได้)
  "CREATE TABLE IF NOT EXISTS pack_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, version TEXT NOT NULL, prompts INTEGER, niches INTEGER, pages INTEGER, object_key TEXT NOT NULL DEFAULT 'prompt-pack.pdf', bytes INTEGER, sha256 TEXT, notes TEXT, is_current INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), notified_at TEXT, notified_count INTEGER NOT NULL DEFAULT 0, notify_failed INTEGER NOT NULL DEFAULT 0);",
  "CREATE INDEX IF NOT EXISTS idx_pack_versions_current ON pack_versions(is_current, id);",
  // subscribers = ทะเบียนลูกค้าที่ซื้อแล้ว (คีย์ = อีเมล) → ใช้แจ้ง “มีเวอร์ชันใหม่” และบอกว่าใครตามหลังอยู่
  "CREATE TABLE IF NOT EXISTS subscribers (email TEXT PRIMARY KEY, first_order_id TEXT, last_order_id TEXT, orders_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT, last_download_version TEXT, last_notified_version TEXT NOT NULL DEFAULT '', notified_at TEXT, unsubscribed_at TEXT);",
  "CREATE INDEX IF NOT EXISTS idx_subscribers_notify ON subscribers(last_notified_version);",
].join("\n");

// คอลัมน์ที่เพิ่มมาทีหลัง (สำหรับฐานข้อมูลที่สร้างไปแล้ว) — ensureSchema จะเติมให้อัตโนมัติ
const COLUMNS = [
  ["reported_at", "ALTER TABLE orders ADD COLUMN reported_at TEXT"],
  ["slip_key", "ALTER TABLE orders ADD COLUMN slip_key TEXT"],
  ["slip_mime", "ALTER TABLE orders ADD COLUMN slip_mime TEXT"],
  ["slip_bytes", "ALTER TABLE orders ADD COLUMN slip_bytes INTEGER"],
  ["trans_ref", "ALTER TABLE orders ADD COLUMN trans_ref TEXT"],
  ["verify_source", "ALTER TABLE orders ADD COLUMN verify_source TEXT"],
  ["review_note", "ALTER TABLE orders ADD COLUMN review_note TEXT"],
  ["pay_target", "ALTER TABLE orders ADD COLUMN pay_target TEXT"],
  ["pay_target_label", "ALTER TABLE orders ADD COLUMN pay_target_label TEXT"],
  ["verify_attempts", "ALTER TABLE orders ADD COLUMN verify_attempts INTEGER NOT NULL DEFAULT 0"],
  ["verify_note", "ALTER TABLE orders ADD COLUMN verify_note TEXT"],
  ["verify_mode", "ALTER TABLE orders ADD COLUMN verify_mode TEXT"],
  ["last_download_version", "ALTER TABLE orders ADD COLUMN last_download_version TEXT"],
];
const UNIQUE_TRANSREF_SQL =
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_transref ON orders(trans_ref) WHERE trans_ref IS NOT NULL;";

let schemaReady = null;
async function ensureSchema(env) {
  if (!env.DB || typeof env.DB.exec !== "function") return; // mock/เทสต์ไม่มี exec → ข้ามได้
  if (!schemaReady) {
    schemaReady = (async () => {
      await env.DB.exec(SCHEMA_SQL);
      // เติมคอลัมน์ที่เพิ่มมาทีหลัง (ฐานข้อมูลเดิมยังไม่มี) — ถ้าถาม PRAGMA ไม่ได้ก็ลอง ALTER แล้วข้าม "duplicate column"
      let have = null;
      try {
        const info = await env.DB.prepare("PRAGMA table_info(orders)").all();
        have = new Set((info?.results || []).map((r) => r.name));
      } catch { have = null; }
      for (const [name, sql] of COLUMNS) {
        if (have && have.has(name)) continue;
        try { await env.DB.exec(sql); } catch (e) {
          if (!/duplicate column name/i.test(String(e?.message || e))) throw e;
        }
      }
      await env.DB.exec(UNIQUE_TRANSREF_SQL);
    })().catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

/* ---------- signed download token: base64url(orderId:expUnix).hmac ---------- */
async function makeDownloadToken(env, orderId, ttlHours = null) {
  const ttlH = Number(ttlHours ?? (env.DOWNLOAD_TTL_HOURS || 24));
  const exp = Math.floor(Date.now() / 1000) + ttlH * 3600;
  const payload = `${orderId}:${exp}`;
  const sig = b64url(await hmacKey(env.DOWNLOAD_SIGNING_KEY || "dev-signing-key", payload));
  return `${b64url(enc.encode(payload))}.${sig}`;
}
async function verifyDownloadToken(env, token) {
  try {
    const [p, sig] = token.split(".");
    const payload = dec.decode(unb64url(p));
    const expected = b64url(await hmacKey(env.DOWNLOAD_SIGNING_KEY || "dev-signing-key", payload));
    if (!safeEqual(sig, expected)) return null;
    const [orderId, expStr] = payload.split(":");
    if (Number(expStr) * 1000 < Date.now()) return null; // หมดอายุ
    return orderId;
  } catch { return null; }
}
/** โดเมนสำหรับลิงก์ในอีเมล — ใช้ APP_ORIGIN ถ้าตั้งไว้ ไม่งั้นใช้ origin ของคำขอเป็น fallback */
const appOrigin = (env, request) => env.APP_ORIGIN || new URL(request.url).origin;
const downloadUrl = async (env, orderId, origin, ttlHours = null) =>
  `${origin}/api/download/${await makeDownloadToken(env, orderId, ttlHours)}`;

/* ===================== แพ็กอัปเดตตัวเอง (version registry) =====================
 * แนวคิด: ลิงก์ดาวน์โหลดทุกอันชี้ไปที่ “ไฟล์ปัจจุบัน” ไม่ผูกกับเวอร์ชัน
 * → ออกรุ่นใหม่แล้ว ลูกค้าเก่ากดลิงก์เดิมก็ได้ไฟล์ใหม่ทันที (ไม่ต้องซื้อซ้ำ/ไม่ต้องมีระบบสมาชิก)
 * ที่เหลือคือ “บอกให้รู้” → ทะเบียน subscribers + อีเมลแจ้งเวอร์ชันใหม่ (ยิงเป็นชุด เรียกซ้ำได้)
 */

/** ค่าเริ่มต้นจาก pack-version.mjs (ใช้เมื่อยังไม่เคยออกรุ่นผ่านหลังบ้าน) */
const releaseDefaults = () => ({
  version: String(PACK_RELEASE.version),
  prompts: Number(PACK_RELEASE.prompts),
  niches: Number(PACK_RELEASE.niches),
  languages: Number(PACK_RELEASE.languages || 2),
  updated_at: PACK_RELEASE.updated_at || null,
  title: PACK_RELEASE.title,
  highlights: PACK_RELEASE.highlights || "",
  source: "code",
});

/** เวอร์ชันปัจจุบันของแพ็ก: แถว is_current ใน D1 ถ้ามี ไม่งั้นใช้ค่าในโค้ด */
const PACK_VERSION_COLUMNS = "version, prompts, niches, pages, object_key, bytes, sha256, notes, is_current, created_at, notified_at, notified_count, notify_failed";

async function packInfo(env) {
  const base = releaseDefaults();
  if (!env.DB) return { ...base, published_at: null, notes: null, prompts: base.prompts };
  const row = await env.DB.prepare(
    `SELECT ${PACK_VERSION_COLUMNS} FROM pack_versions WHERE is_current = 1 ORDER BY id DESC LIMIT 1`
  ).first().catch(() => null);
  if (!row) return { ...base, published_at: null, notes: null };
  return {
    ...base,
    version: row.version || base.version,
    prompts: Number(row.prompts || base.prompts),
    niches: Number(row.niches || base.niches),
    pages: row.pages ?? null,
    bytes: row.bytes ?? null,
    sha256: row.sha256 || null,
    notes: row.notes || null,
    object_key: row.object_key || base.object_key,
    published_at: row.created_at || null,
    notified_at: row.notified_at || null,
    notified_count: Number(row.notified_count || 0),
    notify_failed: Number(row.notify_failed || 0),
    source: "published",
  };
}

/** รับเฉพาะเวอร์ชันรูปแบบ x / x.y / x.y.z (มี -suffix ได้) — กันค่าแปลก ๆ ที่จะไปโผล่เป็นชื่อไฟล์/หัวอีเมล */
function safeVersion(raw) {
  const s = String(raw ?? "").trim().replace(/^v/i, "");
  return /^\d{1,3}(\.\d{1,3}){0,2}([-.][A-Za-z0-9]{1,12})?$/.test(s) ? s : null;
}
const sha256Hex = async (bytes) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));

/** จำนวนลูกค้าที่ยังไม่ได้รับแจ้งเวอร์ชันนั้น (ยกเลิกรับแล้ว = ไม่นับ) */
const subscribersPending = async (env, version) => countRows(env, "SELECT COUNT(*) AS n FROM subscribers WHERE unsubscribed_at IS NULL AND last_notified_version <> ?", version);

/**
 * “ซ่อมทะเบียนลูกค้าอัตโนมัติ” — ลูกค้าที่ซื้อ *ก่อน* มีตาราง subscribers (หรือก่อนที่ระบบจะบันทึก)
 * มีแถวอยู่ใน orders แล้ว แต่ยังไม่มีในทะเบียน → ถ้าไม่ดึงมาจะไม่ได้รับอีเมลแจ้งเวอร์ชันใหม่ทั้งที่ควรได้
 * INSERT OR IGNORE ⇒ เรียกซ้ำได้ ไมทับข้อมูลเดิม (วันที่/จำนวนออเดอร์ของคนที่มีอยู่แล้วไม่ถูกเขียนทับ) · กันซ้ำด้วยอีเมล
 * จำกัด 200 แถวต่อครั้ง เพื่อไม่ให้คำขอเดียวหนักเกิน (เรียกทุกครั้งที่ดูหลังบ้าน/แจ้งเตือน จึงค่อย ๆ ตามทันเอง)
 */
const SYNC_SUBSCRIBERS_SQL =
  "INSERT OR IGNORE INTO subscribers (email, first_order_id, last_order_id, orders_count, created_at, updated_at) SELECT email, id, id, 1, datetime('now'), datetime('now') FROM orders WHERE status = 'paid' AND email IS NOT NULL LIMIT 200";
async function syncSubscribers(env) {
  if (!env.DB) return 0;
  const res = await env.DB.prepare(SYNC_SUBSCRIBERS_SQL).run().catch(() => null);
  return Number(res?.meta?.changes ?? 0);
}

async function countRows(env, sql, ...args) {
  if (!env.DB) return 0;
  const { results } = await env.DB.prepare(sql).bind(...args).all().catch(() => ({ results: [] }));
  return Number(results?.[0]?.n ?? 0);
}

/** เพิ่ม/อัปเดตลูกค้าในทะเบียน (เรียกทุกครั้งที่ยืนยันการชำระเงิน) */
async function upsertSubscriber(env, email, orderId) {
  const clean = isEmail(email) ? String(email).toLowerCase().trim() : null;
  if (!env.DB || !clean) return null;
  // UPDATE ก่อน แล้วถ้าไม่มีแถวค่อย INSERT → เป็น upsert ที่ทำงานเหมือนกันทั้ง D1 จริงและ mock และนับ orders_count ถูก
  const upd = await env.DB.prepare(
    "UPDATE subscribers SET last_order_id = ?, orders_count = orders_count + 1, updated_at = datetime('now') WHERE email = ?"
  ).bind(orderId, clean).run().catch(() => null);
  if (!Number(upd?.meta?.changes ?? 0)) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO subscribers (email, first_order_id, last_order_id, orders_count, created_at, updated_at) VALUES (?, ?, ?, 1, datetime('now'), datetime('now'))"
    ).bind(clean, orderId, orderId).run().catch(() => {});
  }
  return clean;
}

const ORDER_COLUMNS_SQL =
  "id, email, amount_satang, currency, status, provider, charge_id, download_count, created_at, paid_at, reported_at, emailed_at, slip_key, slip_mime, slip_bytes, trans_ref, verify_source, review_note, pay_target, pay_target_label, verify_attempts, verify_note, verify_mode, last_download_version";

const getOrder = async (env, id) =>
  env.DB.prepare(`SELECT ${ORDER_COLUMNS_SQL} FROM orders WHERE id = ?`).bind(id).first();

/* ---------- Omise (Opn) — ทางเลือก ถ้าอยากใช้ Payment Gateway ---------- */
const OMISE_API = "https://api.omise.co";
const omiseAuth = (secret) => "Basic " + btoa(secret + ":");

async function createPromptPayCharge(env, orderId, origin) {
  const body = new URLSearchParams({
    amount: String(priceSatang(env)),
    currency: env.CURRENCY || "THB",
    "source[type]": "promptpay",
    return_uri: `${origin}/thank-you?order=${orderId}`,
    "metadata[order_id]": orderId,
  });
  const r = await fetch(`${OMISE_API}/charges`, {
    method: "POST",
    headers: { authorization: omiseAuth(env.OMISE_SECRET_KEY), "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const charge = await r.json();
  if (!r.ok) throw new Error(`omise ${r.status}: ${charge.message || JSON.stringify(charge)}`);
  return charge;
}
async function fetchCharge(env, chargeId) {
  const r = await fetch(`${OMISE_API}/charges/${chargeId}`, { headers: { authorization: omiseAuth(env.OMISE_SECRET_KEY) } });
  return r.json();
}

/* ---------- ช่องทางรับเงินของร้าน ----------
 * ตั้งด้วย `PROMPTPAY_OPTIONS = "เบอร์พร้อมเพย์, เลขบัญชี@รหัสธนาคาร"` (คั่นด้วย , ถ้ามีหลายช่องทาง · ช่องแรก = ค่าเริ่มต้น)
 * ถ้าไม่ตั้ง จะใช้ PROMPTPAY_ID (+PROMPTPAY_BANK) เป็นช่องทางเดียวเหมือนเดิม
 * `PROMPTPAY_LABELS = "ช่องทางหลัก|ช่องทางสำรอง"` = ป้ายบนปุ่มเลือกช่องทาง (คั่นด้วย | · เว้นว่างได้)
 * ⚠️ หน้าจ่ายโชว์ **แค่ชื่อบัญชี** (`PROMPTPAY_NAME`) — ไม่บอกว่าเป็นพร้อมเพย์แบบไหน/ไม่โชว์เลข (ดู promptPayOptionLabel)
 */
const payOptions = (env) => {
  const name = String(env.PROMPTPAY_NAME || "");
  const labels = String(env.PROMPTPAY_LABELS || "");
  const list = String(env.PROMPTPAY_OPTIONS || "").trim();
  if (list) return parsePromptPayOptions(list, "", name, labels);
  const id = String(env.PROMPTPAY_ID || "").trim();
  return id ? parsePromptPayOptions(id, String(env.PROMPTPAY_BANK || ""), name, labels) : [];
};
/** ช่องทางที่เลือก (ถ้าไม่ระบุ/ไม่พบ → ช่องทางแรก) */
const findPayOption = (env, key) => {
  const opts = payOptions(env);
  return opts.find((o) => o.key === key) || opts[0] || null;
};
// QR เดิมใช้ซ้ำได้ทุกออเดอร์ (ยอดคงที่ตาม PRICE_SATANG) → cache ตาม (ช่องทาง, ยอด) ไม่ต้องสร้างใหม่ตอนหน้าเว็บ polling
const ppCache = new Map();
function payOptionQr(env, opt) {
  const price = priceSatang(env);
  const key = `${opt.key}|${price}`;
  let cached = ppCache.get(key);
  if (!cached) {
    const content = buildPromptPayPayload({ id: opt.id, bank: opt.bank || "", amountSatang: price });
    cached = { content, svg: qrSvg(content, { scale: 8, margin: 4, alt: "PromptPay QR" }) };
    if (ppCache.size > 16) ppCache.clear();
    ppCache.set(key, cached);
  }
  return cached;
}
/** รายการช่องทางทั้งหมด (แต่ละช่องทางมี QR ของตัวเอง) ให้หน้าเว็บสลับได้โดยไม่ต้องสร้างออเดอร์ใหม่
 *  ส่งออกแค่ชื่อบัญชี + QR · ไม่ส่งเลขที่ปิดบางส่วนออกไปให้หน้าบ้านเลย */
function payOptionList(env, payee) {
  return payOptions(env).map((o) => {
    const qr = payOptionQr(env, o);
    return { key: o.key, label: o.label, proxy_type: o.type, payee, qr_content: qr.content, qr_svg: qr.svg };
  });
}

async function promptPayInfo(env, targetKey = "") {
  const payee = env.PROMPTPAY_NAME || "ร้านค้า";
  const acc = findPayOption(env, targetKey);
  const out = {
    account: acc,
    payload: "",
    svg: "",
    payee,
    masked: acc?.masked || "",
    target: acc?.key || null,
    targetLabel: acc?.label || null,
    options: [],
    provider: PAYMENT_PROVIDER(env) === "omise" ? "omise" : "promptpay",
  };
  if (!acc) return out;
  const qr = payOptionQr(env, acc);
  out.payload = qr.content;
  out.svg = qr.svg;
  out.options = payOptionList(env, payee);
  return out;
}

/** ตรวจว่าตั้งค่าช่องทางรับเงินของร้านแล้วหรือยัง (ใช้ทั้งตอน checkout และ /api/health) */
const promptPayReady = (env) => payOptions(env).length > 0;

/* ---------- ตรวจสลิป/ยอดเงินอัตโนมัติ (EasySlip v2) ----------
 * ทำงานเองเมื่อตั้ง EASYSLIP_API_KEY — ปิดได้ด้วย AUTO_APPROVE=0
 * หลักการ: "อนุมัติเองเฉพาะเมื่อยืนยันได้ครบทุกข้อ" ไม่ใช่แค่ตรวจผ่าน
 *   1) ตรวจสำเร็จ (HTTP 200 + success: true)
 *   2) ยอดในสลิปตรงกับยอดออเดอร์เป๊ะ (matchAmount + เทียบเลขจริง)
 *   3) ผู้รับเป็นบัญชี/พร้อมเพย์ของร้าน (matchedAccount จากบัญชีที่ลงทะเบียนกับผู้ให้บริการ + เทียบกับช่องทางของออเดอร์)
 *   4) สลิปไม่ซ้ำ (isDuplicate=false + trans_ref ต้องไม่ซ้ำในฐานข้อมูล)
 * ไม่ครบข้อไหน → ค้างที่ reported พร้อมเหตุผลให้แอดมินกดอนุมัติในคลิกเดียว
 * เอกสาร API: https://document.easyslip.com/en/v2/verify/bank/
 */
const EASYSLIP_VERIFY_URL = "https://api.easyslip.com/v2/verify/bank";
const SLIP_QR_MAX = 128; // EasySlip รับ payload 1–128 ตัวอักษร
const autoApproveOn = (env) => String(env.AUTO_APPROVE ?? "1") !== "0";
const maxVerifyAttempts = (env) => Math.max(1, Number(env.AUTO_VERIFY_MAX_ATTEMPTS || 5));

/** เรียก EasySlip v2 — ลองซ้ำสั้น ๆ เฉพาะกรณีที่ "ลองใหม่แล้วมีโอกาสผ่าน" (429 / 5xx / เน็ตล่ม) */
async function callEasySlip(env, { slip, payload, amountSatang }) {
  const headers = { authorization: `Bearer ${env.EASYSLIP_API_KEY}` };
  const matchAmount = Number((Number(amountSatang) / 100).toFixed(2)); // v2 รับเป็นตัวเลข
  let mode;
  let body;
  if (slip) {
    const ext = slip.mime === "image/png" ? "png" : slip.mime === "image/webp" ? "webp" : "jpg";
    const fd = new FormData();
    fd.append("image", new Blob([slip.bytes], { type: slip.mime }), `slip.${ext}`); // v2 ใช้ชื่อฟิลด์ image
    fd.append("checkDuplicate", "true");
    if (env.SLIP_MATCH_ACCOUNT !== "0") fd.append("matchAccount", "true");
    if (env.SLIP_MATCH_AMOUNT !== "0") fd.append("matchAmount", String(matchAmount));
    body = fd;
    mode = "image";
  } else {
    body = JSON.stringify({
      payload: String(payload).slice(0, SLIP_QR_MAX),
      checkDuplicate: true,
      ...(env.SLIP_MATCH_ACCOUNT !== "0" ? { matchAccount: true } : {}),
      ...(env.SLIP_MATCH_AMOUNT !== "0" ? { matchAmount } : {}),
    });
    headers["content-type"] = "application/json";
    mode = "qr";
  }

  let last = { status: 0, ok: false, retryable: true, code: "NETWORK", data: null, mode };
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 400 * attempt));
    let r;
    try {
      r = await fetch(EASYSLIP_VERIFY_URL, { method: "POST", headers, body });
    } catch {
      last = { status: 0, ok: false, retryable: true, code: "NETWORK", data: null, mode };
      continue;
    }
    const res = await r.json().catch(() => ({}));
    const code = res?.error?.code || res?.code || "";
    last = {
      status: r.status,
      ok: r.ok && res?.success === true,
      retryable: r.status === 429 || r.status >= 500,
      code: String(code),
      message: String(res?.error?.message || res?.message || ""),
      data: res?.data || null,
      mode,
    };
    if (last.ok || !last.retryable) return last;
  }
  return last;
}

/** แปลผลจาก EasySlip → อนุมัติอัตโนมัติได้หรือไม่ (เข้ม: ต้องครบทุกข้อ) */
function judgeSlip(env, order, res) {
  if (!res || res.ok !== true) {
    const code = String(res?.code || "");
    if (res?.status === 401 || /API_KEY/.test(code)) return { verified: false, reason: "คีย์ตรวจสลิปไม่ถูกต้อง — รอแอดมินตรวจเอง", mode: res?.mode };
    if (/QUOTA_EXCEEDED/.test(code)) return { verified: false, reason: "โควตาตรวจสลิปของเดือนนี้หมด → รอแอดมินตรวจเอง", alert: true, mode: res?.mode };
    if (/BRANCH_INACTIVE|SERVICE_BANNED|USER_BANNED|IP_NOT_ALLOWED|BANK_ACCOUNT/.test(code))
      return { verified: false, reason: `บัญชีตรวจสลิปใช้งานไม่ได้ (${code}) → รอแอดมินตรวจเอง`, alert: true, mode: res?.mode };
    if (/SLIP_PENDING/.test(code)) return { verified: false, reason: "สลิปของธนาคารนี้ยังไม่ขึ้นในระบบ — ลองใหม่อีกครั้งใน 1 นาที", retryable: true, mode: res?.mode };
    if (/SLIP_NOT_FOUND/.test(code) || res?.status === 404) return { verified: false, reason: "อ่านสลิปไม่ได้/ไม่พบข้อมูลในสลิป — ถ่ายใหม่ให้เห็น QR ครบ หรือวางข้อความ QR", mode: res?.mode };
    if (res?.retryable) return { verified: false, reason: "ระบบตรวจสลิปไม่ว่าง/ตอบช้า — รอแอดมินตรวจเอง", retryable: true, alert: true, mode: res?.mode };
    if (res?.status === 400) return { verified: false, reason: `สลิปไม่ผ่านการตรวจ (${res?.code || "VALIDATION_ERROR"}) — ลองแนบรูปที่ชัดขึ้น`, mode: res?.mode };
    return { verified: false, reason: `ตรวจสลิปไม่ผ่าน (${res?.status || "?"}${code ? " " + code : ""})`, mode: res?.mode };
  }

  const d = res.data || {};
  if (d.isDuplicate) return { verified: false, reason: "สลิปนี้เคยถูกใช้แล้ว (isDuplicate)", mode: res.mode };

  // ---- ยอดเงินในสลิปต้องตรงกับยอดออเดอร์เป๊ะ ----
  const expect = Number(order.amount_satang ?? priceSatang(env)) / 100;
  const rawAmount = d.amountInSlip ?? d.amountInOrder ?? d.rawSlip?.amount?.amount ?? d.rawSlip?.amount?.local?.amount ?? null;
  const got = Number(rawAmount);
  if (!Number.isFinite(got)) return { verified: false, reason: "อ่านยอดเงินในสลิปไม่ได้", mode: res.mode };
  if (d.isAmountMatched === false || Math.abs(got - expect) > 0.001) {
    return { verified: false, reason: `ยอดในสลิป ${got.toFixed(2)} ไม่ตรงกับยอดออเดอร์ ${expect.toFixed(2)}`, mode: res.mode };
  }

  // ---- ผู้รับต้องเป็นร้านเรา (matchedAccount = บัญชีที่ลงทะเบียนกับผู้ให้บริการ · หรือเทียบกับช่องทางรับเงินที่ตั้งไว้) ----
  // สลิปจริงปิดเลขผู้รับ ("XXXXXXXXX0201" / "XXX-X-XX146-0") → slipReceiverMatches เทียบให้ทั้งเลขเต็มและเลขท้ายที่มองเห็น
  const receiver = d.rawSlip?.receiver || d.receiver || {};
  const allOptions = payOptions(env);
  const chosen = order.pay_target ? allOptions.filter((o) => o.key === order.pay_target) : [];
  const candidates = chosen.length ? chosen : allOptions;
  const matchedByRegistration = !!d.matchedAccount;   // ผู้ให้บริการยืนยันว่าเป็นบัญชีที่ลงทะเบียนไว้กับคีย์ร้าน
  const matchedByConfig = slipReceiverMatches(receiver, candidates);
  // ถ้าสลิปบอกชัดว่าเงินเข้าบัญชีไหน → ต้องตรงกับช่องทางรับเงินที่ร้านตั้งไว้ (โดยเฉพาะช่องทางที่ออเดอร์นี้เลือก)
  // ถ้าสลิปไม่บอกเลย แต่ผู้ให้บริการยืนยันว่าเป็นบัญชีที่ลงทะเบียนไว้กับคีย์ร้าน → ยอมรับได้
  const hasReceiverInfo = Object.keys(receiver).length > 0;
  if (!matchedByConfig && !(!hasReceiverInfo && matchedByRegistration)) {
    return { verified: false, reason: `บัญชีผู้รับในสลิปไม่ใช่ช่องทางรับเงินของร้าน (${candidates.length} ช่องทางที่เทียบ) — รอแอดมินตรวจเอง`, mode: res.mode };
  }

  // ---- เลขอ้างอิงธุรกรรม (ใช้กันสลิปซ้ำ) ----
  const ref = d.rawSlip?.transRef || d.transRef || d.trans_ref || null;
  if (!ref) return { verified: false, reason: "ไม่พบเลขอ้างอิงธุรกรรมในสลิป — รอแอดมินตรวจเอง", mode: res.mode };

  return { verified: true, ref: String(ref), amount: got, mode: res.mode };
}

/**
 * ตรวจสลิป/ยอดเงินอัตโนมัติ + อนุมัติทันทีถ้ายืนยันครบ
 * @param {{slip?: {bytes: Uint8Array, mime: string}|null, payload?: string}} input
 */
async function verifySlipAuto(env, order, { slip = null, payload = "" } = {}, origin) {
  if (!env.EASYSLIP_API_KEY) return { verified: false, reason: "ยังไม่ได้ตั้งคีย์ตรวจสลิปอัตโนมัติ → รอแอดมินตรวจเอง", mode: "off" };
  if (!autoApproveOn(env)) return { verified: false, reason: "ปิดโหมดอนุมัติอัตโนมัติ (AUTO_APPROVE=0)", mode: "off" };
  if (!slip && !payload) return { verified: false, reason: "ไม่มีสลิป/ข้อความ QR ให้ตรวจ", mode: "none" };
  try {
    const res = await callEasySlip(env, { slip, payload, amountSatang: order.amount_satang ?? priceSatang(env) });
    const verdict = judgeSlip(env, order, res);
    if (!verdict.verified) return { ...verdict, status: res?.status || 0, code: res?.code || "" };

    const paid = await markPaid(env, order.id, "easyslip", verdict.ref, origin);
    if (!paid.ok) return { verified: false, reason: paid.reason, mode: verdict.mode };
    return { verified: true, ref: verdict.ref, amount: verdict.amount, mode: verdict.mode, email: paid.email };
  } catch (e) {
    return { verified: false, reason: `ตรวจสลิปไม่สำเร็จ: ${String(e.message || e)}`, mode: slip ? "image" : "qr" };
  }
}

/* ---------- อีเมล (Resend REST — ไม่ต้องใช้ SDK) ---------- */
/**
 * แปลง HTML อีเมลเป็นข้อความล้วน (ใช้เป็น text/plain คู่กับ html)
 * ทำไม: อีเมลที่มีทั้ง HTML และข้อความล้วนได้คะแนนสแปมดีกว่า และอ่านได้ในไคลเอนต์ที่ปิด HTML
 */
function htmlToText(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    // ลิงก์ต้องเห็น URL ในฉบับข้อความล้วนด้วย ไม่งั้นคนที่ปิด HTML จะกดดาวน์โหลดไม่ได้
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, inner) => {
      const label = String(inner).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      return href && label && label !== href ? `${label} (${href})` : (href || label);
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<\/(p|div|h1|h2|h3|li|tr|pre)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** ลายเซ็นสำหรับลิงก์ยกเลิกรับอีเมล (กันคนอื่นยิงลบอีเมลคนอื่น) */
const unsubToken = async (env, email) =>
  b64url(await hmacKey(env.DOWNLOAD_SIGNING_KEY || "dev-signing-key", "unsub:" + String(email).toLowerCase().trim()));
const unsubUrl = async (env, email, origin) =>
  `${origin}/unsubscribe?e=${encodeURIComponent(String(email).toLowerCase().trim())}&t=${await unsubToken(env, email)}`;

async function sendEmail(env, { to, subject, html, text, replyTo, headers }) {
  if (!env.RESEND_API_KEY) return { skipped: "no RESEND_API_KEY" };
  try {
    const payload = {
      // ต้องเป็นโดเมนที่ verify กับ Resend (SPF/DKIM/DMARC) ไม่ใช่ onboarding@resend.dev ซึ่งเป็นโดเมนกลาง
      from: env.MAIL_FROM || `599 Prompt ก๊อปวาง <no-reply@kopwang.com>`,
      to: [to],
      subject,
      html,
      text: text || htmlToText(html),
      // ให้ผู้รับตอบกลับได้จริง — อีเมลที่ตอบกลับไม่ได้ (no-reply ล้วน) โดนกรองง่ายกว่า
      reply_to: replyTo || env.REPLY_TO || env.NOTIFY_EMAIL || "support@kopwang.com",
    };
    if (headers && Object.keys(headers).length) payload.headers = headers;
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) return { error: `resend ${r.status}: ${out.message || JSON.stringify(out)}` };
    return { id: out.id };
  } catch (e) {
    // อีเมลล่มต้องไม่ทำให้การยืนยันชำระเงิน/ดาวน์โหลดพัง — บันทึกเป็น error แล้วไปต่อ
    return { error: `resend unreachable: ${String(e.message || e)}` };
  }
}

function receiptHtml(env, order, url, origin, pack) {
  const price = ((order.amount_satang ?? priceSatang(env)) / 100).toFixed(0);
  const v = pack?.version ? `v${pack.version}` : "";
  return `<!doctype html><html lang="th"><body style="margin:0;background:#FBF6EE;font-family:'Sarabun',Arial,sans-serif;color:#1B1B1F;padding:28px">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #F1E9DB;border-radius:18px;padding:30px">
    <div style="font-size:13px;font-weight:700;color:#C74A15">${escapeHtml(env.PRODUCT_NAME || PACK_RELEASE.title)}</div>
    <h1 style="font-size:24px;margin:10px 0 4px">ชำระเงินสำเร็จ — ดาวน์โหลดได้เลย 🎉</h1>
    <p style="color:#7A7A85;font-size:15px;margin:0 0 20px">ขอบคุณที่สนับสนุนครับ · ยอดชำระ ${price} บาท${v ? ` · ไฟล์เวอร์ชัน ${escapeHtml(v)}` : ""}</p>
    <a href="${url}" style="display:block;text-align:center;background:#00B37E;color:#fff;text-decoration:none;font-weight:800;font-size:18px;padding:16px;border-radius:999px">⬇ ดาวน์โหลด PDF ทันที</a>
    <p style="color:#5A5A66;font-size:13.5px;margin:18px 0 0;line-height:1.8"><b>${escapeHtml(PACK_UPDATE_PROMISE)}</b><br>เมื่อมี prompt ชุดใหม่/เวอร์ชันใหม่ เราจะส่งอีเมลมาแจ้ง และ<b>ลิงก์นี้จะโหลดไฟล์รุ่นล่าสุดให้เสมอ</b> — ไม่ต้องซื้อซ้ำ</p>
    <p style="color:#7A7A85;font-size:13px;margin:14px 0 0">ลิงก์นี้ใช้ได้ ${escapeHtml(env.DOWNLOAD_TTL_HOURS || "24")} ชั่วโมง (โหลดได้ไม่จำกัดรอบ) หากลิงก์หมดอายุ ขอลิงก์ใหม่ได้ที่ <a href="${escapeHtml(origin)}/retrieve" style="color:#C74A15">หน้านี้</a></p>
    <p style="color:#9A9AA6;font-size:12px;margin:14px 0 0">เลขที่คำสั่งซื้อ: ${escapeHtml(order.id)}</p>
  </div></body></html>`;
}

/** ส่งอีเมลลิงก์โหลด + บันทึก log (ใช้ทั้ง receipt และ resend) */
async function emailDownloadLink(env, order, kind = "receipt", origin = "") {
  if (!isEmail(order.email)) return { skipped: "no email" };
  const url = await downloadUrl(env, order.id, origin);
  const pack = await packInfo(env);
  const product = env.PRODUCT_NAME || PACK_RELEASE.title;
  // หลีกเลี่ยงอีโมจิในหัวเรื่อง (ตัวกรองสแปมบางตัวให้คะแนนลบ) และใช้ชื่อสินค้าจริง
  const subject = kind === "resend" ? `ลิงก์ดาวน์โหลดใหม่ของคุณ (${product})` : `ดาวน์โหลด ${product} ของคุณ`;
  const res = await sendEmail(env, { to: order.email, subject, html: receiptHtml(env, order, url, origin, pack) });
  if (env.DB) {
    await env.DB.prepare("INSERT INTO email_log (order_id, email, kind) VALUES (?, ?, ?)")
      .bind(order.id, order.email, kind).run().catch(() => {});
    if (!res.error && !res.skipped) {
      await env.DB.prepare("UPDATE orders SET emailed_at = datetime('now') WHERE id = ?").bind(order.id).run().catch(() => {});
    }
  }
  return res;
}

/** แจ้งเตือนร้าน: มีออเดอร์รอตรวจสอบ (kind="report") หรือระบบอนุมัติให้เองแล้ว (kind="auto") */
async function notifySeller(env, order, origin, opts = {}) {
  if (!env.NOTIFY_EMAIL || !isEmail(env.NOTIFY_EMAIL)) return { skipped: "no NOTIFY_EMAIL" };
  const price = ((order.amount_satang ?? priceSatang(env)) / 100).toFixed(0);
  const auto = opts.kind === "auto";
  const viaPayload = opts.auto?.mode === "qr";
  const note = opts.auto?.reason || order.verify_note || null;
  const html = `<!doctype html><html lang="th"><body style="font-family:'Sarabun',Arial,sans-serif;padding:20px">
    <h2 style="margin:0 0 8px">${auto ? `อนุมัติอัตโนมัติแล้ว · ${price} บาท` : `มีออเดอร์รอตรวจสอบ ${price} บาท`}</h2>
    <p style="color:#555;margin:0 0 14px">${auto
      ? `ระบบตรวจสลิปผ่านครบทุกเงื่อนไข → ส่งลิงก์โหลดให้ลูกค้าทางอีเมลแล้ว (ไม่ต้องทำอะไรต่อ)`
      : `ลูกค้าแจ้งว่าโอนเงินแล้ว${order.slip_key ? " และแนบสลิปมา" : viaPayload ? " (วางข้อความ QR จากสลิป)" : " (ไม่ได้แนบสลิป)"}`}</p>
    <ul style="color:#333;line-height:1.9">
      <li>เลขที่: ${escapeHtml(order.id)}</li>
      <li>อีเมลลูกค้า: ${escapeHtml(order.email || "—")}</li>
      <li>รับเงินทาง: ${escapeHtml(order.pay_target_label || "—")}</li>
      <li>เวลาแจ้ง: ${escapeHtml(order.reported_at || new Date().toISOString())}</li>
      <li>ตรวจโดย: ${auto ? `อัตโนมัติ (${escapeHtml(opts.auto?.mode || "easyslip")})` : "ยังไม่ได้ — รอคุณตรวจ"}</li>
      ${note ? `<li>เหตุผลที่ระบบยังยืนยันไม่ได้: ${escapeHtml(note)}</li>` : ""}
    </ul>
    <p><a href="${escapeHtml(origin)}/admin" style="background:#17181D;color:#FFD84D;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:700">${auto ? "เปิดหลังบ้าน → ดูออเดอร์" : "เปิดหลังบ้าน → ตรวจสลิป/อนุมัติ"}</a></p>
  </body></html>`;
  return sendEmail(env, {
    to: env.NOTIFY_EMAIL,
    subject: auto ? `อนุมัติอัตโนมัติ · ${price} บาท — ${order.id}` : `มีออเดอร์รอตรวจสอบ ${price} บาท — ${order.id}`,
    html,
    text: `ออเดอร์ ${order.id}\nอีเมลลูกค้า: ${order.email || "—"}\nยอด: ${price} บาท\nสถานะ: ${auto ? "อนุมัติอัตโนมัติแล้ว" : "รอตรวจสอบ"}`,
  });
}

/* ---------- ยืนยันการชำระเงิน (ใช้ทั้งแอดมินอนุมัติและตรวจสลิปอัตโนมัติ) ---------- */
/**
 * mark paid แบบ idempotent + กันสลิปซ้ำ (trans_ref) + ส่งอีเมลลิงก์โหลดให้ลูกค้า
 * @returns {{ok: boolean, changed?: boolean, reason?: string, email?: object}}
 */
async function markPaid(env, orderId, source, transRef, origin) {
  const order = await getOrder(env, orderId);
  if (!order) return { ok: false, reason: "ไม่พบออเดอร์" };
  if (order.status === "paid") return { ok: true, changed: false, reason: "ออเดอร์นี้ชำระแล้ว" };
  if (!NEW_ORDER_STATUSES.includes(order.status)) return { ok: false, reason: `ออเดอร์อยู่ในสถานะ ${order.status} แก้ไม่ได้` };

  if (transRef && env.DB) {
    const dup = await env.DB.prepare("SELECT id FROM orders WHERE trans_ref = ? AND id != ?").bind(String(transRef), orderId).first().catch(() => null);
    if (dup) return { ok: false, reason: `สลิปนี้ถูกใช้กับออเดอร์อื่นแล้ว (${dup.id})` };
  }

  const res = await env.DB.prepare(
    `UPDATE orders SET status='paid', paid_at=datetime('now'), verify_source=?, trans_ref=COALESCE(?, trans_ref), review_note=NULL
     WHERE id=? AND status IN ('pending','reported')`
  ).bind(source || "manual", transRef ? String(transRef) : null, orderId).run();
  const changed = Number(res?.meta?.changes ?? 0) > 0;

  const fresh = await getOrder(env, orderId);
  let email = { skipped: "already emailed" };
  if (fresh?.status === "paid" && fresh.email && !fresh.emailed_at) {
    email = await emailDownloadLink(env, fresh, "receipt", origin);
  }
  // ลูกค้าคนเดิมต้องอยู่ในทะเบียน → ใช้แจ้งเวอร์ชันใหม่ในอนาคต (ไม่ต้องถามซ้ำ)
  if (fresh?.status === "paid" && fresh.email) await upsertSubscriber(env, fresh.email, orderId);
  return { ok: true, changed, email, order: fresh };
}

/* ---------- handlers ---------- */
async function handleCheckout(request, env) {
  if (!sameOrigin(request)) return json({ error: "คำขอข้ามโดเมนถูกปฏิเสธ" }, 403);
  const { email, target } = await request.json().catch(() => ({}));
  const cleanEmail = isEmail(email) ? email.toLowerCase().trim() : null;
  if (email && !cleanEmail) return json({ error: "อีเมลไม่ถูกต้อง" }, 400);
  // เก็บอีเมลทุกออเดอร์ (ปิดได้ด้วย REQUIRE_EMAIL=0) — ลิงก์โหลด + ใบเสร็จส่งอัตโนมัติเมื่ออนุมัติ
  if (!cleanEmail && String(env.REQUIRE_EMAIL ?? "1") !== "0") {
    return json({ error: "กรอกอีเมลก่อนสั่งซื้อ — ระบบส่งลิงก์ดาวน์โหลดกับใบเสร็จให้ทางอีเมลอัตโนมัติเมื่อชำระเงิน" }, 400);
  }

  const orderId = "ord_" + b64url(crypto.getRandomValues(new Uint8Array(9)));
  const origin = appOrigin(env, request);
  const amount = priceSatang(env);
  const currency = env.CURRENCY || "THB";

  // --- ทางเลือก: Omise/Opn gateway ---
  if (PAYMENT_PROVIDER(env) === "omise") {
    if (!env.OMISE_SECRET_KEY) return json({ error: "ยังตั้งค่า OMISE_SECRET_KEY ไม่เสร็จ (ดู README)" }, 503);
    const charge = await createPromptPayCharge(env, orderId, origin);
    await env.DB.prepare(
      `INSERT INTO orders (id, email, amount_satang, currency, status, provider, charge_id, qr_content, qr_image_url)
       VALUES (?, ?, ?, ?, 'pending', 'omise', ?, ?, ?)`
    ).bind(orderId, cleanEmail, charge.amount, charge.currency, charge.id,
           charge.source?.qr_content || null,
           charge.source?.scannable_code?.image?.download_uri || null).run();
    return json({
      order_id: orderId,
      provider: "omise",
      charge_id: charge.id,
      amount_satang: Number(charge.amount),
      currency: charge.currency,
      qr_content: charge.source?.qr_content || null,
      qr_image_url: charge.source?.scannable_code?.image?.download_uri || null,
      poll_url: `/api/order/${orderId}`,
      email: cleanEmail,
    });
  }

  // --- ค่าเริ่มต้น: พร้อมเพย์ตรงเข้าบัญชีร้าน ---
  if (!promptPayReady(env)) {
    return json({
      error: env.PROMPTPAY_BANK || String(env.PROMPTPAY_OPTIONS || "").includes("@") || String(env.PROMPTPAY_ID || "").includes("@")
        ? "ตั้งค่าช่องทางรับเงินไม่ครบ — โหมดเลขบัญชีธนาคารต้องมีรหัสธนาคาร 3 หลัก (PROMPTPAY_BANK เช่น 011 = ttb หรือเขียนเป็น \"เลขบัญชี@011\" ใน PROMPTPAY_OPTIONS)"
        : "ยังตั้งค่า PROMPTPAY_ID ไม่เสร็จ — ใส่ PROMPTPAY_OPTIONS (เช่น \"เลขบัญชี@011\") หรือ PROMPTPAY_ID (+PROMPTPAY_BANK) ของร้านก่อนเปิดขาย",
    }, 503);
  }
  // ลูกค้าเลือกช่องทางได้ (target) — ถ้าไม่ระบุ/ไม่พบ ใช้ช่องทางแรก
  const pp = await promptPayInfo(env, typeof target === "string" ? target : "");
  await env.DB.prepare(
    `INSERT INTO orders (id, email, amount_satang, currency, status, provider, qr_content, pay_target, pay_target_label)
     VALUES (?, ?, ?, ?, 'pending', 'promptpay', ?, ?, ?)`
  ).bind(orderId, cleanEmail, amount, currency, pp.payload, pp.target, pp.targetLabel).run();

  return json({
    order_id: orderId,
    provider: "promptpay",
    amount_satang: amount,
    currency,
    qr_content: pp.payload,
    qr_svg: pp.svg,
    payee: { name: pp.payee },
    pay_target: pp.target,
    pay_target_label: pp.targetLabel,
    pay_options: pp.options,
    report_url: `/api/order/${orderId}/report`,
    poll_url: `/api/order/${orderId}`,
    email: cleanEmail,
    steps: [
      "สแกน QR ช่องทางที่สะดวกด้วยแอปธนาคาร แล้วจ่ายยอดที่แสดง",
      "กลับมาที่หน้านี้ กด “ฉันโอนแล้ว” — แนบสลิป หรือวางข้อความ QR จากสลิป",
      "ระบบตรวจสลิป/ยอดเงินอัตโนมัติ → อนุมัติ + ส่งลิงก์ดาวน์โหลดเข้าเมลทันที",
      "ถ้าระบบยืนยันไม่ได้ (สลิปไม่ชัด/ยอดไม่ตรง) ร้านจะตรวจให้เองและส่งลิงก์ตามมา",
    ],
  });
}

const ORDER_PUBLIC_FIELDS = (o) => ({
  id: o.id,
  status: o.status,
  amount_satang: o.amount_satang,
  currency: o.currency,
  provider: o.provider,
  paid_at: o.paid_at,
  reported_at: o.reported_at,
  has_slip: !!o.slip_key,
  pay_target: o.pay_target || null,
  pay_target_label: o.pay_target_label || null,
});

async function handleOrderStatus(orderId, env) {
  const order = await getOrder(env, orderId);
  if (!order) return json({ error: "not found" }, 404);
  const out = ORDER_PUBLIC_FIELDS(order);
  // ยังไม่จ่าย → ส่ง QR กลับไปด้วย เพื่อให้กลับเข้าหน้านี้ใหม่ (?order=…) แล้วสแกนต่อได้
  if (order.provider !== "omise" && NEW_ORDER_STATUSES.includes(order.status) && promptPayReady(env)) {
    const pp = await promptPayInfo(env, order.pay_target || "");
    out.qr_content = pp.payload;
    out.qr_svg = pp.svg;
    out.payee = { name: pp.payee };
    out.pay_target = pp.target;
    out.pay_target_label = pp.targetLabel;
    out.pay_options = pp.options;      // ให้หน้าเว็บสลับช่องทางได้โดยไม่ต้องสร้างออเดอร์ใหม่
    out.report_url = `/api/order/${orderId}/report`;
  }
  return json(out);
}

const SLIP_MIME = ["image/jpeg", "image/png", "image/webp"];
const MAX_SLIP_BYTES = 4 * 1024 * 1024;

/** ลูกค้าอาจสลับช่องทางรับเงินก่อนกดแจ้งโอน → จำช่องทางที่ใช้จริงไว้ให้หลังบ้านเห็น */
async function applyPayTarget(env, orderId, targetRaw) {
  if (typeof targetRaw !== "string" || !payOptions(env).some((o) => o.key === targetRaw)) return null;
  const opt = findPayOption(env, targetRaw);
  await env.DB.prepare(
    "UPDATE orders SET pay_target=?, pay_target_label=?, qr_content=? WHERE id=? AND status IN ('pending','reported')"
  ).bind(opt.key, opt.label, payOptionQr(env, opt).content, orderId).run();
  return opt;
}

/** "ข้อความ QR" ที่ลูกค้าวางมา (หรือคัดลอกจากสลิป) — ตัดช่องว่าง/บรรทัดใหม่ แล้วตรวจความยาวคร่าว ๆ */
function normalizeSlipPayload(raw) {
  if (typeof raw !== "string") return "";
  const s = raw.replace(/\s+/g, "").trim();
  return s.length >= 10 && s.length <= SLIP_QR_MAX * 4 ? s : "";
}

/** ลูกค้าแจ้งโอน (+แนบสลิป) → สถานะ reported และแจ้งเตือนร้าน */
async function handleReport(request, orderId, env) {
  if (!sameOrigin(request)) return json({ error: "คำขอข้ามโดเมนถูกปฏิเสธ" }, 403);
  const order = await getOrder(env, orderId);
  if (!order) return json({ error: "ไม่พบออเดอร์นี้" }, 404);
  if (order.status === "paid") return json({ ok: true, status: "paid", already_paid: true, message: "ออเดอร์นี้ชำระเงินแล้ว" });
  if (!NEW_ORDER_STATUSES.includes(order.status)) {
    return json({ error: `ออเดอร์อยู่ในสถานะ ${order.status} จึงแจ้งโอนไม่ได้` }, 409);
  }

  let slip = null;
  let qrPayload = "";
  const ctype = request.headers.get("content-type") || "";
  if (ctype.includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    await applyPayTarget(env, orderId, form?.get?.("pay_target"));
    qrPayload = normalizeSlipPayload(form?.get?.("qr_payload"));
    const file = form?.get?.("slip");
    if (file && typeof file === "object" && Number(file.size) > 0) {
      if (Number(file.size) > MAX_SLIP_BYTES) return json({ error: "ไฟล์สลิปใหญ่เกิน 4MB" }, 413);
      const mime = String(file.type || "").toLowerCase();
      if (!SLIP_MIME.includes(mime)) return json({ error: "แนบได้เฉพาะไฟล์รูป .jpg / .png / .webp" }, 415);
      if (!env.FILES) return json({ error: "ที่เก็บไฟล์ (R2) ยังไม่พร้อม" }, 503);
      slip = { bytes: new Uint8Array(await file.arrayBuffer()), mime, size: Number(file.size) };
      await env.FILES.put(`slips/${orderId}`, slip.bytes, { httpMetadata: { contentType: slip.mime } });
      await env.DB.prepare(
        "UPDATE orders SET slip_key=?, slip_mime=?, slip_bytes=? WHERE id=?"
      ).bind(`slips/${orderId}`, slip.mime, slip.size, orderId).run();
    }
  } else if (ctype.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    await applyPayTarget(env, orderId, body?.pay_target);
    qrPayload = normalizeSlipPayload(body?.qr_payload ?? body?.payload ?? body?.qr);
  }

  await env.DB.prepare(
    "UPDATE orders SET status='reported', reported_at=datetime('now') WHERE id=? AND status IN ('pending','reported')"
  ).bind(orderId).run();

  // ---------- ตรวจสลิป/ยอดเงินอัตโนมัติ → อนุมัติ + ส่งอีเมลทันทีถ้ายืนยันครบทุกข้อ ----------
  const fresh = await getOrder(env, orderId);
  const attempts = Number(fresh.verify_attempts || 0);
  let auto;
  if (!slip && !qrPayload) {
    auto = { verified: false, reason: "ยังไม่มีสลิป/ข้อความ QR ให้ตรวจอัตโนมัติ", mode: "none" };
  } else if (attempts >= maxVerifyAttempts(env)) {
    auto = { verified: false, reason: `ลองตรวจอัตโนมัติครบ ${maxVerifyAttempts(env)} ครั้งแล้วยังยืนยันไม่ได้ → รอแอดมินตรวจเอง`, mode: "skip" };
  } else {
    await env.DB.prepare("UPDATE orders SET verify_attempts = verify_attempts + 1 WHERE id=?").bind(orderId).run();
    auto = await verifySlipAuto(env, fresh, { slip, payload: qrPayload }, appOrigin(env, request));
    // เก็บเหตุผลไว้ให้หลังบ้านเห็นเฉพาะกรณีที่ “ลองตรวจแล้วจริง” (โหมด off/ไม่มีข้อมูล = เรื่องตั้งค่า ไม่ต้องรกตาราง)
    if (auto.mode === "image" || auto.mode === "qr" || auto.mode === "skip") {
      await env.DB.prepare("UPDATE orders SET verify_note=?, verify_mode=? WHERE id=?")
        .bind(auto.verified ? null : auto.reason || null, auto.mode || null, orderId).run();
    }
  }

  const after = await getOrder(env, orderId);
  const origin = appOrigin(env, request);
  await notifySeller(env, after, origin, { kind: after.status === "paid" ? "auto" : "report", auto }).catch(() => {});

  return json({
    ok: true,
    status: after.status,
    has_slip: !!after.slip_key,
    has_qr: !!qrPayload,
    auto_verified: !!auto.verified,
    auto_reason: auto.verified ? null : auto.reason || null,
    auto_mode: auto.mode || null,
    verify_attempts: Number(after.verify_attempts || 0),
    message: after.status === "paid"
      ? "ตรวจสลิปผ่านอัตโนมัติ — ส่งลิงก์ดาวน์โหลดเข้าเมลให้แล้ว (กดปุ่มด้านล่างโหลดได้ทันที)"
      : (slip || qrPayload)
        ? "แจ้งโอนแล้ว — ระบบตรวจอัตโนมัติยังยืนยันไม่ได้ รอร้านตรวจสอบ (ปกติไม่เกิน 1 ชั่วโมง)"
        : "แจ้งโอนเรียบร้อย รอร้านตรวจสอบ (ปกติไม่เกิน 1 ชั่วโมง)",
  });
}

/* ---------- Omise webhook ---------- */
async function verifyOmiseSignature(env, request, rawBody) {
  const sigHeader = request.headers.get("Omise-Signature");
  const tsHeader = request.headers.get("Omise-Signature-Timestamp");
  if (!sigHeader || !tsHeader || !env.OMISE_WEBHOOK_SECRET) return false;
  const keyBytes = unb64url(env.OMISE_WEBHOOK_SECRET);
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${tsHeader}.${rawBody}`)));
  const expected = hex(mac);
  return sigHeader.split(",").some((s) => safeEqual(s.trim(), expected));
}

async function handleWebhook(request, env) {
  const origin = appOrigin(env, request);
  const rawBody = await request.text();
  if (!(await verifyOmiseSignature(env, request, rawBody))) return json({ error: "invalid signature" }, 401);

  const event = JSON.parse(rawBody);
  if (event.object === "event" && event.key === "charge.complete") {
    const charge = await fetchCharge(env, event.data.id); // ยืนยันซ้ำกับ API จริง
    const orderId = charge.metadata?.order_id;
    if (orderId && charge.paid === true && Number(charge.amount) === priceSatang(env)) {
      const order = await getOrder(env, orderId);
      if (order && order.charge_id === charge.id) await markPaid(env, orderId, "omise", null, origin);
    }
  }
  return json({ received: true });
}

async function handleDownload(token, request, env) {
  const orderId = await verifyDownloadToken(env, token);
  if (!orderId) return json({ error: "ลิงก์ไม่ถูกต้องหรือหมดอายุ" }, 403);
  const order = await env.DB.prepare("SELECT status, email FROM orders WHERE id = ?").bind(orderId).first();
  if (!order || order.status !== "paid") return json({ error: "ออเดอร์นี้ยังไม่ชำระเงิน" }, 403);

  // จุดสำคัญของ “แพ็กอัปเดตตัวเอง”: ลิงก์ทุกอัน (เก่า/ใหม่) เสิร์ฟไฟล์เวอร์ชันปัจจุบันเสมอ
  // ลูกค้าคนเดิมจึงได้ไฟล์รุ่นใหม่จากลิงก์เดิมของตัวเอง โดยไม่ต้องซื้อซ้ำหรือมีระบบสมาชิก
  const pack = await packInfo(env);
  const obj = await env.FILES.get(env.PDF_OBJECT_KEY || "prompt-pack.pdf");
  if (!obj) return json({ error: "ไฟล์ PDF ยังไม่ได้อัปโหลดขึ้น R2" }, 404);

  await env.DB.prepare("UPDATE orders SET download_count = download_count + 1, last_download_version = ? WHERE id = ?")
    .bind(pack.version, orderId).run();
  if (order.email) {
    await env.DB.prepare("UPDATE subscribers SET last_download_version = ? WHERE email = ?")
      .bind(pack.version, String(order.email).toLowerCase().trim()).run().catch(() => {});
  }
  return new Response(obj.body, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="599-prompt-kop-wang-v${pack.version}.pdf"`,
      "cache-control": "no-store",
      "x-pack-version": pack.version,
    },
  });
}

async function handlePaidPage(orderId, env, origin) {
  const order = await getOrder(env, orderId);
  if (!order) return json({ error: "not found" }, 404);
  if (order.status !== "paid") {
    return json({
      message: order.status === "reported" ? "ร้านกำลังตรวจสอบการชำระเงินของคุณ" : "ยังไม่พบการชำระเงิน",
      status: order.status,
      poll: `/api/order/${orderId}`,
    });
  }
  const pack = await packInfo(env);
  return json({
    status: "paid",
    email: order.email,
    download_url: await downloadUrl(env, orderId, origin),
    pack: { version: pack.version, prompts: pack.prompts, niches: pack.niches },
    update_promise: PACK_UPDATE_PROMISE,
  });
}

/** ขอลิงก์โหลดซ้ำด้วยอีเมล — ตอบแบบกว้าง ๆ เสมอ เพื่อไม่ให้เดาว่าอีเมลมีในระบบหรือไม่ */
async function handleRetrieve(request, env) {
  if (!sameOrigin(request)) return json({ error: "คำขอข้ามโดเมนถูกปฏิเสธ" }, 403);
  const origin = appOrigin(env, request);
  const { email } = await request.json().catch(() => ({}));
  const clean = isEmail(email) ? email.toLowerCase().trim() : null;
  if (!clean) return json({ error: "กรุณากรอกอีเมลให้ถูกต้อง" }, 400);
  if (!env.RESEND_API_KEY) return json({ error: "ระบบอีเมลยังไม่พร้อม (ยังไม่ตั้งค่า RESEND_API_KEY)" }, 503);

  const { results: recent } = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM email_log WHERE email = ? AND kind = 'resend' AND created_at > datetime('now','-1 hour')"
  ).bind(clean).all();
  if ((recent?.[0]?.n || 0) >= 5) return json({ error: "ขอบ่อยเกินไป ลองใหม่ในอีก ~1 ชั่วโมง" }, 429);

  const { results } = await env.DB.prepare(
    "SELECT id, email, amount_satang, currency FROM orders WHERE email = ? AND status = 'paid' ORDER BY paid_at DESC LIMIT 3"
  ).bind(clean).all();
  for (const o of results || []) await emailDownloadLink(env, o, "resend", origin);
  return json({ ok: true, message: "ถ้าอีเมลนี้มีคำสั่งซื้อที่ชำระแล้ว ระบบได้ส่งลิงก์ใหม่ให้แล้ว" });
}

/* ---------- ของแถม: 5 prompt แรกของแพ็ก (หน้า /free → เก็บอีเมลผู้สนใจ) ---------- */
// ขนาดแพ็กเต็ม/เวอร์ชัน อ่านจากทะเบียนจริง (packInfo) → พอออกรุ่นใหม่ ตัวเลขบนหน้า /free กับอีเมลอัปเดตเอง
const FREE_IP_PER_HOUR = 10;      // กันสแปมจากเครื่องเดียว
const FREE_EMAIL_PER_HOUR = 3;    // กันขอซ้ำรัว ๆ ด้วยอีเมลเดิม

/** ข้อมูลที่เปิดเผยก่อนกรอกอีเมล — ให้เต็มแค่ชุดแรก ที่เหลือเห็นชื่อชุด/มุม/hook */
const publicFreeSamples = () => FREE_SAMPLES.map((s, i) => ({
  id: s.id, niche_th: s.niche_th, niche_en: s.niche_en, angle_th: s.angle_th, angle_en: s.angle_en,
  hook_th: s.hook_th, cta_th: s.cta_th,
  prompt_th: i === 0 ? s.prompt_th : null,
  prompt_en: i === 0 ? s.prompt_en : null,
}));
const fullFreeSamples = () => FREE_SAMPLES.map((s) => ({ ...s }));

function freeSampleHtml(env, email, origin, unsub = "", pack = releaseDefaults()) {
  const product = env.PRODUCT_NAME || pack.title;
  const price = (priceSatang(env) / 100).toFixed(0);
  const niches = [...new Set(FREE_SAMPLES.map((s) => s.niche_th))].join(" · ");
  const item = (s, i) => `<div style="border:1px solid #F1E9DB;border-radius:14px;padding:16px;margin:0 0 14px">
      <div style="font-family:'Kanit',Arial,sans-serif;font-size:13px;font-weight:700;color:#C74A15">ชุดที่ ${i + 1}/${FREE_SAMPLES.length} · #${escapeHtml(s.id)} · ${escapeHtml(s.angle_th)}</div>
      <div style="font-size:12px;color:#7A7A85;margin:6px 0 10px">ตัวอย่าง hook: ${escapeHtml(s.hook_th)}</div>
      <pre style="white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;line-height:1.6;background:#FBF6EE;border:1px solid #F1E9DB;border-radius:10px;padding:12px;margin:0;color:#1B1B1F">${escapeHtml(s.prompt_th)}</pre>
    </div>`;
  return `<!doctype html><html lang="th"><body style="margin:0;background:#FBF6EE;font-family:'Sarabun',Arial,sans-serif;color:#1B1B1F;padding:28px">
  <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #F1E9DB;border-radius:18px;padding:30px">
    <div style="font-size:13px;font-weight:700;color:#C74A15">${escapeHtml(product)}</div>
    <h1 style="font-family:'Kanit',Arial,sans-serif;font-size:23px;margin:10px 0 6px">ของแถมมาแล้ว 🎁 ${FREE_SAMPLES.length} prompt แรก (จาก ${pack.prompts})</h1>
    <p style="color:#7A7A85;font-size:14px;margin:0 0 18px">ส่งตามคำขอที่ ${escapeHtml(email)} · หมวด ${escapeHtml(niches)} · ก๊อปไปวางใน ChatGPT / Claude / Gemini ได้เลย</p>
    ${FREE_SAMPLES.map(item).join("")}
    <a href="${escapeHtml(origin)}/?from=free-sample" style="display:block;text-align:center;background:#FF3D00;color:#fff;text-decoration:none;font-weight:800;font-size:17px;padding:16px;border-radius:999px">ดูแพ็กเต็ม ${pack.prompts} ชุด + ${pack.niches} หมวด (v${escapeHtml(pack.version)}) — ${price} บาท</a>
    <p style="color:#7A7A85;font-size:12.5px;margin:16px 0 0;line-height:1.7">แพ็กเต็มมี ${pack.prompts} ชุด ครบ ${pack.niches} หมวดสินค้า × 23 มุมคอนเทนต์ สองภาษา TH/EN พร้อมไฟล์ CSV ใช้กับ Google Sheets และคู่มือการใช้งาน<br>
    ${escapeHtml(PACK_UPDATE_PROMISE)}<br>
    ไม่ต้องการรับอีเมลอีก <a href="${escapeHtml(unsub)}" style="color:#C74A15">กดยกเลิกรับอีเมลได้ที่นี่</a> (หรือตอบกลับฉบับนี้) — เราจะลบอีเมลของคุณออกจากรายชื่อทันที</p>
    <p style="color:#9A9AA6;font-size:11.5px;margin:12px 0 0">สินค้าดิจิทัล · ไม่ใช่การรับประกันรายได้ · ติดต่อร้าน: ${escapeHtml(env.NOTIFY_EMAIL || "support@kopwang.com")}</p>
  </div></body></html>`;
}

/** ส่งของแถมทางอีเมล + บันทึก log (ใช้ email_log นับจำนวนครั้งด้วย kind='free') */
async function sendFreeSampleEmail(env, email, origin, pack = null) {
  // อีเมลนี้เป็น “การตลาด” (แถมของเพื่อชวนซื้อ) → ต้องมีทางยกเลิกรับแบบ one-click ไม่งั้นโดนมองเป็นสแปม
  const unsub = await unsubUrl(env, email, origin);
  const p = pack || (await packInfo(env));
  const res = await sendEmail(env, {
    to: email,
    subject: `ของแถม ${FREE_SAMPLES.length} prompt แรก — ${env.PRODUCT_NAME || p.title}`,
    html: freeSampleHtml(env, email, origin, unsub, p),
    headers: {
      "List-Unsubscribe": `<${unsub}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
  if (env.DB && !res.error && !res.skipped) {
    await env.DB.prepare("INSERT INTO email_log (order_id, email, kind) VALUES (NULL, ?, 'free')")
      .bind(email)
      .run()
      .catch(() => {});
  }
  return res;
}

/** GET /api/free — ของแถม 5 ชุดแรก (ให้หน้าเว็บแสดงตัวอย่างก่อนกรอกอีเมล) */
async function handleFreeSampleInfo(env, request) {
  const pack = await packInfo(env);
  return json({
    ok: true,
    product: env.PRODUCT_NAME || pack.title,
    pack_version: pack.version,
    count: FREE_SAMPLES.length,
    ids: FREE_SAMPLE_META.ids,
    niches: [...new Set(FREE_SAMPLES.map((s) => s.niche_th))],
    packs: { prompts_total: pack.prompts, niches_total: pack.niches },
    price_satang: priceSatang(env),
    buy_url: `${appOrigin(env, request)}/?from=free-sample`,
    samples: publicFreeSamples(),
    email_configured: !!env.RESEND_API_KEY,
  });
}

/** GET /api/pack — เวอร์ชันแพ็กปัจจุบัน + ประวัติย่อ (ใช้โชว์ “อัปเดตฟรีตลอดชีพ” บนหน้าเว็บ) */
async function handlePackInfo(env) {
  const pack = await packInfo(env);
  let history = [];
  if (env.DB) {
    const { results } = await env.DB.prepare(
      "SELECT version, prompts, niches, notes, created_at FROM pack_versions ORDER BY id DESC LIMIT 12"
    ).all().catch(() => ({ results: [] }));
    history = (results || []).map((r) => ({
      version: r.version, prompts: r.prompts ?? null, niches: r.niches ?? null,
      notes: r.notes || null, published_at: r.created_at || null,
    }));
  }
  return json({
    ok: true,
    version: pack.version,
    title: pack.title,
    highlights: pack.highlights || "",
    prompts_total: pack.prompts,
    niches_total: pack.niches,
    languages: pack.languages || 2,
    pages: pack.pages ?? null,
    updated_at: pack.updated_at || null,
    published_at: pack.published_at || null,
    price_satang: priceSatang(env),
    free_updates: true,
    update_promise: PACK_UPDATE_PROMISE,
    updates: history,
  });
}

/** POST /api/free — เก็บอีเมล + ส่ง 5 prompt แรก (กันสแปมด้วย hash ของ IP + email_log) */
async function handleFreeSample(request, env) {
  if (!sameOrigin(request)) return json({ error: "คำขอข้ามโดเมนถูกปฏิเสธ" }, 403);
  const origin = appOrigin(env, request);
  const body = await request.json().catch(() => ({}));
  const email = isEmail(body.email) ? String(body.email).toLowerCase().trim() : null;
  if (!email) return json({ error: "กรุณากรอกอีเมลให้ถูกต้อง" }, 400);
  if (body.consent !== true) return json({ error: "กรุณาติ๊กยินยอมให้เก็บอีเมลเพื่อรับของแถมก่อนครับ" }, 400);
  if (!env.DB) return json({ error: "ระบบยังไม่พร้อม (ไม่มีฐานข้อมูล)" }, 503);

  // เก็บแค่ hash ของ IP ไม่เก็บ IP จริง (ส่วนตัวกว่า · ยังกันสแปมได้)
  const ip = request.headers.get("cf-connecting-ip") || String(request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  const ipHash = hex(await hmacKey(env.DOWNLOAD_SIGNING_KEY || "dev-signing-key", "free-sample:" + ip)).slice(0, 16);

  const { results: byIp } = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM leads WHERE ip_hash = ? AND created_at > datetime('now','-1 hour')"
  ).bind(ipHash).all();
  if ((byIp?.[0]?.n || 0) >= FREE_IP_PER_HOUR) return json({ error: "ขอของแถมบ่อยเกินไปจากเครื่องนี้ ลองใหม่ในอีก ~1 ชั่วโมง" }, 429);

  const { results: byMail } = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM email_log WHERE email = ? AND kind = 'free' AND created_at > datetime('now','-1 hour')"
  ).bind(email).all();
  if ((byMail?.[0]?.n || 0) >= FREE_EMAIL_PER_HOUR) return json({ error: "อีเมลนี้ขอของแถมบ่อยเกินไป ลองใหม่ในอีก ~1 ชั่วโมง" }, 429);

  const now = sqlNow();
  await env.DB.prepare("INSERT OR IGNORE INTO leads (email, source, consent_at, ip_hash) VALUES (?, ?, ?, ?)")
    .bind(email, String(body.source || "free-page").slice(0, 40), now, ipHash)
    .run();
  await env.DB.prepare("UPDATE leads SET last_sent_at = ? WHERE email = ?").bind(now, email).run();

  const sent = await sendFreeSampleEmail(env, email, origin, await packInfo(env));
  const failed = !!(sent.error || sent.skipped);
  return json({
    ok: true,
    count: FREE_SAMPLES.length,
    samples: fullFreeSamples(),
    email_sent: !failed,
    email_note: failed ? "บันทึกอีเมลไว้แล้ว แต่ส่งสำรองทางเมลไม่สำเร็จ — ร้านจะส่งตามให้" : `ส่ง ${FREE_SAMPLES.length} prompt ไปที่ ${email} แล้ว`,
  });
}

/* ---------- ยกเลิกรับอีเมล (List-Unsubscribe + one-click · RFC 8058) ----------
 * รับได้ทั้ง GET (กดลิงก์ในอีเมล) และ POST (ปุ่ม one-click ใน Gmail/Outlook)
 * ลายเซ็นผูกกับอีเมล → คนอื่นสุ่มลบอีเมลคนอื่นไม่ได้
 */
function unsubPage(title, body) {
  return new Response(`<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;background:#FBF6EE;font-family:'Sarabun',Arial,sans-serif;color:#1B1B1F;padding:40px 20px">
  <div style="max-width:440px;margin:0 auto;background:#fff;border:1px solid #F1E9DB;border-radius:18px;padding:30px;text-align:center">
    <h1 style="font-size:20px;margin:0 0 10px">${title}</h1>
    <p style="color:#5A5A66;font-size:14px;line-height:1.8;margin:0">${body}</p>
  </div></body></html>`, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
async function handleUnsubscribe(request, env) {
  const url = new URL(request.url);
  const email = String(url.searchParams.get("e") || "").toLowerCase().trim();
  const token = String(url.searchParams.get("t") || "");
  if (!isEmail(email) || !safeEqual(token, await unsubToken(env, email))) {
    return unsubPage("ลิงก์ไม่ถูกต้อง", "ลิงก์ยกเลิกรับอีเมลนี้ไม่ถูกต้องหรือถูกแก้ไข ถ้าต้องการยกเลิกจริง ส่งอีเมลมาที่ support@kopwang.com ได้เลย");
  }
  if (env.DB) {
    await env.DB.prepare("DELETE FROM leads WHERE email = ?").bind(email).run().catch(() => {});
    await env.DB.prepare("DELETE FROM email_log WHERE email = ? AND kind = 'free'").bind(email).run().catch(() => {});
    // ลูกค้าที่ซื้อแล้วก็กดยกเลิกได้ — เราหยุดทั้งอีเมลการตลาดและอีเมลแจ้งเวอร์ชันใหม่ให้ทันที
    // (ลิงก์ดาวน์โหลด/ขอลิงก์ใหม่ยังใช้ได้ — เป็นสินค้าที่ซื้อแล้ว)
    await env.DB.prepare("UPDATE subscribers SET unsubscribed_at = datetime('now') WHERE email = ?").bind(email).run().catch(() => {});
  }
  // ตอบสั้น ๆ สำหรับ one-click (ไคลเอนต์เมลไม่แสดงผล) — ถ้าเปิดในเบราว์เซอร์ก็อ่านรู้เรื่อง
  return unsubPage("ยกเลิกรับอีเมลแล้ว ✅", `เราได้นำ <b>${escapeHtml(email)}</b> ออกจากรายชื่อรับอีเมลแล้ว — จะไม่ได้รับอีเมลแถม/อีเมลแจ้งเวอร์ชันใหม่อีก (ลิงก์ดาวน์โหลดของออเดอร์ที่ซื้อไว้ยังใช้ได้ตามปกติ)`);
}

/* ---------- QR สำหรับหน้าคลังลิงก์ในไบโอ (/links) ----------
 * รับเฉพาะ “พาธภายในเว็บเรา” ไม่รับ URL เต็ม → กันคนอื่นเอาเว็บเราไปเป็นเครื่องสร้าง QR ฟรี
 * ลิงก์ที่เข้ารหัสสร้างจาก APP_ORIGIN ของโดเมนที่กำลังเสิร์ฟ จึงถูกโดเมนเองโดยไม่ต้องแก้โค้ด
 * ใช้เป็น <img src="/api/qr?p=/links"> ได้ (ไม่ต้องมี JS ฝั่งเบราว์เซอร์) */
function handleQr(request, env) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("p");           // ไม่ส่งมาเลย = ลิงก์หน้าแรก · ส่งมาแต่ว่าง = ผิดรูปแบบ
  const p = (raw === null ? "/" : raw).trim();
  if (!/^\/[A-Za-z0-9\-._~/?=&%#+:]{0,80}$/.test(p) || p.startsWith("//")) {
    return json({ error: "พาธไม่ถูกต้อง — ต้องเป็นลิงก์ในเว็บนี้ เช่น /links" }, 400);
  }
  const want = String(url.searchParams.get("c") || "");
  const dark = /^#[0-9a-fA-F]{6}$/.test(want) ? want : "#17181D";
  const text = (env.APP_ORIGIN || url.origin) + p;
  let svg;
  try {
    svg = qrSvg(text, { scale: 8, margin: 3, dark, alt: "QR: " + text });
  } catch (e) {
    return json({ error: "ลิงก์ยาวเกินกว่าจะทำ QR ได้" }, 400);
  }
  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=600",
      "x-qr-content": text,
    },
  });
}

/* ---------- หลังบ้าน ---------- */
function adminTokenFrom(request) {
  const url = new URL(request.url);
  const auth = request.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : url.searchParams.get("token");
}
const isAdmin = (request, env) => !!env.ADMIN_TOKEN && adminTokenFrom(request) === env.ADMIN_TOKEN;

async function handleAdmin(request, env) {
  if (!isAdmin(request, env)) return json({ error: "unauthorized" }, 401);
  const { results } = await env.DB.prepare(
    `SELECT ${ORDER_COLUMNS_SQL}
     FROM orders ORDER BY created_at DESC LIMIT 200`
  ).all();
  const rows = results || [];
  const paidRows = rows.filter((o) => o.status === "paid");
  return json({
    orders: rows,
    stats: {
      total: rows.length,
      paid: paidRows.length,
      pending: rows.filter((o) => o.status === "pending").length,
      reported: rows.filter((o) => o.status === "reported").length,
      failed: rows.filter((o) => o.status === "failed").length,
      revenue_satang: paidRows.reduce((s, o) => s + Number(o.amount_satang || 0), 0),
      downloads: rows.reduce((s, o) => s + Number(o.download_count || 0), 0),
    },
  });
}

/* ---------- หลังบ้าน: อีเมลผู้สนใจ (คนที่มารับของแถม 5 prompt ฟรี) ---------- */
const LEAD_COLUMNS_SQL = "email, source, created_at, last_sent_at";

async function handleAdminLeads(request, env) {
  if (!isAdmin(request, env)) return json({ error: "unauthorized" }, 401);
  const { results } = await env.DB.prepare(
    `SELECT ${LEAD_COLUMNS_SQL} FROM leads ORDER BY created_at DESC LIMIT 300`
  ).all();
  const rows = results || [];
  const { results: all } = await env.DB.prepare("SELECT COUNT(*) AS n FROM leads").all();
  const { results: sent } = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM email_log WHERE kind = 'free' AND created_at > datetime('now','-1 day')"
  ).all();
  const since = new Date(Date.now() - 86400e3).toISOString().replace("T", " ").slice(0, 19);
  return json({
    leads: rows,
    stats: {
      total: Number(all?.[0]?.n ?? rows.length),
      today: rows.filter((l) => String(l.created_at || "") > since).length,
      sent_last_day: Number(sent?.[0]?.n || 0),
      shown: rows.length,
    },
  });
}

/** ดาวน์โหลดรายชื่อเป็น CSV (ใส่ BOM ให้ Excel อ่านภาษาไทยถูก) */
async function handleAdminLeadsCsv(request, env) {
  if (!isAdmin(request, env)) return json({ error: "unauthorized" }, 401);
  const { results } = await env.DB.prepare(
    `SELECT ${LEAD_COLUMNS_SQL} FROM leads ORDER BY created_at DESC LIMIT 5000`
  ).all();
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = ["email,source,created_at,last_sent_at"]
    .concat((results || []).map((l) => [l.email, l.source, l.created_at, l.last_sent_at].map(q).join(",")))
    .join("\r\n");
  return new Response("\uFEFF" + csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="leads.csv"',
      "cache-control": "no-store",
    },
  });
}

/** ลบอีเมลผู้สนใจตามคำขอ (ใช้เมื่อลูกค้าขอใช้สิทธิลบข้อมูล) */
async function handleAdminLeadDelete(request, env) {
  if (!isAdmin(request, env)) return json({ error: "unauthorized" }, 401);
  const { email } = await request.json().catch(() => ({}));
  if (!isEmail(email)) return json({ error: "อีเมลไม่ถูกต้อง" }, 400);
  const clean = String(email).toLowerCase().trim();
  const res = await env.DB.prepare("DELETE FROM leads WHERE email = ?").bind(clean).run();
  await env.DB.prepare("DELETE FROM email_log WHERE email = ? AND kind = 'free'").bind(clean).run().catch(() => {});
  return json({ ok: true, email: clean, deleted: res?.meta?.changes ?? null });
}

async function handleAdminApprove(request, orderId, env) {
  if (!isAdmin(request, env)) return json({ error: "unauthorized" }, 401);
  const res = await markPaid(env, orderId, "manual", null, appOrigin(env, request));
  if (!res.ok) return json({ error: res.reason }, 409);
  return json({ ok: true, status: "paid", changed: res.changed, email_sent: !res.email?.error && !res.email?.skipped, email: res.email });
}

async function handleAdminReject(request, orderId, env) {
  if (!isAdmin(request, env)) return json({ error: "unauthorized" }, 401);
  const body = await request.json().catch(() => ({}));
  const note = typeof body.note === "string" ? body.note.slice(0, 300) : "สลิปไม่ถูกต้อง / ไม่พบยอดโอน";
  const order = await getOrder(env, orderId);
  if (!order) return json({ error: "ไม่พบออเดอร์" }, 404);
  if (order.status === "paid") return json({ error: "ออเดอร์นี้ชำระเงินแล้ว ปฏิเสธไม่ได้" }, 409);
  await env.DB.prepare("UPDATE orders SET status='failed', review_note=? WHERE id=? AND status IN ('pending','reported')")
    .bind(note, orderId).run();
  return json({ ok: true, status: "failed", note });
}

/* ---------- ไฟล์สินค้า: หลังบ้านอัปโหลด/แทนที่ได้เอง (ไม่ต้องใช้ CLI) ---------- */
// เพดานขนาดไฟล์สินค้า (ทั้งอัปโหลดด่วนและออกรุ่นใหม่) — Cloudflare Workers จำกัดหน่วยความจำของคำขอ
const MAX_PRODUCT_BYTES = 25 * 1024 * 1024; // 25 MB

/** อ่านไฟล์ PDF ที่อัปโหลดจากฟอร์ม + ตรวจขนาด/ชนิดไฟล์ (ใช้ร่วมกันทั้ง /admin/product และ /admin/pack/publish) */
async function readPdfUpload(file) {
  if (!file || typeof file === "string") return { error: "ต้องแนบไฟล์ (field: file)", status: 400 };
  if (file.size > MAX_PRODUCT_BYTES) return { error: "ไฟล์ใหญ่เกิน 25 MB", status: 413 };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const looksPdf = bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  if (!looksPdf) return { error: "ไฟล์ที่อัปโหลดไม่ใช่ PDF (ต้องขึ้นต้นด้วย %PDF-)", status: 415 };
  return { bytes };
}

/**
 * GET  /admin/product → มีไฟล์สินค้าใน R2 แล้วหรือยัง (ขนาดเท่าไร)
 * POST /admin/product → multipart field `file` = อัปโหลด/แทนที่ไฟล์สินค้าใน R2
 * ต้องมี ADMIN_TOKEN เสมอ · รับเฉพาะไฟล์ที่ขึ้นต้นด้วย %PDF- และไม่เกิน 25 MB
 * (เปลี่ยนไฟล์ด่วนโดยไม่ออกรุ่นใหม่ — ถ้าจะออกรุ่น + แจ้งลูกค้า ใช้ /admin/pack/publish)
 */
async function handleAdminProduct(request, env) {
  if (!isAdmin(request, env)) return json({ error: "unauthorized" }, 401);
  const key = env.PDF_OBJECT_KEY || "prompt-pack.pdf";

  if (request.method === "GET") {
    const head = typeof env.FILES.head === "function" ? await env.FILES.head(key).catch(() => null) : null;
    if (head) return json({ ok: true, key, uploaded: true, bytes: head.size ?? null, updated_at: head.uploaded ? new Date(head.uploaded).toISOString() : null });
    const obj = await env.FILES.get(key).catch(() => null);
    return json({ ok: true, key, uploaded: !!obj, bytes: obj?.size ?? null, updated_at: null });
  }

  const form = await request.formData().catch(() => null);
  const up = await readPdfUpload(form && (form.get("file") || form.get("pdf")));
  if (up.error) return json({ error: up.error }, up.status);
  await env.FILES.put(key, up.bytes, { httpMetadata: { contentType: "application/pdf" } });
  return json({ ok: true, key, bytes: up.bytes.length, message: "อัปโหลดไฟล์สินค้าแล้ว — ลูกค้าที่ชำระเงินจะโหลดไฟล์นี้" });
}

/**
 * POST /admin/orders/:id/delete → ลบออเดอร์ออกจากระบบ (ใช้ล้างออเดอร์ทดสอบ/สแปม)
 * ลบ log อีเมลของออเดอร์นั้น + สลิปที่เก็บใน R2 ด้วย · ต้องมี ADMIN_TOKEN
 */
async function handleAdminDelete(request, orderId, env) {
  if (!isAdmin(request, env)) return json({ error: "unauthorized" }, 401);
  const order = await getOrder(env, orderId);
  if (!order) return json({ error: "ไม่พบออเดอร์" }, 404);
  if (order.slip_key) await env.FILES.delete(order.slip_key).catch(() => {});
  await env.DB.prepare("DELETE FROM email_log WHERE order_id = ?").bind(orderId).run().catch(() => {});
  const res = await env.DB.prepare("DELETE FROM orders WHERE id = ?").bind(orderId).run();
  const changes = res?.meta?.changes ?? 1;
  return json({ ok: true, deleted: orderId, status_before: order.status, changes });
}

async function handleAdminSlip(orderId, request, env) {
  if (!isAdmin(request, env)) return json({ error: "unauthorized" }, 401);
  const order = await getOrder(env, orderId);
  if (!order?.slip_key) return json({ error: "ไม่พบสลิปของออเดอร์นี้" }, 404);
  const obj = await env.FILES.get(order.slip_key);
  if (!obj) return json({ error: "ไฟล์สลิปหายจากที่เก็บ" }, 404);
  return new Response(obj.body, {
    headers: {
      "content-type": order.slip_mime || "image/jpeg",
      "cache-control": "no-store",
      "content-disposition": `inline; filename="slip-${orderId}"`,
    },
  });
}

/* ===================== แพ็กอัปเดตตัวเอง: อีเมลแจ้งเวอร์ชันใหม่ + หลังบ้าน =====================
 * เป้าหมาย: “ซื้อครั้งเดียว แต่ได้ของใหม่ทุกครั้งที่ออกรุ่น” โดยไม่ต้องมีระบบสมาชิก/ต่ออายุ
 * - ทะเบียน subscribers: ใครซื้อแล้ว (เพิ่มอัตโนมัติตอนยืนยันการชำระเงิน)
 * - ออกรุ่นใหม่: POST /admin/pack/publish → เก็บไฟล์เดิมไว้ versions/… + ตั้งรุ่นใหม่เป็น current
 * - แจ้งเตือน: POST /admin/pack/notify → ส่งทีละชุด (เรียกซ้ำได้จนจบ) เฉพาะคนที่ยังไม่ได้รับรุ่นนี้
 */

function packUpdateHtml(env, { url, unsub, pack, prevVersion, orderId, origin, ttlHours }) {
  const product = env.PRODUCT_NAME || pack.title;
  const prev = prevVersion ? `จาก v${escapeHtml(prevVersion)} ` : "";
  const notes = pack.notes ? `<div style="background:#FBF6EE;border:1px solid #F1E9DB;border-radius:12px;padding:14px;margin:0 0 18px">
      <div style="font-size:12.5px;font-weight:700;color:#C74A15;margin:0 0 6px">มีอะไรใหม่ในรุ่นนี้</div>
      <div style="font-size:14px;color:#3C3C46;line-height:1.75">${escapeHtml(pack.notes)}</div>
    </div>` : "";
  return `<!doctype html><html lang="th"><body style="margin:0;background:#FBF6EE;font-family:'Sarabun',Arial,sans-serif;color:#1B1B1F;padding:28px">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #F1E9DB;border-radius:18px;padding:30px">
    <div style="font-size:13px;font-weight:700;color:#C74A15">${escapeHtml(product)}</div>
    <h1 style="font-size:23px;margin:10px 0 6px">แพ็กของคุณมีเวอร์ชันใหม่ v${escapeHtml(pack.version)}</h1>
    <p style="color:#5A5A66;font-size:15px;margin:0 0 18px;line-height:1.8">คุณซื้อแพ็กนี้ไว้แล้ว — เวอร์ชันใหม่นี้ <b>เป็นของคุณฟรี ไม่ต้องจ่ายเพิ่ม</b> ${prev}· ตอนนี้มี ${escapeHtml(String(pack.prompts))} ชุด ครบ ${escapeHtml(String(pack.niches))} หมวด</p>
    ${notes}
    <a href="${url}" style="display:block;text-align:center;background:#00B37E;color:#fff;text-decoration:none;font-weight:800;font-size:18px;padding:16px;border-radius:999px">⬇ ดาวน์โหลดเวอร์ชันล่าสุด</a>
    <p style="color:#7A7A85;font-size:13px;margin:18px 0 0">ลิงก์นี้ใช้ได้ ${escapeHtml(String(ttlHours))} ชั่วโมง · โหลดซ้ำได้ไม่จำกัด · ไฟล์ที่ได้จะเป็น<b>เวอร์ชันล่าสุดเสมอ</b><br>
    ลิงก์เก่าที่คุณเคยได้ก็โหลดไฟล์รุ่นล่าสุดให้ด้วย — อีเมลนี้เป็นแค่ทางลัด</p>
    <p style="color:#7A7A85;font-size:13px;margin:12px 0 0">ลิงก์หมดอายุหรือหาเมลเก่าไม่เจอ? ขอลิงก์ใหม่ได้ที่ <a href="${escapeHtml(origin)}/retrieve" style="color:#C74A15">หน้านี้</a></p>
    <p style="color:#9A9AA6;font-size:12px;margin:16px 0 0;line-height:1.7">เลขที่คำสั่งซื้อ: ${escapeHtml(orderId)}<br>
    ไม่ต้องการรับอีเมลแจ้งเวอร์ชันใหม่/ข่าวสารอีก <a href="${escapeHtml(unsub)}" style="color:#C74A15">กดยกเลิกรับอีเมลได้ที่นี่</a> (หรือตอบกลับฉบับนี้) — ลิงก์ดาวน์โหลดของคุณยังใช้ได้ตามปกติ</p>
  </div></body></html>`;
}

/** ส่งอีเมล “มีเวอร์ชันใหม่” ให้ลูกค้าคนหนึ่งคน (ลิงก์ผูกกับออเดอร์เดิมของเขา) */
async function sendPackUpdateEmail(env, { email, orderId, pack, origin, prevVersion }) {
  if (!isEmail(email)) return { skipped: "no email" };
  if (!orderId) return { error: "ไม่พบออเดอร์อ้างอิงของอีเมลนี้" };
  const ttlHours = Number(env.UPDATE_LINK_TTL_HOURS || 720);   // ค่าเริ่มต้น 30 วัน
  const url = await downloadUrl(env, orderId, origin, ttlHours);
  const unsub = await unsubUrl(env, email, origin);
  const product = env.PRODUCT_NAME || pack.title;
  return sendEmail(env, {
    to: email,
    // ไม่ใส่ emoji ในหัวเรื่อง (บางตัวกรองให้คะแนนลบ) และบอกชัดว่าเป็น “เวอร์ชันใหม่ของที่ซื้อแล้ว”
    subject: `${product} มีเวอร์ชันใหม่ v${pack.version}`,
    html: packUpdateHtml(env, { url, unsub, pack, prevVersion, orderId, origin, ttlHours }),
    headers: {
      "List-Unsubscribe": `<${unsub}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
}

/**
 * ส่งอีเมลแจ้งเวอร์ชันใหม่ให้ลูกค้าคนเดิม เป็นชุดละ PACK_NOTIFY_BATCH คน (เรียกซ้ำได้)
 * เฉพาะคนที่ last_notified_version ยังไม่ตรงกับเวอร์ชันนี้ → กันส่งซ้ำ + กันคนที่ยกเลิกรับแล้ว
 * @returns {{ok: boolean, version?: string, sent?: number, failed?: number, remaining?: number, done?: boolean, stalled?: boolean, error?: string}}
 */
async function notifyPackUpdate(env, { version, origin, batch = null }) {
  const limit = Math.min(Math.max(Number(batch || env.PACK_NOTIFY_BATCH || 20), 1), 50);
  if (!env.DB) return { ok: false, error: "ไม่มีฐานข้อมูล (D1) — เก็บทะเบียนลูกค้าไม่ได้" };
  if (!env.RESEND_API_KEY) return { ok: false, error: "ยังไม่ได้ตั้งค่า RESEND_API_KEY — ส่งอีเมลแจ้งลูกค้าไม่ได้" };
  await syncSubscribers(env);   // ลูกค้าเก่าที่ซื้อก่อนมีทะเบียน ต้องไม่ถูกข้าม
  const pack = await packInfo(env);
  const target = version || pack.version;

  const { results } = await env.DB.prepare(
    "SELECT email, last_order_id, last_notified_version FROM subscribers WHERE unsubscribed_at IS NULL AND last_notified_version <> ? ORDER BY updated_at ASC LIMIT ?"
  ).bind(target, limit).all();
  const rows = results || [];

  let sent = 0;
  const failures = [];
  for (const s of rows) {
    const res = await sendPackUpdateEmail(env, { email: s.email, orderId: s.last_order_id, pack, origin, prevVersion: s.last_notified_version || "" });
    if (res.error || res.skipped) {
      failures.push({ email: s.email, error: res.error || res.skipped });
      continue;
    }
    await env.DB.prepare("UPDATE subscribers SET last_notified_version = ?, notified_at = datetime('now') WHERE email = ?")
      .bind(target, s.email).run();
    await env.DB.prepare("INSERT INTO email_log (order_id, email, kind) VALUES (?, ?, 'update')")
      .bind("v" + target, s.email).run().catch(() => {});
    sent++;
  }

  const remaining = await subscribersPending(env, target);
  // นับสถิติสะสมบนแถวรุ่นปัจจุบัน (อ่าน–บวก–เขียน เพื่อให้ทำงานเหมือนกันทั้ง D1 จริงและ mock)
  const stat = await env.DB.prepare("SELECT notified_count, notify_failed FROM pack_versions WHERE is_current = 1 ORDER BY id DESC LIMIT 1").first().catch(() => null);
  if (stat) {
    await env.DB.prepare("UPDATE pack_versions SET notified_count = ?, notify_failed = ?, notified_at = datetime('now') WHERE is_current = 1")
      .bind(Number(stat.notified_count || 0) + sent, Number(stat.notify_failed || 0) + failures.length).run().catch(() => {});
  }
  return {
    ok: true,
    version: target,
    batch: limit,
    sent,
    failed: failures.length,
    failures: failures.slice(0, 5),
    remaining,
    done: remaining === 0,
    // ส่งไม่ออกเลยแต่ยังมีคนค้าง → บอกตรง ๆ ว่า “ตัน” ไม่ให้หน้าบ้านวนลูปไม่จบ
    stalled: sent === 0 && remaining > 0,
  };
}

const intOrNull = (v) => { const n = Number(String(v ?? "").trim()); return Number.isFinite(n) && n > 0 ? Math.round(n) : null; };
const textOrNull = (v, max = 500) => { const s = String(v ?? "").trim(); return s ? s.slice(0, max) : null; };

/** GET /admin/pack — รุ่นปัจจุบัน + ประวัติ + ทะเบียนลูกค้า/สถานะการแจ้งเตือน */
async function handleAdminPack(request, env) {
  if (!isAdmin(request, env)) return json({ error: "unauthorized" }, 401);
  const synced = await syncSubscribers(env);   // ทำให้ยอดในหน้าหลังบ้านตรงกับออเดอร์ที่จ่ายแล้วจริง
  const pack = await packInfo(env);
  const { results: history } = await env.DB.prepare(
    `SELECT ${PACK_VERSION_COLUMNS} FROM pack_versions ORDER BY id DESC LIMIT 20`
  ).all().catch(() => ({ results: [] }));
  const total = await countRows(env, "SELECT COUNT(*) AS n FROM subscribers");
  const pending = await subscribersPending(env, pack.version);
  const unsub = await countRows(env, "SELECT COUNT(*) AS n FROM subscribers WHERE unsubscribed_at IS NOT NULL");
  const downloaded = await countRows(env, "SELECT COUNT(*) AS n FROM orders WHERE status = 'paid' AND last_download_version = ?", pack.version);
  return json({
    ok: true,
    release: releaseDefaults(),
    current: {
      version: pack.version, prompts: pack.prompts, niches: pack.niches, pages: pack.pages ?? null,
      bytes: pack.bytes ?? null, sha256: pack.sha256 || null, notes: pack.notes || null,
      object_key: pack.object_key || env.PDF_OBJECT_KEY || "prompt-pack.pdf",
      published_at: pack.published_at || null, source: pack.source,
      notified_count: Number(pack.notified_count || 0), notify_failed: Number(pack.notify_failed || 0),
    },
    history: (history || []).map((r) => ({
      version: r.version, prompts: r.prompts ?? null, niches: r.niches ?? null, pages: r.pages ?? null,
      bytes: r.bytes ?? null, notes: r.notes || null, is_current: Number(r.is_current || 0),
      object_key: r.object_key || null, published_at: r.created_at || null,
      notified_count: Number(r.notified_count || 0), notify_failed: Number(r.notify_failed || 0),
    })),
    subscribers: {
      total,
      notified_current: Math.max(total - pending - unsub, 0),
      pending,
      unsubscribed: unsub,
      downloaded_current: downloaded,
      synced_last_call: synced,   // เพิ่มเข้าทะเบียนเที่ยวนี้กี่คน (0 = ไม่มีลูกค้าตกค้าง)
    },
    notify: {
      batch: Math.min(Math.max(Number(env.PACK_NOTIFY_BATCH || 20), 1), 50),
      email_configured: !!env.RESEND_API_KEY,
      download_ttl_hours: Number(env.DOWNLOAD_TTL_HOURS || 24),
      update_link_ttl_hours: Number(env.UPDATE_LINK_TTL_HOURS || 720),
    },
    update_promise: PACK_UPDATE_PROMISE,
  });
}

/**
 * POST /admin/pack/publish — ออกรุ่นใหม่ (multipart)
 *   file    = ไฟล์ PDF ของรุ่นใหม่ (บังคับ)
 *   version = เลขรุ่น เช่น 1.5 (บังคับ · ต้องไม่ซ้ำกับรุ่นที่เคยออก)
 *   prompts / niches / pages / notes = ข้อมูลประกอบ (ไม่ใส่ = ใช้ค่าเดิม)
 *   notify  = "1" → ส่งอีเมลแจ้งลูกค้าคนเดิมทันที 1 ชุด (ที่เหลือเรียก /admin/pack/notify ต่อ)
 * เก็บไฟล์เดิมไว้ที่ versions/prompt-pack-v<รุ่นเก่า>.pdf และตั้งรุ่นใหม่เป็น current → ลิงก์เดิมของลูกค้าได้ไฟล์ใหม่
 */
async function handleAdminPackPublish(request, env) {
  if (!isAdmin(request, env)) return json({ error: "unauthorized" }, 401);
  const form = await request.formData().catch(() => null);
  const version = safeVersion(form && form.get("version"));
  if (!version) return json({ error: "ระบุเวอร์ชันให้ถูกต้องก่อนอัปโหลด เช่น version=1.5" }, 400);

  const up = await readPdfUpload(form && (form.get("file") || form.get("pdf")));
  if (up.error) return json({ error: up.error }, up.status);

  const dup = await env.DB.prepare("SELECT id FROM pack_versions WHERE version = ? LIMIT 1").bind(version).first().catch(() => null);
  if (dup) return json({ error: `เวอร์ชัน ${version} เคยออกแล้ว — ใช้เลขรุ่นใหม่ หรือถ้าแค่เปลี่ยนไฟล์ให้ใช้ /admin/product` }, 409);

  const before = await packInfo(env);
  const prompts = intOrNull(form.get("prompts")) ?? before.prompts;
  const niches = intOrNull(form.get("niches")) ?? before.niches;
  const pages = intOrNull(form.get("pages"));
  const notes = textOrNull(form.get("notes"));
  const bytes = up.bytes;
  const sha = await sha256Hex(bytes);
  const key = `versions/prompt-pack-v${version}.pdf`;

  // เก็บ “สำเนาของรุ่นนี้” ไว้ (ย้อนดู/ย้อนกลับได้) แล้วเขียนทับไฟล์ปัจจุบันที่ลูกค้าทุกคนโหลด
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: "application/pdf" } });
  await env.FILES.put(env.PDF_OBJECT_KEY || "prompt-pack.pdf", bytes, { httpMetadata: { contentType: "application/pdf" } });
  await env.DB.prepare("UPDATE pack_versions SET is_current = 0 WHERE is_current = 1").run();
  await env.DB.prepare(
    "INSERT INTO pack_versions (version, prompts, niches, pages, object_key, bytes, sha256, notes, is_current) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)"
  ).bind(version, prompts, niches, pages, key, bytes.length, sha, notes).run();

  const wantsNotify = String((form && form.get("notify")) ?? "0") !== "0";
  const notify = wantsNotify ? await notifyPackUpdate(env, { version, origin: appOrigin(env, request) }) : null;
  return json({
    ok: true,
    version,
    previous_version: before.version,
    object_key: key,
    bytes: bytes.length,
    sha256: sha,
    prompts,
    niches,
    pages,
    notes,
    pending_notify: await subscribersPending(env, version),
    notify,
    self_update: `ลิงก์เดิมของลูกค้าทุกคนโหลด v${version} ได้ทันที (ไฟล์เก่าเก็บไว้ที่ ${key})`,
  });
}

/** POST /admin/pack/notify — แจ้งลูกค้าคนเดิมว่ามีเวอร์ชันใหม่ ทีละชุด (เรียกซ้ำจน done=true) */
async function handleAdminPackNotify(request, env) {
  if (!isAdmin(request, env)) return json({ error: "unauthorized" }, 401);
  const body = await request.json().catch(() => ({}));
  const res = await notifyPackUpdate(env, {
    version: safeVersion(body.version),
    origin: appOrigin(env, request),
    batch: body.batch,
  });
  return json(res, res.ok ? 200 : 503);
}

/** GET /admin/pack/customers.csv — ทะเบียนลูกค้าที่ซื้อแล้ว (ใครได้รุ่นไหน/โหลดรุ่นไหน) */
const SUBSCRIBER_COLUMNS_SQL = "email, first_order_id, last_order_id, orders_count, last_notified_version, last_download_version, notified_at, unsubscribed_at, created_at, updated_at";
async function handleAdminPackCustomersCsv(request, env) {
  if (!isAdmin(request, env)) return json({ error: "unauthorized" }, 401);
  const { results } = await env.DB.prepare(
    `SELECT ${SUBSCRIBER_COLUMNS_SQL} FROM subscribers ORDER BY updated_at DESC LIMIT 5000`
  ).all();
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = "email,orders_count,last_notified_version,last_download_version,notified_at,unsubscribed_at,first_order_id,last_order_id,created_at,updated_at";
  const csv = [header]
    .concat((results || []).map((s) => [
      s.email, s.orders_count, s.last_notified_version, s.last_download_version,
      s.notified_at, s.unsubscribed_at, s.first_order_id, s.last_order_id, s.created_at, s.updated_at,
    ].map(q).join(",")))
    .join("\r\n");
  return new Response("\uFEFF" + csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="pack-customers.csv"',
      "cache-control": "no-store",
    },
  });
}

async function handleHealth(env) {
  const provider = PAYMENT_PROVIDER(env) === "omise" ? "omise" : "promptpay";
  const pack = await packInfo(env);
  const options = payOptions(env);
  const acc = options[0] || null;
  const ppOk = options.length > 0;
  return json({
    ok: true,
    product: env.PRODUCT_NAME || null,
    price_satang: priceSatang(env),
    currency: env.CURRENCY || "THB",
    payment: {
      provider,
      promptpay_configured: ppOk,
      promptpay_id_masked: acc?.masked || null,
      promptpay_proxy_type: acc?.type || null,        // mobile | national-id | e-wallet | bank-account
      promptpay_bank_code: acc?.type === "bank-account" ? acc.bank : null,
      promptpay_options: options.map((o) => ({ key: o.key, label: o.label, proxy_type: o.type, masked_id: o.masked, bank_code: o.bank })),
      poll: env.POLL_MINUTES || "60",
    },
    payment_configured: provider === "omise" ? !!env.OMISE_SECRET_KEY : ppOk,
    webhook_configured: !!env.OMISE_WEBHOOK_SECRET,
    slip_verify: !env.EASYSLIP_API_KEY
      ? "off — รอแอดมินกดอนุมัติเองที่หลังบ้าน"
      : autoApproveOn(env)
        ? "easyslip v2 — ตรวจสลิป/ยอดเงิน + อนุมัติอัตโนมัติ"
        : "easyslip v2 — ตรวจให้ แต่ไม่อนุมัติเอง (AUTO_APPROVE=0)",
    auto_approve: autoApproveOn(env),
    slip_match_amount: env.SLIP_MATCH_AMOUNT !== "0",
    slip_match_account: env.SLIP_MATCH_ACCOUNT !== "0",
    auto_verify_max_attempts: maxVerifyAttempts(env),
    require_email: String(env.REQUIRE_EMAIL ?? "1") !== "0",
    email_configured: !!env.RESEND_API_KEY,
    notify_configured: !!env.NOTIFY_EMAIL,
    download_configured: !!env.DOWNLOAD_SIGNING_KEY,
    admin_configured: !!env.ADMIN_TOKEN,
    storage: { d1: !!env.DB, r2: !!env.FILES },
    free_sample: {
      prompts: FREE_SAMPLES.length,
      ids: FREE_SAMPLE_META.ids,
      leads_configured: !!env.DB,
      source: FREE_SAMPLE_META.source,
    },
    // “แพ็กอัปเดตตัวเอง”: ลิงก์ทุกอันเสิร์ฟไฟล์รุ่นล่าสุด + มีทะเบียนลูกค้าสำหรับแจ้งเวอร์ชันใหม่
    pack: {
      version: pack.version,
      prompts_total: pack.prompts,
      niches_total: pack.niches,
      source: pack.source,                         // code = ยังไม่ออกรุ่นผ่านหลังบ้าน · published = ใช้ทะเบียนใน D1
      published_at: pack.published_at || null,
      notes: pack.notes || null,
    },
    pack_updates: {
      promise: PACK_UPDATE_PROMISE,
      subscribers_configured: !!env.DB,
      notify_batch: Math.min(Math.max(Number(env.PACK_NOTIFY_BATCH || 20), 1), 50),
      download_ttl_hours: Number(env.DOWNLOAD_TTL_HOURS || 24),
      update_link_ttl_hours: Number(env.UPDATE_LINK_TTL_HOURS || 720),
    },
    app_origin: env.APP_ORIGIN || null,
  });
}

/* ---------- router ---------- */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    try {
      if (pathname.startsWith("/api/") || pathname === "/paid" || pathname === "/unsubscribe" || pathname.startsWith("/admin")) await ensureSchema(env);
      if (pathname === "/api/checkout" && request.method === "POST") return await handleCheckout(request, env);
      if (pathname.startsWith("/api/order/") && pathname.endsWith("/report") && request.method === "POST") {
        return await handleReport(request, pathname.slice("/api/order/".length, -"/report".length), env);
      }
      if (pathname.startsWith("/api/order/") && request.method === "GET") return await handleOrderStatus(pathname.slice("/api/order/".length), env);
      if (pathname === "/api/webhook/omise" && request.method === "POST") return await handleWebhook(request, env);
      if (pathname.startsWith("/api/download/") && request.method === "GET") return await handleDownload(pathname.slice("/api/download/".length), request, env);
      if (pathname === "/api/retrieve" && request.method === "POST") return await handleRetrieve(request, env);
      if (pathname === "/api/free" && request.method === "GET") return await handleFreeSampleInfo(env, request);
      if (pathname === "/api/free" && request.method === "POST") return await handleFreeSample(request, env);
      if (pathname === "/unsubscribe" && (request.method === "GET" || request.method === "POST")) return await handleUnsubscribe(request, env);
      if (pathname === "/api/qr" && request.method === "GET") return handleQr(request, env);
      if (pathname === "/api/pack" && request.method === "GET") return await handlePackInfo(env);
      if (pathname === "/api/health" && request.method === "GET") return await handleHealth(env);
      if (pathname === "/paid" && request.method === "GET") return await handlePaidPage(url.searchParams.get("order"), env, appOrigin(env, request));
      if (pathname === "/admin/orders" && request.method === "GET") return await handleAdmin(request, env);
      if (pathname === "/admin/leads" && request.method === "GET") return await handleAdminLeads(request, env);
      if (pathname === "/admin/leads.csv" && request.method === "GET") return await handleAdminLeadsCsv(request, env);
      if (pathname === "/admin/leads/delete" && request.method === "POST") return await handleAdminLeadDelete(request, env);
      const approve = pathname.match(/^\/admin\/orders\/([^/]+)\/approve$/);
      if (approve && request.method === "POST") return await handleAdminApprove(request, approve[1], env);
      const reject = pathname.match(/^\/admin\/orders\/([^/]+)\/reject$/);
      if (reject && request.method === "POST") return await handleAdminReject(request, reject[1], env);
      const del = pathname.match(/^\/admin\/orders\/([^/]+)\/delete$/);
      if (del && request.method === "POST") return await handleAdminDelete(request, del[1], env);
      if (pathname === "/admin/product" && (request.method === "GET" || request.method === "POST")) {
        return await handleAdminProduct(request, env);
      }
      if (pathname === "/admin/pack" && request.method === "GET") return await handleAdminPack(request, env);
      if (pathname === "/admin/pack/publish" && request.method === "POST") return await handleAdminPackPublish(request, env);
      if (pathname === "/admin/pack/notify" && request.method === "POST") return await handleAdminPackNotify(request, env);
      if (pathname === "/admin/pack/customers.csv" && request.method === "GET") return await handleAdminPackCustomersCsv(request, env);
      const slip = pathname.match(/^\/admin\/slip\/([^/]+)$/);
      if (slip && request.method === "GET") return await handleAdminSlip(slip[1], request, env);
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return new Response("promptpack-shop", { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
    } catch (e) {
      return json({ error: String(e.message || e) }, 500);
    }
  },
};
