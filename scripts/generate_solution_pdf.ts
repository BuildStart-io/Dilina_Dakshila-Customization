import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.9";

async function createSolutionPlanPdf() {
  const pdfDoc = await PDFDocument.create();
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const primaryColor = rgb(0.12, 0.23, 0.54);   // Deep Navy #1e3a8a
  const accentColor = rgb(0.55, 0.24, 0.85);    // Purple #8b5cf6
  const darkTextColor = rgb(0.1, 0.1, 0.15);
  const mutedTextColor = rgb(0.35, 0.35, 0.4);
  const borderColor = rgb(0.85, 0.88, 0.92);
  const lightBgColor = rgb(0.96, 0.97, 0.99);

  let page = pdfDoc.addPage([595.28, 841.89]); // A4
  let y = 800;

  function checkPage(requiredSpace: number) {
    if (y - requiredSpace < 50) {
      page = pdfDoc.addPage([595.28, 841.89]);
      y = 800;
      // Draw header banner on new page
      page.drawRectangle({
        x: 40,
        y: 815,
        width: 515.28,
        height: 1,
        color: borderColor,
      });
      page.drawText("BuildStart.io — Dilina & Dakshila Customization Architecture Plan", {
        x: 40,
        y: 820,
        size: 8,
        font: fontRegular,
        color: mutedTextColor,
      });
    }
  }

  // Cover / Header Banner
  page.drawRectangle({
    x: 40,
    y: y - 80,
    width: 515.28,
    height: 80,
    color: primaryColor,
  });

  page.drawText("BUILDSTART CUSTOMIZATION SOLUTION BLUEPRINT", {
    x: 55,
    y: y - 35,
    size: 16,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  page.drawText("Comprehensive Architecture & Implementation Plan for Mr. Dilina Dakshila", {
    x: 55,
    y: y - 55,
    size: 10,
    font: fontRegular,
    color: rgb(0.9, 0.92, 1),
  });

  page.drawText("Client: Mr. Dilina Dakshila (Magazines & Clothing Retailer)  |  Version: 2.0  |  Date: October 2026", {
    x: 55,
    y: y - 72,
    size: 8,
    font: fontRegular,
    color: rgb(0.75, 0.82, 0.95),
  });

  y -= 105;

  // Executive Overview Box
  page.drawRectangle({
    x: 40,
    y: y - 65,
    width: 515.28,
    height: 65,
    color: lightBgColor,
    borderColor: borderColor,
    borderWidth: 1,
  });

  page.drawText("EXECUTIVE SUMMARY & PURPOSE", {
    x: 50,
    y: y - 18,
    size: 10,
    font: fontBold,
    color: primaryColor,
  });

  const summaryText =
    "This document outlines the systematic engineering solutions for all 7 critical operational gaps\n" +
    "identified across the WhatsApp bot, database schema, and merchant dashboard, fully aligned with the\n" +
    "13-page PRD v1.0 specifications and technical requirements for Mr. Dilina Dakshila's retail business.";

  page.drawText(summaryText, {
    x: 50,
    y: y - 34,
    size: 8.5,
    font: fontRegular,
    color: darkTextColor,
    lineHeight: 12,
  });

  y -= 85;

  // 7 Solution Sections
  const sections = [
    {
      num: "1",
      title: "Automated Customer Bill PDF WhatsApp Dispatch (PRD §3.8 / Step 8)",
      problem: "Customer Bill PDF was generated on server storage but not consistently delivered to the customer's WhatsApp chat due to external URL fetching limitations in the WAHA container.",
      solution: [
        "Base64 Document Dispatch: Instead of passing public HTTP storage URLs to WAHA, the generated PDF bytes will be directly encoded as 'data:application/pdf;base64,...' payloads.",
        "Zero Network Dependency: Enables WAHA to dispatch the PDF document natively without downloading external links, guaranteeing 100% reliable WhatsApp delivery.",
        "Official Bill Metadata: PDF contains Store Name, Dual Contact Phones, Order Ref ID, Item Breakdown with Sizes/Issues, Total Amount, and Payment Method.",
        "Dashboard Persistence: Public URL is saved in orders.bill_pdf_url for direct view/download inside the Orders drawer.",
      ],
    },
    {
      num: "2",
      title: "Courier API Transmission Log & HTTP Inspection (PRD §3.4 / Step 9)",
      problem: "Staff cannot inspect the exact HTTP request payload, HTTP response code (200 OK vs 401/422 Denied), or courier error message when parcels are dispatched via API.",
      solution: [
        "Audit Log Schema: Add 'courier_dispatch_log' (JSONB) to the orders table to record timestamp, provider, endpoint URL, HTTP status code, request JSON, and response JSON.",
        "Order Drawer Inspection Panel: Add an expandable 'Courier API HTTP Audit' viewer showing status badge (Green for 200 OK, Red for Denied/Failed) and raw response details.",
        "Interactive Actions: Provide direct 'Dispatch to Courier API' and 'Retry Dispatch' buttons with immediate toast notifications displaying the returned tracking/waybill number.",
        "Multi-Provider Support: Pre-configured presets for Prompt Xpress, Koombiyo, Domex, Pronto, Fardar, and Custom REST Webhooks.",
      ],
    },
    {
      num: "3",
      title: "Automatic Product Stock & Inventory Deduction (PRD §3.2)",
      problem: "When orders are confirmed, product stock quantity remained unchanged in the database, risking overselling of popular magazine issues and clothing sizes.",
      solution: [
        "Automated Database Deduction: Deduct ordered quantities (stock_quantity = GREATEST(0, stock_quantity - qty)) immediately upon order confirmation.",
        "Stock Depletion Safety: If stock reaches 0, flag the product as Out of Stock (is_active = false or stock status badge).",
        "AI Chat Stock Awareness: System prompt instructs the AI to check live product stock; if an item is sold out, notify the customer politely and recommend alternatives.",
        "Merchant Restock UI: Visual inventory tracker in Products.tsx with low stock warnings and quick-edit restocking inputs.",
      ],
    },
    {
      num: "4",
      title: "Lead Contact & Address PDF Report with Filters (PRD §3.5)",
      problem: "Exporting lead lists only opened a basic browser print dialog without complete multi-parameter filtering or direct PDF file downloading.",
      solution: [
        "Comprehensive Filter Engine: Filter leads by Date Range (From/To), Lead Source (Facebook, TikTok, Direct), Selected Product, Order Status, and Follow-up Status.",
        "PRD Compliant Columns: Generates PDF table containing Lead Name, WhatsApp Number, Normal Phone, Delivery Address, Source, Product, Status, and Date.",
        "Direct PDF Export: Generates and triggers an instant download of 'Leads_Report_YYYY-MM-DD.pdf' without requiring manual browser print settings.",
        "Delivery Manifest Format: Optimized layout formatted for store staff and logistics planning.",
      ],
    },
    {
      num: "5",
      title: "Advertisement Performance Tracking Engine (PRD §3.6)",
      problem: "Ad attribution only tracked broad channel totals (FB vs TikTok) without tracking specific Ad IDs, Ad Names, Campaign IDs, or identifying high vs low-performing ads.",
      solution: [
        "Deep Metadata Extraction: Parse externalAdReply from WAHA webhook to record ad_id, campaign_id, ad_title, and source in both leads and orders tables.",
        "Ad Performance Table: Display ranked table in Dashboard: Ad Name/ID, Campaign, Product, Total Inquiries, Confirmed Orders, Total Revenue, and Conversion Rate %.",
        "ROI & Conversion Highlights: Automatically identify Top Converting Ad vs Lowest Converting Ad, enabling data-driven marketing budget allocation.",
        "Channel Comparison Cards: Side-by-side performance cards for Facebook Ads, TikTok Ads, and Direct Organic WhatsApp leads.",
      ],
    },
    {
      num: "6",
      title: "Human Agent Hand-off Architecture (PRD §3.3 / Blueprint §4)",
      problem: "When a customer requested a human agent or escalated an issue, the bot continued auto-responding and multi-step follow-ups kept firing.",
      solution: [
        "Automated AI Pause: When customer requests a human or AI emits <HANDOFF>, immediately set is_bot_active = false for that conversation.",
        "Follow-up Sequence Halt: Update lead followup_status = 'stopped_staff_handoff' so automated drip messages stop instantly.",
        "Staff Alert & Badge: Display prominent 'Human Assistance Requested' amber alert banner in Conversations.tsx and Dashboard.",
        "Staff Takeover & Resume: Allow human staff to reply directly via WhatsApp and provide a 'Resume AI Assistant' button once the inquiry is resolved.",
      ],
    },
    {
      num: "7",
      title: "Comprehensive Dashboard Order Tracking & 300 Contacts Monitor (PRD §3.9 / §3.4)",
      problem: "Dashboard displayed message-based limits instead of unique customer contacts (300 contacts/day) and lacked a cohesive lifecycle order tracker.",
      solution: [
        "Daily Contact Capacity Monitor: Tracks unique customers handled today (out of 300 contacts test capacity) with message volume breakdown.",
        "Order Lifecycle Pipeline: Visual stages for Pending -> Confirmed -> Courier Dispatched -> Out for Delivery -> Delivered.",
        "COD & Payment Summary: Real-time calculation of Cash on Delivery pending courier collection vs confirmed payments.",
        "Actionable Recent Orders: One-click actions to dispatch parcels, copy tracking numbers, or view generated bill invoices directly from the dashboard.",
      ],
    },
  ];

  for (const sec of sections) {
    checkPage(160);

    // Section Header Box
    page.drawRectangle({
      x: 40,
      y: y - 24,
      width: 515.28,
      height: 24,
      color: rgb(0.93, 0.95, 0.99),
      borderColor: borderColor,
      borderWidth: 1,
    });

    page.drawText(`${sec.num}. ${sec.title}`, {
      x: 48,
      y: y - 16,
      size: 9.5,
      font: fontBold,
      color: primaryColor,
    });

    y -= 34;

    // Issue / Current Gap
    page.drawText("Current Operational Gap:", {
      x: 48,
      y,
      size: 8,
      font: fontBold,
      color: rgb(0.8, 0.2, 0.2),
    });

    page.drawText(sec.problem, {
      x: 165,
      y,
      size: 8,
      font: fontRegular,
      color: darkTextColor,
      maxWidth: 380,
      lineHeight: 11,
    });

    y -= 22;

    // Proposed Technical Solution
    page.drawText("Technical Solution Plan:", {
      x: 48,
      y,
      size: 8,
      font: fontBold,
      color: primaryColor,
    });

    y -= 14;

    for (const sol of sec.solution) {
      checkPage(24);
      page.drawText("•", { x: 55, y, size: 9, font: fontBold, color: accentColor });
      page.drawText(sol, {
        x: 68,
        y,
        size: 7.8,
        font: fontRegular,
        color: darkTextColor,
        maxWidth: 480,
        lineHeight: 11,
      });
      y -= 16;
    }

    y -= 10;
  }

  // Implementation Roadmap / Next Steps Box
  checkPage(130);

  page.drawRectangle({
    x: 40,
    y: y - 110,
    width: 515.28,
    height: 110,
    color: rgb(0.95, 0.98, 0.95),
    borderColor: rgb(0.7, 0.85, 0.7),
    borderWidth: 1,
  });

  page.drawText("IMPLEMENTATION ROADMAP & APPROVAL", {
    x: 52,
    y: y - 20,
    size: 10,
    font: fontBold,
    color: rgb(0.1, 0.5, 0.2),
  });

  const roadmapText =
    "Phase 1: Customer Invoice PDF Direct Base64 WhatsApp Dispatch & Product Stock Deduction Trigger\n" +
    "Phase 2: Courier API Transmission HTTP Audit Logger & Order Tab Inspection Interface\n" +
    "Phase 3: Lead Contact & Address PDF Report with Complete PRD Multi-Filters\n" +
    "Phase 4: Facebook & TikTok Ad Performance Analytics & High/Low Conversion Dashboard\n" +
    "Phase 5: Human Agent Hand-off Protocol with AI Auto-Pause & Drip Halt Controls\n\n" +
    "Status: Awaiting User Approval to execute code and database changes.";

  page.drawText(roadmapText, {
    x: 52,
    y: y - 38,
    size: 8,
    font: fontRegular,
    color: darkTextColor,
    lineHeight: 12,
  });

  // Footer on final page
  page.drawText("BuildStart Self-Hosted — Mr. Dilina Dakshila Customization Architecture Document  |  Page " + pdfDoc.getPageCount(), {
    x: 120,
    y: 30,
    size: 7.5,
    font: fontOblique,
    color: mutedTextColor,
  });

  const pdfBytes = await pdfDoc.save();
  const outputPath = "/home/kapi/Documents/Dakshila_Dilina/BuildStart_Customization_Solution_Blueprint.pdf";
  await Deno.writeFile(outputPath, pdfBytes);
  console.log(`PDF successfully generated at ${outputPath}`);
}

createSolutionPlanPdf().catch(console.error);
