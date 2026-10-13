import { format } from "date-fns";

export interface LeadReportItem {
  customer_name: string;
  whatsapp_phone: string;
  normal_phone: string;
  delivery_address: string;
  lead_source: string;
  selected_product: string;
  status: string;
  followup_status?: string;
  date: string;
}

export interface ReportFilterOptions {
  dateRange?: string;
  leadSource?: string;
  product?: string;
  status?: string;
  followupStatus?: string;
}

export async function generateLeadReportPDF(
  leads: LeadReportItem[],
  filters: ReportFilterOptions
) {
  openPrintableLeadReport(leads, filters);
  return true;
}

/**
 * Generates an executive, PRD §3.5-compliant landscape PDF Delivery Manifest & Lead Report
 */
export function openPrintableLeadReport(leads: LeadReportItem[], filters: ReportFilterOptions) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;

  const totalLeads = leads.length;
  const fbCount = leads.filter((l) => l.lead_source.toLowerCase().includes("facebook")).length;
  const tiktokCount = leads.filter((l) => l.lead_source.toLowerCase().includes("tiktok")).length;
  const confirmedCount = leads.filter((l) => l.status.toLowerCase().includes("confirmed") || l.status.toLowerCase().includes("delivery")).length;

  const rowsHtml = leads
    .map(
      (l, idx) => `
    <tr>
      <td style="text-align: center; color: #64748b; font-size: 10px;">${idx + 1}</td>
      <td><strong>${escapeHtml(l.customer_name)}</strong></td>
      <td style="font-family: monospace; font-size: 11px;">${escapeHtml(l.whatsapp_phone)}</td>
      <td style="font-family: monospace; font-size: 11px;">${escapeHtml(l.normal_phone || "-")}</td>
      <td>${escapeHtml(l.delivery_address || "Not provided")}</td>
      <td><span class="source source-${escapeHtml(l.lead_source.toLowerCase())}">${escapeHtml(l.lead_source.toUpperCase())}</span></td>
      <td><strong>${escapeHtml(l.selected_product || "General")}</strong></td>
      <td><span class="status-badge">${escapeHtml(l.status)}</span></td>
      <td>${escapeHtml(l.followup_status || "active")}</td>
      <td style="font-size: 10px; color: #64748b; white-space: nowrap;">${escapeHtml(l.date)}</td>
    </tr>
  `
    )
    .join("");

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Lead Contact & Delivery Address Report — ${format(new Date(), "yyyy-MM-dd")}</title>
        <style>
          @page {
            size: A4 landscape;
            margin: 12mm;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            margin: 0;
            padding: 16px;
            color: #0f172a;
            background: #fff;
          }
          .header-banner {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: 2px solid #1e3a8a;
            padding-bottom: 12px;
            margin-bottom: 14px;
          }
          .title {
            font-size: 20px;
            font-weight: 800;
            color: #1e3a8a;
            margin: 0 0 4px 0;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          .subtitle {
            font-size: 11px;
            color: #475569;
            margin: 0;
          }
          .stats-bar {
            display: flex;
            gap: 16px;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            padding: 8px 14px;
            margin-bottom: 14px;
            font-size: 11px;
          }
          .stat-item {
            display: flex;
            align-items: center;
            gap: 6px;
          }
          .stat-value {
            font-weight: 700;
            color: #1e3a8a;
          }
          .filter-chips {
            font-size: 10.5px;
            color: #334155;
            margin-bottom: 12px;
            background: #f1f5f9;
            padding: 6px 12px;
            border-radius: 4px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 10.5px;
            page-break-inside: auto;
          }
          tr {
            page-break-inside: avoid;
            page-break-after: auto;
          }
          th {
            background-color: #1e3a8a;
            color: #ffffff;
            text-align: left;
            padding: 7px 8px;
            font-weight: 600;
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.3px;
            border: 1px solid #1e3a8a;
          }
          td {
            padding: 6px 8px;
            border: 1px solid #e2e8f0;
            vertical-align: top;
          }
          tr:nth-child(even) {
            background-color: #f8fafc;
          }
          .source {
            font-weight: 700;
            font-size: 9px;
            padding: 2px 5px;
            border-radius: 3px;
            display: inline-block;
          }
          .source-facebook {
            background: #dbeafe;
            color: #1e40af;
          }
          .source-tiktok {
            background: #fce7f3;
            color: #9d174d;
          }
          .source-direct {
            background: #dcfce7;
            color: #166534;
          }
          .status-badge {
            background: #f1f5f9;
            padding: 2px 5px;
            border-radius: 3px;
            font-size: 9.5px;
            font-weight: 600;
            color: #334155;
          }
          .action-bar {
            margin-bottom: 12px;
            display: flex;
            gap: 10px;
          }
          .btn {
            background: #1e3a8a;
            color: white;
            border: none;
            padding: 7px 14px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
          }
          .btn-secondary {
            background: #e2e8f0;
            color: #0f172a;
          }
          @media print {
            .no-print {
              display: none !important;
            }
            body {
              padding: 0;
            }
          }
        </style>
      </head>
      <body>
        <div class="no-print action-bar">
          <button class="btn" onclick="window.print()">
            🖨️ Print / Save as PDF Document
          </button>
          <button class="btn btn-secondary" onclick="window.close()">
            Close Window
          </button>
        </div>

        <div class="header-banner">
          <div>
            <h1 class="title">Lead Contact & Delivery Address Report</h1>
            <p class="subtitle">Mr. Dilina Dakshila — Magazines & Clothing Retail Management System</p>
          </div>
          <div style="text-align: right; font-size: 11px; color: #475569;">
            <div><strong>Report Date:</strong> ${format(new Date(), "yyyy-MM-dd HH:mm")}</div>
            <div><strong>Document Type:</strong> Customer Contact & Delivery Manifest</div>
          </div>
        </div>

        <div class="filter-chips">
          <strong>Applied Filter Parameters:</strong> 
          Source: <u>${escapeHtml(filters.leadSource || "All Sources")}</u> | 
          Product: <u>${escapeHtml(filters.product || "All Products")}</u> | 
          Order Status: <u>${escapeHtml(filters.status || "All Statuses")}</u> | 
          Follow-up: <u>${escapeHtml(filters.followupStatus || "All")}</u> | 
          Date Range: <u>${escapeHtml(filters.dateRange || "All Recorded Time")}</u>
        </div>

        <div class="stats-bar">
          <div class="stat-item"><span>Total Filtered Leads:</span> <span class="stat-value">${totalLeads}</span></div>
          <div class="stat-item"><span>Facebook Leads:</span> <span class="stat-value">${fbCount}</span></div>
          <div class="stat-item"><span>TikTok Leads:</span> <span class="stat-value">${tiktokCount}</span></div>
          <div class="stat-item"><span>Confirmed / In-Delivery:</span> <span class="stat-value">${confirmedCount}</span></div>
        </div>

        <table>
          <thead>
            <tr>
              <th style="width: 25px; text-align: center;">#</th>
              <th>Lead / Customer Name</th>
              <th>WhatsApp Number</th>
              <th>Normal Contact</th>
              <th>Delivery Address</th>
              <th>Source</th>
              <th>Selected Product</th>
              <th>Order / Lead Status</th>
              <th>Follow-Up</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || `<tr><td colspan="10" style="text-align: center; padding: 20px; color: #64748b;">No leads match the selected filter criteria.</td></tr>`}
          </tbody>
        </table>

        <div style="margin-top: 18px; font-size: 9.5px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 8px;">
          Generated automatically by BuildStart Sales Agent Platform for Mr. Dilina Dakshila • Official Store Logistics Document
        </div>

        <script>
          // Automatically prompt print dialog when window opens
          window.onload = function() {
            setTimeout(function() {
              window.print();
            }, 400);
          };
        </script>
      </body>
    </html>
  `;

  printWindow.document.write(html);
  printWindow.document.close();
}

export interface AdReportCampaignItem {
  id: string;
  name: string;
  campaignId?: string;
  platform: string;
  inquiries: number;
  orders: number;
  conversionRate: number;
  revenue: number;
  status?: string;
}

export interface AdReportSummary {
  totalInquiries: number;
  fbInquiries: number;
  tiktokInquiries: number;
  directInquiries: number;
  totalOrders: number;
  totalRevenue: number;
  overallConversionRate: number;
}

/**
 * Generates an executive, printable PDF Report for Facebook & TikTok Advertisement Performance
 */
export function openPrintableAdPerformanceReport(
  campaigns: AdReportCampaignItem[],
  summary: AdReportSummary,
  platformFilter?: string
) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;

  const rowsHtml = campaigns
    .map(
      (c, idx) => `
    <tr>
      <td style="text-align: center; color: #64748b; font-size: 10px;">${idx + 1}</td>
      <td>
        <span class="source source-${escapeHtml(c.platform.toLowerCase())}">
          ${escapeHtml(c.platform.toUpperCase())}
        </span>
      </td>
      <td><strong>${escapeHtml(c.name)}</strong></td>
      <td style="font-family: monospace; font-size: 10px; color: #475569;">${escapeHtml(c.id || "N/A")}</td>
      <td style="font-family: monospace; font-size: 10px; color: #475569;">${escapeHtml(c.campaignId || "N/A")}</td>
      <td style="text-align: right; font-weight: 700; color: #1e3a8a;">${c.inquiries}</td>
      <td style="text-align: right; font-weight: 700; color: #16a34a;">${c.orders}</td>
      <td style="text-align: right;">
        <span class="conv-badge ${c.conversionRate >= 15 ? "conv-high" : c.conversionRate > 0 ? "conv-mid" : "conv-low"}">
          ${c.conversionRate}%
        </span>
      </td>
      <td style="text-align: right; font-weight: 700; font-family: monospace;">LKR ${c.revenue.toLocaleString()}</td>
      <td style="text-align: center;">
        <span class="status-badge ${c.status === "Top Performing" ? "status-top" : c.status === "Underperforming" ? "status-low" : ""}">
          ${escapeHtml(c.status || "Active")}
        </span>
      </td>
    </tr>
  `
    )
    .join("");

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Ad Performance & ROI Analytics Report — ${format(new Date(), "yyyy-MM-dd")}</title>
        <style>
          @page {
            size: A4 landscape;
            margin: 12mm;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            margin: 0;
            padding: 16px;
            color: #0f172a;
            background: #fff;
          }
          .header-banner {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: 2px solid #6366f1;
            padding-bottom: 12px;
            margin-bottom: 14px;
          }
          .title {
            font-size: 20px;
            font-weight: 800;
            color: #312e81;
            margin: 0 0 4px 0;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          .subtitle {
            font-size: 11px;
            color: #475569;
            margin: 0;
          }
          .stats-bar {
            display: grid;
            grid-template-columns: repeat(6, 1fr);
            gap: 10px;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            padding: 10px 14px;
            margin-bottom: 14px;
            font-size: 11px;
          }
          .stat-item {
            display: flex;
            flex-direction: column;
            gap: 2px;
          }
          .stat-label {
            font-size: 10px;
            color: #64748b;
            text-transform: uppercase;
            font-weight: 600;
          }
          .stat-value {
            font-size: 14px;
            font-weight: 800;
            color: #1e293b;
          }
          .stat-value.primary { color: #4338ca; }
          .stat-value.success { color: #16a34a; }
          .stat-value.fb { color: #2563eb; }
          .stat-value.tiktok { color: #7c3aed; }
          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 10.5px;
            page-break-inside: auto;
          }
          tr {
            page-break-inside: avoid;
            page-break-after: auto;
          }
          th {
            background-color: #312e81;
            color: #ffffff;
            text-align: left;
            padding: 8px 8px;
            font-weight: 600;
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.3px;
            border: 1px solid #312e81;
          }
          td {
            padding: 7px 8px;
            border: 1px solid #e2e8f0;
            vertical-align: middle;
          }
          tr:nth-child(even) td {
            background-color: #f8fafc;
          }
          .source {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 9px;
            font-weight: 700;
            letter-spacing: 0.3px;
          }
          .source-facebook {
            background: #dbeafe;
            color: #1d4ed8;
            border: 1px solid #bfdbfe;
          }
          .source-tiktok {
            background: #ede9fe;
            color: #6d28d9;
            border: 1px solid #ddd6fe;
          }
          .source-direct {
            background: #f1f5f9;
            color: #475569;
            border: 1px solid #e2e8f0;
          }
          .conv-badge {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 10px;
            font-weight: 700;
          }
          .conv-high {
            background: #dcfce7;
            color: #15803d;
          }
          .conv-mid {
            background: #e0e7ff;
            color: #4338ca;
          }
          .conv-low {
            background: #fef3c7;
            color: #b45309;
          }
          .status-badge {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 9px;
            font-weight: 600;
            background: #f1f5f9;
            color: #475569;
          }
          .status-top {
            background: #dcfce7;
            color: #15803d;
            border: 1px solid #bbf7d0;
          }
          .status-low {
            background: #ffedd5;
            color: #c2410c;
            border: 1px solid #fed7aa;
          }
          .action-bar {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            margin-bottom: 12px;
          }
          .btn {
            background: #4338ca;
            color: #fff;
            border: none;
            padding: 8px 14px;
            border-radius: 6px;
            font-weight: 600;
            font-size: 11px;
            cursor: pointer;
          }
          .btn-secondary {
            background: #e2e8f0;
            color: #0f172a;
          }
          @media print {
            .no-print {
              display: none !important;
            }
            body {
              padding: 0;
            }
          }
        </style>
      </head>
      <body>
        <div class="no-print action-bar">
          <button class="btn" onclick="window.print()">
            🖨️ Print / Save as PDF Document
          </button>
          <button class="btn btn-secondary" onclick="window.close()">
            Close Window
          </button>
        </div>

        <div class="header-banner">
          <div>
            <h1 class="title">Advertisement & Campaign Performance Report</h1>
            <p class="subtitle">Dakshila & Dilina Store — Facebook, TikTok & WhatsApp ROI Analytics</p>
          </div>
          <div style="text-align: right; font-size: 11px; color: #475569;">
            <div><strong>Report Date:</strong> ${format(new Date(), "yyyy-MM-dd HH:mm")}</div>
            <div><strong>Filter:</strong> ${escapeHtml(platformFilter || "All Platforms")}</div>
          </div>
        </div>

        <div class="stats-bar">
          <div class="stat-item">
            <span class="stat-label">Total Contacts</span>
            <span class="stat-value primary">${summary.totalInquiries}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Facebook Contacts</span>
            <span class="stat-value fb">${summary.fbInquiries}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">TikTok Contacts</span>
            <span class="stat-value tiktok">${summary.tiktokInquiries}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Confirmed Orders</span>
            <span class="stat-value success">${summary.totalOrders}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Conversion Rate</span>
            <span class="stat-value">${summary.overallConversionRate}%</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Total Revenue</span>
            <span class="stat-value success">LKR ${summary.totalRevenue.toLocaleString()}</span>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th style="width: 25px; text-align: center;">#</th>
              <th style="width: 75px;">Platform</th>
              <th>Campaign / Ad Name</th>
              <th style="width: 100px;">Ad ID</th>
              <th style="width: 100px;">Campaign ID</th>
              <th style="text-align: right; width: 65px;">Contacts</th>
              <th style="text-align: right; width: 60px;">Orders</th>
              <th style="text-align: right; width: 75px;">Conv. Rate</th>
              <th style="text-align: right; width: 95px;">Revenue</th>
              <th style="text-align: center; width: 90px;">Performance</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || `<tr><td colspan="10" style="text-align: center; padding: 20px; color: #64748b;">No campaigns found matching criteria.</td></tr>`}
          </tbody>
        </table>

        <div style="margin-top: 18px; font-size: 9.5px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 8px;">
          Generated automatically by Sales Management Platform for Dakshila & Dilina Store • Official Performance Analytics Report
        </div>

        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
            }, 400);
          };
        </script>
      </body>
    </html>
  `;

  printWindow.document.write(html);
  printWindow.document.close();
}

function escapeHtml(text: string) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
