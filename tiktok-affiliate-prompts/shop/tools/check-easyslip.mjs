/**
 * check-easyslip.mjs — ตรวจ “คีย์ตรวจสลิปอัตโนมัติ” (EasySlip v2) ก่อนเปิดขายจริง
 * (อ่านคีย์จากไฟล์ .secrets/ หรือ env — **ไม่พิมพ์คีย์ออกจอเลย** พิมพ์แค่ hash สั้น ๆ)
 *
 * 2 โหมด:
 *   1) ตรวจคีย์ + โควตา/สถานะสาขา — **ไม่กินโควตา** (GET /v2/info)
 *        node tools/check-easyslip.mjs
 *   2) ทดสอบ “สลิปจริง 1 ใบ” → ดูว่าร้านจะอนุมัติอัตโนมัติให้หรือไม่ — **กินโควตา 1 ครั้ง** (POST /v2/verify/bank)
 *        node tools/check-easyslip.mjs --slip ~/Downloads/slip.jpg
 *        node tools/check-easyslip.mjs --payload '00020101021229370016A000000677010111…'
 *
 * ตัวเลือก: --key-file .secrets/EASYSLIP_API_KEY · --amount 99 · --no-match-account · --json
 * (env `EASYSLIP_BASE` = ใช้เฉพาะเวลาทดสอบกับ mock server ห้ามตั้งตอนใช้จริง)
 * exit code: 0 = ใช้ได้ · 1 = คีย์ผิด/ถูกระงับ หรือสลิปไม่ผ่าน · 2 = ยังไม่มีคีย์/ใช้คำสั่งไม่ครบ
 *
 * เอกสาร: https://document.easyslip.com/en/v2/info · https://document.easyslip.com/en/v2/verify/bank/
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { parsePromptPayOptions, slipReceiverMatches } from "../promptpay.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOP = path.join(HERE, "..");
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`) || args.some((a) => a.startsWith(`--${name}=`));

// EASYSLIP_BASE มีไว้สำหรับทดสอบเท่านั้น (ชี้ไป mock server ในเครื่อง) — ปกติไม่ต้องตั้ง
const BASE = (process.env.EASYSLIP_BASE || "https://api.easyslip.com/v2").replace(/\/+$/, "");
const INFO_URL = `${BASE}/info`;
const VERIFY_URL = `${BASE}/verify/bank`;

/* ---------- อ่านค่าตั้งของร้าน (อ่านอย่างเดียว ไม่แก้ไฟล์) ---------- */
function devVar(name) {
  try {
    const m = fs.readFileSync(path.join(SHOP, ".dev.vars"), "utf8").match(new RegExp(`^\\s*${name}\\s*=\\s*"?([^"\\n]*)"?`, "m"));
    return m ? m[1].trim() : "";
  } catch {
    return "";
  }
}
const amountTHB = Number(flag("amount") || (Number(devVar("PRICE_SATANG") || 9900) / 100).toFixed(2));
const matchAccount = !has("no-match-account") && devVar("SLIP_MATCH_ACCOUNT") !== "0";
const matchAmountOn = devVar("SLIP_MATCH_AMOUNT") !== "0";
const shopRaw = devVar("PROMPTPAY_OPTIONS") || devVar("PROMPTPAY_ID");
const shopOptions = shopRaw.split(",").map((s) => s.trim()).filter(Boolean);
// ช่องทางที่ตีความแล้ว (ใช้ตัดสินแบบเดียวกับ worker.js — รวมกรณีสลิปปิดเลขผู้รับ)
const shopChannels = parsePromptPayOptions(shopRaw, devVar("PROMPTPAY_BANK"));

/* ---------- คีย์ ---------- */
const keyFile = flag("key-file", ".secrets/EASYSLIP_API_KEY");
const key = process.env.EASYSLIP_API_KEY?.trim() || (fs.existsSync(path.join(SHOP, keyFile)) ? fs.readFileSync(path.join(SHOP, keyFile), "utf8").trim() : "");
const tag = key ? crypto.createHash("sha256").update(key).digest("hex").slice(0, 8) : "";

if (!key) {
  console.error("❌ ยังไม่มีคีย์ตรวจสลิปอัตโนมัติ");
  console.error(`   หาไม่เจอทั้งไฟล์ ${keyFile} และ env EASYSLIP_API_KEY (ไฟล์ .secrets/ ถูก gitignore — ไม่มีทางหลุดขึ้น git)`);
  console.error("   วิธีได้คีย์: สมัคร https://easyslip.com → สร้าง application → คัดลอก API key → บันทึกเป็นไฟล์ .secrets/EASYSLIP_API_KEY");
  console.error("   แล้วรันซ้ำ: node tools/check-easyslip.mjs");
  process.exit(2);
}
const auth = { authorization: `Bearer ${key}` };

/* ---------- ปิดบังค่าที่ไม่ควรโชว์ ---------- */
const maskRedact = (v) => (typeof v === "string" && v.length > 12 ? v.slice(0, 4) + "…" + v.slice(-4) : "…");
function redact(obj, depth = 0) {
  if (Array.isArray(obj)) return obj.map((v) => redact(v, depth + 1));
  if (obj && typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = /key|token|secret|authorization|password|api/i.test(k) ? maskRedact(v) : redact(v, depth + 1);
    return out;
  }
  return obj;
}
/* หาโควตา/สาขาจากโครง response ที่อาจต่างไปตามเวอร์ชัน (ไม่ผูกกับชื่อฟิลด์เดียว) */
function findQuota(node) {
  if (!node || typeof node !== "object") return null;
  for (const v of Object.values(node)) {
    if (v && typeof v === "object" && !Array.isArray(v) && ["used", "max", "remaining", "quota"].some((k) => k in v) && ("used" in v || "remaining" in v)) return v;
    const deep = findQuota(v);
    if (deep) return deep;
  }
  return null;
}
function findBranch(node) {
  if (!node || typeof node !== "object") return null;
  for (const [k, v] of Object.entries(node)) {
    if (v && typeof v === "object" && !Array.isArray(v) && ("isActive" in v || "name" in v) && k.toLowerCase().includes("branch")) return v;
    const deep = findBranch(v);
    if (deep) return deep;
  }
  return null;
}

/* ---------- แปลผล error ตามเอกสาร EasySlip (แยก “คีย์ผิด” ออกจาก “คีย์ดีแต่ถูกระงับ”) ---------- */
const BLOCKED = /BRANCH_INACTIVE|IP_NOT_ALLOWED|SERVICE_BANNED|SERVICE_DELETED|USER_BANNED|QUOTA_EXCEEDED/;
function classify(status, body) {
  const code = String(body?.error?.code || body?.code || "");
  const message = String(body?.error?.message || body?.message || "");
  if (status === 200 && body?.success !== false) return { ok: true, code, message };
  if (status === 401) return { ok: false, fatal: true, code, message, why: "คีย์ผิด/ไม่มีคีย์ (401)" };
  if (status === 403) return { ok: false, fatal: true, code, message, why: `คีย์ถูกต้อง แต่ถูกระงับ/หมดโควตา (403${code ? " " + code : ""})` };
  return { ok: false, fatal: false, code, message, why: `ตอบกลับผิดคาด (HTTP ${status}${code ? " " + code : ""})` };
}

/* ---------- โหมด 1: ตรวจคีย์ + โควตา (ฟรี) ---------- */
async function showInfo() {
  let r, body;
  try {
    r = await fetch(INFO_URL, { headers: auth });
    body = await r.json().catch(() => ({}));
  } catch (e) {
    console.error(`❌ ต่อ api.easyslip.com ไม่ได้: ${e.message}`);
    console.error("   ถ้าอยู่ในแซนด์บ็อกซ์ที่ไม่มีเน็ตออก ให้รันบนเครื่องตัวเอง หรือข้ามไปตั้งคีย์ที่ Sites → Secrets แล้วเช็กด้วย GET /api/health");
    process.exit(1);
  }
  const verdict = classify(r.status, body);
  console.log(`EasySlip — ตรวจคีย์ (GET /v2/info) · คีย์ …${tag} · HTTP ${r.status}`);
  if (!verdict.ok) {
    console.error(`❌ ${verdict.why}${verdict.code ? ` · code=${verdict.code}` : ""}${verdict.message ? ` · ${verdict.message}` : ""}`);
    if (verdict.code === "QUOTA_EXCEEDED" || /QUOTA_EXCEEDED/.test(verdict.code)) console.error("   → เติมโควตา/อัปเกรดแพ็ก หรือปิด AUTO_APPROVE=0 แล้วตรวจสลิปเองที่หลังบ้าน (การขายไม่พัง)");
    if (verdict.code === "BRANCH_INACTIVE" || /BANNED|DELETED/.test(verdict.code)) console.error("   → ตรวจสถานะ application/branch ในหน้าเว็บ EasySlip");
    console.error(`   (โหมดตรวจเองยังทำงานได้: ไม่มีคีย์ = ออเดอร์ค้างที่ reported ให้แอดมินกดอนุมัติ)`);
    process.exit(1);
  }
  const q = findQuota(body.data || body);
  const br = findBranch(body.data || body);
  console.log("✅ คีย์ผ่าน — EasySlip ตอบรับคำขอ");
  if (br) console.log(`   สาขา: ${br.name || br.id || "-"}${"isActive" in br ? ` · isActive=${br.isActive}` : ""}`);
  if (q) {
    const used = q.used ?? q.usage ?? "-", max = q.max ?? q.limit ?? "-", left = q.remaining ?? (Number(max) - Number(used) >= 0 ? Number(max) - Number(used) : "-");
    console.log(`   โควตา: ใช้ไป ${used} / ${max} · เหลือ ${left}`);
  }
  console.log(`   ช่องทางรับเงินของร้าน: ${shopOptions.length} ช่องทาง (${shopOptions.join(", ")}) · matchAmount=${matchAmountOn ? amountTHB.toFixed(2) : "ปิด"} · matchAccount=${matchAccount ? "เปิด" : "ปิด"}`);
  if (has("json")) console.log(JSON.stringify(redact(body), null, 2));
  console.log("\nโหมด 2 (กินโควตา 1 ครั้ง): ทดสอบสลิปจริง → node tools/check-easyslip.mjs --slip ~/Downloads/slip.jpg");
  process.exit(0);
}

/* ---------- โหมด 2: ทดสอบสลิป/QR จริง (กินโควตา 1 ครั้ง) ---------- */
async function showVerify() {
  const slipFile = flag("slip");
  const payload = flag("payload");
  if (!slipFile && !payload) {
    console.error("❌ ต้องระบุ --slip <ไฟล์รูปสลิป> หรือ --payload '<ข้อความ QR จากสลิป>'");
    process.exit(2);
  }
  let body, mode;
  if (slipFile) {
    const p = slipFile.startsWith("/") ? slipFile : path.join(process.cwd(), slipFile);
    if (!fs.existsSync(p)) { console.error(`❌ ไม่พบไฟล์สลิป: ${p}`); process.exit(2); }
    const ext = (p.split(".").pop() || "jpg").toLowerCase();
    const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    const fd = new FormData();
    fd.append("image", new Blob([fs.readFileSync(p)], { type: mime }), `slip.${ext}`);
    fd.append("checkDuplicate", "true");
    if (matchAccount) fd.append("matchAccount", "true");
    if (matchAmountOn) fd.append("matchAmount", String(amountTHB));
    body = fd;
    mode = "image";
  } else {
    body = JSON.stringify({
      payload: String(payload).slice(0, 128),
      checkDuplicate: true,
      ...(matchAccount ? { matchAccount: true } : {}),
      ...(matchAmountOn ? { matchAmount: amountTHB } : {}),
    });
    mode = "qr";
  }
  console.log(`EasySlip — ทดสอบสลิปจริง (${mode}) · คีย์ …${tag} · ยอดที่ให้ตรวจ ${amountTHB.toFixed(2)} บาท · checkDuplicate=true`);
  let r, res;
  try {
    r = await fetch(VERIFY_URL, {
      method: "POST",
      headers: mode === "qr" ? { ...auth, "content-type": "application/json" } : auth,
      body,
    });
    res = await r.json().catch(() => ({}));
  } catch (e) {
    console.error(`❌ ต่อ api.easyslip.com ไม่ได้: ${e.message}`);
    process.exit(1);
  }
  const verdict = classify(r.status, res);
  if (!verdict.ok) {
    console.error(`❌ ${verdict.why}${verdict.message ? ` · ${verdict.message}` : ""}`);
    if (/SLIP_NOT_FOUND/.test(verdict.code)) console.error("   → อ่านสลิปไม่ได้/ไม่พบ QR ในรูป — ถ่ายใหม่ให้เห็น QR ครบ หรือวาง --payload");
    if (/SLIP_PENDING/.test(verdict.code)) console.error("   → สลิปธนาคารนี้ยังไม่ขึ้นในระบบ — รอ ~1 นาทีแล้วลองใหม่");
    if (/INVALID_API_KEY/.test(verdict.code)) console.error("   → คีย์ผิด (ตรวจว่าคัดลอกครบ ไม่มีช่องว่างหัวท้าย)");
    process.exit(1);
  }

  /* ตัดสินแบบเดียวกับ worker.js: ยอดตรง · ผู้รับเป็นช่องทางร้าน · ไม่ซ้ำ · มีเลขอ้างอิง */
  const d = res.data || {};
  const got = Number(d.amountInSlip ?? d.amountInOrder ?? d.rawSlip?.amount?.amount ?? d.rawSlip?.amount?.local?.amount);
  const receiver = d.rawSlip?.receiver || d.receiver || {};
  const ref = d.rawSlip?.transRef || d.transRef || d.trans_ref || null;
  const matchedByConfig = slipReceiverMatches(receiver, shopChannels);
  const amountOk = Number.isFinite(got) && Math.abs(got - amountTHB) < 0.001;
  const nameOf = (n) => (n && typeof n === "object" ? n.th || n.en || "—" : n) || "—";
  const receiverName = nameOf(receiver.name) !== "—" ? nameOf(receiver.name) : nameOf(receiver.account?.name);
  const receiverNo = receiver.proxy?.account ?? receiver.proxy?.value ?? receiver.account?.proxy?.account ?? receiver.account?.bank?.account ?? "";

  console.log(`   ผลตรวจ: OK · ยอดในสลิป ${Number.isFinite(got) ? got.toFixed(2) : "อ่านไม่ได้"} · ผู้รับ ${receiverName} ${receiverNo ? `(${receiverNo})` : ""}`);
  console.log(`   สลิปซ้ำ: ${d.isDuplicate === true ? "ใช่ ⚠️" : "ไม่ใช่"} · เลขอ้างอิง: ${ref || "—"} · matchedAccount=${d.matchedAccount === true ? "true" : d.matchedAccount === false ? "false" : "—"} · isAmountMatched=${d.isAmountMatched ?? "—"}`);
  const blocks = [];
  if (d.isDuplicate === true) blocks.push("สลิปซ้ำ (isDuplicate)");
  if (!amountOk) blocks.push(`ยอดไม่ตรงกับ ${amountTHB.toFixed(2)}`);
  if (!ref) blocks.push("ไม่มีเลขอ้างอิงธุรกรรม");
  if (!matchedByConfig && !(Object.keys(receiver).length === 0 && d.matchedAccount === true)) blocks.push("ผู้รับไม่ตรงกับช่องทางรับเงินที่ตั้งไว้ (และผู้ให้บริการไม่ได้ยืนยันว่าเป็นบัญชีที่ลงทะเบียนไว้)");
  if (blocks.length) {
    console.log(`\n⚠️ ร้านจะยังไม่ “อนุมัติอัตโนมัติ” ให้สลิปใบนี้ เพราะ: ${blocks.join(" · ")}`);
    console.log("   ออเดอร์จะค้างที่ reported พร้อมเหตุผลให้กดอนุมัติเอง — ไม่ใช่การขายพัง");
    if (blocks.some((b) => b.startsWith("ผู้รับ"))) {
      console.log("   เช็ก 2 อย่าง: (1) เพิ่มบัญชีรับเงินของร้านในหน้าเว็บ EasySlip แล้วเปิด matchAccount (2) PROMPTPAY_OPTIONS ต้องมีช่องทางที่รับเงินจริง");
      console.log(`   ช่องทางที่รองรับตอนนี้: ${shopOptions.join(", ") || "(ยังไม่ได้ตั้ง)"}`);
    }
  } else {
    console.log(`\n✅ สลิปใบนี้ยืนยันครบทุกข้อ → ร้านจะอนุมัติเอง + ส่งลิงก์โหลดให้ลูกค้าทันที (AUTO_APPROVE=1)`);
  }
  if (has("json")) console.log(JSON.stringify(redact(res), null, 2));
  process.exit(blocks.length ? 1 : 0);
}

await (flag("slip") || flag("payload") ? showVerify() : showInfo());
