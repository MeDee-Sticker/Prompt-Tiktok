# สร้าง prompt-pack.pdf จากไฟล์ Markdown ของแพ็ก — รัน: .venv/bin/python build_pdf.py
import re, glob, os, subprocess
from fpdf import FPDF

ROOT = os.path.join(os.path.dirname(__file__), "..")
BUILD = os.path.join(os.path.dirname(__file__), "build")

# ---------- เวอร์ชันแพ็ก: อ่านจาก pack-version.mjs (แหล่งความจริงเดียว ห้าม hardcode ที่นี่) ----------
def _read_pack_version():
    """ดึง PACK_RELEASE จาก pack-version.mjs เพื่อให้เวอร์ชันในไฟล์ PDF ตรงกับที่ worker/หน้าเว็บใช้"""
    path = os.path.join(os.path.dirname(__file__), "pack-version.mjs")
    src = open(path, encoding="utf-8").read()
    m = re.search(r'PACK_RELEASE\s*=\s*\{(.*?)\n\}', src, re.S)
    if not m:
        raise SystemExit("อ่าน PACK_RELEASE จาก pack-version.mjs ไม่ได้ — ตรวจรูปแบบไฟล์")
    block = m.group(1)
    out = {}
    for key in ("version", "title", "updated_at"):
        km = re.search(key + r'\s*:\s*"([^"]*)"', block)
        if not km:
            raise SystemExit(f"ไม่พบ {key} ใน pack-version.mjs")
        out[key] = km.group(1)
    return out


_PACK = _read_pack_version()
VERSION = _PACK["version"]              # ← แก้ที่ pack-version.mjs ไม่ใช่ที่นี่
PACK_UPDATED_AT = _PACK["updated_at"]
SHOP_NAME = "Kopwang"
SHOP_EMAIL = "support@kopwang.com"
# โดเมนจริงของร้าน (ผูกแล้ว 17 ต.ค. 2026) — ใช้ทั้งข้อความชวนเพื่อน, บรรทัด “ซื้อซ้ำ” และ QR บนปกหลัง
SHOP_URL = "https://kopwang.com"

class PDF(FPDF):
    plain_pages = ()      # หน้าที่ไม่ต้องมีหัว/ท้ายกระดาษ (ปกหน้า/ปกหลัง)
    def header(self):
        if self.page_no() in self.plain_pages: return
        self.set_font("Sarabun", "", 8)
        self.set_text_color(140, 140, 150)
        self.cell(0, 6, "599 Prompt ก๊อปวาง — TikTok Affiliate", align="L")
        self.ln(8)
    def footer(self):
        if self.page_no() in self.plain_pages: return   # ปกไม่มีเลขหน้า
        self.set_y(-14); self.set_font("Sarabun", "", 8); self.set_text_color(140,140,150)
        self.cell(0, 8, f"- {self.page_no()} -", align="C")

pdf = PDF(format="A4")
pdf.set_auto_page_break(auto=True, margin=18)
pdf.add_font("Sarabun", "", "fonts/Sarabun-Regular.ttf")
pdf.add_font("Sarabun", "B", "fonts/Sarabun-Bold.ttf")
pdf.add_font("Sarabun", "I", "fonts/Sarabun-SemiBold.ttf")
pdf.set_margins(18, 18, 18)

import unicodedata
BOX = {"├":"+", "─":"-", "│":"|", "└":"`", "┬":"+", "┴":"+", "┐":"-", "┌":"-", "┘":"-", "┤":"+", "»":">", "«":"<", "⚠":"!", "️":"", "‍":""}
def sanitize(text):
    for k,v in BOX.items(): text = text.replace(k,v)
    return "".join(ch for ch in text if unicodedata.category(ch) not in ("So","Cs") and not (0x1F000 <= ord(ch) <= 0x1FAFF))
def clean(line):
    line = re.sub(r"^#+\s*", "", line)
    line = line.replace("**", "").replace("`", "").replace("__", "").replace("*", "")
    return sanitize(line).strip()

def emit(lines, size=11, gap=5.6, mono=False):
    pdf.set_font("Sarabun", "", 9 if mono else size)
    pdf.set_text_color(30,30,36)
    for ln in lines:
        if pdf.get_y() > 275: pdf.add_page()
        if mono:
            pdf.set_fill_color(246,243,238)
            pdf.multi_cell(0, gap, sanitize(ln) if ln else " ", fill=True, new_x="LMARGIN", new_y="NEXT")
        else:
            pdf.multi_cell(0, gap, sanitize(ln) if ln else " ", new_x="LMARGIN", new_y="NEXT")

def add_md(path):
    pdf.add_page()
    in_code = False; buf = []
    for raw in open(path, encoding="utf-8").read().splitlines():
        if raw.startswith("```"):
            if in_code: emit(buf, mono=True); buf = []
            in_code = not in_code; continue
        if in_code: buf.append(raw); continue
        s = raw.rstrip()
        if not s.strip(): continue
        if s.startswith("# "):
            pdf.set_font("Sarabun","B",20); pdf.set_text_color(255,61,0)
            pdf.multi_cell(0, 9, clean(s), new_x="LMARGIN", new_y="NEXT"); pdf.ln(2)
        elif s.startswith("## "):
            pdf.ln(2); pdf.set_font("Sarabun","B",15); pdf.set_text_color(20,20,26)
            pdf.multi_cell(0, 8, clean(s), new_x="LMARGIN", new_y="NEXT"); pdf.ln(1)
        elif s.startswith("### "):
            pdf.set_font("Sarabun","B",13); pdf.set_text_color(60,60,70)
            pdf.multi_cell(0, 7, clean(s), new_x="LMARGIN", new_y="NEXT")
        elif s.startswith("> "):
            pdf.set_font("Sarabun","",10); pdf.set_text_color(150,80,30)
            pdf.multi_cell(0, 5.4, clean(s[2:]), new_x="LMARGIN", new_y="NEXT"); pdf.set_text_color(30,30,36)
        elif re.match(r"^[-*] ", s):
            pdf.set_font("Sarabun","",11); pdf.set_text_color(30,30,36)
            pdf.multi_cell(0, 5.6, "   • " + clean(s[2:]), new_x="LMARGIN", new_y="NEXT")
        else:
            emit([clean(s)])

# ---------- โทนสี (ดำ-ส้ม) ----------
BLACK  = (10, 10, 13)
CARBON = (24, 24, 30)
ORANGE = (255, 61, 0)
WHITE  = (255, 255, 255)
DIM    = (176, 176, 188)
W, H = 210, 297

def plain_page():
    """เพิ่มหน้าใหม่แบบไม่มีหัว/ท้ายกระดาษ (ต้องตั้งค่าก่อน add_page เพราะ header/footer ถูกเรียกตอนเพิ่มหน้า)"""
    pdf.plain_pages = tuple(pdf.plain_pages) + (pdf.page_no() + 1,)
    pdf.add_page()

def dark_page():
    pdf.set_fill_color(*BLACK); pdf.rect(0, 0, W, H, "F")
    pdf.set_fill_color(*ORANGE); pdf.rect(0, 0, W, 7, "F"); pdf.rect(0, H - 7, W, 7, "F")

def center(text, y, font="", size=11, color=WHITE, h=7, x=18, w=174):
    pdf.set_xy(x, y); pdf.set_font("Sarabun", font, size); pdf.set_text_color(*color)
    pdf.cell(w, h, text, align="C")

def left(text, y, size=11, color=WHITE, font="", x=18, w=174, h=6.5):
    pdf.set_xy(x, y); pdf.set_font("Sarabun", font, size); pdf.set_text_color(*color)
    pdf.cell(w, h, text)

def bullet(text, y, size=11, gap=7.6, x=16):
    pdf.set_xy(x, y); pdf.set_font("Sarabun", "", size); pdf.set_text_color(*ORANGE)
    pdf.cell(7, gap, "•")
    pdf.set_text_color(*WHITE)
    # align="L" สำคัญ: multi_cell ปกติเป็น justify → ข้อความไทย/อังกฤษผสมจะเว้นวรรคแปลก
    pdf.multi_cell(169, gap, sanitize(text), align="L", new_x="LMARGIN", new_y="NEXT")
    return pdf.get_y() + 1.2

def make_share_qr(url, out):
    """สร้าง QR ของลิงก์ร้านด้วย qr.mjs ตัวเดียวกับที่เว็บใช้ (ไม่ก๊อปตรรกะ QR มาซ้ำ)"""
    js = (
        "import fs from 'node:fs';"
        f"import('./qr.mjs').then(m => fs.writeFileSync({out!r}, m.qrSvg({url!r}, {{ scale: 8, margin: 4, alt: 'QR ร้าน' }})))"
        ".catch(e => { console.error(e.message); process.exit(1); });"
    )
    try:
        r = subprocess.run(["node", "--input-type=module", "-e", js],
                           cwd=os.path.dirname(__file__), capture_output=True, text=True, timeout=30)
        if r.returncode == 0 and os.path.exists(out):
            return out
        print("!! สร้าง QR ไม่ได้ (ข้ามไป):", (r.stderr or "").strip()[:120])
    except Exception as e:
        print("!! สร้าง QR ไม่ได้ (ข้ามไป):", e)
    return None

# ================= หน้าปกหน้า (โทนดำ-ส้ม) =================
plain_page()
dark_page()
center("TIKTOK SHOP AFFILIATE · คอนเทนต์ปักตะกร้า", 34, size=10.5, color=ORANGE)
center("599 PROMPT", 62, "B", 54, WHITE, 24)
center("ก๊อปวาง", 90, "B", 50, ORANGE, 22)
pdf.set_fill_color(*ORANGE); pdf.rect(70, 122, 70, 0.9, "F")
center("ชุดเดียวจบ · ก๊อปไปวาง ได้สคริปต์พร้อมถ่าย", 132, "B", 15, WHITE, 8)

# คำโปรย (ขาย)
for i, line in enumerate([
    "ไม่ต้องเป็นนักเขียน ไม่ต้องมีไอเดียใหม่ และไม่ต้องเก่งอังกฤษ",
    "เลือกสินค้า → ก๊อป prompt → วางใน AI → ได้สคริปต์ปักตะกร้าทันที",
    "ใช้ซ้ำได้ทุกสินค้า 26 หมวดขายดี × 23 มุมคอนเทนต์ สองภาษา TH/EN",
]):
    center(line, 158 + i * 10, size=12, color=DIM, h=7)

# กล่องสถิติ
pdf.set_fill_color(*CARBON); pdf.rect(18, 205, 174, 30, "F")
pdf.set_fill_color(*ORANGE); pdf.rect(18, 205, 2, 30, "F")
for i, (num, label) in enumerate([("599", "ชุด Prompt"), ("26", "หมวดสินค้า"), ("2", "ภาษา TH/EN")]):
    cx = 20 + i * 56
    pdf.set_xy(cx, 210); pdf.set_font("Sarabun", "B", 21); pdf.set_text_color(*ORANGE)
    pdf.cell(56, 11, num, align="C")
    pdf.set_xy(cx, 224); pdf.set_font("Sarabun", "", 9); pdf.set_text_color(*WHITE)
    pdf.cell(56, 6, label, align="C")

center("อัปเดตเวอร์ชันใหม่ให้ฟรี · ใช้ได้กับ ChatGPT / Claude / Gemini", 250, "B", 11, ORANGE)
center(f"เวอร์ชัน {VERSION} (อัปเดต {PACK_UPDATED_AT}) · โดย {SHOP_NAME} · ไฟล์นี้ใช้คู่กับคู่มือ MANUAL.md", 260, size=9.5, color=DIM)

# ================= เนื้อหา =================
for name in ["README.md","00_master-template.md","MANUAL.md"]:
    p = os.path.join(ROOT,name)
    if os.path.exists(p): add_md(p)
for p in sorted(glob.glob(os.path.join(ROOT,"prompts","*.md"))): add_md(p)
for p in sorted(glob.glob(os.path.join(ROOT,"examples","*.md"))): add_md(p)

# ================= ปกหลัง (คำโปรยขายต่อ · ชวนแชร์ · ช่องทางติดต่อร้าน) =================
plain_page()
dark_page()

center("ขอบคุณที่ใช้ชุดนี้ · THANK YOU", 20, "B", 10.5, ORANGE)
center("ใช้ให้ครบ 599 ชุด แล้วเทียบยอดวิวของตัวเอง", 32, "B", 23, WHITE, 13)

for i, line in enumerate([
    "ลูกค้าส่วนใหญ่ใช้แค่ 5–10 ชุดแรกแล้วหยุด — แต่ค่าเต็ม ๆ ของชุดนี้อยู่ที่ “มุมที่ยังไม่เคยทำ”",
    "หมวดใหม่ × มุมใหม่ = คลิปที่คู่แข่งในหมวดนั้นยังไม่ยิง · ลอง 3 คลิปใน 7 วัน แล้วเทียบยอดวิว",
    "ใช้กับสินค้าเดิมได้ไม่จำกัด และเปลี่ยนหมวดใหม่ได้ทุกครั้ง — ไม่ต้องซื้อชุดใหม่ทุกครั้งที่เปลี่ยนสินค้า",
]):
    center(line, 52 + i * 7.2, size=11, color=DIM, h=6.8)

left("ทำต่อเลย 3 อย่าง", 78, 13, ORANGE, "B")
y = 90
for b in [
    "เปิด index.csv เลือก “หมวดที่ยังไม่เคยขาย” แล้วทำ 3 คลิปแรกจากมุมที่ยังไม่เคยใช้",
    "ส่งต่อให้เพื่อนครีเอเตอร์ 1 คน — แชร์ข้อความด้านล่างให้เขาได้เลย (เขาซื้อชุดเดียวกันได้)",
    "เจอ prompt ที่ใช้แล้วผลไม่ดี → อีเมลบอกเรา เราปรับให้ในเวอร์ชันถัดไป",
]:
    y = bullet(b, y, gap=7.4)

left("ชวนเพื่อนมาใช้ (ก๊อปวางได้เลย)", 122, 13, ORANGE, "B")
pdf.set_fill_color(*CARBON); pdf.rect(18, 132, 174, 34, "F")
pdf.set_fill_color(*ORANGE); pdf.rect(18, 132, 2, 34, "F")
pdf.set_xy(26, 136)
pdf.set_font("Sarabun", "", 10.5); pdf.set_text_color(*WHITE)
# ใช้ multi_cell เพื่อให้ข้อความตัดบรรทัดเอง (URL ยาว ๆ จะไม่ถูกตัดหาย)
pdf.multi_cell(158, 6.7,
    "“พี่เพิ่งได้ชุด Prompt 599 แบบ สำหรับเขียนสคริปต์ TikTok ปักตะกร้า — ก๊อปไปวางในแชท AI "
    f"ได้สคริปต์พร้อมถ่ายเลย จ่ายครั้งเดียวได้ไฟล์ทันที ลองดูลิงก์นี้: {SHOP_URL}”",
    align="L", new_x="LMARGIN", new_y="NEXT")

left("เวอร์ชันใหม่มาเอง — ซื้อครั้งเดียว ได้ทุกเวอร์ชันฟรี", 174, 13, ORANGE, "B")
pdf.set_fill_color(*CARBON); pdf.rect(18, 184, 174, 62, "F")
pdf.set_fill_color(*ORANGE); pdf.rect(18, 184, 2, 62, "F")
for i, line in enumerate([
    "มีเวอร์ชันใหม่ → เราส่งอีเมลแจ้งให้เอง ไม่ต้องขอ",
    "ลิงก์เดิมของคุณโหลดไฟล์รุ่นล่าสุดเสมอ",
    f"อีเมล: {SHOP_EMAIL}  (ตอบภายใน 1 วันทำการ)",
    "คืนเงินภายใน 7 วัน ถ้าไฟล์เปิดไม่ได้/ไม่ตรงตามที่อธิบาย",
]):
    left(line, 190 + i * 8, 10.5, WHITE, "", x=26, w=128, h=7)
left("ร้าน/ซื้อซ้ำ:", 222, 10, ORANGE, "B", x=26, w=128, h=6)
left(SHOP_URL, 228, 9.5, WHITE, "", x=26, w=128, h=6)

qr = make_share_qr(SHOP_URL, os.path.join(BUILD, "share-qr.svg"))
if qr:
    pdf.set_fill_color(255, 255, 255); pdf.rect(158, 190, 30, 30, "F")
    pdf.image(qr, x=159, y=191, w=28)
    center("สแกนเพื่อเปิดร้าน", 221, size=8.5, color=DIM, x=148, w=50, h=5)
    center("ส่งต่อให้เพื่อนได้เลย", 226, size=8.5, color=DIM, x=148, w=50, h=5)

center(f"เวอร์ชัน {VERSION} (อัปเดต {PACK_UPDATED_AT}) · {SHOP_NAME} · {SHOP_EMAIL}", 256, size=9.5, color=DIM)
center("ไฟล์นี้เป็นเครื่องมือช่วยเขียนคอนเทนต์ ไม่ใช่การรับประกันรายได้ — ผลลัพธ์ขึ้นกับสินค้าและคอนเทนต์ของคุณ", 264, size=8.5, color=DIM)

out = os.path.join(BUILD, "prompt-pack.pdf")
pdf.output(out)
print(out, os.path.getsize(out)//1024, "KB,", pdf.page_no(), "หน้า, QR:", "มี" if qr else "ไม่มี")
