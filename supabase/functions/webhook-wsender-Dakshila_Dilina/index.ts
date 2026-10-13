import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// NOTE: Endpoint name kept as `webhook-wsender` for backward compatibility with anything
// that may still reference its URL. It now consumes WAHA webhook payloads.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

function extractPhoneFromJid(jid: string): string {
  return String(jid || "")
    .replace(/@s\.whatsapp\.net$/i, "")
    .replace(/@c\.us$/i, "")
    .replace(/^\+/, "")
    .replace(/[^\d]/g, "");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    db: { schema: "Dakshila_Dilina" },
  });

  const correlationId = crypto.randomUUID();

  try {
    const body = await req.json();
    console.log(`[${correlationId}] WAHA webhook:`, JSON.stringify(body).substring(0, 600));

    const event = body?.event;
    const sessionName = body?.session;
    const wp = body?.payload || {};

    if (!sessionName) {
      return new Response(JSON.stringify({ error: "Missing session in payload" }), {
        status: 400, headers: jsonHeaders,
      });
    }

    // Map WAHA session name → owning user. We store the WAHA session name in
    // user_wsender_sessions.session_id (and a duplicate in session_api_key for
    // downstream compatibility — that field is now interpreted as the session name).
    const { data: sessionMapping } = await supabase
      .from("user_wsender_sessions")
      .select("user_id, session_id")
      .or(`session_id.eq.${sessionName},session_api_key.eq.${sessionName}`)
      .limit(1)
      .maybeSingle();

    const userId = sessionMapping?.user_id || null;

    // Handle session.status events: just log + acknowledge.
    if (event === "session.status") {
      console.log(`[${correlationId}] session.status for ${sessionName}: ${wp?.status}`);
      return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });
    }

    if (event !== "message" && event !== "message.any") {
      console.log(`[${correlationId}] Ignoring event: ${event}`);
      return new Response(JSON.stringify({ ok: true, skipped: event }), { headers: jsonHeaders });
    }

    if (wp?.fromMe === true) {
      return new Response(JSON.stringify({ ok: true, skipped: "fromMe" }), { headers: jsonHeaders });
    }

    const fromJid = String(wp.from || wp._data?.key?.remoteJid || "");
    if (/@g\.us$/i.test(fromJid) || /@broadcast$/i.test(fromJid) || /@newsletter$/i.test(fromJid)) {
      return new Response(JSON.stringify({ ok: true, skipped: "non_individual" }), { headers: jsonHeaders });
    }

    let phoneNumber = "";

    // WhatsApp now delivers many chats with a privacy "@lid" identifier instead of the
    // real phone number. Sending to that raw number fails silently, so resolve it via
    // WAHA's lid → phone-number mapping first.
    if (/@lid$/i.test(fromJid)) {
      const wahaBase = (Deno.env.get("WAHA_BASE_URL") || "").replace(/\/+$/, "");
      const wahaKey = Deno.env.get("WAHA_API_KEY") || "";
      try {
        const lidRes = await fetch(`${wahaBase}/api/${encodeURIComponent(sessionName)}/lids/${encodeURIComponent(fromJid)}`, {
          headers: { "X-Api-Key": wahaKey, Accept: "application/json" },
          signal: AbortSignal.timeout(10_000),
        });
        if (lidRes.ok) {
          const lidData = await lidRes.json();
          phoneNumber = extractPhoneFromJid(lidData?.pn || "");
          console.log(`[${correlationId}] Resolved ${fromJid} → ${phoneNumber || "(none)"}`);
        } else {
          console.warn(`[${correlationId}] LID lookup failed (${lidRes.status})`);
        }
      } catch (err) {
        console.warn(`[${correlationId}] LID lookup error:`, (err as Error).message);
      }
      // Fall back to the full lid JID so replies still route to the right chat.
      if (!phoneNumber) phoneNumber = fromJid;
    } else {
      phoneNumber = extractPhoneFromJid(fromJid)
        || extractPhoneFromJid(wp._data?.key?.participantPn || "")
        || extractPhoneFromJid(wp._data?.key?.senderPn || "");
    }

    if (!phoneNumber) {
      console.warn(`[${correlationId}] Could not extract phone from`, fromJid);
      return new Response(JSON.stringify({ error: "No phone number" }), { status: 400, headers: jsonHeaders });
    }


    // Text body — WAHA usually puts it on payload.body
    const messageText = wp.body
      || wp._data?.message?.conversation
      || wp._data?.message?.extendedTextMessage?.text
      || "";

    // Message type — derive from WAHA `type` or `_data.message.*` keys
    let messageType = wp.type || "text";
    if (messageType === "chat") messageType = "text";
    
    const wMsg = wp._data?.message || {};
    if (wMsg.imageMessage) messageType = "image";
    else if (wMsg.videoMessage) messageType = "video";
    else if (wMsg.audioMessage) messageType = wMsg.audioMessage?.ptt ? "ptt" : "audio";
    else if (wMsg.documentMessage) messageType = "document";
    else if (wMsg.stickerMessage) messageType = "sticker";
    else if (wMsg.locationMessage) messageType = "location";
    else if (wp.hasMedia && !messageText && messageType === "text") messageType = "image";

    const senderName = wp._data?.pushName || wp._data?.notifyName || wp.notifyName || "Unknown";
    const wahaMessageId = wp.id || wp._data?.key?.id || `${phoneNumber}-${Date.now()}`;

    if (!userId) {
      console.error(`[${correlationId}] No user mapped to WAHA session "${sessionName}"`);
      return new Response(JSON.stringify({ error: "No user mapped to this session" }), {
        status: 200, headers: jsonHeaders, // 200 so WAHA doesn't retry forever
      });
    }

    console.log(`[${correlationId}] Enqueue msg ${wahaMessageId} from ${phoneNumber} (${senderName}) → user ${userId}: ${messageText.substring(0, 80)}`);

    // Extract Ad Attribution if present (Facebook / TikTok Click-to-WhatsApp)
    const contextInfo = wp._data?.message?.contextInfo || wp._data?.contextInfo || wp.contextInfo || {};
    const externalAdReply = contextInfo.externalAdReply || {};
    let leadSource = "direct";
    let adTitle = externalAdReply.title || "";
    let adUrl = externalAdReply.sourceUrl || "";
    let adId = "";
    let campaignId = "";

    if (adUrl) {
      try {
        const parsedUrl = new URL(adUrl);
        if (/facebook\.com|fb\.me|instagram\.com/i.test(parsedUrl.hostname)) {
          leadSource = "facebook";
        } else if (/tiktok\.com/i.test(parsedUrl.hostname)) {
          leadSource = "tiktok";
        }
        adId = parsedUrl.searchParams.get("ad_id") || parsedUrl.searchParams.get("hsa_ad") || "";
        campaignId = parsedUrl.searchParams.get("campaign_id") || parsedUrl.searchParams.get("hsa_cam") || "";
      } catch {
        if (/facebook|fb/i.test(adUrl)) leadSource = "facebook";
        else if (/tiktok/i.test(adUrl)) leadSource = "tiktok";
      }
    }
    if (externalAdReply.sourceType) {
      if (/facebook|fb/i.test(externalAdReply.sourceType)) leadSource = "facebook";
      else if (/tiktok/i.test(externalAdReply.sourceType)) leadSource = "tiktok";
    }

    // Fallback keyword detection for wa.me links, bio links, and testing without running paid ads
    if (leadSource === "direct" && messageText) {
      if (/\b(from facebook|via facebook|facebook ad|fb ad|\[fb\]|#fb|facebook)\b/i.test(messageText)) {
        leadSource = "facebook";
        if (!adTitle) adTitle = "Facebook Promo / Bio Link";
      } else if (/\b(from tiktok|via tiktok|tiktok ad|\[tiktok\]|#tiktok|tiktok)\b/i.test(messageText)) {
        leadSource = "tiktok";
        if (!adTitle) adTitle = "TikTok Promo / Bio Link";
      }
    }

    // Also parse Ad Title or Ad ID from message text patterns (common in wa.me links on TikTok / Facebook bio)
    if (messageText) {
      if (!adTitle || adTitle.includes("Bio Link")) {
        const titleMatch = messageText.match(/(?:ad\s*name|ad|promo|campaign)[:\s-]+([a-zA-Z0-9_\s-]{3,35})(?:\]|\)|,|$)/i);
        if (titleMatch && titleMatch[1]) {
          adTitle = titleMatch[1].trim();
        }
      }
      if (!adId) {
        const idMatch = messageText.match(/(?:ad\s*id|adid)[:\s-]+([a-zA-Z0-9_-]+)/i);
        if (idMatch && idMatch[1]) {
          adId = idMatch[1].trim();
        }
      }
      if (!campaignId) {
        const campMatch = messageText.match(/(?:campaign\s*id|campid)[:\s-]+([a-zA-Z0-9_-]+)/i);
        if (campMatch && campMatch[1]) {
          campaignId = campMatch[1].trim();
        }
      }
    }

    const { error: enqueueError } = await supabase
      .from("message_queue")
      .upsert(
        {
          wsender_message_id: wahaMessageId,
          user_id: userId,
          phone_number: phoneNumber,
          sender_name: senderName,
          message_text: messageText,
          message_type: messageType,
          session_api_key: sessionName, // now stores WAHA session name
          raw_payload: {
            ...body,
            ad_attribution: {
              lead_source: leadSource,
              ad_title: adTitle,
              ad_id: adId,
              campaign_id: campaignId,
              ad_url: adUrl,
            },
          },
          status: "pending",
          correlation_id: correlationId,
        },
        { onConflict: "wsender_message_id", ignoreDuplicates: true }
      );

    if (enqueueError) {
      if (enqueueError.code === "23505") {
        return new Response(JSON.stringify({ success: true, duplicate: true }), { headers: jsonHeaders });
      }
      console.error(`[${correlationId}] Enqueue error:`, enqueueError);
      throw new Error("Failed to enqueue message");
    }

    // Automatically record or update lead with attribution
    try {
      const { data: existingLead } = await supabase
        .from("leads")
        .select("id, lead_source, ad_id")
        .eq("user_id", userId)
        .eq("phone_number", phoneNumber)
        .maybeSingle();

      const isOptOut = /not interested|stop|unsubscribe|dont message|don't message|no thanks/i.test(messageText);

      if (!existingLead) {
        await supabase.from("leads").insert({
          user_id: userId,
          phone_number: phoneNumber,
          customer_name: senderName !== "Unknown" ? senderName : null,
          status: "New Lead",
          lead_source: leadSource,
          ad_name: adTitle || null,
          ad_id: adId || null,
          campaign_id: campaignId || null,
          followup_status: "active",
          followups_sent: 0,
        });
      } else {
        // PRD §3.7 Stop Conditions: Stop follow-up when customer responds or opts out
        const updateData: Record<string, any> = {
          followup_status: isOptOut ? "stopped_opted_out" : "stopped_replied",
          next_followup_at: null,
          updated_at: new Date().toISOString(),
        };

        if (leadSource !== "direct" && (!existingLead.lead_source || existingLead.lead_source === "direct")) {
          updateData.lead_source = leadSource;
          updateData.ad_name = adTitle || null;
          updateData.ad_id = adId || null;
          updateData.campaign_id = campaignId || null;
        }

        await supabase.from("leads").update(updateData).eq("id", existingLead.id);
      }
    } catch (leadErr) {
      console.warn(`[${correlationId}] Failed to track lead:`, (leadErr as Error).message);
    }

    // Fire-and-forget trigger process-message (cron is the safety net)
    fetch(`${supabaseUrl}/functions/v1/process-message-Dakshila_Dilina`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify({ trigger: "webhook", correlationId }),
    }).catch((err) => {
      console.warn(`[${correlationId}] Trigger failed:`, err.message);
    });

    return new Response(
      JSON.stringify({ success: true, queued: true, messageId: wahaMessageId, correlationId }),
      { headers: jsonHeaders }
    );
  } catch (error) {
    console.error(`[${correlationId}] Webhook error:`, error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: jsonHeaders,
    });
  }
});
