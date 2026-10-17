#!/usr/bin/env bash
# เทสต์ขายจริงในเครื่อง: วาง PDF ลง R2 local → สตาร์ท workerd (wrangler dev) → รัน tools/sale-smoke.mjs → ปิดเซิร์ฟเวอร์
# ใช้: bash tools/live-sale.sh [พอร์ต]        (ค่าเริ่มต้น 8802)
# ต้องมี: shop/.dev.vars (คีย์ Resend ที่ใช้ได้ + MAIL_FROM + ADMIN_TOKEN + NOTIFY_EMAIL)
#         ถ้าอีเมลไม่ส่ง ตรวจก่อนด้วย  node tools/send-test-email.mjs  หรือซิงก์คีย์ใหม่ด้วย  node tools/sync-dev-vars.mjs
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHOP="$(dirname "$HERE")"
PORT="${1:-8802}"
LOG="/tmp/live-sale-$PORT.log"

if curl -s -m 2 -o /dev/null "http://127.0.0.1:$PORT/api/health"; then
  echo "!! พอร์ต $PORT ถูกใช้อยู่ — เลือกพอร์ตอื่น (เช่น 8803)"; exit 2
fi

cd "$SHOP" || exit 2
npx --yes wrangler r2 object put promptpack-files/prompt-pack.pdf --file=build/prompt-pack.pdf --local 2>&1 | tail -1
# ล้างข้อมูลที่ “เทสต์นี้สร้างเอง” จากรอบก่อน (source='qa-live') ใน D1 local — ทำให้รันซ้ำได้ทันทีโดยไม่ติดลิมิตของแถม 3 ครั้ง/ชม.
npx --yes wrangler d1 execute promptpack-orders --local --command "DELETE FROM email_log WHERE kind='free' AND email IN (SELECT email FROM leads WHERE source='qa-live')" 2>&1 | tail -1
npx --yes wrangler d1 execute promptpack-orders --local --command "DELETE FROM leads WHERE source='qa-live'" 2>&1 | tail -1
rm -f "$LOG"
# setsid → wrangler + workerd เป็น process group เดียว จะฆ่าล้างได้ทั้งกลุ่ม (ไม่เหลือ workerd ค้าง)
setsid npx --yes wrangler dev --port "$PORT" --ip 127.0.0.1 --var "APP_ORIGIN:http://127.0.0.1:$PORT" > "$LOG" 2>&1 &
WPID=$!

# ปิดทั้ง process group ของรอบนี้ + กันเหนียวเฉพาะ process ของพอร์ตนี้ (ไม่ใช้ pkill แบบกว้าง เพราะอาจไปโดนของคนอื่น)
cleanup() {
  kill -TERM -- "-$WPID" 2>/dev/null
  sleep 1
  kill -9 -- "-$WPID" 2>/dev/null
  pkill -9 -f "wrangler-dist/cli.js dev --port $PORT" 2>/dev/null
  pkill -9 -f "socket-addr=entry=127.0.0.1:$PORT" 2>/dev/null
  wait $WPID 2>/dev/null
}
trap cleanup EXIT

ready=0
for i in $(seq 1 60); do
  grep -q "Address already in use" "$LOG" 2>/dev/null && { tail -5 "$LOG"; exit 2; }
  [ "$(curl -s -m 2 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/health" || true)" = "200" ] && { ready=1; break; }
  sleep 1
done
[ "$ready" = "1" ] || { echo "!! workerd ไม่พร้อมใน 60 วิ"; tail -25 "$LOG"; exit 1; }
echo "== workerd พร้อม (พอร์ต $PORT, ${i}วิ) =="

# ใช้ค่าที่เซิร์ฟเวอร์โหลดจริงจาก .dev.vars (ไม่ใช่ .secrets — คนละชุด แล้วแต่สภาพแวดล้อม)
DEV_TOKEN="$(grep '^ADMIN_TOKEN=' .dev.vars | cut -d= -f2- | tr -d '"')"
DEV_NOTIFY="$(grep '^NOTIFY_EMAIL=' .dev.vars | cut -d= -f2- | tr -d '"')"
# รหัสพร้อมเพย์ที่ตั้งไว้จริง (ตัด @รหัสธนาคารออก) → ให้เทสต์ยืนยันว่า QR ชี้เลขที่ตั้งไว้ ไม่ใช่ค่าค้างเก่า
DEV_PP="$(grep '^PROMPTPAY_OPTIONS=' .dev.vars | cut -d= -f2- | tr -d '"')"
EXPECT_IDS="$(printf '%s' "$DEV_PP" | tr ',' '\n' | sed 's/@.*//' | sed 's/^ *//; s/ *$//' | grep -v '^$' | paste -sd, -)"
BASE="http://127.0.0.1:$PORT" ADMIN_TOKEN="$DEV_TOKEN" BUYER_EMAIL="$DEV_NOTIFY" EXPECT_IDS="$EXPECT_IDS" \
  node "$HERE/sale-smoke.mjs"
RC=$?

echo "--- log ที่เกี่ยวกับอีเมล/ข้อผิดพลาดจาก worker ---"
grep -Ei "resend|email|error" "$LOG" | tail -15
echo "LIVE_SALE_EXIT=$RC"
exit $RC
