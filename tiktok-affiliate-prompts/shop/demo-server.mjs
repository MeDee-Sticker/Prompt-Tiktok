/**
 * demo-server.mjs — พรีวิวทั้งระบบแบบ "ของจริง" โดยไม่ต้องมีคีย์จริง (ไม่ต้องมี Omise/Resend/EasySlip)
 * รัน worker.js ตัวจริง + D1/R2/อีเมล จำลองในหน่วยความจำ
 * ปุ่ม "จำลองสแกนจ่าย" จะแจ้งโอน (แนบสลิปจำลอง) แล้วอนุมัติเป็นแอดมิน → ส่งอีเมล (จำลอง) → เปิดปุ่มโหลด
 * อยากเห็นโหมดอัตโนมัติ (ตรวจสลิป + อนุมัติเอง ไม่ต้องกดอะไรเลย):  DEMO_AUTO_APPROVE=1 node demo-server.mjs
 *
 * รัน:  node demo-server.mjs [port]     (ค่าเริ่มต้น 3000)
 * หลังบ้าน: http://localhost:3000/admin  → token = demo-admin
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import worker from "./worker.js";
import { makeMockEnv, installFetchMock, TINY_PNG } from "./mock-env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] || 3000);
const PDF_PATH = path.join(__dirname, "build", "prompt-pack.pdf");

const pdfBytes = fs.existsSync(PDF_PATH) ? fs.readFileSync(PDF_PATH) : null;
const ADMIN_TOKEN = "demo-admin";
// ค่าเริ่มต้น = ค่าจริงของร้านตอนนี้: บัญชี ttb (011) ช่องเดียว — หน้าโอนจะโชว์แค่ชื่อบัญชี (ไม่บอกชนิดพร้อมเพย์/ไม่โชว์เลข)
//   หลายช่องทาง (เดโมปุ่มเลือกช่องทาง): DEMO_PROMPTPAY_OPTIONS="9192868041@011, 0880754039" node demo-server.mjs
//   ทางเดียว (โหมดเบอร์): DEMO_PROMPTPAY_ID=0880754039 DEMO_PROMPTPAY_BANK= node demo-server.mjs
const PP_OPTIONS = process.env.DEMO_PROMPTPAY_ID ? "" : (process.env.DEMO_PROMPTPAY_OPTIONS ?? "9192868041@011");
const PP_ID = process.env.DEMO_PROMPTPAY_ID || "";
const PP_BANK = process.env.DEMO_PROMPTPAY_BANK ?? "";

// เดโมโหมดอัตโนมัติเต็มรูปแบบ (ตรวจสลิป + อนุมัติเอง + ส่งเมล): DEMO_AUTO_APPROVE=1 node demo-server.mjs
const AUTO = process.env.DEMO_AUTO_APPROVE === "1";

const { env, orders, sentEmails } = makeMockEnv({
  pdfBytes,
  env: {
    APP_ORIGIN: `http://localhost:${PORT}`,
    ADMIN_TOKEN,
    PROMPTPAY_OPTIONS: PP_OPTIONS,
    PROMPTPAY_ID: PP_ID,
    PROMPTPAY_BANK: PP_BANK,
    PROMPTPAY_NAME: process.env.DEMO_PROMPTPAY_NAME || "น.ส. พรพิไล ดวงใจ",
    ...(AUTO ? { EASYSLIP_API_KEY: "demo-easyslip-key" } : {}),
  },
});

/** สลิปจำลองที่จะ "ผ่าน" อัตโนมัติ — ใส่ทั้งเลขพร้อมเพย์และเลขบัญชีของร้าน เพื่อให้ตรงกับช่องทางที่ลูกค้าเลือก */
function demoSlipBody() {
  const raw = String(PP_OPTIONS || PP_ID || "").split(",")[0].trim();
  const id = raw.split("@")[0];
  const bank = (raw.split("@")[1] || PP_BANK || "").trim();
  const proxy = id.length === 10 && id.startsWith("0") ? "0066" + id.slice(1) : id;
  return {
    account: { name: process.env.DEMO_PROMPTPAY_NAME || "น.ส. พรพิไล ดวงใจ" },
    proxy: { type: "MSISDN", account: proxy },
    bank: { account: bank ? bank + id : id },
  };
}

installFetchMock({
  charges: new Map(),
  sentEmails,
  easySlip: AUTO
    ? () => ({ amount: 99, matchedAccount: null, receiverObj: demoSlipBody(), transRef: "DEMO_TX_" + Date.now() })
    : null,
});

/* ---------- ปุ่ม "จำลองจ่ายเงิน" (เฉพาะเดโม) ---------- */
const DEMO_SCRIPT = `
<script>
(function(){
  var b=document.createElement('button');
  b.type='button';
  b.textContent='🧪 จำลองสแกนจ่าย ฿99 (โหมดทดสอบ)';
  b.style.cssText='width:100%;margin-top:14px;background:#FFD84D;color:#17181D;border:none;font-family:Kanit,sans-serif;font-weight:800;font-size:16px;padding:14px;border-radius:999px;cursor:pointer';
  b.onclick=async function(){
    b.disabled=true; b.textContent='กำลังจำลองการโอน + ร้านอนุมัติ…';
    var r=await fetch('/api/demo/simulate',{method:'POST'});
    var d=await r.json();
    if(!d.ok){ b.disabled=false; b.textContent='ยังไม่มีออเดอร์ — กด “ซื้อเลย” ก่อน'; return; }
    b.textContent='✅ จำลองจ่ายแล้ว — รอระบบเปิดปุ่มโหลด…';
  };
  window.addEventListener('load',function(){
    var box=document.getElementById('payBox');
    if(box) box.appendChild(b);
  });
})();
</script>`;

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".pdf": "application/pdf", ".ico": "image/x-icon" };

async function callWorker(pathname, method = "GET", body = undefined, headers = {}, origin = `http://localhost:${PORT}`) {
  const req = new Request(`${origin}${pathname}`, { method, headers, body });
  const res = await worker.fetch(req, { ...env, APP_ORIGIN: origin });
  return { status: res.status, body: await res.json().catch(() => null), res };
}

/** origin ที่เบราว์เซอร์ใช้จริง (localhost หรือโดเมนพรีวิว) — ให้ sameOrigin ผ่าน และลิงก์ในอีเมลชี้ถูกโดเมน */
function requestOrigin(req) {
  if (process.env.DEMO_APP_ORIGIN) return process.env.DEMO_APP_ORIGIN;
  const host = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${PORT}`;
  const local = /^(localhost|127\.|\[::1\])/.test(String(host));
  const proto = req.headers["x-forwarded-proto"] || (local ? "http" : "https");
  return `${proto}://${host}`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    /* จำลองการชำระเงินของลูกค้า: แนบสลิปจำลอง → แจ้งโอน → ร้านอนุมัติ */
    if (url.pathname === "/api/demo/simulate" && req.method === "POST") {
      const last = [...orders.values()].reverse().find((o) => o.status === "pending" || o.status === "reported");
      if (!last) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false })); return; }
      const fd = new FormData();
      fd.append("slip", new File([TINY_PNG], "demo-slip.png", { type: "image/png" }));
      const demoOrigin = requestOrigin(req);
      const rep = await callWorker(`/api/order/${last.id}/report`, "POST", fd, {}, demoOrigin);
      const app = await callWorker(`/admin/orders/${last.id}/approve`, "POST", "{}", { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" }, demoOrigin);
      console.log(`[demo] ${last.id} → report=${rep.status}/${rep.body?.status} approve=${app.status}/${app.body?.status} emails=${sentEmails.length}`);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, order_id: last.id, report: rep.body, approve: app.body, emails_sent: sentEmails.length }));
      return;
    }
    // ส่งต่อ API ทั้งหมดให้ worker ตัวจริง
    // ⚠️ ต้องเป็น "/admin/" (มีสแลช) — ไม่งั้นหน้า /admin จะถูกส่งเข้า worker แล้งกลายเป็น “promptpack-shop”
    // (บน Cloudflare จริง env.ASSETS จะเสิร์ฟ admin.html ให้ /admin เอง แต่เดโมไม่มี ASSETS)
    if (url.pathname.startsWith("/api/") || url.pathname === "/paid" || url.pathname.startsWith("/admin/")) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const origin = requestOrigin(req);
      const wreq = new Request(origin + url.pathname + url.search, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
      const wres = await worker.fetch(wreq, { ...env, APP_ORIGIN: origin });
      const buf = Buffer.from(await wres.arrayBuffer());
      res.writeHead(wres.status, Object.fromEntries(wres.headers));
      res.end(buf);
      return;
    }
    // static: หน้าเว็บใน public/ (+ ad creatives ที่ ../ad-creatives)
    const rel = url.pathname.replace(/^\//, "");
    let p = path.join(__dirname, "public", url.pathname === "/" ? "index.html" : rel);
    if (!fs.existsSync(p)) p = path.join(__dirname, "public", rel + ".html");   // pretty URL เหมือนบน Cloudflare
    if (!fs.existsSync(p)) p = path.join(__dirname, "..", "ad-creatives", rel);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      let body = fs.readFileSync(p);
      const ext = path.extname(p);
      // ใส่ปุ่ม "จำลองสแกนจ่าย" ให้ทั้งหน้าซื้อเดิมและหน้ากดสั่ง (/order) — สคริปต์หา #payBox เอง
      if (ext === ".html" && ["index.html", "order.html"].includes(path.basename(p))) {
        body = Buffer.from(body.toString().replace("</body>", DEMO_SCRIPT + "</body>"));
      }
      res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
      res.end(body);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  } catch (e) {
    res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: String(e.message || e) }));
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`demo shop on http://0.0.0.0:${PORT}  ·  PDF=${pdfBytes ? "ok" : "MISSING"}  ·  admin token=${ADMIN_TOKEN}`);
  console.log(`ช่องทางรับเงินในเดโม: ${PP_OPTIONS || `${PP_ID}${PP_BANK ? " (ธนาคาร " + PP_BANK + ")" : ""}`} (โชว์แบบปิดบางส่วนบนหน้าเว็บ)`);
});
