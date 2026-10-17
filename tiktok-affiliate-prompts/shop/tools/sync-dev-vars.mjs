// ซิงก์ค่าจริงจาก .secrets/ เข้า .dev.vars (ไฟล์ local ถูก gitignore) — ไม่พิมพ์ค่าลับออกจอ
// ใช้เมื่ออีเมลในเครื่องส่งไม่ออกเพราะคีย์เก่า:  node tools/sync-dev-vars.mjs   (ไม่กระทบ production — deploy อ่าน Sites → Secrets)
import fs from "node:fs";
import crypto from "node:crypto";
const SHOP = new URL("../", import.meta.url).pathname;
const h = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 8);
const exists = (n) => fs.existsSync(SHOP + ".secrets/" + n);
const sec = (n) => fs.readFileSync(SHOP + ".secrets/" + n, "utf8").trim();

// EASYSLIP_API_KEY = คีย์ตรวจสลิปอัตโนมัติ — ถ้ายังไม่มีไฟล์ ตัวนี้จะข้ามไป (ไม่พัง) แล้วรายงานว่า “ยังไม่มี”
const KEYS = ["RESEND_API_KEY", "MAIL_FROM", "NOTIFY_EMAIL", "EASYSLIP_API_KEY"];
const lines = fs.readFileSync(SHOP + ".dev.vars", "utf8").split(/\r?\n/);
const report = [];

for (const k of KEYS) {
  if (!exists(k)) { report.push(`${k}: ยังไม่มีไฟล์ .secrets/${k} → ข้าม (โหมดนี้ยังไม่เปิดใช้)`); continue; }
  const want = sec(k);
  const i = lines.findIndex((l) => new RegExp(`^\\s*${k}\\s*=`).test(l));
  const had = i >= 0 ? lines[i] : null;
  const line = `${k}="${want}"`;
  if (i >= 0) {
    if (had === line) { report.push(`${k}: ค่าเดิมถูกต้องแล้ว (…${h(want)})`); continue; }
    lines[i] = line;
    report.push(`${k}: แก้ค่าเดิม (…${h(had.split("=").slice(1).join("="))}) → ค่าจริง (…${h(want)})`);
  } else {
    lines.push(line);
    report.push(`${k}: เติมบรรทัดใหม่ที่ไม่มีในไฟล์ (…${h(want)})`);
  }
}
fs.writeFileSync(SHOP + ".dev.vars", lines.join("\n"));
console.log(report.join("\n"));
console.log("\nชื่อตัวแปรใน .dev.vars ตอนนี้:", fs.readFileSync(SHOP + ".dev.vars", "utf8").split(/\r?\n/).filter((l) => /^[A-Z]/.test(l)).map((l) => l.split("=")[0]).join(", "));
