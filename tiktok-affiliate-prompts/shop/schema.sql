-- D1 schema — Prompt Pack Shop (99 บาท) · รับเงินพร้อมเพย์ตรงเข้าบัญชีร้าน
-- หมายเหตุ: worker.js สร้างตาราง/คอลัมน์เหล่านี้ให้อัตโนมัติแล้ว (ensureSchema)
-- ไฟล์นี้ใช้เป็นเอกสารอ้างอิง/สำหรับรันมือผ่าน `wrangler d1 execute --file=schema.sql`

CREATE TABLE IF NOT EXISTS orders (
  id             TEXT PRIMARY KEY,
  email          TEXT,
  amount_satang  INTEGER NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'THB',
  -- pending  = สร้างออเดอร์แล้ว ยังไม่แจ้งโอน
  -- reported = ลูกค้าแจ้งว่าโอนแล้ว (อาจมีสลิป) รอร้านตรวจ
  -- paid     = ยืนยันการชำระเงินแล้ว (ส่งลิงก์โหลดอัตโนมัติ)
  -- failed   = ปฏิเสธ (สลิปไม่ถูกต้อง) · refunded = คืนเงินแล้ว
  status         TEXT NOT NULL DEFAULT 'pending',
  provider       TEXT NOT NULL DEFAULT 'promptpay',   -- promptpay | omise
  charge_id      TEXT,          -- ใช้เมื่อ provider = omise
  qr_content     TEXT,          -- payload QR พร้อมเพย์ที่ลูกค้าสแกน
  qr_image_url   TEXT,          -- ใช้เมื่อ provider = omise
  download_count INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at        TEXT,
  reported_at    TEXT,          -- เวลาที่ลูกค้าแจ้งโอน
  emailed_at     TEXT,
  slip_key       TEXT,          -- key ของสลิปใน R2 เช่น slips/ord_xxx
  slip_mime      TEXT,
  slip_bytes     INTEGER,
  trans_ref      TEXT,          -- เลขอ้างอิงธุรกรรมจากสลิป (กันสลิปซ้ำ)
  verify_source  TEXT,          -- manual | easyslip | omise
  review_note    TEXT,
  pay_target       TEXT,        -- ช่องทางรับเงินที่ลูกค้าเลือก (hash สั้น)
  pay_target_label TEXT,        -- ป้ายชื่อช่องทาง (ให้หลังบ้านอ่าน)
  verify_attempts  INTEGER NOT NULL DEFAULT 0,  -- ลองตรวจอัตโนมัติกี่ครั้งแล้ว (กันกินโควตา)
  verify_note      TEXT,        -- เหตุผลที่ระบบยังยืนยันอัตโนมัติไม่ได้
  verify_mode      TEXT,        -- image (แนบรูป) | qr (วางข้อความ QR) | off | skip | none
  last_download_version TEXT   -- เวอร์ชันแพ็กที่ลูกค้ารายนี้โหลดล่าสุด (ใช้ทำแคมเปญ "คุณยังใช้ v1.4 อยู่")
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_charge ON orders(charge_id);
CREATE INDEX IF NOT EXISTS idx_orders_email ON orders(email);
-- กันนำสลิปเดิมมาใช้ซ้ำกับหลายออเดอร์ (ใช้ร่วมกับ isDuplicate ของผู้ให้บริการตรวจสลิป)
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_transref ON orders(trans_ref) WHERE trans_ref IS NOT NULL;

-- บันทึกการส่งอีเมล (ใช้จำกัดจำนวนครั้งของการขอลิงก์ซ้ำ)
CREATE TABLE IF NOT EXISTS email_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   TEXT,
  email      TEXT,
  kind       TEXT NOT NULL,          -- receipt | resend
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_email_log_email ON email_log(email, kind, created_at);

-- อีเมลผู้สนใจที่มารับของแถม 5 prompt ฟรี (หน้า /free) — เก็บเท่าที่จำเป็น
-- เก็บ hash ของ IP (ไม่เก็บ IP จริง) เพื่อกันสแปม · last_sent_at = ครั้งล่าสุดที่ส่งของแถมให้
CREATE TABLE IF NOT EXISTS leads (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  source        TEXT,          -- มาจากหน้าไหน เช่น free-page
  consent_at    TEXT,          -- เวลาที่ลูกค้าติ๊กยินยอมให้เก็บอีเมล
  ip_hash       TEXT,          -- HMAC ของ IP (ย้อนกลับไม่ได้) สำหรับจำกัดจำนวนครั้ง
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_sent_at  TEXT           -- ส่งของแถมให้ล่าสุดเมื่อไร
);
CREATE INDEX IF NOT EXISTS idx_leads_ip ON leads(ip_hash, created_at);
-- หมายเหตุ: จำนวนครั้งที่ส่งของแถมต่ออีเมล/ชม. อ่านจาก email_log (kind='free')

-- ═══ แพ็กอัปเดตตัวเอง ═══════════════════════════════════════════════════════
-- แนวคิด: ลิงก์ดาวน์โหลดทุกอันชี้ที่ “ไฟล์ปัจจุบัน” (PDF_OBJECT_KEY) ไม่ผูกกับเวอร์ชัน
--        → ออกรุ่นใหม่แล้วลูกค้าคนเดิมกดลิงก์เดิมก็ได้ไฟล์ใหม่ (ไม่ต้องซื้อซ้ำ/ไม่มีระบบสมาชิก)

-- ทะเบียนเวอร์ชันที่เคยออก (เก็บไฟล์เดิมไว้ที่ versions/prompt-pack-v<รุ่น>.pdf ไม่ทับกัน)
CREATE TABLE IF NOT EXISTS pack_versions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  version        TEXT NOT NULL,               -- เช่น 1.4 · 1.5 (อ่านค่าเริ่มต้นจาก pack-version.mjs)
  prompts        INTEGER,                     -- จำนวน prompt ของรุ่นนั้น
  niches         INTEGER,                     -- จำนวนหมวดสินค้า
  pages          INTEGER,                     -- จำนวนหน้าของ PDF
  object_key     TEXT NOT NULL DEFAULT 'prompt-pack.pdf',
  bytes          INTEGER,
  sha256         TEXT,                        -- ตรวจได้ว่าไฟล์ที่ลูกค้าโหลดตรงกับที่ออกรุ่น
  notes          TEXT,                        -- “มีอะไรใหม่” ใช้ในอีเมลแจ้งลูกค้า
  is_current     INTEGER NOT NULL DEFAULT 0,  -- 1 = รุ่นที่ลูกค้าโหลดอยู่ (มีได้แถวเดียว)
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  notified_at    TEXT,
  notified_count INTEGER NOT NULL DEFAULT 0,  -- ส่งอีเมลแจ้งสำเร็จกี่คน (สะสม)
  notify_failed  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pack_versions_current ON pack_versions(is_current, id);

-- ทะเบียนลูกค้าที่ซื้อแล้ว (คีย์ = อีเมล) · เพิ่มอัตโนมัติตอนยืนยันการชำระเงิน
-- ใช้แจ้ง “มีเวอร์ชันใหม่” และดูว่าใครตามหลังอยู่ (last_download_version < last_notified_version)
CREATE TABLE IF NOT EXISTS subscribers (
  email                  TEXT PRIMARY KEY,
  first_order_id         TEXT,
  last_order_id          TEXT,        -- ใช้สร้างลิงก์ดาวน์โหลดในอีเมลแจ้งรุ่นใหม่
  orders_count           INTEGER NOT NULL DEFAULT 0,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT,
  last_download_version  TEXT,        -- รุ่นที่โหลดล่าสุด
  last_notified_version  TEXT NOT NULL DEFAULT '',  -- รุ่นล่าสุดที่แจ้งไปแล้ว ('' = ยังไม่เคยแจ้ง)
  notified_at            TEXT,
  unsubscribed_at        TEXT         -- กดยกเลิกรับอีเมลแล้ว → หยุดส่งทั้งการตลาดและแจ้งรุ่นใหม่
);
CREATE INDEX IF NOT EXISTS idx_subscribers_notify ON subscribers(last_notified_version);
-- ประวัติการส่ง: email_log kind='update' order_id='v<รุ่น>' = “แจ้งเวอร์ชันนี้ไปแล้ว”
