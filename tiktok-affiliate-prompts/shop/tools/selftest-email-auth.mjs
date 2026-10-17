/**
 * ทดสอบตัวเองของ tools/check-email-auth.mjs
 * สร้างอีเมลที่เซ็น DKIM จริงด้วยกุญแจที่สร้างใหม่ → ต้องตรวจผ่าน
 * แล้วแก้เนื้อหา 1 จุด → ต้องตรวจไม่ผ่าน (พิสูจน์ว่าเครื่องมือจับการปลอมได้)
 * รัน: node tools/selftest-email-auth.mjs   (รันอัตโนมัติใน `node test.mjs` ด้วย)
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));   // = shop/tools
const SHOP = path.join(HERE, "..");
const TOOL = path.join(HERE, "check-email-auth.mjs");
// เขียนไฟล์ชั่วคราวนอกโปรเจกต์ เพื่อไม่ให้ artifact ของเทสต์หลุดเข้า commit
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dkim-selftest-"));

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const keyFile = path.join(TMP, "test-dkim-public.pem");
fs.writeFileSync(keyFile, publicKey.export({ type: "spki", format: "pem" }));

const enc = (s) => Buffer.from(s, "utf8").toString("latin1");   // string → ข้อความแบบรักษาไบต์
const rel = (v) => v.replace(/\r?\n/g, "").replace(/[ \t]+/g, " ").trim();
const canonBodyOf = (b) => {
  const lines = b.split(/\r?\n/).map((l) => l.replace(/[ \t]+$/, "").replace(/[ \t]+/g, " "));
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.length ? lines.join("\r\n") + "\r\n" : "";
};

const body = enc("สวัสดีครับ 👋\r\nนี่คืออีเมลทดสอบ DMARC\r\n\r\nบรรทัดที่ 3\r\n");
const bh = crypto.createHash("sha256").update(Buffer.from(canonBodyOf(body), "latin1")).digest("base64");

const baseHeaders = [
  ["From", enc("100 Prompt ก๊อปวาง <no-reply@kopwang.com>")],
  ["To", "owner@kopwang.com"],
  ["Subject", enc("ทดสอบ DMARC จากร้าน")],
  ["Date", "Thu, 16 Oct 2026 09:00:00 +0700"],
];
const signedNames = ["from", "to", "subject", "date"];
const dkimNoB = `v=1; a=rsa-sha256; c=relaxed/relaxed; d=kopwang.com; s=resend; t=1760000000; h=${signedNames.join(":")}; bh=${bh}; b=`;

let toSign = "";
for (const [n, v] of baseHeaders) toSign += `${n.toLowerCase()}:${rel(v)}\r\n`;
toSign += `dkim-signature:${rel(dkimNoB)}\r\n`;
const sig = crypto.sign("sha256", Buffer.from(toSign, "latin1"), privateKey).toString("base64");

const message = [
  ...baseHeaders.map(([n, v]) => `${n}: ${v}`),
  `DKIM-Signature: ${dkimNoB}${sig}`,
  "Authentication-Results: mx.google.com; dkim=pass header.i=@kopwang.com header.s=resend; spf=pass smtp.domain of send.kopwang.com; dmarc=pass (p=NONE) header.from=kopwang.com",
  "Return-Path: <bounce@send.kopwang.com>",
  "",
  body,
].join("\r\n");

const good = path.join(TMP, "test-good.eml");
const bad = path.join(TMP, "test-tampered.eml");
fs.writeFileSync(good, Buffer.from(message, "latin1"));
// ⚠️ ต้องค้น/แทนด้วยรูป “แบบไบต์” (enc) ไม่ใช่สตริงไทย เพราะตัวข้อความถูกแปลงเป็น latin1 ไปแล้ว
const tampered = message.replace(enc("นี่คืออีเมลทดสอบ DMARC"), enc("นี่คืออีเมลปลอมที่ถูกแกะ"));
if (tampered === message) { console.log("❌ ชุดทดสอบแก้ข้อความไม่สำเร็จ (เทสต์จะไม่มีความหมาย)"); process.exit(1); }
fs.writeFileSync(bad, Buffer.from(tampered, "latin1"));

let fails = 0;
const run = (file) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [TOOL, file, "--key", keyFile], { encoding: "utf8" }) };
  } catch (e) {
    return { code: e.status, out: (e.stdout || "") + (e.stderr || "") };
  }
};

console.log("--- 1) อีเมลที่เซ็นถูกต้อง (ต้องผ่าน) ---");
const a = run(good);
console.log(a.out.trim());
if (a.code !== 0) { console.log("❌ ควรผ่านแต่ไม่ผ่าน"); fails++; }
if (!/ลายเซ็น \(b\)\s*: OK/.test(a.out)) { console.log("❌ ไม่ได้รายงานว่าลายเซ็น OK"); fails++; }
if (!/body hash \(bh\)\s*: OK/.test(a.out)) { console.log("❌ ไม่ได้รายงานว่า body hash OK"); fails++; }

console.log("\n--- 2) แก้เนื้อหา 1 จุด (ต้องไม่ผ่าน) ---");
const b = run(bad);
console.log(b.out.trim());
if (b.code === 0) { console.log("❌ เนื้อหาถูกแก้แล้วยังตรวจผ่าน — เครื่องมือเชื่อถือไม่ได้"); fails++; }

console.log(`\nSELFTEST: ${fails ? "FAIL" : "OK"}`);
process.exit(fails ? 1 : 0);
