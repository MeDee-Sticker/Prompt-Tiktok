/**
 * สร้างหน้า build/scan-test.html — QR ยอด ฿1 ต่อช่องทางรับเงิน เพื่อให้เจ้าของร้านสแกนยืนยันด้วยแอปธนาคาร
 * ใช้ payload/SVG ตัวเดียวกับที่ worker ส่งให้ลูกค้าจริง (promptpay.mjs + qr.mjs)
 * รัน: node build/make-scan-test.mjs "1330500240201, 0880754039"
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPromptPayPayload, parsePromptPayOptions, inspectPayload } from "../promptpay.mjs";
import { qrSvg } from "../qr.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const raw = process.argv[2] || process.env.PROMPTPAY_OPTIONS || "";
const AMOUNT = 100; // สตางค์ → ฿1.00

const options = parsePromptPayOptions(raw, process.env.PROMPTPAY_BANK || "");
if (!options.length) {
  console.error("ต้องระบุช่องทาง เช่น: node build/make-scan-test.mjs \"1330500240201, 0880754039\"");
  process.exit(1);
}

const cards = [];
for (const acc of options) {
  const payload = buildPromptPayPayload({ id: acc.id, bank: acc.bank || "", amountSatang: AMOUNT });
  const info = inspectPayload(payload);
  const svg = qrSvg(payload, { scale: 8, margin: 4, alt: `PromptPay QR ${acc.masked}` });
  const sub = JSON.stringify(info.merchantSub);
  fs.writeFileSync(path.join(__dirname, `scan-test-${acc.type}.svg`), svg);
  cards.push(`<div class="card">
    <h2 style="font-size:17px">${acc.label}</h2>
    <div class="qr">${svg}</div>
    <p>proxyType: <b>${info.proxyType}</b> · ยอดใน QR: <b>${info.amount}</b> · CRC ผ่าน: <b>${info.crcValid}</b></p>
    <p>sub-tag ในเพย์โหลด: <code>${sub}</code></p>
    <code>${payload}</code>
  </div>`);
}

const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>QR ทดสอบสแกน (฿1)</title>
<style>body{font-family:'Sarabun',Arial,sans-serif;background:#FBF6EE;color:#1B1B1F;padding:24px;max-width:760px;margin:0 auto}
.card{background:#fff;border:1px solid #F1E9DB;border-radius:18px;padding:20px;margin:14px 0}
.qr{width:300px;height:300px}.qr svg{width:100%;height:100%}
code{font-size:11px;word-break:break-all;color:#7A7A85}h1{font-size:22px}</style></head><body>
<h1>QR ทดสอบสแกน — ยอด ฿1.00</h1>
<p>สแกนจากจอนี้ด้วยแอปธนาคาร แล้วดูว่าอันไหนขึ้นชื่อบัญชีร้าน + ยอด ฿1.00 (ช่องแรก = ค่าเริ่มต้นที่ลูกค้าเห็น)</p>
${cards.join("\n")}
<p style="color:#7A7A85;font-size:13px">ถ้าสแกนแล้วขึ้นชื่อ <b>น.ส. พรพิไล ดวงใจ</b> และยอด ฿1.00 = ช่องนั้นใช้ได้ · ถ้าขึ้น “ไม่พบข้อมูลพร้อมเพย์” = หมายเลขนั้นยังไม่ได้ผูกพร้อมเพย์</p>
</body></html>`;

fs.writeFileSync(path.join(__dirname, "scan-test.html"), html);
console.log("เขียน build/scan-test.html แล้ว:", options.map((o) => `${o.type}:${o.masked}`).join(" | "));
