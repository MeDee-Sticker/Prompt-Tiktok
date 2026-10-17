/**
 * check-email-auth.mjs — ตรวจว่า “อีเมลจริงที่ส่งถึงปลายทาง” ผ่าน SPF/DKIM/DMARC จริงหรือไม่
 *
 * ต่างจาก `dig` ตรงที่ตัวนี้ตรวจจาก **ตัวอีเมลที่ได้รับ** (Show original / Download original)
 * และ **ถอดลายเซ็น DKIM เองจริง** ด้วยกุญแจสาธารณะจาก DNS — ไม่เชื่อแค่ข้อความ Authentication-Results
 *
 * วิธีใช้:
 *   node tools/check-email-auth.mjs received.eml
 *   cat received.eml | node tools/check-email-auth.mjs -
 *   node tools/check-email-auth.mjs received.eml --key resend-key.pem      # ใช้กุญแจจากไฟล์แทน DNS
 *
 * ผลลัพธ์: ตารางสรุป + ค่า RESULT: PASS/FAIL · exit code 0 = ผ่าน (dmarc ผ่านด้วย SPF หรือ DKIM ที่ align กับ From)
 */
import fs from "node:fs";
import crypto from "node:crypto";

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const FILE = args.find((a) => !a.startsWith("--")) || "-";
const KEY_FILE = flag("key");
const DOH = flag("doh", "https://dns.google/resolve");

/* ---------- อ่านข้อความดิบแบบไบต์ตรง (ใช้ latin1 เพื่อไม่ให้ไบต์เพี้ยน) ---------- */
const HOWTO = `
วิธีเอาไฟล์ต้นฉบับ (received.eml):
  1) เปิดอีเมลนั้นในกล่องจดหมาย → เมนู ⋮ / มุมขวา → “แสดงต้นฉบับ / Show original”
  2) กด “ดาวน์โหลดต้นฉบับ / Download original” (ได้ไฟล์ .eml) แล้ววางไฟล์ไว้ที่โฟลเดอร์ shop/
     (หรือรันจากที่อยู่ไฟล์นั้น: node tools/check-email-auth.mjs ~/Downloads/received.eml)
  3) ไม่มีไฟล์ก็ได้ — ส่งเนื้อหาต้นฉบับเข้าทาง stdin:  pbpaste | node tools/check-email-auth.mjs -

ทางเลือกอื่น: เชื่อม Gmail กับผู้ช่วย แล้วดึงต้นฉบับมาตรวจให้ได้เลย
`;
let rawBytes;
try {
  rawBytes = FILE === "-" ? fs.readFileSync(0) : fs.readFileSync(FILE);
} catch (e) {
  console.error(`❌ อ่านไฟล์ไม่ได้: ${FILE} (${e.code || e.message})`);
  console.error(HOWTO);
  process.exit(2);
}
if (!rawBytes.length) {
  console.error("❌ ไม่มีข้อมูลเข้ามา (ไฟล์หรือ stdin ว่างเปล่า)");
  console.error(HOWTO);
  process.exit(2);
}
const raw = rawBytes.toString("latin1");
const sep = raw.indexOf("\r\n\r\n") >= 0 ? "\r\n\r\n" : "\n\n";
const splitAt = raw.indexOf(sep);
const headerBlock = splitAt < 0 ? raw : raw.slice(0, splitAt);
const bodyRaw = splitAt < 0 ? "" : raw.slice(splitAt + sep.length);

/** แยก header เป็น [{name, raw (มี folding), value}] — คงบรรทัดเดิมไว้ */
function parseHeaders(block) {
  const out = [];
  const lines = block.split(/\r?\n/);
  for (const line of lines) {
    if (/^[ \t]/.test(line) && out.length) {
      out[out.length - 1].raw += "\r\n" + line;
      out[out.length - 1].value += "\r\n" + line;
    } else {
      const i = line.indexOf(":");
      if (i < 0) continue;
      out.push({ name: line.slice(0, i).trim(), raw: line, value: line.slice(i + 1).replace(/^\s*/, "") });
    }
  }
  return out;
}
const headers = parseHeaders(headerBlock);
const get = (name) => headers.filter((h) => h.name.toLowerCase() === name.toLowerCase()).map((h) => h.value);
const first = (name) => get(name)[0] || "";
/** แสดงผลให้อ่านออก (ข้อความถูกอ่านเป็นไบต์ latin1 ตอนตรวจลายเซ็น) */
const show = (s) => new TextDecoder("utf-8", { fatal: false }).decode(Buffer.from(s, "latin1"));

/* ---------- canonicalization (RFC 6376 §3.4) ---------- */
const relHeaderValue = (v) => v.replace(/\r?\n/g, "").replace(/[ \t]+/g, " ").trim();
const relBody = (b) => {
  if (!b) return "";
  const lines = b.split(/\r?\n/).map((l) => l.replace(/[ \t]+$/, "").replace(/[ \t]+/g, " "));
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.length ? lines.join("\r\n") + "\r\n" : "";
};
const canonBody = (b, c) => (c === "simple" ? (b.endsWith("\r\n") || !b ? b : b + "\r\n") : relBody(b));
const bytes = (s) => Buffer.from(s, "latin1");

/* ---------- อ่าน DKIM-Signature ---------- */
function parseTagList(s) {
  const tags = {};
  for (const part of s.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    tags[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).replace(/\s+/g, "");
  }
  return tags;
}
/** ตัดค่า b= ออก (ใช้ตอนตรวจลายเซ็น) — คงรูป header เดิมไว้ */
function stripB(value) {
  return value.replace(/(\bb\s*=\s*)([A-Za-z0-9+/=\s]+)/, (m, p1) => p1);
}

/* ---------- DNS: กุญแจสาธารณะจาก TXT ของ selector._domainkey.domain ---------- */
const dnsCache = new Map();
async function fetchDkimKey(selector, domain) {
  const q = `${selector}._domainkey.${domain}`;
  if (dnsCache.has(q)) return dnsCache.get(q);
  const r = await fetch(`${DOH}?name=${encodeURIComponent(q)}&type=TXT`);
  const data = await r.json();
  const txt = (data.Answer || [])
    .filter((a) => a.type === 16)
    .map((a) => String(a.data).replace(/^"|"$/g, "").replace(/"\s+"/g, ""))
    .join("");
  const tags = parseTagList(txt);
  const out = tags.p ? tags : { error: `ไม่พบเรคคอร์ด ${q}` };
  dnsCache.set(q, out);
  return out;
}
const toPem = (b64) => `-----BEGIN PUBLIC KEY-----\n${b64.replace(/\s+/g, "").replace(/(.{64})/g, "$1\n").trim()}\n-----END PUBLIC KEY-----\n`;

/* ---------- ตรวจลายเซ็น DKIM 1 อัน ---------- */
async function verifyDkim(h) {
  const tags = parseTagList(h.value.replace(/\r?\n/g, ""));
  const hashAlg = (tags.a || "rsa-sha256").split("-").pop();       // sha256 | sha1
  const keyAlg = (tags.a || "rsa-sha256").split("-")[0];           // rsa | ed25519
  const [hc, bc] = (tags.c || "simple/simple").split("/");
  const signedNames = (tags.h || "").split(":").map((x) => x.trim().toLowerCase()).filter(Boolean);

  // 1) body hash
  const bhCalc = crypto.createHash(hashAlg).update(bytes(canonBody(bodyRaw, bc))).digest("base64");
  const bodyOk = bhCalc === (tags.bh || "");

  // 2) สร้างข้อมูลที่ถูกเซ็น
  const picked = [];
  const pool = headers.slice();
  for (const n of signedNames) {
    const idx = pool.findIndex((x) => x.name.toLowerCase() === n);
    if (idx < 0) continue;
    picked.push(pool.splice(idx, 1)[0]);
  }
  const sigValue = stripB(h.value);
  let signed = "";
  for (const p of picked) {
    signed += hc === "relaxed" ? `${p.name.toLowerCase()}:${relHeaderValue(p.value)}\r\n` : `${p.raw.replace(/\r?\n$/, "")}\r\n`;
  }
  // header DKIM-Signature ที่เซ็น (ใช้ค่าเดิมของเรา ไม่ใช่ของปลายทาง)
  signed += hc === "relaxed"
    ? `dkim-signature:${relHeaderValue(sigValue)}\r\n`
    : `DKIM-Signature:${sigValue.replace(/^[^:]*:\s*/, "")}\r\n`;

  // 3) กุญแจ
  let keyPem = null;
  if (KEY_FILE) keyPem = fs.readFileSync(KEY_FILE, "utf8");
  else {
    const k = await fetchDkimKey(tags.s, tags.d);
    if (k.error) return { tags, bodyOk, sigOk: false, error: k.error };
    keyPem = toPem(k.p);
  }

  // 4) ตรวจลายเซ็น
  let sigOk = false, error = null;
  try {
    const key = crypto.createPublicKey(keyPem);
    const sig = Buffer.from(tags.b || "", "base64");
    if (keyAlg === "ed25519") sigOk = crypto.verify(null, bytes(signed), key, sig);
    else sigOk = crypto.createVerify(hashAlg).update(bytes(signed)).verify(key, sig);
  } catch (e) { error = String(e.message || e); }

  return { tags, bodyOk, sigOk, signedBytes: signed.length, error };
}

/* ---------- อ่านผลที่ปลายทางรายงาน ---------- */
const authResults = get("Authentication-Results").join(" | ");
const arOf = (mech) => {
  const m = authResults.match(new RegExp(`${mech}=([a-z]+)`, "i"));
  return m ? m[1].toLowerCase() : null;
};
const arDetail = (mech) => {
  const m = authResults.match(new RegExp(`${mech}=([^;]+)`, "i"));
  return m ? m[1].trim() : "";
};
const fromAddr = (first("From").match(/<([^>]+)>/) || [, first("From")])[1] || "";
const fromDomain = (fromAddr.split("@")[1] || "").toLowerCase();
const returnPath = (first("Return-Path").match(/<([^>]+)>/) || [, first("Return-Path")])[1] || "";
const rpDomain = (returnPath.split("@")[1] || "").toLowerCase();
const TWO_LEVEL = new Set(["co.th", "co.uk", "com.au", "co.jp", "com.br", "co.in", "or.th", "ac.th", "in.th"]);
const orgDomain = (d) => {
  const p = String(d).toLowerCase().split(".").filter(Boolean);
  if (p.length <= 2) return p.join(".");
  const last2 = p.slice(-2).join(".");
  return TWO_LEVEL.has(last2) ? p.slice(-3).join(".") : last2;
};
const aligns = (a, b) => !!a && !!b && (a === b || orgDomain(a) === orgDomain(b));

// ต้องใช้ “ทั้ง header” (มีค่ำดิบสำหรับ canonicalization) ไม่ใช่แค่ค่า
const dkimSigs = headers.filter((h) => h.name.toLowerCase() === "dkim-signature");
// เตือนถ้าหน้าตาไม่เหมือนอีเมลต้นฉบับ (เช่นไปก๊อปเฉพาะบางส่วนมา)
const looksRaw = headers.some((h) => /^(from|dkim-signature|authentication-results|received|return-path)$/i.test(h.name));
if (!looksRaw) {
  console.error("⚠️ ไฟล์นี้ไม่มีหัว From / DKIM-Signature / Authentication-Results — ดูเหมือนไม่ใช่ต้นฉบับอีเมลเต็มฉบับ");
  console.error(HOWTO);
}
console.log(`\n=== ตรวจอีเมล: ${FILE === "-" ? "(stdin)" : FILE} — ${rawBytes.length} ไบต์ ===`);
console.log(`จาก (From)        : ${show(fromAddr) || "-"}`);
console.log(`Return-Path       : ${returnPath || "-"}`);
console.log(`หัวเรื่อง          : ${show(first("Subject")).slice(0, 80) || "-"}`);
console.log(`วันที่             : ${first("Date") || "-"}`);
console.log(`\nAuthentication-Results ของปลายทาง:\n  ${authResults || "(ไม่มี — ผู้ให้บริการเมลนั้นไม่ได้ใส่หัวนี้)"}`);
console.log(`  spf=${arOf("spf") || "-"} · dkim=${arOf("dkim") || "-"} · dmarc=${arOf("dmarc") || "-"}`);

const results = [];
for (const h of dkimSigs) {
  const r = await verifyDkim(h);
  results.push(r);
  console.log(`\nDKIM-Signature: d=${r.tags.d} s=${r.tags.s} a=${r.tags.a} c=${r.tags.c}${r.tags.i ? ` i=${r.tags.i}` : ""}`);
  console.log(`  body hash (bh)  : ${r.bodyOk ? "OK" : "FAIL"}${r.error ? ` · ${r.error}` : ""}`);
  console.log(`  ลายเซ็น (b)     : ${r.sigOk ? "OK (ถอดลายเซ็นด้วยกุญแจจาก " + (KEY_FILE ? "ไฟล์" : "DNS") + " สำเร็จ)" : "FAIL"}`);
}

let dkimAligned = false;
for (const r of results) {
  if (r.sigOk && r.bodyOk && aligns(r.tags.d, fromDomain)) dkimAligned = true;
}
const spfPass = arOf("spf") === "pass";
const spfAligned = spfPass && aligns(rpDomain, fromDomain);
const reportedDmarc = arOf("dmarc");
const dmarcImplied = dkimAligned || spfAligned;

// เกณฑ์ตัดสิน: ถ้าอีเมลมี DKIM-Signature → ใช้ผลถอดลายเซ็นของเราเป็นตัวตัดสิน (เชื่อถือได้)
// เพราะหัว Authentication-Results ที่แนบมากับข้อความอาจถูกก๊อป/ปลอมได้
const verifyWarning = [];
let pass, decidedBy;
if (results.length) {
  pass = dkimAligned && reportedDmarc !== "fail";
  decidedBy = dkimAligned ? "ลายเซ็น DKIM ที่ถอดเองได้ + align กับ From" : "DKIM ที่มีในอีเมลถอดลายเซ็นไม่ผ่าน";
  if (!dkimAligned) verifyWarning.push("มี DKIM-Signature แต่ถอดลายเซ็น/ตรวจ body hash ไม่ผ่าน → ข้อความอาจถูกแก้ระหว่างทางหรือกุญแจไม่ตรง");
  if (arOf("dkim") === "pass" && !dkimAligned) verifyWarning.push("หัว Authentication-Results อ้างว่า dkim=pass แต่ตรวจเองไม่ผ่าน — อย่าเชื่อหัวนั้น");
  if (reportedDmarc === "fail" && dkimAligned) verifyWarning.push("ปลายทางรายงาน dmarc=fail ทั้งที่ลายเซ็น DKIM ของเราผ่าน — น่าตรวจสอบที่ปลายทาง");
} else {
  pass = spfAligned && reportedDmarc !== "fail";
  decidedBy = "ไม่มี DKIM ในอีเมลนี้ → ตัดสินจาก SPF ที่ปลายทางรายงาน (ตรวจเองไม่ได้)";
  if (pass) verifyWarning.push("อีเมลนี้ไม่มี DKIM-Signature — ผล SPF/DMARC อ้างอิงจากหัวที่ปลายทางใส่ให้เท่านั้น");
}

console.log(`\nสรุป:`);
console.log(`  DKIM ผ่าน + align กับ ${fromDomain || "From"} : ${dkimAligned ? "ใช่ (ตรวจลายเซ็นเองแล้ว)" : "ไม่"}`);
console.log(`  SPF ผ่าน + align                            : ${spfAligned ? `ใช่ (Return-Path ${rpDomain})` : `ไม่ (spf=${arOf("spf") || "-"} · Return-Path ${rpDomain || "-"})`}`);
console.log(`  DMARC ที่ปลายทางรายงาน                      : ${reportedDmarc || "-"} ${arDetail("dmarc") ? `(${arDetail("dmarc")})` : ""}`);
console.log(`  DMARC ควรจะผ่านตามหลัก (SPF หรือ DKIM align) : ${dmarcImplied ? "ใช่" : "ไม่"}`);

console.log(`\nตัดสินด้วย: ${decidedBy}`);
for (const w of verifyWarning) console.log(`  ⚠ ${w}`);
console.log(`\nRESULT: ${pass ? "PASS" : "FAIL"}\n`);
process.exit(pass ? 0 : 1);
