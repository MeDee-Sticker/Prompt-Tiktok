// วินิจฉัย “ทำไมโซนยังไม่ active” ให้ตรงสาเหตุ — ใช้ร่วมกันโดย tools/check-cf-token.mjs
// และ tools/domain-bind-cloudflare.mjs (ที่เดียว จะได้ไม่พูดคนละอย่าง)
//
// 2 สาเหตุที่หน้าตาคล้ายกันแต่แก้คนละทาง:
//   1) registrar ยังไม่ได้ชี้ NS มาที่โซนนี้ (ปกติ) → แก้ที่ผู้จดโดเมน แล้วรอ propagate
//   2) registrar ชี้ไป **โซน Cloudflare ของอีกบัญชี** (เช่น benedict/daphne ขณะที่โซนนี้ได้ arturo/oaklyn)
//      → โซนนี้จะไม่มีวัน active · ถ้าโดเมนจดที่ Cloudflare Registrar จะเปลี่ยน NS เองไม่ได้เลย
const strip = (s) => String(s || "").replace(/\.$/, "").toLowerCase();
const isCfNs = (s) => /\.ns\.cloudflare\.com$/.test(strip(s));

/** NS ที่ปลายทางประกาศ เป็นของ Cloudflare แต่ไม่ใช่ชุดที่โซนนี้ได้ ⇒ โดเมนไปเกาะโซนอื่น (อีกบัญชี) */
export function isCrossAccountNs(zone) {
  const assigned = new Set((zone?.name_servers || []).map(strip));
  const observed = (zone?.observed_name_servers || []).map(strip);
  if (!assigned.size || !observed.length) return false;
  return observed.every(isCfNs) && observed.every((s) => !assigned.has(s));
}

// RDAP: ใครเป็นผู้จด + จดเมื่อไร (ใช้คำนวณว่าย้ายบัญชีได้เมื่อไร) — ล้มเหลวได้ ไม่Throw
export async function registrarInfo(domain, timeoutMs = 4000) {
  const urls = [
    /\.com$/i.test(domain) ? `https://rdap.verisign.com/com/v1/domain/${domain}` : "",
    `https://rdap.org/domain/${domain}`,
  ].filter(Boolean);
  for (const url of urls) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) continue;
      const j = await r.json();
      const reg = (j.entities || []).find((e) => (e.roles || []).includes("registrar"));
      const name = (reg?.vcardArray?.[1] || []).find((v) => v[0] === "fn")?.[3] || "";
      const registeredAt = (j.events || []).find((e) => e.eventAction === "registration")?.eventDate || "";
      return {
        ok: true,
        registrar: name,
        registeredAt,
        atCloudflare: /cloudflare/i.test(name),
        eligibleMoveAt: registeredAt ? new Date(new Date(registeredAt).getTime() + 10 * 864e5).toISOString().slice(0, 10) : "",
      };
    } catch { /* ลอง URL ถัดไป */ }
  }
  return { ok: false };
}

const thDate = (iso) => {
  if (!iso) return "";
  // 2026-10-15 → 15 ต.ค. 2026 (พ.ศ. 2569)
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const m = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."][d.getUTCMonth()];
  return `${d.getUTCDate()} ${m} ${d.getUTCFullYear() + 543}`;
};

/**
 * ข้อความอธิบายปัญหาโซน + ทางแก้ (หลายบรรทัด ไม่มี indent หน้าแรก เพื่อให้ต่อกับ log ได้)
 * @param {object} zone  ผลจาก GET /zones
 * @param {{domain:string, tokenFile?:string}} opts
 */
export async function zoneProblemHint(zone, { domain, tokenFile = ".secrets/CLOUDFLARE_API_TOKEN" } = {}) {
  const nsAssigned = (zone?.name_servers || []).join(", ") || "-";
  const nsObserved = (zone?.observed_name_servers || []).map(strip).join(", ") || "-";
  const head =
    `โซน ${domain} ยังไม่ active (สถานะ: ${zone?.status || "?"}${zone?.activation_failure_reason ? ` · ${zone.activation_failure_reason}` : ""})\n` +
    `   ↳ NS ที่ Cloudflare ให้โซนนี้: ${nsAssigned}\n` +
    `   ↳ NS ที่ปลายทางประกาศอยู่: ${nsObserved}`;

  if (!isCrossAccountNs(zone)) {
    return head + `\n   ↳ แก้ nameserver ที่ผู้จดโดเมนให้ตรงชุดข้างบน แล้วรอ propagate (มัก < 30 นาที)`;
  }

  // อย่าแนะนำให้เขียนทับโทเคนของบัญชีนี้ — ใช้ไฟล์แยกสำหรับโทเคนของบัญชีที่ถือโดเมน
  const otherToken = process.env.OTHER_TOKEN_FILE || ".secrets/CLOUDFLARE_API_TOKEN_DOMAIN";
  const reg = await registrarInfo(domain);
  const regLine = reg.ok
    ? `\n   ℹ️ ผู้จดโดเมน (RDAP): ${reg.registrar || "?"}${reg.registeredAt ? ` · จดเมื่อ ${thDate(reg.registeredAt)}` : ""}`
    : "";
  const lock =
    reg.ok && reg.atCloudflare
      ? `\n   ⛔ โดเมนจดที่ Cloudflare Registrar ⇒ **เปลี่ยน nameserver เองไม่ได้** (Registrar ล็อก NS ไว้กับโซนในบัญชีเดียวกันเสมอ)`
      : "";

  return (
    head +
    regLine +
    `\n   ⚠️ NS ที่ปลายทางชี้ไปคือ **โซน Cloudflare ของอีกบัญชี** ไม่ใช่โซนนี้ ⇒ โซนนี้จะไม่มีวัน active ไม่ว่าจะรอนานแค่ไหน` +
    lock +
    `\n\n   ✅ ทางที่เร็วสุด (ทำได้เลยวันนี้) — สร้าง token ที่ **บัญชีที่ถือโดเมน** (dash.cloudflare.com → สลับบัญชี → My Profile → API Tokens) แล้ว:` +
    `\n      1) TOKEN_FILE=${otherToken} node tools/token-web.mjs        ← วางโทเคนในเบราว์เซอร์ (ไม่ต้องพิมพ์ลงแชท)` +
    `\n      2) TOKEN_FILE=${otherToken} node tools/domain-bind-cloudflare.mjs` +
    `\n      สิทธิ์ของโทเคนนั้น: Workers Scripts:Edit · R2:Edit · D1:Edit · Zone ${domain}: Zone:Read + Workers Routes:Edit` +
    `\n   🕓 ทางเลือก (ย้ายโดเมนมาบัญชีนี้แทน): Registrar inter-account move ที่บัญชีเดิม → Domains → Configuration → Start` +
    (reg.eligibleMoveAt ? `\n      · ต้องอายุโดเมนเกิน 10 วัน ⇒ เริ่มได้ตั้งแต่ ${thDate(reg.eligibleMoveAt)}` : "\n      · ต้องอายุโดเมนเกิน 10 วัน") +
    `\n      · บัญชีนี้ต้องกดยอมรับทางอีเมลภายใน 5 วัน · DNS records/อีเมลของโซนเดิมไม่ย้ายตาม (ต้องสร้างใหม่ในโซนนี้)`
  );
}
