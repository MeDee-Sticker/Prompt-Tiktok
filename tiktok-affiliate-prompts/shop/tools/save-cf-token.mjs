// บันทึก Cloudflare API token ลง .secrets/CLOUDFLARE_API_TOKEN — ตัวเดียวจบ: รับค่าแบบไม่ echo,
// ล้างช่องว่าง/ขึ้นบรรทัดใหม่, ตรวจรูปแบบ, ตั้งสิทธิ์ไฟล์ 600, แล้วเรียกตัวตรวจสิทธิ์ให้ทันที
//
// วิธีใช้ (เลือกอย่างใดอย่างหนึ่ง):
//   node tools/save-cf-token.mjs                 ← พิมพ์/วางโทเคนแล้ว Enter (ไม่ขึ้นบนจอ)
//   pbpaste | node tools/save-cf-token.mjs       ← macOS: ส่งจากคลิปบอร์ดตรง ๆ (ไม่ต้องพิมพ์)
//   xclip -o | node tools/save-cf-token.mjs      ← Linux (X11)
//   node tools/save-cf-token.mjs < token.txt     ← อ่านจากไฟล์ (ระวังอย่าให้ไฟล์นั้นถูก commit)
//   TOKEN_FILE=.secrets/OTHER node tools/save-cf-token.mjs
//   NO_CHECK=1 node tools/save-cf-token.mjs      ← บันทึกเฉย ๆ ไม่ตรวจสิทธิ์ต่อ
//
// ทำไมต้องมีสคริปต์นี้: การวางโทเคนยาว ๆ ลง shell ตรง ๆ พลาดง่าย (วางตอน shell ยังไม่พร้อมรับ =
// ข้อความไปต่อท้ายคำสั่ง, หรือมี \r ติดจาก Windows) ⇒ ตัวนี้รับเฉพาะ "ค่า" ไม่ตีความเป็นคำสั่ง
// และแสดงผลแค่ sha256 8 ตัวแรก ไม่พิมพ์ค่าจริง
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const SHOP = new URL("../", import.meta.url).pathname;
process.chdir(SHOP);

const TOKEN_FILE = process.env.TOKEN_FILE || ".secrets/CLOUDFLARE_API_TOKEN";
const NO_CHECK = process.env.NO_CHECK === "1";

const clean = (s) => String(s).replace(/[\s\u200b\ufeff]+/g, "").replace(/^["'`]|["'`]$/g, "");

// อ่านแบบไม่ให้ echo: raw mode ไม่แสดงตัวอักษรที่พิมพ์ (POSIX) · รองรับ backspace, Ctrl+C, Ctrl+D
function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    // เปิด raw mode “ก่อน” แสดงพรอมป์ — กันอักษรที่วางเข้ามาในช่วงเริ่มต้นถูก echo ขึ้นจอ
    stdin.setRawMode(true);
    process.stderr.write(prompt);
    stdin.resume();
    stdin.setEncoding("utf8");
    let buf = "";
    const done = (val, err) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stderr.write("\n");
      err ? reject(err) : resolve(val);
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\u0003") return done(null, new Error("ยกเลิก (Ctrl+C) — ยังไม่ได้บันทึกอะไร")); // Ctrl+C
        if (ch === "\u0004") return done(buf, null); // Ctrl+D
        if (ch === "\r" || ch === "\n") return done(buf, null);
        if (ch === "\u007f" || ch === "\b") { buf = buf.slice(0, -1); continue; } // backspace / paste ทับ
        buf += ch;
      }
    };
    stdin.on("data", onData);
  });
}

function readPiped() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => { data += c; });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

const fail = (m, code = 2) => { console.error("\n❌ " + m); process.exit(code); };

const isTTY = Boolean(process.stdin.isTTY);
if (isTTY) console.error(`บันทึกโทเคนลง ${TOKEN_FILE} — ค่าจะไม่แสดงบนจอ (Ctrl+C = ยกเลิก)`);

let raw;
try {
  raw = isTTY ? await readHidden("token: ") : await readPiped();
} catch (e) {
  fail(e.message, 130);
}

const TOKEN = clean(raw);
if (!TOKEN) fail("ไม่ได้ค่าโทเคน (ว่าง) — รันใหม่แล้ววางค่าอีกครั้ง");
if (TOKEN.length < 30) fail(`โทเคนสั้นผิดปกติ (${TOKEN.length} ตัวอักษร) — น่าจะคัดลอกมาไม่ครบ ต้องได้ราว 40 ตัว`);
if (TOKEN.length > 200) fail(`โทเคนยาวผิดปกติ (${TOKEN.length} ตัวอักษร) — วางมาหลายบรรทัด/หลายค่า?`);
if (!/^[A-Za-z0-9_-]+$/.test(TOKEN)) fail(`โทเคนมีอักขระที่ไม่ควรมี (${TOKEN.replace(/[A-Za-z0-9_-]/g, "?").slice(0, 12)}…) — ตรวจว่าคัดลอกเฉพาะค่า ไม่มีคำสั่งติดมา`);

fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
fs.writeFileSync(TOKEN_FILE, TOKEN, { mode: 0o600 });
fs.chmodSync(TOKEN_FILE, 0o600); // บังคับสิทธิ์ซ้ำ เผื่อไฟล์มีอยู่เดิม (writeFile mode ไม่ทับของเดิม)

const fp = crypto.createHash("sha256").update(TOKEN).digest("hex").slice(0, 8);
console.log(`✅ บันทึกแล้ว: ${TOKEN_FILE}`);
console.log(`   ${TOKEN.length} ตัวอักษร · sha256(8) = ${fp} (ไม่พิมพ์ค่าจริง) · สิทธิ์ไฟล์ ${(fs.statSync(TOKEN_FILE).mode & 0o777).toString(8)}`);

if (NO_CHECK) {
  console.log("   (NO_CHECK=1 → ข้ามการตรวจสิทธิ์ · ตรวจเองได้ด้วย: node tools/check-cf-token.mjs)");
  process.exit(0);
}

console.log("\n▶ ตรวจสิทธิ์โทเคนต่อเลย…\n");
const r = spawnSync(process.execPath, ["tools/check-cf-token.mjs", ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(r.status === null ? 1 : r.status);
