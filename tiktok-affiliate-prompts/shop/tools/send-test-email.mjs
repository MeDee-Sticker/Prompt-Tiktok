/**
 * send-test-email.mjs — ส่ง “อีเมลทดสอบจริง” 1 ฉบับผ่าน Resend เพื่อเอาไว้ตรวจ SPF/DKIM/DMARC
 * (ใช้กุญแจของร้านจากไฟล์ .secrets/ — ไม่พิมพ์ค่าคีย์ออกจอเลย)
 *
 * วิธีใช้:
 *   node tools/send-test-email.mjs                      # ส่งเข้ากล่องร้าน (NOTIFY_EMAIL)
 *   node tools/send-test-email.mjs --to you@gmail.com   # ส่งไปอีเมลอื่นที่ระบุ
 *   node tools/send-test-email.mjs --key-file .secrets/RESEND_API_KEY --from-file .secrets/MAIL_FROM
 *   node tools/send-test-email.mjs --id 01a1424c-…            # ดูสถานะการส่งของฉบับที่ส่งไปแล้ว (ไม่ส่งซ้ำ)
 *
 * หลังส่ง: เปิดอีเมลนั้น → “แสดงต้นฉบับ / Show original” → บันทึกเป็นไฟล์ → ตรวจด้วย
 *   node tools/check-email-auth.mjs received.eml
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOP = path.join(HERE, "..");
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const readFileOrEnv = (file, envName) => {
  if (envName && process.env[envName]) return process.env[envName].trim();
  const p = path.join(SHOP, file);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8").trim() : "";
};

const key = flag("key-file") ? fs.readFileSync(path.join(SHOP, flag("key-file")), "utf8").trim() : readFileOrEnv(".secrets/RESEND_API_KEY", "RESEND_API_KEY");
const from = flag("from") || readFileOrEnv(".secrets/MAIL_FROM", "MAIL_FROM") || "100 Prompt ก๊อปวาง <onboarding@resend.dev>";
const to = flag("to") || readFileOrEnv(".secrets/NOTIFY_EMAIL", "NOTIFY_EMAIL");
const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);

if (!key) { console.error("ไม่พบคีย์ Resend (หา .secrets/RESEND_API_KEY หรือ env RESEND_API_KEY)"); process.exit(2); }
if (!to) { console.error("ไม่พบอีเมลปลายทาง (ใส่ --to=… หรือไฟล์ .secrets/NOTIFY_EMAIL)"); process.exit(2); }

const html = `<!doctype html><html lang="th"><body style="font-family:'Sarabun',Arial,sans-serif;padding:24px;color:#1B1B1F">
  <h1 style="font-size:20px;margin:0 0 8px">ทดสอบ DMARC ของร้าน 🧪</h1>
  <p style="color:#7A7A85;font-size:14px;margin:0 0 16px">ส่งเมื่อ ${stamp} UTC · ฉบับนี้ใช้ตรวจ SPF/DKIM/DMARC เท่านั้น</p>
  <p style="font-size:14px;line-height:1.8">วิธีตรวจ: เปิดอีเมลนี้ → เมนู ⋮ → <b>“แสดงต้นฉบับ / Show original”</b> → ดาวน์โหลดเป็นไฟล์ → รัน<br>
  <code>node tools/check-email-auth.mjs received.eml</code></p>
  <p style="font-size:13px;color:#7A7A85;line-height:1.8">สิ่งที่ต้องเห็น: <code>dkim=pass</code> (d=kopwang.com) · <code>spf=pass</code> · <code>dmarc=pass</code><br>
  ถ้าเห็น <code>dmarc=fail</code> หรือ <code>dkim=fail</code> ให้แจ้งกลับพร้อมไฟล์ต้นฉบับ</p>
</body></html>`;

async function statusOf(id) {
  const s = await fetch(`https://api.resend.com/emails/${id}`, { headers: { authorization: `Bearer ${key}` } });
  const d = await s.json().catch(() => ({}));
  return { code: s.status, event: d.last_event || null };
}

const onlyId = flag("id");
let id = onlyId;
if (!onlyId) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject: `ทดสอบ DMARC ของร้าน — ${stamp} UTC`, html }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) { console.error(`❌ ส่งไม่สำเร็จ: resend ${r.status} — ${out.message || JSON.stringify(out)}`); process.exit(1); }
  id = out.id;
  console.log(`✅ ส่งแล้ว: id=${id}`);
  console.log(`   from: ${from}`);
  console.log(`   to  : ${to}`);
} else {
  console.log(`ℹ️  ดูสถานะของ id=${id} (ไม่ได้ส่งฉบับใหม่)`);
}

// ถามสถานะการส่งของจริงจาก Resend (delivered / bounced) — ถ้าคีย์เป็นแบบ “ส่งอย่างเดียว” จะอ่านไม่ได้ (401)
let limited = false;
for (let i = 0; i < 6; i++) {
  const st = await statusOf(id);
  if (st.code === 401 || st.code === 403) { limited = true; break; }
  console.log(`   สถานะ (${(i + 1) * 4}s): ${st.event || `http ${st.code}`}`);
  if (st.event && ["delivered", "bounced", "complained", "failed"].includes(st.event)) break;
  if (i < 5) await new Promise((res) => setTimeout(res, 4000));
}
if (limited) {
  console.log("   ℹ️ อ่านสถานะไม่ได้เพราะคีย์นี้เป็นแบบ “ส่งอย่างเดียว” (ส่งอย่างเดียวมักปลอดภัยกว่า) — ไม่ใช่การส่งล้มเหลว");
  console.log("      อยากดูสถานะ delivered/bounced: เปิดที่ resend.com → Emails หรือใช้คีย์แบบเต็มสิทธิ์");
}
console.log(`\nต่อไป: เปิดอีเมลในกล่อง → “แสดงต้นฉบับ” → บันทึกเป็น received.eml → node tools/check-email-auth.mjs received.eml`);
