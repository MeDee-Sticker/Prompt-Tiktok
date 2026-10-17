/**
 * mock-env.mjs — สภาพแวดล้อมจำลองสำหรับเทสต์และเดโม (ไม่แตะ Cloudflare จริง)
 * ใช้ร่วมกันระหว่าง test.mjs และ demo-server.mjs เพื่อให้พฤติกรรมตรงกัน
 * - makeD1(): จำลอง D1/SQLite เท่าที่ worker.js ใช้จริง (INSERT/UPDATE/SELECT ตามคำสั่งในโค้ด)
 *   ตารางที่รองรับ: orders · email_log · leads · pack_versions · subscribers
 *   เงื่อนไข WHERE ที่ไม่รู้จักจะ “โยน error” สำหรับตารางใหม่ (กันเทสต์ผ่านเพราะเงื่อนไขถูกมองข้าม)
 * - FILES: จำลอง R2 (put/get/head/delete)
 * - installFetchMock(): จำลอง Omise + Resend + EasySlip
 */
import { crc16 } from "./promptpay.mjs";

const norm = (s) => String(s).replace(/\s+/g, " ").trim();
const nowSql = () => new Date().toISOString().replace("T", " ").slice(0, 19);

/** แยก "a, b, c" แบบไม่สนใจจุลภาคในวงเล็บ/สตริง */
function splitTop(s) {
  const out = [];
  let depth = 0, quote = null, cur = "";
  for (const ch of s) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function orderRows(orders, where, args) {
  let rows = [...orders.values()];
  let ai = 0;
  for (const c of where.split(/\s+AND\s+/i).map((x) => x.trim())) {
    let m;
    if ((m = c.match(/^id\s*=\s*\?$/i))) { const v = args[ai++]; rows = rows.filter((r) => r.id === v); }
    else if ((m = c.match(/^id\s*!=\s*\?$/i))) { const v = args[ai++]; rows = rows.filter((r) => r.id !== v); }
    else if ((m = c.match(/^last_download_version\s*=\s*\?$/i))) { const v = args[ai++]; rows = rows.filter((r) => r.last_download_version === v); }
    else if ((m = c.match(/^trans_ref\s*=\s*\?$/i))) { const v = args[ai++]; rows = rows.filter((r) => r.trans_ref === v); }
    else if ((m = c.match(/^email\s*=\s*\?$/i))) { const v = args[ai++]; rows = rows.filter((r) => r.email === v); }
    else if ((m = c.match(/^charge_id\s*=\s*\?$/i))) { const v = args[ai++]; rows = rows.filter((r) => r.charge_id === v); }
    else if ((m = c.match(/^status\s*=\s*'([^']*)'$/i))) { const v = m[1]; rows = rows.filter((r) => r.status === v); }
    else if ((m = c.match(/^status\s+IN\s*\(([^)]*)\)$/i))) {
      const list = splitTop(m[1]).map((x) => x.trim().replace(/^'|'$/g, ""));
      rows = rows.filter((r) => list.includes(r.status));
    }
  }
  return rows;
}

/** เวลาตัดยอดของ datetime('now','-N hour|day') เป็นสตริงแบบ SQLite (UTC) */
function sinceSql(interval) {
  const m = String(interval).match(/^-(\d+) (hour|day)s?$/i);
  const ms = m ? Number(m[1]) * (m[2].toLowerCase() === "day" ? 86400e3 : 3600e3) : 3600e3;
  return new Date(Date.now() - ms).toISOString().replace("T", " ").slice(0, 19);
}

/** กรองแถวของตาราง leads (email / ip_hash / created_at) */
function leadRows(leads, where, args) {
  let rows = [...leads.values()];
  let ai = 0;
  for (const c of String(where || "").split(/\s+AND\s+/i).map((x) => x.trim())) {
    let m;
    if ((m = c.match(/^email\s*=\s*\?$/i))) { const v = args[ai++]; rows = rows.filter((r) => r.email === v); }
    else if ((m = c.match(/^ip_hash\s*=\s*\?$/i))) { const v = args[ai++]; rows = rows.filter((r) => r.ip_hash === v); }
    else if ((m = c.match(/^created_at\s*>\s*datetime\('now',\s*'(-\d+ (?:hour|day))'\)$/i))) {
      const since = sinceSql(m[1]);
      rows = rows.filter((r) => r.created_at > since);
    }
  }
  return rows;
}

/** เรียงแถวตาม ORDER BY ธรรมดา (คอลัมน์เดียว ASC/DESC) */
function sortRows(rows, orderBy) {
  if (!orderBy) return rows;
  const col = orderBy.split(/\s+/)[0];
  const out = rows.slice().sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0));
  if (/desc/i.test(orderBy)) out.reverse();
  return out;
}

/**
 * กรองแถวของตาราง pack_versions / subscribers
 * จงใจ “โยน error” เมื่อเจอเงื่อนไขที่ไม่รู้จัก → เทสต์จะไม่ผ่านแบบหลอก ๆ เพราะเงื่อนไขถูกมองข้าม
 * @returns {{rows: object[], ai: number}} ai = จำนวน placeholder ที่ใช้ไปแล้ว (สำหรับ LIMIT ? ต่อท้าย)
 */
function filteredRows(rows, where, args, table) {
  let out = [...rows];
  let ai = 0;
  const clauses = String(where || "").split(/\s+AND\s+/i).map((x) => x.trim()).filter(Boolean);
  for (const c of clauses) {
    let m;
    if (table === "subscribers" && (m = c.match(/^email\s*=\s*\?$/i))) { const v = args[ai++]; out = out.filter((r) => r.email === v); }
    else if (table === "subscribers" && /^unsubscribed_at\s+IS\s+NULL$/i.test(c)) out = out.filter((r) => r.unsubscribed_at == null);
    else if (table === "subscribers" && /^unsubscribed_at\s+IS\s+NOT\s+NULL$/i.test(c)) out = out.filter((r) => r.unsubscribed_at != null);
    else if (table === "subscribers" && (m = c.match(/^last_notified_version\s*<>\s*\?$/i))) { const v = args[ai++]; out = out.filter((r) => r.last_notified_version !== v); }
    else if (table === "pack_versions" && (m = c.match(/^version\s*=\s*\?$/i))) { const v = args[ai++]; out = out.filter((r) => r.version === v); }
    else if (table === "pack_versions" && (m = c.match(/^is_current\s*=\s*(\d+)$/i))) out = out.filter((r) => Number(r.is_current) === Number(m[1]));
    else throw new Error(`mock D1: ยังไม่รู้จักเงื่อนไขของ ${table}: “${c}” (เพิ่มตัวกรองใน mock-env.mjs หรือเขียน SQL ให้ตรงแบบที่รองรับ)`);
  }
  return { rows: out, ai };
}

/** mock D1 (SQLite in-memory) รองรับคำสั่ง SQL ที่ worker.js ใช้ */
function makeD1({ orders, emailLog, leads, packVersions, subscribers }) {
  let packSeq = packVersions.reduce((mx, r) => Math.max(mx, Number(r.id) || 0), 0);
  const project = (sql, row) => {
    if (!row) return null;
    const m = sql.match(/SELECT (.*?) FROM/i);
    if (!m) return { ...row };
    if (/^count\(\*\)/i.test(m[1].trim())) return { ...row };
    const out = {};
    for (const raw of splitTop(m[1])) {
      const name = raw.split(/\s+as\s+/i).pop().trim();
      out[name] = row[name] ?? null;
    }
    return out;
  };

  const select = (sql, args) => {
    const m = sql.match(/FROM (orders|email_log|leads|pack_versions|subscribers)(?:\s+WHERE (.*?))?(?:\s+ORDER BY ([^;]+?))?(?:\s+LIMIT (\d+|\?))?$/i);
    if (!m) return [];
    const [, table, where, orderBy, limit] = m;
    let rows;
    if (table === "pack_versions" || table === "subscribers") {
      const src = table === "pack_versions" ? packVersions : [...subscribers.values()];
      const f = filteredRows(src, where, args, table);
      rows = sortRows(f.rows, orderBy);
      // LIMIT แบบ ? = ใช้ค่าจากอาร์กิวเมนต์ตัวถัดไป (หลัง placeholder ของ WHERE)
      if (limit === "?") rows = rows.slice(0, Number(args[f.ai] ?? 0));
      else if (limit) rows = rows.slice(0, Number(limit));
      return /COUNT\(\*\)/i.test(sql) ? [{ n: rows.length }] : rows;
    }
    if (table === "email_log") {
      const w = where || "";
      rows = emailLog.slice();
      if (/email = \?/i.test(w)) rows = rows.filter((r) => r.email === args[0]);
      const kd = w.match(/kind = '(\w+)'/i);
      if (kd) rows = rows.filter((r) => r.kind === kd[1]);
      const iv = w.match(/created_at > datetime\('now','(-\d+ (?:hour|day))'\)/i);
      if (iv) { const since = sinceSql(iv[1]); rows = rows.filter((r) => r.created_at > since); }
      if (/COUNT\(\*\)/i.test(sql)) return [{ n: rows.length }];
      return rows;
    }
    if (table === "leads") {
      rows = where ? leadRows(leads, where, args) : [...leads.values()];
      if (orderBy) {
        const col = orderBy.split(/\s+/)[0];
        rows = rows.slice().sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0));
        if (/desc/i.test(orderBy)) rows.reverse();
      }
      if (limit) rows = rows.slice(0, Number(limit));
      if (/COUNT\(\*\)/i.test(sql)) return [{ n: rows.length }];
      return rows;
    }
    rows = where ? orderRows(orders, where, args) : [...orders.values()];
    if (orderBy) {
      const desc = /desc/i.test(orderBy);
      const col = orderBy.split(/\s+/)[0];
      rows = rows.slice().sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0));
      if (desc) rows.reverse();
    }
    if (limit) rows = rows.slice(0, Number(limit));
    return rows;
  };

  return {
    prepare(sql) {
      const s = norm(sql);
      return {
        _args: [],
        bind(...a) { this._args = a; return this; },
        async first() {
          const rows = select(s, this._args);
          return rows[0] ? project(s, rows[0]) : null;
        },
        async all() {
          return { results: select(s, this._args).map((r) => project(s, r)) };
        },
        async run() {
          const a = this._args;
          // เพิ่มแถวในทะเบียนเวอร์ชัน / ทะเบียนลูกค้า
          if (/^INSERT INTO pack_versions/i.test(s)) {
            const row = insertRowFromSql(s, "pack_versions", a, { is_current: 0, object_key: "prompt-pack.pdf", created_at: nowSql(), notified_count: 0, notify_failed: 0 });
            row.id = ++packSeq;
            packVersions.push(row);
            return { success: true, meta: { changes: 1 } };
          }
          // “ซ่อมทะเบียนลูกค้า”: INSERT OR IGNORE … SELECT จากออเดอร์ที่จ่ายแล้ว (ดึงลูกค้ารุ่นก่อนมีตาราง)
          if (/^INSERT OR IGNORE INTO subscribers .* SELECT .* FROM orders WHERE status = 'paid'/i.test(s)) {
            const limit = Number((s.match(/LIMIT (\d+)/i) || [0, 200])[1]);
            let added = 0;
            for (const o of [...orders.values()]) {
              if (o.status !== "paid" || !o.email) continue;
              if (subscribers.has(o.email)) continue;
              if (added >= limit) break;
              subscribers.set(o.email, {
                email: o.email, first_order_id: o.id, last_order_id: o.id, orders_count: 1,
                created_at: nowSql(), updated_at: nowSql(), last_notified_version: "",
                last_download_version: null, notified_at: null, unsubscribed_at: null,
              });
              added++;
            }
            return { success: true, meta: { changes: added } };
          }
          if (/^INSERT (OR IGNORE )?INTO subscribers/i.test(s)) {
            const row = insertRowFromSql(s, "subscribers", a, {
              orders_count: 0, created_at: nowSql(), updated_at: null, last_notified_version: "",
              last_download_version: null, notified_at: null, unsubscribed_at: null, first_order_id: null, last_order_id: null,
            });
            if (/OR IGNORE/i.test(s) && subscribers.has(row.email)) return { success: true, meta: { changes: 0 } };
            if (subscribers.has(row.email)) Object.assign(subscribers.get(row.email), row);
            else subscribers.set(row.email, row);
            return { success: true, meta: { changes: 1 } };
          }
          if (/^UPDATE pack_versions/i.test(s) || /^UPDATE subscribers/i.test(s)) {
            const table = /^UPDATE pack_versions/i.test(s) ? "pack_versions" : "subscribers";
            const mm = s.match(new RegExp(`UPDATE ${table} SET (.*?) WHERE (.*)$`, "i"));
            let ai = 0;
            const sets = splitTop(mm[1]).map((item) => {
              const col = item.slice(0, item.indexOf("=")).trim();
              const expr = item.slice(item.indexOf("=") + 1).trim();
              let value;
              const addm = expr.match(/^([\w.]+)\s*\+\s*(\d+)$/);
              if (expr === "?") value = a[ai++];
              else if (addm) value = { add: Number(addm[2]) };
              else if (/datetime\('now'\)/i.test(expr)) value = nowSql();
              else if (/^NULL$/i.test(expr)) value = null;
              else if (/^'.*'$/.test(expr)) value = expr.slice(1, -1);
              else value = Number(expr);
              return [col, value];
            });
            const src = table === "pack_versions" ? packVersions : [...subscribers.values()];
            const f = filteredRows(src, mm[2], a.slice(ai), table);
            for (const row of f.rows) {
              for (const [col, value] of sets) {
                if (value && typeof value === "object" && "add" in value) row[col] = Number(row[col] || 0) + value.add;
                else row[col] = value;
              }
            }
            return { success: true, meta: { changes: f.rows.length } };
          }
          if (/^INSERT INTO orders/i.test(s)) {
            const cols = splitTop(s.match(/INSERT INTO orders \(([^)]*)\)/i)[1]);
            const vals = splitTop(s.match(/VALUES \(([^)]*)\)/i)[1]);
            const row = {
              status: "pending", provider: "promptpay", download_count: 0, created_at: nowSql(),
              paid_at: null, emailed_at: null, reported_at: null, slip_key: null, slip_mime: null,
              slip_bytes: null, trans_ref: null, verify_source: null, review_note: null,
            };
            let ai = 0;
            vals.forEach((v, i) => {
              const col = cols[i];
              if (v === "?") row[col] = a[ai++];
              else if (/^'.*'$/.test(v)) row[col] = v.slice(1, -1);
              else if (/^NULL$/i.test(v)) row[col] = null;
              else if (/datetime\('now'\)/i.test(v)) row[col] = nowSql();
              else row[col] = Number(v);
            });
            orders.set(row.id, row);
            return { success: true, meta: { changes: 1 } };
          }
          if (/^INSERT INTO email_log/i.test(s)) {
            const cols = splitTop(s.match(/INSERT INTO email_log \(([^)]*)\)/i)[1]);
            const vals = splitTop(s.match(/VALUES \(([^)]*)\)/i)[1]);
            const row = { created_at: nowSql() };
            let ai = 0;
            vals.forEach((v, i) => {
              row[cols[i]] = v === "?" ? a[ai++] : /^NULL$/i.test(v) ? null : /^'.*'$/.test(v) ? v.slice(1, -1) : /^-?\d+$/.test(v) ? Number(v) : v;
            });
            emailLog.push(row);
            return { success: true, meta: { changes: 1 } };
          }
          if (/^INSERT (OR IGNORE )?INTO leads/i.test(s)) {
            const cols = splitTop(s.match(/INSERT (?:OR IGNORE )?INTO leads \(([^)]*)\)/i)[1]);
            const vals = splitTop(s.match(/VALUES \(([^)]*)\)/i)[1]);
            let ai = 0;
            const row = { source: null, consent_at: null, ip_hash: null, created_at: nowSql(), last_sent_at: null };
            vals.forEach((v, i) => {
              const col = cols[i];
              if (v === "?") row[col] = a[ai++];
              else if (/^'.*'$/.test(v)) row[col] = v.slice(1, -1);
              else if (/datetime\('now'\)/i.test(v)) row[col] = nowSql();
              else if (/^NULL$/i.test(v)) row[col] = null;
              else row[col] = Number(v);
            });
            if (/OR IGNORE/i.test(s) && leads.has(row.email)) return { success: true, meta: { changes: 0 } };
            leads.set(row.email, row);
            return { success: true, meta: { changes: 1 } };
          }
          if (/^UPDATE leads/i.test(s)) {
            const setPart = s.match(/UPDATE leads SET (.*?) WHERE (.*)$/i);
            const item = setPart[1];
            const col = item.slice(0, item.indexOf("=")).trim();
            const expr = item.slice(item.indexOf("=") + 1).trim();
            const useArg = expr === "?";
            const value = useArg ? a[0] : /datetime\('now'\)/i.test(expr) ? nowSql() : expr.replace(/^'|'$/g, "");
            const targets = leadRows(leads, setPart[2], useArg ? a.slice(1) : a);
            for (const row of targets) row[col] = value;
            return { success: true, meta: { changes: targets.length } };
          }
          if (/^UPDATE orders/i.test(s)) {
            const setPart = s.match(/UPDATE orders SET (.*?) WHERE (.*)$/i);
            const setItems = splitTop(setPart[1]);
            let ai = 0;
            const sets = setItems.map((item) => {
              const eq = item.indexOf("=");
              const col = item.slice(0, eq).trim();
              const expr = item.slice(eq + 1).trim();
              let value;
              if (expr === "?") value = a[ai++];
              else if ((value = expr.match(/^COALESCE\((\?), (\w+)\)$/i))) { value = { coalesce: a[ai++], fallback: value[2] }; }
              else if (expr === "NULL") value = null;
              else if (/datetime\('now'\)/i.test(expr)) value = nowSql();
              else if (/^'.*'$/.test(expr)) value = expr.slice(1, -1);
              else if (/^([\w.]+)\s*\+\s*(\d+)$/.test(expr)) value = { add: Number(RegExp.$2) };
              else value = Number(expr);
              return [col, value];
            });
            // WHERE ใช้ placeholder ต่อจาก SET (ลำดับในสตริง SQL)
            const whereArgs = a.slice(ai);
            const targets = orderRows(orders, setPart[2], whereArgs);
            for (const row of targets) {
              for (const [col, value] of sets) {
                if (value && typeof value === "object" && "coalesce" in value) {
                  if (value.coalesce != null && value.coalesce !== row[col]) row[col] = value.coalesce;
                } else if (value && typeof value === "object" && "add" in value) {
                  row[col] = Number(row[col] || 0) + value.add;
                } else row[col] = value;
              }
            }
            return { success: true, meta: { changes: targets.length } };
          }
          if (/^DELETE FROM orders/i.test(s)) {
            const where = (s.match(/WHERE (.*)$/i) || ["", ""])[1];
            const targets = orderRows(orders, where, a);
            for (const row of targets) orders.delete(row.id);
            return { success: true, meta: { changes: targets.length } };
          }
          if (/^DELETE FROM email_log/i.test(s)) {
            const before = emailLog.length;
            const w = (s.match(/WHERE (.*)$/i) || ["", ""])[1];
            const byOrder = /order_id = \?/i.test(w);
            const byEmail = /email = \?/i.test(w);
            const kd = (w.match(/kind = '(\w+)'/i) || [])[1] || null;
            for (let i = emailLog.length - 1; i >= 0; i--) {
              const r = emailLog[i];
              if (byOrder && r.order_id !== a[0]) continue;
              if (byEmail && r.email !== a[0]) continue;
              if (kd && r.kind !== kd) continue;
              emailLog.splice(i, 1);
            }
            return { success: true, meta: { changes: before - emailLog.length } };
          }
          if (/^DELETE FROM leads/i.test(s)) {
            const before = leads.size;
            for (const row of leadRows(leads, (s.match(/WHERE (.*)$/i) || ["", ""])[1], a)) leads.delete(row.email);
            return { success: true, meta: { changes: before - leads.size } };
          }
          return { success: true, meta: { changes: 0 } };
        },
      };
    },
  };
}

/** แปลง INSERT … (cols) VALUES (vals) เป็นออบเจ็กต์ โดยกิน placeholder ตามลำดับ (ใช้ร่วมกับตารางใหม่) */
function insertRowFromSql(s, table, args, defaults) {
  const cols = splitTop(s.match(new RegExp(`INSERT (?:OR IGNORE )?INTO ${table} \\(([^)]*)\\)`, "i"))[1]);
  const vals = splitTop(s.match(/VALUES \(([^)]*)\)/i)[1]);
  const row = { ...defaults };
  let ai = 0;
  vals.forEach((v, i) => {
    const col = cols[i];
    if (v === "?") row[col] = args[ai++];
    else if (/^'.*'$/.test(v)) row[col] = v.slice(1, -1);
    else if (/^NULL$/i.test(v)) row[col] = null;
    else if (/datetime\('now'\)/i.test(v)) row[col] = nowSql();
    else row[col] = Number(v);
  });
  return row;
}

/** R2 จำลอง (เก็บใน Map) */
function makeR2(store = new Map()) {
  return {
    store,
    async put(key, value, opts = {}) {
      store.set(key, { bytes: value, contentType: opts?.httpMetadata?.contentType || "application/octet-stream", uploaded: new Date() });
      return { key };
    },
    async get(key) {
      const hit = store.get(key);
      return hit ? { body: hit.bytes, httpMetadata: { contentType: hit.contentType } } : null;
    },
    async head(key) {
      const hit = store.get(key);
      if (!hit) return null;
      return { key, size: hit.bytes?.length ?? null, uploaded: hit.uploaded || new Date(), httpMetadata: { contentType: hit.contentType } };
    },
    async delete(key) { store.delete(key); },
    async list() { return { objects: [...store.keys()].map((key) => ({ key })) }; },
  };
}

/**
 * สร้าง env จำลอง + ที่เก็บสถานะให้เทสต์เข้าถึง
 * @param {{ pdfBytes?: Uint8Array, env?: object }} [opts]
 */
export function makeMockEnv(opts = {}) {
  const orders = new Map();
  const emailLog = [];
  const leads = new Map();   // อีเมลผู้สนใจของแถม (คีย์ = อีเมล)
  const charges = new Map();
  const sentEmails = [];
  const packVersions = [];   // ทะเบียนเวอร์ชันแพ็ก (pack_versions)
  const subscribers = new Map(); // ทะเบียนลูกค้าที่ซื้อแล้ว (คีย์ = อีเมล)
  const r2 = makeR2();
  if (opts.pdfBytes) r2.store.set("prompt-pack.pdf", { bytes: opts.pdfBytes, contentType: "application/pdf" });

  const env = {
    DB: makeD1({ orders, emailLog, leads, packVersions, subscribers }),
    FILES: r2,
    PAYMENT_PROVIDER: "promptpay",
    PROMPTPAY_ID: "0812345678",           // เบอร์ตัวอย่างสำหรับเทสต์
    PROMPTPAY_NAME: "ร้านทดสอบ",
    OMISE_SECRET_KEY: "skey_test_123",
    OMISE_WEBHOOK_SECRET: btoa("my-webhook-secret-bytes"), // base64 ของ secret จาก Omise
    DOWNLOAD_SIGNING_KEY: "sign-key-dev",
    RESEND_API_KEY: "re_test_123",
    MAIL_FROM: "599 Prompt ก๊อปวาง <no-reply@example.com>",
    PRICE_SATANG: "9900",
    CURRENCY: "THB",
    PDF_OBJECT_KEY: "prompt-pack.pdf",
    DOWNLOAD_TTL_HOURS: "24",
    PRODUCT_NAME: "599 Prompt ก๊อปวาง",
    ADMIN_TOKEN: "admin-secret",
    NOTIFY_EMAIL: "shop@example.com",
    APP_ORIGIN: "https://shop.example.com",
    UPDATE_LINK_TTL_HOURS: "720",
    PACK_NOTIFY_BATCH: "20",
    ...(opts.env || {}),
  };
  return { env, orders, emailLog, leads, charges, sentEmails, r2, packVersions, subscribers };
}

/** รูป PNG 1×1 (ใช้เป็นสลิปจำลองในเทสต์/เดโม) */
export const TINY_PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0)
);

/** ทุกคำขอที่ยิงไป EasySlip (ให้เทสต์ตรวจรูปร่างคำขอได้: image vs qr, matchAmount, matchAccount) */
export const slipCalls = [];
export const resetSlipCalls = () => { slipCalls.length = 0; };

/**
 * แทน global fetch ด้วย mock ของ Omise + Resend + EasySlip (คืนฟังก์ชันเพื่อคืนค่าเดิม)
 * @param {{ charges: Map, sentEmails: Array, easySlip?: object|Function }} deps
 *   easySlip = { amount?, receiver?, matchedAccount?, transRef?, duplicate?, amountMatched?, status?, code?, message?, error?, extra? }
 *   · matchedAccount = null → จำลองว่าร้านยังไม่ได้ลงทะเบียนบัญชีผู้รับไว้ (ต้องเทียบกับช่องทางรับเงินที่ตั้งไว้เอง)
 *   · receiverObj → กำหนดก้อน receiver ทั้งก้อนเอง (ใช้ทำเดโมที่โชว์ทั้งเลขพร้อมเพย์และเลขบัญชี)
 *   หรือฟังก์ชัน async (body) => object เพื่อกำหนดคำตอบเอง (body = FormData สำหรับรูป, string JSON สำหรับโหมดข้อความ QR)
 */
export function installFetchMock({ charges, sentEmails, easySlip = null }) {
  const real = globalThis.fetch;
  slipCalls.length = 0;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.endsWith("/charges") && opts.method === "POST") {
      const body = new URLSearchParams(opts.body);
      const id = "chgt_" + Math.random().toString(36).slice(2, 10);
      const ch = {
        id, object: "charge", paid: false, amount: Number(body.get("amount")), currency: "THB",
        return_uri: body.get("return_uri"),
        metadata: { order_id: body.get("metadata[order_id]") },
        source: { type: "promptpay", qr_content: "00020101021229370016A00000067701011101130066812345678", scannable_code: { image: { download_uri: "https://cdn.example.com/qr.png" } } },
      };
      charges.set(id, ch);
      return new Response(JSON.stringify(ch), { status: 200 });
    }
    const m = u.match(/\/charges\/([^/?]+)$/);
    if (m && charges.has(m[1])) return new Response(JSON.stringify(charges.get(m[1])), { status: 200 });
    if (u === "https://api.resend.com/emails" && opts.method === "POST") {
      const body = JSON.parse(opts.body);
      sentEmails.push(body);
      return new Response(JSON.stringify({ id: "email_" + Math.random().toString(36).slice(2, 10) }), { status: 200 });
    }
    if (u.startsWith("https://api.easyslip.com/v2/verify/bank")) {
      slipCalls.push({ url: u, method: opts.method, headers: opts.headers, body: opts.body, mode: typeof opts.body === "string" ? "qr" : "image" });
      if (!easySlip) return new Response(JSON.stringify({ success: false, error: { code: "MOCK_NOT_CONFIGURED", message: "mock: ไม่ได้ตั้งค่า easySlip" } }), { status: 400 });
      const cfg = typeof easySlip === "function" ? await easySlip(opts.body) : easySlip;
      const status = cfg.status || 200;
      // เคส error ของ EasySlip v2: { success:false, error:{ code, message } }
      if (cfg.error || status >= 400) {
        return new Response(
          JSON.stringify({ success: false, error: { code: cfg.code || "ERROR", message: cfg.message || "mock error" } }),
          { status }
        );
      }
      const amount = cfg.amount ?? 99;
      const body = {
        success: true,
        data: {
          isDuplicate: !!cfg.duplicate,
          // matchedAccount = ผู้ให้บริการยืนยันว่าเป็นบัญชีที่ลงทะเบียนไว้กับคีย์ของร้าน (null = ยืนยันไม่ได้)
          matchedAccount: cfg.matchedAccount === undefined ? { account: cfg.receiver ?? "0812345678" } : cfg.matchedAccount,
          amountInOrder: amount,
          amountInSlip: amount,
          isAmountMatched: cfg.amountMatched !== false,
          rawSlip: {
            transRef: cfg.transRef ?? "TX" + Math.random().toString().slice(2, 12),
            amount: { amount, local: { amount, currency: "THB" } },
            receiver: cfg.receiverObj || { account: { name: "พรพิไล ดวงใจ" }, proxy: { type: "MSISDN", account: cfg.receiver ?? "0812345678" } },
            sender: { account: { name: "ผู้ซื้อ" } },
            date: nowSql(),
          },
          ...(cfg.extra || {}),
        },
      };
      return new Response(JSON.stringify(body), { status });
    }
    return real(url, opts);
  };
  return () => { globalThis.fetch = real; };
}

/** สร้างลายเซ็น Omise-Signature (hex) จาก base64 secret */
export async function omiseSignature(secretB64, ts, body) {
  const keyBytes = Uint8Array.from(atob(secretB64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ts + "." + body)));
  return [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** ตรวจ CRC ของ payload พร้อมเพย์ (ใช้ในเทสต์) */
export const payloadCrcOk = (payload) => crc16(payload.slice(0, -4)) === payload.slice(-4);
