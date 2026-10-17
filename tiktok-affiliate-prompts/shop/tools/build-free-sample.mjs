/**
 * build-free-sample.mjs — สร้าง `../free-sample.mjs` (5 prompt แรกของแพ็ก) จาก `../../prompts-599.csv`
 * ใช้เป็นของแถมในหน้า /free — ต้องตรงกับชุดที่ขายจริงเสมอ จึงห้ามแก้ไฟล์ผลลัพธ์ด้วยมือ
 *
 * รัน:  node tools/build-free-sample.mjs            (สร้าง/อัปเดต)
 *       node tools/build-free-sample.mjs --check     (ตรวจว่าตรงกับ CSV ไหม — ใช้ในเทสต์/CI, exit 1 ถ้าไม่ตรง)
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOP = path.join(HERE, "..");
const CSV_PATH = path.join(SHOP, "..", "prompts-599.csv");
const OUT_PATH = path.join(SHOP, "free-sample.mjs");
export const SAMPLE_COUNT = 5;

/** CSV parser แบบพอเพียง: รองรับ field ในเครื่องหมายคำพูด + ขึ้นบรรทัดใหม่ใน field */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** อ่าน CSV → 5 แถวแรกในรูป object ที่หน้าเว็บ/อีเมลใช้ */
export function readSamples(csvText = fs.readFileSync(CSV_PATH, "utf8"), count = SAMPLE_COUNT) {
  const rows = parseCsv(csvText);
  const head = rows.shift();
  const idx = Object.fromEntries(head.map((h, i) => [h.trim(), i]));
  const pick = (r, k) => (idx[k] == null ? "" : (r[idx[k]] ?? "").trim());
  return rows.slice(0, count).map((r) => ({
    id: pick(r, "id"),
    niche_th: pick(r, "niche_th"),
    niche_en: pick(r, "niche_en"),
    angle_th: pick(r, "angle_th"),
    angle_en: pick(r, "angle_en"),
    file: pick(r, "file"),
    hook_th: pick(r, "example_hook_th"),
    cta_th: pick(r, "example_cta_th"),
    prompt_th: pick(r, "prompt_th"),
    prompt_en: pick(r, "prompt_en"),
  }));
}

function render(csvText) {
  const samples = readSamples(csvText);
  const sha = crypto.createHash("sha256").update(csvText).digest("hex");
  const ids = samples.map((s) => s.id);
  return `/**
 * free-sample.mjs — 5 prompt แรกของแพ็ก (ของแถมในหน้า /free) · **ห้ามแก้ไฟล์นี้ด้วยมือ**
 * สร้างจาก ../prompts-599.csv ด้วย \`node tools/build-free-sample.mjs\`
 * เทสต์จะตรวจ sha256 ของ CSV + ว่า prompt ทุกชุดตรงกับต้นฉบับ (กันของแถมกับของที่ขายไม่ตรงกัน)
 */
export const FREE_SAMPLE_META = {
  product: "599 Prompt ก๊อปวาง",
  count: ${samples.length},
  ids: ${JSON.stringify(ids)},
  source: "../prompts-599.csv",
  source_sha256: "${sha}",
};

export const FREE_SAMPLES = ${JSON.stringify(samples, null, 2)};
`;
}

const csvText = fs.readFileSync(CSV_PATH, "utf8");
const next = render(csvText);
const check = process.argv.includes("--check");

if (check) {
  const cur = fs.existsSync(OUT_PATH) ? fs.readFileSync(OUT_PATH, "utf8") : "";
  const ok = cur === next;
  console.log(ok ? "✅ free-sample.mjs ตรงกับ prompts-599.csv" : "❌ free-sample.mjs ไม่ตรงกับ prompts-599.csv — รัน: node tools/build-free-sample.mjs");
  process.exit(ok ? 0 : 1);
}

fs.writeFileSync(OUT_PATH, next);
const samples = readSamples(csvText);
console.log(`✅ เขียน ${path.relative(process.cwd(), OUT_PATH)} — ${samples.length} ชุด: ${samples.map((s) => s.id).join(", ")} · หมวด: ${[...new Set(samples.map((s) => s.niche_th))].join(", ")}`);
