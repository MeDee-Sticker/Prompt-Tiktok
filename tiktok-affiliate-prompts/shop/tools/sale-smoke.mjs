// เทสขายจริงบน workerd (wrangler dev) — ใช้ของจริงทั้งหมด: D1 local, R2 local, ส่งอีเมลจริงผ่าน Resend
// วิธีใช้: bash tools/live-sale.sh [พอร์ต]   ← ตัวนี้จะสตาร์ท workerd + วาง PDF ลง R2 + ส่ง EXPECT_IDS/BUYER_EMAIL ให้
// ตัวนี้ไม่พิมพ์อีเมลลูกค้าเต็ม (ปิดบางส่วน)
import assert from "node:assert";
import { inspectPayload, crc16, normalizePromptPayId, maskPromptPayId } from "../promptpay.mjs";
import { qrSvg } from "../qr.mjs";

const BASE = process.env.BASE || "http://127.0.0.1:8801";
const TOKEN = process.env.ADMIN_TOKEN || "";
const BUYER = process.env.BUYER_EMAIL || "";
// รหัสพร้อมเพย์ที่ “ตั้งไว้จริง” ใน .dev.vars (ช่องแรก = ค่าเริ่มต้น) — ใช้ยืนยันว่า QR ชี้เลขที่ตั้งไว้ ไม่ใช่ค่าค้างเก่า
const EXPECT_IDS = String(process.env.EXPECT_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
const mask = (e) => String(e).replace(/^(.).*?(@.*)$/, "$1•••$2");
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

if (!TOKEN) { console.error("❌ ไม่มี ADMIN_TOKEN"); process.exit(2); }
if (!BUYER) { console.error("❌ ไม่มี BUYER_EMAIL"); process.exit(2); }
if (!EXPECT_IDS.length) { console.error("❌ ไม่มี EXPECT_IDS (รหัสพร้อมเพย์ที่ตั้งไว้จริง คั่นด้วย ,) — ปกติ tools/live-sale.sh ส่งมาจาก .dev.vars ให้แล้ว"); process.exit(2); }

let pass = 0;
const fails = [];
const notes = [];
async function t(name, fn) {
  try {
    const extra = await fn();
    pass++;
    console.log("✅", name, extra ? `— ${extra}` : "");
  } catch (e) {
    fails.push(name);
    console.log("❌", name, "\n   ", e.message);
  }
}
const j = async (path, init) => {
  const r = await fetch(BASE + path, init);
  return { status: r.status, headers: r.headers, body: await r.json().catch(() => null) };
};

console.log(`== เทสขายจริงบน workerd: ${BASE} ==`);
console.log(`   อีเมลลูกค้าที่ใช้ทดสอบ: ${mask(BUYER)}`);
console.log(`   ช่องทางรับเงินที่ต้องได้: ${EXPECT_IDS.length} ช่อง (ค่าเริ่มต้น = ${maskPromptPayId(EXPECT_IDS[0])})\n`);

await t("ร้านออนไลน์จริง: /api/health 200 + พร้อมเพย์/D1/R2 พร้อม + โหมดตรวจสลิป = manual (ยังไม่ตั้ง EASYSLIP)", async () => {
  const { status, body } = await j("/api/health");
  assert.equal(status, 200);
  assert.equal(body.payment.provider, "promptpay");
  assert.equal(body.payment.promptpay_configured, true);
  assert.equal(body.storage.d1, true);
  assert.equal(body.storage.r2, true);
  // เลขเต็มต้องไม่หลุดออกหน้าเว็บ · และช่องหลักต้องเป็นช่องแรกที่ตั้งไว้จริง (กันค่าเก่าค้างใน config)
  for (const id of EXPECT_IDS) assert.ok(!JSON.stringify(body).includes(id), `ห้ามโชว์รหัสพร้อมเพย์เต็ม (${maskPromptPayId(id)})`);
  assert.equal(body.payment.promptpay_options.length, EXPECT_IDS.length, "จำนวนช่องทางต้องตรงกับที่ตั้งไว้: " + JSON.stringify(body.payment.promptpay_options));
  assert.equal(body.payment.promptpay_id_masked, maskPromptPayId(EXPECT_IDS[0]), "ช่องหลักต้องเป็นช่องแรกที่ตั้งไว้");
  return `โหมดสลิป: ${body.slip_verify?.mode || body.slip_verify || "-"} · auto_approve=${body.slip_verify?.auto_approve ?? "-"} · ช่องทาง: ${body.payment.promptpay_options.map((o) => o.masked_id).join(" | ")}`;
});

// ── 1) ลูกค้ากดสั่ง (เหมือนกดในหน้า /order) ─────────────────────────────
let orderId, qrPayload, approveBody;
await t(`ลูกค้ากดสั่ง: POST /api/checkout (อีเมลจริง ${mask(BUYER)}) → ออเดอร์ pending + QR พร้อมเพย์ ฿99 (CRC ถูก)`, async () => {
  const { status, body } = await j("/api/checkout", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: BUYER, source: "qa-live" }),
  });
  assert.equal(status, 200, JSON.stringify(body));
  orderId = body.order_id;
  qrPayload = body.qr_content;
  assert.ok(orderId, "ต้องได้ order_id");
  assert.equal(body.amount_satang, 9900);
  const info = inspectPayload(qrPayload);
  assert.ok(info.crcValid, "CRC ของ QR ต้องถูก");
  assert.equal(crc16(qrPayload.slice(0, -4)), qrPayload.slice(-4));
  assert.equal(info.amount, "99.00");
  // QR ต้องชี้ “รหัสพร้อมเพย์ช่องแรกที่ตั้งไว้จริง” (ทั้งชนิดและเลข) — ไม่ใช่ค่าค้างเก่าจาก config
  const want = normalizePromptPayId(EXPECT_IDS[0]);
  assert.ok(want, "EXPECT_IDS[0] ต้องเป็นรหัสพร้อมเพย์ที่ถูกต้อง");
  assert.equal(info.proxyType, want.type, "ชนิดพร้อมเพย์ของ QR ต้องตรงกับช่องหลักที่ตั้งไว้");
  assert.ok(info.merchant.includes(want.value), `QR ต้องชี้เลขช่องหลัก (${maskPromptPayId(EXPECT_IDS[0])}) ได้ merchant=${info.merchant}`);
  assert.equal(body.qr_svg, qrSvg(qrPayload, { scale: 8, margin: 4, alt: "PromptPay QR" }));
  return `order=${orderId} · ผู้รับ=${info.proxyType} · ที่โชว์บนหน้าจ่าย=${body.payee?.name || ""}`;
});

await t("หน้ากดสั่งโหลดสถานะออเดอร์เดิมได้ (กลับเข้าหน้าด้วย ?order=)", async () => {
  const { status, body } = await j("/api/order/" + orderId);
  assert.equal(status, 200);
  assert.equal(body.status, "pending");
  assert.equal(body.qr_content, qrPayload);
  return `status=${body.status}`;
});

// ── 2) ลูกค้าโอน + แนบสลิป ─────────────────────────────────────────────
await t("ลูกค้าแนบสลิป: POST /api/order/:id/report → reported + เก็บสลิปเข้า R2", async () => {
  const fd = new FormData();
  fd.append("slip", new File([PNG], "slip.png", { type: "image/png" }));
  const { status, body } = await j(`/api/order/${orderId}/report`, { method: "POST", body: fd });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.status, "reported");
  assert.equal(body.has_slip, true);
  return `status=${body.status}`;
});

await t("สลิปถูกเก็บจริงใน R2 (เปิดดูจากหลังบ้านได้รูปตรงกับที่อัปโหลด)", async () => {
  assert.equal((await fetch(`${BASE}/admin/slip/${orderId}`)).status, 401, "ไม่มี token ต้อง 401");
  const r = await fetch(`${BASE}/admin/slip/${orderId}?token=${encodeURIComponent(TOKEN)}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "image/png");
  const got = new Uint8Array(await r.arrayBuffer());
  assert.deepEqual(got, PNG);
  return `${got.length} ไบต์`;
});

// ── 3) ร้านกดอนุมัติ → ต้องส่งอีเมลจริง ─────────────────────────────────
await t("ร้านกดอนุมัติ: POST /admin/orders/:id/approve → paid + ส่งอีเมลลิงก์โหลดจริงผ่าน Resend (ได้ id จริง)", async () => {
  const { status, body } = await j(`/admin/orders/${orderId}/approve`, {
    method: "POST", headers: { authorization: "Bearer " + TOKEN, "content-type": "application/json" }, body: "{}",
  });
  approveBody = body;
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.status, "paid");
  assert.equal(body.email_sent, true, `ต้องส่งอีเมลสำเร็จ ได้: ${JSON.stringify(body.email)}`);
  assert.ok(body.email?.id, "Resend ต้องคืน id ของอีเมลที่รับส่ง ได้: " + JSON.stringify(body.email));
  return `email id=${body.email.id}`;
});

await t("อีเมลที่ส่งถึงลูกค้า = ฉบับลิงก์ดาวน์โหลด (Resend รับส่งจริง ไม่ใช่ skipped/error)", async () => {
  assert.ok(!approveBody?.email?.error, "ต้องไม่มี error: " + JSON.stringify(approveBody?.email));
  assert.ok(!approveBody?.email?.skipped, "ต้องไม่ถูกข้าม: " + JSON.stringify(approveBody?.email));
  notes.push(`Resend accepted id=${approveBody.email.id} → ${mask(BUYER)}`);
  return `id=${approveBody.email.id}`;
});

// ── 4) หลังบ้านมองเห็นว่าส่งแล้ว + ลูกค้าโหลดได้จริง ──────────────────────
await t("หลังบ้านยืนยันว่าส่งอีเมลแล้ว (emailed_at) + ลูกค้าโหลด PDF ได้จริงจาก R2", async () => {
  const list = await j("/admin/orders", { headers: { authorization: "Bearer " + TOKEN } });
  assert.equal(list.status, 200);
  const row = list.body.orders.find((o) => o.id === orderId);
  assert.ok(row, "ต้องเห็นออเดอร์");
  assert.equal(row.status, "paid");
  assert.ok(row.emailed_at, "ต้องมี emailed_at (ส่งอีเมลสำเร็จ)");
  assert.equal(row.slip_key, `slips/${orderId}`);

  const paid = await j("/paid?order=" + orderId);
  assert.equal(paid.status, 200);
  assert.ok(paid.body.download_url?.startsWith(BASE + "/api/download/"), "URL ต้อง absolute: " + JSON.stringify(paid.body));
  const r = await fetch(paid.body.download_url);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "application/pdf");
  const buf = new Uint8Array(await r.arrayBuffer());
  assert.ok(buf.length > 100000, "PDF ต้องใหญ่กว่า 100KB ได้ " + buf.length);
  assert.equal(String.fromCharCode(...buf.slice(0, 5)), "%PDF-", "ต้องเป็น PDF จริง");

  const after = (await j("/admin/orders", { headers: { authorization: "Bearer " + TOKEN } })).body.orders.find((o) => o.id === orderId);
  assert.equal(after.download_count, 1, "ต้องนับรอบโหลด");
  return `emailed_at=${row.emailed_at} · PDF ${(buf.length / 1024).toFixed(0)} KB`;
});

await t("ยังไม่จ่าย = โหลดไม่ได้ (403) · token ปลอม = 403", async () => {
  const o = (await j("/api/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: BUYER }) })).body;
  assert.notEqual((await j("/paid?order=" + o.order_id)).body.status, "paid");
  assert.equal((await fetch(BASE + "/api/download/dummy.token")).status, 403);
  assert.equal((await fetch(BASE + "/api/download/" + "a".repeat(20) + ".b")).status, 403);
  return "กันการโหลดก่อนจ่ายทำงาน";
});

// ── 5) ของแถมฟรี → อีเมลจริงอีกฉบับ ───────────────────────────────────
await t("ทดสอบของแถมฟรีด้วยอีเมลจริง: POST /api/free (ยินยอม) → เก็บลง D1 + ส่งอีเมล 5 prompt จริง", async () => {
  const { status, body } = await j("/api/free", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: BUYER, consent: true, source: "qa-live" }),
  });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.email_sent, true, "ต้องส่งอีเมลของแถมจริง ได้: " + JSON.stringify(body));
  const leads = await j("/admin/leads", { headers: { authorization: "Bearer " + TOKEN } });
  const lead = leads.body.leads.find((l) => l.email === BUYER);
  assert.ok(lead, "ต้องเห็นผู้สนใจในหลังบ้าน");
  assert.equal(lead.source, "qa-live");
  return `email id=${body.email_id || body.id || "?"} · source=${lead.source}`;
});

console.log(`\nสรุปเทสขายจริง: ผ่าน ${pass} ข้อ${fails.length ? ` · ล้มเหลว ${fails.length}: ${fails.join(" | ")}` : " — ไม่มีข้อล้มเหลว"}`);
for (const n of notes) console.log("   ℹ️ " + n);
console.log(`   ออเดอร์ที่ใช้ทดสอบ: ${orderId}`);
process.exit(fails.length ? 1 : 0);
