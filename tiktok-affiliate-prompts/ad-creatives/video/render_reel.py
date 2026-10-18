#!/usr/bin/env python
"""เรนเดอร์วิดีโอ TikTok จาก reel-basket.html

- ขนาด 1080×1920 (9:16) · 30 เฟรม/วินาที · ยาว 8.0 วินาที (240 เฟรม)
- วาดแต่ละเฟรมด้วย Chromium จริงผ่าน `renderAt(t)` ในหน้าเว็บ → ฟอนต์ไทยขึ้นถูกทุกตัว
- ประกอบเสียงเองด้วย numpy (คิก/ไฮแฮท/แพด/ไรเซอร์/กระดิ่ง) แล้ว encode เป็น H.264 + AAC
- ตรวจงานในตัว: วัดข้อความล้น/หลุดโซนปลอดภัยของ TikTok + ตรวจว่าไฟล์ถอดรหัสได้ครบทุกเฟรม

ใช้งาน (ต้องใช้ python ของ shop/.venv ที่มี playwright + imageio-ffmpeg):
  export LD_LIBRARY_PATH=<workspace>/.scratch/debs/root/usr/lib/x86_64-linux-gnu
  export FONTCONFIG_FILE=<workspace>/.scratch/fonts.conf
  shop/.venv/bin/python ad-creatives/video/render_reel.py                # เรนเดอร์เต็ม + เขียน out/reel-basket.mp4
  shop/.venv/bin/python ad-creatives/video/render_reel.py --preview 0.6,1.6,3.6,6.2,7.4   # ดูเฉพาะบางเวลา
"""
import argparse
import math
import os
import shutil
import subprocess
import sys
import wave

import numpy as np
from playwright.sync_api import sync_playwright
import imageio_ffmpeg

HERE = os.path.dirname(os.path.abspath(__file__))
HTML = os.path.join(HERE, "reel-basket.html")
OUTDIR = os.path.join(HERE, "out")
SCRATCH = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".scratch"))

FPS = 30
# เวลาที่ใช้สุ่มอ่าน “ข้อความบนจอ” จากหน้าจริง (ต้องครอบทุกซีน)
DEFAULT_SAMPLE_TIMES = (0.6, 1.5, 2.4, 3.6, 5.2, 6.5, 7.5, 7.9)
DUR = 8.0
W, H = 1080, 1920
TOTAL = int(round(DUR * FPS))                      # 240 เฟรม

# ตรวจว่าข้อความที่คนเห็นจริง "ไม่ล้นกรอบตัวเอง" และ "ไม่หลุดโซนปลอดภัยของ TikTok"
# โซนปลอดภัย: เว้นขอบซ้าย 70 · ขวา 100 (คอลัมน์ปุ่มไลก์/แชร์) · บน 180 (แถบสถานะ) · ล่าง 320 (แคปชัน+UI)
MEASURE_JS = r"""
() => {
  const deco = new Set(['glow','grid','basket','basket2']);
  const opac = (el) => { let o = 1; for (let n = el; n && n !== document.body; n = n.parentElement) {
    const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden') return 0;
    o *= parseFloat(s.opacity || '1'); } return o; };
  const hasText = (el) => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 1);
  const st = document.getElementById('stage').getBoundingClientRect();
  const clipped = [], outside = [], seen = [];
  document.querySelectorAll('#stage *').forEach((el) => {
    if (!hasText(el) || deco.has(el.id) || opac(el) < 0.5) return;
    seen.push((el.id || el.className || el.tagName) + ' :: ' + el.textContent.trim().slice(0, 40));
    if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1)
      clipped.push(`${el.id || el.className} sw=${el.scrollWidth} cw=${el.clientWidth}`);
    const r = el.getBoundingClientRect();
    const l = r.left - st.left, t = r.top - st.top, ri = r.right - st.left, b = r.bottom - st.top;
    if (l < 70 || ri > 980 || t < 180 || b > 1600)
      outside.push(`${el.id || el.className} l=${l.toFixed(0)} t=${t.toFixed(0)} r=${ri.toFixed(0)} b=${b.toFixed(0)}`);
  });
  return { clipped, outside, seen };
}
"""

# ความกว้าง/สูงของกล่องข้อความถูกวัดในตัว MEASURE_JS อยู่แล้ว — ถ้าเครื่องไม่มีฟอนต์ สูงจะ = 0
# และ page.inner_text() ของ Playwright จะคืนค่าว่าง ⇒ ด่านตรวจข้อความจะหยุดก่อนเรนเดอร์

# ข้อความที่ต้องมีบนหน้าจริงก่อนเรนเดอร์ (ชื่อสินค้าปัจจุบัน + ราคา + บรรทัด compliance เต็ม ๆ)
# เดิมรายการนี้ยังเป็นชื่อเก่า “100 Prompt” ทั้งที่เพจ/ปก/สินค้าเปลี่ยนเป็น 599 แล้ว → ตรวจแล้วจะ "ขาดข้อความ" แล้วหยุดโดยไม่เรนเดอร์
REQUIRED_TEXT = ["599 Prompt", "ก๊อปวาง", "99", "599", "ก๊อป prompt", "ไม่ได้การันตีรายได้", "ผลลัพธ์ขึ้นกับสินค้าและคอนเทนต์ของคุณ"]


# ----------------------------------------------------------------- เสียง
def build_audio(path):
    """สร้างเพลงประกอบ 8 วิ: คิก 4/4 · ไฮแฮทเขบ็ต · แพดเบส · ไรเซอร์ช่วงตัดซีน · กระดิ่งตอนโชว์ราคา"""
    sr = 44100
    n = int(sr * DUR)
    t = np.arange(n) / sr
    mix = np.zeros(n)

    def put(sig, at):
        i = int(at * sr)
        if i >= n:
            return
        seg = sig[: max(0, n - i)]
        mix[i : i + len(seg)] += seg

    def env(length, attack=0.004, decay=0.25):
        m = int(length * sr)
        e = np.linspace(0, 1, max(1, int(attack * sr)))
        d = np.exp(-np.linspace(0, decay * 8, max(1, m - len(e))))
        return np.concatenate([e, d])[:m]

    # คิกทุก 0.5 วิ (120 BPM)
    for k in range(int(DUR / 0.5)):
        m = int(0.24 * sr)
        tt = np.arange(m) / sr
        f = 135 * np.exp(-tt * 22) + 48                       # สโลปความถี่ลงมา
        body = np.sin(2 * np.pi * np.cumsum(f) / sr) * np.exp(-tt * 11)
        click = np.random.default_rng(k).normal(0, 0.25, m) * np.exp(-tt * 220)
        put((body * 0.85 + click) * 0.9, k * 0.5)

    # ไฮแฮทเขบ็ต (ทุก 0.25 วิ) — เสียงรบกวนตัดความถี่ต่ำออก
    rng = np.random.default_rng(7)
    for k in range(2 * int(DUR / 0.5)):
        m = int(0.06 * sr)
        tt = np.arange(m) / sr
        noise = rng.normal(0, 1, m)
        hp = np.diff(np.concatenate([[0], noise]))               # คร่าว ๆ = ไฮพาส
        put(hp * np.exp(-tt * 90) * 0.16, k * 0.25)

    # แพดเบส (A minor: A2-C3-E3) ค่อย ๆ ดังขึ้นแล้วจางปลายคลิป
    pad = (
        0.5 * np.sin(2 * np.pi * 110.0 * t)
        + 0.34 * np.sin(2 * np.pi * 130.81 * t)
        + 0.28 * np.sin(2 * np.pi * 164.81 * t)
    ) * (1 + 0.06 * np.sin(2 * np.pi * 0.7 * t))
    pad_env = np.minimum(1, t / 0.8) * np.minimum(1, (DUR - t) / 0.7)
    mix += pad * pad_env * 0.10

    # ไรเซอร์ก่อนตัดซีน (2.35–2.55 และ 5.45–5.65)
    for a, b in [(2.30, 2.52), (5.40, 5.62)]:
        m = int((b - a) * sr)
        ramp = np.linspace(0, 1, m) ** 2
        put(rng.normal(0, 1, m) * ramp * 0.13, a)

    # กระดิ่งตอนป้ายราคาเด้ง + ตอนปุ่ม CTA โผล่
    for at, base, amp in [(6.20, 1318.5, 0.20), (6.62, 1760.0, 0.14)]:
        m = int(0.9 * sr)
        tt = np.arange(m) / sr
        bell = (np.sin(2 * np.pi * base * tt) + 0.45 * np.sin(2 * np.pi * base * 1.5 * tt)) * np.exp(-tt * 4.2)
        put(bell * amp, at)

    # ไม่ให้คลิป: ลิมิตแล้วคุมพีกไว้ราว -1 dBFS
    mix = np.tanh(mix * 1.05) * 0.5
    peak = float(np.max(np.abs(mix))) or 1.0
    mix = mix / peak * 0.89
    stereo = np.stack([mix, mix], axis=1)
    pcm = (np.clip(stereo, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    return path


# ----------------------------------------------------------------- หลัก
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", help="เรนเดอร์เฉพาะบางเวลา (วินาที คั่นด้วย ,) ไปที่ .scratch/reel-preview/")
    ap.add_argument("--no-audio", action="store_true")
    ap.add_argument("--keep-frames", action="store_true")
    ap.add_argument("--fps", type=int, default=FPS)
    ap.add_argument("--hook", help="ฮุกซีนแรก สูงสุด 3 บรรทัด คั่นด้วย | เช่น \"ปักตะกร้าแล้ว|แต่ยอดวิวไม่ขึ้น?\" (ไม่ใส่ = ฮุกเดิมใน HTML)")
    ap.add_argument("--out", default="reel-basket.mp4", help="ชื่อไฟล์ผลลัพธ์ในโฟลเดอร์ out/")
    ap.add_argument("--cover", default="", help="ชื่อไฟล์ปกในโฟลเดอร์ out/ (ค่าเริ่มต้น cover.png หรือ cover-<ชื่อไฟล์ออก>)")
    args = ap.parse_args()

    fps = args.fps
    total = int(round(DUR * fps))
    frames = os.path.join(SCRATCH, "reel-frames")
    if os.path.isdir(frames):
        shutil.rmtree(frames)
    os.makedirs(frames, exist_ok=True)

    problems = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
        page.add_init_script("window.__NO_AUTOPLAY__ = true;")
        page.goto("file://" + HTML)
        page.wait_for_timeout(1200)                      # ให้ฟอนต์ในเครื่องพร้อม
        page.evaluate("document.fonts.ready")

        def on_screen_text(times=DEFAULT_SAMPLE_TIMES):
            """ข้อความที่ “วาดเป็นตัวอักษรบนจอจริง” รวมหลายช่วงเวลา + รายชื่อเวลาที่จอว่าง

            สองข้อที่ต้องระวัง:
            1) ห้ามอ่านครั้งเดียวตอนโหลดเพจ — ตอนนั้น renderAt ยังไม่ถูกเรียก (สคริปต์ตั้ง
               __NO_AUTOPLAY__) จึงยังไม่มีอะไรขึ้นจอ → ต้องสุ่มอ่านหลายเวลาตลอดคลิป
            2) ใช้ page.inner_text() ของ Playwright (ไม่ใช่ page.evaluate) เพราะมันนับเฉพาะข้อความ
               ที่เบราว์เซอร์ “จัดวางเป็นตัวอักษรจริง” — ถ้าเครื่องไม่มีฟอนต์ กล่องข้อความจะสูง 0
               แล้วคืนค่าว่าง ⇒ ตรวจเจอตั้งแต่ก่อนเรนเดอร์ว่าคลิปจะออกมาไม่มีตัวหนังสือ
            """
            chunks, blank = [], []
            for at in times:
                page.evaluate("(t)=>window.renderAt(t)", at)
                piece = page.inner_text("#stage").strip()
                if not piece:
                    blank.append(at)
                chunks.append(piece)
            return "\n".join(chunks), blank

        # ตรวจข้อความที่ต้องมีบนจอจริง (ครอบทุกช่วงของคลิป)
        text, blank_at = on_screen_text()
        if len(blank_at) == len(DEFAULT_SAMPLE_TIMES):
            problems.append("ไม่มีข้อความขึ้นจอเลยทุกช่วงเวลา — เครื่องนี้ไม่มีฟอนต์ติดตั้ง (ตัวอักษรจะกว้าง 0)")
        for want in REQUIRED_TEXT:
            if want not in text:
                problems.append(f"ข้อความขาด: {want}")
        print(f"ข้อความบังคับ {len(REQUIRED_TEXT)} รายการ: " + ("ครบ" if not problems else "ขาด " + str(problems)))
        if blank_at:
            print(f"   ช่วงที่จอว่าง (ปกติได้ = ช่วงตัดซีน): {', '.join(f'{t:.1f}s' for t in blank_at)}")

        # ── เปลี่ยนฮุกซีนแรกได้ (ใช้ทำคลิปมุมอื่นจากเทมเพลตเดียวกัน) ──
        # 1 บรรทัด = 1 บรรทัดบนจอ (สูงสุด 3 = #l1/#l2/#l3) · บรรทัดที่เว้นว่างจะซ่อนไป ไม่ทิ้งช่องว่าง
        if args.hook:
            lines = [x.strip() for x in args.hook.split("|")][:3]
            page.evaluate(
                "(lines) => { ['#l1','#l2','#l3'].forEach((sel,i) => { const el = document.querySelector(sel); if (!el) return;"
                " const v = (lines[i]||'').trim(); if (v) el.textContent = v; else el.style.display = 'none'; }); }",
                lines,
            )
            shown = [x for x in lines if x]
            text2, _blank = on_screen_text((1.0, 1.5, 2.0))   # ช่วงที่ฮุกขึ้นครบแล้ว (0.30–1.35 วิ)
            miss = [x for x in shown if x not in text2]
            if miss:
                problems.append(f"ฮุกไม่ขึ้นบนหน้า: {miss}")
            print("ฮุกซีนแรก: " + " / ".join(shown) + ("" if not miss else "  !! ขึ้นไม่ครบ"))

        if args.preview:
            out = os.path.join(SCRATCH, "reel-preview")
            shutil.rmtree(out, ignore_errors=True)
            os.makedirs(out, exist_ok=True)
            for raw in [x for x in args.preview.split(",") if x.strip()]:
                t = float(raw)
                page.evaluate("(t)=>window.renderAt(t)", t)
                page.wait_for_timeout(60)
                m = page.evaluate(MEASURE_JS)
                path = os.path.join(out, f"t{t:04.1f}.png")
                page.screenshot(path=path)
                flag = ("ล้นกรอบ " + str(m["clipped"]) if m["clipped"] else "") + \
                       (" หลุดโซน " + str(m["outside"]) if m["outside"] else "")
                print(f"  t={t:4.1f}s → {os.path.basename(path)} · ข้อความบนจอ {len(m['seen'])} ชิ้น · " + (flag or "ผ่าน"))
            browser.close()
            print("ภาพตัวอย่าง:", out)
            return 0

        for i in range(total):
            t = i / fps
            page.evaluate("(t)=>window.renderAt(t)", t)
            page.screenshot(path=os.path.join(frames, f"f_{i:04d}.png"))
            if i % 60 == 0 or i == total - 1:            # วัดเฉพาะบางเฟรม (ประหยัดเวลา)
                m = page.evaluate(MEASURE_JS)
                tag = f"t={t:4.1f}s"
                if m["clipped"]:
                    problems.append(f"{tag} ข้อความล้นกรอบ: {m['clipped']}")
                if m["outside"]:
                    problems.append(f"{tag} หลุดโซนปลอดภัย: {m['outside']}")
                print(f"  {tag} · ข้อความบนจอ {len(m['seen'])} ชิ้น · " +
                      ("ผ่าน" if not m["clipped"] and not m["outside"] else "!! ต้องแก้"))
        browser.close()

    if problems:
        print("\n❌ พบปัญหา:")
        for x in problems:
            print("   -", x)
        return 1

    os.makedirs(OUTDIR, exist_ok=True)
    wav = build_audio(os.path.join(SCRATCH, "reel-audio.wav"))
    out = os.path.join(OUTDIR, os.path.basename(args.out))
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    cmd = [
        ff, "-y", "-hide_banner", "-loglevel", "error",
        "-framerate", str(fps), "-i", os.path.join(frames, "f_%04d.png"),
    ]
    if not args.no_audio:
        cmd += ["-i", wav]
    cmd += [
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.2",
        "-x264-params", "keyint=60:min-keyint=30",
        "-movflags", "+faststart", "-r", str(fps),
    ]
    if not args.no_audio:
        cmd += ["-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2", "-shortest"]
    cmd += [out]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print("❌ encode ไม่ผ่าน:\n", r.stderr[-2000:])
        return 1

    # หน้าปก = เฟรมที่ฮุกขึ้นครบแล้ว
    cover_name = os.path.basename(args.cover) if args.cover else (
        "cover.png" if os.path.basename(args.out) == "reel-basket.mp4" else
        "cover-" + os.path.basename(args.out).replace("reel-", "").replace(".mp4", "") + ".png")
    cover = os.path.join(OUTDIR, cover_name)
    shutil.copy(os.path.join(frames, f"f_{int(1.5 * fps):04d}.png"), cover)

    # ตรวจไฟล์จริง: ถอดรหัสครบทุกเฟรม + ดูข้อมูลสตรีม
    info = subprocess.run([ff, "-hide_banner", "-i", out], capture_output=True, text=True)
    meta = [ln.strip() for ln in info.stderr.splitlines() if ln.strip().startswith(("Duration", "Stream"))]
    dec = subprocess.run([ff, "-v", "error", "-i", out, "-f", "null", "-"], capture_output=True, text=True)
    size = os.path.getsize(out)
    print("\nไฟล์:", out, f"({size/1024:.0f} KB)")
    for m in meta:
        print("   ", m)
    print("   cover:", cover)
    if dec.returncode != 0 or dec.stderr.strip():
        print("❌ ถอดรหัสมีปัญหา:", dec.stderr[-800:])
        return 1
    print(f"✅ ถอดรหัสครบทุกเฟรมไม่มี error · {total} เฟรม @ {fps}fps · {DUR:.1f} วินาที")
    if not args.keep_frames:
        shutil.rmtree(frames, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
