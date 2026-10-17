/**
 * free-sample.mjs — 5 prompt แรกของแพ็ก (ของแถมในหน้า /free) · **ห้ามแก้ไฟล์นี้ด้วยมือ**
 * สร้างจาก ../prompts-599.csv ด้วย `node tools/build-free-sample.mjs`
 * เทสต์จะตรวจ sha256 ของ CSV + ว่า prompt ทุกชุดตรงกับต้นฉบับ (กันของแถมกับของที่ขายไม่ตรงกัน)
 */
export const FREE_SAMPLE_META = {
  product: "599 Prompt ก๊อปวาง",
  count: 5,
  ids: ["001","002","003","004","005"],
  source: "../prompts-599.csv",
  source_sha256: "8e3d29a9cd9648a30a5b485f61f0a84212fb7aad81ff5a10cd8b8be64f7b261a",
};

export const FREE_SAMPLES = [
  {
    "id": "001",
    "niche_th": "สกินแคร์/ความงาม",
    "niche_en": "Skincare & Beauty",
    "angle_th": "Problem–Solution",
    "angle_en": "Problem–Solution",
    "file": "01-beauty-skincare.md",
    "hook_th": "\"ผิวแห้งจนแต่งหน้าไม่ติด ใครเป็นแบบนี้บ้าง 🙋‍♀️\"",
    "cta_th": "\"อยากรู้ว่าเข้ากับเราไหม เปิดตะกร้าเหลืองดูรายละเอียดได้เลยน้า (คลิปนี้มีคอมมิชชัน)\"",
    "prompt_th": "บทบาท: นักเขียนสคริปต์ TikTok Shop Affiliate สายสกินแคร์\nINPUT_LANGUAGE=[INPUT_LANGUAGE] | OUTPUT_LANGUAGE=[OUTPUT_LANGUAGE]\nกลุ่มเป้าหมาย=[กลุ่มเป้าหมาย] | สินค้า=[สินค้า]\nจุดเด่น(ยืนยันได้)=[จุดเด่น 1-2 อย่าง] | ราคา/โปร=[ราคา/โปร]\nประสบการณ์จริง=[ประสบการณ์จริง] | โทน=[โทน] | ความยาว=[ความยาวคลิป]\nมุมเนื้อหา: เปิดด้วย \"ปัญหา\" ที่คนดูอิน 3 วิแรก → เกริ่นว่าลองมาหลายอย่าง → แนะนำสินค้าและสาธิตของจริง → CTA ตะกร้า\nงาน: เขียนสคริปต์คลิปแนวตั้งตาม 8 ส่วน: 1)แนวคิด+ความยาว 2)Hook 3 แบบ(คำพูด+ภาพเปิด) 3)Shot list มีวินาที+คำพูด+ข้อความบนจอ 4)จุดเด่น ≤2 จากข้อเท็จจริง 5)CTA กดตะกร้าเหลือง 6)แคปชัน+5-8 แฮชแท็ก 7)ประโยคเปิดเผย affiliate(พูด)+วิธีตั้งค่าในแอป 8)⚠️รายการที่ต้องตรวจก่อนโพสต์\nกฎ: ใช้เฉพาะข้อเท็จจริงที่ให้ ห้ามแต่งผลลัพธ์/การันตีเวลา ขาดข้อมูลให้เขียน \"⚠️ ต้องตรวจสอบ\"\nคำเตือนหมวดนี้: ห้ามอ้างรักษา/บรรเทาโรค, ห้าม \"ปลอดภัย 100%\", ห้ามภาพก่อน–หลังที่ดูเกินจริง และข้อมูลต้องตรงฉลาก/หน้าสินค้า",
    "prompt_en": "Role: TikTok Shop affiliate scriptwriter for skincare.\nINPUT_LANGUAGE=[INPUT_LANGUAGE] | OUTPUT_LANGUAGE=[OUTPUT_LANGUAGE]\nAudience=[AUDIENCE] | Product=[PRODUCT]\nVerified features=[FEATURES] | Price/offer=[PRICE/OFFER]\nReal experience=[REAL EXPERIENCE] | Tone=[TONE] | Length=[LENGTH]\nAngle: open on a relatable problem in the first 3s → hint you tried many things → intro the product with a real demo → cart CTA\nDeliverables (8 sections): 1) concept+length 2) 3 hook options (spoken line + opening visual) 3) timestamped shot list + script + on-screen text 4) ≤2 benefits from verified facts only 5) CTA to the yellow cart 6) caption + 5–8 hashtags 7) spoken affiliate disclosure + in-app setting 8) ⚠️ pre-post verification list.\nRules: only use supplied facts; never invent results or timeframe guarantees; if data is missing write \"⚠️ NEEDS VERIFICATION\".\nCategory caution: no cure/relief claims, no \"100% safe\", no exaggerated before/after, and all info must match the label/listing."
  },
  {
    "id": "002",
    "niche_th": "สกินแคร์/ความงาม",
    "niche_en": "Skincare & Beauty",
    "angle_th": "รีวิวประสบการณ์จริง",
    "angle_en": "Real Experience Review",
    "file": "01-beauty-skincare.md",
    "hook_th": "\"ผิวแห้งจนแต่งหน้าไม่ติด ใครเป็นแบบนี้บ้าง 🙋‍♀️\"",
    "cta_th": "\"ใครอยากลอง เปิดตะกร้าเหลืองดูโปรได้เลยน้า (คลิปนี้มีคอมมิชชัน)\"",
    "prompt_th": "บทบาท: นักเขียนสคริปต์ TikTok Shop Affiliate สายสกินแคร์\nINPUT_LANGUAGE=[INPUT_LANGUAGE] | OUTPUT_LANGUAGE=[OUTPUT_LANGUAGE]\nกลุ่มเป้าหมาย=[กลุ่มเป้าหมาย] | สินค้า=[สินค้า]\nจุดเด่น(ยืนยันได้)=[จุดเด่น 1-2 อย่าง] | ราคา/โปร=[ราคา/โปร]\nประสบการณ์จริง=[ประสบการณ์จริง] | โทน=[โทน] | ความยาว=[ความยาวคลิป]\nมุมเนื้อหา: รีวิวบาลานซ์ — บอกข้อดี 1–2 ข้อจากที่ใช้จริง + ข้อจำกัดตามจริง 1 ข้อ แล้วระบุระยะเวลาที่ใช้ชัดเจน\nงาน: เขียนสคริปต์คลิปแนวตั้งตาม 8 ส่วน: 1)แนวคิด+ความยาว 2)Hook 3 แบบ(คำพูด+ภาพเปิด) 3)Shot list มีวินาที+คำพูด+ข้อความบนจอ 4)จุดเด่น ≤2 จากข้อเท็จจริง 5)CTA กดตะกร้าเหลือง 6)แคปชัน+5-8 แฮชแท็ก 7)ประโยคเปิดเผย affiliate(พูด)+วิธีตั้งค่าในแอป 8)⚠️รายการที่ต้องตรวจก่อนโพสต์\nกฎ: ใช้เฉพาะข้อเท็จจริงที่ให้ ห้ามแต่งผลลัพธ์/การันตีเวลา ขาดข้อมูลให้เขียน \"⚠️ ต้องตรวจสอบ\"\nคำเตือนหมวดนี้: ห้ามอ้างรักษา/บรรเทาโรค, ห้าม \"ปลอดภัย 100%\", ห้ามภาพก่อน–หลังที่ดูเกินจริง และข้อมูลต้องตรงฉลาก/หน้าสินค้า",
    "prompt_en": "Role: TikTok Shop affiliate scriptwriter for skincare.\nINPUT_LANGUAGE=[INPUT_LANGUAGE] | OUTPUT_LANGUAGE=[OUTPUT_LANGUAGE]\nAudience=[AUDIENCE] | Product=[PRODUCT]\nVerified features=[FEATURES] | Price/offer=[PRICE/OFFER]\nReal experience=[REAL EXPERIENCE] | Tone=[TONE] | Length=[LENGTH]\nAngle: balanced review — 1–2 real pros from first-hand use + 1 honest limitation, and state the exact usage period\nDeliverables (8 sections): 1) concept+length 2) 3 hook options (spoken line + opening visual) 3) timestamped shot list + script + on-screen text 4) ≤2 benefits from verified facts only 5) CTA to the yellow cart 6) caption + 5–8 hashtags 7) spoken affiliate disclosure + in-app setting 8) ⚠️ pre-post verification list.\nRules: only use supplied facts; never invent results or timeframe guarantees; if data is missing write \"⚠️ NEEDS VERIFICATION\".\nCategory caution: no cure/relief claims, no \"100% safe\", no exaggerated before/after, and all info must match the label/listing."
  },
  {
    "id": "003",
    "niche_th": "สกินแคร์/ความงาม",
    "niche_en": "Skincare & Beauty",
    "angle_th": "Unboxing แกะกล่อง",
    "angle_en": "Unboxing",
    "file": "01-beauty-skincare.md",
    "hook_th": "\"ผิวแห้งจนแต่งหน้าไม่ติด ใครเป็นแบบนี้บ้าง 🙋‍♀️\"",
    "cta_th": "\"ของในกล่องมีเท่านี้ อยากรู้อีกกดเปิดตะกร้าเหลืองได้เลย (มีคอมมิชชัน)\"",
    "prompt_th": "บทบาท: นักเขียนสคริปต์ TikTok Shop Affiliate สายสกินแคร์\nINPUT_LANGUAGE=[INPUT_LANGUAGE] | OUTPUT_LANGUAGE=[OUTPUT_LANGUAGE]\nกลุ่มเป้าหมาย=[กลุ่มเป้าหมาย] | สินค้า=[สินค้า]\nจุดเด่น(ยืนยันได้)=[จุดเด่น 1-2 อย่าง] | ราคา/โปร=[ราคา/โปร]\nประสบการณ์จริง=[ประสบการณ์จริง] | โทน=[โทน] | ความยาว=[ความยาวคลิป]\nมุมเนื้อหา: แกะกล่องจริง โชว์บรรจุภัณฑ์ ปริมาณ และของในกล่อง (บรรยายจากของจริงเท่านั้น) → first impression → CTA\nงาน: เขียนสคริปต์คลิปแนวตั้งตาม 8 ส่วน: 1)แนวคิด+ความยาว 2)Hook 3 แบบ(คำพูด+ภาพเปิด) 3)Shot list มีวินาที+คำพูด+ข้อความบนจอ 4)จุดเด่น ≤2 จากข้อเท็จจริง 5)CTA กดตะกร้าเหลือง 6)แคปชัน+5-8 แฮชแท็ก 7)ประโยคเปิดเผย affiliate(พูด)+วิธีตั้งค่าในแอป 8)⚠️รายการที่ต้องตรวจก่อนโพสต์\nกฎ: ใช้เฉพาะข้อเท็จจริงที่ให้ ห้ามแต่งผลลัพธ์/การันตีเวลา ขาดข้อมูลให้เขียน \"⚠️ ต้องตรวจสอบ\"\nคำเตือนหมวดนี้: ห้ามอ้างรักษา/บรรเทาโรค, ห้าม \"ปลอดภัย 100%\", ห้ามภาพก่อน–หลังที่ดูเกินจริง และข้อมูลต้องตรงฉลาก/หน้าสินค้า",
    "prompt_en": "Role: TikTok Shop affiliate scriptwriter for skincare.\nINPUT_LANGUAGE=[INPUT_LANGUAGE] | OUTPUT_LANGUAGE=[OUTPUT_LANGUAGE]\nAudience=[AUDIENCE] | Product=[PRODUCT]\nVerified features=[FEATURES] | Price/offer=[PRICE/OFFER]\nReal experience=[REAL EXPERIENCE] | Tone=[TONE] | Length=[LENGTH]\nAngle: real unboxing — show packaging, quantity and what's inside (describe only what is there) → first impression → CTA\nDeliverables (8 sections): 1) concept+length 2) 3 hook options (spoken line + opening visual) 3) timestamped shot list + script + on-screen text 4) ≤2 benefits from verified facts only 5) CTA to the yellow cart 6) caption + 5–8 hashtags 7) spoken affiliate disclosure + in-app setting 8) ⚠️ pre-post verification list.\nRules: only use supplied facts; never invent results or timeframe guarantees; if data is missing write \"⚠️ NEEDS VERIFICATION\".\nCategory caution: no cure/relief claims, no \"100% safe\", no exaggerated before/after, and all info must match the label/listing."
  },
  {
    "id": "004",
    "niche_th": "สกินแคร์/ความงาม",
    "niche_en": "Skincare & Beauty",
    "angle_th": "สาธิต/ทดสอบการใช้งาน",
    "angle_en": "Demo & Test",
    "file": "01-beauty-skincare.md",
    "hook_th": "\"ผิวแห้งจนแต่งหน้าไม่ติด ใครเป็นแบบนี้บ้าง 🙋‍♀️\"",
    "cta_th": "\"อยากดูสเปกเต็มกับราคา เปิดตะกร้าเหลืองเลยน้า (มีคอมมิชชัน)\"",
    "prompt_th": "บทบาท: นักเขียนสคริปต์ TikTok Shop Affiliate สายสกินแคร์\nINPUT_LANGUAGE=[INPUT_LANGUAGE] | OUTPUT_LANGUAGE=[OUTPUT_LANGUAGE]\nกลุ่มเป้าหมาย=[กลุ่มเป้าหมาย] | สินค้า=[สินค้า]\nจุดเด่น(ยืนยันได้)=[จุดเด่น 1-2 อย่าง] | ราคา/โปร=[ราคา/โปร]\nประสบการณ์จริง=[ประสบการณ์จริง] | โทน=[โทน] | ความยาว=[ความยาวคลิป]\nมุมเนื้อหา: สาธิตการใช้งานจริงแบบไม่ตัดต่อหลอกตา และแยกให้ชัดว่าส่วนไหนทดสอบเอง ส่วนไหนอ้างจากสเปก → สรุป → CTA\nงาน: เขียนสคริปต์คลิปแนวตั้งตาม 8 ส่วน: 1)แนวคิด+ความยาว 2)Hook 3 แบบ(คำพูด+ภาพเปิด) 3)Shot list มีวินาที+คำพูด+ข้อความบนจอ 4)จุดเด่น ≤2 จากข้อเท็จจริง 5)CTA กดตะกร้าเหลือง 6)แคปชัน+5-8 แฮชแท็ก 7)ประโยคเปิดเผย affiliate(พูด)+วิธีตั้งค่าในแอป 8)⚠️รายการที่ต้องตรวจก่อนโพสต์\nกฎ: ใช้เฉพาะข้อเท็จจริงที่ให้ ห้ามแต่งผลลัพธ์/การันตีเวลา ขาดข้อมูลให้เขียน \"⚠️ ต้องตรวจสอบ\"\nคำเตือนหมวดนี้: ห้ามอ้างรักษา/บรรเทาโรค, ห้าม \"ปลอดภัย 100%\", ห้ามภาพก่อน–หลังที่ดูเกินจริง และข้อมูลต้องตรงฉลาก/หน้าสินค้า",
    "prompt_en": "Role: TikTok Shop affiliate scriptwriter for skincare.\nINPUT_LANGUAGE=[INPUT_LANGUAGE] | OUTPUT_LANGUAGE=[OUTPUT_LANGUAGE]\nAudience=[AUDIENCE] | Product=[PRODUCT]\nVerified features=[FEATURES] | Price/offer=[PRICE/OFFER]\nReal experience=[REAL EXPERIENCE] | Tone=[TONE] | Length=[LENGTH]\nAngle: demo the product for real, no deceptive cuts, and clearly separate what you tested from what you read on the spec → CTA\nDeliverables (8 sections): 1) concept+length 2) 3 hook options (spoken line + opening visual) 3) timestamped shot list + script + on-screen text 4) ≤2 benefits from verified facts only 5) CTA to the yellow cart 6) caption + 5–8 hashtags 7) spoken affiliate disclosure + in-app setting 8) ⚠️ pre-post verification list.\nRules: only use supplied facts; never invent results or timeframe guarantees; if data is missing write \"⚠️ NEEDS VERIFICATION\".\nCategory caution: no cure/relief claims, no \"100% safe\", no exaggerated before/after, and all info must match the label/listing."
  },
  {
    "id": "005",
    "niche_th": "สกินแคร์/ความงาม",
    "niche_en": "Skincare & Beauty",
    "angle_th": "เปรียบเทียบ A vs B",
    "angle_en": "A vs B Comparison",
    "file": "01-beauty-skincare.md",
    "hook_th": "\"ผิวแห้งจนแต่งหน้าไม่ติด ใครเป็นแบบนี้บ้าง 🙋‍♀️\"",
    "cta_th": "\"เลือกไม่ถูกก็เปิดตะกร้าเหลืองเทียบราคาก่อนได้เลย (มีคอมมิชชัน)\"",
    "prompt_th": "บทบาท: นักเขียนสคริปต์ TikTok Shop Affiliate สายสกินแคร์\nINPUT_LANGUAGE=[INPUT_LANGUAGE] | OUTPUT_LANGUAGE=[OUTPUT_LANGUAGE]\nกลุ่มเป้าหมาย=[กลุ่มเป้าหมาย] | สินค้า=[สินค้า]\nจุดเด่น(ยืนยันได้)=[จุดเด่น 1-2 อย่าง] | ราคา/โปร=[ราคา/โปร]\nประสบการณ์จริง=[ประสบการณ์จริง] | โทน=[โทน] | ความยาว=[ความยาวคลิป]\nมุมเนื้อหา: เทียบ 2 ตัวเลือกจากข้อเท็จจริง (ราคา สเปก การใช้งาน) แล้วบอกตรง ๆ ว่าใครควรเลือกอันไหน — ห้ามเอียงข้างใดข้างหนึ่ง\nงาน: เขียนสคริปต์คลิปแนวตั้งตาม 8 ส่วน: 1)แนวคิด+ความยาว 2)Hook 3 แบบ(คำพูด+ภาพเปิด) 3)Shot list มีวินาที+คำพูด+ข้อความบนจอ 4)จุดเด่น ≤2 จากข้อเท็จจริง 5)CTA กดตะกร้าเหลือง 6)แคปชัน+5-8 แฮชแท็ก 7)ประโยคเปิดเผย affiliate(พูด)+วิธีตั้งค่าในแอป 8)⚠️รายการที่ต้องตรวจก่อนโพสต์\nกฎ: ใช้เฉพาะข้อเท็จจริงที่ให้ ห้ามแต่งผลลัพธ์/การันตีเวลา ขาดข้อมูลให้เขียน \"⚠️ ต้องตรวจสอบ\"\nคำเตือนหมวดนี้: ห้ามอ้างรักษา/บรรเทาโรค, ห้าม \"ปลอดภัย 100%\", ห้ามภาพก่อน–หลังที่ดูเกินจริง และข้อมูลต้องตรงฉลาก/หน้าสินค้า",
    "prompt_en": "Role: TikTok Shop affiliate scriptwriter for skincare.\nINPUT_LANGUAGE=[INPUT_LANGUAGE] | OUTPUT_LANGUAGE=[OUTPUT_LANGUAGE]\nAudience=[AUDIENCE] | Product=[PRODUCT]\nVerified features=[FEATURES] | Price/offer=[PRICE/OFFER]\nReal experience=[REAL EXPERIENCE] | Tone=[TONE] | Length=[LENGTH]\nAngle: compare two options on facts (price, spec, use) and say plainly who should pick which — stay honest both ways\nDeliverables (8 sections): 1) concept+length 2) 3 hook options (spoken line + opening visual) 3) timestamped shot list + script + on-screen text 4) ≤2 benefits from verified facts only 5) CTA to the yellow cart 6) caption + 5–8 hashtags 7) spoken affiliate disclosure + in-app setting 8) ⚠️ pre-post verification list.\nRules: only use supplied facts; never invent results or timeframe guarantees; if data is missing write \"⚠️ NEEDS VERIFICATION\".\nCategory caution: no cure/relief claims, no \"100% safe\", no exaggerated before/after, and all info must match the label/listing."
  }
];
