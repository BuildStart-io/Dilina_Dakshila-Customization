import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      db: { schema: "Dakshila_Dilina" },
    });

    const body = await req.json().catch(() => ({}));
    const { action, orderId, userId, testSettings } = body;

    // Handle test ping / connection verification
    if (action === "test-connection") {
      const endpoint = testSettings?.endpoint_url?.trim();
      const apiKey = testSettings?.api_key?.trim();

      if (!endpoint) {
        return new Response(JSON.stringify({ success: false, error: "API Endpoint URL is required." }), {
          status: 400,
          headers: jsonHeaders,
        });
      }

      const samplePayload = {
        test: true,
        order_reference: "TEST-ORD-001",
        customer_name: "Test Customer",
        delivery_address: "123 Galle Road, Colombo 03",
        district: "Colombo",
        whatsapp_number: "94771234567",
        contact_number: "0771234567",
        items: [{ name: "Sample Item", quantity: 1, price: 1500 }],
        cod_amount: 1500,
        payment_method: "cod",
        sender: {
          name: testSettings?.sender_name || "Store",
          phone: testSettings?.sender_phone || "94784189365",
          address: testSettings?.pickup_address || "Colombo",
        },
      };

      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (apiKey) {
          headers["Authorization"] = `Bearer ${apiKey}`;
          headers["x-api-key"] = apiKey;
        }

        const courierRes = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(samplePayload),
          signal: AbortSignal.timeout(10_000),
        });

        const resText = await courierRes.text();
        return new Response(
          JSON.stringify({
            success: courierRes.ok,
            status: courierRes.status,
            message: courierRes.ok
              ? "Courier API responded successfully (HTTP " + courierRes.status + ")"
              : "Courier API returned status " + courierRes.status + ": " + resText.slice(0, 150),
          }),
          { headers: jsonHeaders }
        );
      } catch (err: any) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Connection failed: " + (err.message || String(err)),
          }),
          { status: 200, headers: jsonHeaders }
        );
      }
    }

    if (!orderId) {
      return new Response(JSON.stringify({ error: "Missing orderId" }), { status: 400, headers: jsonHeaders });
    }

    // 1. Fetch Order details
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      return new Response(JSON.stringify({ error: "Order not found" }), { status: 404, headers: jsonHeaders });
    }

    const effectiveUserId = userId || order.user_id;

    // 2. Fetch Courier Settings from settings table
    const { data: courierSettingRow } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "courier_settings")
      .eq("user_id", effectiveUserId)
      .maybeSingle();

    const courierConfig = courierSettingRow?.value || {};
    const endpointUrl = courierConfig.endpoint_url?.trim();
    const apiKey = courierConfig.api_key?.trim();

    if (!endpointUrl) {
      // Mark as pending configuration and notify
      await supabase
        .from("orders")
        .update({
          courier_status: "courier_transfer_pending",
          updated_at: new Date().toISOString(),
        })
        .eq("id", orderId);

      return new Response(
        JSON.stringify({
          success: false,
          error: "Courier API endpoint not configured. Please go to Settings > Delivery to set your Courier API URL.",
        }),
        { status: 400, headers: jsonHeaders }
      );
    }

    // 3. Format PRD §3.4 / Step 9 required Courier Payload
    const codAmount = (order.payment_method || "").toLowerCase() === "cod" ? Number(order.total_amount) || 0 : 0;
    const items = Array.isArray(order.order_items) ? order.order_items : [];

    const courierPayload = {
      order_reference: order.id,
      customer_name: order.customer_name,
      delivery_address: order.customer_address,
      district: order.district || "Western",
      whatsapp_number: order.whatsapp_phone || order.customer_phone,
      contact_number: order.normal_phone || order.customer_phone,
      items: items.map((it: any) => ({
        name: it.name || it.title || "Product",
        quantity: it.quantity || 1,
        size: it.size || null,
        colour: it.colour || it.color || null,
        price: it.price || 0,
      })),
      total_amount: Number(order.total_amount) || 0,
      cod_amount: codAmount,
      payment_method: order.payment_method || "cod",
      special_instructions: order.special_instructions || "Handle with care",
      sender: {
        name: courierConfig.sender_name || "Dakshila & Dilina Store",
        phone: courierConfig.sender_phone || "94784189365",
        address: courierConfig.pickup_address || "Colombo, Sri Lanka",
      },
    };

    console.log(`[dispatch-courier] Calling ${endpointUrl} for order ${order.id}...`);

    // 4. Dispatch API call to Courier Service
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
      headers["x-api-key"] = apiKey;
    }

    let courierAccepted = false;
    let trackingId = "";
    let errorDetail = "";
    let httpStatusCode = 0;
    let httpStatusText = "Unknown";
    let responseData: any = null;

    try {
      const courierRes = await fetch(endpointUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(courierPayload),
        signal: AbortSignal.timeout(20_000),
      });

      httpStatusCode = courierRes.status;
      httpStatusText = courierRes.statusText || (courierRes.ok ? "OK" : "Denied");
      const responseText = await courierRes.text();
      let responseJson: any = null;
      try {
        responseJson = JSON.parse(responseText);
      } catch {
        // raw text
      }
      responseData = responseJson || responseText;

      if (courierRes.ok) {
        courierAccepted = true;
        trackingId =
          responseJson?.tracking_id ||
          responseJson?.tracking_number ||
          responseJson?.waybill ||
          responseJson?.reference_id ||
          `TRK-${Date.now().toString().slice(-6)}`;
      } else {
        errorDetail = `Courier API returned HTTP ${courierRes.status}: ${responseText.slice(0, 250)}`;
      }
    } catch (fetchErr: any) {
      httpStatusCode = 0;
      httpStatusText = "Network Error";
      errorDetail = `Network error calling Courier API: ${fetchErr.message}`;
      responseData = { error: fetchErr.message };
    }

    // Create detailed HTTP transmission audit log entry
    const auditLogEntry = {
      timestamp: new Date().toISOString(),
      provider: courierConfig.provider || "Custom Courier API",
      endpoint_url: endpointUrl,
      http_status: httpStatusCode,
      status_text: courierAccepted ? "200 OK (Courier Accepted)" : `HTTP ${httpStatusCode} Denied / Failed`,
      success: courierAccepted,
      request_headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: "Bearer ***" } : {}),
      },
      request_payload: courierPayload,
      response_payload: responseData,
      tracking_id: trackingId || null,
      error_message: errorDetail || null,
    };

    // 5. Update Order status and append to courier_dispatch_log
    const existingLogs = Array.isArray(order.courier_dispatch_log) ? order.courier_dispatch_log : [];
    const updatedLogs = [auditLogEntry, ...existingLogs].slice(0, 10); // Keep 10 most recent logs

    const newCourierStatus = courierAccepted ? "Courier Accepted" : "Courier Transfer Failed";
    const updateData: any = {
      courier_status: newCourierStatus,
      courier_dispatch_log: updatedLogs,
      updated_at: new Date().toISOString(),
    };
    if (courierAccepted && trackingId) {
      updateData.courier_tracking_id = trackingId;
    }

    await supabase.from("orders").update(updateData).eq("id", orderId);

    // Also update lead status in leads table if matching lead exists
    if (order.customer_phone) {
      await supabase
        .from("leads" as any)
        .update({
          status: courierAccepted ? "Courier Accepted" : "Courier Transfer Failed",
          updated_at: new Date().toISOString(),
        })
        .eq("phone_number", order.customer_phone)
        .eq("user_id", effectiveUserId);
    }

    return new Response(
      JSON.stringify({
        success: courierAccepted,
        courier_status: newCourierStatus,
        tracking_id: trackingId || null,
        http_status: httpStatusCode,
        status_text: auditLogEntry.status_text,
        dispatch_log: auditLogEntry,
        error: courierAccepted ? null : errorDetail,
      }),
      { status: 200, headers: jsonHeaders }
    );
  } catch (error: any) {
    console.error("Courier dispatch error:", error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
});
