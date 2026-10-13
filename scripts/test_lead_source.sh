#!/bin/bash
# Test Lead Source Attribution locally without running paid ads
# Usage: ./scripts/test_lead_source.sh [facebook|tiktok|direct]

SOURCE="${1:-facebook}"

echo "=================================================="
echo " Simulating Incoming WhatsApp Message with Source: $SOURCE"
echo "=================================================="

case "$SOURCE" in
  facebook)
    PAYLOAD='{
      "session": "huyt",
      "event": "message",
      "payload": {
        "id": "sim_fb_'"$(date +%s)"'",
        "from": "94770001111@c.us",
        "body": "Hi! Interested in ordering via Facebook Ad promo.",
        "_data": {
          "pushName": "FB Lead Tester",
          "message": {
            "conversation": "Hi! Interested in ordering via Facebook Ad promo.",
            "contextInfo": {
              "externalAdReply": {
                "title": "Summer Flash Sale 50% Off",
                "sourceUrl": "https://facebook.com/ad?ad_id=fb_ad_2026&campaign_id=summer_sale",
                "sourceType": "facebook"
              }
            }
          }
        }
      }
    }'
    ;;
  tiktok)
    PAYLOAD='{
      "session": "huyt",
      "event": "message",
      "payload": {
        "id": "sim_tt_'"$(date +%s)"'",
        "from": "94770002222@c.us",
        "body": "Hi, I saw your viral TikTok video, how to buy?",
        "_data": {
          "pushName": "TikTok Lead Tester",
          "message": {
            "conversation": "Hi, I saw your viral TikTok video, how to buy?",
            "contextInfo": {
              "externalAdReply": {
                "title": "Viral Gadget Unboxing Video",
                "sourceUrl": "https://tiktok.com/@store/video/1001?ad_id=tt_ad_777&campaign_id=viral_campaign",
                "sourceType": "tiktok"
              }
            }
          }
        }
      }
    }'
    ;;
  direct)
    PAYLOAD='{
      "session": "huyt",
      "event": "message",
      "payload": {
        "id": "sim_dir_'"$(date +%s)"'",
        "from": "94770003333@c.us",
        "body": "Hello! Direct WhatsApp message.",
        "_data": {
          "pushName": "Direct Customer Tester",
          "message": {
            "conversation": "Hello! Direct WhatsApp message."
          }
        }
      }
    }'
    ;;
  *)
    echo "Unknown source. Choose facebook, tiktok, or direct."
    exit 1
    ;;
esac

docker exec waha node -e '
const payload = '"$PAYLOAD"';
fetch("http://supabase-edge-functions:9000/functions/v1/webhook-wsender-Dakshila_Dilina", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload)
})
.then(r => r.json())
.then(data => {
  console.log("Edge Function Response:", data);
  console.log("\nSuccess! Lead has been attributed and stored.");
  console.log("Check the Leads or Dashboard tab on http://localhost:8080 to see results.");
})
.catch(err => console.error("Error:", err));
'
