import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ConversationMessage {
  message: string;
  direction: string;
  created_at: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    const delegatesAi = !!(Deno.env.get("AI_GENERATE_URL") && Deno.env.get("BOT_API_KEY"));
    if (!lovableApiKey && !delegatesAi) {
      throw new Error("Neither LOVABLE_API_KEY nor AI_GENERATE_URL/BOT_API_KEY configured");
    }


    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      db: { schema: "Dakshila_Dilina" },
    });

    const { message, phoneNumber, conversationHistory, userId, sessionApiKey, senderName } = await req.json();

    console.log(`Processing AI chat for ${phoneNumber} (user: ${userId}): ${message}`);

    // Fetch products, FAQs, settings, profile, and platform limits
    const [productsRes, faqsRes, settingsRes, profileRes, platformLimitsRes] = await Promise.all([
      supabase.from("products").select("*").eq("is_active", true).eq("user_id", userId),
      supabase.from("faqs").select("*, products(name)").eq("is_active", true).eq("user_id", userId),
      supabase.from("settings").select("key, value").eq("user_id", userId),
      supabase.from("profiles").select("plan_tier, billing_cycle_start, is_paused, addon_contacts, addon_orders").eq("user_id", userId).single(),
      supabase.from("platform_settings").select("value").eq("key", "plan_limits").single(),
    ]);

    // Check if account is paused
    if (profileRes.data?.is_paused) {
      console.log(`Account paused for user ${userId}`);
      return new Response(
        JSON.stringify({ error: "Account paused", response: "Sorry, this business account is currently paused. Please try again later." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const planTier = profileRes.data?.plan_tier || "free";
    const allLimits = platformLimitsRes.data?.value || {};
    const tierLimits = allLimits[planTier] || {};
    const contactLimit = (tierLimits.contacts_per_month || 50) + (profileRes.data?.addon_contacts || 0);

    // Use billing cycle start for monthly count
    const billingStart = profileRes.data?.billing_cycle_start;
    let monthStart: string;
    if (billingStart) {
      const start = new Date(billingStart);
      const now = new Date();
      const current = new Date(start);
      while (true) {
        const next = new Date(current);
        next.setMonth(next.getMonth() + 1);
        if (next > now) break;
        current.setMonth(current.getMonth() + 1);
      }
      monthStart = current.toISOString();
    } else {
      const d = new Date();
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      monthStart = d.toISOString();
    }
    // Contact-based billing: only NEW contacts are blocked once the allowance is used up.
    const contactKey = String(phoneNumber || "").split("@")[0].replace(/\D/g, "");
    const { data: alreadyCounted } = await supabase
      .from("contact_usage")
      .select("id")
      .eq("user_id", userId)
      .eq("phone_number", contactKey)
      .gte("created_at", monthStart)
      .maybeSingle();

    const { data: contactsUsed } = await supabase.rpc("get_contact_usage", {
      _user_id: userId,
      _since: monthStart,
    });

    // Also check orders limit
    const ordersLimit = (tierLimits.max_orders_per_month || 50) + (profileRes.data?.addon_orders || 0);
    const { count: ordersCount } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", monthStart);

    if (!alreadyCounted && (contactsUsed || 0) >= contactLimit) {
      console.log(`Contact limit reached for user ${userId}: ${contactsUsed}/${contactLimit}`);
      return new Response(
        JSON.stringify({ error: "Monthly contact limit reached. Please upgrade your plan.", response: "Sorry, the monthly contact limit has been reached. Please contact the business owner." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }


    const ordersLimitReached = (ordersCount || 0) >= ordersLimit;

    const products = productsRes.data || [];
    const faqs = faqsRes.data || [];
    const settings = settingsRes.data || [];

    const welcomeMessage = settings.find(s => s.key === "welcome_message")?.value?.text || "Welcome! How can I help you?";
    const paymentInfo = settings.find(s => s.key === "payment_info")?.value || {};
    const deliverySettings = settings.find(s => s.key === "delivery_settings")?.value || {};
    const freeDeliveryThreshold = deliverySettings.free_delivery_threshold || 0;

    const productCatalog = products.map(p => {
      let line = `- [Category: ${p.category || "General"}] ${p.name}: Base price LKR ${p.price} (${p.product_type})`;
      if (p.stock_quantity !== undefined && p.stock_quantity !== null) {
        if (p.stock_quantity <= 0) {
          line += ` | In Stock: 0 (OUT OF STOCK - Sold out! Politely inform customer and suggest other available magazines or clothing)`;
        } else {
          line += ` | In Stock: ${p.stock_quantity} units available`;
        }
      }
      if (p.product_type === "physical" && p.delivery_price && p.delivery_price > 0) {
        line += ` | Delivery fee: LKR ${p.delivery_price}`;
      }
      if (p.description) line += ` - ${p.description}`;
      if (p.images && Array.isArray(p.images) && p.images.length > 0) {
        line += ` | Images: ${p.images.join(", ")}`;
      }
      if (p.video_url) {
        line += ` | Video: ${p.video_url}`;
      }
      if (p.variations && Array.isArray(p.variations) && p.variations.length > 0) {
        const varLines = p.variations.map((v: any) => {
          const opts = v.options?.map((o: any) => {
            if (typeof o !== "object") return o;
            let optStr = `${o.label}: LKR ${o.price}`;
            if (o.subVariants && Array.isArray(o.subVariants) && o.subVariants.length > 0) {
              const subLines = o.subVariants.map((sv: any) => {
                const reqTag = sv.required ? " (REQUIRED)" : " (optional)";
                const subOpts = sv.options?.map((so: any) =>
                  typeof so === "object" ? `${so.label}: +LKR ${so.price}` : so
                ).join(", ");
                return `[${sv.name}${reqTag}: ${subOpts}]`;
              }).join(" ");
              optStr += ` ${subLines}`;
            }
            return optStr;
          }).join(", ");
          return `${v.name}: ${opts}`;
        }).join("; ");
        line += ` | Variations: ${varLines}`;
      }
      return line;
    }).join("\n");

    // Build a map of product name → first image URL for sending images
    const productImageMap: Record<string, string> = {};
    const productVideoMap: Record<string, string> = {};
    for (const p of products) {
      if (p.images && Array.isArray(p.images) && p.images.length > 0) {
        productImageMap[p.name.toLowerCase()] = p.images[0];
      }
      if (p.video_url) {
        productVideoMap[p.name.toLowerCase()] = p.video_url;
      }
    }

    // Build FAQ context with IDs so AI can report which ones it used
    const faqContext = faqs.map(f =>
      `[FAQ_ID:${f.id}] Q: ${f.question}\nA: ${f.answer}${f.products?.name ? ` (Related to: ${f.products.name})` : ""}`
    ).join("\n\n");

    // Get list of tracked FAQ IDs
    const trackedFaqIds = faqs.filter(f => f.is_tracked).map(f => f.id);

    const conversationContext = Array.isArray(conversationHistory)
      ? (conversationHistory as ConversationMessage[])
        .map(msg => `${msg.direction === "inbound" ? "Customer" : "Assistant"}: ${msg.message}`)
        .join("\n")
      : "";

    const systemPrompt = `You are the dedicated WhatsApp Sales Support Agent for a business specializing in Magazines, Clothing, and related products.

YOUR CORE OBJECTIVES:
1. Welcome customers warmly and introduce our product categories (Magazines, Clothing, etc.).
2. Help customers browse 6-7 featured products with high quality details, images, prices, available stock, sizes, and colors.
3. Answer product questions and FAQs.
4. Collect order details thoroughly and confirm orders for Cash on Delivery or Bank Transfer.

CUSTOMER CHAT FLOW & MANDATORY ORDER VALIDATION RULES:
CRITICAL ZERO-ASSUMPTION POLICY:
- NEVER ASSUME QUANTITY: You must NEVER assume quantity is 1 or any default number! If the customer mentions a product, size, or color (e.g., "M", "Black t shirt") but has NOT explicitly typed the quantity (e.g., "1 piece", "2", "3"), you MUST ask:
  "How many pieces / what quantity would you like to order? Please specify the exact quantity."
- NEVER PROCEED WITH MISSING DETAILS: Before you move forward to order summary or confirmation, you MUST have received ALL of the following details:
  1. Product Name & Specific Sub-variant (Size and/or Color where applicable)
  2. Exact Quantity (Must be explicitly specified by the customer, never assume 1)
  3. Full Customer Name
  4. Complete Delivery Address (Street/Town/City)
  5. District
  6. WhatsApp Number
  7. Normal / Alternate Contact Phone Number (10-digit Sri Lankan phone number)
  8. Payment Method (Cash on Delivery or Bank Transfer)
- IF ANY DETAIL IS MISSING:
  Immediately ask the customer specifically for the missing item(s) before proceeding!
  Example: If the customer gives size "M" without quantity, ask: "What quantity of Size M do you need?"
  Example: If the customer provides name and address but no normal phone number, ask: "Please provide your normal contact phone number as well."
  Do NOT show the order summary or ask for payment until ALL required details are provided!

CHAT FLOW STEPS:
- Step 1 (Welcome): Welcome the customer, briefly introduce our business, mention available categories (Magazines, Clothing), and ask which product category they are interested in.
- Step 2 (Product Presentation & Quantity Selection):
  - When presenting a product, mention Category, Name, Price (LKR), Available Quantity/Stock, Description, and any Sizes/Colors.
  - Ask: "Which product do you require?", "What size or colour do you need (where applicable)?", and "What quantity is needed?"
  - VITAL: If customer mentions a size or product without quantity, you MUST specifically ask: "What quantity do you need?"
  - Also ask: "Does the customer require any other product?" before finalizing.
- Step 3 (Customer Details Collection):
  Collect and validate ALL of the following before payment:
  1. Full Customer Name
  2. Complete Delivery Address & District
  3. WhatsApp Number
  4. Normal / Alternate Contact Number (10 digits Sri Lankan phone number, e.g., 0771234567)
  If the customer missed any of these 4 fields in their message, explicitly request the missing field!
- Step 4 (Payment Method Selection):
  Ask the customer whether they prefer:
  1. Cash on Delivery (COD)
  2. Bank Transfer
- Step 5 (Order Summary):
  Present a neat, emoji-formatted order summary containing: Customer Name, WhatsApp Number, Normal Phone, Delivery Address & District, Product Items with Size/Color & Explicit Qty, Total Amount, and Payment Method.
  Ask the customer to confirm the summary.
- Step 6 (Order Confirmation & Order JSON):
  Once the customer confirms the summary, thank them warmly, inform them their parcel is being prepared and an official PDF invoice has been generated for them, and output the <ORDER_JSON> system block.

HUMAN AGENT HANDOFF:
If the customer explicitly requests human staff ("talk to human", "agent please", "call me"), or asks an unresolved complex question, or is dissatisfied, append <HANDOFF>Customer requested human assistance</HANDOFF> at the very end of your response.

IMPORTANT GUIDELINES:
- Respond in the SAME LANGUAGE the customer uses (English, Sinhala, or Tamil / Singlish / Tanglish).
- KEEP IT SHORT: WhatsApp messages must be concise and scannable. Aim for 2-4 short lines max per response. Never send walls of text.
- Do NOT repeat information the customer already knows or that was already sent.
- FORMATTING: Do NOT use asterisks (*) for bold or any markdown formatting. Write plain text only. No *bold*, no **bold**, no _italic_. Just plain clean text.
- MESSAGE STYLING: Use emojis as bullet points and section separators (🔹, ✅, 📦, 💳, 🏦, 💰, 🚚, 👕, 📖, etc.).
- Sub-variants (Sizes/Colors/Issues) marked as REQUIRED must be chosen by the customer before finalizing.
${freeDeliveryThreshold > 0 ? `- FREE DELIVERY: Orders over LKR ${freeDeliveryThreshold} qualify for free delivery.` : ""}

BANK DETAILS FOR BANK TRANSFER:
${(() => {
        const accounts = paymentInfo.accounts;
        if (accounts && Array.isArray(accounts) && accounts.length > 0) {
          return accounts.map((a: any, i: number) => {
            const type = a.account_type || "bank";
            const label = a.account_label || a.bank_name || "Not configured";
            const number = a.account_number || "Not configured";
            const name = a.account_name || "Not configured";
            return `  🏦 Account ${i + 1}: ${label} | Acc No: ${number} | Name: ${name}`;
          }).join("\n");
        }
        return `  Bank: ${paymentInfo.bank_name || "Not configured"}, Account: ${paymentInfo.account_number || "Not configured"}, Name: ${paymentInfo.account_name || "Not configured"}`;
      })()}

PRODUCT CATALOG:
${productCatalog || "No products available"}

PRODUCT PHOTOS & VIDEOS (MEDIA INSTRUCTIONS):
${products.map((p: any) => {
        const img = (p.images && Array.isArray(p.images) && p.images.length > 0) ? p.images[0] : null;
        const vid = p.video_url || null;
        return `• Product "${p.name}": ${img ? `Image URL: ${img}` : "No image"} | ${vid ? `Video URL: ${vid}` : "No video"}`;
      }).join("\n")}

HOW TO SEND PRODUCT IMAGES & VIDEOS:
- SEND PHOTO ONCE ONLY: Whenever you introduce products, showcase a product, or when the customer asks ("What are the products?", "Show me", "Photos?", "Send picture"), append the product's image URL inside <IMAGE_URL>image_url_here</IMAGE_URL> tags at the very END of your message.
- NEVER RESEND OR REPEAT PHOTOS: Once a photo for a product has already been sent earlier in the conversation, NEVER send it again! Sending once is enough.
- NEVER SEND PHOTOS DURING ORDERING STEPS: Do NOT attach <IMAGE_URL> when asking for or receiving sizes, colors, quantity, customer name, delivery address, phone numbers, payment method, order summary, or confirmation! Keep all ordering messages text-only.
- If the product has a video URL (not 'No video'), also append:
  <VIDEO_URL>video_url_here</VIDEO_URL>
- This automatically delivers the actual product photo/video directly to the customer's WhatsApp chat!
- NEVER write the raw URL inside your visible message text. Keep it ONLY inside <IMAGE_URL>...</IMAGE_URL> tags at the very end.

FREQUENTLY ASKED QUESTIONS:
${faqContext || "No FAQs configured"}

WELCOME MESSAGE:
${welcomeMessage}

CRITICAL ORDER INSTRUCTION:
When you have collected ALL required order details (Name, Delivery Address, District, WhatsApp Number, Normal Phone Number, Items, Size/Color, Payment Method) and the customer confirms, you MUST include a JSON block in your response wrapped in <ORDER_JSON> tags like this:
<ORDER_JSON>{"customer_name":"...","customer_phone":"...","whatsapp_phone":"...","normal_phone":"...","district":"...","customer_address":"...","category":"...","order_items":[{"name":"...","size_color":"...","price":...,"quantity":...,"product_type":"physical"}],"payment_method":"cod or bank_transfer","total_amount":...}</ORDER_JSON>
Include this JSON block at the END of your confirmation message. The customer will not see the JSON tags.

CRITICAL SECURITY RULE:
- NEVER show raw JSON, code, data structures, or technical markup to the customer under ANY circumstances.
- The ORDER_JSON, IMAGE_URL, VIDEO_URL, USED_FAQS, and HANDOFF tags are INVISIBLE system instructions. They must ONLY appear ONCE at the very END of your message, after all human-readable text.
- Your visible reply must ALWAYS be plain, human-readable text only.`;

    const messages = [
      { role: "system", content: systemPrompt },
    ];

    if (conversationHistory && conversationHistory.length > 0) {
      for (const msg of conversationHistory as ConversationMessage[]) {
        messages.push({
          role: msg.direction === "inbound" ? "user" : "assistant",
          content: msg.message,
        });
      }
    }

    // Handle photo/media messages - users often send payment slips
    const trimmedMessage = (message || "").trim();
    if (!trimmedMessage) {
      messages.push({ role: "user", content: "[Customer sent a photo/media file. This is likely a payment slip or receipt. Acknowledge it politely and ask them to confirm if it's a payment confirmation. Do NOT output any JSON, tags, or code.]" });
    } else {
      messages.push({ role: "user", content: trimmedMessage });
    }

    // ------------------------------------------------------------------
    // AI call.
    // If AI_GENERATE_URL + BOT_API_KEY are set (self-hosted deployment), the
    // model call is delegated to the Lovable-hosted `ai-generate` transport.
    // Otherwise we talk to the Lovable AI Gateway directly (Lovable-hosted).
    // Prompt, model and max_tokens are identical on both paths, so response
    // quality is unchanged.
    // ------------------------------------------------------------------
    const aiGenerateUrl = Deno.env.get("AI_GENERATE_URL");
    const botApiKey = Deno.env.get("BOT_API_KEY");
    const MODEL = "google/gemini-3-flash-preview";
    const MAX_TOKENS = 800;

    let aiResponse: Response;
    if (aiGenerateUrl && botApiKey) {
      aiResponse = await fetch(aiGenerateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-bot-key": botApiKey },
        body: JSON.stringify({
          messages,
          model: MODEL,
          maxTokens: MAX_TOKENS,
        }),
      });
    } else {
      aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: MODEL, messages, max_tokens: MAX_TOKENS }),
      });
    }

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add more credits." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await aiResponse.text();
      console.error("AI Gateway error:", aiResponse.status, errorText);
      throw new Error("AI processing failed");
    }

    const aiData = await aiResponse.json();
    // `ai-generate` returns { text }, the raw gateway returns OpenAI-style choices.
    const responseText =
      aiData.text ||
      aiData.choices?.[0]?.message?.content ||
      "I'm sorry, I couldn't process your request. Please try again.";


    console.log(`AI Response: ${responseText.substring(0, 100)}...`);

    // Extract used FAQ IDs and log tracked ones
    const usedFaqsMatch = responseText.match(/<USED_FAQS>([\s\S]*?)<\/USED_FAQS>/);
    const usedFaqIds: string[] = usedFaqsMatch
      ? usedFaqsMatch[1].split(",").map((id: string) => id.trim()).filter(Boolean)
      : [];
    if (usedFaqsMatch && trackedFaqIds.length > 0) {
      const usedIds = usedFaqIds;
      const trackedUsedIds = usedIds.filter((id: string) => trackedFaqIds.includes(id));

      if (trackedUsedIds.length > 0) {
        console.log(`Tracked FAQs used: ${trackedUsedIds.join(", ")} for phone ${phoneNumber}`);
        const usageLogs = trackedUsedIds.map((faqId: string) => ({
          faq_id: faqId,
          user_id: userId,
          phone_number: phoneNumber,
          sender_name: senderName || "Unknown",
        }));
        const { error: logError } = await supabase.from("faq_usage_logs").insert(usageLogs);
        if (logError) {
          console.error("Error logging FAQ usage:", logError);
        }
      }
    }

    // Check if the AI response contains order JSON
    let orderCreated = false;
    const orderJsonMatches = [...responseText.matchAll(/<ORDER_JSON>([\s\S]*?)<\/ORDER_JSON>/g)];
    for (const orderJsonMatch of orderJsonMatches) {
      if (ordersLimitReached) {
        console.log(`Orders limit reached for user ${userId}: ${ordersCount}/${ordersLimit}`);
      } else {
        try {
          const orderData = JSON.parse(orderJsonMatch[1]);
          console.log("Saving order to database:", JSON.stringify(orderData));

          // Deduplication: check if a similar order was created in the last 5 minutes
          const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
          const { data: recentOrders } = await supabase
            .from("orders")
            .select("id")
            .eq("user_id", userId)
            .eq("customer_phone", orderData.customer_phone || phoneNumber)
            .eq("total_amount", orderData.total_amount || 0)
            .gte("created_at", fiveMinAgo);

          if (recentOrders && recentOrders.length > 0) {
            console.log("Duplicate order detected, skipping creation. Existing:", recentOrders[0].id);
          } else {
            const paymentMethod = orderData.payment_method === "bank_transfer" ? "bank_transfer" : "cod";
            const paymentStatus = paymentMethod === "cod" ? "cod" : "payment_pending";

            // Fetch lead ad attribution if available
            const { data: leadAttr } = await supabase
              .from("leads")
              .select("lead_source, ad_id, ad_name, campaign_id, campaign_name")
              .eq("user_id", userId)
              .eq("phone_number", phoneNumber)
              .maybeSingle();

            // Enrich order_items with product_id from catalog for accurate stock deduction
            const enrichedItems = (orderData.order_items || []).map((item: any) => {
              const matched = products.find((p: any) => p.name.toLowerCase() === (item.name || "").toLowerCase());
              return {
                ...item,
                product_id: matched ? matched.id : item.product_id || null,
              };
            });

            const { data: orderResult, error: orderError } = await supabase
              .from("orders")
              .insert({
                customer_name: orderData.customer_name,
                customer_phone: orderData.customer_phone || phoneNumber,
                whatsapp_phone: phoneNumber,
                normal_phone: orderData.normal_phone || null,
                district: orderData.district || null,
                customer_address: orderData.customer_address || null,
                order_items: enrichedItems,
                payment_method: paymentMethod,
                payment_status: paymentStatus,
                courier_status: "courier_transfer_pending",
                total_amount: orderData.total_amount || 0,
                special_instructions: orderData.customer_email ? `Email: ${orderData.customer_email}` : null,
                status: "confirmed",
                lead_source: leadAttr?.lead_source || "direct",
                ad_id: leadAttr?.ad_id || null,
                campaign_id: leadAttr?.campaign_id || null,
                user_id: userId,
              })
              .select()
              .single();

            if (orderError) {
              console.error("Error saving order:", orderError);
            } else {
              console.log("Order saved successfully:", orderResult.id);
              orderCreated = true;

              // Update lead status in leads table & halt follow-up (PRD §3.7 Stop Conditions)
              const newLeadStatus = paymentMethod === "cod" ? "Cash on Delivery" : "Order Confirmed";
              await supabase.from("leads").update({
                customer_name: orderData.customer_name || undefined,
                normal_phone: orderData.normal_phone || null,
                delivery_address: orderData.customer_address || null,
                status: newLeadStatus,
                selected_product: (orderData.order_items || []).map((i: any) => i.name).join(", "),
                followup_status: "stopped_ordered",
                next_followup_at: null,
                updated_at: new Date().toISOString(),
              }).eq("user_id", userId).eq("phone_number", phoneNumber);

              // Trigger automated invoice PDF generation
              try {
                console.log(`[ai-chat] Invoking generate-invoice-pdf for Order ${orderResult.id}...`);
                const pdfRes = await fetch(`${supabaseUrl}/functions/v1/generate-invoice-pdf-Dakshila_Dilina`, {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${supabaseServiceKey}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    orderId: orderResult.id,
                    userId,
                    sessionApiKey: sessionApiKey || undefined,
                  }),
                });
                if (!pdfRes.ok) {
                  const pdfErr = await pdfRes.text();
                  console.error(`[ai-chat] generate-invoice-pdf failed (${pdfRes.status}):`, pdfErr);
                } else {
                  const pdfJson = await pdfRes.json();
                  console.log(`[ai-chat] generate-invoice-pdf completed successfully:`, pdfJson);
                }
              } catch (err: any) {
                console.warn("[ai-chat] Failed to trigger invoice PDF generation:", err?.message || err);
              }

              // Trigger automated Courier API dispatch if enabled in settings
              (async () => {
                try {
                  const { data: courierRow } = await supabase
                    .from("settings")
                    .select("value")
                    .eq("key", "courier_settings")
                    .eq("user_id", userId)
                    .maybeSingle();

                  if (courierRow?.value?.auto_dispatch && courierRow?.value?.endpoint_url) {
                    fetch(`${supabaseUrl}/functions/v1/dispatch-courier-Dakshila_Dilina`, {
                      method: "POST",
                      headers: {
                        Authorization: `Bearer ${supabaseServiceKey}`,
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({
                        orderId: orderResult.id,
                        userId,
                      }),
                    }).catch((err) => console.warn("Auto courier dispatch error:", err.message));
                  }
                } catch (cErr) {
                  console.warn("Courier settings check error:", cErr);
                }
              })();

              // Send order notification to owner
              try {
                const { data: notifSettings } = await supabase
                  .from("settings")
                  .select("value")
                  .eq("key", "order_notifications")
                  .eq("user_id", userId)
                  .single();

                let ownerPhone = notifSettings?.value?.phone ? String(notifSettings.value.phone).replace(/\D/g, "") : null;
                if (ownerPhone) {
                  if (ownerPhone.startsWith("0") && ownerPhone.length === 10) {
                    ownerPhone = "94" + ownerPhone.substring(1);
                  } else if (ownerPhone.length === 9) {
                    ownerPhone = "94" + ownerPhone;
                  }
                  const items = (orderData.order_items || [])
                    .map((item: any) => `${item.quantity}x ${item.name}`)
                    .join(", ");
                  const notifMessage = `📦 New Order #${orderResult.id.substring(0, 8)}\n👤 ${orderData.customer_name}\n📱 ${orderData.customer_phone || phoneNumber}\n🛒 ${items}\n💰 Total: ${orderData.total_amount}\n💳 ${orderData.payment_method === "cod" ? "Cash on Delivery" : "Bank Transfer"}${orderData.district ? `\n🏘️ District: ${orderData.district}` : ""}${orderData.customer_address ? `\n📍 ${orderData.customer_address}` : ""}`;

                  // Use the sessionApiKey passed from the webhook, fallback to DB lookup
                  let sendApiKey = sessionApiKey || null;
                  if (!sendApiKey) {
                    const { data: sessionData } = await supabase
                      .from("user_wsender_sessions")
                      .select("session_api_key")
                      .eq("user_id", userId)
                      .limit(1)
                      .maybeSingle();
                    sendApiKey = sessionData?.session_api_key || null;
                  }

                  const sendNotif = await fetch(`${supabaseUrl}/functions/v1/send-whatsapp-Dakshila_Dilina`, {
                    method: "POST",
                    headers: {
                      Authorization: `Bearer ${supabaseServiceKey}`,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      to: ownerPhone,
                      message: notifMessage,
                      sessionApiKey: sendApiKey,
                    }),
                  });
                  if (!sendNotif.ok) {
                    console.error("Failed to send owner notification:", await sendNotif.text());
                  } else {
                    console.log("Owner notification sent to", ownerPhone);
                  }
                }
              } catch (notifError) {
                console.error("Error sending owner notification:", notifError);
              }
            }
          }
        } catch (parseError) {
          console.error("Error parsing order JSON:", parseError);
        }
      }
    }

    // Resolve FAQ attachments: only for FAQs the AI actually used, first time per conversation,
    // max 4 attachments in one reply.
    let faqMedia: string[] = [];
    if (usedFaqIds.length > 0) {
      const candidates: string[] = [];
      for (const id of usedFaqIds) {
        const faq = faqs.find((f: any) => f.id === id);
        const urls = Array.isArray(faq?.media_urls) ? faq!.media_urls : [];
        for (const u of urls) {
          if (typeof u === "string" && u.trim() && !candidates.includes(u)) candidates.push(u);
        }
      }

      if (candidates.length > 0) {
        // Skip anything already sent to this customer before
        const { data: priorRows } = await supabase
          .from("conversations")
          .select("metadata")
          .eq("user_id", userId)
          .eq("phone_number", phoneNumber)
          .eq("direction", "outbound")
          .not("metadata", "is", null)
          .order("created_at", { ascending: false })
          .limit(200);

        const alreadySent = new Set<string>();
        for (const row of priorRows || []) {
          const sent = (row as any)?.metadata?.faqMedia;
          if (Array.isArray(sent)) sent.forEach((u: string) => alreadySent.add(u));
        }

        faqMedia = candidates.filter((u) => !alreadySent.has(u)).slice(0, 4);
        if (faqMedia.length > 0) {
          console.log(`FAQ attachments to send (${faqMedia.length}): ${faqMedia.join(", ")}`);
        }
      }
    }

    // Collect ALL media previously sent to this customer in this conversation
    // to strictly enforce: "product ku orutharam photo vantha kaanum thirumba thirumba anupa thevala"
    const alreadySentMedia = new Set<string>();
    try {
      const { data: priorOutbound } = await supabase
        .from("conversations")
        .select("message, message_type, metadata")
        .eq("user_id", userId)
        .eq("phone_number", phoneNumber)
        .eq("direction", "outbound")
        .order("created_at", { ascending: false })
        .limit(100);

      for (const row of priorOutbound || []) {
        const meta = (row as any)?.metadata || {};
        if (Array.isArray(meta.imageUrls)) meta.imageUrls.forEach((u: string) => alreadySentMedia.add(u));
        if (typeof meta.imageUrl === "string") alreadySentMedia.add(meta.imageUrl);
        if (Array.isArray(meta.faqMedia)) meta.faqMedia.forEach((u: string) => alreadySentMedia.add(u));
        if (typeof meta.videoUrl === "string") alreadySentMedia.add(meta.videoUrl);
        // Also check if any known product image is substring in message
        for (const p of products) {
          if (p.images && Array.isArray(p.images)) {
            for (const img of p.images) {
              if (row.message && row.message.includes(img)) alreadySentMedia.add(img);
            }
          }
        }
      }
    } catch (priorErr) {
      console.warn("[ai-chat] Error fetching prior media:", priorErr);
    }

    // Extract image URLs if emitted by AI
    const imageUrlMatches = Array.from(responseText.matchAll(/<IMAGE_URL>([\s\S]*?)<\/IMAGE_URL>/g));
    let imageUrls = imageUrlMatches.map(m => m[1].trim());

    // Extract video URL if present
    const videoUrlMatch = responseText.match(/<VIDEO_URL>([\s\S]*?)<\/VIDEO_URL>/);
    let videoUrl = videoUrlMatch ? videoUrlMatch[1].trim() : null;

    // Filter out ANY image/video that was already sent to this customer
    imageUrls = imageUrls.filter(u => !alreadySentMedia.has(u));
    if (videoUrl && alreadySentMedia.has(videoUrl)) {
      videoUrl = null;
    }

    // If an order was just confirmed, NEVER send any product photos with the confirmation message
    if (orderCreated) {
      imageUrls = [];
      videoUrl = null;
    }

    // Intelligent Automatic Product Media Fallback:
    // ONLY trigger if:
    // 1) No image is currently selected
    // 2) No order was just created
    // 3) The customer specifically asked for photos / pictures / products / catalog
    // 4) The product photo has NEVER been sent to this customer yet
    if (imageUrls.length === 0 && !orderCreated) {
      const userMsgLower = (message || "").toLowerCase();
      const isExplicitMediaRequest = userMsgLower.includes("photo") ||
        userMsgLower.includes("image") ||
        userMsgLower.includes("pic") ||
        userMsgLower.includes("picture") ||
        userMsgLower.includes("show") ||
        userMsgLower.includes("catalog") ||
        userMsgLower.includes("look like") ||
        userMsgLower.includes("what are the product");

      if (isExplicitMediaRequest) {
        for (const p of products) {
          const pNameLower = p.name.toLowerCase();
          const pImg = p.images && Array.isArray(p.images) && p.images.length > 0 ? p.images[0] : null;
          // Only attach if this image was NEVER sent before
          if (pImg && !alreadySentMedia.has(pImg)) {
            if (userMsgLower.includes(pNameLower) || isExplicitMediaRequest) {
              console.log(`[ai-chat] Attaching first-time product photo for "${p.name}": ${pImg}`);
              imageUrls.push(pImg);
              if (!videoUrl && p.video_url && !alreadySentMedia.has(p.video_url)) {
                videoUrl = p.video_url;
              }
              break;
            }
          }
        }
      }
    }

    const imageUrl = imageUrls.length > 0 ? imageUrls[0] : null;

    // Handle human assistance request triggers without disabling the bot (per user preference)
    const handoffMatch = responseText.match(/<HANDOFF>([\s\S]*?)<\/HANDOFF>/i);
    if (handoffMatch) {
      const handoffReason = handoffMatch[1].trim();
      console.log(`[ai-chat] Customer requested human assistance for ${phoneNumber}: ${handoffReason}`);
      // Mark lead so staff alert banner displays in Conversations and Dashboard
      await supabase.from("leads").update({
        human_assistance_requested: true,
        updated_at: new Date().toISOString(),
      }).eq("user_id", userId).eq("phone_number", phoneNumber);
    }

    // Aggressively strip any JSON or technical markup from the response
    let cleanResponse = responseText;
    // Remove complete tagged blocks WITH their content first
    cleanResponse = cleanResponse.replace(/<ORDER_JSON>[\s\S]*?<\/ORDER_JSON>/g, "");
    cleanResponse = cleanResponse.replace(/<IMAGE_URL>[\s\S]*?<\/IMAGE_URL>/g, "");
    cleanResponse = cleanResponse.replace(/<VIDEO_URL>[\s\S]*?<\/VIDEO_URL>/g, "");
    cleanResponse = cleanResponse.replace(/<USED_FAQS>[\s\S]*?<\/USED_FAQS>/g, "");
    cleanResponse = cleanResponse.replace(/<HANDOFF>[\s\S]*?<\/HANDOFF>/gi, "");
    // Remove truncated/incomplete tags and everything after them
    cleanResponse = cleanResponse.replace(/<ORDER_JSON>[\s\S]*/g, "");
    cleanResponse = cleanResponse.replace(/<IMAGE_URL>[\s\S]*/g, "");
    cleanResponse = cleanResponse.replace(/<VIDEO_URL>[\s\S]*/g, "");
    cleanResponse = cleanResponse.replace(/<USED_FAQS>[\s\S]*/g, "");
    cleanResponse = cleanResponse.replace(/<HANDOFF>[\s\S]*/gi, "");
    // Remove any remaining orphan uppercase XML-like tags
    cleanResponse = cleanResponse.replace(/<\/?[A-Z_]+>/g, "");
    // Remove fenced code blocks (```json ... ``` or ``` ... ```)
    cleanResponse = cleanResponse.replace(/```[\s\S]*?```/g, "");
    // Remove any JSON object that looks like order data (greedy match for nested objects)
    cleanResponse = cleanResponse.replace(/\{[^{}]*"customer_name"[^}]*\}/g, "");
    cleanResponse = cleanResponse.replace(/\{[^{}]*"customername"[^}]*\}/g, ""); // catch typos from model
    cleanResponse = cleanResponse.replace(/\{[^{}]*"order_items"[^}]*\}/g, "");
    cleanResponse = cleanResponse.replace(/\{[^{}]*"payment_method"[^}]*\}/g, "");
    cleanResponse = cleanResponse.replace(/\{[^{}]*"total_amount"[^}]*\}/g, "");
    // Remove any remaining JSON-like structures with 2+ key-value pairs
    cleanResponse = cleanResponse.replace(/\{\s*"[^"]+"\s*:[\s\S]*?\}/g, "");
    // Remove any leftover image URLs on their own line (https://...supabase... patterns)
    cleanResponse = cleanResponse.replace(/^https?:\/\/[^\s]+$/gm, "");
    // Remove standalone UUIDs that leak from FAQ IDs or correlation IDs
    cleanResponse = cleanResponse.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "");
    // Remove [FAQ_ID:...] references that may leak into response
    cleanResponse = cleanResponse.replace(/\[FAQ_ID:[^\]]*\]/g, "");
    // Clean up leftover whitespace
    cleanResponse = cleanResponse.replace(/\n{3,}/g, "\n\n").trim();

    // Log AI usage independently of conversations
    await supabase.from("ai_usage_logs").insert({
      user_id: userId,
      phone_number: contactKey || phoneNumber,
    });

    // If an order was created, check for follow-up message
    let followupMessage: string | null = null;
    if (orderCreated) {
      try {
        const { data: followupSettings } = await supabase
          .from("settings")
          .select("value")
          .eq("key", "order_followup_message")
          .eq("user_id", userId)
          .single();

        if (followupSettings?.value?.enabled && followupSettings?.value?.text?.trim()) {
          followupMessage = followupSettings.value.text.trim();
          console.log("Order follow-up message will be sent");
        }
      } catch (e) {
        console.warn("Could not fetch order followup setting:", e);
      }
    }

    return new Response(
      JSON.stringify({ response: cleanResponse, imageUrl, imageUrls, videoUrl, followupMessage, faqMedia }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("AI Chat error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
