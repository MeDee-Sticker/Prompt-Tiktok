// ทดสอบ flow ทั้งหมดแบบ mock D1/R2/Resend/EasySlip/Omise — รัน: node test.mjs
import worker from "./worker.js";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { FREE_SAMPLES, FREE_SAMPLE_META } from "./free-sample.mjs";
import { PACK_RELEASE } from "./pack-version.mjs";
import { makeMockEnv, installFetchMock, omiseSignature, TINY_PNG, payloadCrcOk, slipCalls, resetSlipCalls } from "./mock-env.mjs";
import { buildPromptPayPayload, crc16, normalizePromptPayId, maskPromptPayId, inspectPayload, parsePromptPayOptions, promptPayOptionLabel, bankName, slipReceiverMatches } from "./promptpay.mjs";
import { qrMatrix, qrSvg } from "./qr.mjs";

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // %PDF-1.4
const SHOP = "https://shop.example.com";
const BASE = SHOP;

// mock ร่วมกันทุก env (fetch mock ติดตั้งครั้งเดียว เพื่อไม่ให้ restore ทับกัน)
const charges = new Map();
const sentEmails = [];
let easySlipCfg = null; // กำหนดผลลัพธ์ของ EasySlip ต่อเทสต์
installFetchMock({ charges, sentEmails, easySlip: async () => easySlipCfg });

const main = makeMockEnv({ pdfBytes: PDF_BYTES });
const { env, orders, emailLog } = main;
const r2 = main.r2;

const req = (p, init = {}) => new Request(p.startsWith("http") ? p : BASE + p, init);
const postJson = (path, obj) => req(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(obj ?? {}) });
const postForm = (path, form) => req(path, { method: "POST", body: form });
const adminReq = (path, opts = {}) => req(path, { ...opts, headers: { authorization: "Bearer admin-secret", ...(opts.headers || {}) } });
const slipForm = (bytes = TINY_PNG, name = "slip.png", type = "image/png") => {
  const fd = new FormData();
  fd.append("slip", new File([bytes], name, { type }));
  return fd;
};

let pass = 0;
const fails = [];
async function t(name, fn) {
  try {
    await fn();
    pass++;
    console.log("✅", name);
  } catch (e) {
    fails.push(name);
    console.log("❌", name, "\n   ", e.message);
  }
}

/* ===================== A. หน่วยพื้นฐาน: CRC / payload / normalization ===================== */
await t("CRC16/CCITT-FALSE ตรง test vector 123456789 → 29B1", () => {
  assert.equal(crc16("123456789"), "29B1");
});

await t("CRC ตรงกับตัวอย่างที่เผยแพร่ของ dtinth/promptpay-qr (E469)", () => {
  const body = "00020101021229370016A000000677010111011300660000000005802TH530376454044.22";
  assert.equal(crc16(body + "6304"), "E469");
});

await t("payload ตรงกับตัวอย่างจริงของ Saladpuk/PromptPay (0914185401 + ฿50) ทุกตัวอักษร", () => {
  assert.equal(
    buildPromptPayPayload({ id: "0914185401", amountSatang: 5000 }),
    "00020101021229370016A000000677010111011300669141854015303764540550.005802TH630401F8"
  );
});

await t("payload ตัวอย่าง ฿99 — ตัวเข้ารหัสใส่แท็ก + CRC ถูกต้อง (fixed test vector)", () => {
  const payload = buildPromptPayPayload({ id: "0812345678", amountSatang: 9900 });
  assert.equal(payload, "00020101021229370016A000000677010111011300668123456785303764540599.005802TH63047D6A");
  const info = inspectPayload(payload);
  assert.ok(info.crcValid && payloadCrcOk(payload), "CRC ต้องถูก");
  assert.equal(info.fields["00"], "01");
  assert.equal(info.fields["01"], "12"); // มียอด → dynamic
  assert.equal(info.merchant, "0016A00000067701011101130066812345678");
  assert.equal(info.currency, "764");
  assert.equal(info.amount, "99.00");
  assert.equal(info.country, "TH");
  assert.equal(payload.length, 83);
});

await t("payload แบบไม่ระบุยอด → 01=11 และไม่มีแท็ก 54", () => {
  const payload = buildPromptPayPayload({ id: "0812345678", amountSatang: null });
  const info = inspectPayload(payload);
  assert.equal(info.dynamic, false);
  assert.equal(info.amount, null);
  assert.ok(info.crcValid);
});

await t("normalize รหัสพร้อมเพย์: มือถือ 10/11/9 หลัก · บัตรประชาชน 13 · e-Wallet 15", () => {
  assert.deepEqual(normalizePromptPayId("081-234-5678"), { tag: "01", value: "0066812345678", type: "mobile" });
  assert.deepEqual(normalizePromptPayId("66812345678"), { tag: "01", value: "0066812345678", type: "mobile" });
  assert.deepEqual(normalizePromptPayId("812345678"), { tag: "01", value: "0066812345678", type: "mobile" });
  assert.deepEqual(normalizePromptPayId("1-2345-67890-12-3"), { tag: "02", value: "1234567890123", type: "national-id" });
  assert.deepEqual(normalizePromptPayId("123456789012345"), { tag: "03", value: "123456789012345", type: "e-wallet" });
  assert.equal(normalizePromptPayId("12345"), null);
  assert.equal(normalizePromptPayId(""), null);
});

await t("รหัสพร้อมเพย์ผิด → สร้าง QR ไม่ได้ (โยน error ชัดเจน)", () => {
  assert.throws(() => buildPromptPayPayload({ id: "12345", amountSatang: 9900 }), /ไม่ถูกต้อง/);
});

await t("ปิดรหัสบางส่วนตอนโชว์หน้าเว็บ (ไม่โชว์เลขเต็ม)", () => {
  assert.equal(maskPromptPayId("0812345678"), "081-xxx-5678"); // เก็บศูนย์นำหน้าไว้ ลูกค้าจำเบอร์ร้านได้
  assert.equal(maskPromptPayId("0880754039"), "088-xxx-4039");
  assert.equal(maskPromptPayId("66812345678"), "081-xxx-5678"); // รูปแบบ 66… ก็ปิดเหมือนกัน
  assert.equal(maskPromptPayId("1234567890123"), "xxx-xxx-0123");
});

/* ===================== B. QR encoder ===================== */
const QR_HASH = (modules) => {
  const s = modules.map((r) => r.join("")).join("");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
};

await t("QR ของ payload พร้อมเพย์ = เวอร์ชัน 5 (37×37) และตรงกับค่าอ้างอิงที่ตรวจด้วย OpenCV", () => {
  const payload = buildPromptPayPayload({ id: "0812345678", amountSatang: 9900 });
  const m = qrMatrix(payload);
  assert.equal(m.version, 5);
  assert.equal(m.size, 37);
  assert.equal(m.mask, 2);
  assert.equal(QR_HASH(m.modules), "e59967bf"); // ยืนยันแล้วว่าถอดกลับได้ด้วย OpenCV + ตรงกับ python-qrcode ทุกโมดูล
});

await t("SVG QR สร้างเองในเครื่อง ไม่มีการเรียกบริการภายนอก", () => {
  const svg = qrSvg(buildPromptPayPayload({ id: "0812345678", amountSatang: 9900 }));
  assert.ok(svg.startsWith("<svg "), "ต้องเป็น SVG");
  assert.ok(svg.includes('shape-rendering="crispEdges"'));
  assert.ok(!/https?:\/\//.test(svg.replace("http://www.w3.org/2000/svg", "")), "ต้องไม่มีการอ้าง URL ภายนอก");
  assert.ok(svg.length > 1000);
});

await t("QR ข้อความสั้น → เวอร์ชัน 1 และข้อความยาวเกิน → โยน error", () => {
  assert.equal(qrMatrix("HELLO").size, 21);
  assert.throws(() => qrMatrix("x".repeat(700)), /ยาวเกินไป/);
});

/* ===================== C. checkout (พร้อมเพย์ตรง) ===================== */
let checkout;
await t("checkout → สร้างออเดอร์ pending + คืน QR (SVG + payload) + ชื่อบัญชีผู้รับ (ไม่บอกชนิดพร้อมเพย์/ไม่โชว์เลข)", async () => {
  const res = await worker.fetch(postJson("/api/checkout", { email: "buyer@example.com" }), env);
  assert.equal(res.status, 200);
  checkout = await res.json();
  assert.ok(checkout.order_id.startsWith("ord_"));
  assert.equal(checkout.provider, "promptpay");
  assert.equal(checkout.amount_satang, 9900);
  assert.ok(payloadCrcOk(checkout.qr_content), "payload ต้องมี CRC ถูก");
  assert.ok(checkout.qr_svg.includes("<svg "), "ต้องมี QR เป็น SVG");
  // นโยบายร้าน (16 ต.ค. 2026): หน้าโอนโชว์ **แค่ชื่อบัญชี** — ไม่บอกว่าเป็นพร้อมเพย์แบบไหน และไม่โชว์เลข (แม้ปิดบางส่วน)
  assert.equal(checkout.payee.name, "ร้านทดสอบ");
  assert.equal(checkout.payee.masked_id, undefined, "checkout ต้องไม่ส่งเลขที่ปิดบางส่วนออกหน้าโอน");
  assert.ok(!JSON.stringify(checkout).includes("0812345678"), "checkout ต้องไม่รั่วรหัสพร้อมเพย์เต็ม");
  assert.ok(!/081-xxx-5678/.test(JSON.stringify(checkout)), "checkout ต้องไม่โชว์แม้แต่เลขที่ปิดบางส่วน");
  assert.deepEqual(checkout.pay_options.map((o) => o.label), ["ร้านทดสอบ"]);
  assert.equal(checkout.email, "buyer@example.com");
  assert.equal(orders.get(checkout.order_id).status, "pending");
  assert.equal(orders.get(checkout.order_id).qr_content, checkout.qr_content);
});

await t("checkout รับ “ที่มา” (src) → เก็บในออเดอร์ คลีนแล้ว ไม่หลุด HTML และสรุปในหลังบ้าน", async () => {
  const a = await (await worker.fetch(postJson("/api/checkout", { email: "src1@example.com", source: "FB-Post 1!" }), env)).json();
  assert.equal(orders.get(a.order_id).src, "fb-post-1", "ต้องพิมพ์เล็กและเหลือ a-z 0-9 _ - เท่านั้น");
  const b = await (await worker.fetch(postJson("/api/checkout", { email: "src2@example.com", source: "<script>alert(1)</script>" }), env)).json();
  const dirty = orders.get(b.order_id).src;
  assert.match(dirty, /^[a-z0-9_-]+$/);
  assert.ok(!dirty.includes("<"));
  const c = await (await worker.fetch(postJson("/api/checkout", { email: "src3@example.com" }), env)).json();
  assert.equal(orders.get(c.order_id).src, null, "ไม่ส่งมา → null ไม่ใช่ค่าว่าง");
  const d = await (await worker.fetch(adminReq("/admin/orders"), env)).json();
  assert.ok(d.orders.some((o) => o.src === "fb-post-1"), "รายการออเดอร์ต้องมี src");
  const ch = d.channels.find((x) => x.src === "fb-post-1");
  assert.equal(ch.orders, 1, "หลังบ้านต้องสรุปช่องทาง fb-post-1");
  assert.equal(ch.paid, 0);
});

await t("หน้า / และ /order ตรวจจับที่มาเองจริง (?src= · UTM · referrer · จำช่องทางเดิมในแท็บ)", async () => {
  const vm = await import("node:vm");
  const shopDir = decodeURIComponent(new URL(".", import.meta.url).pathname);   // เทสต์นี้อยู่ต้นไฟล์ (ก่อนประกาศ HERE) จึงหาพาธเอง
  for (const [file, btn] of [["index.html", "$('buyBtn').addEventListener"], ["order.html", "$('orderBtn').addEventListener"]]) {
    const page = fs.readFileSync(path.join(shopDir, "public", file), "utf8");
    const s = page.indexOf("const cleanSrc =");
    const e = page.indexOf(btn);
    assert.ok(s > 0 && e > s, `${file}: ต้องมีบล็อกตรวจจับที่มาก่อนปุ่มสั่งซื้อ`);
    const run = (search, { referrer = "", stored = null } = {}) => {
      const store = new Map(stored ? [["pp_src", stored]] : []);
      const sandbox = {
        location: { search, origin: "https://kopwang.com", hostname: "kopwang.com" },
        document: { referrer, querySelectorAll: () => [] },
        sessionStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) },
        URLSearchParams, URL,
      };
      vm.createContext(sandbox);
      vm.runInContext(page.slice(s, e) + "\n;globalThis.__src = orderSrc;", sandbox);
      return sandbox.__src;
    };
    assert.equal(run("?src=fbgroup-sellers"), "fbgroup-sellers");
    assert.equal(run("?utm_source=facebook&utm_campaign=pp99-c1"), "facebook-pp99-c1");
    assert.equal(run("?src=FB Post 1!"), "fb-post-1", "ต้องคลีนเป็น a-z0-9_-");
    assert.equal(run(""), "direct");
    assert.equal(run("", { referrer: "https://www.google.com/search?q=x" }), "ref-google-com");
    assert.equal(run("", { stored: "tiktok" }), "tiktok", "กลับมาใหม่ในแท็บเดิม → นับช่องทางเดิม");
    assert.match(page, /JSON\.stringify\(\{ email, source: orderSrc \}\)/, `${file}: checkout ต้องส่ง source ไปด้วย`);
  }
});

await t("หน้า /30day รับ ?src= แล้วส่งต่อไปปุ่มรับของฟรี + ปุ่มซื้อ (ไม่มี ?src= = ใช้ค่าเดิม src=30day)", async () => {
  const vm = await import("node:vm");
  const shopDir = decodeURIComponent(new URL(".", import.meta.url).pathname);
  const page = fs.readFileSync(path.join(shopDir, "public", "30day.html"), "utf8");
  const start = page.lastIndexOf("<script>");
  const end = page.indexOf("</script>", start);
  assert.ok(start > 0 && end > start, "30day.html: ต้องมีบล็อกรับ ?src= ต่อให้ปุ่มในหน้า (ไม่งั้นโพสต์ที่ชี้มาแผน 30 วันจะวัดผลไม่ได้)");
  const run = (search) => {
    const mk = (h) => ({ href: h, setAttribute(k, v) { this[k] = v; } });
    const free = ["/free?src=30day", "/free?src=30day"].map(mk);
    const buy = ["/?from=30day", "/?from=30day"].map(mk);
    const groups = { 'a[href="/free?src=30day"]': free, 'a[href="/?from=30day"]': buy };
    const sandbox = { location: { search }, document: { querySelectorAll: (sel) => groups[sel] || [] }, URLSearchParams };
    vm.createContext(sandbox);
    vm.runInContext(page.slice(start + 8, end), sandbox);
    return { free: free.map((a) => a.href), buy: buy.map((a) => a.href) };
  };
  const withSrc = run("?src=fb-post-7");
  assert.deepEqual(withSrc.free, ["/free?src=fb-post-7", "/free?src=fb-post-7"], "ปุ่มรับของฟรีต้องพา src ต่อ");
  assert.deepEqual(withSrc.buy, ["/?src=fb-post-7", "/?src=fb-post-7"], "ปุ่มซื้อต้องพา src ต่อ");
  assert.deepEqual(run("?src=FB%20Post%207!").buy, ["/?src=fb-post-7", "/?src=fb-post-7"], "ต้องคลีนค่าที่ส่งมาให้เหลือ a-z0-9_-");
  assert.deepEqual(run("").free, ["/free?src=30day", "/free?src=30day"], "ไม่มี ?src= → ต้องคงค่าเริ่มต้นเดิม");
  assert.deepEqual(run("?src=30day").buy, ["/?from=30day", "/?from=30day"], "src=30day = ค่าเดิมของหน้านี้ จึงไม่ต้องแก้ลิงก์");
});

await t("สถานะเริ่มต้น = pending และคืน QR กลับมาด้วย (กลับเข้าหน้าเดิมแล้วสแกนต่อได้)", async () => {
  const res = await worker.fetch(req(`/api/order/${checkout.order_id}`), env);
  const s = await res.json();
  assert.equal(s.status, "pending");
  assert.equal(s.qr_content, checkout.qr_content);
  assert.ok(s.qr_svg.includes("<svg "));
  assert.equal(s.payee.name, "ร้านทดสอบ");
  assert.equal(s.payee.masked_id, undefined, "สถานะออเดอร์ (หน้าเว็บลูกค้า) ก็ไม่โชว์เลข");
});

await t("อีเมลไม่ถูกต้อง → 400 · ออเดอร์ที่ไม่มี → 404", async () => {
  assert.equal((await worker.fetch(postJson("/api/checkout", { email: "not-an-email" }), env)).status, 400);
  assert.equal((await worker.fetch(req("/api/order/ord_missing"), env)).status, 404);
});

await t("ยังไม่ตั้ง PROMPTPAY_ID → checkout ตอบ 503 พร้อมข้อความชัดเจน", async () => {
  const { env: bare } = makeMockEnv({ pdfBytes: PDF_BYTES, env: { PROMPTPAY_ID: "" } });
  const r = await worker.fetch(postJson("/api/checkout", { email: "a@b.com" }), bare);
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /PROMPTPAY_ID/);
});

await t("คำขอจากโดเมนอื่น (CSRF) → 403", async () => {
  const r = await worker.fetch(req("/api/checkout", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{}" }), env);
  assert.equal(r.status, 403);
  const r2res = await worker.fetch(req(`/api/order/${checkout.order_id}/report`, { method: "POST", headers: { origin: "https://evil.example" } }), env);
  assert.equal(r2res.status, 403);
});

/* ===================== D. ลูกค้าแจ้งโอน (+สลิป) ===================== */
await t("แจ้งโอนโดยไม่แนบสลิป → reported + แจ้งเตือนร้าน (ไม่ส่งอีเมลลูกค้า)", async () => {
  const before = sentEmails.length;
  const res = await worker.fetch(postForm(`/api/order/${checkout.order_id}/report`, new FormData()), env);
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.status, "reported");
  assert.equal(d.has_slip, false);
  assert.equal(orders.get(checkout.order_id).status, "reported");
  assert.equal(sentEmails.length - before, 1);
  assert.equal(sentEmails.at(-1).to[0], "shop@example.com");
  assert.match(sentEmails.at(-1).subject, /รอตรวจสอบ/);
});

await t("แนบสลิป → เก็บไฟล์ลง R2 + บันทึกข้อมูลสลิปในออเดอร์", async () => {
  const other = await (await worker.fetch(postJson("/api/checkout", { email: "slip@example.com" }), env)).json();
  const res = await worker.fetch(postForm(`/api/order/${other.order_id}/report`, slipForm()), env);
  const d = await res.json();
  assert.equal(d.status, "reported");
  assert.equal(d.has_slip, true);
  const row = orders.get(other.order_id);
  assert.equal(row.slip_key, `slips/${other.order_id}`);
  assert.equal(row.slip_mime, "image/png");
  assert.equal(row.slip_bytes, TINY_PNG.length);
  const stored = await r2.get(`slips/${other.order_id}`);
  assert.deepEqual(new Uint8Array(stored.body), TINY_PNG, "bytes ใน R2 ต้องตรงกับไฟล์ที่อัปโหลด");
  assert.equal(stored.httpMetadata.contentType, "image/png");
});

await t("แนบไฟล์ที่ไม่ใช่รูป → 415 · ไฟล์ใหญ่เกิน 4MB → 413", async () => {
  const a = await (await worker.fetch(postJson("/api/checkout", { email: "auto@example.com" }), env)).json();
  const r1 = await worker.fetch(postForm(`/api/order/${a.order_id}/report`, slipForm(TINY_PNG, "note.txt", "text/plain")), env);
  assert.equal(r1.status, 415);
  const big = new Uint8Array(4 * 1024 * 1024 + 1);
  const r2res = await worker.fetch(postForm(`/api/order/${a.order_id}/report`, slipForm(big, "big.png", "image/png")), env);
  assert.equal(r2res.status, 413);
});

await t("แจ้งโอนออเดอร์ที่ไม่มี → 404", async () => {
  const res = await worker.fetch(postForm("/api/order/ord_nope/report", new FormData()), env);
  assert.equal(res.status, 404);
});

/* ===================== E. หลังบ้าน: ดูสลิป + อนุมัติ/ปฏิเสธ ===================== */
await t("หลังบ้านไม่มี token → 401 ทุก endpoint", async () => {
  assert.equal((await worker.fetch(req("/admin/orders"), env)).status, 401);
  assert.equal((await worker.fetch(req(`/admin/orders/${checkout.order_id}/approve`, { method: "POST" }), env)).status, 401);
  assert.equal((await worker.fetch(req(`/admin/orders/${checkout.order_id}/reject`, { method: "POST" }), env)).status, 401);
  assert.equal((await worker.fetch(req(`/admin/slip/${checkout.order_id}`), env)).status, 401);
});

await t("หลังบ้าน: ดูรายการ + สถิติ (รอตรวจสอบ/รอชำระ/รายได้)", async () => {
  const res = await worker.fetch(adminReq("/admin/orders"), env);
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.ok(d.stats.reported >= 2);
  assert.ok(d.stats.pending >= 1);
  assert.equal(d.stats.paid, 0);
  assert.equal(d.stats.revenue_satang, 0);
  assert.ok(d.orders.some((o) => o.slip_key), "ต้องเห็นว่าออเดอร์ไหนมีสลิป");
});

await t("หลังบ้าน: เปิดดูสลิปได้ (content-type + bytes ตรง) และแจ้ง 404 เมื่อยังไม่มีสลิป", async () => {
  const withSlip = [...orders.values()].find((o) => o.slip_key);
  const res = await worker.fetch(adminReq(`/admin/slip/${withSlip.id}`), env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), TINY_PNG);
  const none = [...orders.values()].find((o) => !o.slip_key && o.status !== "paid");
  assert.equal((await worker.fetch(adminReq(`/admin/slip/${none.id}`), env)).status, 404);
});

await t("อนุมัติ → paid + ส่งลิงก์ดาวน์โหลดให้ลูกค้าทันที + บันทึกวิธีตรวจ (manual)", async () => {
  const before = sentEmails.length;
  const res = await worker.fetch(adminReq(`/admin/orders/${checkout.order_id}/approve`, { method: "POST" }), env);
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.status, "paid");
  assert.equal(d.email_sent, true);
  assert.equal(orders.get(checkout.order_id).status, "paid");
  assert.equal(orders.get(checkout.order_id).verify_source, "manual");
  assert.ok(orders.get(checkout.order_id).paid_at);
  assert.equal(sentEmails.length - before, 1);
  const mail = sentEmails.at(-1);
  assert.equal(mail.to[0], "buyer@example.com");
  assert.ok(mail.html.includes("/api/download/"), "อีเมลต้องมีลิงก์ดาวน์โหลด");
  // อีเมลที่ส่งถึงลูกค้าต้องมีองค์ประกอบที่ลดการตกสแปม (ข้อความล้วน + ตอบกลับได้ + หัวเรื่องไม่ใส่อีโมจิ)
  assert.ok(mail.text && mail.text.includes("/api/download/"), "ต้องมี text/plain คู่กับ html (ลิงก์โหลดต้องอยู่ในข้อความล้วนด้วย)");
  assert.ok(mail.reply_to, "ต้องมี Reply-To ให้ผู้รับตอบกลับได้ (อีเมล no-reply ล้วนโดนกรองง่าย)");
  assert.ok(!/🎉/.test(mail.subject), "หัวเรื่องไม่ควรมีอีโมจิ");
});

await t("อนุมัติซ้ำ → idempotent (ไม่ส่งอีเมลซ้ำ)", async () => {
  const before = sentEmails.length;
  const res = await worker.fetch(adminReq(`/admin/orders/${checkout.order_id}/approve`, { method: "POST" }), env);
  const d = await res.json();
  assert.equal(res.status, 200);
  assert.equal(d.changed, false);
  assert.equal(sentEmails.length, before);
});

await t("แจ้งโอนออเดอร์ที่ชำระแล้ว → ตอบ already_paid (ไม่เปลี่ยนสถานะ)", async () => {
  const res = await worker.fetch(postForm(`/api/order/${checkout.order_id}/report`, new FormData()), env);
  const d = await res.json();
  assert.equal(res.status, 200);
  assert.equal(d.already_paid, true);
  assert.equal(orders.get(checkout.order_id).status, "paid");
});

await t("ปฏิเสธออเดอร์ (สลิปไม่ผ่าน) → failed + แจ้งโอนซ้ำไม่ได้ (409)", async () => {
  const o = await (await worker.fetch(postJson("/api/checkout", { email: "bad@example.com" }), env)).json();
  await worker.fetch(postForm(`/api/order/${o.order_id}/report`, slipForm()), env);
  const res = await worker.fetch(adminReq(`/admin/orders/${o.order_id}/reject`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ note: "ยอดไม่ตรง" }) }), env);
  assert.equal(res.status, 200);
  assert.equal(orders.get(o.order_id).status, "failed");
  assert.equal(orders.get(o.order_id).review_note, "ยอดไม่ตรง");
  assert.equal((await worker.fetch(postForm(`/api/order/${o.order_id}/report`, new FormData()), env)).status, 409);
});

await t("ปฏิเสธออเดอร์ที่ชำระแล้ว → 409 (กันกดพลาด)", async () => {
  const res = await worker.fetch(adminReq(`/admin/orders/${checkout.order_id}/reject`, { method: "POST" }), env);
  assert.equal(res.status, 409);
  assert.equal(orders.get(checkout.order_id).status, "paid");
});

await t("/admin/orders/:id/delete ต้องมี ADMIN_TOKEN (401) — ออเดอร์ต้องยังอยู่", async () => {
  const res = await worker.fetch(req(`/admin/orders/${checkout.order_id}/delete`, { method: "POST" }), env);
  assert.equal(res.status, 401);
  assert.ok(orders.get(checkout.order_id), "ออเดอร์ต้องไม่ถูกลบ");
});

await t("ลบออเดอร์ทดสอบ → หายจากหลังบ้าน + log อีเมลของออเดอร์นั้นถูกลบด้วย", async () => {
  const o = await (await worker.fetch(postJson("/api/checkout", { email: "todelete@example.com" }), env)).json();
  await worker.fetch(postForm(`/api/order/${o.order_id}/report`, slipForm()), env);
  await worker.fetch(adminReq(`/admin/orders/${o.order_id}/approve`, { method: "POST" }), env);
  assert.ok(emailLog.some((r) => r.order_id === o.order_id), "ควรมี log อีเมลก่อนลบ");

  const res = await worker.fetch(adminReq(`/admin/orders/${o.order_id}/delete`, { method: "POST" }), env);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).deleted, o.order_id);
  assert.equal(orders.get(o.order_id), undefined, "ต้องถูกลบออกจากตาราง orders");
  assert.ok(!emailLog.some((r) => r.order_id === o.order_id), "log อีเมลต้องถูกลบด้วย");
  const list = await (await worker.fetch(adminReq("/admin/orders"), env)).json();
  assert.ok(!list.orders.some((r) => r.id === o.order_id), "ต้องไม่โผล่ในหลังบ้านอีก");
});

await t("ลบออเดอร์ที่ไม่มีอยู่ → 404", async () => {
  const res = await worker.fetch(adminReq("/admin/orders/ord_notexist/delete", { method: "POST" }), env);
  assert.equal(res.status, 404);
});

/* ===================== E2. ไฟล์สินค้าในหลังบ้าน (/admin/product) ===================== */
const productPdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3]); // "%PDF-1.7"

await t("/admin/product ต้องมี ADMIN_TOKEN (401 ทั้ง GET และ POST)", async () => {
  assert.equal((await worker.fetch(req("/admin/product"), env)).status, 401);
  assert.equal((await worker.fetch(req("/admin/product", { method: "POST", body: new FormData() }), env)).status, 401);
});

await t("/admin/product (GET) รายงานตรงความจริงว่า R2 ว่าง", async () => {
  const { env: em } = makeMockEnv(); // ไม่มี pdfBytes → R2 ว่าง
  const d = await (await worker.fetch(adminReq("/admin/product"), em)).json();
  assert.equal(d.uploaded, false);
  assert.equal(d.key, "prompt-pack.pdf");
});

await t("ยังไม่อัปโหลดไฟล์ → ลูกค้าดาวน์โหลดได้ 404 พร้อมบอกสาเหตุ", async () => {
  const { env: em } = makeMockEnv();
  const c = await (await worker.fetch(postJson("/api/checkout", { email: "nofile@example.com" }), em)).json();
  await worker.fetch(postForm(`/api/order/${c.order_id}/report`, slipForm()), em);
  await worker.fetch(adminReq(`/admin/orders/${c.order_id}/approve`, { method: "POST" }), em);
  const paid = await (await worker.fetch(req(`/paid?order=${c.order_id}`), em)).json();
  const dl = await worker.fetch(req(paid.download_url), em);
  assert.equal(dl.status, 404);
  assert.match((await dl.json()).error, /R2/);
});

await t("POST /admin/product ปฏิเสธไฟล์ที่ไม่ใช่ PDF (415)", async () => {
  const { env: em } = makeMockEnv();
  const fd = new FormData();
  fd.append("file", new File([new TextEncoder().encode("hello")], "not-pdf.txt", { type: "text/plain" }));
  const res = await worker.fetch(adminReq("/admin/product", { method: "POST", body: fd }), em);
  assert.equal(res.status, 415);
  const after = await (await worker.fetch(adminReq("/admin/product"), em)).json();
  assert.equal(after.uploaded, false, "ต้องไม่เก็บไฟล์ที่ไม่ใช่ PDF");
});

await t("อัปโหลด PDF ผ่านหลังบ้าน → ลูกค้าที่จ่ายเงินโหลดได้ครบวงจร (ไบต์ตรงกัน)", async () => {
  const { env: em, r2: store } = makeMockEnv();
  const fd = new FormData();
  fd.append("file", new File([productPdf], "prompt-pack.pdf", { type: "application/pdf" }));
  const up = await worker.fetch(adminReq("/admin/product", { method: "POST", body: fd }), em);
  assert.equal(up.status, 200);
  const upj = await up.json();
  assert.equal(upj.bytes, productPdf.length);
  assert.equal(store.store.get("prompt-pack.pdf").contentType, "application/pdf");

  const status = await (await worker.fetch(adminReq("/admin/product"), em)).json();
  assert.equal(status.uploaded, true);

  const c = await (await worker.fetch(postJson("/api/checkout", { email: "pdf@example.com" }), em)).json();
  await worker.fetch(postForm(`/api/order/${c.order_id}/report`, slipForm()), em);
  const appr = await (await worker.fetch(adminReq(`/admin/orders/${c.order_id}/approve`, { method: "POST" }), em)).json();
  assert.equal(appr.status, "paid");

  const paid = await (await worker.fetch(req(`/paid?order=${c.order_id}`), em)).json();
  const dl = await worker.fetch(req(paid.download_url), em);
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get("content-type"), "application/pdf");
  assert.deepEqual([...new Uint8Array(await dl.arrayBuffer())], [...productPdf]);
});

await t("อัปโหลดใหม่ = แทนที่ไฟล์เดิม (ไม่ทิ้งไฟล์เก่าไว้)", async () => {
  const { env: em } = makeMockEnv();
  const first = new FormData();
  first.append("file", new File([productPdf], "a.pdf", { type: "application/pdf" }));
  await worker.fetch(adminReq("/admin/product", { method: "POST", body: first }), em);
  const v2 = new Uint8Array([...productPdf, 0x20, 0x20]);
  const second = new FormData();
  second.append("file", new File([v2], "b.pdf", { type: "application/pdf" }));
  const res = await worker.fetch(adminReq("/admin/product", { method: "POST", body: second }), em);
  assert.equal((await res.json()).bytes, v2.length);
  const afterUpload = await (await worker.fetch(adminReq("/admin/product"), em)).json();
  assert.equal(afterUpload.uploaded, true);
});

/* ===================== F. ดาวน์โหลด / ขอลิงก์ซ้ำ ===================== */
let downloadUrl;
await t("/paid คืน download_url + อีเมล (URL เต็ม ใช้ในอีเมลได้)", async () => {
  const res = await worker.fetch(req(`/paid?order=${checkout.order_id}`), env);
  const d = await res.json();
  assert.equal(d.status, "paid");
  downloadUrl = d.download_url;
  assert.ok(downloadUrl.startsWith(BASE + "/api/download/"));
  assert.equal(d.email, "buyer@example.com");
});

await t("ดาวน์โหลด PDF สำเร็จ (bytes ตรง + นับรอบโหลด)", async () => {
  const res = await worker.fetch(req(downloadUrl), env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/pdf");
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), PDF_BYTES);
  assert.equal(orders.get(checkout.order_id).download_count, 1);
});

await t("โหลดก่อนจ่าย → 403 · token ถูกดัดแปลง → 403 · token หมดอายุ → 403", async () => {
  const o = await (await worker.fetch(postJson("/api/checkout", { email: "auto@example.com" }), env)).json();
  assert.equal((await worker.fetch(req("/api/download/dummy.token"), env)).status, 403);
  assert.equal((await worker.fetch(req(downloadUrl.replace(/.$/, "X")), env)).status, 403);
  const payload = `${checkout.order_id}:${Math.floor(Date.now() / 1000) - 10}`;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.DOWNLOAD_SIGNING_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(payload)));
  const b64 = (b) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assert.equal((await worker.fetch(req("/api/download/" + b64(new TextEncoder().encode(payload)) + "." + b64(sig)), env)).status, 403);
});

await t("/api/retrieve → ส่งลิงก์ใหม่ · อีเมลที่ไม่มีออเดอร์ → ไม่ส่ง · เกิน 5 ครั้ง/ชม. → 429", async () => {
  const before = sentEmails.length;
  let res = await worker.fetch(postJson("/api/retrieve", { email: "buyer@example.com" }), env);
  assert.equal(res.status, 200);
  assert.equal(sentEmails.length - before, 1);
  assert.equal(emailLog.filter((e) => e.kind === "resend").length, 1);
  const before2 = sentEmails.length;
  res = await worker.fetch(postJson("/api/retrieve", { email: "nobody@example.com" }), env);
  assert.equal(res.status, 200);
  assert.equal(sentEmails.length, before2);
  for (let i = 0; i < 4; i++) await worker.fetch(postJson("/api/retrieve", { email: "buyer@example.com" }), env);
  res = await worker.fetch(postJson("/api/retrieve", { email: "buyer@example.com" }), env);
  assert.equal(res.status, 429);
});

await t("อีเมลผิดรูปแบบ → 400 · ยังไม่ตั้ง RESEND_API_KEY → 503", async () => {
  assert.equal((await worker.fetch(postJson("/api/retrieve", { email: "xxx" }), env)).status, 400);
  const { env: bare } = makeMockEnv({ pdfBytes: PDF_BYTES, env: { RESEND_API_KEY: "" } });
  assert.equal((await worker.fetch(postJson("/api/retrieve", { email: "a@b.com" }), bare)).status, 503);
});

/* ===================== G. ตรวจสลิปอัตโนมัติ (EasySlip) ===================== */
await t("ตรวจสลิปอัตโนมัติผ่าน → paid ทันที + เก็บเลขธุรกรรม + บอกวิธีตรวจ = easyslip", async () => {
  const { env: e2, orders: orders2 } = makeMockEnv({ pdfBytes: PDF_BYTES, env: { EASYSLIP_API_KEY: "esk_test" } });
  easySlipCfg = { success: true, amount: 99, receiver: "0812345678", transRef: "TX_OK_1" };
  const o = await (await worker.fetch(postJson("/api/checkout", { email: "auto@example.com" }), e2)).json();
  const before = sentEmails.length;
  const d = await (await worker.fetch(postForm(`/api/order/${o.order_id}/report`, slipForm()), e2)).json();
  assert.equal(d.auto_verified, true);
  assert.equal(d.status, "paid");
  assert.equal(d.auto_reason, null);
  const row = orders2.get(o.order_id);
  assert.equal(row.status, "paid");
  assert.equal(row.trans_ref, "TX_OK_1");
  assert.equal(row.verify_source, "easyslip");
  assert.ok(sentEmails.length > before, "ต้องส่งอีเมลให้ลูกค้า");
  const toBuyer = sentEmails.slice(before).filter((m) => (m.to || []).includes("auto@example.com"));
  assert.equal(toBuyer.length, 1, "ลูกค้าต้องได้อีเมลลิงก์โหลด 1 ฉบับ");
  assert.ok(toBuyer[0].html.includes("/api/download/"));
  const toSeller = sentEmails.slice(before).filter((m) => (m.to || []).includes("shop@example.com"));
  assert.equal(toSeller.length, 1, "ร้านต้องได้อีเมลแจ้งด้วย");
  assert.match(toSeller[0].subject, /อนุมัติอัตโนมัติ/);
});

await t("ยอดในสลิปไม่ตรง → ไม่อนุมัติอัตโนมัติ (ค้างที่ reported ให้แอดมินตรวจ)", async () => {
  const { env: e3 } = makeMockEnv({ pdfBytes: PDF_BYTES, env: { EASYSLIP_API_KEY: "esk_test" } });
  easySlipCfg = { success: true, amount: 50, receiver: "0812345678", transRef: "TX_AMT" };
  const o = await (await worker.fetch(postJson("/api/checkout", { email: "amt@example.com" }), e3)).json();
  const d = await (await worker.fetch(postForm(`/api/order/${o.order_id}/report`, slipForm()), e3)).json();
  assert.equal(d.auto_verified, false);
  assert.equal(d.status, "reported");
  assert.match(d.auto_reason, /ยอด/);
});

await t("สลิปซ้ำ (isDuplicate) → ไม่อนุมัติอัตโนมัติ", async () => {
  const { env: e4 } = makeMockEnv({ pdfBytes: PDF_BYTES, env: { EASYSLIP_API_KEY: "esk_test" } });
  easySlipCfg = { success: true, amount: 99, receiver: "0812345678", transRef: "TX_DUP", duplicate: true };
  const o = await (await worker.fetch(postJson("/api/checkout", { email: "auto@example.com" }), e4)).json();
  const d = await (await worker.fetch(postForm(`/api/order/${o.order_id}/report`, slipForm()), e4)).json();
  assert.equal(d.auto_verified, false);
  assert.equal(d.status, "reported");
});

await t("ผู้รับในสลิปไม่ใช่พร้อมเพย์ของร้าน → ไม่อนุมัติอัตโนมัติ", async () => {
  const { env: e5 } = makeMockEnv({ pdfBytes: PDF_BYTES, env: { EASYSLIP_API_KEY: "esk_test" } });
  // matchedAccount = null → ร้านยังไม่ได้ลงทะเบียนบัญชีผู้รับไว้ ระบบจึงต้องเทียบกับช่องทางรับเงินที่ตั้งเอง
  easySlipCfg = { success: true, amount: 99, receiver: "0899999999", matchedAccount: null, transRef: "TX_RCV" };
  const o = await (await worker.fetch(postJson("/api/checkout", { email: "auto@example.com" }), e5)).json();
  const d = await (await worker.fetch(postForm(`/api/order/${o.order_id}/report`, slipForm()), e5)).json();
  assert.equal(d.auto_verified, false);
  assert.match(d.auto_reason, /ผู้รับ/);
});

/* ก้อน receiver จริงจาก EasySlip v2 (คัดจากสลิปจริงของร้าน 16 ต.ค. 2026) — ธนาคารปิดเลขผู้รับไว้ */
const REAL_SLIP_RECEIVER = {
  account: { name: { th: "น.ส. พรพิไล ด", en: "PORNPILAI D" }, proxy: { type: "NATID", account: "XXXXXXXXX0201" } },
  merchantId: "",
};
const REAL_CHANNELS = "1330500240201, 0880754039";

await t("สลิปจริงจากธนาคาร: เลขผู้รับถูกปิด (XXXXXXXXX0201) → อนุมัติอัตโนมัติได้", async () => {
  const { env: ep, orders: op } = makeMockEnv({ pdfBytes: PDF_BYTES, env: { PROMPTPAY_OPTIONS: REAL_CHANNELS, EASYSLIP_API_KEY: "esk_test" } });
  // matchedAccount = null (ร้านยังไม่ได้ลงทะเบียนบัญชีรับเงินกับ EasySlip) → ต้องเทียบกับช่องทางร้านเองให้ได้
  easySlipCfg = { amount: 99, matchedAccount: null, receiverObj: REAL_SLIP_RECEIVER, transRef: "A9b47620795a543bc" };
  const o = await (await worker.fetch(postJson("/api/checkout", { email: "realslip@example.com" }), ep)).json();
  const before = sentEmails.length;
  const d = await (await worker.fetch(postForm(`/api/order/${o.order_id}/report`, slipForm()), ep)).json();
  assert.equal(d.auto_verified, true, d.auto_reason || "");
  assert.equal(d.status, "paid");
  assert.equal(op.get(o.order_id).trans_ref, "A9b47620795a543bc");
  const toBuyer = sentEmails.slice(before).filter((m) => (m.to || []).includes("realslip@example.com"));
  assert.equal(toBuyer.length, 1, "ลูกค้าต้องได้อีเมลลิงก์โหลด");
});

await t("สลิปที่ปิดเลขผู้รับ “ท้ายไม่ตรง” → ยังไม่อนุมัติ (ค้างให้แอดมินตรวจ)", async () => {
  const { env: eq } = makeMockEnv({ pdfBytes: PDF_BYTES, env: { PROMPTPAY_OPTIONS: REAL_CHANNELS, EASYSLIP_API_KEY: "esk_test" } });
  easySlipCfg = { amount: 99, matchedAccount: null, transRef: "TX_MASK_BAD", receiverObj: { account: { proxy: { type: "NATID", account: "XXXXXXXXX9999" } } } };
  const o = await (await worker.fetch(postJson("/api/checkout", { email: "maskbad@example.com" }), eq)).json();
  const d = await (await worker.fetch(postForm(`/api/order/${o.order_id}/report`, slipForm()), eq)).json();
  assert.equal(d.auto_verified, false);
  assert.equal(d.status, "reported");
  assert.match(d.auto_reason, /ผู้รับ/);
});

await t("สลิปที่ปิดเลขผู้รับ “ท้ายตรงแต่คนละประเภท” (MSISDN กับบัตร ปชช.) → ไม่อนุมัติ", async () => {
  const { env: er } = makeMockEnv({ pdfBytes: PDF_BYTES, env: { PROMPTPAY_OPTIONS: REAL_CHANNELS, EASYSLIP_API_KEY: "esk_test" } });
  easySlipCfg = { amount: 99, matchedAccount: null, transRef: "TX_MASK_TYPE", receiverObj: { account: { proxy: { type: "MSISDN", account: "XXXXXXXXX0201" } } } };
  const o = await (await worker.fetch(postJson("/api/checkout", { email: "masktype@example.com" }), er)).json();
  const d = await (await worker.fetch(postForm(`/api/order/${o.order_id}/report`, slipForm()), er)).json();
  assert.equal(d.auto_verified, false);
  assert.match(d.auto_reason, /ผู้รับ/);
});

await t("slipReceiverMatches: เทียบเลขผู้รับแบบปิดได้ทุกรูปแบบ (พร้อมเพย์บัตร ปชช./เบอร์/เลขบัญชี)", () => {
  const opts = parsePromptPayOptions(`${REAL_CHANNELS}, 0452944429@004`);
  const hit = (receiver) => slipReceiverMatches(receiver, opts);
  assert.equal(hit({ account: { proxy: { type: "NATID", account: "XXXXXXXXX0201" } } }), true, "พร้อมเพย์เลขบัตร ปชช. (ปิดหัว)");
  assert.equal(hit({ proxy: { type: "MSISDN", account: "XXXXXXX4039" } }), true, "พร้อมเพย์เบอร์มือถือ (ปิดหัว)");
  assert.equal(hit({ account: { bank: { type: "BANKAC", account: "xxx-x-x4442-x" } } }), true, "เลขบัญชีธนาคาร (ปิดกลาง)");
  assert.equal(hit({ account: { proxy: { type: "NATID", account: "1330500240201" } } }), true, "เลขเต็มโชว์ในสลิป");
  assert.equal(hit({ account: { proxy: { type: "NATID", account: "XXXXXXXXX9999" } } }), false, "ท้ายไม่ตรง");
  assert.equal(hit({ account: { proxy: { type: "MSISDN", account: "XXXXXXXXX0201" } } }), false, "คนละประเภท (ใช้ท้ายร่วมกันไม่ได้)");
  assert.equal(hit({ account: { bank: { type: "BANKAC", account: "xxx-x-x5555-x" } } }), false, "บัญชีอื่น");
  assert.equal(hit({}), false, "สลิปไม่บอกผู้รับ");
  assert.equal(hit({ account: { name: { th: "นายอื่น" } } }), false, "มีแต่ชื่อ ไม่มีเลข");
});

await t("ใช้สลิปเดิมกับออเดอร์ที่สอง → ถูกกันไว้ (transRef ซ้ำ)", async () => {
  const { env: e6, orders: orders6 } = makeMockEnv({ pdfBytes: PDF_BYTES, env: { EASYSLIP_API_KEY: "esk_test" } });
  easySlipCfg = { success: true, amount: 99, receiver: "0812345678", transRef: "TX_REUSE" };
  const o1 = await (await worker.fetch(postJson("/api/checkout", { email: "auto@example.com" }), e6)).json();
  const o2 = await (await worker.fetch(postJson("/api/checkout", { email: "auto@example.com" }), e6)).json();
  assert.equal((await (await worker.fetch(postForm(`/api/order/${o1.order_id}/report`, slipForm()), e6)).json()).status, "paid");
  const d2 = await (await worker.fetch(postForm(`/api/order/${o2.order_id}/report`, slipForm()), e6)).json();
  assert.equal(d2.auto_verified, false);
  assert.equal(d2.status, "reported");
  assert.match(d2.auto_reason, /ซ้ำ|ใช้กับออเดอร์อื่น/);
  assert.equal(orders6.get(o2.order_id).status, "reported");
});

await t("ไม่ได้ตั้งคีย์ตรวจสลิป → ระบบยังทำงานแบบตรวจเอง (reported) + ไม่เก็บ note รกตาราง", async () => {
  const { env: e7, orders: o7 } = makeMockEnv({ pdfBytes: PDF_BYTES });
  easySlipCfg = { success: true, amount: 99, receiver: "0812345678" };
  resetSlipCalls();
  const o = await (await worker.fetch(postJson("/api/checkout", { email: "auto@example.com" }), e7)).json();
  const d = await (await worker.fetch(postForm(`/api/order/${o.order_id}/report`, slipForm()), e7)).json();
  assert.equal(d.auto_verified, false);
  assert.equal(d.status, "reported");
  assert.match(d.auto_reason, /คีย์ตรวจสลิป/);
  assert.equal(slipCalls.length, 0, "ไม่มีคีย์ → ต้องไม่ยิง API");
  assert.equal(o7.get(o.order_id).verify_note, undefined, "โหมด manual ไม่ต้องเก็บ note ที่ตัวออเดอร์");
});

/* ===================== G2. โหมดวางข้อความ QR + ความทนของระบบอัตโนมัติ ===================== */
await t("วางข้อความ QR จากสลิป (ไม่แนบรูป) → ตรวจและอนุมัติอัตโนมัติได้", async () => {
  const { env: e8 } = makeMockEnv({ pdfBytes: PDF_BYTES, env: { EASYSLIP_API_KEY: "esk_test" } });
  easySlipCfg = { amount: 99, receiver: "0812345678", transRef: "TX_QR_1" };
  resetSlipCalls();
  const o = await (await worker.fetch(postJson("/api/checkout", { email: "qr@example.com" }), e8)).json();
  const fd = new FormData();
  fd.append("qr_payload", " 00020101021229370016A00000067701011101130066812345678 5802TH6304ABCD ");
  const d = await (await worker.fetch(postForm(`/api/order/${o.order_id}/report`, fd), e8)).json();
  assert.equal(d.auto_verified, true, d.auto_reason || "");
  assert.equal(d.auto_mode, "qr");
  assert.equal(d.status, "paid");
  assert.equal(d.has_qr, true);
  assert.equal(slipCalls.length, 1);
  const call = slipCalls[0];
  assert.equal(call.mode, "qr");
  assert.equal(call.url, "https://api.easyslip.com/v2/verify/bank");
  assert.equal(call.headers.authorization, "Bearer esk_test");
  const sent = JSON.parse(call.body);
  assert.equal(sent.matchAmount, 99, "matchAmount ต้องเป็นตัวเลข (สเปก v2)");
  assert.equal(sent.checkDuplicate, true);
  assert.equal(sent.matchAccount, true);
  assert.ok(!/\s/.test(sent.payload), "ต้องตัดช่องว่าง/บรรทัดใหม่ออกจากข้อความ QR ก่อนส่ง");
});

await t("แนบรูป: ส่งฟิลด์ชื่อ image (สเปก v2) + matchAmount/matchAccount ครบ", async () => {
  const { env: e9 } = makeMockEnv({ pdfBytes: PDF_BYTES, env: { EASYSLIP_API_KEY: "esk_test" } });
  easySlipCfg = { amount: 99, receiver: "0812345678", transRef: "TX_IMG_1" };
  resetSlipCalls();
  const o = await (await worker.fetch(postJson("/api/checkout", { email: "img@example.com" }), e9)).json();
  const d = await (await worker.fetch(postForm(`/api/order/${o.order_id}/report`, slipForm()), e9)).json();
  assert.equal(d.auto_verified, true, d.auto_reason || "");
  assert.equal(d.auto_mode, "image");
  const body = slipCalls.at(-1).body;
  assert.ok(body instanceof FormData, "โหมดรูปต้องส่ง multipart/form-data");
  assert.ok(body.get("image"), "v2 ใช้ชื่อฟิลด์ image");
  assert.equal(body.get("file"), null, "ห้ามใช้ชื่อฟิลด์เก่า file");
  assert.equal(body.get("matchAmount"), "99");
  assert.equal(body.get("matchAccount"), "true");
  assert.equal(body.get("checkDuplicate"), "true");
});

await t("โควตาตรวจสลิปหมด (403 QUOTA_EXCEEDED) → ไม่อนุมัติ + แจ้งร้านพร้อมเหตุผล", async () => {
  const { env: e10 } = makeMockEnv({ pdfBytes: PDF_BYTES, env: { EASYSLIP_API_KEY: "esk_test" } });
  easySlipCfg = { status: 403, code: "QUOTA_EXCEEDED", message: "quota exceeded" };
  const o = await (await worker.fetch(postJson("/api/checkout", { email: "quota@example.com" }), e10)).json();
  const before = sentEmails.length;
  const d = await (await worker.fetch(postForm(`/api/order/${o.order_id}/report`, slipForm()), e10)).json();
  assert.equal(d.auto_verified, false);
  assert.equal(d.status, "reported");
  assert.match(d.auto_reason, /โควตา/);
  const mail = sentEmails.at(-1);
  assert.ok(sentEmails.length > before);
  assert.match(mail.html, /โควตา/, "อีเมลแจ้งร้านต้องบอกเหตุผลที่ระบบยืนยันไม่ได้");
});

await t("ผู้ให้บริการตอบ 429 → ลองซ้ำให้เอง 1 ครั้ง แล้วค้างให้แอดมินตรวจ", async () => {
  const { env: e11 } = makeMockEnv({ pdfBytes: PDF_BYTES, env: { EASYSLIP_API_KEY: "esk_test" } });
  easySlipCfg = { status: 429, code: "RATE_LIMIT_EXCEEDED" };
  resetSlipCalls();
  const o = await (await worker.fetch(postJson("/api/checkout", { email: "busy@example.com" }), e11)).json();
  const d = await (await worker.fetch(postForm(`/api/order/${o.order_id}/report`, slipForm()), e11)).json();
  assert.equal(d.auto_verified, false);
  assert.equal(d.status, "reported");
  assert.equal(slipCalls.length, 2, "ต้องลองซ้ำอีก 1 ครั้งก่อนยอมแพ้");
  assert.match(d.auto_reason, /ไม่ว่าง|ตอบช้า/);
});

await t("คีย์ตรวจสลิปผิด (401 INVALID_API_KEY) → ไม่อนุมัติ + เหตุผลบอกเรื่องคีย์", async () => {
  const { env: e12 } = makeMockEnv({ pdfBytes: PDF_BYTES, env: { EASYSLIP_API_KEY: "esk_wrong" } });
  easySlipCfg = { status: 401, code: "INVALID_API_KEY", message: "invalid key" };
  const o = await (await worker.fetch(postJson("/api/checkout", { email: "bkey@example.com" }), e12)).json();
  const d = await (await worker.fetch(postForm(`/api/order/${o.order_id}/report`, slipForm()), e12)).json();
  assert.equal(d.auto_verified, false);
  assert.match(d.auto_reason, /คีย์/);
});

await t("ลองอัตโนมัติครบโควตาที่ตั้งไว้ → หยุดยิง API (กันโควตาหมด) + หลังบ้านเห็นเหตุผล", async () => {
  const { env: e13 } = makeMockEnv({ pdfBytes: PDF_BYTES, env: { EASYSLIP_API_KEY: "esk_test", AUTO_VERIFY_MAX_ATTEMPTS: "2" } });
  easySlipCfg = { amount: 50, receiver: "0812345678", transRef: "TX_TRY" };
  resetSlipCalls();
  const o = await (await worker.fetch(postJson("/api/checkout", { email: "tries@example.com" }), e13)).json();
  for (let i = 0; i < 2; i++) await worker.fetch(postForm(`/api/order/${o.order_id}/report`, slipForm()), e13);
  assert.equal(slipCalls.length, 2);
  const d = await (await worker.fetch(postForm(`/api/order/${o.order_id}/report`, slipForm()), e13)).json();
  assert.equal(d.auto_verified, false);
  assert.equal(d.status, "reported");
  assert.equal(slipCalls.length, 2, "ครั้งที่เกินโควตาต้องไม่ยิง API อีก");
  assert.match(d.auto_reason, /ครบ 2 ครั้ง/);
  assert.equal(d.verify_attempts, 2);

  const rows = await (await worker.fetch(adminReq("/admin/orders"), e13)).json();
  const row = rows.orders.find((x) => x.id === o.order_id);
  assert.match(row.verify_note, /ยอด/, "หลังบ้านต้องเห็นเหตุผลที่ระบบยังยืนยันไม่ได้");
  assert.equal(row.verify_attempts, 2);
  assert.equal(row.verify_mode, "image");
});

await t("AUTO_APPROVE=0 → ไม่ยิง API เลย ปล่อยให้แอดมินกดอนุมัติเอง", async () => {
  const { env: e14 } = makeMockEnv({ pdfBytes: PDF_BYTES, env: { EASYSLIP_API_KEY: "esk_test", AUTO_APPROVE: "0" } });
  easySlipCfg = { amount: 99, receiver: "0812345678", transRef: "TX_OFF" };
  resetSlipCalls();
  const o = await (await worker.fetch(postJson("/api/checkout", { email: "off@example.com" }), e14)).json();
  const d = await (await worker.fetch(postForm(`/api/order/${o.order_id}/report`, slipForm()), e14)).json();
  assert.equal(d.status, "reported");
  assert.equal(d.auto_verified, false);
  assert.equal(slipCalls.length, 0, "ปิด auto → ต้องไม่ยิง API เลย");
  assert.match(d.auto_reason, /AUTO_APPROVE/);
  const ap = await (await worker.fetch(adminReq(`/admin/orders/${o.order_id}/approve`, { method: "POST" }), e14)).json();
  assert.equal(ap.status, "paid");
  assert.equal(ap.email_sent, true, "อนุมัติเองแล้วต้องส่งลิงก์เข้าเมลลูกค้า");
});

await t("checkout ต้องมีอีเมล (เก็บเมลอัตโนมัติ) → ไม่ส่ง = 400 · REQUIRE_EMAIL=0 ผ่อนได้", async () => {
  const res = await worker.fetch(postJson("/api/checkout", {}), env);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /อีเมล/);
  assert.equal((await worker.fetch(postJson("/api/checkout", { email: "bad" }), env)).status, 400);
  const { env: noReq } = makeMockEnv({ pdfBytes: PDF_BYTES, env: { REQUIRE_EMAIL: "0" } });
  assert.equal((await worker.fetch(postJson("/api/checkout", {}), noReq)).status, 200);
});

/* ===================== H. health ===================== */
await t("/api/health บอกโหมดพร้อมเพย์ + เลขบัญชีแบบปิดบางส่วน โดยไม่รั่วค่าความลับ", async () => {
  const res = await worker.fetch(req("/api/health"), env);
  const h = await res.json();
  assert.equal(res.status, 200);
  assert.equal(h.payment.provider, "promptpay");
  assert.equal(h.payment.promptpay_configured, true);
  assert.equal(h.payment.promptpay_id_masked, "081-xxx-5678");
  assert.equal(h.payment_configured, true);
  assert.equal(h.storage.d1 && h.storage.r2, true);
  assert.equal(h.price_satang, 9900);
  const dump = JSON.stringify(h);
  assert.ok(!dump.includes("0812345678"), "ห้ามโชว์เลขพร้อมเพย์เต็ม");
  assert.ok(!dump.includes("re_test_123") && !dump.includes("admin-secret"));
});

/* ===================== I. โหมด Omise (ยังใช้ได้ ถ้าอนาคตอยากใช้ Gateway) ===================== */
await t("PAYMENT_PROVIDER=omise → checkout ผ่าน Omise + return_uri เป็น URL เต็มของหน้า thank-you", async () => {
  const { env: eo, orders: ordersO } = makeMockEnv({ pdfBytes: PDF_BYTES, env: { PAYMENT_PROVIDER: "omise", APP_ORIGIN: "" } });
  const res = await worker.fetch(postJson("/api/checkout", { email: "omise@example.com" }), eo);
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.provider, "omise");
  const charge = charges.get(d.charge_id);
  assert.ok(charge, "ต้องสร้าง charge ที่ Omise");
  assert.ok(charge.return_uri.startsWith(BASE + "/thank-you"), "return_uri ต้องเป็น URL เต็ม (fallback ใช้ origin ของคำขอ)");
  assert.ok(charge.return_uri.includes("order=" + d.order_id));
  assert.equal(ordersO.get(d.order_id).provider, "omise");
});

await t("webhook Omise: ลายเซ็นผิด → 401 · ถูกต้อง → paid + ส่งอีเมล · ซ้ำ → ไม่ส่งซ้ำ", async () => {
  const { env: eo, orders: ordersO2 } = makeMockEnv({ pdfBytes: PDF_BYTES, env: { PAYMENT_PROVIDER: "omise" } });
  const o = await (await worker.fetch(postJson("/api/checkout", { email: "omise2@example.com" }), eo)).json();
  const charge = charges.get(o.charge_id);
  const body = JSON.stringify({ object: "event", key: "charge.complete", data: { id: charge.id } });
  const ts = String(Math.floor(Date.now() / 1000));
  assert.equal((await worker.fetch(req("/api/webhook/omise", { method: "POST", headers: { "Omise-Signature": "deadbeef", "Omise-Signature-Timestamp": ts }, body }), eo)).status, 401);

  charge.paid = true;
  const sig = await omiseSignature(eo.OMISE_WEBHOOK_SECRET, ts, body);
  const before = sentEmails.length;
  const call = () => worker.fetch(req("/api/webhook/omise", { method: "POST", headers: { "Omise-Signature": sig, "Omise-Signature-Timestamp": ts }, body }), eo);
  assert.equal((await call()).status, 200);
  assert.equal(ordersO2.get(o.order_id).status, "paid");
  assert.equal(sentEmails.length - before, 1);
  assert.equal((await call()).status, 200);
  assert.equal(sentEmails.length - before, 1, "webhook ซ้ำต้องไม่ส่งอีเมลซ้ำ");
});

/* ===================== J. พร้อมเพย์ด้วยเลขบัญชีธนาคาร (PROMPTPAY_BANK) ===================== */
// โครง payload อ้างอิงจากตัวอย่างในเอกสาร Thai QR Payment:
//   bankAccount('014', '1234567890').amount(100) → 29 "00 16 A000000677010111" + "04 13 0141234567890"
await t("payload บัญชีธนาคารตรงกับตัวอย่างในเอกสาร Thai QR (ธนาคาร 014 + บัญชี 1234567890 + ฿100) ทุกตัวอักษร", () => {
  const payload = buildPromptPayPayload({ id: "1234567890", bank: "014", amountSatang: 10000 });
  assert.equal(payload, "00020101021229370016A0000006770101110413014123456789053037645406100.005802TH6304901D");
  const info = inspectPayload(payload);
  assert.ok(info.crcValid && payloadCrcOk(payload));
  assert.equal(info.aid, "A000000677010111");
  assert.equal(info.proxyType, "bank-account");
  assert.equal(info.merchantSub["04"], "0141234567890");
  assert.equal(info.bank, "014");
  assert.equal(info.account, "1234567890");
  assert.equal(info.amount, "100.00");
});

await t("normalize เลขบัญชี: ตัดขีดออก · ต้องมีรหัสธนาคาร 3 หลัก · ไม่ใส่รหัสธนาคารจะถูกตีความเป็นเบอร์โทร", () => {
  assert.deepEqual(normalizePromptPayId("012-3-45678-9", "004"), { tag: "04", value: "0040123456789", type: "bank-account", bank: "004", account: "0123456789" });
  assert.deepEqual(normalizePromptPayId("0452944429", "004"), { tag: "04", value: "0040452944429", type: "bank-account", bank: "004", account: "0452944429" });
  assert.equal(normalizePromptPayId("0123456789", "04"), null, "รหัสธนาคารต้อง 3 หลัก");
  assert.equal(normalizePromptPayId("12345", "004"), null, "เลขบัญชีสั้นเกินไป");
  // ⚠️ เลขบัญชี 10 หลักที่ขึ้นต้นด้วย 0 ถ้าไม่ตั้ง PROMPTPAY_BANK จะถูกอ่านเป็นเบอร์มือถือ → QR ผิดบัญชี
  assert.deepEqual(normalizePromptPayId("0123456789"), { tag: "01", value: "0066123456789", type: "mobile" });
  assert.equal(maskPromptPayId("0452944429", "004"), "xxx-x-x4442-x");
});

await t("checkout โหมดบัญชีธนาคาร → QR ฝังแท็ก 29/04 + หน้าโอนโชว์แค่ชื่อบัญชี (+ /api/health ยังบอกชนิด/เลขปิดบางส่วนให้ร้านตรวจเอง)", async () => {
  const { env: eb } = makeMockEnv({ pdfBytes: PDF_BYTES, env: { PROMPTPAY_BANK: "004", PROMPTPAY_ID: "045-2-94442-9", PROMPTPAY_NAME: "น.ส. พรพิไล ดวงใจ" } });
  const res = await worker.fetch(postJson("/api/checkout", { email: "bank@example.com" }), eb);
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.payee.name, "น.ส. พรพิไล ดวงใจ");
  assert.equal(d.payee.masked_id, undefined, "หน้าโอนต้องไม่โชว์เลขบัญชี (แม้ปิดบางส่วน)");
  assert.ok(!/4442/.test(JSON.stringify({ payee: d.payee, pay_options: d.pay_options.map(({ qr_content, qr_svg, ...rest }) => rest) })), "ข้อมูลหน้าโอนต้องไม่มีเศษเลขบัญชี");
  assert.equal(d.amount_satang, 9900);
  const info = inspectPayload(d.qr_content);
  assert.equal(info.proxyType, "bank-account");
  assert.equal(info.merchantSub["04"], "0040452944429");
  assert.equal(info.amount, "99.00");
  assert.ok(payloadCrcOk(d.qr_content));

  const h = await (await worker.fetch(req("/api/health"), eb)).json();
  assert.equal(h.payment.promptpay_proxy_type, "bank-account");
  assert.equal(h.payment.promptpay_bank_code, "004");
  assert.equal(h.payment.promptpay_id_masked, "xxx-x-x4442-x");
  assert.ok(!JSON.stringify(h).includes("0452944429"), "ห้ามโชว์เลขบัญชีเต็ม");
});

await t("โหมดบัญชีธนาคาร: ตั้งค่าไม่ครบ (รหัสธนาคารผิด) → checkout ตอบ 503 พร้อมบอกวิธีแก้", async () => {
  const { env: eb } = makeMockEnv({ pdfBytes: PDF_BYTES, env: { PROMPTPAY_BANK: "04", PROMPTPAY_ID: "0452944429" } });
  const res = await worker.fetch(postJson("/api/checkout", { email: "auto@example.com" }), eb);
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /PROMPTPAY_BANK/);
});

await t("ตรวจสลิปอัตโนมัติเทียบกับเลขบัญชีธนาคารได้ (ผู้รับในสลิป = 0040452944429)", async () => {
  const { env: eb } = makeMockEnv({ pdfBytes: PDF_BYTES, env: { PROMPTPAY_BANK: "004", PROMPTPAY_ID: "0452944429", EASYSLIP_API_KEY: "esk_test" } });
  easySlipCfg = { success: true, amount: 99, receiver: "0040452944429", transRef: "TX_BANK_1" };
  const o = await (await worker.fetch(postJson("/api/checkout", { email: "auto@example.com" }), eb)).json();
  const d = await (await worker.fetch(postForm(`/api/order/${o.order_id}/report`, slipForm()), eb)).json();
  assert.equal(d.auto_verified, true);
  assert.equal(d.status, "paid");

  // ผู้รับเป็นบัญชีอื่น → ไม่ผ่าน (ต้องรอแอดมิน)
  easySlipCfg = { success: true, amount: 99, receiver: "0029999999999", matchedAccount: null, transRef: "TX_BANK_2" };
  const o2 = await (await worker.fetch(postJson("/api/checkout", { email: "auto@example.com" }), eb)).json();
  const d2 = await (await worker.fetch(postForm(`/api/order/${o2.order_id}/report`, slipForm()), eb)).json();
  assert.equal(d2.auto_verified, false);
  assert.match(d2.auto_reason, /ผู้รับ/);
});

/* ===================== G. หลายช่องทางรับเงิน (ลูกค้าเลือกจ่ายได้) ===================== */
const TWO = "0452944429@004, 0880754039";   // เลขบัญชีตัวอย่าง (ไม่ใช่บัญชีร้าน) — ของร้านใช้ช่องเลขบัตรประชาชน/เบอร์

await t("parsePromptPayOptions: แยกสองช่องทาง + ป้ายชื่อไทย + key ไม่โชว์เลขจริง", () => {
  const opts = parsePromptPayOptions(TWO);
  assert.equal(opts.length, 2);
  assert.deepEqual(opts.map((o) => o.type), ["bank-account", "mobile"]);
  assert.deepEqual(opts.map((o) => o.masked), ["xxx-x-x4442-x", "088-xxx-4039"]);
  assert.equal(opts[0].bank, "004");
  assert.equal(opts[0].id, "0452944429");
  assert.equal(opts[0].value, "0040452944429");
  assert.equal(opts[1].value, "0066880754039");
  // นโยบายร้าน: ป้ายที่ลูกค้าเห็น = ชื่อบัญชีเท่านั้น (ไม่บอกชนิดพร้อมเพย์ · ไม่มีตัวเลข)
  assert.deepEqual(opts.map((o) => o.label), ["บัญชีรับเงินของร้าน", "บัญชีรับเงินของร้าน"]);
  assert.ok(opts.every((o) => !/\d/.test(o.label)), "ป้ายที่โชว์ต้องไม่มีตัวเลขเลย");
  // ตั้ง PROMPTPAY_NAME → ใช้ชื่อบัญชีเป็นป้ายของทุกช่องทาง
  assert.deepEqual(parsePromptPayOptions(TWO, "", "น.ส. พรพิไล ดวงใจ").map((o) => o.label), ["น.ส. พรพิไล ดวงใจ", "น.ส. พรพิไล ดวงใจ"]);
  assert.equal(promptPayOptionLabel(null), "");
  // key เป็น hash สั้น → อ้างช่องทางได้โดยไม่โชว์/ย้อนกลับเป็นเลขบัญชี-เบอร์ได้
  assert.ok(opts.every((o) => !o.key.includes("0452944429") && !o.key.includes("0880754039")), "key ต้องไม่มีเลขจริงอยู่ในตัว");
  // ช่องพร้อมเพย์ “เลขบัตรประชาชน 13 หลัก” (รูปแบบที่ร้านใช้อยู่จริง) → tag 29 sub-tag 02 + ซ่อนเลขกลาง
  const idOpts = parsePromptPayOptions("1330500240201, 0880754039");
  assert.equal(idOpts.length, 2);
  assert.equal(idOpts[0].type, "national-id");
  assert.equal(idOpts[0].tag, "02");
  assert.equal(idOpts[0].masked, "xxx-xxx-0201");
  assert.equal(idOpts[0].label, "บัญชีรับเงินของร้าน", "ห้ามบอกว่าเป็นพร้อมเพย์เลขบัตรประชาชน และห้ามโชว์เลขบัตร");
  assert.equal(inspectPayload(buildPromptPayPayload({ id: idOpts[0].id, amountSatang: 9900 })).merchantSub["02"], "1330500240201");
  assert.equal(new Set(opts.map((o) => o.key)).size, 2, "key ของแต่ละช่องทางต้องไม่ซ้ำ");
  assert.equal(bankName("004"), "ธ.กสิกรไทย (KBank)");
  // กันซ้ำ + ข้ามรายการผิดรูปแบบ · มี/ไม่มี @bank ต่อรายการ
  assert.equal(parsePromptPayOptions(`${TWO}, 0452944429@004, 12345`).length, 2);
  assert.equal(parsePromptPayOptions("0452944429", "004")[0].type, "bank-account");
  assert.equal(parsePromptPayOptions("0452944429")[0].type, "mobile");
  assert.deepEqual(parsePromptPayOptions(""), []);
});

await t("ป้ายชื่อช่องทาง (PROMPTPAY_LABELS): แยกช่องทางได้โดยไม่บอกชนิด/เลข + ไม่หลุดตำแหน่ง", () => {
  const labelFor = (raw, labels) => parsePromptPayOptions(raw, "", "น.ส. พรพิไล ดวงใจ", labels).map((o) => o.label);
  assert.deepEqual(labelFor(TWO, "ช่องทางหลัก|ช่องทางสำรอง"), ["ช่องทางหลัก", "ช่องทางสำรอง"]);
  assert.deepEqual(labelFor(TWO, ["ก", "ข"]), ["ก", "ข"], "รับ array ได้ด้วย");
  // เว้นว่าง = ใช้ชื่อบัญชี · ป้ายต้องไม่มีตัวเลข (นโยบายร้าน)
  assert.deepEqual(labelFor(TWO, "|ช่องทางสำรอง"), ["น.ส. พรพิไล ดวงใจ", "ช่องทางสำรอง"]);
  assert.deepEqual(labelFor(TWO, ""), ["น.ส. พรพิไล ดวงใจ", "น.ส. พรพิไล ดวงใจ"]);
  // รายการแรกพิมพ์ผิด → ป้ายยังอยู่กับช่องที่ถูกต้อง (12345 ไม่ผ่าน → ช่องที่เหลือใช้ป้ายตัวที่ 2)
  assert.deepEqual(labelFor("12345, 0880754039", "ก|ข"), ["ข"]);
  assert.ok(labelFor(TWO, "ช่องทางหลัก|ช่องทางสำรอง").every((l) => !/\d/.test(l)));
  assert.deepEqual(labelFor(TWO), ["น.ส. พรพิไล ดวงใจ", "น.ส. พรพิไล ดวงใจ"], "ไม่ตั้งป้าย = พฤติกรรมเดิม");
});

await t("รหัสธนาคาร: 011 = ttb (ใช้กับบัญชี ttb) · 067 = ทิสโก้ ไม่ใช่ ttb", () => {
  assert.equal(bankName("011"), "ธ.ทีเอ็มบีธนชาต (ttb)");
  assert.match(bankName("065"), /ttb/);
  assert.match(bankName("067"), /ทิสโก้/);
  assert.ok(!/ttb/.test(bankName("067")), "067 ต้องไม่ถูกเรียกเป็น ttb (ตรวจกับธนาคารจริง 16 ต.ค. 2026)");
});

await t("checkout หลายช่องทาง: คืน QR ของทุกช่องทาง + เลือกตาม target + health ไม่รั่วเลขเต็ม", async () => {
  const { env: em } = makeMockEnv({ pdfBytes: PDF_BYTES, env: { PROMPTPAY_OPTIONS: TWO, PROMPTPAY_NAME: "ร้านสองช่องทาง" } });
  const res = await worker.fetch(postJson("/api/checkout", { email: "two@example.com" }), em);
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.pay_options.length, 2);
  assert.equal(d.pay_target, d.pay_options[0].key, "ค่าเริ่มต้น = ช่องทางแรก");
  assert.equal(inspectPayload(d.qr_content).proxyType, "bank-account");
  for (const o of d.pay_options) {
    const info = inspectPayload(o.qr_content);
    assert.equal(info.proxyType, o.proxy_type);
    assert.ok(payloadCrcOk(o.qr_content));
    assert.equal(o.qr_svg, qrSvg(o.qr_content, { scale: 8, margin: 4, alt: "PromptPay QR" }), "QR ต้องตรงกับ payload ของช่องทางนั้น");
    assert.equal(o.payee, "ร้านสองช่องทาง");
  }
  // เลือกช่องทางที่ 2 (เบอร์พร้อมเพย์)
  const mobileKey = d.pay_options[1].key;
  const d2 = await (await worker.fetch(postJson("/api/checkout", { email: "two@example.com", target: mobileKey }), em)).json();
  assert.equal(d2.pay_target, mobileKey);
  assert.equal(inspectPayload(d2.qr_content).merchantSub["01"], "0066880754039");
  assert.equal(d2.payee.name, "ร้านสองช่องทาง");
  assert.equal(d2.payee.masked_id, undefined, "หน้าโอนไม่โชว์เลขของช่องทางที่เลือก");
  assert.equal(d2.pay_target_label, "ร้านสองช่องทาง", "ป้ายเป้าหมาย = ชื่อบัญชี ไม่ใช่เลข");
  assert.ok(d2.pay_options.every((o) => o.label === "ร้านสองช่องทาง" && o.masked_id === undefined && !/\d/.test(o.label)), "ทุกช่องทางในหน้าโอนต้องมีแค่ชื่อบัญชี");
  // target ที่ไม่รู้จัก → ไม่พัง ถอยไปช่องทางแรก
  const d3 = await (await worker.fetch(postJson("/api/checkout", { email: "auto@example.com" }), em)).json();
  assert.equal(d3.pay_target, d.pay_options[0].key);
  // สถานะออเดอร์ส่งรายการช่องทางกลับไปให้หน้าเว็บ (สลับ QR ได้โดยไม่สร้างออเดอร์ใหม่)
  const st = await (await worker.fetch(req("/api/order/" + d3.order_id), em)).json();
  assert.equal(st.pay_options.length, 2);
  assert.equal(st.pay_target, d3.pay_target);
  assert.equal(st.qr_content, d3.qr_content);
  // /api/health: บอกทั้งสองช่องทาง แต่ไม่โชว์เลขเต็ม
  const h = await (await worker.fetch(req("/api/health"), em)).json();
  assert.equal(h.payment.promptpay_configured, true);
  assert.equal(h.payment.promptpay_options.length, 2);
  assert.equal(h.payment.promptpay_options[1].masked_id, "088-xxx-4039");
  assert.ok(!JSON.stringify(h).includes("0452944429"), "health ต้องไม่โชว์เลขบัญชีเต็ม");
  assert.ok(!JSON.stringify(h).includes("0880754039"), "health ต้องไม่โชว์เบอร์เต็ม");
});

await t("checkout หลายช่องทาง + PROMPTPAY_LABELS: ปุ่มใช้ป้ายที่ตั้งไว้ · หน้าโอนยังโชว์แค่ชื่อบัญชี", async () => {
  const { env: em } = makeMockEnv({
    pdfBytes: PDF_BYTES,
    env: { PROMPTPAY_OPTIONS: `0880754039, ${TWO.split(", ")[0]}`, PROMPTPAY_NAME: "น.ส. พรพิไล ดวงใจ", PROMPTPAY_LABELS: "ช่องทางหลัก|ช่องทางสำรอง" },
  });
  const d = await (await worker.fetch(postJson("/api/checkout", { email: "label@example.com" }), em)).json();
  assert.equal(d.pay_options.length, 2);
  assert.deepEqual(d.pay_options.map((o) => o.label), ["ช่องทางหลัก", "ช่องทางสำรอง"]);
  assert.deepEqual(d.pay_options.map((o) => o.proxy_type), ["mobile", "bank-account"], "ช่องแรก = เบอร์พร้อมเพย์ที่โอนได้จริง");
  assert.ok(d.pay_options.every((o) => !/\d/.test(o.label) && o.masked_id === undefined), "ป้าย/ข้อมูลหน้าโอนต้องไม่มีเลข");
  assert.equal(d.payee.name, "น.ส. พรพิไล ดวงใจ", "ชื่อบัญชีที่โชว์ = PROMPTPAY_NAME");
  assert.equal(inspectPayload(d.qr_content).merchantSub["01"], "0066880754039", "QR ค่าเริ่มต้น = ช่องแรกที่ตั้งไว้");
  // เลือกช่องสำรอง (บัญชีธนาคาร) → QR เปลี่ยน แต่ชื่อที่โชว์ยังเป็นชื่อบัญชี
  const d2 = await (await worker.fetch(postJson("/api/checkout", { email: "label@example.com", target: d.pay_options[1].key }), em)).json();
  assert.equal(inspectPayload(d2.qr_content).merchantSub["04"], "0040452944429");
  assert.equal(d2.payee.name, "น.ส. พรพิไล ดวงใจ");
  assert.equal(d2.pay_target_label, "ช่องทางสำรอง");
});

await t("สลับช่องทางตอนแจ้งโอน → ออเดอร์จำช่องทางที่ใช้จริง เห็นในหลังบ้าน", async () => {
  const { env: em, orders: om } = makeMockEnv({ pdfBytes: PDF_BYTES, env: { PROMPTPAY_OPTIONS: TWO, ADMIN_TOKEN: "admin-secret" } });
  const d = await (await worker.fetch(postJson("/api/checkout", { email: "auto@example.com" }), em)).json();
  const mobileKey = d.pay_options[1].key;
  const fd = slipForm();
  fd.append("pay_target", mobileKey);
  const rep = await (await worker.fetch(postForm(`/api/order/${d.order_id}/report`, fd), em)).json();
  assert.equal(rep.status, "reported");
  const row = om.get(d.order_id);
  assert.equal(row.pay_target, mobileKey);
  assert.equal(row.pay_target_label, "ร้านทดสอบ", "ออเดอร์เก็บป้ายแบบเดียวกับที่ลูกค้าเห็น (PROMPTPAY_NAME ไม่ใช่เลข)");
  assert.ok(!/\d/.test(row.pay_target_label));
  assert.equal(inspectPayload(row.qr_content).proxyType, "mobile");
  const list = await (await worker.fetch(adminReq("/admin/orders"), em)).json();
  assert.equal(list.orders[0].pay_target_label, row.pay_target_label);
  // ส่ง pay_target ที่ไม่รู้จัก → ไม่เปลี่ยนค่าเดิม
  const fd2 = new FormData();
  fd2.append("pay_target", "bank-account:deadbeef");
  await worker.fetch(postForm(`/api/order/${d.order_id}/report`, fd2), em);
  assert.equal(om.get(d.order_id).pay_target, mobileKey);
});

await t("ตรวจสลิปอัตโนมัติ: เทียบกับช่องทางที่ออเดอร์เลือก (ไม่ใช่แค่ช่องทางใดก็ได้)", async () => {
  const { env: em, orders: om } = makeMockEnv({ pdfBytes: PDF_BYTES, env: { PROMPTPAY_OPTIONS: TWO, EASYSLIP_API_KEY: "esk_test" } });
  // ออเดอร์เลือกจ่ายทาง “เบอร์” → สลิปที่โอนเข้าบัญชีธนาคารต้องไม่ถูกอนุมัติอัตโนมัติ
  const a = await (await worker.fetch(postJson("/api/checkout", { email: "multi1@example.com", target: parsePromptPayOptions(TWO)[1].key }), em)).json();
  easySlipCfg = { success: true, amount: 99, receiver: "0040452944429", transRef: "TX_MULTI_1" };
  const d1 = await (await worker.fetch(postForm(`/api/order/${a.order_id}/report`, slipForm()), em)).json();
  assert.equal(d1.auto_verified, false);
  assert.match(d1.auto_reason, /ผู้รับ/);
  // โอนเข้าช่องทางที่เลือกไว้ → ผ่าน
  const b = await (await worker.fetch(postJson("/api/checkout", { email: "multi2@example.com", target: parsePromptPayOptions(TWO)[1].key }), em)).json();
  easySlipCfg = { success: true, amount: 99, receiver: "0066880754039", transRef: "TX_MULTI_2" };
  const d2 = await (await worker.fetch(postForm(`/api/order/${b.order_id}/report`, slipForm()), em)).json();
  assert.equal(d2.auto_verified, true);
  assert.equal(d2.status, "paid");
  // ออเดอร์เก่าที่ไม่ได้บันทึกช่องทางไว้ → เทียบกับทุกช่องทางที่ร้านตั้งไว้
  const c = await (await worker.fetch(postJson("/api/checkout", { email: "auto@example.com" }), em)).json();
  om.get(c.order_id).pay_target = null;
  om.get(c.order_id).pay_target_label = null;
  easySlipCfg = { success: true, amount: 99, receiver: "0040452944429", transRef: "TX_MULTI_3" };
  const d3 = await (await worker.fetch(postForm(`/api/order/${c.order_id}/report`, slipForm()), em)).json();
  assert.equal(d3.auto_verified, true);
  assert.equal(d3.status, "paid");
});

await t("โหมดช่องทางเดียว (PROMPTPAY_ID) ยังทำงานเหมือนเดิม — ไม่ต้องตั้ง PROMPTPAY_OPTIONS", async () => {
  const { env: em } = makeMockEnv({ pdfBytes: PDF_BYTES, env: { PROMPTPAY_OPTIONS: "", PROMPTPAY_BANK: "004", PROMPTPAY_ID: "045-2-94442-9" } });
  const d = await (await worker.fetch(postJson("/api/checkout", { email: "auto@example.com" }), em)).json();
  assert.equal(d.pay_options.length, 1);
  assert.equal(inspectPayload(d.qr_content).proxyType, "bank-account");
  assert.equal(d.pay_target, d.pay_options[0].key);
  const rest = new FormData();
  rest.append("pay_target", d.pay_options[0].key);
  const rep = await (await worker.fetch(postForm(`/api/order/${d.order_id}/report`, rest), em)).json();
  assert.equal(rep.status, "reported");
});

/* ===================== H. ของแถม 5 prompt ฟรี (หน้า /free → เก็บอีเมล) ===================== */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSV_TEXT = fs.readFileSync(path.join(HERE, "..", "prompts-599.csv"), "utf8");
const freeReq = (obj, headers = {}) => req("/api/free", {
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(obj),
});

await t("ไฟล์ของแถมตรงกับ prompts-599.csv เป๊ะ (5 ชุดแรก · ตรวจจริงด้วย --check)", () => {
  const out = execFileSync(process.execPath, ["tools/build-free-sample.mjs", "--check"], { cwd: HERE, encoding: "utf8" });
  assert.match(out, /ตรงกับ prompts-599\.csv/);
  assert.equal(FREE_SAMPLES.length, 5);
  assert.deepEqual(FREE_SAMPLES.map((s) => s.id), ["001", "002", "003", "004", "005"]);
  assert.equal(FREE_SAMPLE_META.count, 5);
  // sha256 ของ CSV ต้องตรงกับที่ฝังในไฟล์ (แก้ CSV แล้วต้องรัน generator ใหม่)
  assert.equal(crypto.createHash("sha256").update(CSV_TEXT).digest("hex"), FREE_SAMPLE_META.source_sha256);
  // เทียบกับ CSV จริง: ใน CSV เครื่องหมาย " จะถูกเก็บเป็น "" (escaping)
  const asCsv = (v) => v.replace(/"/g, '""');
  for (const s of FREE_SAMPLES) {
    assert.ok(CSV_TEXT.includes(asCsv(s.prompt_th)), `prompt ของ #${s.id} ต้องตรงกับใน CSV`);
    assert.ok(s.prompt_th.length > 300, `prompt ของ #${s.id} สั้นผิดปกติ`);
    assert.ok(s.hook_th && s.angle_th && s.niche_th);
  }
});

await t("หน้า /free มีอยู่จริงและยิง API ถูกตัว (หน้าเว็บ + ลิงก์จากหน้าแรก)", () => {
  const free = fs.readFileSync(path.join(HERE, "public", "free.html"), "utf8");
  assert.match(free, /\/api\/free/);
  assert.match(free, /type="checkbox" id="consent"/);
  assert.match(free, /type="email"/);
  assert.match(free, /href="\/privacy"/);
  const index = fs.readFileSync(path.join(HERE, "public", "index.html"), "utf8");
  assert.match(index, /href="\/free"/);
});

await t("หน้า /30day (Kopwang Prompt สร้างรายได้ใน 30 วัน) มี CTA แจกฟรี + ซื้อ และส่งที่มาให้หลังบ้าน", () => {
  const p = path.join(HERE, "public", "30day.html");
  assert.ok(fs.existsSync(p), "ต้องมี public/30day.html เพื่อให้ /30day ใช้งานได้");
  const page = fs.readFileSync(p, "utf8");
  assert.match(page, /<title>Kopwang Prompt สร้างรายได้ใน 30 วัน/);
  assert.match(page, /<h1>Kopwang Prompt <span>สร้างรายได้ใน 30 วัน<\/span><\/h1>/);
  // CTA แจกฟรี (ติด src เพื่อรู้ว่า lead มาจากแคมเปญนี้) + CTA ซื้อ
  assert.ok((page.match(/href="\/free\?src=30day"/g) || []).length >= 2, "ต้องมี CTA แจกฟรีอย่างน้อย 2 จุด (บน/ล่าง)");
  assert.ok((page.match(/href="\/\?from=30day"/g) || []).length >= 2, "ต้องมี CTA ซื้ออย่างน้อย 2 จุด (บน/ล่าง)");
  assert.match(page, /ไม่ได้การันตีรายได้/);          // ต้องมีการเปิดเผยว่าสินค้าไม่ได้การันตีรายได้
  assert.match(page, /href="\/privacy"/);
  // หน้าแรก + หน้าของแถม + หน้าขอบคุณ ต้องมีทางไปหน้าแผน 30 วัน
  for (const f of ["index.html", "free.html", "thank-you.html"]) {
    assert.match(fs.readFileSync(path.join(HERE, "public", f), "utf8"), /href="\/30day"/, `${f} ต้องมีลิงก์ไป /30day`);
  }
  // หน้า /free ต้องส่ง ?src=… ไปเป็นการบันทึกที่มาของผู้สมัคร (เห็นได้ในหลังบ้าน)
  const free = fs.readFileSync(path.join(HERE, "public", "free.html"), "utf8");
  assert.match(free, /get\('src'\)/);
  assert.match(free, /source: leadSource/);
});

await t("หน้า /links (คลังลิงก์ใส่ไบโอ TikTok) รวมแคมเปญ/แจกฟรี/ขาย + QR + ปุ่มแชร์", () => {
  const p = path.join(HERE, "public", "links.html");
  assert.ok(fs.existsSync(p), "ต้องมี public/links.html เพื่อให้ /links ใช้งานได้");
  const page = fs.readFileSync(p, "utf8");
  assert.match(page, /<title>ลิงก์ทั้งหมด — Kopwang Prompt/);
  // ทางไปทุกหน้าหลัก: แจกฟรี (ติด src เพื่อรู้ที่มา) · ซื้อ · แคมเปญ 30 วัน · ลูกค้าเดิม · คืนเงิน
  for (const href of ["/free?src=links", "/?from=links", "/30day", "/retrieve", "/refund"]) {
    assert.ok(page.includes(`href="${href}"`), `หน้า /links ต้องมีลิงก์ ${href}`);
  }
  // QR 2 อัน: หน้านี้ + หน้าซื้อ (ใช้ <img> ล้วน ไม่ต้องมี JS)
  assert.ok((page.match(/\/api\/qr\?p=/g) || []).length >= 2, "ต้องมี QR อย่างน้อบ 2 อัน (หน้านี้ + หน้าซื้อ)");
  assert.match(page, /<img [^>]*src="\/api\/qr\?p=%2Flinks"[^>]*alt="QR code/);
  // ปุ่มแชร์: แชร์ของระบบ + คัดลอก (มี fallback) + แชร์ไป LINE/Facebook/X
  assert.match(page, /id="shareTop"/);
  assert.match(page, /navigator\.share/);
  assert.match(page, /navigator\.clipboard/);
  assert.match(page, /execCommand\('copy'\)/);
  for (const app of ["line", "facebook", "x"]) {
    assert.ok(page.includes(`data-shareapp="${app}"`), `ต้องมีปุ่มแชร์ ${app}`);
  }
  assert.match(page, /ไม่ได้การันตีรายได้/);         // ต้องเปิดเผยตรง ๆ เหมือนหน้าอื่น
  assert.match(page, /href="\/privacy"/);
  assert.match(page, /href="\/terms"/);
  // รับช่วง “ที่มา” ต่อ: /links?src=30day → ปุ่มแจกฟรี + QR ส่ง 30day ต่อ (ไบโอชี้หน้าเดียว แต่วัดผลแคมเปญได้)
  assert.match(page, /URLSearchParams\(location\.search\)\.get\('src'\)/);
  assert.match(page, /'\/free\?src=' \+ src/);
  assert.match(page, /data-qr="\/links"/);
  // ข้อความไบโอต้องกรอกในไบโอ TikTok ได้ (จำกัด 80 ตัวอักษร)
  const bio = (page.match(/<div class="bio" id="bioText">([^<]+)<\/div>/) || [])[1] || "";
  assert.ok(bio.trim().length > 0, "ต้องมีข้อความไบโอให้คัดลอก");
  assert.ok([...bio.trim()].length <= 80, `ข้อความไบโอต้องไม่เกิน 80 ตัวอักษร (ตอนนี้ ${[...bio.trim()].length})`);
});

await t("นโยบายหน้าโอน: โชว์แค่ชื่อบัญชี — ไม่บอกว่าเป็นพร้อมเพย์แบบไหน และไม่โชว์เลข (หน้า / และ /order)", () => {
  for (const f of ["index.html", "order.html"]) {
    const page = fs.readFileSync(path.join(HERE, "public", f), "utf8");
    assert.ok(!page.includes("masked_id"), `${f} ต้องไม่อ้างเลขที่ปิดบางส่วนเลย`);
    assert.ok(!page.includes("โอนเข้าพร้อมเพย์"), `${f} ต้องไม่เขียนว่า “โอนเข้าพร้อมเพย์” (ไม่บอกชนิด)`);
    assert.match(page, /โอนเข้าบัญชี: <b>' \+ esc\(payeeName\)/, `${f} ต้องบอกแค่ชื่อบัญชี (คงที่ทุกช่องทาง)`);
    assert.match(page, /esc\(o\.label\)/, `${f} ต้องใช้ป้ายชื่อช่องทางที่ API ส่งมา (ไม่ใช่เลข)`);
  }
});

await t("หน้า /order (หน้ากดสั่ง) สั่งซื้อได้จริง: ปุ่มกดสั่ง + QR + แจ้งโอน + ลิงก์นโยบาย", () => {
  const p = path.join(HERE, "public", "order.html");
  assert.ok(fs.existsSync(p), "ต้องมี public/order.html เพื่อให้ /order ใช้งานได้");
  const page = fs.readFileSync(p, "utf8");
  assert.match(page, /<title>กดสั่ง — 599 Prompt ก๊อปวาง/);
  assert.match(page, /id="orderBtn"/);
  assert.match(page, /กดสั่ง — จ่ายพร้อมเพย์ ฿99/);
  assert.match(page, /type="email"/);
  assert.match(page, /id="qrBox"/);
  assert.match(page, /ฉันโอนแล้ว/);
  // ต้องยิง API ชุดเดียวกับหน้าซื้อปกติ (ไม่ประดิษฐ์ endpoint ใหม่)
  assert.match(page, /\/api\/checkout/);
  assert.match(page, /\/api\/order\/' \+ currentOrder \+ '\/report/);
  // ต้องเปิดเผยว่าสินค้าไม่ได้การันตีรายได้ + มีทางไปหน้าด้านกฎหมาย/บริการ
  assert.match(page, /ไม่ได้การันตีรายได้/);
  for (const href of ["/", "/free", "/retrieve", "/terms", "/refund", "/privacy"]) {
    assert.ok(page.includes(`href="${href}"`), `หน้า /order ต้องมีลิงก์ ${href}`);
  }
  // refresh/กลับเข้าหน้าด้วย ?order=… ต้องดู QR + สถานะต่อได้ ไม่สร้างออเดอร์ซ้ำ
  assert.match(page, /get\('order'\)/);
});

await t("เส้นทาง /order ไม่ถูก router กลืน — ส่งต่อไปให้ assets เสิร์ฟหน้าเว็บ", async () => {
  const seen = [];
  const r = await worker.fetch(req("/order"), {
    ...main.env,
    ASSETS: { fetch: async (rq) => { seen.push(new URL(rq.url).pathname); return new Response("ASSET", { status: 200 }); } },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(seen, ["/order"], "worker ต้องส่ง /order ต่อไปที่ assets ตามเดิม");
});

await t("GET /api/qr: ทำ QR ของลิงก์ในเว็บนี้ (SVG) และปฏิเสธลิงก์นอกเว็บ", async () => {
  const r = await worker.fetch(req("/api/qr?p=/links"), main.env);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /image\/svg\+xml/);
  const svg = await r.text();
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  // ต้องเข้ารหัส URL จริงของโดเมนที่กำลังเสิร์ฟ (ไม่ใช่ค่าตายตัวใน HTML)
  assert.equal(svg, qrSvg(SHOP + "/links", { scale: 8, margin: 3, dark: "#17181D", alt: "QR: " + SHOP + "/links" }));
  assert.equal(r.headers.get("x-qr-content"), SHOP + "/links");

  // APP_ORIGIN (โดเมนจริงตอน deploy) ต้องมาก่อน origin ของคำขอ
  const pushed = await (await worker.fetch(req("/api/qr?p=/links"), { ...main.env, APP_ORIGIN: "https://shop.kopwang.com" })).text();
  assert.match(pushed, /aria-label="QR: https:\/\/shop\.kopwang\.com\/links"/);

  // สีแบรนด์ใช้ได้ แต่ค่าที่ไม่ใช่ #rrggbb ต้องไม่หลุดเข้าไปใน SVG
  const orange = await (await worker.fetch(req("/api/qr?p=%2F%3Ffrom%3Dlinks&c=%23FF3D00"), main.env)).text();
  assert.match(orange, /fill="#FF3D00"/);
  const safe = await (await worker.fetch(req("/api/qr?p=%2Flinks&c=%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E"), main.env)).text();
  assert.ok(!safe.includes("<script>") && !safe.includes("alert(1)"), "ห้ามเอาค่าจาก query ไปแปะใน SVG ตรง ๆ");
  assert.match(safe, /fill="#17181D"/);

  // ห้ามใช้เป็นเครื่องสร้าง QR ให้ลิงก์นอกเว็บ (โดเมนอื่น/พาธใหญ่เกิน)
  for (const p of ["https://evil.example.com/x", "//evil.example.com", "", "/" + "a".repeat(120)]) {
    const res = await worker.fetch(req("/api/qr?p=" + encodeURIComponent(p)), main.env);
    assert.equal(res.status, 400, `ต้องปฏิเสธ p=${p}`);
  }
});

await t("GET /api/free: เห็น 5 ชุด · เต็มแค่ชุดแรก ที่เหลือรออีเมล", async () => {
  const r = await worker.fetch(req("/api/free"), main.env);
  const d = await r.json();
  assert.equal(r.status, 200);
  assert.equal(d.count, 5);
  assert.deepEqual(d.ids, ["001", "002", "003", "004", "005"]);
  assert.equal(d.samples.length, 5);
  assert.equal(d.samples[0].prompt_th, FREE_SAMPLES[0].prompt_th);
  assert.equal(d.samples[1].prompt_th, null);
  assert.equal(d.samples[4].prompt_th, null);
  assert.ok(d.samples.every((s) => s.hook_th && s.angle_th && s.id));
  assert.equal(d.packs.prompts_total, 599);
  assert.equal(d.price_satang, 9900);
  assert.match(d.buy_url, /\/\?from=free-sample$/);
  assert.equal(d.email_configured, true);
});

await t("POST /api/free: อีเมลผิด → 400 · ไม่ติ๊กยินยอม → 400 · ข้ามโดเมน → 403", async () => {
  const bad = await worker.fetch(freeReq({ email: "not-an-email", consent: true }), main.env);
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /อีเมล/);

  const noConsent = await worker.fetch(freeReq({ email: "lead1@example.com" }), main.env);
  assert.equal(noConsent.status, 400);
  assert.match((await noConsent.json()).error, /ยินยอม/);
  assert.equal(main.leads.size, 0, "ยังไม่ติ๊กยินยอม → ต้องไม่เก็บอีเมล");

  const cross = await worker.fetch(
    req("/api/free", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: JSON.stringify({ email: "lead1@example.com", consent: true }) }),
    main.env
  );
  assert.equal(cross.status, 403);
  assert.equal(main.leads.size, 0);
});

await t("POST /api/free: สำเร็จ → เก็บอีเมล + ส่งเมลที่มี prompt จริง + คืนครบ 5 ชุด", async () => {
  const { env: em, emailLog: emLog, leads: emLeads } = makeMockEnv({ pdfBytes: PDF_BYTES });
  const before = sentEmails.length;
  const r = await worker.fetch(freeReq({ email: "Lead.One@Example.com", consent: true, source: "free-page" }, { "cf-connecting-ip": "1.2.3.4" }), em);
  const d = await r.json();
  assert.equal(r.status, 200);
  assert.equal(d.ok, true);
  assert.equal(d.email_sent, true);
  assert.equal(d.samples.length, 5);
  assert.equal(d.samples[4].prompt_th, FREE_SAMPLES[4].prompt_th, "หลังกรอกอีเมลต้องเห็นครบ 5 ชุด");

  // เก็บอีเมลแบบ normalize ตัวพิมพ์เล็ก + ที่มา + เวลายินยอม + hash ของ IP (ไม่เก็บ IP จริง)
  assert.equal(emLeads.size, 1);
  const lead = emLeads.get("lead.one@example.com");
  assert.ok(lead, "ต้องเก็บอีเมลด้วยตัวพิมพ์เล็ก");
  assert.equal(lead.source, "free-page");
  assert.ok(lead.consent_at && lead.last_sent_at);
  assert.match(lead.ip_hash, /^[0-9a-f]{16}$/);
  assert.ok(!JSON.stringify(lead).includes("1.2.3.4"), "ห้ามเก็บ IP จริงลงฐานข้อมูล");

  // อีเมลที่ส่ง: ต้องมี prompt ตัวจริง + ลิงก์ไปหน้าแพ็กเต็ม + ข้อความยกเลิกรับข่าว
  assert.equal(sentEmails.length, before + 1);
  const mail = sentEmails[sentEmails.length - 1];
  assert.equal(mail.to[0], "lead.one@example.com");
  assert.match(mail.subject, /ของแถม 5 prompt แรก/);
  const asHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  assert.ok(mail.html.includes(asHtml(FREE_SAMPLES[0].prompt_th.split("\n")[0])), "อีเมลต้องมี prompt ชุดแรก");
  assert.ok(mail.html.includes(asHtml(FREE_SAMPLES[4].prompt_th.split("\n")[0])), "อีเมลต้องมีครบ 5 ชุด");
  assert.ok(mail.html.includes(asHtml(FREE_SAMPLES[4].angle_th)), "อีเมลต้องบอกมุมคอนเทนต์ของแต่ละชุด");
  assert.match(mail.html, /\/\?from=free-sample/);
  assert.match(mail.html, /ตอบกลับฉบับนี้เพื่อยกเลิก|ไม่ต้องการรับอีเมลอีก/);
  // อีเมลการตลาด (ของแถม) ต้องมีทางยกเลิกรับแบบ one-click — ไม่งั้น Gmail/Outlook มองเป็นสแปม
  assert.ok(mail.text, "ต้องมี text/plain คู่กับ html");
  assert.equal(mail.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.match(mail.headers["List-Unsubscribe"], /^<https?:\/\/[^>]+\/unsubscribe\?e=[^>]+&t=[^>]+>$/, "List-Unsubscribe ต้องเป็นลิงก์ /unsubscribe ที่มีลายเซ็น");
  assert.match(mail.html, /\/unsubscribe\?e=/, "ต้องมีลิงก์ยกเลิกรับที่กดได้จริงในเนื้ออีเมล");
  assert.equal(emLog.filter((e) => e.kind === "free" && e.order_id === null).length, 1);
});

await t("GET /unsubscribe: ลายเซ็นถูก → ลบ lead + เขียน log · ลายเซ็นผิด → ไม่ลบอะไร", async () => {
  const { env: em, leads: emLeads } = makeMockEnv({ pdfBytes: PDF_BYTES });
  const r0 = await worker.fetch(freeReq({ email: "bye@example.com", consent: true }, { "cf-connecting-ip": "7.7.7.7" }), em);
  assert.equal(r0.status, 200);
  assert.equal(emLeads.size, 1);

  // ดึงลิงก์ยกเลิกจากอีเมลที่ส่งจริง → กดลิงก์นั้น → ต้องถูกลบออกจากรายชื่อ
  const mail = sentEmails.at(-1);
  const link = mail.headers["List-Unsubscribe"].slice(1, -1);
  const path = new URL(link).pathname + new URL(link).search;

  // ลายเซ็นผิด → ต้องไม่ลบ
  const bad = await worker.fetch(req(path.replace(/t=[^&]+/, "t=forged")), em);
  assert.equal(bad.status, 200);
  assert.match(await bad.text(), /ลิงก์ไม่ถูกต้อง/);
  assert.equal(emLeads.size, 1, "ลายเซ็นผิดต้องไม่ลบ lead");

  const ok = await worker.fetch(req(path), em);
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /ยกเลิกรับอีเมลแล้ว/);
  assert.equal(emLeads.size, 0, "ลายเซ็นถูกต้อง → ต้องลบ lead ออกจากรายชื่อ");

  // one-click (POST) ต้องทำงานเหมือน GET
  const r2 = await worker.fetch(freeReq({ email: "bye2@example.com", consent: true }, { "cf-connecting-ip": "7.7.7.8" }), em);
  assert.equal(r2.status, 200);
  const link2 = sentEmails.at(-1).headers["List-Unsubscribe"].slice(1, -1);
  const path2 = new URL(link2).pathname + new URL(link2).search;
  const oneClick = await worker.fetch(req(path2, { method: "POST" }), em);
  assert.equal(oneClick.status, 200);
  assert.equal(emLeads.size, 0, "one-click POST ต้องลบ lead ได้ด้วย");
});

await t("POST /api/free: อีเมลเดิมซ้ำ → ไม่เพิ่มแถวใหม่ และเกิน 3 ครั้ง/ชม. → 429", async () => {
  const { env: em, leads: emLeads } = makeMockEnv({ pdfBytes: PDF_BYTES });
  const h = { "cf-connecting-ip": "9.9.9.9" };
  for (let i = 1; i <= 3; i++) {
    const r = await worker.fetch(freeReq({ email: "repeat@example.com", consent: true }, h), em);
    assert.equal(r.status, 200, `ครั้งที่ ${i} ต้องผ่าน`);
  }
  const blocked = await worker.fetch(freeReq({ email: "repeat@example.com", consent: true }, h), em);
  assert.equal(blocked.status, 429);
  assert.match((await blocked.json()).error, /บ่อยเกินไป/);
  assert.equal(emLeads.size, 1, "อีเมลซ้ำต้องไม่เพิ่มแถวใหม่");
});

await t("POST /api/free: เครื่องเดียวขอเกิน 10 ครั้ง/ชม. → 429 (กันสแปม)", async () => {
  const { env: em, leads: emLeads } = makeMockEnv({ pdfBytes: PDF_BYTES });
  const h = { "cf-connecting-ip": "5.5.5.5" };
  for (let i = 1; i <= 10; i++) {
    const r = await worker.fetch(freeReq({ email: `lead${i}@example.com`, consent: true }, h), em);
    assert.equal(r.status, 200, `ครั้งที่ ${i} ต้องผ่าน`);
  }
  const blocked = await worker.fetch(freeReq({ email: "lead11@example.com", consent: true }, h), em);
  assert.equal(blocked.status, 429);
  assert.equal(emLeads.size, 10);
});

await t("POST /api/free: ยังไม่ตั้ง RESEND_API_KEY → ยังเก็บอีเมล + คืน prompt ครบ", async () => {
  const { env: em, leads: emLeads } = makeMockEnv({ pdfBytes: PDF_BYTES, env: { RESEND_API_KEY: "" } });
  const before = sentEmails.length;
  const r = await worker.fetch(freeReq({ email: "nomail@example.com", consent: true }), em);
  const d = await r.json();
  assert.equal(r.status, 200);
  assert.equal(d.email_sent, false);
  assert.match(d.email_note, /ร้านจะส่งตามให้/);
  assert.equal(d.samples.length, 5, "อีเมลส่งไม่ได้ ก็ต้องยังเห็น prompt ครบในหน้าเว็บ");
  assert.equal(emLeads.size, 1, "ส่งเมลไม่ได้ก็ยังต้องเก็บอีเมลไว้");
  assert.equal(sentEmails.length, before, "ไม่ตั้งคีย์ → ต้องไม่ยิง Resend");
});

await t("หลังบ้าน: /admin/leads ต้องมี token · เห็นรายชื่อ + ดาวน์โหลด CSV ได้", async () => {
  const { env: em } = makeMockEnv({ pdfBytes: PDF_BYTES });
  await worker.fetch(freeReq({ email: "leadsA@example.com", consent: true, source: "free-page" }, { "cf-connecting-ip": "7.7.7.7" }), em);
  await worker.fetch(freeReq({ email: "leadsB@example.com", consent: true }, { "cf-connecting-ip": "7.7.7.7" }), em);

  assert.equal((await worker.fetch(req("/admin/leads"), em)).status, 401);
  assert.equal((await worker.fetch(req("/admin/leads.csv"), em)).status, 401);
  assert.equal((await worker.fetch(req("/admin/leads/delete", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), em)).status, 401);

  const d = await (await worker.fetch(adminReq("/admin/leads"), em)).json();
  assert.equal(d.stats.total, 2);
  assert.equal(d.leads.length, 2);
  assert.ok(d.leads.some((l) => l.email === "leadsa@example.com"));
  assert.equal(d.stats.sent_last_day, 2);
  assert.ok(d.stats.today >= 2);

  const csv = await worker.fetch(adminReq("/admin/leads.csv"), em);
  const bytes = new Uint8Array(await csv.arrayBuffer());   // Response.text() ตัด BOM ทิ้ง → ตรวจจากไบต์จริง
  const text = new TextDecoder().decode(bytes);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-type"), /text\/csv/);
  assert.match(csv.headers.get("content-disposition"), /leads\.csv/);
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], "ต้องมี BOM (EF BB BF) ให้ Excel อ่านภาษาไทยถูก");
  assert.match(text, /email,source,created_at,last_sent_at/);
  assert.match(text, /leadsa@example\.com/);
  assert.match(text, /leadsb@example\.com/);
});

await t("หลังบ้าน: ลบอีเมลผู้สนใจตามคำขอ → หายจากรายชื่อและ log ของแถม", async () => {
  const { env: em, emailLog: emLog } = makeMockEnv({ pdfBytes: PDF_BYTES });
  await worker.fetch(freeReq({ email: "forget@example.com", consent: true }), em);
  await worker.fetch(freeReq({ email: "keep@example.com", consent: true }), em);
  assert.equal(emLog.filter((e) => e.kind === "free").length, 2);

  const del = await worker.fetch(adminReq("/admin/leads/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "Forget@Example.com" }),
  }), em);
  assert.equal(del.status, 200);
  const d = await (await worker.fetch(adminReq("/admin/leads"), em)).json();
  assert.equal(d.stats.total, 1);
  assert.ok(!d.leads.some((l) => l.email === "forget@example.com"), "อีเมลที่ขอลบต้องหายไป");
  assert.equal(emLog.filter((e) => e.kind === "free").length, 1, "log ของแถมของอีเมลนั้นต้องถูกลบด้วย");
  assert.ok(emLog.some((e) => e.email === "keep@example.com"), "อีเมลอื่นต้องไม่โดนลบ");

  // อีเมลผิดรูปแบบ → 400 (ไม่ไปลบมั่ว)
  assert.equal((await worker.fetch(adminReq("/admin/leads/delete", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "nope" }),
  }), em)).status, 400);
});

await t("site.manifest.json ลงทะเบียนโมดูลครบทุกไฟล์ที่ worker import จริง (ไม่งั้น deploy แล้วพัง)", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(HERE, "site.manifest.json"), "utf8"));
  const listed = new Set(manifest.modules.map((m) => path.basename(m.path)));
  for (const m of manifest.modules) {
    assert.ok(fs.existsSync(path.join(HERE, m.path)), `${m.path} ต้องมีอยู่จริง`);
  }
  // เดินตาม import แบบ ./x.mjs ของทุกโมดูลที่ลงทะเบียน → ไฟล์ที่ถูก import ต้องอยู่ใน manifest ด้วย
  const queue = [...listed];
  const seen = new Set();
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const src = fs.readFileSync(path.join(HERE, file), "utf8");
    for (const [, dep] of src.matchAll(/from "\.\/([\w.-]+\.mjs)"/g)) {
      assert.ok(listed.has(dep), `${file} import ./${dep} แต่ไม่ได้อยู่ใน site.manifest.json`);
      queue.push(dep);
    }
  }
  assert.ok(listed.has("free-sample.mjs"), "โมดูลของแถมต้องถูก deploy ไปด้วย");
  assert.ok(fs.existsSync(path.join(HERE, manifest.assetsDirectory, "free.html")), "หน้า /free ต้องอยู่ใน assets");
  assert.ok(fs.existsSync(path.join(HERE, manifest.assetsDirectory, "30day.html")), "หน้า /30day ต้องอยู่ใน assets");
  assert.ok(fs.existsSync(path.join(HERE, manifest.assetsDirectory, "links.html")), "หน้า /links ต้องอยู่ใน assets");
  assert.ok(fs.existsSync(path.join(HERE, manifest.assetsDirectory, "order.html")), "หน้า /order ต้องอยู่ใน assets");
});

await t("เครื่องมือตรวจ DMARC จากอีเมลจริง: ทดสอบตัวเองผ่าน (เซ็นถูก → PASS · ข้อความถูกแก้ → FAIL)", () => {
  const out = execFileSync(process.execPath, ["tools/selftest-email-auth.mjs"], { cwd: HERE, encoding: "utf8" });
  assert.match(out, /ลายเซ็น \(b\)\s*: OK/);
  assert.match(out, /SELFTEST: OK/);
});

await t("/api/health บอกว่ามีของแถมกี่ชุด + เปิดรับอีเมลอยู่", async () => {
  const h = await (await worker.fetch(req("/api/health"), main.env)).json();
  assert.equal(h.free_sample.prompts, 5);
  assert.deepEqual(h.free_sample.ids, ["001", "002", "003", "004", "005"]);
  assert.equal(h.free_sample.leads_configured, true);
});

/* ===================== S. แพ็กอัปเดตตัวเอง (เวอร์ชัน + แจ้งลูกค้าคนเดิม) =====================
 * สัญญาที่ต้องเป็นจริง: “ซื้อครั้งเดียว ได้ทุกเวอร์ชันใหม่”
 *  1) ลิงก์เก่าของลูกค้าโหลดได้ไฟล์รุ่นล่าสุดเสมอ (ไม่ผูกเวอร์ชัน)
 *  2) ลูกค้าคนเดิมได้อีเมลแจ้งรุ่นใหม่ครั้งเดียวต่อรุ่น (ไม่ซ้ำ · ไม่กวนคนที่ยกเลิกรับ)
 */
const newEnv = (opts = {}) => makeMockEnv({ pdfBytes: PDF_BYTES, ...opts });
/** ไฟล์ PDF ปลอมที่ต่างกันจริงตามรุ่น → ตรวจได้ว่า “โหลดได้ไฟล์รุ่นไหน” จากการเทียบไบต์ */
const packPdf = (tag) => new TextEncoder().encode(`%PDF-1.5\n%=== pack ${tag} ===\n%%EOF`);
const pdfForm = (bytes, name = "prompt-pack.pdf") => {
  const fd = new FormData();
  fd.append("file", new File([bytes], name, { type: "application/pdf" }));
  return fd;
};
const publishForm = (fields, bytes) => {
  const fd = pdfForm(bytes);
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
  return adminReq("/admin/pack/publish", { method: "POST", body: fd });
};
const notifyReq = (obj = {}) => adminReq("/admin/pack/notify", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(obj),
});
/** ซื้อจริง 1 ออเดอร์จนสถานะ paid (ทางเดียวกับที่ลูกค้าทำ) → ได้รับอีเมลลิงก์ + เข้าทะเบียนลูกค้า */
async function paidOrder(env, email) {
  const co = await worker.fetch(postJson("/api/checkout", { email }), env);
  const { order_id } = await co.json();
  const ok = await worker.fetch(adminReq(`/admin/orders/${order_id}/approve`, { method: "POST" }), env);
  assert.equal(ok.status, 200, `อนุมัติออเดอร์ ${order_id} ต้องได้ 200`);
  return order_id;
}
const mailOf = (url) => url.split("/api/download/")[1];
/** อายุของลิงก์ดาวน์โหลด (ชั่วโมง) — อ่านจาก payload ในโทเคน */
function tokenTtlHours(url) {
  const payload = Buffer.from(mailOf(url).split(".")[0].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  return (Number(payload.split(":")[1]) - Date.now() / 1000) / 3600;
}
const downloadUrlIn = (html) => (String(html).match(/https:\/\/shop\.example\.com\/api\/download\/[A-Za-z0-9._-]+/) || [])[0] || null;
const unsubLinkIn = (html) => {
  const m = String(html).match(/\/unsubscribe\?e=([^"&]+)(?:&amp;|&)t=([A-Za-z0-9_-]+)/);
  return m ? `/unsubscribe?e=${m[1]}&t=${m[2]}` : null;
};
const fetchPdf = async (env, url) => {
  const res = await worker.fetch(req(url), env);
  return { status: res.status, version: res.headers.get("x-pack-version"), bytes: new Uint8Array(await res.arrayBuffer()) };
};

await t("GET /api/pack: ยังไม่ออกรุ่น → ใช้ค่าเริ่มต้นจาก pack-version.mjs + บอก “อัปเดตฟรี”", async () => {
  const { env: em } = newEnv();
  const r = await worker.fetch(req("/api/pack"), em);
  const d = await r.json();
  assert.equal(r.status, 200);
  assert.equal(d.version, PACK_RELEASE.version);
  assert.equal(d.prompts_total, PACK_RELEASE.prompts);
  assert.equal(d.niches_total, PACK_RELEASE.niches);
  assert.equal(d.free_updates, true);
  assert.match(d.update_promise, /ฟรี/, "ต้องบอกชัดว่าเวอร์ชันใหม่ฟรี");
  assert.ok(Array.isArray(d.updates), "ต้องมีประวัติเวอร์ชันเป็นอาร์เรย์");
  // ข้อมูลสาธารณะต้องไม่รั่วค่าความลับ/จำนวนลูกค้า
  const raw = JSON.stringify(d);
  assert.ok(!/resend|signing|admin/i.test(raw), "ห้ามมีชื่อคีย์/ความลับในสาธารณะ");
  assert.equal(d.subscribers, undefined, "จำนวนลูกค้าเป็นข้อมูลหลังบ้าน ห้ามเปิดสาธารณะ");
});

await t("/admin/pack ทุกเส้นต้องมี ADMIN_TOKEN (401) — ยังไม่ตั้งคีย์เมลก็ต้องไม่พัง", async () => {
  const { env: em } = newEnv();
  assert.equal((await worker.fetch(req("/admin/pack"), em)).status, 401);
  assert.equal((await worker.fetch(req("/admin/pack/customers.csv"), em)).status, 401);
  assert.equal((await worker.fetch(postJson("/admin/pack/notify", {}), em)).status, 401);
  assert.equal((await worker.fetch(postForm("/admin/pack/publish", new FormData()), em)).status, 401);

  const ok = await worker.fetch(adminReq("/admin/pack"), em);
  assert.equal(ok.status, 200);
  const d = await ok.json();
  assert.equal(d.current.version, PACK_RELEASE.version);
  assert.equal(d.current.source, "code", "ยังไม่ออกรุ่น → current ต้องมาจากโค้ด");
  assert.equal(d.subscribers.total, 0);
  assert.equal(d.notify.batch, 20);
  assert.equal(d.notify.update_link_ttl_hours, 720);
});

await t("publish: ตรวจ input ให้ครบ — เวอร์ชันผิด 400 · ไม่ใช่ PDF 415 · เลขรุ่นซ้ำ 409 · ไม่ส่งไฟล์ 400", async () => {
  const { env: em, packVersions } = newEnv();
  assert.equal((await worker.fetch(publishForm({ version: "v.5" }, packPdf("bad")), em)).status, 400);
  const wrongType = await worker.fetch(publishForm({ version: "1.5" }, new TextEncoder().encode("not a pdf at all")), em);
  assert.equal(wrongType.status, 415);
  assert.equal((await worker.fetch(adminReq("/admin/pack/publish", { method: "POST", body: new FormData() }), em)).status, 400);
  assert.equal(packVersions.length, 0, "คำขอที่ไม่ผ่านต้องไม่เขียนทะเบียน");

  const first = await worker.fetch(publishForm({ version: "1.5", prompts: 649, notes: "เพิ่ม 50 ชุดหมวดใหม่" }, packPdf("v1.5")), em);
  assert.equal(first.status, 200);
  const dup = await worker.fetch(publishForm({ version: "1.5" }, packPdf("v1.5-again")), em);
  assert.equal(dup.status, 409, "เลขรุ่นซ้ำต้องถูกปฏิเสธ (กันทะเบียนสับสน)");
  assert.equal(packVersions.length, 1);
});

await t("publish สำเร็จ: เก็บเวอร์ชัน + sha256 · ตั้งรุ่นใหม่เป็น current แถวเดียว · /api/pack และ health อัปเดตทันที", async () => {
  const { env: em, packVersions, r2 } = newEnv();
  const v15 = packPdf("v1.5");
  const res = await worker.fetch(publishForm({ version: "1.5", prompts: 649, pages: 512, notes: "เพิ่ม 50 ชุดใหม่" }, v15), em);
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.version, "1.5");
  assert.equal(d.previous_version, PACK_RELEASE.version);
  assert.equal(d.prompts, 649);
  assert.equal(d.niches, PACK_RELEASE.niches, "ไม่ส่ง niches → ใช้ค่าเดิม");
  assert.equal(d.bytes, v15.length);
  assert.equal(d.sha256, crypto.createHash("sha256").update(Buffer.from(v15)).digest("hex"), "sha256 ต้องตรงกับไฟล์จริง");
  assert.equal(d.object_key, "versions/prompt-pack-v1.5.pdf");

  // R2 ต้องมีทั้งสำเนาของรุ่นนี้ และไฟล์ปัจจุบันที่ลูกค้าทุกคนโหลด
  assert.deepEqual([...r2.store.get("versions/prompt-pack-v1.5.pdf").bytes], [...v15]);
  assert.deepEqual([...r2.store.get("prompt-pack.pdf").bytes], [...v15], "ไฟล์ปัจจุบันต้องถูกเปลี่ยนเป็นรุ่นใหม่");
  assert.equal(packVersions.length, 1);
  assert.equal(packVersions[0].is_current, 1);
  assert.equal(packVersions[0].notes, "เพิ่ม 50 ชุดใหม่");

  const pub = await (await worker.fetch(req("/api/pack"), em)).json();
  assert.equal(pub.version, "1.5");
  assert.equal(pub.prompts_total, 649);
  assert.equal(pub.pages, 512);
  assert.equal(pub.updates.length, 1, "ประวัติต้องมีรุ่นที่ออกแล้ว");
  assert.equal(pub.updates[0].notes, "เพิ่ม 50 ชุดใหม่");

  const h = await (await worker.fetch(req("/api/health"), em)).json();
  assert.equal(h.pack.version, "1.5");
  assert.equal(h.pack.source, "published");
  assert.equal(h.pack.prompts_total, 649);
  assert.equal(h.pack_updates.notify_batch, 20);

  // ออกรุ่นถัดไป → รุ่นเก่าต้องถูกปลดจาก current (มี current ได้แถวเดียว)
  await worker.fetch(publishForm({ version: "1.6" }, packPdf("v1.6")), em);
  assert.equal(packVersions.filter((v) => Number(v.is_current) === 1).length, 1);
  assert.equal(packVersions.filter((v) => Number(v.is_current) === 1)[0].version, "1.6");
});

await t("หัวใจของ “อัปเดตตัวเอง”: ลิงก์เก่าของลูกค้ายังโหลดไฟล์รุ่นล่าสุด (ไม่ต้องซื้อซ้ำ/ไม่ต้องมีระบบสมาชิก)", async () => {
  const { env: em, orders } = newEnv();
  const orderId = await paidOrder(em, "buyer@example.com");
  const receipt = sentEmails[sentEmails.length - 1];
  const oldLink = downloadUrlIn(receipt.html);
  assert.ok(oldLink, "อีเมลใบเสร็จต้องมีลิงก์ดาวน์โหลด");
  assert.equal(Math.round(tokenTtlHours(oldLink)), 24, "ลิงก์ใบเสร็จใช้ค่า DOWNLOAD_TTL_HOURS");

  const before = await fetchPdf(em, oldLink);
  assert.deepEqual([...before.bytes], [...PDF_BYTES], "ตอนซื้อได้ไฟล์รุ่น 1.4");

  const v15 = packPdf("v1.5");
  await worker.fetch(publishForm({ version: "1.5", prompts: 649 }, v15), em);   // ยังไม่แจ้งใคร

  // ลิงก์เดิมเป๊ะ ๆ ต้องได้ไฟล์ใหม่ทันทีหลังออกรุ่น
  const after = await fetchPdf(em, oldLink);
  assert.equal(after.status, 200, "ลิงก์เดิมต้องยังใช้ได้");
  assert.deepEqual([...after.bytes], [...v15], "ลิงก์เดิมต้องเสิร์ฟไฟล์รุ่นล่าสุด (ไม่ใช่ 1.4)");
  assert.equal(after.version, "1.5");
  assert.equal(orders.get(orderId).last_download_version, "1.5", "ต้องบันทึกว่าโหลดรุ่นไหน");
});

await t("แจ้งลูกค้าคนเดิม: ได้อีเมลรุ่นใหม่ 1 ฉบับ · ลิงก์ในเมลโหลดรุ่นใหม่ได้ · มี List-Unsubscribe one-click", async () => {
  const { env: em, subscribers, emailLog } = newEnv();
  await paidOrder(em, "old@example.com");
  assert.equal(subscribers.get("old@example.com").orders_count, 1, "ซื้อแล้วต้องเข้าทะเบียนลูกค้าอัตโนมัติ");

  const before = sentEmails.length;
  const res = await worker.fetch(publishForm({ version: "1.5", prompts: 649, notes: "เพิ่ม 50 ชุดใหม่", notify: 1 }, packPdf("v1.5")), em);
  const d = await res.json();
  assert.equal(d.notify.ok, true);
  assert.equal(d.notify.sent, 1);
  assert.equal(d.notify.remaining, 0);
  assert.equal(d.notify.done, true);
  assert.equal(d.pending_notify, 0);
  assert.equal(sentEmails.length - before, 1, "ต้องส่งอีเมลแจ้งรุ่นใหม่ 1 ฉบับ (ไม่นับใบเสร็จ)");

  const mail = sentEmails[sentEmails.length - 1];
  assert.deepEqual(mail.to, ["old@example.com"]);
  assert.match(mail.subject, /1\.5/, "หัวเรื่องต้องบอกเวอร์ชันใหม่");
  assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(mail.subject), "หัวเรื่องไม่ควรมีอีโมจิ (ลดการตกสแปม)");
  assert.match(mail.html, /649/, "ต้องบอกจำนวน prompt ของรุ่นใหม่");
  assert.match(mail.html, /เพิ่ม 50 ชุดใหม่/, "ต้องบอกว่ามีอะไรใหม่");
  assert.ok(mail.headers["List-Unsubscribe"], "อีเมลต้องมี List-Unsubscribe");
  assert.match(mail.headers["List-Unsubscribe"], /<https:\/\/shop\.example\.com\/unsubscribe\?e=/, "ค่าใน List-Unsubscribe ต้องเป็นลิงก์ยกเลิกของเรา");
  assert.equal(mail.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.ok(mail.text && mail.text.includes("http"), "ฉบับข้อความล้วนต้องมีลิงก์ด้วย");

  const link = downloadUrlIn(mail.html);
  assert.equal(Math.round(tokenTtlHours(link)), 720, "ลิงก์แจ้งรุ่นใหม่ใช้ UPDATE_LINK_TTL_HOURS (30 วัน)");
  const got = await fetchPdf(em, link);
  assert.equal(got.status, 200);
  assert.deepEqual([...got.bytes], [...packPdf("v1.5")]);

  assert.equal(subscribers.get("old@example.com").last_notified_version, "1.5");
  assert.ok(emailLog.some((e) => e.kind === "update" && e.email === "old@example.com" && e.order_id === "v1.5"), "ต้องบันทึกประวัติการแจ้ง");

  // กดแจ้งซ้ำ → ต้องไม่ส่งซ้ำ
  const again = await worker.fetch(notifyReq(), em);
  const d2 = await again.json();
  assert.equal(again.status, 200);
  assert.equal(d2.sent, 0, "แจ้งซ้ำต้องไม่ส่งอีเมลซ้ำ");
  assert.equal(d2.done, true);
  assert.equal(sentEmails.length - before, 1, "รวมแล้วต้องมีฉบับเดียว");

  const admin = await (await worker.fetch(adminReq("/admin/pack"), em)).json();
  assert.equal(admin.current.version, "1.5");
  assert.equal(admin.current.notified_count, 1, "ทะเบียนรุ่นต้องนับการแจ้งที่ส่งสำเร็จ");
  assert.equal(admin.subscribers.total, 1);
  assert.equal(admin.subscribers.notified_current, 1);
  assert.equal(admin.subscribers.pending, 0);
  assert.equal(admin.history.length, 1);
});

await t("ซื้อหลายออเดอร์ด้วยอีเมลเดิม → ได้อีเมลแจ้งรุ่นใหม่ฉบับเดียว (ทะเบียนคีย์ด้วยอีเมล)", async () => {
  const { env: em, subscribers } = newEnv();
  await paidOrder(em, "twice@example.com");
  await paidOrder(em, "TWICE@Example.com");
  const sub = subscribers.get("twice@example.com");
  assert.ok(sub, "ต้องเก็บอีเมลเป็นตัวพิมพ์เล็ก/ตัดช่องว่าง");
  assert.equal(sub.orders_count, 2, "ต้องนับจำนวนออเดอร์");
  assert.ok(sub.last_order_id, "ต้องจำออเดอร์ล่าสุดไว้ทำลิงก์");

  const before = sentEmails.length;
  const d = await (await worker.fetch(publishForm({ version: "1.5", notify: 1 }, packPdf("v1.5")), em)).json();
  assert.equal(d.notify.sent, 1);
  assert.equal(sentEmails.length - before, 1, "อีเมลเดียวต้องไม่ถูกส่งซ้ำสองรอบ");
});

await t("ส่งเป็นชุด: PACK_NOTIFY_BATCH=1 → เรียกซ้ำได้ทีละคน จนจบ (remaining ลดลงทุกครั้ง)", async () => {
  const { env: em } = newEnv({ env: { PACK_NOTIFY_BATCH: "1" } });
  await paidOrder(em, "a@example.com");
  await paidOrder(em, "b@example.com");
  await worker.fetch(publishForm({ version: "1.5", notify: 1 }, packPdf("v1.5")), em);

  const first = await (await worker.fetch(adminReq("/admin/pack"), em)).json();
  assert.equal(first.notify.batch, 1, "หลังบ้านต้องรายงานขนาดชุดที่ใช้จริง");
  assert.equal(first.subscribers.total, 2);
  assert.equal(first.subscribers.notified_current, 1);
  assert.equal(first.subscribers.pending, 1);

  const second = await (await worker.fetch(notifyReq(), em)).json();
  assert.equal(second.batch, 1);
  assert.equal(second.sent, 1);
  assert.equal(second.remaining, 0);
  assert.equal(second.done, true);

  const third = await (await worker.fetch(notifyReq(), em)).json();
  assert.equal(third.sent, 0);
  assert.equal(third.done, true);

  const after = await (await worker.fetch(adminReq("/admin/pack"), em)).json();
  assert.equal(after.subscribers.pending, 0);
  assert.equal(after.subscribers.notified_current, 2);
});

await t("ลูกค้าที่กด “ยกเลิกรับอีเมล” ต้องไม่โดนแจ้งรุ่นใหม่ (แต่ลิงก์โหลด/ขอลิงก์ใหม่ยังใช้ได้)", async () => {
  const { env: em, subscribers } = newEnv();
  await paidOrder(em, "quiet@example.com");
  const receipt = sentEmails[sentEmails.length - 1];
  const receiptLink = downloadUrlIn(receipt.html);

  await worker.fetch(publishForm({ version: "1.5", notify: 1 }, packPdf("v1.5")), em);
  const notice = sentEmails[sentEmails.length - 1];
  const unsubPath = unsubLinkIn(notice.html);
  assert.ok(unsubPath, "อีเมลแจ้งรุ่นใหม่ต้องมีลิงก์ยกเลิกใช้ได้จริง");
  const unsub = await worker.fetch(req(unsubPath), em);
  assert.equal(unsub.status, 200);
  assert.ok(subscribers.get("quiet@example.com").unsubscribed_at, "ต้องบันทึกว่าเลิกรับแล้ว");

  // ออกรุ่นใหม่ + แจ้ง → คนที่ยกเลิกแล้วต้องไม่ได้รับ
  const before = sentEmails.length;
  const d = await (await worker.fetch(publishForm({ version: "1.6", notify: 1 }, packPdf("v1.6")), em)).json();
  assert.equal(d.notify.sent, 0, "คนที่ยกเลิกรับแล้วต้องไม่ถูกส่งอีเมล");
  assert.equal(d.notify.remaining, 0, "ต้องไม่ค้างในคิวแจ้งเตือน");
  assert.equal(d.notify.done, true);
  assert.equal(sentEmails.length - before, 0);

  const admin = await (await worker.fetch(adminReq("/admin/pack"), em)).json();
  assert.equal(admin.subscribers.unsubscribed, 1);

  // ลิงก์ที่เคยได้ (ทั้งใบเสร็จและลิงก์รุ่นก่อน) ยังโหลดรุ่นล่าสุดได้
  const still = await fetchPdf(em, receiptLink);
  assert.equal(still.status, 200, "ยกเลิกรับอีเมลไม่ควรตัดสิทธิ์ดาวน์โหลดที่ซื้อแล้ว");
  assert.deepEqual([...still.bytes], [...packPdf("v1.6")]);
});

await t("ส่งไม่ออกต้องรายงานตรง ๆ (503 เมื่อไม่มีคีย์เมล · failed/stalled เมื่อผู้ให้บริการล่ม) และลองใหม่ได้", async () => {
  const { env: em, subscribers } = newEnv({ env: { RESEND_API_KEY: "" } });
  await paidOrder(em, "nomail@example.com");
  await worker.fetch(publishForm({ version: "1.5" }, packPdf("v1.5")), em);
  const noKey = await worker.fetch(notifyReq(), em);
  assert.equal(noKey.status, 503);
  assert.match((await noKey.json()).error, /RESEND_API_KEY/, "ต้องบอกสาเหตุที่ส่งไม่ได้");
  assert.equal(subscribers.get("nomail@example.com").last_notified_version, "", "ส่งไม่ออกต้องไม่มาร์คว่าแจ้งแล้ว");

  // ผู้ให้บริการตอบ 500 → ต้องไม่เงียบ: failed>0, stalled=true และไม่มาร์คว่าแจ้งแล้ว
  const { env: em2, subscribers: subs2 } = newEnv();
  await paidOrder(em2, "flaky@example.com");
  await worker.fetch(publishForm({ version: "1.5", notify: 1 }, packPdf("v1.5")), em2);
  assert.equal(subs2.get("flaky@example.com").last_notified_version, "1.5");
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, o) => (String(u) === "https://api.resend.com/emails"
    ? new Response(JSON.stringify({ message: "mock 500" }), { status: 500, headers: { "content-type": "application/json" } })
    : realFetch(u, o));
  let failing;
  try {
    await worker.fetch(publishForm({ version: "1.6" }, packPdf("v1.6")), em2);
    failing = await (await worker.fetch(notifyReq(), em2)).json();
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(failing.failed, 1);
  assert.equal(failing.sent, 0);
  assert.equal(failing.remaining, 1);
  assert.equal(failing.stalled, true, "ส่งไม่ออกเลยแต่ยังมีคนค้าง → ต้องบอกว่า “ตัน” ไม่ให้วนลูปไม่จบ");
  assert.match(String(failing.failures[0].error), /resend 500/);
  assert.equal(subs2.get("flaky@example.com").last_notified_version, "1.5", "ส่งไม่สำเร็จห้ามมาร์คว่าแจ้งแล้ว (ต้องลองใหม่ได้)");

  const retry = await (await worker.fetch(notifyReq(), em2)).json();
  assert.equal(retry.sent, 1, "พอผู้ให้บริการกลับมาปกติ ต้องส่งซ้ำให้ได้");
  assert.equal(retry.done, true);
});

await t("ลูกค้าที่ซื้อก่อนมี “ทะเบียน” ต้องไม่ถูกข้าม — ระบบดึงจากออเดอร์ที่จ่ายแล้วกลับเข้าทะเบียนเองก่อนแจ้ง", async () => {
  const { env: em, subscribers } = newEnv();
  await paidOrder(em, "legacy@example.com");
  subscribers.delete("legacy@example.com");   // จำลองสภาพ “ซื้อก่อนมีตาราง subscribers” (หรือแถวหลุด)

  const admin = await (await worker.fetch(adminReq("/admin/pack"), em)).json();
  assert.equal(admin.subscribers.total, 1, "เปิดหลังบ้านแล้วต้องเห็นลูกค้ารายเดิม");
  assert.equal(admin.subscribers.synced_last_call, 1, "ต้องบอกว่าดึงกลับเข้าทะเบียนเที่ยวนี้กี่คน");
  assert.equal(admin.subscribers.pending, 1, "ต้องอยู่ในคิวรอแจ้งรุ่นปัจจุบัน");

  const before = sentEmails.length;
  const d = await (await worker.fetch(publishForm({ version: "1.5", notify: 1 }, packPdf("v1.5")), em)).json();
  assert.equal(d.notify.sent, 1, "ลูกค้ารายเดิมต้องได้อีเมลแจ้งรุ่นใหม่");
  assert.equal(d.notify.remaining, 0);
  assert.equal(sentEmails.length - before, 1);
  assert.equal(sentEmails[sentEmails.length - 1].to[0], "legacy@example.com");

  // เรียกซ้ำต้องไม่เพิ่มคนซ้ำ (INSERT OR IGNORE) และไม่ปั่นจำนวนออเดอร์ของคนที่มีอยู่แล้ว
  const again = await (await worker.fetch(adminReq("/admin/pack"), em)).json();
  assert.equal(again.subscribers.total, 1);
  assert.equal(again.subscribers.synced_last_call, 0, "รอบต่อไปต้องไม่เพิ่มใครอีก");
  assert.equal(subscribers.get("legacy@example.com").orders_count, 1, "ห้ามเขียนทับข้อมูลของคนที่อยู่ในทะเบียนแล้ว");
});

await t("ทะเบียนลูกค้าเป็น CSV (BOM + คอลัมน์ครบ) และไม่โชว์ค่าความลับ", async () => {
  const { env: em } = newEnv();
  await paidOrder(em, "csv1@example.com");
  await paidOrder(em, "csv2@example.com");
  await worker.fetch(publishForm({ version: "1.5", notify: 1 }, packPdf("v1.5")), em);

  const res = await worker.fetch(adminReq("/admin/pack/customers.csv"), em);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition"), /pack-customers\.csv/);
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], "ต้องมี BOM ให้ Excel อ่านไทยถูก");
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /email,orders_count,last_notified_version,last_download_version/);
  assert.match(text, /csv1@example\.com/);
  assert.match(text, /csv2@example\.com/);
  assert.match(text, /1\.5/, "ต้องบอกว่าแจ้งรุ่นไหนไปแล้ว");
});

await t("หน้าเว็บผูกกับการอัปเดตจริง: index ดึง /api/pack · /admin มีการ์ดแพ็กที่ยิงเส้น publish/notify ถูกตัว", () => {
  const index = fs.readFileSync(path.join(HERE, "public", "index.html"), "utf8");
  assert.match(index, /\/api\/pack/, "หน้าแรกต้องดึงเวอร์ชันจริงจาก API");
  assert.match(index, /updBand/, "ต้องมีที่โชว์เวอร์ชัน");
  assert.match(index, /อัปเดต/, "ต้องพูดถึงการอัปเดต");
  assert.match(index, /มีเวอร์ชันใหม่ ต้องจ่ายเพิ่มไหม/, "ต้องมีคำถามที่พบบ่อยเรื่องจ่ายเพิ่ม");

  const thankyou = fs.readFileSync(path.join(HERE, "public", "thank-you.html"), "utf8");
  assert.match(thankyou, /p\.pack\.version/, "หน้าขอบคุณต้องบอกรุ่นที่ลูกค้าได้รับ");
  assert.match(thankyou, /update_promise/, "ต้องบอกคำสัญญาเรื่องอัปเดตฟรี");

  const admin = fs.readFileSync(path.join(HERE, "public", "admin.html"), "utf8");
  assert.match(admin, /\/admin\/pack'/, "หลังบ้านต้องเรียก GET /admin/pack");
  assert.match(admin, /\/admin\/pack\/publish/, "ต้องมีปุ่มออกรุ่นใหม่");
  assert.match(admin, /\/admin\/pack\/notify/, "ต้องมีปุ่มแจ้งลูกค้า (และส่งต่อจนจบ)");
  assert.match(admin, /\/admin\/pack\/customers\.csv/, "ต้องมีลิงก์ทะเบียนลูกค้า CSV");
  assert.match(admin, /packCard/, "ต้องมีการ์ดแพ็ก & เวอร์ชัน");
  assert.match(admin, /newVersion/, "ต้องมีช่องใส่เลขรุ่น");
  assert.match(admin, /stalled/, "หน้าบ้านต้องรู้จักกรณี “ส่งไม่ออกเลย” และหยุดวนลูป");
});

await t("เอกสารบอกวิธีออกรุ่นใหม่ (README shop + MANUAL 6.3) ตรงกับที่ระบบทำจริง", () => {
  const readme = fs.readFileSync(path.join(HERE, "README.md"), "utf8");
  assert.match(readme, /แพ็กอัปเดตตัวเอง/, "README ต้องมีหัวข้อการอัปเดต");
  assert.match(readme, /\/admin\/pack\/publish/);
  assert.match(readme, /PACK_NOTIFY_BATCH/);
  assert.match(readme, /pack-version\.mjs/, "ต้องบอกว่าเวอร์ชันอยู่ที่ไฟล์เดียว");

  const manual = fs.readFileSync(path.join(HERE, "..", "MANUAL.md"), "utf8");
  assert.match(manual, /ลิงก์เก่าของคุณก็ได้ไฟล์ใหม่/, "คู่มือลูกค้าต้องอธิบายว่าลิงก์เดิมได้ไฟล์ใหม่");
  assert.match(manual, /อัตโนมัติ/, "คู่มือต้องบอกว่าระบบแจ้งเอง");
  assert.match(manual, new RegExp(PACK_RELEASE.version.replace(".", "\\.")), "เลขรุ่นในคู่มือต้องตรงกับ pack-version.mjs");
});

await t("เวอร์ชันมีที่เดียว (pack-version.mjs) — ปก PDF อ่านจากไฟล์นั้น ไม่ hardcode · ตัวเลขตรงกับของที่ขายจริง", () => {
  assert.ok(fs.existsSync(path.join(HERE, "pack-version.mjs")), "ต้องมีไฟล์แหล่งความจริงของเวอร์ชัน");
  assert.match(PACK_RELEASE.version, /^\d+\.\d+$/, "เวอร์ชันต้องเป็นรูปแบบ x.y");
  assert.match(PACK_RELEASE.updated_at, /^\d{4}-\d{2}-\d{2}$/, "ต้องมีวันที่อัปเดตล่าสุด");
  assert.equal(PACK_RELEASE.prompts, 599);
  assert.equal(PACK_RELEASE.niches, 26);
  assert.match(PACK_RELEASE.title, /599/);
  assert.equal(FREE_SAMPLE_META.product.includes("599"), true, "ของแถมต้องผูกกับแพ็ก 599 ชุดเดียวกัน");

  const py = fs.readFileSync(path.join(HERE, "build_pdf.py"), "utf8");
  assert.match(py, /pack-version\.mjs/, "build_pdf.py ต้องอ่านเวอร์ชันจาก pack-version.mjs");
  assert.ok(!/^VERSION\s*=\s*"\d/m.test(py), "ห้าม hardcode VERSION ใน build_pdf.py (จะได้ไม่หลุดจาก worker)");
  assert.match(py, /PACK_RELEASE/, "ต้องอ่านก้อน PACK_RELEASE จากไฟล์เวอร์ชัน");

  // manifest ที่ deploy ต้องมีโมดูลนี้ (ไม่งั้น deploy แล้ว worker import ไม่ได้)
  const manifest = JSON.parse(fs.readFileSync(path.join(HERE, "site.manifest.json"), "utf8"));
  assert.ok(manifest.modules.some((m) => m.path.endsWith("pack-version.mjs")), "site.manifest.json ต้องลงทะเบียน pack-version.mjs");
});

/* ===================== สรุป ===================== */
console.log(`\nผ่านทั้งหมด ${pass} ข้อ${fails.length ? ` · ล้มเหลว ${fails.length}: ${fails.join(" | ")}` : " — ไม่มี assertion ล้มเหลว"}`);
process.exit(fails.length ? 1 : 0);
