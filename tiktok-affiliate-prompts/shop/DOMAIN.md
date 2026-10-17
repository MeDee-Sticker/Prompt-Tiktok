# DOMAIN.md — หาโดเมน + ผูกกับร้าน (และปลดล็อกอีเมลลิงก์โหลด)

อัปเดต: 15 ต.ค. 2026 · ตรวจสถานะโดเมนด้วย RDAP (`rdap.org`, เทียบกับ registry จริง) + ตรวจ NS record
> ⚠️ สถานะว่าง/ไม่ว่างเปลี่ยนได้ทุกวัน — เช็คซ้ำที่หน้าร้านขายโดเมนก่อนจ่ายเงินจริงเสมอ

## 0) โดเมนที่คุณเลือก: `kopwang.com` (ตรวจ 15 ต.ค. 2026 14:30 UTC)
- สถานะล่าสุด: **ถูกจดไปแล้วเมื่อวันนี้ 15 ต.ค. 2026 14:22:31 UTC** — ผู้จดคือ **Cloudflare, Inc. (Cloudflare Registrar)** · nameserver `benedict.ns.cloudflare.com` / `daphne.ns.cloudflare.com` · สถานะ `clientTransferProhibited` · ตอนตรวจล่าสุด **โซนยังว่างเปล่า** (ไม่มี A/AAAA/MX/TXT/CNAME เลย — ยิง HTTP แล้วไม่ตอบ)
- ✅ ผู้ใช้ยืนยันแล้วว่าเป็นเจ้าของ (โดเมนอยู่ในบัญชี Cloudflare ของเจ้าของร้าน) — โซนทำงานอยู่จริง (authoritative ตอบ SOA) เหลือแค่ตั้งเรคคอร์ดกับผูกเว็บ
- ชื่อเดียวกันที่ยัง **ว่าง** (ตรวจซ้ำแบบเว้นจังหวะ 5 วิ + ควบคุม `google.com` = 200 ทุกรอบ): `kopwang.net` · `kopwang.shop` · `kopwang.store` · `kopwang.online` · `kopwang.co` · `kopwang.xyz` · `kopwang.me` · `kopwang.in.th` · `kopwang.co.th`
  - ใช้ได้จริงกับบุคคลธรรมดา: `.net` `.shop` `.store` `.online` `.co` `.xyz` `.me` และ **`.in.th`** (บุคคลสัญชาติไทยจดได้ ~฿400/ปี)
  - `kopwang.co.th` ว่างแต่ **บุคคลธรรมดาจดไม่ได้** (เงื่อนไข THNIC) — ต้องเป็นนิติบุคคล/VAT/เจ้าของเครื่องหมายการค้า

## 1) สรุปคำแนะนำ (สั้น ๆ)
> ✅ **จบเรื่องเลือกชื่อแล้ว: คุณใช้ `kopwang.com`** (จดแล้ว 15 ต.ค. 2026 ผ่าน Cloudflare Registrar — ดูข้อ 0 และ 8) ข้อ 1–5 ด้านล่างเก็บไว้เป็นข้อมูลอ้างอิง/เทียบราคาเผื่อวันหลังอยากเพิ่มชื่ออื่น
- **ชื่อที่แนะนำในตอนนั้น: `promptpack.shop`** — ตรงกับชื่อสินค้า (`599 Prompt ก๊อปวาง`) สั้น จำง่าย ใช้ได้ทั้งไทยและต่างประเทศ
- **ที่ซื้อที่แนะนำ: Porkbun** — ค่าใช้จ่ายรวม 3 ปีถูกที่สุดในกลุ่มที่เทียบ (`.com` ≈ $33 · `.shop` ≈ $52 ช่วงโปร), มี WHOIS privacy และ **เปลี่ยน nameserver ไป Cloudflare ได้** (จำเป็นถ้าจะผูกโดเมนกับ Cloudflare Worker + ยืนยันโดเมนกับ Resend)
- ถ้าจ่ายบัตรเครดิต/ต่างประเทศไม่สะดวก → ใช้ **Z.com Thailand** หรือ ** ThaiDNS / HostAtom** (จ่ายในไทย มีซัพพอร์ตไทย) แต่ราคา `.shop`/`.online` ที่ไทยมักแพงกว่า
- **ไม่แนะนำ `.co.th` ตอนนี้** เพราะ THNIC จำกัดผู้มีสิทธิ์ (นิติบุคคล / ผู้จด VAT / เจ้าของเครื่องหมายการค้า) — บุคคลธรรมดาไม่ได้สิทธิ์ · ถ้าอยากได้โดเมนไทยจริง ๆ ใช้ **`.in.th`** (บุคคลสัญชาติไทยจดได้ ~฿400/ปี ก่อน VAT)

## 2) ชื่อที่ตรวจสถานะแล้ว (15 ต.ค. 2026)
| โดเมน | สถานะที่ตรวจได้ | หมายเหตุ |
|---|---|---|
| `promptpack.shop` | ✅ **ว่าง** | ชื่อตรงแบรนด์ที่สุด — แนะนำ |
| `promptpack.store` | ✅ ว่าง | ความหมายใกล้กัน แต่ค่าเช่าต่อปีสูงกว่า |
| `promptpack199.com` | ✅ ว่าง | ใส่ราคาในชื่อ (199 บาท) จำง่ายสำหรับแคมเปญ |
| `promptpackth.com` | ✅ ว่าง | `.com` + TH · ต่อปีถูกที่สุดในลิสต์ |
| `thaipromptpack.com` | ✅ ว่าง | สื่อว่าเป็นร้านไทยชัดเจนที่สุด |
| `promptpack.site` / `.online` | ✅ ว่าง | ตัวเลือกสำรอง ถ้าชื่อหลักไม่ว่าง |
| `promptpack.co.th` | ✅ ว่าง (RDAP) | แต่ **ติดเงื่อนไขผู้มีสิทธิ์ของ THNIC** (ดูข้อ 1) |
| `promptpack.com` | ❌ ถูกจองแล้ว | — |
| `promptpack.net` | ❌ ถูกจองแล้ว | — |
| `promptpack.app` | ❌ ถูกจองแล้ว | — |
| `promptpack.co` | ❌ ถูกจองแล้ว | (NS เป็นของเจ้าของรายอื่น) |
| `kruprompt.com` | ❌ ถูกจองแล้ว | — |
| `kopwang.com` | 🔑 **เป็นของคุณแล้ว (จด 15 ต.ค. 2026)** | Cloudflare Registrar · NS Cloudflare · โซนว่าง (ดูข้อ 0) |
| `kopwang.net` / `.shop` / `.store` / `.online` | ✅ ว่าง | ตัวเลือกสำรองของชื่อ `kopwang` |

วิธีตรวจที่ใช้: `https://rdap.org/domain/<ชื่อ>` (HTTP 404 = ยังไม่มีเจ้าของ, 200 = มีแล้ว) — ตรวจความเชื่อถือของวิธีนี้ด้วยโดเมนที่มีเจ้าของแน่ ๆ (`google.com`, `google.co.th`, `thnic.or.th` → 200 ทั้งหมด) และเทียบกับ NS record อีกชั้น

## 3) ราคาโดยประมาณ (จากหน้าเว็บผู้ให้บริการ · ต.ค. 2026)
| ผู้ให้บริการ | `.com` (จด/ต่ออายุ) | `.shop` | หมายเหตุ |
|---|---|---|---|
| **Porkbun** | $11.08 / $11.08 | **$2.06 โปร** (ปกติ $25.23) → ต่ออายุ $31.41 | WHOIS privacy ฟรี · เปลี่ยน nameserver ได้ |
| **Dynadot** | $10.88 / $10.88 | $1.99 โปร → ต่ออายุ $32.32 | ถูกกว่าเล็กน้อย แต่หน้าเว็บซับซ้อนกว่า |
| **Cloudflare Registrar** | $10.46 / $10.46 | $30.20 / $30.20 | ถูกและคงที่ แต่ **ต้องใช้ DNS ของ Cloudflare เท่านั้น** |
| **Z.com Thailand** | ฿420/ปี | (มีโปร ฿50 ปีแรก — ต้องเช็คราคาต่ออายุ) | จ่ายในไทย · ซัพพอร์ตไทย |
| **HostAtom** | ฿450/ปี | ฿1,650/ปี | ราคาไม่รวม VAT 7% |
| **ThaiDNS** | ฿450/ปี | — | มีซัพพอร์ตไทย |
| **.co.th (ทั่วไป)** | — | — | ฿800–1,000/ปี (ไม่รวม VAT) + ต้องมีเอกสารสิทธิ์ |
| **.in.th (บุคคลไทย)** | — | — | ~฿400/ปี ก่อน VAT |

เทียบให้ครบ 3 ปี (จด 1 ปี + ต่อ 2 ปี) ที่ Porkbun: `.com` ≈ $33 · `.shop` ≈ $52 → ถูกกว่า Cloudflare (`.com` $31 / `.shop` $91) ในกรณี `.shop`

## 4) ขั้นตอนจดโดเมน (≪ ข้ามไปแล้ว — เก็บไว้เป็นบันทึก)
> ขั้นนี้จบแล้ว: คุณจด `kopwang.com` ผ่าน Cloudflare Registrar เมื่อ 15 ต.ค. 2026 (ไม่มีค่าใช้จ่ายที่ต้องทำเพิ่ม) — ต่อไปทำตาม **ข้อ 8**
1. ~~เข้า porkbun.com → ค้นหา `promptpack.shop`~~ (ไม่ได้ใช้แล้ว)
2. ~~สมัคร + จ่ายเงิน + เปิด WHOIS privacy~~ (Cloudflare Registrar ให้ WHOIS privacy ฟรีอยู่แล้ว)
3. ⚠️ **ห้ามส่งรหัสผ่าน/ล็อกอินของผู้ให้บริการให้ใคร** — วิธีที่ปลอดภัยคือให้คุณกดยืนยันเองในหน้าเว็บ (หรือ `npx wrangler login` ในเครื่องนี้) แล้วส่งมาเฉพาะ **ค่าที่ไม่เป็นความลับ** เท่านั้น (ชื่อโดเมน, เรคคอร์ด DNS, `NOTIFY_EMAIL`)
4. ไปที่ Resend → **Domains → Add domain** ใส่ `kopwang.com` แล้วใช้ปุ่ม “Sign in to Cloudflare” หรือก๊อป records (รายละเอียดในข้อ 8)
5. ส่งค่า `RESEND_API_KEY` → ผมตั้งเป็น Worker secret ให้ → **อีเมลลิงก์โหลดจะเริ่มทำงานทันที** (งานที่ค้างอยู่จะจบ) — คีย์นี้เก็บใน Worker secret เท่านั้น ไม่ลงไฟล์ในโปรเจกต์

## 5) DNS records ที่จะต้องใช้ (เตรียมไว้)
| จุดประสงค์ | ชนิด | ชื่อ | ค่า |
|---|---|---|---|
| ยืนยันโดเมนกับ Resend (DKIM) | TXT | `resend._domainkey` | `p=…` ยาว ๆ ที่ Resend สร้างให้ (ก๊อปทั้งค่า) |
| **แบบที่ Resend ให้ตอนนี้ (ใช้จริงกับ `kopwang.com`)**: MX ตีกลับ + SPF ผ่าน `send` | CNAME | `send` | **`send.forge.rmta.net`** — ต้องเป็น **DNS only (เมฆเทา)** · ชื่อนี้ให้ทั้ง MX และ IP ที่อนุญาตส่ง ผ่านการชี้ไป infra ของ Resend |
| ~~แบบเดิม~~ ส่งอีเมล (SPF) | TXT | `send` | `v=spf1 include:amazonses.com ~all` |
| ~~แบบเดิม~~ รับรายงานตีกลับ | MX | `send` | `send.forge.rmta.net` priority 10 (เก่ากว่านั้น: `feedback-smtp.<region>.amazonses.com`) |
| กันการปลอมโดเมน (DMARC) | TXT | `_dmarc` | `v=DMARC1; p=none;` (แบบสั้นตามที่ใช้จริง) หรือ `v=DMARC1; p=none; rua=mailto:<อีเมลรับรายงาน>` ถ้าอยากได้รายงานสรุป |
| ⬆️ **DMARC ใส่ที่หน้าเว็บไหน** | — | — | ✅ **เพิ่มแล้ว 16 ต.ค. 2026** · วิธีที่ใช้: **Cloudflare → เลือกโซน `kopwang.com` → DNS → Records → Add record** (ไม่ใช่หน้า Resend และไม่ใช่หน้า Cloudflare Registrar) · Type `TXT` · Name ใส่ `_dmarc` เฉพาะสั้น ๆ (ระบบต่อ `kopwang.com` ให้เอง) · Content `v=DMARC1; p=none;` ไม่ต้องใส่เครื่องหมายคำพูด ระบบเติมให้เอง · TTL `Auto` · TXT ไม่มีสวิตช์ proxy |
| ค่าใช้จริงของ `kopwang.com` (ตรวจ 15 ต.ค. 2026 · เช็คซ้ำ 16 ต.ค. 2026 หลังเพิ่ม DMARC) | — | — | CNAME `send` ✅ (DNS only) · TXT `resend._domainkey` ✅ ตรงกับค่า Resend เป๊ะ (sha256 `a1e1ddb5921fbe11…`) · ✅ **`_dmarc` = `v=DMARC1; p=none;` แล้ว** (TTL 300 · ตรวจเห็นตรงกันจาก `1.1.1.1`, `8.8.8.8`, DNS-over-HTTPS และ nameserver ต้นทาง) · ⛔ MX/A ที่ root ยังไม่มี (Email Routing + ตัวเว็บยังไม่ตั้ง) |
| ผูก Worker กับโดเมน (ถ้าเลือกทาง B) | — | — | Cloudflare จะสร้าง A/AAAA + ใบรับรองให้เองเมื่อกด **Custom domain** |

## 6) สองทางเลือกในการเอาโดเมนมาใช้
**ทาง A — ใช้โดเมนกับอีเมลก่อน (เร็ว ได้ประโยชน์ทันที)**
ร้านยังอยู่บนพรีวิวเดิม (`site-aff87aabee2e44c28a514efac1bb2cff.freebuff.page`) แต่เปลี่ยนผู้ส่งอีเมลเป็น `599 Prompt ก๊อปวาง <no-reply@kopwang.com>` และลิงก์ในอีเมลชี้ไปที่โดเมนได้ (ตั้ง `APP_ORIGIN=https://kopwang.com` แล้วทำ redirect จากโดเมน → พรีวิว หรือเว้นไว้ก่อน)
→ ได้: อีเมลลิงก์โหลดทำงานจริง (ตอนนี้ยังไม่ส่งเพราะไม่มี `RESEND_API_KEY`/โดเมนที่ verify) และอีเมลดูน่าเชื่อถือขึ้น

**ทาง B — ย้ายร้านมาอยู่โดเมนเอง (เต็มรูปแบบ)**
deploy โปรเจกต์นี้เข้า Cloudflare **บัญชีของคุณเอง** (`wrangler deploy`) + สร้าง D1/R2 ของคุณเอง แล้วกด **Workers → Custom domain → kopwang.com**
→ ได้: โดเมนร้านเป็นของตัวเอง, ตั้ง `APP_ORIGIN`, ไม่ผูกกับพรีวิว
→ แลกกับ: ต้องมีบัญชี Cloudflare + ย้าย/สร้าง D1 (คำสั่งอยู่ใน `README.md` ข้อ “ติดตั้งครั้งแรก”)

หมายเหตุ (ปรับใหม่ 16 ต.ค. 2026): เครื่องมือฝั่งผม **ไม่มีคำสั่งผูกโดเมนเข้ากับที่โฮสต์นี้** และ `npx wrangler login` ในเครื่องนี้ก็ **ใช้ไม่ได้** (wrangler รอ callback ที่ `http://localhost:8976` ซึ่งเบราว์เซอร์ของคุณเข้าไม่ถึง เพราะคนละเครื่อง) ⇒ เหลือ 2 ทางที่ทำได้จริง: **(1)** ดูว่า **Sites → โปรเจกต์ `promptpack-shop`** มีช่อง Custom domain ให้กรอกไหม หรือ **(2)** ให้ Cloudflare API token แบบจำกัดสิทธิ์ (Workers Scripts:Edit · D1:Edit · R2:Edit · Zone `kopwang.com`: DNS:Edit) เซฟเป็นไฟล์ `.secrets/CLOUDFLARE_API_TOKEN` (+ `CLOUDFLARE_ACCOUNT_ID`) **แล้วผู้ช่วยจะ `wrangler deploy` พร้อม `custom_domain = true` ให้เอง** (Cloudflare สร้าง DNS + TLS ให้) · ทาง B แบบเดิมยังใช้ได้ถ้าคุณจะ deploy เองในเครื่องตัวเอง
> ⚠️ ทางที่ 2 = deploy เข้าบัญชีคุณเอง ⇒ D1/R2 **สร้างใหม่ (ฐานว่าง)** พร้อมตั้ง secrets ใหม่ (ใช้ `.secrets/` ชุดเดิมได้) — ออเดอร์/ลูกค้าที่อยู่บนที่โฮสต์ปัจจุบันไม่ย้ายตาม

## 7) หลังได้โดเมน — เช็คลิสต์ของผม
> สถานะ 16 ต.ค. 2026: ร้าน **deploy ขึ้น environment `production` ของ Sites แล้ว** (`https://site-2790df0b15494ad586935781772e5228.freebuff.page`) และอีเมลยิงจริงผ่านแล้ว (dkim/spf/dmarc = pass) — เหลือข้อสุดท้ายคือ **ทำให้ `kopwang.com` ชี้มาร้าน** (ดูข้อ 6 ทางเลือก + §9.5 ใน `LAUNCH.md`)
- [x] ตั้ง `MAIL_FROM=<ชื่อร้าน> <no-reply@kopwang.com>` · `NOTIFY_EMAIL=<อีเมลร้าน>` (16 ต.ค. 2026 — ตั้งแล้วทั้ง preview และ production)
- [x] ตั้ง `RESEND_API_KEY` → ทดสอบส่งอีเมลลิงก์โหลดจริง: ส่งถึงกล่องจริง · `dkim=pass @kopwang.com` · `spf=pass` · `dmarc=pass` (16 ต.ค. 2026 20:23 UTC)
- [x] แก้ `support@example.com` ในหน้าเว็บเป็นอีเมลบนโดเมนแล้ว (`public/*.html` มี `kopwang.com` ครบ · ไม่เหลือ `support@example.com`)
- [x] ตรวจ `/api/health` ที่ deploy จริง → `payment.promptpay_configured: true` · `promptpay_options` ครบ 2 ช่องทาง
- [x] ทดสอบซื้อจริง 1 ออเดอร์บน production: สั่ง → อนุมัติ → อีเมล + ปุ่มดาวน์โหลด → โหลดไฟล์จริงได้ (ลบออเดอร์ทดสอบแล้ว)
- [ ] **`APP_ORIGIN` ตั้งไม่ได้** — Sites สงวนชื่อตัวแปรนี้ (`invalid_site_request`) ⇒ ไม่ต้องตั้ง: โค้ดใช้ `env.APP_ORIGIN || new URL(request.url).origin` ลิงก์ในอีเมลจึงเป็นโดเมนที่ผู้ใช้ยิงเข้ามาเอง พอ `kopwang.com` ชี้มาร้านก็ถูกโดเมนเองอัตโนมัติ
- [ ] **⛔ ยังผูกโดเมนไม่ได้ (เครื่องมือฝั่งผู้ช่วยไม่มีคำสั่งนี้)** — เลือก: (1) ดูว่าหน้า **Sites → โปรเจกต์ `promptpack-shop`** มีช่อง Custom domain ให้กรอกไหม หรือ (2) ทำเอง/ให้ผู้ช่วยทำผ่าน **`node tools/domain-bind-cloudflare.mjs`** (เตรียมไว้แล้ว — deploy เข้าบัญชีคุณ + `custom_domain = true` + ตั้ง secrets + อัปโหลด PDF + ตรวจปลายทางให้ครบในคำสั่งเดียว)
  - ต้องมีไฟล์ **`.secrets/CLOUDFLARE_API_TOKEN`** (โทเคนไฟล์เดียว ห้าม commit) — สิทธิ์ที่ต้องติ๊ก: **Account · Workers Scripts · Edit** · **Account · Workers R2 Storage · Edit** · **Account · D1 · Edit** · **Zone `kopwang.com` · Zone · Read** · **Zone `kopwang.com` · Workers Routes · Edit** ← ตัวสุดท้ายจำเป็นสำหรับ custom domain (สิทธิ์ Worker Scripts อย่างเดียวไม่พอ) · DNS:Edit **ไม่ต้องใช้** เพราะ Cloudflare สร้างเรคคอร์ดเอง
> ✅ **อัปเดต 17 ต.ค. 2026 04:28 UTC — ร้านย้ายมาอยู่บัญชีที่ถือโดเมน (`Cronkcrang84@gmail.com's Account` · `131edf78…`) แล้ว และซ้อม go-live ผ่าน 5/5:**
> - ปลายทางปัจจุบัน: **https://promptpack-shop.kopwangth.workers.dev** (workers.dev subdomain `kopwangth` — สร้างให้ตอน deploy เพราะบัญชีนี้ยังไม่มี)
> - D1 `promptpack-orders` = `5f0198d4-1152-4140-85ba-e1fe706e1eb9` · R2 `promptpack-files` (มี `prompt-pack.pdf` 1,556,120 ไบต์ · ยืนยันด้วยการอัปโหลด+อ่านกลับ) · secrets ครบ
> - ตรวจสด: `/api/health` = 200 · หน้าเว็บ 9 หน้า + `/admin` + `/style.css` + `/api/qr` = 200 ครบ · `/buy` = 404 เป็นเรื่องปกติ (ไม่มีไฟล์ `buy.html` และไม่มีลิงก์ใดอ้างถึง)
> - ซ้อม go-live: อัปโหลดไฟล์ → สั่งซื้อ → อนุมัติ → อีเมลจริง (Resend) → **โหลด PDF ได้จริง 1.48 MB** → หลังบ้านนับรอบโหลด · ลบออเดอร์ทดสอบแล้ว
> - **`APP_ORIGIN` ตั้งเป็น workers.dev** เพื่อให้ร้านใช้งานได้จริงตอนนี้ (ถ้าตั้งเป็นโดเมนก่อนผูก ลิงก์ในอีเมลจะตาย)
> - ✅ **ผูกโดเมนสำเร็จ 17 ต.ค. 2026 04:31 UTC — ร้านออนไลน์ที่ https://kopwang.com (และ www.kopwang.com)**
>   - วิธีที่ใช้จริง: **Workers Custom Domains API** → `PUT /accounts/131edf78…/workers/domains` `{zone_id, hostname, service, environment}` (คนละอันกับ `[[routes]]` ของ wrangler) — โทเคนนี้มี Workers Scripts:Edit จึงผ่านโดย**ไม่ต้องมี Zone · Workers Routes:Edit**
>   - โหมดใหม่ในสคริปต์: **`BIND=api`** → `TOKEN_FILE=.secrets/CLOUDFLARE_API_TOKEN_DOMAIN BIND=api node tools/domain-bind-cloudflare.mjs` (deploy แบบไม่มี routes แล้วผูกโดเมนผ่าน API + ตั้ง `APP_ORIGIN=https://kopwang.com` + ตรวจทุกหน้า) — รันซ้ำแล้วผ่าน exit 0
>   - ตรวจกับโดเมนจริง: `/api/health` = 200 (`app_origin=https://kopwang.com`, D1/R2/อีเมล/แจ้งร้าน = true) · หน้า `/ /order /30day /free /links /retrieve /terms /privacy /refund /thank-you /admin /style.css /api/qr` = **200 ครบ** · www = 200 · **QR เข้ารหัส `kopwang.com/links` ถูกต้อง**
>   - **ซ้อม go-live บน https://kopwang.com: 5/5 ผ่าน** — อัปโหลดไฟล์ → สั่งซื้อ ฿199 → อนุมัติ → อีเมลจริง (ลิงก์ชี้โดเมนจริง) → โหลด PDF ได้ 1,556,120 ไบต์ → หลังบ้านนับรอบโหลด → ลบออเดอร์ทดสอบแล้ว
>   - ℹ️ `POST /accounts/{id}/workers/domains` จะได้ **405 Method not allowed** — ต้องใช้ **PUT** เท่านั้น
>   - 💸 **โอนจริง ฿199 สำเร็จ (17 ต.ค. 2026 04:43 UTC) — วงจรครบ: สลิป → ตรวจอัตโนมัติ → อนุมัติ → อีเมล → ดาวน์โหลดได้**
>     - ออเดอร์ `ord_QhdQ_a758PJW` · ฿199.00 · แจ้งโอน `04:43:49` → **`verify_source=easyslip`** (ตรวจภาพสลิปครั้งเดียวผ่าน `verify_attempts=1` · `trans_ref=DM261017044303000zkrdos`) → `paid_at 04:43:51` → `emailed_at 04:43:52` → ดาวน์โหลดจริง `download_count=1` (v1.4) · สลิปเก็บใน R2 `slips/ord_QhdQ_a758PJW` (1,687,291 ไบต์)
>     - EasySlip โควตา: ใช้ไป **4/50** (เหลือ 46) · stats ร้าน: total 2 · paid 1 · revenue ฿199.00 · downloads 1
> - บัญชีก่อนหน้า (`Medesignth89@gmail.com`) ยังมี Worker `promptpack-shop` + D1/R2 ที่ deploy ไว้ตั้งแต่ 02:55 UTC — ถ้าไม่ใช้แล้วลบทิ้งได้

> ℹ️ **บันทึกเดิม 17 ต.ค. 2026 02:55 UTC — deploy เข้าบัญชีใหม่ครั้งแรก (แบบยังไม่ผูกโดเมน):** ร้านอยู่บน `https://promptpack-shop.kopwang.workers.dev` · Worker `promptpack-shop` · D1 `promptpack-orders` (`59d0b6bf-c540-481f-afaf-f67738dcd1c6`) · R2 `promptpack-files` (มี `prompt-pack.pdf` 1,556,120 ไบต์) · ตั้ง secrets 11 ตัว + `APP_ORIGIN` ครบ · `/api/health` = 200 · ทุกหน้า 200 · ซ้อม go-live เต็มรอบผ่าน 5/5 (สั่งซื้อ → อนุมัติ → อีเมลจริง → โหลด PDF ได้ → ลบออเดอร์ทดสอบแล้ว) · ตั้ง workers.dev subdomain = `kopwang` (บัญชีนี้ยังไม่มี ต้องสร้างก่อน deploy) · **ยังไม่ผูก `kopwang.com`** — ติดโซน pending ด้านล่าง
> ⚠️ ตอนนี้มีร้าน 2 ที่ (Sites production + ตัวใหม่บนบัญชีคุณ) ควรเลือกที่เดียวเป็นร้านจริงแล้วปิดอีกที่

  - ⛔ **ทำไมยังผูก `kopwang.com` ไม่ได้ — วินิจฉัยจบแล้ว 17 ต.ค. 2026 (API + RDAP + DNS สาธารณะ):**
    1. **โดเมนไปเกาะโซนของ *อีกบัญชี* ไม่ใช่ “รอ propagate”** — บัญชีนี้ (`5be1a55e…`) มีโซน `kopwang.com` ที่ได้ NS `arturo/oaklyn.ns.cloudflare.com` แต่ปลายทางประกาศ `benedict/daphne.ns.cloudflare.com` ⇒ โซนนี้ **จะไม่มีวัน active** · และเพราะโดเมนจดที่ **Cloudflare Registrar** (RDAP: Cloudflare, Inc. · จด 15 ต.ค. 2026 · `client transfer prohibited`) จึง **เปลี่ยน nameserver เองไม่ได้** — Registrar ล็อก NS ไว้กับโซนในบัญชีเดียวกันเสมอ (อ้างอิง: developers.cloudflare.com/dns/nameservers → “automatically assigns nameservers … cannot be changed”)
       - หลักฐานว่าโซนที่ active อยู่คือบัญชีเดิมของคุณ: `send.kopwang.com` = CNAME → `send.forge.rmta.net` (เรคคอร์ด Resend ที่ตั้งไว้ตั้งแต่ 15–16 ต.ค.) ยังตอบอยู่จาก `benedict/daphne`
       - ✅ **ทางที่เร็วสุด (วันนี้เลย) — ย้ายร้านไปบัญชีที่ถือโดเมน ไม่ต้องรออะไร:**
         1. dash.cloudflare.com → สลับไปบัญชีที่มี `kopwang.com` **Active** → My Profile → API Tokens → Create Custom Token (Workers Scripts:Edit · Workers R2 Storage:Edit · D1:Edit · Zone `kopwang.com`: Zone:Read + Workers Routes:Edit)
         2. `TOKEN_FILE=.secrets/CLOUDFLARE_API_TOKEN_DOMAIN node tools/token-web.mjs` (วางโทเคนในเบราว์เซอร์)
         3. `TOKEN_FILE=.secrets/CLOUDFLARE_API_TOKEN_DOMAIN node tools/domain-bind-cloudflare.mjs` ⇒ โซน active อยู่แล้ว จึงผูก `kopwang.com` + `www.` ได้ในคำสั่งเดียว (สคริปต์สร้าง D1/R2/secrets/PDF ในบัญชีนั้นให้ครบ)
         - ข้อดีเพิ่ม: อีเมล Resend/DKIM/DMARC อยู่ในโซนเดียวกันแล้ว ไม่ต้องย้ายเรคคอร์ด
         - โซน `pending` ในบัญชีนี้จะไร้ประโยชน์ — ลบทิ้งได้ที่ dash (ไม่กระทบอะไร เพราะไม่ได้ถูกอ้างถึง)
       - 🕓 **ทางเลือก: ย้ายโดเมนมาบัญชีนี้** (Registrar inter-account move, ทำได้เองที่บัญชีเดิม → Domains → Configuration → Start) — เงื่อนไข: อายุโดเมนเกิน 10 วัน ⇒ **เริ่มได้ตั้งแต่ 25 ต.ค. 2026** · บัญชีนี้ต้องกดยอมรับทางอีเมลภายใน 5 วัน · หลังย้ายจะ transfer-lock 30 วัน และ **DNS records ไม่ย้ายตาม** (ต้องสร้าง `send` CNAME + `resend._domainkey` + `_dmarc` ใหม่ — ค่า DKIM เก็บไว้ที่ `.scratch/kopwang-dkim-expected.txt`)
       - 🧪 **ทางสำรองถ้าไม่อยากสร้างโทเคน:** ในโซนของบัญชีที่ถือโดเมน เพิ่ม CNAME (proxied) `@` → `promptpack-shop.kopwang.workers.dev` แล้ว `NO_ROUTE=1 APP_ORIGIN=https://kopwang.com node tools/domain-bind-cloudflare.mjs` เพื่อให้ลิงก์ในอีเมลเป็นโดเมนจริง · ข้อจำกัด: ยังพึ่ง workers.dev และถ้า Cloudflare ไม่ยอมให้ CNAME ที่ apex ให้ใช้ชื่อ `shop.` แทน
    2. **R2 เคยยังไม่ถูกเปิดใช้ในบัญชีนี้** (Cloudflare ตอบ `code 10042 NotEntitled` — ไม่ใช่ปัญหาสิทธิ์โทเคน) ⇒ **เปิดแล้ว 17 ต.ค. 2026** และสคริปต์ผ่านข้อนี้แล้ว · วิธีเปิด (ถ้าทำบัญชีใหม่): Storage & databases → R2 → Overview → Enable/checkout
  - 🧪 **โหมด deploy แบบไม่ผูกโดเมน:** `NO_ROUTE=1 node tools/domain-bind-cloudflare.mjs` — สำหรับตอนโซนยังไม่ active · จะสร้าง config ที่ไม่มี `[[routes]]`, หา URL ของ workers.dev เอง, ตั้ง `APP_ORIGIN` เป็น URL นั้น แล้วตรวจ `/api/health` ให้ · พอโซน active แล้วรัน `node tools/domain-bind-cloudflare.mjs` (ไม่ใส่ `NO_ROUTE`) เพื่อผูกโดเมน
  - 🎯 **`APP_ORIGIN=https://โดเมน` ใช้คู่กับ `NO_ROUTE=1` ได้** (17 ต.ค. 2026) — ลิงก์ในอีเมลจะชี้โดเมนจริง ขณะที่ตัวตรวจสุขภาพ/page ยังยิง workers.dev · ใช้กับทางสำรอง CNAME ด้านบน
  - 🌐 **ทางที่ไม่ต้องใช้เทอร์มินัลเลย (แนะนำถ้ากลัววางผิดจังหวะ):** `node tools/token-web.mjs` → เปิดฟอร์มในเบราว์เซอร์ วางโทเคนในช่อง แล้วกดบันทึก → สคริปต์เขียนไฟล์แบบ `600` และตรวจสิทธิ์ให้ทันที (คำตอบอยู่ในหน้าเว็บ) · ใช้ได้ครั้งเดียวแล้วปิดตัวเอง · nonce 32 ไบต์กันการเขียนจากภายนอก · ไม่บันทึกค่าลงจอหรือล็อก
  - 🔐 **ทางเทอร์มินัล (ถ้าถนัด):** `node tools/save-cf-token.mjs` → เห็น `token:` แล้วจึงวางค่า → Enter (echo ปิดตั้งแต่ก่อนพรอมป์) · ตัวสคริปต์ล้างช่องว่าง/อัญประกาศ, ปฏิเสธค่าที่ผิดรูปแบบ (เช่นเผลอวางคำสั่งมาด้วย), เขียนไฟล์แบบ `600`, แล้วเรียกตัวตรวจสิทธิ์ต่อให้อัตโนมัติ · ใน macOS ใช้ `pbpaste | node tools/save-cf-token.mjs` ได้ (ไม่ต้องพิมพ์เลย)
  - 🔎 **ตรวจสิทธิ์โทเคนก่อน deploy (ไม่ต้องรอ deploy พัง):** `node tools/check-cf-token.mjs` → ยิง API จริงทีละข้อ (token verify · Zone:Read · Workers Scripts · D1 · R2 · Workers Routes) แล้วสรุปว่าผ่าน/ขาดข้อไหน พร้อมวิธีแก้ · `exit 0` = ครบ · `exit 1` = ขาดสิทธิ์ · `exit 2` = ยังไม่มีไฟล์/รูปแบบโทเคนผิด · `--json` สำหรับใช้ใน CI · สคริปต์ `domain-bind-cloudflare.mjs` เรียกตัวนี้เป็น **preflight อัตโนมัติ** ก่อนสร้าง D1/R2 (ข้ามด้วย `SKIP_PREFLIGHT=1`)
  - `npx wrangler login` ในเครื่องนี้ **ใช้ไม่ได้** เพราะ callback เป็น `localhost:8976` ⇒ ใช้โทเคนเท่านั้น (สร้างที่ My Profile → API Tokens → Create Custom Token)
  - ตรวจ config ก่อน deploy จริงได้โดยไม่ต้องมีโทเคน: `D1_ID=<uuid> GEN_ONLY=1 node tools/domain-bind-cloudflare.mjs` แล้ว `npx wrangler deploy --dry-run -c wrangler.domain.toml` (ไฟล์ที่สร้างถูก gitignore ไว้)

## 8) `kopwang.com` ของคุณ (จดผ่าน Cloudflare Registrar) — ขั้นตอนจบ

> 📌 **สถานะจริง ณ 15 ต.ค. 2026 (ตรวจ DNS แล้ว):** `send` = CNAME → `send.forge.rmta.net` ✅ (ยืนยันแล้วว่าไม่ถูก proxy — ไม่มี IP ของ Cloudflare) · `resend._domainkey` = TXT คีย์ 218 ตัว ✅ **ตรงกับค่าที่ Resend ให้แบบไบต์ต่อไบต์** (sha256 `a1e1ddb5921fbe11…`) · ✅ `_dmarc` = `v=DMARC1; p=none;` **เพิ่มแล้ว 16 ต.ค. 2026** (ตรวจแล้ว 4 ทาง: `dig @1.1.1.1` · `dig @8.8.8.8` · DNS-over-HTTPS · nameserver ต้นทาง) · ⛔ MX/A ที่ root ยังไม่มี (Email Routing + ตัวเว็บยังไม่ตั้ง)
1. เข้า **dash.cloudflare.com** → โดเมน `kopwang.com` จะอยู่ในบัญชีแล้ว (ผู้จดคือ Cloudflare การันตีว่า DNS อยู่ที่ Cloudflare)
2. **ยืนยันโดเมนกับ Resend**: resend.com → **Domains → Add domain** → `kopwang.com` (หรือแยกส่งที่ `send.kopwang.com` เพื่อไม่ให้เรคคอร์ดอีเมลปนกับเว็บ) แล้วเลือกวิธีใดวิธีหนึ่ง
   - **วิธีเร็ว: กด “Sign in to Cloudflare”** — Resend ใช้ Domain Connect เติมเรคคอร์ดให้อัตโนมัติในโซน Cloudflare ของคุณ (ไม่ต้องคัดลอกเอง)
   - **วิธีทำเอง: เพิ่ม 3 เรคคอร์ดนี้** (ค่าจริงดูจากแท็บ **Records** ของโดเมนนั้นเสมอ)
     | ชนิด | Name (ใส่แบบไม่ต้องมีโดเมนต่อท้าย) | ค่า | Priority |
     |---|---|---|---|
     | **CNAME (แบบที่ Resend ให้สำหรับ `kopwang.com`)** | `send` | `send.forge.rmta.net` — DNS only | — |
     | ~~MX (แบบเดิม)~~ | `send` | `send.forge.rmta.net` | 10 |
     | ~~TXT SPF (แบบเดิม)~~ | `send` | `v=spf1 include:amazonses.com ~all` | — |
     | TXT | `resend._domainkey` | ค่า `p=…` ที่ Resend สร้างให้ (ก๊อปทั้งค่า) — ของ `kopwang.com` เก็บไว้เทียบที่ `.scratch/kopwang-dkim-expected.txt` (sha256 ขึ้นต้น `a1e1ddb5921fbe11`) | — |
   - MX/TXT ไม่มีสวิตช์เมฆส้มอยู่แล้ว แต่ **ถ้า Resend แสดงเป็น CNAME** (โดเมนที่สร้างหลัง ส.ค. 2026) ต้องเป็น **DNS only (เมฆเทา)** — ห้ามเปิด proxy
   - ✅ **สถานะ: ทำแล้ว 16 ต.ค. 2026** — `_dmarc.kopwang.com` = `v=DMARC1; p=none;` (TTL 300) ยังไม่มี `rua` (คุมเอง ไม่ใช้ Cloudflare DMARC Management) — ต่อไปนี้พอ **ส่งอีเมลจริงได้สักพักและไม่มีอีเมลตกหล่น** ค่อยขยับเป็น `p=quarantine` แล้ว `p=reject`
   - 🔎 **ตรวจจากอีเมลจริงที่ปลายทางได้รับ** (เข้มกว่าดู DNS อย่างเดียว): `node tools/send-test-email.mjs` → เปิด “แสดงต้นฉบับ” → `node tools/check-email-auth.mjs received.eml` — เครื่องมือจะถอดลายเซ็น DKIM เองด้วยกุญแจจาก DNS และบอก `RESULT: PASS/FAIL` (วิธีเต็มอยู่ใน **LAUNCH.md §5.10**)
   - วิธีที่ใช้ (เก็บไว้เป็นบันทึก) — **ทำที่หน้า Cloudflare ไม่ใช่หน้า Resend**:
     1. เข้า **dash.cloudflare.com** → เลือกบัญชี → คลิกโดเมน **`kopwang.com`**
     2. เมนูซ้าย **DNS → Records** → ปุ่ม **Add record**
     3. กรอก: Type **`TXT`** · Name **`_dmarc`** (สั้น ๆ แค่นี้ ระบบต่อท้าย `kopwang.com` ให้เอง) · Content **`v=DMARC1; p=none;`** (ไม่ต้องใส่ `" "` เอง — Cloudflare เติมให้อัตโนมัติ; ถ้าอยากได้รายงานสรุปให้ใช้ `v=DMARC1; p=none; rua=mailto:support@kopwang.com`) · TTL **`Auto`**
     4. กด **Save** — record แบบ TXT ไม่มีสวิตช์เมฆส้มให้ปิด (มีเฉพาะ A/AAAA/CNAME)
     5. ตรวจผล (เห็นผลภายใน ~1 นาที เพราะ DNS อยู่ที่ Cloudflare เอง): `dig +short TXT _dmarc.kopwang.com` ต้องได้ `"v=DMARC1; p=none;"` · ไม่มี dig/อยากดูในเบราว์เซอร์ ใช้ https://dns.google/resolve?name=_dmarc.kopwang.com&type=TXT (ต้องเห็น `Answer` ที่มี `v=DMARC1; p=none;` — ปัจจุบันยังไม่เห็น) ⚠️ อย่าเปิด https://cloudflare-dns.com/dns-query ตรง ๆ ในเบราว์เซอร์ เพราะจะได้ HTTP 400 (ต้องส่งหัว `accept: application/dns-json` เท่านั้น)
     - ℹ️ **Resend ไม่ได้สร้าง DMARC ให้** — ปุ่ม “Sign in to Cloudflare” (Domain Connect) ใส่แค่ MX/TXT SPF/TXT DKIM ของ `send` + `resend._domainkey` · และ Resend เองก็เขียนไว้ในเอกสารว่าให้เพิ่ม DMARC *หลัง* โดเมน verify ผ่าน
     - ℹ️ **Email → DMARC Management** (ฟีเจอร์แยกของ Cloudflare) ใช้ดู/สรุปรายงาน DMARC ไม่จำเป็นต้องใช้ก็ได้ — แต่ถ้าเปิด มันจะขอเติมที่อยู่ `rua` ของ Cloudflare เข้าไปในเรคคอร์ด · ถ้าอยากคุมเอง ให้ใช้ Add record ใน DNS ตามข้อ 1–5 แล้วค่อยขยับ `p=none` → `quarantine` → `reject` เมื่อมั่นใจ
   - รอสถานะ **Verified** (ปกติ < 30 นาที) — ตรวจฝั่งผมได้ด้วย `dig +short TXT resend._domainkey.kopwang.com` และ `dig +short MX send.kopwang.com`
   - ℹ️ **`rmta.net` คือโดเมนของ Resend เอง** (apex ของเครื่องส่งเมล Resend ใช้ยืนยันตัวตน + รับสัญญาณตีกลับ — ดู https://rmta.net) ไม่ใช่โดเมนคนอื่นที่มาแอบอ้าง และจะไม่โผล่เป็นผู้ส่งอีเมล · ดังนั้น MX ที่ชื่อ `send` ชี้ไป `send.forge.rmta.net` และอีเมลที่จะมีหัว `rmta.net` ได้ ก็คืออีเมลที่ส่งผ่าน Resend เท่านั้น
3. ผูก Worker กับโดเมน: ถ้าร้านยังอยู่บนพรีวิวนี้ ใช้ **ทาง A** (ข้อ 6) ตั้ง `APP_ORIGIN=https://kopwang.com` และ `MAIL_FROM=599 Prompt ก๊อปวาง <no-reply@kopwang.com>` · ถ้าอยากได้เต็มรูปแบบใช้ **ทาง B** (`wrangler deploy` ในบัญชีคุณ + **Workers → Custom domain → kopwang.com**)
4. อีเมลร้านที่จะใช้แทน `support@example.com`: **`support@kopwang.com`** (แก้ใน `public/index.html`, `terms.html`, `refund.html`, `privacy.html`)
5. ส่งค่าที่ผมต้องใช้มาให้: `RESEND_API_KEY` + อีเมลร้านสำหรับแจ้งยอด (`NOTIFY_EMAIL`) → ผมตั้ง secret, deploy และทดสอบอีเมลลิงก์โหลด 1 ฉบับให้เห็นผลจริง

## 9) ลดอีเมลตกสแปม — แก้ที่โค้ดแล้ว + ที่ยังต้องทำที่ DNS (16 ต.ค. 2026)

SPF/DKIM/DMARC บอกได้แค่ว่า “อีเมลนี้ส่งจากโดเมนจริง” — แต่ตัวที่ทำให้ **ตกสแปม** มักเป็น *รูปแบบอีเมล* กับ *ชื่อเสียงผู้ส่ง*

The records only prove the mail is authentic. What lands you in Spam is usually the message shape and sender reputation.

### 9.1 แก้ในโค้ดแล้ว (`worker.js` · ผ่านเทสต์อัตโนมัติ)
| สิ่งที่แก้ | ทำไมจึงช่วย |
|---|---|
| ส่ง **`text/plain` คู่กับ `html` เสมอ** (`htmlToText()`) | อีเมล HTML-only ล้วนเป็นสัญญาณสแปม — และคนที่ปิด HTML ยังกดลิงก์ดาวน์โหลดได้ (ข้อความล้วนมี URL เต็ม) |
| ใส่ **`reply_to`** ทุกฉบับ (`REPLY_TO` หรือ `NOTIFY_EMAIL`) | ผู้ส่งแบบ no-reply ที่ตอบกลับไม่ได้ถูกกรองหนักกว่า |
| อีเมลการตลาด (ของแถม `/free`) ใส่ **`List-Unsubscribe` + `List-Unsubscribe-Post: One-Click`** | Gmail/Outlook บังคับสำหรับผู้ส่งจำนวนมาก — ไม่มี = โดนลดชั้นหรือสแปม |
| เพิ่มเส้นทาง **`/unsubscribe`** (ลายเซ็น HMAC ผูกกับอีเมล · รองรับ GET + one-click POST) | กดยกเลิกได้จริง ลบ lead + log ทันที |
| **ตัดอีโมจิออกจากหัวเรื่อง** และใช้ชื่อสินค้าจริงในหัวเรื่อง | ตัวกรองบางตัวให้คะแนนลบกับอีโมจิ/คำโฆษณาใน subject |
| `from` ต้องเป็นโดเมนที่ verify (`no-reply@kopwang.com`) — ห้ามใช้ `onboarding@resend.dev` ยิงจริง | โดเมนกลางชื่อเสียงต่ำ |

### 9.2 ยังต้องทำที่ DNS / ระดับโดเมน (ทำไม่อัตโนมัติได้)
1. **`rua` ใน DMARC** เพื่อรับรายงาน: `v=DMARC1; p=none; rua=mailto:support@kopwang.com` (ดูข้อ 8 วิธี Add record)
2. **ขยับนโยบายตามเวลา:** `p=none` → **`p=quarantine`** → **`p=reject`** เมื่อส่งจริงสัก 1–2 สัปดาห์แล้วไม่มีอีเมลตกหล่น (ต้องมั่นใจก่อน ไม่งั้นอีเมลจริงจะถูกกัก)
3. **MX ที่ root ยังไม่มี** → ตอบกลับเมล `support@kopwang.com` ยังไม่ถึงกล่องใคร · ตั้ง **Cloudflare Email Routing** (ฟรี) ส่งต่อ `support@` → อีเมลจริงของคุณ ไม่งั้นตั้ง `REPLY_TO` เป็นอีเมลที่รับได้จริงไปก่อน
4. **Warm-up ชื่อเสียง:** เริ่มส่งปริมาณน้อย ทยอยเพิ่ม · อย่าเปลี่ยนผู้ให้บริการส่งบ่อย · อย่าใส่ลิงก์ย่อ (bit.ly ฯลฯ)
5. **หลีกเลี่ยงคำเสี่ยงในหัวเรื่อง/เนื้อ:** “ฟรี!!!” · “ด่วนสุด ๆ” · ตัวพิมพ์ใหญ่ทั้งประโยค · *** ขีดล่างเยอะ ๆ
6. **ตรวจด้วยอีเมลจริงเสมอ:** `node tools/send-test-email.mjs` → เปิด “แสดงต้นฉบับ” → `node tools/check-email-auth.mjs received.eml` (ต้องได้ `RESULT: PASS`) · แล้วดูว่าเข้าถึง inbox หรือ spam

> ⚠️ ยังมีอีกสาเหตุที่ “ดูเหมือนสแปม” แต่ไม่ใช่: อีเมลส่งจากพรีวิว (`*.freebuff.page`) แล้ว **ลิงก์/โดเมนในเนื้อ** ยังเป็นโดเมนพรีวิว แต่ `From` เป็น `kopwang.com` → ผู้รับกดแล้วเจอคนละโดเมน · แก้ด้วย `APP_ORIGIN=https://kopwang.com` แล้วผูกโดเมน (ข้อ 6 · ทาง A/B)
