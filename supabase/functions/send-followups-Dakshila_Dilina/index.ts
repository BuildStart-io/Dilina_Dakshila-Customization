import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const wahaBase = (Deno.env.get("WAHA_BASE_URL") || "").replace(/\/+$/, "");
const wahaKey = Deno.env.get("WAHA_API_KEY") || "";

/** digits-only contact key */
function normalizeKey(raw: string): string {
  return String(raw || "").split("@")[0].replace(/\D/g, "");
}

/** Robust PostgreSQL / ISO-8601 timestamp parser that handles timezone offsets */
function parsePgTimestamp(raw: string | number | null | undefined): number {
  if (!raw) return NaN;
  let s = String(raw).trim();
  if (/^\d+$/.test(s)) return Number(s);
  s = s.replace(" ", "T");
  s = s.replace(/([+-]\d{2})$/, "$1:00");
  const t = new Date(s).getTime();
  if (!isNaN(t)) return t;
  const fallback = Date.parse(String(raw));
  return isNaN(fallback) ? NaN : fallback;
}

/** Quickly probe WAHA to see if session is WORKING before processing contacts */
async function isSessionWorking(sessionName: string): Promise<boolean> {
  if (!wahaBase || !wahaKey || !sessionName) return true;
  try {
    const res = await fetch(`${wahaBase}/api/sessions/${sessionName}`, {
      headers: { "X-Api-Key": wahaKey },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const data = await res.json().catch(() => null);
    const status = String(data?.status || "").toUpperCase();
    return status === "WORKING" || status === "CONNECTED" || status === "SCAN_QR_CODE";
  } catch {
    return true; // on network glitch, do not hard-block
  }
}

interface FollowupStep {
  step_number: number;
  delay_hours: number;
  message: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey, {
    db: { schema: "Dakshila_Dilina" },
  });

  const summary: Record<string, unknown>[] = [];

  try {
    // Check Sri Lanka delivery window (UTC+05:30)
    // Default allowed window: 9:00 AM – 8:00 PM (09:00 to 20:00)
    const nowUtc = Date.now();
    const slDate = new Date(nowUtc + 5.5 * 3600 * 1000);
    const currentSlHour = slDate.getUTCHours();

    // 1. Users that have the follow-up configured
    const { data: settingsRows, error: sErr } = await supabase
      .from("settings")
      .select("user_id, value, updated_at")
      .eq("key", "inactivity_followup");

    if (sErr) throw sErr;

    for (const row of settingsRows || []) {
      const cfg = (row.value || {}) as {
        enabled?: boolean;
        text?: string;
        hours?: number;
        max_limit?: number;
        start_hour?: number;
        end_hour?: number;
        steps?: FollowupStep[];
        enabled_at?: string;
      };

      if (!cfg.enabled) continue;

      const startHour = Number(cfg.start_hour) || 9;
      const endHour = Number(cfg.end_hour) || 20;

      if (currentSlHour < startHour || currentSlHour >= endHour) {
        console.log(`[send-followups] Current SL hour is ${currentSlHour}:00, outside ${startHour}:00 - ${endHour}:00 delivery window. Skipping.`);
        continue;
      }

      // Build sequence of steps (PRD §3.7: Different time gaps and messages per step)
      let steps: FollowupStep[] = [];
      if (Array.isArray(cfg.steps) && cfg.steps.length > 0) {
        steps = cfg.steps.filter((s) => s && s.message?.trim() && Number(s.delay_hours) > 0);
      }
      if (steps.length === 0) {
        // Fallback to single step
        const defaultHours = Number(cfg.hours) || 24;
        const defaultText = cfg.text?.trim() || "Hi! Checking in to see if you have any questions about our Magazines & Clothing collection.";
        steps = [{ step_number: 1, delay_hours: defaultHours, message: defaultText }];
      }

      const maxLimit = Math.min(Number(cfg.max_limit) || 4, Math.max(1, steps.length));
      const userId = row.user_id as string;

      // Check session
      const { data: session } = await supabase
        .from("user_wsender_sessions")
        .select("session_api_key")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const sessionApiKey = session?.session_api_key;
      if (!sessionApiKey) continue;

      const sessionReady = await isSessionWorking(sessionApiKey);
      if (!sessionReady) {
        console.warn(`[send-followups] Skipping user ${userId} because session ${sessionApiKey} is not working.`);
        continue;
      }

      // 2. Fetch active leads for this user that haven't exhausted their follow-ups
      const { data: activeLeads } = await supabase
        .from("leads")
        .select("id, phone_number, customer_name, status, followups_sent, max_followup_limit, next_followup_at, followup_status, created_at, updated_at")
        .eq("user_id", userId)
        .or("followup_status.eq.active,followup_status.is.null")
        .limit(300);

      for (const lead of activeLeads || []) {
        const phone = lead.phone_number;
        const normalizedPhone = normalizeKey(phone);
        if (!normalizedPhone) continue;

        const sentCount = lead.followups_sent || 0;
        if (sentCount >= maxLimit || sentCount >= steps.length) {
          await supabase.from("leads").update({
            followup_status: "completed",
            next_followup_at: null,
            updated_at: new Date().toISOString(),
          }).eq("id", lead.id);
          continue;
        }

        // PRD §3.7 Stop Condition 1: Check if customer placed an order
        const { data: existingOrder } = await supabase
          .from("orders")
          .select("id")
          .eq("user_id", userId)
          .eq("customer_phone", phone)
          .limit(1)
          .maybeSingle();

        if (existingOrder) {
          await supabase.from("leads").update({
            followup_status: "stopped_ordered",
            next_followup_at: null,
            updated_at: new Date().toISOString(),
          }).eq("id", lead.id);
          continue;
        }

        // PRD §3.7 Stop Condition 2: Check if conversation handed over to staff
        const { data: takeover } = await supabase
          .from("chat_takeovers")
          .select("is_taken_over")
          .eq("user_id", userId)
          .in("phone_number", [phone, normalizedPhone])
          .eq("is_taken_over", true)
          .limit(1)
          .maybeSingle();

        if (takeover?.is_taken_over) continue;

        // PRD §3.7 Stop Condition 3: Check conversation history for customer replies or opt-outs
        const { data: recentConvs } = await supabase
          .from("conversations")
          .select("direction, message, created_at, metadata")
          .eq("user_id", userId)
          .eq("phone_number", phone)
          .order("created_at", { ascending: false })
          .limit(10);

        if (!recentConvs?.length) continue;

        const lastConv = recentConvs[0];
        const lastInbound = recentConvs.find((c) => c.direction === "inbound");

        // If customer replied after the last outbound follow-up, halt follow-ups
        const lastFollowup = recentConvs.find((c) => (c.metadata as any)?.type === "inactivity_followup");
        if (lastInbound && lastFollowup) {
          const inboundTime = parsePgTimestamp(lastInbound.created_at);
          const followupTime = parsePgTimestamp(lastFollowup.created_at);
          if (inboundTime > followupTime) {
            await supabase.from("leads").update({
              followup_status: "stopped_replied",
              next_followup_at: null,
              updated_at: new Date().toISOString(),
            }).eq("id", lead.id);
            continue;
          }
        }

        // Check if customer expressed opt-out
        if (lastInbound) {
          const isOptOut = /not interested|stop|unsubscribe|dont message|don't message|no thanks/i.test(lastInbound.message);
          if (isOptOut) {
            await supabase.from("leads").update({
              followup_status: "stopped_opted_out",
              next_followup_at: null,
              updated_at: new Date().toISOString(),
            }).eq("id", lead.id);
            continue;
          }
        }

        // Determine step & required delay
        const currentStep = steps[sentCount];
        const requiredDelayHours = Number(currentStep.delay_hours) || 24;
        const requiredDelayMs = requiredDelayHours * 3600 * 1000;

        // Base timestamp: either last followup timestamp, or customer's last message, or lead creation
        const baseTimestamp = lastFollowup
          ? parsePgTimestamp(lastFollowup.created_at)
          : (lastInbound ? parsePgTimestamp(lastInbound.created_at) : parsePgTimestamp(lead.created_at));

        const elapsedMs = Date.now() - baseTimestamp;
        if (elapsedMs < requiredDelayMs) {
          // Not ready yet — update next_followup_at so dashboard displays the exact scheduled time
          const nextScheduled = new Date(baseTimestamp + requiredDelayMs).toISOString();
          if (lead.next_followup_at !== nextScheduled) {
            await supabase.from("leads").update({
              next_followup_at: nextScheduled,
              max_followup_limit: maxLimit,
            }).eq("id", lead.id);
          }
          continue;
        }

        // Ready to dispatch this follow-up step!
        const messageToSend = currentStep.message.trim();
        try {
          const res = await fetch(`${supabaseUrl}/functions/v1/send-whatsapp-Dakshila_Dilina`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${serviceKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ to: phone, message: messageToSend, sessionApiKey }),
            signal: AbortSignal.timeout(12000),
          });

          if (!res.ok) {
            const errText = await res.text();
            console.error(`Follow-up send failed for ${phone}:`, errText.substring(0, 200));
            continue;
          }

          // Record conversation
          await supabase.from("conversations").insert({
            user_id: userId,
            phone_number: phone,
            message: messageToSend,
            direction: "outbound",
            message_type: "text",
            metadata: { type: "inactivity_followup", step: sentCount + 1, delay_hours: requiredDelayHours },
          });

          // Update lead tracking fields (PRD §3.7: Follow-Ups Sent, Remaining, Next Follow-Up Date/Time)
          const newSent = sentCount + 1;
          const isFinished = newSent >= maxLimit || newSent >= steps.length;
          const nextStep = !isFinished ? steps[newSent] : null;
          const nextScheduledAt = nextStep
            ? new Date(Date.now() + (Number(nextStep.delay_hours) || 24) * 3600 * 1000).toISOString()
            : null;

          await supabase.from("leads").update({
            followups_sent: newSent,
            max_followup_limit: maxLimit,
            followup_status: isFinished ? "completed" : "active",
            next_followup_at: nextScheduledAt,
            updated_at: new Date().toISOString(),
          }).eq("id", lead.id);

          summary.push({
            leadId: lead.id,
            phone,
            stepSent: sentCount + 1,
            maxLimit,
            delayHours: requiredDelayHours,
            nextFollowupAt: nextScheduledAt,
          });

          // Pacing delay between sends
          await new Promise((r) => setTimeout(r, 1500));
        } catch (dispatchErr) {
          console.error(`Error sending follow-up to ${phone}:`, (dispatchErr as Error).message);
        }
      }
    }

    return new Response(JSON.stringify({ success: true, sent: summary.length, details: summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-followups error:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
