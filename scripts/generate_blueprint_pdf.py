import os
import subprocess

def create_solution_blueprint():
    ps_file = "/tmp/blueprint.ps"
    pdf_file = "/home/kapi/Documents/Dakshila_Dilina/BuildStart_Customization_Solution_Blueprint.pdf"

    # We will build a multi-page PostScript file with accurate pagination and styling
    pages = []
    
    # Data structure for the document
    doc_title = "BUILDSTART CUSTOMIZATION SOLUTION BLUEPRINT"
    doc_subtitle = "Technical Engineering Architecture & Implementation Plan"
    client_info = "Client: Mr. Dilina Dakshila (Magazines & Clothing Retail) | Version: 2.0 | October 2026"
    
    # Requirements & Solutions
    modules = [
        {
            "id": "1",
            "title": "Customer Bill PDF WhatsApp Dispatch (PRD Step 8 & Section 3.8)",
            "gap": "Invoice PDF was generated in server storage but not consistently delivered to the customer's WhatsApp chat because WAHA Docker container cannot resolve local/external storage URLs.",
            "solution_points": [
                "Base64 Document Stream: Convert generated PDF directly into Base64 (data:application/pdf;base64,...) and transmit via WAHA /api/sendFile, eliminating all external URL network fetching.",
                "PRD Bill Content: Bill includes Store Name, Dual Contact Phones, Order Ref ID, Item Breakdown with Sizes/Issues, Total Price, Delivery Details, and Payment Method.",
                "Dual Access: PDF is delivered straight to the customer's WhatsApp chat AND stored in orders.bill_pdf_url for one-click viewing/downloading in the dashboard Orders tab.",
                "Instant Order Confirmation: Triggered automatically the moment order status transitions to 'Confirmed'."
            ],
            "impact": "100% reliable invoice delivery directly into the customer's WhatsApp chat with zero URL fetch failures."
        },
        {
            "id": "2",
            "title": "Courier API Transmission Log & HTTP Inspection (PRD Step 9 & Section 3.4)",
            "gap": "Store staff cannot inspect the outgoing HTTP request payload, HTTP response status code (200 OK vs 401/422 Denied), or courier error response when dispatching orders.",
            "solution_points": [
                "Audit Schema: Add courier_dispatch_log (JSONB) column to orders table recording timestamp, provider, endpoint URL, HTTP status code, request payload, and response body.",
                "Orders Drawer Inspection Panel: Add an interactive 'Courier API HTTP Audit' viewer showing status badge (Green for 200 OK, Red for Denied/Failed) and raw response details.",
                "Dispatch Control & Retry: One-click 'Dispatch to Courier API' and 'Retry Dispatch' buttons with immediate toast notifications displaying returned tracking/waybill numbers.",
                "Multi-Provider Compatibility: Pre-configured presets for Prompt Xpress, Koombiyo, Domex, Pronto, Fardar, and Custom REST Webhooks with authentication headers."
            ],
            "impact": "Full visibility into courier API requests/responses with instant diagnosis of denied requests directly from the Orders tab."
        },
        {
            "id": "3",
            "title": "Product Inventory & Automatic Stock Deduction (PRD Section 3.2)",
            "gap": "When orders are confirmed, product stock quantity remained unchanged in the database, risking overselling of popular magazine issues and clothing sizes.",
            "solution_points": [
                "Atomic Database Deduction: Execute atomic decrement (stock_quantity = GREATEST(0, stock_quantity - qty)) immediately upon order confirmation.",
                "Out-of-Stock Handling: Automatically flag products with stock_quantity = 0 as Out of Stock (is_active = false / out_of_stock badge).",
                "AI Chat Stock Awareness: System prompt instructs the AI to check live inventory; if an item is sold out, AI politely informs customer and suggests alternatives.",
                "Merchant Restock UI: Visual inventory tracker in Products page with low-stock warnings (< 5 units) and quick restocking increment buttons."
            ],
            "impact": "Prevents stock overselling and automates real-time inventory synchronization across AI chat and merchant dashboard."
        },
        {
            "id": "4",
            "title": "Lead Contact & Address PDF Report with Filters (PRD Section 3.5)",
            "gap": "Exporting leads only supported basic browser print dialogs without multi-parameter filtering or direct, formatted PDF manifest downloads.",
            "solution_points": [
                "Comprehensive Multi-Filter: Filter leads by Date Range (From/To), Lead Source (Facebook, TikTok, Direct), Selected Product, Order Status, and Follow-up Status.",
                "PRD Standard Columns: Tabulated report containing Lead Name, WhatsApp Number, Normal Contact Number, Delivery Address, Lead Source, Selected Product, Status, and Date.",
                "Direct PDF Export: Generates and triggers an instant download of 'Leads_Report_YYYY-MM-DD.pdf' formatted cleanly for logistics and marketing analysis.",
                "Delivery Manifest Format: Optimized landscape layout designed specifically for delivery staff and dispatch preparation."
            ],
            "impact": "Enables store staff to export customized, filtered lead and delivery address lists directly as printable PDF reports."
        },
        {
            "id": "5",
            "title": "Advertisement Performance Tracking Engine (PRD Section 3.6)",
            "gap": "Ad attribution only tracked broad channel totals (FB vs TikTok) without tracking specific Ad IDs, Ad Names, Campaign IDs, or identifying high vs low-performing ads.",
            "solution_points": [
                "Deep Metadata Extraction: Parse externalAdReply from WAHA webhook to record ad_id, campaign_id, ad_title, and source in both leads and orders tables.",
                "Ad Performance Table: Display ranked table in Dashboard: Ad Name/ID, Campaign, Product, Total Inquiries, Confirmed Orders, Total Revenue, and Conversion Rate %.",
                "Top vs Lowest Ad Indicators: Automatically highlight Top Converting Ad vs Lowest Converting Ad, enabling data-driven ad budget allocation.",
                "Channel Comparison Cards: Side-by-side performance cards for Facebook Ads, TikTok Ads, and Direct Organic WhatsApp leads."
            ],
            "impact": "Clear attribution of inquiries and sales to specific ad campaigns, highlighting high-ROI and underperforming advertisements."
        },
        {
            "id": "6",
            "title": "Human Agent Hand-off Mechanism (PRD Section 3.3 & Blueprint Section 4)",
            "gap": "When a customer requested human assistance or escalated an issue, the AI continued auto-replying and automated follow-up messages kept firing.",
            "solution_points": [
                "Automated AI Pause: When customer requests human help or AI detects complex issues (<HANDOFF>), immediately set is_bot_active = false for that chat.",
                "Follow-up Sequence Halt: Update lead followup_status = 'stopped_staff_handoff' so automated cron messages stop instantly.",
                "Staff Alert & Badge: Display prominent 'Human Assistance Requested' amber alert banner in Conversations page and Dashboard.",
                "Staff Takeover & Resume: Allow human staff to reply directly via WhatsApp and provide a 'Resume AI Assistant' button once the inquiry is resolved."
            ],
            "impact": "Eliminates bot interference during human staff conversations while providing visual alerts for pending customer hand-offs."
        },
        {
            "id": "7",
            "title": "Comprehensive Dashboard Order Tracking & 300 Contacts Monitor (PRD Section 3.9)",
            "gap": "Dashboard tracked message limits instead of unique customer contacts (300 contacts test limit) and lacked a cohesive lifecycle order tracker.",
            "solution_points": [
                "Daily Contact Capacity Monitor: Tracks unique customers handled today (out of 300 contacts test capacity) with visual progress bar and alert thresholds.",
                "Order Lifecycle Pipeline: Visual stages for Pending -> Confirmed -> Courier Dispatched -> Out for Delivery -> Delivered.",
                "COD & Payment Summary: Real-time calculation of Cash on Delivery pending courier collection vs confirmed payments.",
                "Actionable Recent Orders: One-click actions to dispatch parcels, copy tracking numbers, or view generated bill invoices directly from the dashboard."
            ],
            "impact": "Unified high-level dashboard displaying daily customer capacity, order delivery stages, and COD collection metrics."
        }
    ]

    # Helper to escape PostScript strings
    def escape_ps(s):
        return s.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')

    # Word wrapping helper
    def wrap_lines(text, max_len=95):
        words = text.split(' ')
        lines = []
        cur = []
        cur_len = 0
        for w in words:
            if cur_len + len(w) + 1 > max_len:
                lines.append(' '.join(cur))
                cur = [w]
                cur_len = len(w)
            else:
                cur.append(w)
                cur_len += len(w) + 1
        if cur:
            lines.append(' '.join(cur))
        return lines

    # Let's generate PostScript code
    ps_lines = [
        "%!PS-Adobe-3.0",
        "%%BoundingBox: 0 0 595 842",
        "%%Pages: (atend)",
        "%%EndComments",
        "",
        "% --- Color Definitions ---",
        "/primaryColor   { 0.118 0.227 0.537 setrgbcolor } def  % Deep Navy #1e3a8a",
        "/secondaryColor { 0.310 0.275 0.898 setrgbcolor } def  % Indigo #4f46e5",
        "/accentColor    { 0.486 0.227 0.929 setrgbcolor } def  % Purple #7c3aed",
        "/textColor      { 0.094 0.125 0.200 setrgbcolor } def  % Slate #182033",
        "/mutedColor      { 0.392 0.447 0.545 setrgbcolor } def  % Gray #64748b",
        "/cardBgColor    { 0.965 0.973 0.992 setrgbcolor } def  % Light Blue Gray #f6f8fd",
        "/borderColor    { 0.851 0.886 0.933 setrgbcolor } def  % Border #d9e2ee",
        "/alertRed       { 0.850 0.200 0.200 setrgbcolor } def  % Red",
        "/successGreen   { 0.100 0.550 0.250 setrgbcolor } def  % Green",
        "/whiteColor     { 1.000 1.000 1.000 setrgbcolor } def",
        "",
        "% --- Box Drawing Helper ---",
        "/drawBox { % x y w h r g b",
        "  setrgbcolor",
        "  newpath 4 2 roll moveto",
        "  dup 0 exch rlineto",
        "  exch 0 rlineto",
        "  neg 0 exch rlineto",
        "  closepath fill",
        "} def",
        "",
        "/drawStrokeBox { % x y w h r g b lw",
        "  setlinewidth",
        "  setrgbcolor",
        "  newpath 4 2 roll moveto",
        "  dup 0 exch rlineto",
        "  exch 0 rlineto",
        "  neg 0 exch rlineto",
        "  closepath stroke",
        "} def",
        ""
    ]

    current_page = 1
    y = 800

    def start_page():
        nonlocal current_page, y
        ps_lines.append(f"%%Page: {current_page} {current_page}")
        ps_lines.append("save")
        y = 800
        # Draw running header on subsequent pages
        if current_page > 1:
            ps_lines.append("0.851 0.886 0.933 setrgbcolor 1 setlinewidth")
            ps_lines.append("45 815 moveto 550 815 lineto stroke")
            ps_lines.append("/Helvetica 8 selectfont mutedColor")
            ps_lines.append(f"45 820 moveto ({escape_ps(doc_title)} - Page {current_page}) show")
            ps_lines.append(f"360 820 moveto ({escape_ps('Client: Mr. Dilina Dakshila')}) show")
            y = 790

    def end_page():
        nonlocal current_page
        # Running footer
        ps_lines.append("0.851 0.886 0.933 setrgbcolor 1 setlinewidth")
        ps_lines.append("45 38 moveto 550 38 lineto stroke")
        ps_lines.append("/Helvetica 8 selectfont mutedColor")
        ps_lines.append(f"45 26 moveto ({escape_ps('BuildStart Customization Architecture Blueprint v2.0 - October 2026')}) show")
        ps_lines.append(f"480 26 moveto ({escape_ps(f'Page {current_page}')}) show")
        ps_lines.append("restore showpage")
        current_page += 1

    # PAGE 1: Cover Header + Executive Summary + Modules 1 & 2
    start_page()

    # Top Banner Header
    ps_lines.append("45 720 505 82 0.118 0.227 0.537 drawBox")
    ps_lines.append("/Helvetica-Bold 15 selectfont whiteColor")
    ps_lines.append(f"58 775 moveto ({escape_ps(doc_title)}) show")
    ps_lines.append("/Helvetica 10 selectfont 0.90 0.92 1.00 setrgbcolor")
    ps_lines.append(f"58 756 moveto ({escape_ps(doc_subtitle)}) show")
    ps_lines.append("/Helvetica 8 selectfont 0.75 0.82 0.95 setrgbcolor")
    ps_lines.append(f"58 734 moveto ({escape_ps(client_info)}) show")

    y = 705

    # Executive Summary Card
    ps_lines.append("45 635 505 65 0.965 0.973 0.992 drawBox")
    ps_lines.append("45 635 505 65 0.851 0.886 0.933 1 drawStrokeBox")
    ps_lines.append("/Helvetica-Bold 9.5 selectfont primaryColor")
    ps_lines.append("56 685 moveto (EXECUTIVE SUMMARY & SYSTEM DIAGNOSTIC) show")
    
    summary_text = (
        "Based on a comprehensive review of the 13-page PRD specifications, live system interactions, and the "
        "7 operational pain points reported by Mr. Dilina Dakshila, this Blueprint details the exact technical "
        "architecture required to achieve full commercial readiness across the WhatsApp AI bot, backend API workflows, "
        "and merchant administration portal prior to code deployment."
    )
    y_sum = 670
    ps_lines.append("/Helvetica 8 selectfont textColor")
    for line in wrap_lines(summary_text, 105):
        ps_lines.append(f"56 {y_sum} moveto ({escape_ps(line)}) show")
        y_sum -= 11

    y = 618

    # Function to draw a Module Card
    def draw_module(mod):
        nonlocal y
        # Check if enough space
        req_space = 150
        if y - req_space < 50:
            end_page()
            start_page()

        card_h = 135
        # Header bar for module
        ps_lines.append(f"45 {y - 20} 505 20 0.93 0.95 0.99 drawBox")
        ps_lines.append(f"45 {y - 20} 505 20 0.851 0.886 0.933 1 drawStrokeBox")
        ps_lines.append("/Helvetica-Bold 9 selectfont primaryColor")
        ps_lines.append(f"52 {y - 14} moveto ({escape_ps(mod['id'] + '. ' + mod['title'])}) show")

        # Gap section
        y -= 32
        ps_lines.append("/Helvetica-Bold 8 selectfont alertRed")
        ps_lines.append(f"52 {y} moveto (Operational Gap:) show")
        ps_lines.append("/Helvetica 7.8 selectfont textColor")
        gap_lines = wrap_lines(mod["gap"], 85)
        ps_lines.append(f"135 {y} moveto ({escape_ps(gap_lines[0])}) show")
        if len(gap_lines) > 1:
            y -= 10
            ps_lines.append(f"135 {y} moveto ({escape_ps(gap_lines[1])}) show")

        # Solution Section
        y -= 14
        ps_lines.append("/Helvetica-Bold 8 selectfont primaryColor")
        ps_lines.append(f"52 {y} moveto (Technical Solution Plan:) show")
        y -= 11

        for pt in mod["solution_points"]:
            ps_lines.append("/Helvetica-Bold 8 selectfont accentColor")
            ps_lines.append(f"56 {y} moveto ([+] ) show")
            ps_lines.append("/Helvetica 7.5 selectfont textColor")
            pt_lines = wrap_lines(pt, 98)
            ps_lines.append(f"70 {y} moveto ({escape_ps(pt_lines[0])}) show")
            for sub_l in pt_lines[1:]:
                y -= 9.5
                ps_lines.append(f"70 {y} moveto ({escape_ps(sub_l)}) show")
            y -= 11

        # Key Business Impact
        ps_lines.append("/Helvetica-Bold 7.5 selectfont successGreen")
        ps_lines.append(f"56 {y} moveto (Expected Result:) show")
        ps_lines.append("/Helvetica-Oblique 7.5 selectfont mutedColor")
        ps_lines.append(f"130 {y} moveto ({escape_ps(mod['impact'])}) show")
        y -= 22

    # Draw Module 1 and 2 on Page 1
    draw_module(modules[0])
    draw_module(modules[1])
    end_page()

    # PAGE 2: Modules 3, 4, 5
    start_page()
    draw_module(modules[2])
    draw_module(modules[3])
    draw_module(modules[4])
    end_page()

    # PAGE 3: Modules 6, 7 and Roadmap / Signoff
    start_page()
    draw_module(modules[5])
    draw_module(modules[6])

    # Implementation Roadmap & Verification Matrix
    if y - 170 < 50:
        end_page()
        start_page()

    ps_lines.append(f"45 {y - 150} 505 145 0.955 0.985 0.965 drawBox")
    ps_lines.append(f"45 {y - 150} 505 145 0.700 0.850 0.720 1.2 drawStrokeBox")
    ps_lines.append("/Helvetica-Bold 10 selectfont successGreen")
    ps_lines.append(f"55 {y - 18} moveto (SYSTEMATIC EXECUTION ROADMAP & VERIFICATION CRITERIA) show")

    roadmap_steps = [
        ("Phase 1: Automated Customer Invoicing & Stock Sync", "Direct Base64 PDF WhatsApp dispatch via WAHA + atomic product quantity deduction trigger."),
        ("Phase 2: Courier API Transmission & HTTP Inspector", "Add courier_dispatch_log JSONB in orders table + full HTTP 200 vs 4xx/5xx inspection in Order Drawer."),
        ("Phase 3: Lead Contact & Delivery Address PDF Export", "Multi-filter engine (Date, Source, Product, Status) + one-click landscape PDF export generator."),
        ("Phase 4: Ad Performance Tracking & Conversion Matrix", "WAHA externalAdReply parser + Top/Low converting ad identification table on dashboard."),
        ("Phase 5: Human Agent Hand-off & Follow-up Safety", "AI pause toggle (is_bot_active = false) + halt follow-up cron + staff takeover banner."),
        ("Phase 6: Dashboard Order Lifecycle & 300 Contacts Meter", "Visual pipeline tracking + COD metrics + daily unique contacts capacity monitor.")
    ]

    y_road = y - 34
    for phase, desc in roadmap_steps:
        ps_lines.append("/Helvetica-Bold 8 selectfont textColor")
        ps_lines.append(f"55 {y_road} moveto ({escape_ps(phase)}:) show")
        ps_lines.append("/Helvetica 7.5 selectfont mutedColor")
        ps_lines.append(f"250 {y_road} moveto ({escape_ps(desc)}) show")
        y_road -= 13

    y_road -= 6
    ps_lines.append("/Helvetica-Bold 8.5 selectfont primaryColor")
    ps_lines.append(f"55 {y_road} moveto (STATUS & NEXT ACTION:) show")
    ps_lines.append("/Helvetica-Oblique 8 selectfont alertRed")
    ps_lines.append(f"185 {y_road} moveto (Awaiting Merchant Approval - Code implementation will begin upon your confirmation.) show")

    end_page()

    # Finalize PostScript
    ps_lines[2] = f"%%Pages: {current_page - 1}"
    
    with open(ps_file, "w") as f:
        f.write("\n".join(ps_lines))

    # Convert to PDF using ps2pdf
    cmd = ["ps2pdf", "-sPAPERSIZE=a4", ps_file, pdf_file]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print("Error compiling PDF:", res.stderr)
        return False
    
    print(f"PDF successfully created at {pdf_file} ({os.path.getsize(pdf_file)} bytes)")
    return True

if __name__ == "__main__":
    create_solution_blueprint()
