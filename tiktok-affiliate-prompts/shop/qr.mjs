/**
 * qr.mjs — สร้าง QR Code แบบไม่มี dependency (ไม่ต้องโหลดไลบรารีจาก CDN)
 * รองรับเวอร์ชัน 1–10 โหมด byte (UTF-8) ระดับแก้ไขข้อผิดพลาด M
 * พอเพียงสำหรับ PromptPay payload (~83 ตัวอักษร → เวอร์ชัน 5) และข้อความสั้นทั่วไป
 *
 * ใช้: const { size, modules } = qrMatrix("000201...6304ABCD");
 *      const svg = qrSvg("000201...6304ABCD");
 */

/* ---------- GF(256) สำหรับ Reed–Solomon ---------- */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** พหุนามตัวสร้าง (x + α^0)(x + α^1)…(x + α^(deg-1)) */
function rsGenerator(deg) {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < deg; i++) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** หารพหุนาม → EC codewords */
function rsEncode(data, ecLen) {
  const gen = rsGenerator(ecLen);
  const res = new Uint8Array(ecLen);
  for (const byte of data) {
    const factor = byte ^ res[0];
    res.copyWithin(0, 1);
    res[ecLen - 1] = 0;
    if (factor !== 0) for (let i = 0; i < ecLen; i++) res[i] ^= gfMul(gen[i + 1], factor);
  }
  return res;
}

/* ---------- ตารางต่อเวอร์ชัน (ระดับ M) ----------
 * groups = [จำนวนบล็อกกลุ่ม1, ข้อมูลต่อบล็อกกลุ่ม1, จำนวนบล็อกกลุ่ม2, ข้อมูลต่อบล็อกกลุ่ม2] */
const VERSIONS = [
  null,
  { ec: 10, groups: [1, 16, 0, 0] }, // v1  (26 codewords = 16 ข้อมูล + 10 EC)
  { ec: 16, groups: [1, 28, 0, 0] }, // v2
  { ec: 26, groups: [1, 44, 0, 0] }, // v3
  { ec: 18, groups: [2, 32, 0, 0] }, // v4
  { ec: 24, groups: [2, 43, 0, 0] }, // v5  ← payload พร้อมเพย์ตกที่นี่
  { ec: 16, groups: [4, 27, 0, 0] }, // v6
  { ec: 18, groups: [4, 31, 0, 0] }, // v7
  { ec: 22, groups: [2, 38, 2, 39] }, // v8
  { ec: 22, groups: [3, 36, 2, 37] }, // v9
  { ec: 26, groups: [4, 43, 1, 44] }, // v10
];
const MAX_VERSION = 10;
const ALIGN = [
  [], [],
  [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

const dataCodewords = (version) => {
  const g = VERSIONS[version].groups;
  return g[0] * g[1] + g[2] * g[3];
};

function pickVersion(byteLen) {
  for (let v = 1; v <= MAX_VERSION; v++) {
    const countBits = v <= 9 ? 8 : 16;
    if (4 + countBits + byteLen * 8 <= dataCodewords(v) * 8) return v;
  }
  throw new Error(`ข้อความยาวเกินไปสำหรับ QR เวอร์ชัน 1–${MAX_VERSION} (${byteLen} bytes)`);
}

/** เขียนบิตข้อมูล + terminator + padding เป็น data codewords */
function encodeData(bytes, version) {
  const bits = [];
  const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  push(0b0100, 4); // โหมด byte
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);

  const capacity = dataCodewords(version) * 8;
  for (let i = 0; i < 4 && bits.length < capacity; i++) bits.push(0); // terminator
  while (bits.length % 8 !== 0) bits.push(0);
  for (let i = 0; bits.length < capacity; i++) push(i % 2 === 0 ? 0xec : 0x11, 8); // pad codewords

  const out = new Uint8Array(capacity / 8);
  for (let i = 0; i < out.length; i++) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i * 8 + j];
    out[i] = v;
  }
  return out;
}

/** แบ่งบล็อก → คำนวณ EC → สลับไบต์ (interleave) */
function makeCodewords(dataBytes, version) {
  const { ec, groups } = VERSIONS[version];
  const blocks = [];
  let off = 0;
  for (const [count, len] of [[groups[0], groups[1]], [groups[2], groups[3]]]) {
    for (let i = 0; i < count; i++) {
      const chunk = dataBytes.slice(off, off + len);
      off += len;
      blocks.push({ data: chunk, ec: rsEncode(chunk, ec) });
    }
  }
  const maxData = Math.max(...blocks.map((b) => b.data.length));
  const out = [];
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.data.length) out.push(b.data[i]);
  for (let i = 0; i < ec; i++) for (const b of blocks) out.push(b.ec[i]);
  return Uint8Array.from(out);
}

/* ---------- บิตของ format/version ---------- */
const bitLength = (n) => { let len = 0; while (n !== 0) { len++; n >>>= 1; } return len; };

/** 5 บิต (ระดับแก้ไข 2 บิต + มาสก์ 3 บิต) → 15 บิต พร้อมใช้งาน */
function formatBits(mask) {
  const G15 = 0b10100110111;
  const data = (0b00 << 3) | mask; // 00 = ระดับ M
  let d = data << 10;
  while (bitLength(d) >= 11) d ^= G15 << (bitLength(d) - 11);
  return (((data << 10) | d) ^ 0b101010000010010) & 0x7fff;
}
/** เวอร์ชัน 7 ขึ้นไป → 18 บิต */
function versionBits(version) {
  const G18 = 0b1111100100101;
  let d = version << 12;
  while (bitLength(d) >= 13) d ^= G18 << (bitLength(d) - 13);
  return (version << 12) | d;
}

const MASKS = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => (((i * j) % 3) + ((i + j) % 2)) % 2 === 0,
];

/** สร้างเมทริกซ์สำหรับมาสก์หนึ่งค่า */
function render(version, codewords, mask) {
  const size = version * 4 + 17;
  const mods = Array.from({ length: size }, () => new Array(size).fill(null));

  const setF = (row, col, dark) => { mods[row][col] = !!dark; };

  // finder 3 มุม (+ separator สีอ่อน)
  const finder = (r0, c0) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = r0 + r, cc = c0 + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const inFinder = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const dark = inFinder && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        setF(rr, cc, dark);
      }
    }
  };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

  // timing pattern
  for (let i = 8; i < size - 8; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }

  // alignment pattern
  for (const r of ALIGN[version]) {
    for (const c of ALIGN[version]) {
      const onFinder = (r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6);
      if (onFinder) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
        setF(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
      }
    }
  }

  // จองพื้นที่ format info (เขียนค่าจริงอีกครั้งหลังเลือกมาสก์) + dark module
  const writeFormat = (m) => {
    const bits = formatBits(m);
    for (let i = 0; i < 15; i++) {
      const dark = ((bits >> i) & 1) === 1;
      if (i < 6) setF(i, 8, dark);
      else if (i < 8) setF(i + 1, 8, dark);
      else setF(size - 15 + i, 8, dark);
      if (i < 8) setF(8, size - i - 1, dark);
      else if (i < 9) setF(8, 15 - i, dark);
      else setF(8, 15 - i - 1, dark);
    }
    setF(size - 8, 8, true); // dark module (ต้องเป็นดำเสมอ)
  };
  writeFormat(0);

  // version info (เวอร์ชัน 7 ขึ้นไป)
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >> i) & 1) === 1;
      setF(Math.floor(i / 3), (i % 3) + size - 11, dark);
      setF((i % 3) + size - 11, Math.floor(i / 3), dark);
    }
  }

  // วางข้อมูลแบบซิกแซกจากขวาล่าง
  const maskFn = MASKS[mask];
  let inc = -1, row = size - 1, bitIndex = 7, byteIndex = 0;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (;;) {
      for (let c = 0; c < 2; c++) {
        if (mods[row][col - c] === null) {
          let dark = byteIndex < codewords.length ? ((codewords[byteIndex] >>> bitIndex) & 1) === 1 : false;
          if (maskFn(row, col - c)) dark = !dark;
          mods[row][col - c] = dark;
          bitIndex--;
          if (bitIndex === -1) { byteIndex++; bitIndex = 7; }
        }
      }
      row += inc;
      if (row < 0 || row >= size) { row -= inc; inc = -inc; break; }
    }
  }

  writeFormat(mask);
  return mods;
}

/** คะแนนโทษ (ยิ่งน้อยยิ่งดี) ตามกติกา 4 ข้อของมาตรฐาน QR */
function penalty(mods) {
  const size = mods.length;
  let points = 0;
  const at = (r, c) => (mods[r][c] ? 1 : 0);

  // 1) แถว/คอลัมน์ที่มีสีเดียวกันติดกัน ≥ 5
  for (let r = 0; r < size; r++) {
    for (const isRow of [true, false]) {
      let run = 1;
      for (let i = 1; i < size; i++) {
        const cur = isRow ? at(r, i) : at(i, r);
        const prev = isRow ? at(r, i - 1) : at(i - 1, r);
        if (cur === prev) {
          run++;
          if (i === size - 1 && run >= 5) points += 3 + (run - 5);
        } else {
          if (run >= 5) points += 3 + (run - 5);
          run = 1;
        }
      }
    }
  }
  // 2) บล็อก 2×2 สีเดียวกัน
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = at(r, c);
      if (v === at(r, c + 1) && v === at(r + 1, c) && v === at(r + 1, c + 1)) points += 3;
    }
  }
  // 3) ลาย 1:1:3:1:1 (10111010000 / 00001011101) ปรากฏในแนวแถวหรือคอลัมน์
  const P1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const P2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const hit = (get, start) => {
    let a = true, b = true;
    for (let i = 0; i < 11; i++) {
      const v = get(start + i);
      if (v !== P1[i]) a = false;
      if (v !== P2[i]) b = false;
    }
    return a || b;
  };
  for (let r = 0; r < size; r++) {
    const rowGet = (i) => at(r, i);
    const colGet = (i) => at(i, r);
    for (let s = 0; s <= size - 11; s++) {
      if (hit(rowGet, s)) points += 40;
      if (hit(colGet, s)) points += 40;
    }
  }
  // 4) สัดส่วนโมดูลดำเบี่ยงจาก 50% (ทุก 5% = 10 คะแนน)
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += at(r, c);
  points += Math.trunc(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
  return points;
}

/**
 * สร้างเมทริกซ์ QR
 * @param {string} text
 * @returns {{ size: number, modules: number[][], version: number, mask: number }}
 */
export function qrMatrix(text) {
  const bytes = new TextEncoder().encode(String(text));
  const version = pickVersion(bytes.length);
  const codewords = makeCodewords(encodeData(bytes, version), version);

  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const mods = render(version, codewords, mask);
    const p = penalty(mods);
    if (!best || p < best.points) best = { mask, mods, points: p };
  }
  return {
    version,
    mask: best.mask,
    size: best.mods.length,
    modules: best.mods.map((row) => row.map((v) => (v ? 1 : 0))),
  };
}

/**
 * เรนเดอร์เป็น SVG (ไม่พึ่งบริการภายนอก — payload ไม่รั่วไปที่อื่น)
 * @param {string} text
 * @param {{ scale?: number, margin?: number, dark?: string, light?: string, alt?: string }} [opts]
 */
export function qrSvg(text, opts = {}) {
  const { scale = 8, margin = 4, dark = "#111111", light = "#ffffff", alt = "QR code" } = opts;
  const { size, modules } = qrMatrix(text);
  const dim = (size + margin * 2) * scale;

  let path = "";
  for (let r = 0; r < size; r++) {
    let c = 0;
    while (c < size) {
      if (modules[r][c]) {
        let run = 1;
        while (c + run < size && modules[r][c + run]) run++;
        path += `M${(c + margin) * scale} ${(r + margin) * scale}h${run * scale}v${scale}h${-run * scale}z`;
        c += run;
      } else c++;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}" role="img" aria-label="${alt}" shape-rendering="crispEdges">` +
    `<rect width="${dim}" height="${dim}" fill="${light}"/>` +
    `<path d="${path}" fill="${dark}"/></svg>`;
}
