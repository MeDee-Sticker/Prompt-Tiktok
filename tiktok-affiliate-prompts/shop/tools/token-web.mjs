// ทางเลือก "ไม่ต้องใช้เทอร์มินัล" สำหรับใส่ Cloudflare API token — เปิดฟอร์มในเบราว์เซอร์แล้ววางค่า
//
// ทำไม: การวางค่าลง shell พลาดง่าย (วางผิดจังหวะ, bracketed-paste `^[[200~`, `\r` จาก Windows,
// เกิด line continuation `\`) ⇒ ตัวนี้รับค่าผ่าน HTTP แล้วเขียนไฟล์เองแบบ 600 · ไม่มีค่าโทเคน printed
// ลงจอ/แชท/ล็อก และใช้ได้ครั้งเดียว
//
// วิธีใช้:
//   node tools/token-web.mjs                 # เปิดฟอร์มที่ http://0.0.0.0:3000
//   PORT=3000 node tools/token-web.mjs       # เปลี่ยนพอร์ต
//   TOKEN_FILE=.secrets/OTHER node tools/token-web.mjs
//   ALLOW_HOST=pv-xxx.style.dev node tools/token-web.mjs   # จำกัด Host ที่ยอมรับ
//
// ความปลอดภัย: ฟอร์มมี nonce สุ่ม 32 ไบต์ฝังในหน้า · เขียนไฟล์ได้ครั้งเดียวแล้วปิดรับ · ไม่มีทางอ่านค่าโทเคนกลับ
//   · server ปิดเองเมื่อบันทึกสำเร็จ (หรือกด Ctrl+C) · ไม่บันทึก request body ลงล็อก
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const SHOP = new URL("../", import.meta.url).pathname;
process.chdir(SHOP);

const PORT = Number(process.env.PORT || 3000);
const TOKEN_FILE = process.env.TOKEN_FILE || ".secrets/CLOUDFLARE_API_TOKEN";
const ALLOW_HOST = process.env.ALLOW_HOST || "";
const NONCE = crypto.randomBytes(32).toString("hex");
const MAX_BODY = 4096;

let used = false;

const clean = (s) => String(s).replace(/[\s\u200b\ufeff]+/g, "").replace(/^["'`]|["'`]$/g, "");
const valid = (t) =>
  t.length >= 30 && t.length <= 200 && /^[A-Za-z0-9_-]+$/.test(t);

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const page = (body) => `<!doctype html><html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>ใส่ Cloudflare token</title>
<style>
:root{color-scheme:dark light}
body{font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;max-width:46rem;margin:0 auto;padding:2.5rem 1.25rem;background:#0e1116;color:#e6edf3}
h1{font-size:1.3rem;margin:0 0 .75rem}
p,li{color:#a8b3bd}
code,pre{font-family:ui-monospace,Menlo,Consolas,monospace}
pre{background:#161b22;border:1px solid #26303a;border-radius:10px;padding:.9rem 1rem;overflow:auto;white-space:pre-wrap}
input{width:100%;padding:.7rem .8rem;border-radius:10px;border:1px solid #2b3641;background:#0b0f14;color:#e6edf3;font-family:ui-monospace,monospace;font-size:.95rem}
button{margin-top:.75rem;padding:.65rem 1.1rem;border:0;border-radius:10px;background:#2f81f7;color:#fff;font-size:1rem;font-weight:600;cursor:pointer}
.ok{color:#3fb950}.bad{color:#f85149}.warn{color:#d29922}
.card{background:#11161d;border:1px solid #212a33;border-radius:12px;padding:1rem 1.1rem;margin-top:1rem}
</style></head><body>${body}</body></html>`;

const formBody = (msg = "") => `
<h1>ใส่ Cloudflare API token</h1>
<p>วางโทเคนในช่องด้านล่างแล้วกด “บันทึก” — ค่าจะถูกเขียนลง <code>${esc(TOKEN_FILE)}</code> แบบสิทธิ์ <code>600</code>
โดยไม่แสดงที่ไหนอีกและไม่เข้าแชท · เขียนได้ครั้งเดียว</p>
${msg}
<form method="POST" action="/save" autocomplete="off">
  <input type="hidden" name="nonce" value="${NONCE}">
  <input type="password" name="token" placeholder="วางโทเคนตรงนี้ (cfat_…)" autocomplete="off" spellcheck="false" required>
  <button type="submit">บันทึก + ตรวจสิทธิ์</button>
</form>
<div class="card"><p style="margin:0">ฟอร์มนี้จะปิดรับทันทีหลังบันทึกสำเร็จ · ตรวจสอบได้ว่าไฟล์ถูกเขียนด้วยคำสั่งในเทอร์มินัล
(<code>node tools/check-cf-token.mjs</code>) ถ้าต้องการตรวจซ้ำ</p></div>`;

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let data = "";
    let over = false;
    req.on("data", (c) => {
      if (over) return; // ทิ้งข้อมูลที่เหลือ แต่ยังตอบ 413 ให้ได้ (ห้าม destroy ก่อนตอบ)
      data += c;
      if (data.length > MAX_BODY) { over = true; reject(new Error("body ใหญ่เกินไป")); }
    });
    req.on("end", () => { if (!over) resolve(data); });
    req.on("error", reject);
  });

const hostOk = (req) => {
  const host = String(req.headers.host || "").split(":")[0].toLowerCase();
  if (/^(localhost|127\.0\.0\.1)$/.test(host)) return true; // ทดสอบในเครื่อง
  if (!ALLOW_HOST) return true; // ไม่ตั้งค่า = เปิด (nonce ยังกันการเขียน)
  return ALLOW_HOST.split(",").map((h) => h.trim().toLowerCase()).includes(host);
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  console.log(`${req.method} ${url.pathname} host=${req.headers.host || "-"}${used ? " [used]" : ""}`); // ห้าม log body

  if (!hostOk(req)) { res.writeHead(403, { "content-type": "text/plain" }); return res.end("host not allowed\n"); }
  if (url.pathname === "/health") { res.writeHead(200, { "content-type": "text/plain" }); return res.end("ok\n"); }

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(page(used ? `<h1 class="ok">บันทึกโทเคนแล้ว</h1><p>ฟอร์มปิดรับแล้ว · ตรวจสิทธิ์ซ้ำได้ด้วย <code>node tools/check-cf-token.mjs</code></p>` : formBody()));
  }

  if (req.method === "POST" && url.pathname === "/save") {
    if (used) { res.writeHead(409, { "content-type": "text/html; charset=utf-8" }); return res.end(page(`<h1 class="bad">ฟอร์มถูกใช้ไปแล้ว</h1><p>ถ้าต้องแก้ ให้กด Ctrl+C แล้วเปิดสคริปต์ใหม่</p>`)); }
    let body = "";
    try { body = await readBody(req); } catch (e) {
      res.writeHead(413, { "content-type": "text/plain", connection: "close" });
      return res.end(String(e.message), () => req.destroy());
    }
    const params = new URLSearchParams(body);
    if (params.get("nonce") !== NONCE) {
      res.writeHead(403, { "content-type": "text/html; charset=utf-8" });
      return res.end(page(`<h1 class="bad">nonce ไม่ถูกต้อง</h1><p>เปิดหน้าใหม่จาก URL เดิมของฟอร์มนี้</p>`));
    }
    const TOKEN = clean(params.get("token") || "");
    if (!TOKEN) {
      res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
      return res.end(page(formBody(`<p class="bad">ยังไม่ได้วางค่า — ลองอีกครั้ง</p>`)));
    }
    if (!valid(TOKEN)) {
      res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
      return res.end(page(formBody(`<p class="bad">ค่ารูปแบบไม่ถูกต้อง (${TOKEN.length} ตัวอักษร) — ต้องยาวราว 40 ตัว และมีเฉพาะ A–Z a–z 0–9 _ -</p>`)));
    }

    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    fs.writeFileSync(TOKEN_FILE, TOKEN, { mode: 0o600 });
    fs.chmodSync(TOKEN_FILE, 0o600);
    used = true;
    const fp = crypto.createHash("sha256").update(TOKEN).digest("hex").slice(0, 8);
    const mode = (fs.statSync(TOKEN_FILE).mode & 0o777).toString(8);
    // กันพลาดแบบซ้ำเดิม: ถ้าค่าที่วางเหมือนโทเคนที่มีอยู่แล้วทุกไบต์ = เป็นบัญชีเดิม
    const dir = path.dirname(TOKEN_FILE);
    const dup = (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
      .filter((f) => f.includes("CLOUDFLARE_API_TOKEN") && path.join(dir, f) !== TOKEN_FILE)
      .filter((f) => { try { return fs.readFileSync(path.join(dir, f), "utf8").trim() === TOKEN; } catch { return false; } });
    if (dup.length) console.log(`⚠️ โทเคนที่วางซ้ำกับ ${dup.join(", ")} (บัญชีเดิม)`);
    console.log(`✅ เขียน ${TOKEN_FILE} แล้ว · ${TOKEN.length} ตัว · sha256(8) ${fp} · mode ${mode} (ไม่พิมพ์ค่าจริง)`);

    console.log("▶ ตรวจสิทธิ์…");
    const chk = spawnSync(process.execPath, ["tools/check-cf-token.mjs"], { encoding: "utf8", env: { ...process.env, TOKEN_FILE } });
    const out = (chk.stdout || "") + (chk.stderr || "");
    const okAll = chk.status === 0;

    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(page(`
      ${dup.length ? `<div class="card"><h1 class="bad">⚠️ โทเคนนี้ซ้ำกับ <code>${esc(dup.join(", "))}</code></h1><p>ค่าเหมือนกันทุกไบต์ ⇒ เป็น <b>บัญชีเดิม</b> ไม่ใช่บัญชีที่ถือโดเมน — สร้าง token ใหม่หลังจากสลับบัญชีที่มุมซ้ายบนของ dash ก่อน</p></div>` : ""}
      <h1 class="${okAll ? "ok" : "bad"}">${okAll ? "บันทึกแล้ว — สิทธิ์ครบ พร้อม deploy" : "บันทึกแล้ว — สิทธิ์ยังไม่ครบ"}</h1>
      <p>ไฟล์ <code>${esc(TOKEN_FILE)}</code> · ${TOKEN.length} ตัวอักษร · sha256(8) <code>${fp}</code> · สิทธิ์ ${mode}</p>
      <pre>${esc(out.trim())}</pre>
      <div class="card"><p style="margin:0">บอกผู้ช่วยว่า “วางโทเคนแล้ว” เพื่อเดินหน้า deploy ต่อ</p></div>`));

    console.log(`ผลตรวจ: ${okAll ? "ผ่านทุกข้อ" : "ยังไม่ครบ (exit " + chk.status + ")"} — ปิดเซิร์ฟเวอร์`);
    setTimeout(() => { server.close(() => process.exit(0)); }, 1500);
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found\n");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 ฟอร์มใส่โทเคนเปิดที่ http://0.0.0.0:${PORT} (เปิดในแผง Browser ของแอปได้เลย)`);
  console.log(`   ปลายทาง: ${TOKEN_FILE} · เขียนได้ครั้งเดียว · ไม่พิมพ์ค่าโทเคนลงจอ`);
  if (ALLOW_HOST) console.log(`   ยอมรับเฉพาะ Host: ${ALLOW_HOST}`);
});
