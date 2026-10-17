// ตรวจสิทธิ์ของ Cloudflare API token **ก่อน** deploy — บอกทันทีว่าขาดสิทธิ์ข้อไหน โดยไม่ต้องรอ deploy พัง
//
// วิธีใช้:
//   node tools/check-cf-token.mjs                    # อ่านโทเคนจาก .secrets/CLOUDFLARE_API_TOKEN
//   node tools/check-cf-token.mjs --json             # ผลแบบ JSON (ใช้ใน CI)
//   node tools/check-cf-token.mjs --account <id>     # ระบุ account เอง (ถ้าโทเคนไม่มี Account:Read)
//   DOMAIN=example.com node tools/check-cf-token.mjs # ตรวจโซนอื่น
//   TOKEN_FILE=.secrets/OTHER node tools/check-cf-token.mjs
//
// ⚠️ สคริปต์นี้อ่านโทเคนแล้ว **ไม่พิมพ์ค่าจริง** — แสดงแค่ความยาว + sha256 8 ตัวแรก เหมือน tools/domain-bind-cloudflare.mjs
//    สิทธิ์ที่ตรวจ (= สิทธิ์ขั้นต่ำที่ tools/domain-bind-cloudflare.mjs ต้องใช้):
//      Account · Workers Scripts:Edit · Workers R2 Storage:Edit · D1:Edit
//      Zone <โดเมน> · Zone:Read · Workers Routes:Edit   ← ข้อสุดท้ายจำเป็นสำหรับ custom_domain = true
//    *Account:Read / DNS:Read เป็น "ไม่บังคับ" (สคริปต์อื่นทำงานได้ถ้าไม่มี) — รายงานเป็น optional เท่านั้น
//
// exit code: 0 = ครบทุกข้อบังคับ · 1 = ขาดอย่างน้อย 1 ข้อ (หรือโทเคนใช้ไม่ได้) · 2 = ตั้งค่าไม่ครบ (ไม่มีไฟล์/รูปแบบผิด)
import fs from "node:fs";
import crypto from "node:crypto";
import { isCrossAccountNs, zoneProblemHint } from "./zone-diag.mjs";

const SHOP = new URL("../", import.meta.url).pathname;
process.chdir(SHOP);

const DOMAIN = String(process.env.DOMAIN || "kopwang.com").trim().toLowerCase();
const TOKEN_FILE = process.env.TOKEN_FILE || ".secrets/CLOUDFLARE_API_TOKEN";
const AS_JSON = process.argv.includes("--json");
const argAccount = (() => {
  const i = process.argv.indexOf("--account");
  return i > -1 ? String(process.argv[i + 1] || "").trim() : "";
})();

const log = (...a) => { if (!AS_JSON) console.log(...a); };

/* ── 0) โทเคน ────────────────────────────────────────────────────────── */
if (!fs.existsSync(TOKEN_FILE)) {
  console.error(`❌ ไม่พบไฟล์ ${TOKEN_FILE}`);
  console.error("   สร้าง token ที่ dash.cloudflare.com/profile/api-tokens → Create Custom Token");
  console.error(`   แล้วเซฟค่าลงไฟล์นั้น (บรรทัดเดียว ไม่มีเครื่องหมายคำพูด): nano ${TOKEN_FILE}`);
  process.exit(2);
}
const TOKEN = fs.readFileSync(TOKEN_FILE, "utf8").replace(/[\r\n\s]/g, "");
if (TOKEN.length < 30) {
  console.error(`❌ โทเคนใน ${TOKEN_FILE} สั้นผิดปกติ (${TOKEN.length} ตัวอักษร) — น่าจะคัดลอกมาไม่ครบ`);
  process.exit(2);
}
const FINGERPRINT = crypto.createHash("sha256").update(TOKEN).digest("hex").slice(0, 8);
log(`🔑 โทเคนจาก ${TOKEN_FILE} · ${TOKEN.length} ตัว · sha256(8) = ${FINGERPRINT} (ไม่พิมพ์ค่าจริง)`);
log(`🎯 โซนเป้าหมาย: ${DOMAIN}\n`);

/* ── ตัวช่วยเรียก API ─────────────────────────────────────────────────── */
// CF_API_BASE ใช้สำหรับทดสอบกับ mock server ในเครื่อง (ปกติไม่ต้องตั้ง)
const API_BASE = process.env.CF_API_BASE || "https://api.cloudflare.com/client/v4";
const api = async (method, p, body) => {
  let r;
  try {
    r = await fetch(API_BASE + p, {
      method,
      headers: { authorization: "Bearer " + TOKEN, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    return { status: 0, ok: false, json: {}, net: String(e?.message || e) };
  }
  const json = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok && json.success !== false, json };
};

const errText = (res) =>
  (res.json?.errors || []).map((e) => `${e.code ?? "?"}: ${e.message ?? ""}`).join(" | ") || res.json?.messages?.join(" | ") || "";

// แปลง HTTP status → คำอธิบาย + วิธีแก้ โดยอิงว่ากำลังตรวจสิทธิ์อะไรอยู่
const explain = (res, scope) => {
  if (res.status === 0) return `ต่อ ${new URL(API_BASE).host} ไม่ได้ (${res.net}) — เช็คเน็ต/ไฟร์วอลล์`;
  if (res.status === 401) return "โทเคนไม่ถูกต้อง/ถูกเพิกถอน (401) — สร้างใหม่หรือคัดลอกให้ครบทั้งเส้น";
  if (res.status === 403) return `โทเคนขาดสิทธิ์ **${scope}** (403) — เพิ่มในหน้า Create/Edit token`;
  if (res.status === 404) return `ไม่พบทรัพยากร (404) — โดเมน/แอคเคานต์อาจไม่ตรงกับที่โทเคนเห็น: ${errText(res)}`;
  if (res.status === 200) return `เรียก API ผ่านแต่ไม่เห็นข้อมูล (200 + list ว่าง) — ${new URL(API_BASE).host}`;
  return `HTTP ${res.status} — ${errText(res)}`;
};

const rows = [];
// customHint = คำอธิบายเจาะจง (ใช้แทนข้อความอัตโนมัติจาก HTTP status เมื่อสถานะ 2xx แต่ยัง “ไม่พร้อมใช้”)
const add = (key, label, scope, required, res, note = "", customHint = "") => {
  const pass = res.ok;
  const hint = pass ? "" : customHint || explain(res, scope);
  // kind: "env" = ติดที่สภาพแวดล้อม/การตั้งค่าบัญชี (แก้ที่แดชบอร์ด ไม่ใช่ที่สิทธิ์โทเคน)
  rows.push({ key, label, scope, required, ok: pass, status: res.status, hint, note, kind: customHint ? "env" : "scope" });
  const mark = pass ? "✅" : required ? "❌" : "⚠️ ";
  const tag = required ? "" : " (ไม่บังคับ)";
  log(`${mark} ${label}${tag} — ${pass ? "ผ่าน" : hint}${note ? `\n     ↳ ${note}` : ""}`);
  return res;
};

/* ── 1) หา account id ก่อน (ต่อโทเคนแบบ account-owned ต้องใช้) ─────────── */
// ประกาศก่อน finish() อาจถูกเรียกเร็ว (ห้ามอยู่หลังจุดที่เรียกใช้ — กัน TDZ)
let ACC = process.env.CLOUDFLARE_ACCOUNT_ID || argAccount || "";
let ZONE_ID = "";
// ประกาศไว้บนสุด เพื่อให้ finish() (ซึ่งอาจถูกเรียกก่อนตรวจโซน) อ่านได้โดยไม่ติด TDZ
let ZONE_CROSS_ACCOUNT = false;
const accountsProbe = ACC ? null : await api("GET", "/accounts?per_page=1");
if (!ACC && accountsProbe?.ok) ACC = accountsProbe.json?.result?.[0]?.id || "";

/* ── 2) โทเคนยัง active ไหม — รองรับทั้ง user-level และ account-owned ──── */
// ✅ สำคัญ: /user/tokens/verify ใช้ได้เฉพาะโทเคนระดับผู้ใช้ — โทเคนระดับบัญชี (account-owned)
//    จะได้ 401 “Invalid API Token” ทั้งที่ใช้งานได้ ⇒ ต้องยืนยันซ้ำที่ /accounts/{id}/tokens/verify
if (!AS_JSON) log("── 1) ตัวโทเคนเอง ──");
const userVerify = await api("GET", "/user/tokens/verify");
const tokenNote = (res) =>
  res.ok ? `status: ${res.json?.result?.status || "active"}${res.json?.result?.expires_on ? ` · หมดอายุ ${res.json.result.expires_on}` : ""}` : "";
if (userVerify.ok) {
  add("token", "โทเคนใช้งานได้ (/user/tokens/verify)", "—", true, userVerify, tokenNote(userVerify));
} else if (ACC) {
  const accVerify = await api("GET", `/accounts/${ACC}/tokens/verify`);
  add("token", "โทเคนใช้งานได้ (ตรวจแบบ account-owned)", "—", true, accVerify, tokenNote(accVerify),
    accVerify.ok ? "" : undefined);
  if (accVerify.ok) log("     ↳ ℹ️ โทเคนนี้เป็นแบบ account-owned — /user/tokens/verify จะได้ 401 เป็นปกติ (ไม่ใช่โทเคนเสีย)");
} else {
  add("token", "โทเคนใช้งานได้", "—", true, userVerify);
}
if (!rows.find((r) => r.key === "token").ok) {
  // โทเคนใช้ไม่ได้จริง — หยุดเลย ไม่ต้องยิง endpoint อื่นให้เสียเวลา/เสีย rate limit
  if (!AS_JSON) log("\n❌ หยุด: โทเคนใช้ไม่ได้จากทั้ง /user และ /accounts ⇒ สร้าง/คัดลอกใหม่");
  finish();
}

/* ── 3) Zone:Read + สถานะโซน ────────────────────────────────────────── */
if (!AS_JSON) log("\n── 2) โซน " + DOMAIN + " ──");
const zones = await api("GET", `/zones?name=${encodeURIComponent(DOMAIN)}`);
const zone = zones.json?.result?.[0];
// 200 แต่ list ว่าง = โทเคน “เห็น API” แต่ไม่เห็นโซนนี้ → ถือว่าไม่ผ่าน (ไม่ใช่ Zone:Read ผ่าน)
add("zone", `เห็นโซน ${DOMAIN}`, "Zone:Read (ระดับโซน)", true, zones.ok && zone ? zones : { ...zones, ok: false, status: zones.ok ? 200 : zones.status },
  zone ? `zone id ${zone.id.slice(0, 8)}… · สถานะ ${zone.status || "?"} · บัญชี ${String(zone.account?.name || "")} (${String(zone.account?.id || "").slice(0, 8)}…)` : "");
if (!zone) {
  if (!AS_JSON) {
    if (zones.ok) log(`   ↳ โทเคนไม่เห็นโซนนี้: โดเมนอาจอยู่คนละบัญชีกับโทเคน หรือ token จำกัด Zone Resources ไว้ที่โซนอื่น`);
    log(`   ↳ เปิด dash.cloudflare.com → ${DOMAIN} → Overview ดูว่าเป็นบัญชีเดียวกับตอนสร้างโทเคน`);
    log(`   ↳ ถ้าใช่บัญชีเดียวกัน: token → Edit → Zone Resources: Include → ${DOMAIN}`);
  }
  finish();
}
ZONE_ID = zone.id;

// โซนต้อง “active” ก่อนจึงจะผูก custom domain ได้ — สถานะอื่น (pending/pending nameserver) = ยังไม่พร้อม
const zoneActive = String(zone.status || "").toLowerCase() === "active";
// SKIP_ZONE_ACTIVE=1 = ตั้งใจ deploy แบบไม่ผูกโดเมน (โหมด NO_ROUTE) ⇒ โซนยัง pending ได้
const skipZoneActive = process.env.SKIP_ZONE_ACTIVE === "1";
// แยกให้ออกระหว่าง “ยังไม่ propagate” กับ “โดเมนไปเกาะโซนของอีกบัญชี” (อย่างหลังรออย่างเดียวไม่จบ)
const zoneCrossAccount = !zoneActive && isCrossAccountNs(zone);
ZONE_CROSS_ACCOUNT = zoneCrossAccount;
const zoneHint = zoneActive ? "" : (await zoneProblemHint(zone, { domain: DOMAIN, tokenFile: TOKEN_FILE }))
  .split("\n").map((l, i) => (i === 0 || l === "" ? l : "     " + l)).join("\n");
add("zoneactive", `โซน ${DOMAIN} active (พร้อมผูก custom domain)`, "—", !skipZoneActive,
  { status: zones.status, ok: zoneActive, json: zones.json }, "", zoneHint);
if (!zoneActive && zoneCrossAccount) {
  log(`   ↳ ⛔ สาเหตุคือ “โซนอยู่คนละบัญชี” ไม่ใช่ยัง propagate ไม่เสร็จ — ดู 2 ทางแก้ด้านบน (เร็วสุด = ใช้โทเคนของบัญชีที่ถือโดเมน)`);
} else if (!zoneActive) {
  log(`   ↳ custom domain จะผูกไม่สำเร็จจนกว่าโซนจะ active (Workers Routes ต้องใช้โซนที่ active)`);
}

/* ── 4) account id ──────────────────────────────────────────────────── */
// ⚠️ โทเคนระดับผู้ใช้ที่เห็นหลายบัญชี: /accounts?per_page=1 คืนบัญชีแรกซึ่งอาจ "ไม่ใช่" บัญชีของโซน
// ⇒ ถ้าไม่ได้ระบุ account มาเอง ให้ยึด account ของโซนเป็นหลักไม่งั้นจะตรวจสิทธิ์ผิดบัญชี
const zoneAcc = zone.account?.id || "";
if (zoneAcc && !process.env.CLOUDFLARE_ACCOUNT_ID && !argAccount && ACC !== zoneAcc) {
  log(`\nℹ️ โทเคนนี้เห็นหลายบัญชี — สลับไปใช้ account ของโซน ${DOMAIN}: ${zoneAcc.slice(0, 8)}… (เดิม ${String(ACC).slice(0, 8) || "-"}…)`);
  ACC = zoneAcc;
}
if (ACC) log(`\nℹ️ ใช้ account id ${ACC.slice(0, 8)}…`);
else if (zoneAcc) {
  ACC = zoneAcc;
  log(`\nℹ️ ใช้ account id จากโซน ${DOMAIN}: ${ACC.slice(0, 8)}… (ไม่ต้องมี Account:Read ก็ได้)`);
} else {
  const accounts = await api("GET", "/accounts");
  ACC = accounts.json?.result?.[0]?.id || "";
  if (!ACC) {
    console.log("❌ หา account id ไม่ได้ — ใส่ --account <id> หรือ CLOUDFLARE_ACCOUNT_ID=<id>");
    finish();
  }
  log(`\nℹ️ ใช้ account id จาก /accounts: ${ACC.slice(0, 8)}…`);
}

/* ── 5) สิทธิ์ที่ deploy ต้องใช้จริง ─────────────────────────────────── */
if (!AS_JSON) log("\n── 3) สิทธิ์ระดับบัญชี (ต้องมีครบ) ──");
const scripts = await api("GET", `/accounts/${ACC}/workers/scripts?per_page=1`);
add("workers", "Workers Scripts (อ่านรายชื่อ script)", "Workers Scripts:Edit", true, scripts);

const d1 = await api("GET", `/accounts/${ACC}/d1/database`);
const d1Names = (d1.json?.result || []).map((d) => d.name).filter(Boolean);
add("d1", "D1 (อ่านรายชื่อฐานข้อมูล)", "D1:Edit", true, d1,
  d1.ok ? `${d1Names.length} ฐาน${d1Names.length ? `: ${d1Names.slice(0, 5).join(", ")}` : ""} (จะสร้างใหม่ถ้ายังไม่มี)` : "");

const r2 = await api("GET", `/accounts/${ACC}/r2/buckets`);
const r2Names = (r2.json?.result?.buckets || []).map((b) => b.name).filter(Boolean);
// SKIP_R2=1 = bucket + ไฟล์สินค้าถูกสร้าง/อัปโหลดทางแดชบอร์ดแล้ว ⇒ ไม่ต้องใช้สิทธิ์ R2 ของโทเคน
const skipR2 = process.env.SKIP_R2 === "1";
// 10042 = ยังไม่ได้เปิดใช้ R2 ในบัญชี (คนละเรื่องกับสิทธิ์ของโทเคน) — ต้องบอกให้ชัด
const r2NotEnabled = (r2.json?.errors || []).some((e) => e.code === 10042) || /enable R2/i.test(errText(r2));
add("r2", "R2 (อ่านรายชื่อ bucket)", "Workers R2 Storage:Edit", !skipR2, r2,
  skipR2 ? "ข้ามเพราะ SKIP_R2=1 (R2_READY) — ใช้ bucket ที่สร้างเองในแดชบอร์ด" :
    r2.ok ? `${r2Names.length} bucket${r2Names.length ? `: ${r2Names.slice(0, 5).join(", ")}` : ""} (จะสร้างใหม่ถ้ายังไม่มี)` : "",
  skipR2 ? "ข้ามการตรวจ R2 ตาม SKIP_R2=1 — ต้องมั่นใจว่า bucket + ไฟล์สินค้ามีอยู่จริงในบัญชีนี้" : "",
  r2NotEnabled ?
    `ยังไม่ได้ **เปิดใช้ R2** ในบัญชีนี้ (Cloudflare ตอบ code 10042) — ไม่ใช่ปัญหาสิทธิ์ของโทเคน\n` +
    `     ↳ เปิดที่ dash.cloudflare.com → R2 Object Storage → Enable (กดยอมรับเงื่อนไข/ผูกบิลถ้าระบบขอ) แล้วรันสคริปต์นี้ซ้ำ\n` +
    `     ↳ ถ้าไม่เปิด R2 ร้านจะอัปโหลดไฟล์สินค้า/สลิปไม่ได้ (Worker จะตอบ 503 “ที่เก็บไฟล์ (R2) ยังไม่พร้อม”)` : "");

if (!AS_JSON) log("\n── 4) สิทธิ์ระดับโซน (ต้องมีครบ) ──");
const routes = await api("GET", `/zones/${ZONE_ID}/workers/routes`);
const routeList = (routes.json?.result || []).map((x) => x.pattern).filter(Boolean);
add("routes", "Workers Routes (จำเป็นสำหรับ custom domain)", "Workers Routes:Edit (ระดับโซน)", true, routes,
  routes.ok ? `${routeList.length} route${routeList.length ? `: ${routeList.slice(0, 5).join(", ")}` : ""}` : "");

/* ── 5.5) PROBE_EDIT=1 — ทดสอบสิทธิ์ระดับ Edit ของจริง (สร้างแล้วลบทิ้งทันที) ── */
// ⚠️ เหตุผลที่ต้องมี: “อ่านรายชื่อได้” (Read) ไม่ได้แปลว่า “สร้างได้” (Edit) — Cloudflare คืน 200 ให้ list
//    แต่ 403/10000 ให้ POST ⇒ ต้องลองสร้างจริงถึงจะรู้ (สร้างเสร็จลบทิ้งทันที ไม่เหลืออะไรในบัญชี)
if (process.env.PROBE_EDIT === "1") {
  if (!AS_JSON) log("\n── 3.5) ทดสอบระดับ Edit (สร้าง → ลบทิ้ง) ──");
  const tag = `probe-${Date.now().toString(36)}`;
  const d1c = await api("POST", `/accounts/${ACC}/d1/database`, { name: tag });
  let d1cleaned = "";
  if (d1c.ok) {
    const uuid = d1c.json?.result?.uuid;
    const del = uuid ? await api("DELETE", `/accounts/${ACC}/d1/database/${uuid}`) : null;
    d1cleaned = del?.ok ? " · ลบ probe แล้ว" : " · ⚠️ ลบ probe ไม่สำเร็จ (ลบเองที่ dash)";
  }
  add("d1edit", "D1 · สร้างฐานข้อมูลได้ (Edit)", "D1:Edit", true, d1c,
    d1c.ok ? `สร้าง/ลบ ${tag} สำเร็จ${d1cleaned}` : "",
    d1c.ok ? "" : `โทเคน **อ่าน** D1 ได้แต่ **สร้าง** ไม่ได้ — ${errText(d1c)}\n     ↳ ต้องตั้งสิทธิ์เป็น **Account · D1 · Edit** (Read ไม่พอ)`);

  const r2c = await api("POST", `/accounts/${ACC}/r2/buckets`, { name: tag });
  let r2cleaned = "";
  if (r2c.ok) {
    const del = await api("DELETE", `/accounts/${ACC}/r2/buckets/${tag}`);
    r2cleaned = del.ok ? " · ลบ probe แล้ว" : " · ⚠️ ลบ probe ไม่สำเร็จ (ลบเองที่ dash)";
  }
  // Workers Scripts:Edit = อัปโหลด/ลบ worker ได้ (ไม่ทดสอบไม่ได้ด้วย list เพราะ list ใช้ Read)
  const wname = tag;
  const form = new FormData();
  form.set("metadata", JSON.stringify({ main_module: "worker.js" }));
  form.set("worker.js", new Blob(['export default { fetch() { return new Response("probe"); } };'], { type: "application/javascript+module" }), "worker.js");
  let wput = { status: 0, ok: false, json: {} };
  try {
    const r = await fetch(`${API_BASE}/accounts/${ACC}/workers/scripts/${wname}`, {
      method: "PUT", headers: { authorization: "Bearer " + TOKEN }, body: form,
    });
    const j = await r.json().catch(() => ({}));
    wput = { status: r.status, ok: r.ok && j.success !== false, json: j };
  } catch (e) { wput = { status: 0, ok: false, json: {}, net: String(e?.message || e) }; }
  let wCleaned = "";
  if (wput.ok) {
    const delW = await api("DELETE", `/accounts/${ACC}/workers/scripts/${wname}`);
    wCleaned = delW.ok ? " · ลบ probe แล้ว" : " · ⚠️ ลบ probe ไม่สำเร็จ (ลบเองที่ dash)";
  }
  add("workersedit", "Workers Scripts · อัปโหลด/ลบ worker ได้ (Edit)", "Workers Scripts:Edit", true, wput,
    wput.ok ? `${wname} สร้าง/ลบสำเร็จ${wCleaned}` : "",
    wput.ok ? "" : `อ่านรายชื่อ script ได้แต่ **อัปโหลดไม่ได้** — HTTP ${wput.status} ${errText(wput)}\n     ↳ ต้องเป็น **Account · Workers Scripts · Edit** (Read ไม่พอ — wrangler จะพังตอน assets-upload-session)`);

  // Workers Routes:Edit = ผูก custom domain (ต้องมี script จริง 1 ตัวก่อนจึงทดสอบได้)
  if (wput.ok) {
    const pattern = `${wname}.${DOMAIN}/*`;
    const rc = await api("POST", `/zones/${ZONE_ID}/workers/routes`, { pattern, script: wname });
    let rCleaned = "";
    if (rc.ok) {
      const rid = rc.json?.result?.id;
      const delR = rid ? await api("DELETE", `/zones/${ZONE_ID}/workers/routes/${rid}`) : null;
      rCleaned = delR?.ok ? " · ลบ probe แล้ว" : " · ⚠️ ลบ route probe ไม่สำเร็จ (ลบเองที่ dash)";
    }
    add("routesedit", "Workers Routes · ผูก route ได้ (Edit)", "Workers Routes:Edit (ระดับโซน)", true, rc,
      rc.ok ? `สร้าง/ลบ ${pattern} สำเร็จ${rCleaned}` : "",
      rc.ok ? "" : `สร้าง route ไม่ได้ — ${errText(rc)}\n     ↳ ต้องเป็น **Zone ${DOMAIN} · Workers Routes · Edit**`);
  } else {
    add("routesedit", "Workers Routes · ผูก route ได้ (Edit)", "Workers Routes:Edit (ระดับโซน)", false,
      { status: 0, ok: false, json: {} }, "",
      "ยังตรวจไม่ได้เพราะสร้าง script ทดสอบไม่ได้ — แก้ **Workers Scripts:Edit** ก่อนแล้วรัน PROBE_EDIT ซ้ำ");
  }

  add("r2edit", "R2 · สร้าง bucket ได้ (Edit)", "Workers R2 Storage:Edit", !skipR2, r2c,
    r2c.ok ? `สร้าง/ลบ ${tag} สำเร็จ${r2cleaned}` : "",
    r2c.ok ? "" : /10042|enable R2/i.test(errText(r2c))
      ? `R2 ยังไม่เปิดใช้ในบัญชี (code 10042) — เปิดที่ dash → R2 Object Storage → Enable`
      : `สร้าง bucket ไม่ได้ — ${errText(r2c)}\n     ↳ ต้องเป็น **Account · Workers R2 Storage · Edit** (Read ไม่พอ)`);
}

/* ── 6) สิทธิ์ที่ไม่บังคับ (รายงานเฉย ๆ ไม่ทำให้ exit ≠ 0) ───────────── */
if (!AS_JSON) log("\n── 5) สิทธิ์เสริม (ไม่มีก็ทำงานได้) ──");
const accRead = accountsProbe?.ok ? accountsProbe : await api("GET", "/accounts?per_page=1");
add("accountread", "Account:Read (ใช้หา account อัตโนมัติ)", "Account:Read", false, accRead,
  accRead.ok ? "มี — ไม่ต้องระบุ --account" : "ไม่มีก็ได้: สคริปต์อ่าน account id จากโซนให้");

const dns = await api("GET", `/zones/${ZONE_ID}/dns_records?per_page=1`);
add("dns", "DNS:Read (ดูเรคคอร์ดชนกับโดเมน)", "DNS:Read (ระดับโซน)", false, dns,
  dns.ok ? "มี — ตรวจเรคคอร์ด A/AAAA/CNAME ที่ root ได้" : "ไม่มีก็ได้: Cloudflare สร้างเรคคอร์ด custom domain เอง");

/* ── 7) สรุป ─────────────────────────────────────────────────────────── */
function finish() {
const missing = rows.filter((r) => r.required && !r.ok);
const missingOptional = rows.filter((r) => !r.required && !r.ok);
const ok = missing.length === 0;

if (AS_JSON) {
  console.log(JSON.stringify({
    ok, domain: DOMAIN, account_id: ACC, zone_id: ZONE_ID, fingerprint: FINGERPRINT,
    rows: rows.map(({ key, label, scope, required, ok, status, hint }) => ({ key, label, scope, required, ok, status, hint })),
  }, null, 2));
} else {
  log("\n" + "─".repeat(62));
  log(`สรุป: ${rows.filter((r) => r.ok).length}/${rows.length} ข้อผ่าน · บังคับ ${rows.filter((r) => r.required).length} ข้อ`);
  if (ok) {
    log(`\n✅ พร้อม deploy — สิทธิ์ครบทุกข้อ`);
    log(`   ต่อไป: node tools/domain-bind-cloudflare.mjs`);
    if (missingOptional.length) log(`   ⚠️ ขาดสิทธิ์เสริม ${missingOptional.length} ข้อ (ไม่กระทบ): ${missingOptional.map((r) => r.scope).join(" · ")}`);
  } else {
    log(`\n❌ ยัง deploy ไม่ได้ — ขาด ${missing.length} ข้อ:`);
    for (const r of missing) log(`   • ${r.label}  →  ${r.hint.split("\n")[0]}\n${r.hint.split("\n").slice(1).join("\n")}`);
    const envMissing = missing.filter((r) => r.kind === "env");
    const scopeMissing = missing.filter((r) => r.kind === "scope");
    if (envMissing.length) {
      log(`\n   ⚙️  ต้องแก้ที่แดชบอร์ด (ไม่ใช่ที่สิทธิ์ของโทเคน):`);
      for (const r of envMissing) log(`      - ${r.label}`);
    }
    if (scopeMissing.length) {
      log(`\n   🔑 ต้องเพิ่มสิทธิ์โทเคน: dash.cloudflare.com/profile/api-tokens → Edit → ติ๊ก`);
      for (const r of scopeMissing) log(`      - ${r.scope}`);
      log(`      (Zone Resources: Include → ${DOMAIN}) → Continue → Save · ไม่ต้องสร้างโทเคนใหม่`);
    }
    if (ZONE_CROSS_ACCOUNT) {
      log(`\n   ⛔ โซนอยู่คนละบัญชี — รันซ้ำเฉย ๆ ไม่ช่วย ต้องเลือกทางใดทางหนึ่ง:`);
      log(`      1) TOKEN_FILE=.secrets/CLOUDFLARE_API_TOKEN_DOMAIN node tools/domain-bind-cloudflare.mjs   ← โทเคนของบัญชีที่ถือโดเมน (เร็วสุด)`);
      log(`      2) ย้ายโดเมนมาบัญชีนี้ (Registrar inter-account move · ต้องอายุโดเมนเกิน 10 วัน)`);
    } else {
      log(`   แล้วรันสคริปต์นี้อีกครั้ง`);
    }
  }
  log("─".repeat(62));
}

process.exit(ok ? 0 : 1);
}

finish();
