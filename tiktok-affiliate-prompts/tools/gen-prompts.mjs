/**
 * gen-prompts.mjs — สร้างแพ็ก "599 Prompt ก๊อปวาง" ทั้งชุดจากเมทริกซ์ หมวด × มุม
 *
 *   แหล่งความจริงเดียว (single source of truth) — ห้ามแก้ไฟล์ที่สร้างด้วยมือ
 *   รัน:  node tools/gen-prompts.mjs            # เขียน prompts/*.md + index.csv + prompts-599.csv
 *         node tools/gen-prompts.mjs --check    # ตรวจว่าไฟล์ที่มีอยู่ตรงกับเมทริกซ์ (exit 1 ถ้าไม่ตรง)
 *
 * โครงสร้าง: 26 หมวดสินค้า × 23 มุมคอนเทนต์ = 598 + ชุดวางแผน 30 วัน (MASTER) = 599 ชุด
 *   ตัวอักษรทั้งหมดเป็น TH + EN · prompt ต่อชุดสั่ง AI ตอบ 8 ส่วนตาม 00_master-template.md
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const PROMPTS_DIR = path.join(ROOT, "prompts");
const INDEX_CSV = path.join(ROOT, "index.csv");
const PACK_CSV = path.join(ROOT, "prompts-599.csv");

/* ================= 26 หมวดสินค้า / 26 niches =================
 * [slug, th, en, roleTh, roleEn, bestForTh, bestForEn, hookTh, hookEn, tags, risk]
 */
const NICHES = [
  ["01-beauty-skincare", "สกินแคร์/ความงาม", "Skincare & Beauty",
    "นักเขียนสคริปต์ TikTok Shop Affiliate สายสกินแคร์", "TikTok Shop affiliate scriptwriter for skincare",
    "ผิวแห้ง/ผิวมัน/ผิวแพ้ง่ายที่ยังไม่เจอตัวที่ใช่", "dry, oily or sensitive skin that hasn't found the right match",
    "\"ผิวแห้งจนแต่งหน้าไม่ติด ใครเป็นแบบนี้บ้าง 🙋‍♀️\"", "\"My skin was so dry makeup wouldn't sit — anyone else? 🙋‍♀️\"",
    "#สกินแคร์ #ผิวแห้ง #TikTokShop #affiliate", true],
  ["02-makeup", "เมคอัพ/เครื่องสำอาง", "Makeup & Cosmetics",
    "นักเขียนสคริปต์ TikTok Shop Affiliate สายเมคอัพ", "TikTok Shop affiliate scriptwriter for makeup",
    "คนที่อยากได้ลุคติดทนโดยไม่ต้องจ่ายแพง", "viewers who want a long-wear look without the luxury price",
    "\"แต่งเช้าถึงเย็นยังไม่หลุด มาดูสิ่งที่ทำให้ต่าง\"", "\"My makeup lasted from morning to night — here's what changed.\"",
    "#เมคอัพ #เครื่องสำอาง #TikTokShop #affiliate", true],
  ["03-supplements-health", "อาหารเสริม/สุขภาพ", "Supplements & Health",
    "นักเขียนสคริปต์ TikTok Shop Affiliate สายอาหารเสริม (เน้นความปลอดภัยตามกฎหมาย)", "TikTok Shop affiliate scriptwriter for supplements (compliance-first)",
    "คนที่อยากเสริมโภชนาการโดยเข้าใจข้อจำกัดตามกฎหมาย", "viewers topping up nutrition who respect the legal limits",
    "\"วันไหนกินผักน้อย เราเสริมด้วยตัวนี้ (ไม่ใช่ยา) 🥬\"", "\"On low-veggie days I top up with this (not a medicine). 🥬\"",
    "#อาหารเสริม #สุขภาพ #TikTokShop #affiliate", true],
  ["04-fashion", "แฟชั่น/เสื้อผ้า", "Fashion & Apparel",
    "นักเขียนสคริปต์ TikTok Shop Affiliate สายแฟชั่น", "TikTok Shop affiliate scriptwriter for fashion",
    "คนที่อยากแมตช์ชุดง่าย ๆ โดยไม่ต้องซื้อเยอะ", "viewers who want easy outfits without buying a lot",
    "\"ใส่ชุดเดิมแต่ดูเปลี่ยนไป อยู่ที่รายละเอียดนี้\"", "\"Same outfit, different look — it's all in this detail.\"",
    "#แฟชั่น #เสื้อผ้า #TikTokShop #affiliate", false],
  ["05-home-organization", "บ้าน/จัดบ้าน", "Home & Organization",
    "นักเขียนสคริปต์ TikTok Shop Affiliate สายจัดบ้าน", "TikTok Shop affiliate scriptwriter for home organization",
    "บ้านที่ของเยอะแต่ไม่มีที่วาง", "homes that are full of things with nowhere to go",
    "\"บ้านรกไม่ใช่เพราะขี้เกียจ แต่เพราะไม่มีที่วางของ\"", "\"My home wasn't messy because I'm lazy — it had nowhere to put things.\"",
    "#จัดบ้าน #บ้านน่าอยู่ #TikTokShop #affiliate", false],
  ["06-kitchen", "เครื่องครัว/อุปกรณ์ทำอาหาร", "Kitchen & Cookware",
    "นักเขียนสคริปต์ TikTok Shop Affiliate สายเครื่องครัว", "TikTok Shop affiliate scriptwriter for kitchen tools",
    "คนที่ทำอาหารเองบ่อยแต่ครัวยังไม่ตอบโจทย์", "people who cook often but their kitchen still fights them",
    "\"ทำอาหารทุกวันแล้วปวดหลัง มาจนถึงวันที่เจอตัวนี้\"", "\"Cooking every day wrecked my back — then I found this.\"",
    "#เครื่องครัว #ทำอาหาร #TikTokShop #affiliate", false],
  ["07-gadgets-tech", "แกดเจ็ต/ไอที", "Gadgets & Tech",
    "นักเขียนสคริปต์ TikTok Shop Affiliate สายแกดเจ็ต/ไอที", "TikTok Shop affiliate scriptwriter for gadgets and tech",
    "คนที่อยากแก้ปัญหาจุกจิกด้วยอุปกรณ์ชิ้นเดียว", "viewers who want one device to fix an everyday annoyance",
    "\"สายเต็มโต๊ะจนทำงานไม่ไหว แก้ใน 30 วินาที\"", "\"The cable mess on my desk — fixed in 30 seconds.\"",
    "#แกดเจ็ต #ไอที #TikTokShop #affiliate", false],
  ["08-mom-baby", "แม่และเด็ก", "Mom & Baby",
    "นักเขียนสคริปต์ TikTok Shop Affiliate สายแม่และเด็ก (เน้นความปลอดภัย)", "TikTok Shop affiliate scriptwriter for mom & baby (safety-first)",
    "พ่อแม่ที่อยากได้ของใช้เด็กที่จำเป็นจริง", "parents who want only the baby items that truly matter",
    "\"ของใช้เด็กที่ต้องมีจริง ๆ มีไม่กี่อย่าง นี่คือหนึ่งในนั้น\"", "\"Only a few baby items are truly must-haves — this is one.\"",
    "#แม่และเด็ก #ของใช้เด็ก #TikTokShop #affiliate", true],
  ["09-pets", "สัตว์เลี้ยง", "Pet Supplies",
    "นักเขียนสคริปต์ TikTok Shop Affiliate สายสัตว์เลี้ยง", "TikTok Shop affiliate scriptwriter for pet supplies",
    "คนมีสัตว์เลี้ยงที่เจอปัญหาซ้ำ ๆ ทุกวัน", "pet owners who hit the same small problem every day",
    "\"น้องแมวไม่ยอมกินน้ำ มาจนเจอวิธีนี้\"", "\"My cat wouldn't drink water — until this.\"",
    "#สัตว์เลี้ยง #แมว #หมา #TikTokShop #affiliate", false],
  ["10-food-snacks", "อาหาร/ขนม", "Food & Snacks",
    "นักเขียนสคริปต์ TikTok Shop Affiliate สายอาหารและขนม", "TikTok Shop affiliate scriptwriter for food and snacks",
    "คนที่หาเมนู/ของกินเปิดซองไว้ติดบ้าน", "viewers hunting for easy meals and pantry snacks",
    "\"ของกินเล่นที่เปิดซองแล้วหยุดไม่ได้ ระวัง!\"", "\"A snack I genuinely can't stop eating — fair warning.\"",
    "#ของกิน #ขนม #TikTokShop #affiliate", false],
  ["11-fitness", "ฟิตเนส/สุขภาพ", "Fitness & Wellness",
    "นักเขียนสคริปต์ TikTok Shop Affiliate สายฟิตเนส (ไม่กล่าวอ้างผลลัพธ์สุขภาพ)", "TikTok Shop affiliate scriptwriter for fitness (no health-outcome claims)",
    "คนที่ออกกำลังกายสม่ำเสมอแต่อุปกรณ์ยังไม่ช่วย", "people training regularly whose gear still holds them back",
    "\"ออกกำลังกายมาก็เยอะ แต่อุปกรณ์ไม่ช่วยเลย จนเจอตัวนี้\"", "\"I trained a lot but my gear held me back — then I switched.\"",
    "#ฟิตเนส #ออกกำลังกาย #TikTokShop #affiliate", true],
  ["12-cleaning-laundry", "ทำความสะอาด/ซักผ้า", "Cleaning & Laundry",
    "นักเขียนสคริปต์ TikTok Shop Affiliate สายทำความสะอาดและซักผ้า", "TikTok Shop affiliate scriptwriter for cleaning and laundry",
    "บ้านที่มีคราบ/กลิ่น/ผ้าที่ซักแล้วยังไม่สะอาดใจ", "homes with stubborn stains, odours or laundry that never feels clean",
    "\"ซักผ้าขาวแล้วออกเหลือง มาดูสาเหตุจริง\"", "\"My whites kept turning yellow — here's the real reason.\"",
    "#ทำความสะอาด #ซักผ้า #TikTokShop #affiliate", false],
  ["13-home-appliances", "เครื่องใช้ไฟฟ้าในบ้าน", "Home Appliances",
    "นักเขียนสคริปต์ TikTok Shop Affiliate สายเครื่องใช้ไฟฟ้าในบ้าน", "TikTok Shop affiliate scriptwriter for home appliances",
    "คนที่ค่าไฟสูงและอยากลดงานบ้านที่ทำมือ", "households cutting bills and manual chores",
    "\"ค่าไฟขึ้นทุกเดือน มาจนเจอตัวที่กินไฟจริง\"", "\"My power bill kept climbing until I checked what really drains it.\"",
    "#เครื่องใช้ไฟฟ้า #บ้าน #TikTokShop #affiliate", false],
  ["14-home-decor", "ของแต่งบ้าน/ตกแต่ง", "Home Decor",
    "นักเขียนสคริปต์ TikTok Shop Affiliate สายของแต่งบ้าน", "TikTok Shop affiliate scriptwriter for home decor",
    "คนที่อยากเปลี่ยนบรรยากาศห้องด้วยงบเล็ก", "viewers refreshing a room on a small budget",
    "\"ห้องเดิม ๆ แค่เปลี่ยนชิ้นเดียวก็ดูใหม่\"", "\"Same room — one piece changed everything.\"",
    "#แต่งบ้าน #ของแต่งบ้าน #TikTokShop #affiliate", false],
  ["15-shoes-bags", "รองเท้า/กระเป๋า", "Shoes & Bags",
    "นักเขียนสคริปต์ TikTok Shop Affiliate สายรองเท้าและกระเป๋า", "TikTok Shop affiliate scriptwriter for shoes and bags",
    "คนที่เดินเยอะและอยากได้ของที่ทนจริง", "people who walk a lot and want gear that lasts",
    "\"เดินทั้งวันแล้วเท้าไม่พัง อยู่ที่คู่นี้\"", "\"Walked all day and my feet survived — thanks to this pair.\"",
    "#รองเท้า #กระเป๋า #TikTokShop #affiliate", false],
  ["16-jewelry-watch", "เครื่องประดับ/นาฬิกา", "Jewelry & Watches",
    "นักเขียนสคริปต์ TikTok Shop Affiliate สายเครื่องประดับและนาฬิกา", "TikTok Shop affiliate scriptwriter for jewelry and watches",
    "คนที่อยากได้ของใส่ได้ทุกวันโดยไม่ต้องมีหลายชิ้น", "viewers who want one piece that works every day",
    "\"ใส่ตัวเดียวจบทุกงาน อยู่ที่การเลือกด้วย\"", "\"One piece for every occasion — it's about choosing well.\"",
    "#เครื่องประดับ #นาฬิกา #TikTokShop #affiliate", false],
  ["17-hair-care", "ดูแลผม/สระผม", "Hair Care",
    "นักเขียนสคริปต์ TikTok Shop Affiliate สายดูแลเส้นผม", "TikTok Shop affiliate scriptwriter for hair care",
    "คนที่ผมแห้ง/ชี้ฟู/ร่วงตอนสระ", "anyone with dry, frizzy or shedding-prone hair",
    "\"ผมร่วงตอนสระ มาดูว่าฉันเปลี่ยนอะไร\"", "\"Hair shedding in the shower — here's what I changed.\"",
    "#ดูแลผม #สระผม #TikTokShop #affiliate", true],
  ["18-mens-grooming", "ดูแลตัวเองผู้ชาย/น้ำหอม", "Men's Grooming & Fragrance",
    "นักเขียนสคริปต์ TikTok Shop Affiliate สายดูแลตัวเองผู้ชายและน้ำหอม", "TikTok Shop affiliate scriptwriter for men's grooming and fragrance",
    "ผู้ชายที่อยากมีสเต็ปดูแลตัวเองแบบสั้น ๆ", "men who want a short, doable self-care routine",
    "\"ผู้ชายก็ควรมีขั้นตอนดูแลตัวเองง่าย ๆ แค่นี้\"", "\"Grooming doesn't need 10 steps — just these.\"",
    "#ผู้ชาย #น้ำหอม #TikTokShop #affiliate", false],
  ["19-oral-care", "สุขภาพช่องปาก/ฟัน", "Oral Care",
    "นักเขียนสคริปต์ TikTok Shop Affiliate สายสุขภาพช่องปาก (ไม่วินิจฉัย/รักษาโรค)", "TikTok Shop affiliate scriptwriter for oral care (no diagnosis or treatment claims)",
    "คนที่อยากดูแลช่องปากให้ดีขึ้นด้วยกิจวัตรเดิม", "viewers upgrading their daily oral routine",
    "\"แปรงสีฟันเดิม ๆ เปลี่ยนแล้วความรู้สึกต่างจริง\"", "\"Same habit, new brush — the difference is real.\"",
    "#สุขภาพช่องปาก #แปรงสีฟัน #TikTokShop #affiliate", true],
  ["20-office-school", "อุปกรณ์สำนักงาน/การเรียน", "Office & School",
    "นักเขียนสคริปต์ TikTok Shop Affiliate สายอุปกรณ์ทำงานและเรียน", "TikTok Shop affiliate scriptwriter for office and school gear",
    "คนที่ทำงาน/เรียนหนักแต่โต๊ะยังไม่เป็นใจ", "students and workers whose desk still fights them",
    "\"ทำงาน/เรียนหนักจนไม่มีสมาธิ มาจัดโต๊ะใหม่\"", "\"I couldn't focus until I fixed my desk setup.\"",
    "#ทำงาน #เรียน #TikTokShop #affiliate", false],
  ["21-car-auto", "ยานยนต์/ของแต่งรถ", "Car & Auto",
    "นักเขียนสคริปต์ TikTok Shop Affiliate สายของแต่งรถและของใช้ในรถ", "TikTok Shop affiliate scriptwriter for car accessories",
    "คนรักรถที่อยากดูแลรถด้วยของใช้ไม่กี่ชิ้น", "car owners maintaining their ride with a few smart tools",
    "\"รถดูใหม่ขึ้นโดยไม่ต้องทำสี\"", "\"My car looks newer without a repaint.\"",
    "#ของแต่งรถ #รถยนต์ #TikTokShop #affiliate", false],
  ["22-outdoor-sports", "กีฬา/แคมป์ปิ้ง", "Outdoor & Sports",
    "นักเขียนสคริปต์ TikTok Shop Affiliate สายกีฬากลางแจ้งและแคมป์ปิ้ง", "TikTok Shop affiliate scriptwriter for outdoor and camping gear",
    "มือใหม่ที่อยากออกไปข้างนอกโดยไม่เจ็บตัว", "beginners heading outdoors without the painful mistakes",
    "\"ออกแคมป์ครั้งแรกก็รอด ถ้าเตรียมของถูก\"", "\"First camping trip survived — because I packed right.\"",
    "#แคมป์ปิ้ง #กีฬา #TikTokShop #affiliate", false],
  ["23-garden-plants", "ต้นไม้/จัดสวน", "Gardening & Plants",
    "นักเขียนสคริปต์ TikTok Shop Affiliate สายต้นไม้และจัดสวน", "TikTok Shop affiliate scriptwriter for gardening",
    "คนที่รักต้นไม้แต่เลี้ยงไม่เคยรอด", "plant lovers whose plants never survive",
    "\"ต้นไม้ตายตลอด จนรู้ว่าพลาดเรื่องนี้\"", "\"I kept killing plants until I learned this.\"",
    "#ต้นไม้ #จัดสวน #TikTokShop #affiliate", false],
  ["24-travel-gear", "ของใช้เดินทาง/ท่องเที่ยว", "Travel Gear",
    "นักเขียนสคริปต์ TikTok Shop Affiliate สายของใช้เดินทาง", "TikTok Shop affiliate scriptwriter for travel gear",
    "คนที่แพ็กกระเป๋าไม่เคยพอและหาของไม่เจอ", "travellers whose bags never fit and never stay organized",
    "\"แพ็กกระเป๋าเที่ยว 7 วัน ใบเดียวจบ\"", "\"7 days of travel, one bag — here's how.\"",
    "#ท่องเที่ยว #กระเป๋าเดินทาง #TikTokShop #affiliate", false],
  ["25-stationery-hobby", "เครื่องเขียน/งานอดิเรก", "Stationery & Hobby",
    "นักเขียนสคริปต์ TikTok Shop Affiliate สายเครื่องเขียนและงานอดิเรก", "TikTok Shop affiliate scriptwriter for stationery and hobbies",
    "คนที่อยากมีงานอดิเรกไว้พักใจจริง ๆ", "people who want a hobby that actually rests their mind",
    "\"งานอดิเรกที่ทำให้ได้พักจริง ๆ เริ่มจากของไม่กี่ชิ้น\"", "\"A hobby that actually rests my mind — starts with just a few things.\"",
    "#เครื่องเขียน #งานอดิเรก #TikTokShop #affiliate", false],
  ["26-gaming-gear", "เกม/อุปกรณ์เกมมิ่ง", "Gaming Gear",
    "นักเขียนสคริปต์ TikTok Shop Affiliate สายอุปกรณ์เกมมิ่ง", "TikTok Shop affiliate scriptwriter for gaming gear",
    "เกมเมอร์ที่อยากเล่นนานขึ้นโดยไม่ปวดตัว", "gamers who want to play longer without the aches",
    "\"เล่นเกมแล้วปวดมือ มาจนได้เจอกัน\"", "\"Gaming hurt my hands — until this.\"",
    "#เกม #เกมมิ่ง #TikTokShop #affiliate", false],
];

/* ================= 23 มุมคอนเทนต์ / 23 angles =================
 * [th, en, instrTh, instrEn, bestForTh, bestForEn, ctaTh, ctaEn, capTh, capEn]
 */
const ANGLES = [
  ["Problem–Solution", "Problem–Solution",
    "เปิดด้วย \"ปัญหา\" ที่คนดูอิน 3 วิแรก → เกริ่นว่าลองมาหลายอย่าง → แนะนำสินค้าและสาธิตของจริง → CTA ตะกร้า",
    "open on a relatable problem in the first 3s → hint you tried many things → intro the product with a real demo → cart CTA",
    "สินค้าที่แก้ปัญหาชัดเจน", "products that solve one clear problem",
    "\"อยากรู้ว่าเข้ากับเราไหม เปิดตะกร้าเหลืองดูรายละเอียดได้เลยน้า (คลิปนี้มีคอมมิชชัน)\"",
    "\"Not sure it fits you? Check the yellow cart for the details (I earn a commission).\"",
    "เจอแล้วตัวที่ใช่ 🎯", "Found the one that works 🎯"],
  ["รีวิวประสบการณ์จริง", "Real Experience Review",
    "รีวิวบาลานซ์ — บอกข้อดี 1–2 ข้อจากที่ใช้จริง + ข้อจำกัดตามจริง 1 ข้อ แล้วระบุระยะเวลาที่ใช้ชัดเจน",
    "balanced review — 1–2 real pros from first-hand use + 1 honest limitation, and state the exact usage period",
    "สินค้าที่คุณใช้จริงมาระยะหนึ่ง", "products you've actually used for a while",
    "\"ใครอยากลอง เปิดตะกร้าเหลืองดูโปรได้เลยน้า (คลิปนี้มีคอมมิชชัน)\"",
    "\"Want to try it? The details are in the yellow cart (I earn a commission).\"",
    "รีวิวใช้จริง ไม่ขายฝัน 💬", "Honest review, no hype 💬"],
  ["Unboxing แกะกล่อง", "Unboxing",
    "แกะกล่องจริง โชว์บรรจุภัณฑ์ ปริมาณ และของในกล่อง (บรรยายจากของจริงเท่านั้น) → first impression → CTA",
    "real unboxing — show packaging, quantity and what's inside (describe only what is there) → first impression → CTA",
    "สินค้าใหม่ กล่องสวย มีของแถมน่าตื่นเต้น", "new products with nice packaging and a satisfying reveal",
    "\"ของในกล่องมีเท่านี้ อยากรู้อีกกดเปิดตะกร้าเหลืองได้เลย (มีคอมมิชชัน)\"",
    "\"That's everything in the box — check the yellow cart for the rest (I earn a commission).\"",
    "แกะกล่องของจริง 📦", "Honest unboxing 📦"],
  ["สาธิต/ทดสอบการใช้งาน", "Demo & Test",
    "สาธิตการใช้งานจริงแบบไม่ตัดต่อหลอกตา และแยกให้ชัดว่าส่วนไหนทดสอบเอง ส่วนไหนอ้างจากสเปก → สรุป → CTA",
    "demo the product for real, no deceptive cuts, and clearly separate what you tested from what you read on the spec → CTA",
    "สินค้าที่โชว์การทำงานให้เห็นได้", "products whose function can be shown on camera",
    "\"อยากดูสเปกเต็มกับราคา เปิดตะกร้าเหลืองเลยน้า (มีคอมมิชชัน)\"",
    "\"Full specs and price are in the yellow cart (I earn a commission).\"",
    "ทดสอบให้ดูเลย ไม่ต้องเดา 🔍", "Tested on camera, no guessing 🔍"],
  ["เปรียบเทียบ A vs B", "A vs B Comparison",
    "เทียบ 2 ตัวเลือกจากข้อเท็จจริง (ราคา สเปก การใช้งาน) แล้วบอกตรง ๆ ว่าใครควรเลือกอันไหน — ห้ามเอียงข้างใดข้างหนึ่ง",
    "compare two options on facts (price, spec, use) and say plainly who should pick which — stay honest both ways",
    "สินค้าที่มีคู่แข่งเทียบได้ชัด", "products with a clear head-to-head rival",
    "\"เลือกไม่ถูกก็เปิดตะกร้าเหลืองเทียบราคาก่อนได้เลย (มีคอมมิชชัน)\"",
    "\"Still deciding? Compare prices in the yellow cart (I earn a commission).\"",
    "A หรือ B ดูให้ครบก่อนตัดสินใจ ⚖️", "A or B — check both first ⚖️"],
  ["POV/เรื่องเล่า", "POV Story",
    "เล่าเป็นเรื่องสั้น POV ตัวละครเดียว ที่สินค้าเข้ามาแก้จุดพังของเรื่อง — ห้ามใส่ข้อเท็จจริงหรือตัวเลขที่ยืนยันไม่ได้",
    "tell a short single-POV story where the product fixes the story's turning point — no unverifiable facts or numbers",
    "สินค้าที่เล่าผ่านสถานการณ์ได้", "products that shine inside a situation",
    "\"ใครเคยเป็นแบบในคลิป เปิดตะกร้าเหลืองดูได้เลยน้า (มีคอมมิชชัน)\"",
    "\"Been here before? The yellow cart has the details (I earn a commission).\"",
    "POV: วันที่ทุกอย่างพัง แล้วเจอตัวนี้ 🎬", "POV: the day it all broke 🎬"],
  ["ตอบคอมเมนต์/FAQ", "Comment Reply & FAQ",
    "เริ่มด้วยคำถามจากคอมเมนต์ → ตอบตรง ๆ ทีละข้อด้วยข้อมูลที่ยืนยันได้ → ปิดด้วยการชวนไปดูรายละเอียดในตะกร้า",
    "start with a real comment question → answer each point with verified facts → close by pointing to the cart",
    "สินค้าที่มีคนถามบ่อย", "products with a steady stream of questions",
    "\"คำถามอื่น ๆ เปิดตะกร้าเหลืองดูรายละเอียดก่อนได้เลย (มีคอมมิชชัน)\"",
    "\"More answers are in the yellow cart (I earn a commission).\"",
    "ตอบคอมเมนต์ที่ถามกันเยอะที่สุด ❓", "Answering your top question ❓"],
  ["Tips & Hacks", "Tips & Hacks",
    "แชร์ทริคใช้สินค้าให้คุ้ม 3 ข้อ เรียงจากง่ายไปยาก โดยแต่ละข้อต้องใช้ได้จริง → ข้อสุดท้ายเป็น CTA ตะกร้า",
    "share 3 practical tips for getting more out of the product, easy to advanced → the last one becomes the cart CTA",
    "สินค้าที่มีวิธีใช้ให้เชี่ยวได้", "products with a skill curve",
    "\"ทริคที่เหลืออยู่ในตะกร้าเหลืองน้า เปิดดูได้เลย (มีคอมมิชชัน)\"",
    "\"The rest of the tips live in the yellow cart (I earn a commission).\"",
    "ทริคใช้ให้คุ้ม 3 ข้อ 💡", "3 tips to get your money's worth 💡"],
  ["Routine/วันในชีวิต", "Routine & Day in the Life",
    "พาไปตามรูทีนหนึ่งวัน แล้วโชว์จังหวะที่สินค้าเข้ามาอยู่ในรูทีนจริง ๆ — ห้ามใส่ผลลัพธ์ที่ยืนยันไม่ได้",
    "walk through one day and show exactly where the product fits the routine — no unverifiable results",
    "สินค้าที่ใช้เป็นประจำทุกวัน", "products used daily",
    "\"อยากได้ตัวนี้ไปใส่รูทีน เปิดตะกร้าเหลืองได้เลยน้า (มีคอมมิชชัน)\"",
    "\"Want it in your routine? It's in the yellow cart (I earn a commission).\"",
    "วันธรรมดาที่ของชิ้นนี้ช่วยไว้ 🌤️", "A normal day, one thing that helped 🌤️"],
  ["Trend/Top Picks", "Trend & Top Picks",
    "อ้างเทรนด์ที่สังเกตเห็น แล้วจัดอันดับสินค้าในหมวด 3 อันดับ พร้อมเหตุผลสั้น ๆ จากข้อเท็จจริงเท่านั้น",
    "reference an observed trend, then rank 3 picks in the category with short fact-based reasons",
    "สินค้าที่กำลังเป็นที่พูดถึง", "products currently getting attention",
    "\"อันดับ 1 อยู่ในตะกร้าเหลืองน้า เปิดดูโปรได้เลย (มีคอมมิชชัน)\"",
    "\"Number one is in the yellow cart (I earn a commission).\"",
    "ของที่คนกำลังพูดถึง 3 อันดับ 🔥", "3 picks everyone's talking about 🔥"],
  ["มายาคติที่คนเชื่อผิด", "Myth-busting",
    "เริ่มด้วยความเชื่อผิด 1 ข้อ → อธิบายข้อเท็จจริงอย่างตรงไปตรงมา → ชี้ว่าสินค้าตอบโจทย์ตรงไหน ห้ามกล่าวอ้างเกินจริง",
    "open on one common misconception → explain the plain facts → show where the product genuinely fits, no exaggeration",
    "หมวดที่มีความเข้าใจผิดบ่อย", "categories full of misconceptions",
    "\"อยากดูข้อมูลจริง เปิดตะกร้าเหลืองอ่านรายละเอียดได้เลย (มีคอมมิชชัน)\"",
    "\"The real details are in the yellow cart (I earn a commission).\"",
    "ความเชื่อที่ทำให้เสียเงินเปล่า 🚫", "The myth that wastes your money 🚫"],
  ["งบจำกัดก็เอาได้", "Budget Pick",
    "ตั้งงบจำกัดให้ชัด แล้วโชว์ว่าสินค้านี้ให้อะไรที่คุ้มงบ — ห้ามเทียบราคากับของต่างเกรดเพื่อให้ดูถูก",
    "state a clear budget cap, then show what this product delivers within it — never fake a discount by comparing across tiers",
    "คนที่ซื้อแบบคิดราคาต่อหน่วย", "value-driven buyers",
    "\"งบเท่านี้ก็ได้ของดี เปิดตะกร้าเหลืองดูราคาได้เลย (มีคอมมิชชัน)\"",
    "\"Good value at this budget — see the price in the yellow cart (I earn a commission).\"",
    "งบน้อยก็ไม่ต้องอด 💸", "Budget-friendly, no compromise 💸"],
  ["5 อย่างที่ต้องรู้ก่อนซื้อ", "5 Things to Know",
    "ลิสต์ 5 ข้อที่ควรรู้ก่อนซื้อ (สเปก การใช้งาน ข้อจำกัด ราคา ค่าดูแล) โดยใช้เฉพาะข้อมูลที่ตรวจได้ → ปิดด้วย CTA",
    "list 5 things to know before buying (spec, use, limits, price, upkeep) using verifiable facts only → CTA",
    "สินค้าที่ตัดสินใจยาก", "products that need a real decision",
    "\"ครบ 5 ข้อแล้ว เปิดตะกร้าเหลืองดูรายละเอียดก่อนตัดสินใจได้เลย (มีคอมมิชชัน)\"",
    "\"That's all 5 — the yellow cart has the details (I earn a commission).\"",
    "อ่านก่อนซื้อ 5 ข้อนี้ 📋", "Read these 5 before you buy 📋"],
  ["ข้อผิดพลาดที่คนมักทำ", "Common Mistakes",
    "ชี้ 3 ข้อผิดพลาดที่คนมักทำกับสินค้าประเภทนี้ → โชว์ว่าสินค้านี้ช่วยยังไง — ห้ามอ้างว่าแก้ได้ 100%",
    "point out 3 mistakes people make with this kind of product → show how this product helps — never claim a 100% fix",
    "หมวดที่คนใช้ผิดวิธีบ่อย", "categories where misuse is common",
    "\"เลี่ยงข้อผิดพลาดพวกนี้ เปิดตะกร้าเหลืองก่อนได้เลยน้า (มีคอมมิชชัน)\"",
    "\"Avoid these mistakes — start with the yellow cart (I earn a commission).\"",
    "3 ข้อที่คนทำพลาดบ่อย ⚠️", "3 mistakes people keep making ⚠️"],
  ["ถ้าเริ่มใหม่จะทำแบบนี้", "If I Started Over",
    "เล่าแบบย้อนเวลา — ถ้าเริ่มใหม่จะเลือกยังไง แล้วบอกชัดว่าต่างจากที่ทำตอนแรกตรงไหน",
    "a hindsight story — what you'd choose if you started today, and how it differs from your first attempt",
    "สินค้าที่มีเส้นทางการเรียนรู้", "products with a learning curve",
    "\"ถ้ายังไม่เริ่ม เปิดตะกร้าเหลืองดูตัวนี้ก่อนได้เลย (มีคอมมิชชัน)\"",
    "\"Starting fresh? Start with the yellow cart (I earn a commission).\"",
    "ถ้าย้อนเวลาได้ ฉันจะเริ่มแบบนี้ ⏪", "If I could start over ⏪"],
  ["ของขวัญให้คนที่รัก", "Gift Idea",
    "ตั้งโจทย์ \"ของขวัญให้ [คนกลุ่มไหน]\" → โชว์สินค้าเป็นตัวเลือก พร้อมเหตุผลว่าทำไมเหมาะกับคนนั้น",
    "frame it as \"a gift for [who]\" → present the product as an option with reasons it suits that person",
    "สินค้าที่ให้เป็นของขวัญได้", "products that work as gifts",
    "\"ยังหาของขวัญไม่ได้ เปิดตะกร้าเหลืองดูตัวนี้ได้เลย (มีคอมมิชชัน)\"",
    "\"Still gift-hunting? It's in the yellow cart (I earn a commission).\"",
    "ของขวัญที่ไม่มีวันพลาด 🎁", "The gift that can't miss 🎁"],
  ["รวมรีวิวจากคนอื่น", "Social Proof Roundup",
    "สรุปธีมที่หลายคนพูดตรงกันโดยไม่อ้างสถิติที่ไม่มีที่มา + บอกว่าควรดูอะไรในรีวิวผู้ใช้เองก่อนตัดสินใจ",
    "summarize the themes many buyers agree on without citing unsourced stats + tell viewers what to check in real user reviews",
    "สินค้าที่มีรีวิวผู้ใช้เยอะ", "products with plenty of user reviews",
    "\"อยากอ่านรีวิวเพิ่ม เปิดตะกร้าเหลืองดูเลยน้า (มีคอมมิชชัน)\"",
    "\"Want more reviews? They're around the yellow cart (I earn a commission).\"",
    "หลายคนพูดตรงกันว่า… 🗣️", "Everyone says the same thing 🗣️"],
  ["ใครเหมาะ/ใครไม่เหมาะ", "Who It's For",
    "แบ่งชัด 2 ฝั่ง — ใครเหมาะกับสินค้านี้ และใครยังไม่ควรซื้อ พร้อมเหตุผลตรงไปตรงมา",
    "split it honestly — who this suits and who should wait, with straight reasons for both",
    "สินค้าที่มีกลุ่มผู้ใช้ชัด", "products with a well-defined user",
    "\"ถ้าคุณอยู่ในกลุ่มที่เหมาะ เปิดตะกร้าเหลืองดูเลยน้า (มีคอมมิชชัน)\"",
    "\"If you're in the right group, the yellow cart has it (I earn a commission).\"",
    "อย่าเพิ่งซื้อ ถ้ายังไม่ตรงกับคุณ 👀", "Don't buy yet if it's not you 👀"],
  ["ใช้ตอนไหนถึงคุ้ม", "When to Use",
    "ยก 3 สถานการณ์ที่สินค้านี้ให้ผลคุ้มที่สุด และบอกว่าสถานการณ์ไหนไม่จำเป็นต้องซื้อ",
    "give 3 situations where this product pays off most, and be honest about when it isn't needed",
    "สินค้าที่ใช้ตามโอกาส", "products used for specific occasions",
    "\"ถ้าตรงกับสถานการณ์ของคุณ เปิดตะกร้าเหลืองได้เลย (มีคอมมิชชัน)\"",
    "\"If this is your situation, check the yellow cart (I earn a commission).\"",
    "ซื้อตอนนี้คุ้มกว่าเดิม 📈", "Buy it at the right moment 📈"],
  ["ตามล่าดีล/โปร", "Deal Hunting",
    "สอนวิธีเช็คว่าโปรนี้ดีจริง (เทียบราคาต่อหน่วย/ของแถม) แล้วโชว์ดีลปัจจุบันโดยใช้ตัวเลขที่ตรวจแล้วเท่านั้น",
    "teach how to tell a real deal (unit price, bundled extras), then show the current offer using verified numbers only",
    "สินค้าที่มีโปรตามเทศกาล", "products with seasonal promos",
    "\"ดีลนี้อาจไม่นาน เปิดตะกร้าเหลืองเช็กราคาได้เลย (มีคอมมิชชัน)\"",
    "\"The deal may not last — check the yellow cart (I earn a commission).\"",
    "เช็กก่อนดีลหมด 🏷️", "Check before the deal ends 🏷️"],
  ["เปรียบเทียบ 3 ตัวเลือกสุดท้าย", "Final 3 Picks",
    "คัด 3 ตัวเลือกสุดท้ายจากเกณฑ์ที่บอกชัด (งบ การใช้งาน ความคุ้ม) แล้วให้คำแนะนำที่เลือกได้จริง",
    "narrow to 3 finalists using criteria you state plainly (budget, use, value), then give advice a viewer can act on",
    "คนที่ลังเลระหว่างหลายตัว", "buyers torn between several options",
    "\"ตัวที่แนะนำอยู่ในตะกร้าเหลืองน้า เปิดดูได้เลย (มีคอมมิชชัน)\"",
    "\"My pick is in the yellow cart (I earn a commission).\"",
    "คัดมา 3 ตัว เลือกยากนิดนึง 😅", "Down to my final 3 😅"],
  ["ลองใช้ 7 วัน", "7-Day Trial Log",
    "เล่าเป็นไดอารี่ 7 วัน (วันที่ 1, 3, 7) ว่าสังเกตอะไรบ้าง โดยไม่เหมารวมเป็นผลลัพธ์รับประกัน",
    "tell it as a 7-day diary (day 1, 3, 7) describing what you noticed — never dressed up as a guaranteed result",
    "สินค้าที่ต้องใช้ต่อเนื่อง", "products that need a few days of use",
    "\"อยากลองเอง เปิดตะกร้าเหลืองดูได้เลยน้า (มีคอมมิชชัน)\"",
    "\"Want to try it yourself? It's in the yellow cart (I earn a commission).\"",
    "ลอง 7 วัน แล้วมาสรุปให้ฟัง 📅", "7-day test, full recap 📅"],
  ["ก่อน–หลังแบบไม่ผิดกฎ", "Honest Before–After",
    "ทำ before–after แบบซื่อสัตย์ (เทียบสภาพการใช้งาน/การจัดเรียง ไม่ใช่ผลลัพธ์สุขภาพ) ระบุว่าอะไรคือความต่างจริง และห้ามตัดต่อให้ดูเกินจริง",
    "an honest before–after (compare usage/setup, not health outcomes), state what genuinely changed, and never exaggerate with editing",
    "สินค้าที่เห็นความต่างจากภาพได้", "products whose change is visible on camera",
    "\"อยากเห็นของจริง เปิดตะกร้าเหลืองดูได้เลย (มีคอมมิชชัน)\"",
    "\"See it for yourself in the yellow cart (I earn a commission).\"",
    "ก่อน–หลังแบบไม่ตัดต่อ ✂️🚫", "Honest before–after ✂️🚫"],
];

/* ================= ชุด MASTER (599) ================= */
const MASTER = {
  id: "599",
  niche_th: "ทุกหมวด (MASTER)",
  niche_en: "All niches (MASTER)",
  angle_th: "วางแผนคอนเทนต์ 30 วัน",
  angle_en: "30-Day Content Plan",
  file: "99-master-plan.md",
  prompt_th: `บทบาท: นักวางแผนคอนเทนต์ TikTok Shop Affiliate (ใช้ร่วมกับแพ็ก 599 Prompt ก๊อปวาง)
INPUT_LANGUAGE=[INPUT_LANGUAGE] | OUTPUT_LANGUAGE=[OUTPUT_LANGUAGE]
กลุ่มเป้าหมาย=[กลุ่มเป้าหมาย] | สินค้า=[สินค้า]
จุดเด่น(ยืนยันได้)=[จุดเด่น 1-2 อย่าง] | ราคา/โปร=[ราคา/โปร]
ประสบการณ์จริง=[ประสบการณ์จริง] | โทน=[โทน] | ความยาว=[ความยาวคลิป]
งาน: ออกแบบ "แผนคอนเทนต์ 30 วัน" สำหรับสินค้าเดียว โดยเลือก 26 หมวด × 23 มุม จากแพ็กนี้ให้เหมาะกับสินค้า แล้วสร้างตาราง 30 บรรทัด: วันที่ | มุมคอนเทนต์ที่ใช้ | แนวคิดคลิป 1 บรรทัด | Hook (คำพูด 1 ประโยค) | CTA ตะกร้า
จากนั้นเลือก 5 คลิปที่ควรทำก่อนสุด พร้อมเหตุผลว่าทำไมถึงเริ่มจากคลิปนั้น
ปิดท้ายด้วย: แคปชันตัวอย่าง 3 แบบ + แฮชแท็ก 5-8 อัน + ประโยคเปิดเผย affiliate ที่พูดได้จริง + วิธีตั้งค่าในแอป + ⚠️ รายการที่ต้องตรวจก่อนโพสต์
กฎ: ใช้เฉพาะข้อเท็จจริงที่ให้ ห้ามแต่งผลลัพธ์/การันตีเวลา ขาดข้อมูลให้เขียน "⚠️ ต้องตรวจสอบ"`,
  prompt_en: `Role: TikTok Shop affiliate content planner (works with the 599 Prompt copy-paste pack).
INPUT_LANGUAGE=[INPUT_LANGUAGE] | OUTPUT_LANGUAGE=[OUTPUT_LANGUAGE]
Audience=[AUDIENCE] | Product=[PRODUCT]
Verified features=[FEATURES] | Price/offer=[PRICE/OFFER]
Real experience=[REAL EXPERIENCE] | Tone=[TONE] | Length=[LENGTH]
Task: design a "30-day content plan" for a single product by picking the right niches × angles from this pack, then produce a 30-row table: Day | angle used | one-line concept | hook (one spoken line) | cart CTA.
Then pick the 5 clips to film first, with a reason for each.
Close with: 3 sample captions + 5–8 hashtags + a spoken affiliate disclosure + the in-app disclosure setting + a ⚠️ pre-post verification list.
Rules: only use the supplied facts; never invent results or timeframe guarantees; if data is missing write "⚠️ NEEDS VERIFICATION".`,
  hook_th: "\"30 วัน 30 คลิป เริ่มจากคลิปนี้ก่อน\"",
  hook_en: "\"30 days, 30 clips — start with this one.\"",
  cta_th: "\"อยากได้แพ็ก 599 ชุดเต็ม เปิดหน้าซื้อได้เลยน้า (มีคอมมิชชัน)\"",
  caption: "แผน 30 วันพร้อมยิง #TikTokShop #affiliate",
};

/* ================= สร้างรายการทั้ง 599 ชุด ================= */
function buildSets() {
  const sets = [];
  let n = 0;
  for (const [slug, th, en, roleTh, roleEn, bestForTh, bestForEn, hookTh, hookEn, tags, risk] of NICHES) {
    for (const [ath, aen, instrTh, instrEn, bfTh, bfEn, ctaTh, ctaEn, capTh] of ANGLES) {
      n += 1;
      const id = String(n).padStart(3, "0");
      sets.push({
        id, slug, niche_th: th, niche_en: en, angle_th: ath, angle_en: aen, file: slug + ".md",
        roleTh, roleEn, bestForTh, bestForEn, hookTh, hookEn, tags, risk: !!risk,
        instrTh, instrEn, bfTh, bfEn, ctaTh, ctaEn, capTh,
      });
    }
  }
  sets.push({ id: MASTER.id, slug: "99-master-plan", niche_th: MASTER.niche_th, niche_en: MASTER.niche_en,
    angle_th: MASTER.angle_th, angle_en: MASTER.angle_en, file: MASTER.file,
    master: true, prompt_th: MASTER.prompt_th, prompt_en: MASTER.prompt_en,
    hookTh: MASTER.hook_th, hookEn: MASTER.hook_en, ctaTh: MASTER.cta_th, ctaEn: "",
    capTh: MASTER.caption, tags: "#TikTokShop #affiliate" });
  return sets;
}

const EIGHT_TH = "งาน: เขียนสคริปต์คลิปแนวตั้งตาม 8 ส่วน: 1)แนวคิด+ความยาว 2)Hook 3 แบบ(คำพูด+ภาพเปิด) 3)Shot list มีวินาที+คำพูด+ข้อความบนจอ 4)จุดเด่น ≤2 จากข้อเท็จจริง 5)CTA กดตะกร้าเหลือง 6)แคปชัน+5-8 แฮชแท็ก 7)ประโยคเปิดเผย affiliate(พูด)+วิธีตั้งค่าในแอป 8)⚠️รายการที่ต้องตรวจก่อนโพสต์";
const EIGHT_EN = "Deliverables (8 sections): 1) concept+length 2) 3 hook options (spoken line + opening visual) 3) timestamped shot list + script + on-screen text 4) ≤2 benefits from verified facts only 5) CTA to the yellow cart 6) caption + 5–8 hashtags 7) spoken affiliate disclosure + in-app setting 8) ⚠️ pre-post verification list.";

function promptTh(s) {
  if (s.master) return s.prompt_th;
  const riskLine = s.risk
    ? "\nคำเตือนหมวดนี้: ห้ามอ้างรักษา/บรรเทาโรค, ห้าม \"ปลอดภัย 100%\", ห้ามภาพก่อน–หลังที่ดูเกินจริง และข้อมูลต้องตรงฉลาก/หน้าสินค้า"
    : "";
  return `บทบาท: ${s.roleTh}
INPUT_LANGUAGE=[INPUT_LANGUAGE] | OUTPUT_LANGUAGE=[OUTPUT_LANGUAGE]
กลุ่มเป้าหมาย=[กลุ่มเป้าหมาย] | สินค้า=[สินค้า]
จุดเด่น(ยืนยันได้)=[จุดเด่น 1-2 อย่าง] | ราคา/โปร=[ราคา/โปร]
ประสบการณ์จริง=[ประสบการณ์จริง] | โทน=[โทน] | ความยาว=[ความยาวคลิป]
มุมเนื้อหา: ${s.instrTh}
${EIGHT_TH}
กฎ: ใช้เฉพาะข้อเท็จจริงที่ให้ ห้ามแต่งผลลัพธ์/การันตีเวลา ขาดข้อมูลให้เขียน "⚠️ ต้องตรวจสอบ"${riskLine}`;
}
function promptEn(s) {
  if (s.master) return s.prompt_en;
  const riskLine = s.risk
    ? "\nCategory caution: no cure/relief claims, no \"100% safe\", no exaggerated before/after, and all info must match the label/listing."
    : "";
  return `Role: ${s.roleEn}.
INPUT_LANGUAGE=[INPUT_LANGUAGE] | OUTPUT_LANGUAGE=[OUTPUT_LANGUAGE]
Audience=[AUDIENCE] | Product=[PRODUCT]
Verified features=[FEATURES] | Price/offer=[PRICE/OFFER]
Real experience=[REAL EXPERIENCE] | Tone=[TONE] | Length=[LENGTH]
Angle: ${s.instrEn}
${EIGHT_EN}
Rules: only use supplied facts; never invent results or timeframe guarantees; if data is missing write "⚠️ NEEDS VERIFICATION".${riskLine}`;
}

/* ================= เขียนไฟล์ ================= */
const esc = (v) => {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function writeCsv(file, header, rows) {
  const body = [header.join(","), ...rows.map((r) => r.map(esc).join(","))].join("\r\n") + "\r\n";
  fs.writeFileSync(file, "\uFEFF" + body, "utf8");
}

function nicheHeader(s) {
  const warn = s.risk
    ? `\n> ⚠️ หมวดเสี่ยง: ห้ามอ้างรักษา/บรรเทาโรค, ห้าม "ปลอดภัย 100%", ห้ามภาพก่อน–หลังที่ดูเกินจริง\n> High-risk category: no cure/disease claims, no "100% safe", no exaggerated before/after.\n`
    : "";
  return `# ${s.slug} · ${s.niche_th} · ${s.niche_en}\nใช้คู่กับ SYSTEM PROMPT ใน \`../00_master-template.md\` · Use with the SYSTEM PROMPT in \`../00_master-template.md\`\n${warn}`;
}

function setBlock(s) {
  const best = s.master
    ? "ทุกสินค้า · ใช้เป็นแผนหลักก่อนเริ่มยิงคลิปต่อเนื่อง"
    : `${s.bestForTh} · ${s.bfTh}`;
  return `## ${s.id} · ${s.angle_th} · ${s.angle_en}
**หมวด/Niche:** ${s.niche_th} · **มุม/Angle:** ${s.angle_th}
**เหมาะกับ/Best for:** ${best}

**PROMPT (TH)**
\`\`\`text
${promptTh(s)}
\`\`\`

**PROMPT (EN)**
\`\`\`text
${promptEn(s)}
\`\`\`

**ตัวอย่างผลลัพธ์ (สมมติ) / Example output (illustrative)**
> **Hook (TH):** ${s.hookTh}
> **Hook (EN):** ${s.hookEn}
> **CTA (TH):** ${s.ctaTh}
> **Caption:** ${s.capTh} ${s.tags}

---

`;
}

function render() {
  const sets = buildSets();
  const files = new Map();          // slug -> markdown
  const indexRows = [];
  const packRows = [];
  for (const s of sets) {
    indexRows.push([s.id, s.niche_th, s.niche_en, s.angle_th, s.angle_en, s.file]);
    packRows.push([s.id, s.niche_th, s.niche_en, s.angle_th, s.angle_en, s.angle_en, s.file,
      promptTh(s), promptEn(s), s.hookTh, s.hookEn, s.ctaTh, `${s.capTh} ${s.tags}`]);
    if (!files.has(s.slug)) files.set(s.slug, { header: nicheHeader(s), blocks: [] });
    files.get(s.slug).blocks.push(setBlock(s));
  }
  return { sets, files, indexRows, packRows };
}

function check() {
  const { sets } = render();
  const bad = [];
  if (sets.length !== 599) bad.push(`จำนวนชุด = ${sets.length} (ต้องเป็น 599)`);
  const ids = new Set(sets.map((s) => s.id));
  if (ids.size !== 599) bad.push(`id ซ้ำ/ไม่ครบ: ${ids.size}`);
  for (let i = 1; i <= 599; i++) {
    const id = String(i).padStart(3, "0");
    if (!ids.has(id)) { bad.push(`ขาด id ${id}`); break; }
  }
  const pairs = new Set(sets.map((s) => s.niche_en + "|" + s.angle_en));
  if (pairs.size !== 599) bad.push(`คู่ หมวด×มุม ซ้ำ: ${pairs.size}`);
  console.log(bad.length ? "❌ " + bad.join(" · ") : `✅ 599 ชุด (${NICHES.length} หมวด × ${ANGLES.length} มุม + MASTER) · id ไม่ซ้ำ · คู่ หมวด×มุม ไม่ซ้ำ`);
  return bad.length ? 1 : 0;
}

const isCheck = process.argv.includes("--check");
const code = check();
if (isCheck) process.exit(code);

const { files, indexRows, packRows } = render();

fs.rmSync(PROMPTS_DIR, { recursive: true, force: true });
fs.mkdirSync(PROMPTS_DIR, { recursive: true });
for (const [slug, { header, blocks }] of files) {
  fs.writeFileSync(path.join(PROMPTS_DIR, slug + ".md"), header + "\n---\n\n" + blocks.join(""), "utf8");
}
writeCsv(INDEX_CSV, ["id", "niche_th", "niche_en", "angle_th", "angle_en", "file"], indexRows);
writeCsv(PACK_CSV, ["id", "niche_th", "niche_en", "angle_th", "angle_en", "title", "file",
  "prompt_th", "prompt_en", "example_hook_th", "example_hook_en", "example_cta_th", "example_caption"], packRows);

console.log(`✅ เขียน ${files.size} ไฟล์ใน prompts/ · index.csv ${indexRows.length} แถว · prompts-599.csv ${packRows.length} แถว (${NICHES.length} หมวด × ${ANGLES.length} มุม + MASTER)`);
