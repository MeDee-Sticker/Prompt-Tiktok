/**
 * promptpay.mjs — สร้าง payload QR พร้อมเพย์ (Thai QR / EMVCo) แบบไม่มี dependency
 * รองรับ 4 แบบ: เบอร์โทร · เลขบัตรประชาชน · e-Wallet · เลขบัญชีธนาคาร (ต้องมีรหัสธนาคาร)
 *
 * โครงสร้าง payload (TLV: ID 2 หลัก + ความยาว 2 หลัก + ค่า):
 *   00 = "01"  (Payload Format Indicator)
 *   01 = "12"  (ระบุยอด = QR แบบไดนามิก) / "11" = ไม่ระบุยอด
 *   29 = ข้อมูลบัญชีผู้รับ  → 00 = AID "A000000677010111"
 *                             01 = เบอร์โทร (0066 + 9 หลัก), 02 = เลขบัตรประชาชน 13 หลัก, 03 = e-Wallet 15 หลัก
 *                             04 = เลขบัญชีธนาคาร = รหัสธนาคาร 3 หลัก + เลขบัญชี (เช่น "0141234567890")
 *   53 = "764" (สกุลบาท)
 *   54 = ยอดเงิน เช่น "99.00"
 *   58 = "TH"
 *   63 = CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) ของทุกตัวอักษรก่อนหน้า + "6304"
 */

/** รหัสธนาคาร 3 หลักที่ใช้ในพร้อมเพย์ (ตาม Thai QR Payment Standard / ธปท.) */
export const BANK_CODES = {
  "002": "ธ.กรุงเทพ (BBL)",
  "004": "ธ.กสิกรไทย (KBank)",
  "006": "ธ.กรุงไทย (KTB)",
  "065": "ธ.ทีเอ็มบีธนชาต (ttb · บัญชีเดิมธนชาต)",
  "011": "ธ.ทีเอ็มบีธนชาต (ttb)",
  "014": "ธ.ไทยพาณิชย์ (SCB)",
  "017": "ธ.ซิตี้แบงก์ (Citibank)",
  "020": "ธ.สแตนดาร์ดชาร์เตอร์ด (SCB)",
  "022": "ธ.ซีไอเอ็มบี (CIMB)",
  "024": "ธ.ยูโอบี (UOB)",
  "025": "ธ.กรุงศรีอยุธยา (BAY)",
  "030": "ธ.อิสลามแห่งประเทศไทย (IBANK)",
  "033": "ธ.อาคารสงเคราะห์ (GHB)",
  "034": "ธ.เพื่อการเกษตรและสหกรณ์ (BAAC)",
  "066": "ธ.ออมสิน (GSB)",
  "067": "ธ.ทิสโก้ (TISCO)",   // ⚠️ เดิมระบุผิดว่าเป็น ttb — ตรวจ 16 ต.ค. 2026: ttb ใช้ 011 (ธนชาตเดิม = 065) · 067 = ทิสโก้
  "069": "ธ.เกียรตินาคินภัทร (KKP)",
  "071": "ธ.ไทยเครดิต (TCD)",
  "073": "ธ.แลนด์ แอนด์ เฮ้าส์ (LH Bank)",
  "098": "ธ.พัฒนาวิสาหกิจขนาดกลางและขนาดย่อม (SME D Bank)",
};

/** เหลือแค่ตัวเลข (ตัดขีด/ช่องว่าง) — เลขบัญชีแบบ xxx-x-xxxxx-x จึงใช้ได้ */
export const onlyDigits = (s) => String(s ?? "").replace(/\D/g, "");

/** TLV หนึ่งฟิลด์: id (2 หลัก) + ความยาว (2 หลัก) + ค่า */
export const tlv = (id, value) => id + String(value.length).padStart(2, "0") + value;

/**
 * แปลงรหัสพร้อมเพย์ที่ผู้ใช้กรอกให้เป็นรูปแบบที่ใช้ใน QR
 * @param {string} raw เบอร์โทร / เลขบัตรประชาชน / เลข e-Wallet / เลขบัญชีธนาคาร
 * @param {string} [bank] รหัสธนาคาร 3 หลัก — ถ้าใส่มา จะตีความ `raw` เป็นเลขบัญชีธนาคาร (แท็ก 04)
 * @returns {{tag: string, value: string, type: string, bank?: string, account?: string} | null}
 *   tag ในเทมเพลต 29: 01=มือถือ, 02=บัตรประชาชน, 03=e-Wallet, 04=บัญชีธนาคาร
 */
export function normalizePromptPayId(raw, bank = "") {
  const digits = onlyDigits(raw);
  if (!digits) return null;
  const bankCode = onlyDigits(bank);
  if (bankCode) {
    // เลขบัญชีธนาคาร: ต้องมีรหัสธนาคาร 3 หลักกำกับ (ในแท็ก 04 เก็บรหัสธนาคารต่อหน้าเลขบัญชีทันที)
    if (bankCode.length !== 3) return null;
    if (digits.length < 6 || digits.length > 40) return null;
    return { tag: "04", value: bankCode + digits, type: "bank-account", bank: bankCode, account: digits };
  }
  if (digits.length === 15) return { tag: "03", value: digits, type: "e-wallet" };
  if (digits.length === 13) return { tag: "02", value: digits, type: "national-id" };
  // เบอร์มือถือ: 0812345678 (10) · 66812345678 (11) · 812345678 (9)
  if (digits.length === 10 && digits.startsWith("0")) return { tag: "01", value: "0066" + digits.slice(1), type: "mobile" };
  if (digits.length === 9) return { tag: "01", value: "0066" + digits, type: "mobile" };
  if (digits.length === 11 && digits.startsWith("66")) return { tag: "01", value: "00" + digits, type: "mobile" };
  return null;
}

/** CRC-16/CCITT-FALSE → hex 4 ตัวพิมพ์ใหญ่ */
export function crc16(input) {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * สร้างสตริง payload สำหรับ QR พร้อมเพย์
 * @param {{ id: string, bank?: string, amountSatang?: number|string|null }} opts
 */
export function buildPromptPayPayload({ id, bank = "", amountSatang = null }) {
  const acc = normalizePromptPayId(id, bank);
  if (!acc) {
    throw new Error(
      bank
        ? "รหัสพร้อมเพย์ไม่ถูกต้อง — โหมดเลขบัญชีธนาคารต้องมีรหัสธนาคาร 3 หลัก และเลขบัญชี 6–40 หลัก"
        : "รหัสพร้อมเพย์ไม่ถูกต้อง — ต้องเป็นเบอร์โทร 10 หลัก · เลขบัตรประชาชน 13 หลัก · หรือใส่ PROMPTPAY_BANK ถ้าใช้เลขบัญชีธนาคาร"
    );
  }

  const merchant = tlv("00", "A000000677010111") + tlv(acc.tag, acc.value);
  const amount = amountSatang == null ? null : (Number(amountSatang) / 100).toFixed(2);

  let out = tlv("00", "01") + tlv("01", amount ? "12" : "11") + tlv("29", merchant) + tlv("53", "764");
  if (amount) out += tlv("54", amount);
  out += tlv("58", "TH");
  const withCrcTag = out + "6304";
  return withCrcTag + crc16(withCrcTag);
}

/** แสดงรหัสแบบปิดบางส่วน (ใช้บนหน้าเว็บ ไม่ต้องโชว์เลขเต็ม) */
export function maskPromptPayId(raw, bank = "") {
  const acc = normalizePromptPayId(raw, bank);
  if (!acc) return "";
  if (acc.type === "mobile") {
    // value = "0066" + 9 หลัก → ทำเป็นรูปแบบไทย 0XXXXXXXXX แล้วปิดกลาง (ลูกค้าจำได้ว่าเป็นเบอร์ร้านตัวเอง)
    const local = "0" + acc.value.slice(4);
    return `${local.slice(0, 3)}-xxx-${local.slice(-4)}`;
  }
  if (acc.type === "bank-account") {
    // หน้าตาเหมือนในแอปธนาคาร: xxx-x-x4442-x
    const a = acc.account;
    if (a.length === 10) return `xxx-x-x${a.slice(5, 9)}-x`;
    return "xxxx-x-x" + a.slice(-4);
  }
  return "xxx-xxx-" + acc.value.slice(-4);
}

/** ชื่อธนาคารจากรหัส 3 หลัก (สำหรับป้ายชื่อที่โชว์ให้ลูกค้า) */
export const bankName = (code) => BANK_CODES[onlyDigits(code)] || `ธนาคาร ${onlyDigits(code)}`;

/**
 * ป้ายชื่อช่องทางรับเงินที่โชว์ให้ลูกค้า
 * ⚠️ นโยบายร้าน (16 ต.ค. 2026): **โชว์แค่ชื่อบัญชี** — ไม่บอกว่าเป็นพร้อมเพย์แบบไหน (เบอร์/บัตร ปชช./บัญชีธนาคาร)
 *    และไม่โชว์เลขแม้จะปิดบางส่วน เพราะข้อมูลนั้นไม่ได้ทำให้ลูกค้าโอนสะดวกขึ้น (สแกน QR ได้เลย)
 *    → ส่ง `name` (เช่น `env.PROMPTPAY_NAME`) มาเพื่อใช้เป็นป้าย · ไม่ส่ง = ป้ายกลาง ๆ ที่ไม่เปิดเผยอะไร
 *    (เลขปิดบางส่วนยังอยู่ในฟิลด์ `masked` เฉพาะสำหรับหลังบ้าน/เครื่องมือตรวจของร้านเท่านั้น)
 */
export function promptPayOptionLabel(acc, name = "") {
  const label = String(name ?? "").trim();
  if (label) return label;
  return acc ? "บัญชีรับเงินของร้าน" : "";
}

/** hash สั้นแบบ deterministic (FNV-1a 32-bit) — ใช้ทำ key ของช่องทางโดยไม่โชว์เลขจริง */
const shortHash = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
};

/**
 * แปลงรายการช่องทางรับเงินของร้านเป็น options ที่ใช้ทั้งหน้าเว็บ/checkout/หลังบ้าน
 * รูปแบบ: `เลขบัตรประชาชน/เบอร์พร้อมเพย์, เลขบัญชี@รหัสธนาคาร` เช่น `1330500240201, 0880754039` หรือ `0452944429@004` (เลขบัญชีต้องมี @รหัสธนาคารเสมอ)
 * ถ้ารายการไหนไม่ระบุ @bank จะใช้ `bank` ที่ส่งมาเป็นค่าเริ่มต้น
 * @param {string} name ชื่อบัญชีผู้รับ (ถ้าส่งมา จะใช้เป็น `label` ที่โชว์ให้ลูกค้า — ป้ายที่เหลือจะไม่บอกว่าเป็นพร้อมเพย์แบบไหน)
 * @param {string|string[]} labels ป้ายชื่อของแต่ละช่องทาง (ไม่บังคับ · ใช้ตอนมีหลายช่องทางและอยากให้ลูกค้าแยกออกโดยไม่บอกชนิด/เลข)
 *        ส่งเป็นข้อความคั่นด้วย `|` เช่น `"ช่องทางหลัก|ช่องทางสำรอง"` — จับคู่ตามลำดับเดียวกับ `raw` (เว้นว่างได้ ⇒ ใช้ชื่อบัญชีจาก `name` แทน)
 * @returns {Array<{key:string,id:string,bank:string|null,tag:string,value:string,type:string,masked:string,label:string}>}
 */
export function parsePromptPayOptions(raw, bank = "", name = "", labels = "") {
  // จับป้ายคู่กับ “รายการดิบ” ตามลำดับ (ใช้ `|` เป็นตัวคั่น เพราะ `,` ถูกใช้คั่นรายการช่องทางแล้ว)
  // → ถ้ารายการไหนพิมพ์ผิด/ถูกข้าม ป้ายของรายการอื่นจะไม่เหลื่อม
  const labelList = Array.isArray(labels) ? labels : String(labels ?? "").split("|");
  const out = [];
  String(raw ?? "").split(/[,\n;]+/).forEach((part, i) => {
    const piece = part.trim();
    if (!piece) return;
    const [idPart, bankPart = ""] = piece.split("@");
    const useBank = String(bankPart || bank || "").trim();
    const acc = normalizePromptPayId(idPart.trim(), useBank);
    if (!acc) return;
    // key แบบ hash → หน้าเว็บ/หลังบ้านอ้างช่องทางได้โดยไม่ต้องโชว์เลขเต็ม
    const key = `${acc.type}:${shortHash(acc.value)}`;
    if (out.some((o) => o.key === key)) return; // กันซ้ำ
    const masked = maskPromptPayId(idPart.trim(), useBank);
    const customLabel = String(labelList[i] ?? "").trim();
    out.push({
      key,
      id: onlyDigits(idPart),
      bank: acc.bank || null,
      tag: acc.tag,
      value: acc.value,
      type: acc.type,
      masked,
      label: customLabel || promptPayOptionLabel({ type: acc.type, bank: acc.bank, masked }, name),
    });
  });
  return out;
}

/* ---------- เทียบ “บัญชีผู้รับในสลิป” กับช่องทางรับเงินของร้าน ----------
 * สลิปจริงจากธนาคารปิดเลขเกือบทั้งหมด (receiver.account.proxy.account = "XXXXXXXXX0201"
 * หรือเลขบัญชี "XXX-X-XX146-0") → เทียบเลขเต็มตรง ๆ ไม่ได้ ต้องเทียบ “ประเภท + เลขท้ายที่มองเห็น”
 * ใช้ร่วมกันทั้ง worker.js (อนุมัติอัตโนมัติ) และ tools/check-easyslip.mjs (ตรวจก่อนขาย)
 */

/** เลขที่อาจโชว์ในสลิปของผู้รับช่องทางนี้ (สลิปโชว์ได้หลายรูปแบบ: มี/ไม่มี 0 นำหน้า, 66 แทน 0) */
export const payProxyVariants = (acc) => {
  const out = [acc?.value];
  if (acc?.type === "mobile") out.push("0" + acc.value.slice(4), acc.value.slice(-9));
  if (acc?.type === "bank-account") out.push(acc.id, acc.id.slice(-4));
  return out.filter(Boolean);
};

/** ประเภทผู้รับที่ EasySlip ส่งมา (NATID/MSISDN/EWALLET/BANKAC) → ประเภทช่องทางรับเงินของร้าน */
const SLIP_RECEIVER_TYPES = { NATID: "national-id", MSISDN: "mobile", EWALLET: "e-wallet", BANKAC: "bank-account", BANK: "bank-account" };

/** อ่าน “ค่าผู้รับ” ทั้งหมดจากก้อน receiver ของผู้ให้บริการ (รองรับหลายโครงสร้าง + เลขที่ถูกปิด) */
export function slipReceiverValues(receiver = {}) {
  const out = [];
  const add = (value, kind = "") => {
    const text = String(value ?? "").trim();
    if (onlyDigits(text).length < 4) return;                 // เลขผู้รับต้องมีตัวเลขอย่างน้อย 4 หลัก
    const type = SLIP_RECEIVER_TYPES[String(kind).toUpperCase()] || null;
    out.push({ text, type, masked: /[Xx*]/.test(text) });
  };
  const acc = receiver?.account || {};
  add(acc.proxy?.account ?? acc.proxy?.value, acc.proxy?.type);      // พร้อมเพย์: "XXXXXXXXX0201" · type = NATID/MSISDN
  add(acc.bank?.account ?? acc.bank?.number, acc.bank?.type || "BANKAC"); // เลขบัญชี: "XXX-X-XX146-0"
  add(acc.number ?? acc.accountNumber, acc.type);                    // บางโครงสร้างใช้ account.number
  add(receiver?.proxy?.account ?? receiver?.proxy?.value, receiver?.proxy?.type);
  if (typeof receiver === "string") add(receiver);                   // เผื่อส่งมาเป็นเลขล้วน
  return out;
}

/**
 * สลิปใบนี้โอนเข้าบัญชี/พร้อมเพย์ของร้านจริงไหม
 * @param {object|string} receiver ก้อน receiver จาก EasySlip
 * @param {Array} options ช่องทางรับเงินของร้าน (ผลจาก parsePromptPayOptions)
 */
/** ท่อนตัวเลขที่ยังมองเห็นในสลิปที่ปิดเลข — "XXXXXXXXX0201" → ["0201"] · "XXX-X-XX146-0" → ["1460"] · "xxx-x-x4442-x" → ["4442"] */
const visibleRuns = (maskedText) =>
  String(maskedText)
    .split(/[Xx*]+/)
    .map(onlyDigits)
    .filter((s) => s.length >= 2);

/** เลขเต็มของร้าน “ตรงกับท่อนที่มองเห็นในสลิป” ไหม (ท่อนต้องโผล่เรียงตามลำดับ และเห็นรวม ≥ 4 หลัก) */
const maskedDigitsMatch = (runs, full) => {
  if (runs.reduce((n, s) => n + s.length, 0) < 4) return false;
  let at = 0;
  for (const run of runs) {
    const hit = full.indexOf(run, at);
    if (hit < 0) return false;
    at = hit + run.length;
  }
  return true;
};

export function slipReceiverMatches(receiver, options = []) {
  const got = slipReceiverValues(receiver);
  if (!got.length) return false;
  return got.some((r) =>
    options.some((opt) => {
      // เลขถูกปิด → ต้องรู้ “ประเภท” และต้องตรงกับช่องทางนั้นก่อน (พร้อมเพย์บัตร ปชช. ≠ เบอร์มือถือ)
      if (r.masked && r.type && opt.type !== r.type) return false;
      const seen = onlyDigits(r.text);
      const runs = r.masked ? visibleRuns(r.text) : [];
      return payProxyVariants(opt).some((p) => {
        const full = onlyDigits(p);
        if (!full) return false;
        if (r.text.includes(p) || seen.includes(full)) return true;  // เห็นเลขเต็มในสลิป
        // เลขถูกปิด (XXXXXXXXX0201 · XXX-X-XX146-0 · xxx-x-x4442-x) → เทียบเฉพาะท่อนที่มองเห็น
        return !!runs.length && maskedDigitsMatch(runs, full);
      });
    })
  );
}

/** ตรวจว่าสตริง payload ที่สร้างขึ้นถูกต้องตามโครงสร้าง + CRC ตรง */
export function inspectPayload(payload) {
  const fields = {};
  let i = 0;
  while (i + 4 <= payload.length) {
    const id = payload.slice(i, i + 2);
    const len = Number(payload.slice(i + 2, i + 4));
    fields[id] = payload.slice(i + 4, i + 4 + len);
    i += 4 + len;
    if (id === "63") break;
  }
  const body = payload.slice(0, payload.length - 4);
  // แยกเทมเพลต 29 ออกเป็นแท็กย่อย (01/02/03/04) เพื่อดูว่าใช้พร้อมเพย์แบบไหน
  const sub = {};
  const merchant = fields["29"] || "";
  for (let i = 0; i + 4 <= merchant.length; ) {
    const id = merchant.slice(i, i + 2);
    const len = Number(merchant.slice(i + 2, i + 4));
    sub[id] = merchant.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  const proxyType = sub["01"] ? "mobile" : sub["02"] ? "national-id" : sub["03"] ? "e-wallet" : sub["04"] ? "bank-account" : null;
  return {
    fields,
    crcValid: crc16(body) === payload.slice(-4),
    merchant,
    merchantSub: sub,
    aid: sub["00"] || null,
    proxyType,
    bank: proxyType === "bank-account" ? (sub["04"] || "").slice(0, 3) : null,
    account: proxyType === "bank-account" ? (sub["04"] || "").slice(3) : null,
    amount: fields["54"] || null,
    currency: fields["53"] || null,
    country: fields["58"] || null,
    dynamic: fields["01"] === "12",
  };
}
