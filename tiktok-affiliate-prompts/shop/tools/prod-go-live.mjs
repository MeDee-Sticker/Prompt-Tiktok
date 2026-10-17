// ซ้อม go-live บนร้านที่ deploy จริง (production หรือพรีวิว): อัปโหลดไฟล์สินค้า → สั่งซื้อ → อนุมัติ → อีเมลจริง → โหลดไฟล์จริง
// รัน: BASE=https://<โดเมนร้าน> node tools/prod-go-live.mjs
//
// ⚠️ ตัวนี้ “ทำงานจริง” บนที่ร้าน: สร้างออเดอร์จริง 1 ใบ + ส่งอีเมลจริง 1 ฉบับ ไปที่ NOTIFY_EMAIL (อีเมลร้านเอง)
//    แล้วลบออเดอร์ทดสอบออกให้เองเมื่อทุกข้อผ่าน · ต้องมี ADMIN_TOKEN ใน .secrets/ และ R2 ต้องผูกแล้ว
// ⚠️ ไม่พิมพ์อีเมล/โทเคนเต็มออกจอ — พิมพ์แบบปิดบางส่วนเท่านั้น
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE || "";
if (!BASE) { console.error("ต้องตั้ง BASE=https://<โดเมนร้าน>"); process.exit(2); }
const SHOP = new URL("../", import.meta.url).pathname;
const ADMIN = fs.readFileSync(path.join(SHOP, ".secrets/ADMIN_TOKEN"), "utf8").trim();
const BUYER = fs.readFileSync(path.join(SHOP, ".secrets/NOTIFY_EMAIL"), "utf8").trim(); // อีเมลร้านเอง → เช็คในกล่องได้
const PDF = process.env.PDF_FILE || path.join(SHOP, "build/prompt-pack.pdf");
const mask = (e) => String(e).replace(/^(.).*?(@.*)$/, "$1•••$2");

let pass = 0; const fails = [];
const t = async (name, fn) => {
  try { const extra = await fn(); pass++; console.log("✅", name, extra ? `— ${extra}` : ""); }
  catch (e) { fails.push(name); console.log("❌", name, "\n   ", e.message); }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const j = async (p, init) => { const r = await fetch(BASE + p, init); return { status: r.status, headers: r.headers, body: await r.json().catch(() => null) }; };
const auth = { authorization: "Bearer " + ADMIN };

const pdfBytes = fs.readFileSync(PDF);
console.log(`== ซ้อม go-live: ${BASE} ==`);
console.log(`   ไฟล์สินค้า: ${path.basename(PDF)} ${(pdfBytes.length / 1024 / 1024).toFixed(2)} MB · อีเมลทดสอบ: ${mask(BUYER)}\n`);

await t("อัปโหลดไฟล์สินค้าขึ้น R2 ของที่ร้าน (field: file) แล้วอ่านกลับมาเทียบขนาด", async () => {
  const fd = new FormData();
  fd.append("file", new File([pdfBytes], "prompt-pack.pdf", { type: "application/pdf" }));
  const up = await fetch(BASE + "/admin/product", { method: "POST", headers: auth, body: fd });
  const body = await up.json().catch(() => null);
  assert(up.status === 200, `อัปโหลดต้องได้ 200 ได้ ${up.status} ${JSON.stringify(body)}`);
  assert(body.bytes === pdfBytes.length, `ไบต์ที่รับต้องตรงกับไฟล์จริง (${body.bytes} vs ${pdfBytes.length})`);
  const chk = await j("/admin/product", { headers: auth });
  assert(chk.body?.uploaded === true, "R2 ต้องมีไฟล์สินค้าแล้ว: " + JSON.stringify(chk.body));
  assert(chk.body.bytes === pdfBytes.length, `ขนาดใน R2 ต้องตรงกับไฟล์จริง (${chk.body.bytes})`);
  return `${chk.body.key} · ${chk.body.bytes} ไบต์`;
});

let orderId = null, emailId = null, pdfFromLink = null;
await t("ลูกค้าสั่งซื้อ (อีเมลร้านเอง) → ออเดอร์ pending + ยอดตามราคาที่ตั้ง", async () => {
  const { status, body } = await j("/api/checkout", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: BUYER, source: "go-live-rehearsal" }),
  });
  assert(status === 200, "checkout ต้องได้ 200: " + JSON.stringify(body));
  orderId = body.order_id;
  assert(orderId, "ต้องได้ order_id");
  assert(body.amount_satang > 0, "ต้องมียอดเงิน");
  const st = await j("/api/order/" + orderId);
  assert(st.body.status === "pending", "สถานะเริ่มต้นต้อง pending ได้ " + st.body.status);
  return `order=${orderId} · ฿${(body.amount_satang / 100).toFixed(2)}`;
});

await t("ร้านกดอนุมัติ → paid + ส่งอีเมลลิงก์โหลดจริง (Resend คืน id)", async () => {
  const { status, body } = await j(`/admin/orders/${orderId}/approve`, {
    method: "POST", headers: { ...auth, "content-type": "application/json" }, body: "{}",
  });
  assert(status === 200, "อนุมัติต้องได้ 200: " + JSON.stringify(body));
  assert(body.status === "paid", "สถานะต้องเป็น paid");
  assert(body.email_sent === true, "ต้องส่งอีเมลสำเร็จ: " + JSON.stringify(body.email));
  emailId = body.email?.id || null;
  assert(emailId, "Resend ต้องคืน id ของอีเมล: " + JSON.stringify(body.email));
  return `email id=${emailId}`;
});

await t("ลิงก์ในอีเมล/หน้า /paid ชี้โดเมนที่เสิร์ฟจริง + โหลด PDF ได้จริง", async () => {
  const paid = await j("/paid?order=" + orderId);
  assert(paid.status === 200 && paid.body.status === "paid", "/paid ต้องบอก paid: " + JSON.stringify(paid.body));
  const url = paid.body.download_url;
  assert(url?.startsWith(BASE + "/api/download/"), `URL ต้อง absolute ที่โดเมนนี้: ${url}`);
  const r = await fetch(url);
  assert(r.status === 200, "โหลดต้องได้ 200 ได้ " + r.status);
  assert(r.headers.get("content-type") === "application/pdf", "ต้องเป็น application/pdf");
  const buf = new Uint8Array(await r.arrayBuffer());
  assert(String.fromCharCode(...buf.slice(0, 5)) === "%PDF-", "ต้องเป็นไฟล์ PDF จริง");
  assert(buf.length === pdfBytes.length, `ไฟล์ที่ลูกค้าโหลดต้องตรงกับที่อัปโหลด (${buf.length} vs ${pdfBytes.length})`);
  pdfFromLink = buf.length;
  return `PDF ${(buf.length / 1024 / 1024).toFixed(2)} MB · v${r.headers.get("x-pack-version") || "?"}`;
});

await t("หลังบ้านเห็นออเดอร์ว่าจ่ายแล้ว + นับรอบโหลด + ลิงก์ก่อนจ่ายโหลดไม่ได้", async () => {
  const list = await j("/admin/orders", { headers: auth });
  const row = list.body.orders?.find((o) => o.id === orderId);
  assert(row, "ต้องเห็นออเดอร์ในหลังบ้าน");
  assert(row.status === "paid" && row.emailed_at, "ต้องมี paid_at/emailed_at");
  assert(row.download_count >= 1, "ต้องนับรอบโหลด ได้ " + row.download_count);
  const fresh = (await j("/api/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: BUYER }) })).body;
  assert((await j("/paid?order=" + fresh.order_id)).body.status === "pending", "ออเดอร์ใหม่ต้องยังไม่ paid");
  assert((await fetch(BASE + "/api/download/dummy.token")).status === 403, "โทเคนปลอมต้องโดน 403");
  await j(`/admin/orders/${fresh.order_id}/delete`, { method: "POST", headers: auth });
  return `emailed_at=${row.emailed_at} · download_count=${row.download_count}`;
});

console.log(`\nสรุปซ้อม go-live: ผ่าน ${pass} ข้อ${fails.length ? ` · ล้มเหลว ${fails.length}: ${fails.join(" | ")}` : " — ไม่มีข้อล้มเหลว"}`);
console.log(`   ออเดอร์ทดสอบ: ${orderId} · Resend id: ${emailId} · PDF ที่โหลดได้: ${pdfFromLink} ไบต์`);
console.log("   ⏳ ยังต้องให้คนทำเอง: สแกน QR ในแอปธนาคาร → ต้องขึ้นชื่อบัญชีร้าน · โอนจริง ฿1 → ตรวจสลิปอัตโนมัติ");

if (!fails.length && orderId) {
  const d = await j(`/admin/orders/${orderId}/delete`, { method: "POST", headers: auth });
  console.log("🧹 ลบออเดอร์ทดสอบ:", d.status === 200 ? "ลบแล้ว" : "ลบไม่ได้ " + d.status);
} else if (orderId) {
  console.log("⚠️ เก็บบอเดอร์ทดสอบไว้เพื่อตรวจสาเหตุ:", orderId);
}
process.exit(fails.length ? 1 : 0);
