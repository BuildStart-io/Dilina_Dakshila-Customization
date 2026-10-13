# BuildStart — Customization Implementation Plan & Architecture Blueprint
**Client:** Mr. Dilina Dakshina  
**Project:** Customized WhatsApp Sales Support Agent & Management Dashboard  
**Target Repository:** `buildstart-selfhosted`  
**Database Schema:** `"Dakshila_Dilina"`  
**Status:** Planning & Analysis Phase (No Code Changes Applied Yet)  
**Date:** 13th October 2026  

---

## 1. Executive Summary

This implementation plan bridges the **Product Requirement Document (PRD v1.0, 13 pages)** and the **Technical Solution Blueprint (5 pages)** with the current **`buildstart-selfhosted`** codebase.

The client operates an e-commerce business selling **magazines, clothing, and related products** (catalog of 6–7 products), acquiring leads primarily via **Facebook and TikTok Click-to-WhatsApp ads**, with an initial operational capacity of **~300 customer messages per day**.

### Key Deliverables:
1. **Intelligent WhatsApp Sales Support Agent** tailored for Magazines & Clothing with size/color variations, stock validation, and dual-phone collection (WhatsApp + Regular phone).
2. **Dual Payment Workflows:** Seamless Cash on Delivery (COD) and Bank Transfer with payment slip upload, receipt ingestion, and staff verification in the dashboard.
3. **Automated Customer Bill PDF Generation:** Automatic invoice generation upon order confirmation and instant delivery to WhatsApp via WAHA document messaging.
4. **Filterable Lead Contact & Address PDF Report:** Downloadable branded PDF reports with filters by date, ad source (Facebook/TikTok), product, and lead status.
5. **Ad Attribution & ROI Analytics:** Ingestion of ad metadata (`externalAdReply`) to track leads, inquiries, confirmed orders, and conversion rates across Facebook and TikTok campaigns.
6. **Configurable Multi-Step Follow-Up Engine:** Automated drip follow-ups up to a maximum limit (e.g., 4 messages), bounded by allowed daily time windows (9 AM – 8 PM) and strict exit triggers.
7. **Courier Service Integration & Fallback:** Automated data transmission to courier service, real-time status badges, retry actions, and manual one-click CSV manifest export.
8. **Daily Message Capacity Monitor (300 msgs/day):** Visual dashboard gauge tracking sent, received, failed, and remaining capacity with 80% & 100% alert thresholds.
9. **Full 16-Stage Lead Lifecycle & 24-Field Order Management Drawer:** End-to-end tracking from initial ad click to final courier delivery.

---

## 2. Existing Repository Architecture vs. Gap Analysis

The existing `buildstart-selfhosted` codebase provides a solid foundation:
- **Database:** Supabase PostgreSQL with schema-isolated tenant `"Dakshila_Dilina"`.
- **Backend:** Deno Edge Functions in `supabase/functions/*-Dakshila_Dilina`.
- **Messaging:** WAHA (WhatsApp HTTP API) consuming webhooks and dispatching text/media/documents.
- **Frontend:** Vite + React + TypeScript + Tailwind CSS + Lucide Icons + Radix UI.

### Detailed Gap Matrix

| Area | Component | Current State | Required Modification (PRD & Blueprint) |
|---|---|---|---|
| **Database** | `products` table | Fields: `name, price, delivery_price, variations, images, video_url` | Add `category` (text) and `stock_quantity` (integer). |
| **Database** | `orders` table | Basic fields + COD/Bank Transfer check constraint | Add `normal_phone`, `payment_status`, `payment_slip_url`, `courier_status`, `courier_tracking_id`, `bill_pdf_url`, `lead_source`, `ad_id`, `campaign_id`, `customer_notes`, `custom_fields`. |
| **Database** | `leads` table | Only 5 statuses (`new, reached, follow_up, converted, lost`) | Expand to all **16 PRD statuses**. Add ad tracking (`ad_id, campaign_id, lead_source`) and follow-up counters (`followups_sent, max_followup_limit, next_followup_at`). |
| **Database** | Analytics RPC | Monthly contact RPC exists | Add `get_daily_message_stats(_user_id)` to track 300 daily messages limit (Sent, Received, Total, Remaining). |
| **Backend** | `webhook-wsender` | Captures text and message type, enqueues to `message_queue` | Extract `contextInfo.externalAdReply` (ad source, ad ID, campaign ID) and store in payload metadata for attribution. |
| **Backend** | `process-message` | **Lines 228–232 drop all media messages without reply** | Allow image messages to be processed when waiting for a payment slip; save slip to MinIO/Supabase Storage, link to order, update status to `verification_pending`. |
| **Backend** | `ai-chat` | Generic prompt, collects 1 phone number, standard order JSON | Update system prompt for Dilina Dakshina's categories (Magazines, Clothing), require size/color & dual contact collection, expand `<ORDER_JSON>`. Trigger human handoff when slip uploaded or requested. |
| **Backend** | `send-followups` | Single-step 24h follow-up | Multi-step engine supporting configurable sequences (up to max limit like 4), respecting 9 AM – 8 PM time windows and strict stop criteria. |
| **Backend** | `generate-invoice-pdf` | Not implemented | New edge function / server utility generating PDF bill on order confirmation and dispatching via `send-whatsapp` as document. |
| **Frontend** | `Products.tsx` | Basic variation editor, no category or stock inputs | Add category selector (Magazines, Clothing, etc.), stock level input, preset variations for sizes (S, M, L, XL, XXL) & magazine issues. |
| **Frontend** | `Orders.tsx` | Basic table and status dialog | Add **Payment Slips** tab with viewer, Approve/Reject buttons, Courier status management, retry buttons, and 24-field detail drawer. |
| **Frontend** | `Leads.tsx` | 5 statuses, basic table | Support all 16 statuses with badges, and add **PDF Lead Report Generator** with filters. |
| **Frontend** | `Dashboard.tsx` | Basic monthly cards | Add **Daily Message Capacity Gauge (300 limit)** and **Facebook & TikTok Ad Performance Tracking** widget. |
| **Frontend** | `Settings.tsx` | Inactivity hours toggle | Configurable follow-up message limits (max count, message templates, timing, stop criteria). |

---

## 3. Database Migration Plan (Zero Breaking Changes)

All migrations will be written in a new file `db/04_dilina_dakshina_customization.sql` targeting the `"Dakshila_Dilina"` schema:

```sql
-- 1. Extend products table
ALTER TABLE "Dakshila_Dilina".products
ADD COLUMN IF NOT EXISTS category text DEFAULT 'General',
ADD COLUMN IF NOT EXISTS stock_quantity integer DEFAULT 100;

-- 2. Extend orders table
ALTER TABLE "Dakshila_Dilina".orders
ADD COLUMN IF NOT EXISTS normal_phone text,
ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'payment_pending',
ADD COLUMN IF NOT EXISTS payment_slip_url text,
ADD COLUMN IF NOT EXISTS courier_status text DEFAULT 'courier_transfer_pending',
ADD COLUMN IF NOT EXISTS courier_tracking_id text,
ADD COLUMN IF NOT EXISTS bill_pdf_url text,
ADD COLUMN IF NOT EXISTS lead_source text DEFAULT 'direct',
ADD COLUMN IF NOT EXISTS ad_id text,
ADD COLUMN IF NOT EXISTS campaign_id text,
ADD COLUMN IF NOT EXISTS customer_notes text,
ADD COLUMN IF NOT EXISTS custom_fields jsonb DEFAULT '{}'::jsonb;

-- 3. Extend leads table
ALTER TABLE "Dakshila_Dilina".leads
ADD COLUMN IF NOT EXISTS normal_phone text,
ADD COLUMN IF NOT EXISTS delivery_address text,
ADD COLUMN IF NOT EXISTS lead_source text DEFAULT 'direct',
ADD COLUMN IF NOT EXISTS ad_id text,
ADD COLUMN IF NOT EXISTS ad_name text,
ADD COLUMN IF NOT EXISTS campaign_id text,
ADD COLUMN IF NOT EXISTS campaign_name text,
ADD COLUMN IF NOT EXISTS selected_product text,
ADD COLUMN IF NOT EXISTS followups_sent integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS max_followup_limit integer DEFAULT 4,
ADD COLUMN IF NOT EXISTS next_followup_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS followup_status text DEFAULT 'active',
ADD COLUMN IF NOT EXISTS custom_fields jsonb DEFAULT '{}'::jsonb;

-- 4. Daily message stats function for 300 limit
CREATE OR REPLACE FUNCTION "Dakshila_Dilina".get_daily_message_stats(_user_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
SELECT jsonb_build_object(
  'sent', COALESCE(COUNT(*) FILTER (WHERE direction = 'outbound'), 0),
  'received', COALESCE(COUNT(*) FILTER (WHERE direction = 'inbound'), 0),
  'total', COALESCE(COUNT(*), 0),
  'limit', 300,
  'remaining', GREATEST(0, 300 - COALESCE(COUNT(*), 0))
)
FROM "Dakshila_Dilina".conversations
WHERE user_id = _user_id
AND created_at >= date_trunc('day', now());
$$;
```

---

## 4. Backend & Edge Function Implementation Details

### 4.1. Ad Attribution Ingestion (`webhook-wsender-Dakshila_Dilina`)
- Inspect incoming WAHA webhook payloads for `contextInfo.externalAdReply`.
- Extract:
  - `lead_source`: `'facebook'` or `'tiktok'` (derived from URL or client parameters).
  - `ad_id`, `campaign_id`, `ad_title`.
- Upsert into `leads` table with initial status `'New Lead'` and store ad metadata in `conversations.metadata`.

### 4.2. Image & Payment Slip Pipeline (`process-message-Dakshila_Dilina`)
- Remove early return on `isMediaMessage` when the contact has an active or pending bank transfer order.
- Ingest image file via WAHA media download or MinIO/Supabase Storage bucket (`biz-<user_id>`).
- If image is identified as a payment slip:
  - Update `orders.payment_slip_url` and set `orders.payment_status = 'verification_pending'`.
  - Update `leads.status = 'Payment Verification Pending'`.
  - Trigger human takeover notification (`chat_takeovers`) so staff can inspect and verify.
  - Send acknowledgment message to customer: *"Thank you! We have received your payment slip. Our team will verify it shortly."*

### 4.3. Tailored AI Sales Agent (`ai-chat-Dakshila_Dilina`)
- **System Prompt Customization:**
  - Introduce business as specialist retailer for Magazines and Clothing.
  - Present categorized products:
    - **Magazines:** Display title, issue number, description, price, sample images.
    - **Clothing:** Display item name, available sizes (S, M, L, XL, XXL), available colors, price, stock status.
  - Prompt: *"Does the customer require any other product?"* to encourage cross-selling.
  - Mandatory collection of **Dual Contact Numbers**:
    - WhatsApp phone (from session)
    - Normal / alternate contact phone (validate 10 digits).
  - Delivery address & district.
  - Payment method prompt (Cash on Delivery vs. Bank Transfer).
- **Expanded `<ORDER_JSON>` Structure:**
  ```json
  {
    "customer_name": "...",
    "customer_phone": "...",
    "whatsapp_phone": "...",
    "normal_phone": "...",
    "customer_address": "...",
    "district": "...",
    "category": "Clothing",
    "order_items": [
      { "name": "...", "size": "M", "color": "Black", "quantity": 1, "price": 2500 }
    ],
    "payment_method": "cod",
    "payment_status": "cod",
    "total_amount": 2500,
    "lead_source": "facebook",
    "ad_id": "..."
  }
  ```
- **Order Confirmation & Bill Hook:**
  - When customer confirms summary, save order to DB.
  - Trigger background call to `generate-invoice-pdf`.
  - Transition lead status to `'Order Confirmed'` or `'Cash on Delivery'`.

### 4.4. Automated Invoice PDF Generation (`generate-invoice-pdf`)
- Edge function creating a standard, branded invoice PDF:
  - Business Name & Contact Details.
  - Order Reference Number & Date.
  - Customer Name, Delivery Address, WhatsApp & Normal phone numbers.
  - Itemized table: Product, Category, Size/Color, Qty, Unit Price, Total.
  - Payment Method (COD / Bank Transfer) & Payment Status.
- Uploads to storage bucket, updates `orders.bill_pdf_url`.
- Dispatches to customer using `send-whatsapp-Dakshila_Dilina` with `mediaType: "document"`.

### 4.5. Configurable Follow-Up Engine (`send-followups-Dakshila_Dilina`)
- Reads follow-up settings:
  - Max messages: configurable (e.g., 4).
  - Intervals (e.g., 2h, 12h, 24h, 48h).
  - Active time window: **9:00 AM – 8:00 PM** (prevent late-night spam).
- **Stop Conditions:**
  - Customer replies (inbound message received).
  - Order confirmed or payment slip submitted.
  - Customer expresses disinterest ("not interested", "stop", "cancel").
  - Conversation handed over to human staff (`chat_takeovers.is_taken_over = true`).
  - Max limit reached (`followups_sent >= max_followup_limit`).

---

## 5. Frontend UI/UX Enhancements

### 5.1. Products Management (`Products.tsx` & `VariationEditor.tsx`)
- Add **Category** selector: Magazines, Clothing, Accessories, Other.
- Add **Stock Quantity** input field.
- Enhance `VariationEditor` with 1-click presets:
  - Clothing: Size presets (S, M, L, XL, XXL) & Color choices.
  - Magazines: Issue number / Publication Month presets.

### 5.2. Orders Management & Slip Verification (`Orders.tsx`)
- **Tabs:** "All Orders", "Pending Verification (Slips)", "Confirmed", "Courier Dispatch".
- **Payment Slip Viewer:** Thumbnail opens full-resolution modal.
  - **Approve Slip Button:** Updates status to `payment_verified`, generates/sends PDF invoice, marks ready for courier.
  - **Reject Slip Button:** Opens dialog to enter reason, sends courteous explanation to customer via WhatsApp, moves order back to `payment_pending`.
- **Courier Management:**
  - Courier status badges: `Pending`, `Transferred`, `Accepted`, `Out for Delivery`, `Delivered`, `Failed`.
  - "Retry Courier Transfer" action on failed transmissions.
  - "Export Courier Manifest" (CSV download matching courier format).
- **Comprehensive 24-Field Drawer (`OrderDetailDrawer.tsx`):**
  - Customer details (Name, WhatsApp, Normal phone, Address).
  - Ad attribution (Source, Campaign ID, Ad ID).
  - Product particulars (Category, Size, Color, Qty, Price).
  - Payment details (Method, Slip URL, Verification status).
  - Courier dispatch status & tracking numbers.
  - Downloadable Bill PDF link.

### 5.3. Leads Management & 16-Stage Lifecycle (`Leads.tsx`)
- Display all 16 PRD lead statuses:
  1. *New Lead*
  2. *Product Inquiry*
  3. *Customer Details Pending*
  4. *Order Summary Sent*
  5. *Follow-Up Pending*
  6. *Customer Interested*
  7. *Order Confirmed*
  8. *Payment Pending*
  9. *Payment Verification Pending*
  10. *Cash on Delivery*
  11. *Courier Transfer Pending*
  12. *Out for Delivery*
  13. *Delivered*
  14. *Completed*
  15. *Not Interested*
  16. *Cancelled*
- **Lead Contact & Address PDF Report Generator:**
  - Client-side or edge-generated PDF with filter dialog: Date range, Source (Facebook/TikTok), Product, Order status, Follow-up status.
  - Clean branded table ready for printing or management review.

### 5.4. Dashboard Analytics & Capacity Meter (`Dashboard.tsx`)
- **Daily Message Capacity Widget:**
  - Progress gauge showing Sent, Received, Total, and Remaining against the 300 msgs/day limit.
  - Warning alert banner when approaching 80% and 100%.
- **Advertisement Performance Tracking Widget:**
  - Metrics per Ad / Campaign (Facebook vs. TikTok):
    - Inquiries count
    - Interested customers count
    - Confirmed orders count
    - Conversion rate (%)
  - Highlights top-performing and low-performing ads.

### 5.5. Settings Configuration (`Settings.tsx`)
- **Follow-Up Automation Tab:**
  - Enable/disable toggle.
  - Maximum messages count (default: 4).
  - Message templates per step (1st reminder, 2nd reminder, etc.).
  - Sending schedule & time window.
- **Invoice & Business Profile Tab:**
  - Business name, contact numbers, address, and logo for PDF bills.
- **Bank Details Tab:**
  - Account numbers, bank names, branch info sent to customers choosing Bank Transfer.

---

## 6. Implementation Roadmap (Matching the 6-Day PRD Timeline)

| Phase | Duration | Scope & Deliverables |
|---|---|---|
| **Phase 1: DB & Ingestion** | Day 1 | Apply non-breaking SQL migration to `"Dakshila_Dilina"` schema. Update `webhook-wsender` for ad tracking. Update `process-message` for payment slip ingestion. |
| **Phase 2: AI Sales Agent** | Day 2 | Tailor `ai-chat` system prompt for Magazines & Clothing. Enforce dual-phone collection, size/color validation, and expanded `<ORDER_JSON>`. Automate human handoff triggers. |
| **Phase 3: Automation** | Day 3 | Implement `generate-invoice-pdf` with automatic WhatsApp document delivery. Implement multi-step follow-up engine (max 4, 9 AM – 8 PM window, stop conditions). Implement courier export format. |
| **Phase 4: Dashboard UI** | Day 4 | Build 24-field `OrderDetailDrawer`. Add Payment Slip verification tab in `Orders.tsx`. Add 16 lead status badges and Lead PDF export in `Leads.tsx`. Add 300 msgs/day capacity gauge & Ad analytics widgets to `Dashboard.tsx`. |
| **Phase 5: E2E Testing** | Day 5 | Complete flow verification: Welcome → Product selection → Details → COD & Bank Transfer slip upload → Staff verification → PDF Bill generation & WhatsApp dispatch → Courier status update → Multi-step follow-ups. |
| **Phase 6: Deployment** | Day 6 | Connect client's WhatsApp number via WAHA QR code. Configure 6–7 products and bank account details. Final client sign-off. |

---

## 7. Immediate Next Steps & Safety Assurance

- **Current Status:** Pure analysis and architectural planning. **No code or database modifications have been performed.**
- **Ready for Review:** Once this plan is reviewed and approved, we will proceed systematically step-by-step starting with Phase 1.
