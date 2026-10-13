import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { useAuth } from "@/hooks/useAuth";
import { useEffectivePlan } from "@/hooks/useEffectivePlan";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { MessageSquare, Sparkles, Lock, Users, Search, FileText, Download, Clock, Megaphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { openPrintableLeadReport, LeadReportItem } from "@/lib/pdfReportGenerator";
import { format } from "date-fns";

export const LEAD_STATUSES = [
  { value: "New Lead", label: "New Lead" },
  { value: "Product Inquiry", label: "Product Inquiry" },
  { value: "Customer Details Pending", label: "Customer Details Pending" },
  { value: "Order Summary Sent", label: "Order Summary Sent" },
  { value: "Follow-Up Pending", label: "Follow-Up Pending" },
  { value: "Customer Interested", label: "Customer Interested" },
  { value: "Order Confirmed", label: "Order Confirmed" },
  { value: "Payment Pending", label: "Payment Pending" },
  { value: "Payment Verification Pending", label: "Payment Verification Pending" },
  { value: "Cash on Delivery", label: "Cash on Delivery" },
  { value: "Courier Transfer Pending", label: "Courier Transfer Pending" },
  { value: "Out for Delivery", label: "Out for Delivery" },
  { value: "Delivered", label: "Delivered" },
  { value: "Completed", label: "Completed" },
  { value: "Not Interested", label: "Not Interested" },
  { value: "Cancelled", label: "Cancelled" },
];

const UNASSIGNED = "__unassigned__";
const ALL = "__all__";

interface StaffOption {
  staff_user_id: string;
  staff_name: string | null;
  staff_email: string;
  whatsapp_number?: string | null;
}

interface LeadRow {
  id: string | null;
  phone_number: string;
  customer_name: string;
  normal_phone?: string | null;
  delivery_address?: string | null;
  lead_source?: string | null;
  ad_name?: string | null;
  ad_id?: string | null;
  campaign_id?: string | null;
  selected_product?: string | null;
  assigned_to: string | null;
  status: string;
  inbound_count: number;
  has_order: boolean;
  last_time: string | null;
  followups_sent?: number;
  max_followup_limit?: number;
  next_followup_at?: string | null;
  followup_status?: string | null;
}

export default function Leads() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { effectiveUserId, isStaff, isGrowth, loading: planLoading } = useEffectivePlan();

  const [rows, setRows] = useState<LeadRow[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoAssign, setAutoAssign] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStaff, setFilterStaff] = useState<string>(ALL);
  const [filterStatus, setFilterStatus] = useState<string>(ALL);
  const [filterSource, setFilterSource] = useState<string>(ALL);
  const [filterProduct, setFilterProduct] = useState<string>(ALL);
  const [filterFollowup, setFilterFollowup] = useState<string>(ALL);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [qualifiedOnly, setQualifiedOnly] = useState(false);

  const isOwner = !isStaff;

  const load = useCallback(async () => {
    if (!effectiveUserId || !isGrowth) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [convRes, orderRes, leadRes, staffRes, settingRes] = await Promise.all([
        supabase
          .from("conversations")
          .select("phone_number, direction, metadata, created_at")
          .eq("user_id", effectiveUserId)
          .order("created_at", { ascending: false }),
        supabase
          .from("orders")
          .select("customer_phone, whatsapp_phone")
          .eq("user_id", effectiveUserId),
        supabase
          .from("leads" as any)
          .select("id, phone_number, customer_name, normal_phone, delivery_address, lead_source, ad_name, ad_id, campaign_id, selected_product, assigned_to, status, followups_sent, max_followup_limit, next_followup_at, followup_status")
          .eq("user_id", effectiveUserId),
        supabase
          .from("staff_accounts")
          .select("staff_user_id, staff_name, staff_email, whatsapp_number")
          .eq("owner_id", effectiveUserId)
          .eq("is_active", true),
        supabase
          .from("settings")
          .select("value")
          .eq("user_id", effectiveUserId)
          .eq("key", "leads_auto_assign")
          .maybeSingle(),
      ]);

      const staffList = (staffRes.data || []) as StaffOption[];
      setStaff(staffList);
      setAutoAssign(Boolean((settingRes.data?.value as any)?.enabled));

      const orderPhones = new Set<string>();
      (orderRes.data || []).forEach((o: any) => {
        if (o.customer_phone) orderPhones.add(String(o.customer_phone));
        if (o.whatsapp_phone) orderPhones.add(String(o.whatsapp_phone));
      });

      const stats = new Map<
        string,
        { inbound: number; name: string; last: string }
      >();
      (convRes.data || []).forEach((m: any) => {
        const entry = stats.get(m.phone_number) || {
          inbound: 0,
          name: "",
          last: m.created_at,
        };
        if (m.direction === "inbound") {
          entry.inbound += 1;
          if (!entry.name) entry.name = (m.metadata as any)?.senderName || "";
        }
        if (m.created_at > entry.last) entry.last = m.created_at;
        stats.set(m.phone_number, entry);
      });

      const leadMap = new Map<string, any>();
      ((leadRes.data as any[]) || []).forEach((l) => leadMap.set(l.phone_number, l));

      // Owners create missing lead records so staff can be assigned
      if (isOwner) {
        const missing = Array.from(stats.entries())
          .filter(([phone]) => !leadMap.has(phone))
          .map(([phone, s]) => ({
            user_id: effectiveUserId,
            phone_number: phone,
            customer_name: s.name || null,
          }));
        if (missing.length > 0) {
          const { data: inserted } = await (supabase.from("leads" as any) as any)
            .upsert(missing, { onConflict: "user_id,phone_number" })
            .select("id, phone_number, customer_name, normal_phone, delivery_address, lead_source, selected_product, assigned_to, status");
          ((inserted as any[]) || []).forEach((l) => leadMap.set(l.phone_number, l));
        }
      }

      const phones = isOwner
        ? Array.from(new Set([...stats.keys(), ...leadMap.keys()]))
        : Array.from(leadMap.keys());

      const built: LeadRow[] = phones.map((phone) => {
        const s = stats.get(phone);
        const l = leadMap.get(phone);
        return {
          id: l?.id ?? null,
          phone_number: phone,
          customer_name: l?.customer_name || s?.name || "Unknown",
          normal_phone: l?.normal_phone || null,
          delivery_address: l?.delivery_address || null,
          lead_source: l?.lead_source || "direct",
          ad_name: l?.ad_name || null,
          ad_id: l?.ad_id || null,
          campaign_id: l?.campaign_id || null,
          selected_product: l?.selected_product || null,
          assigned_to: l?.assigned_to ?? null,
          status: l?.status || "New Lead",
          inbound_count: s?.inbound || 0,
          has_order: orderPhones.has(phone),
          last_time: s?.last || null,
          followups_sent: l?.followups_sent || 0,
          max_followup_limit: l?.max_followup_limit || 4,
          next_followup_at: l?.next_followup_at || null,
          followup_status: l?.followup_status || "active",
        };
      });

      built.sort((a, b) => (b.last_time || "").localeCompare(a.last_time || ""));
      setRows(built);
    } catch (err: any) {
      toast({ title: "Error loading leads", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [effectiveUserId, isGrowth, isOwner, toast]);

  useEffect(() => {
    if (!planLoading) load();
  }, [planLoading, load]);

  // Auto-assign unassigned leads in round-robin order (owner side)
  useEffect(() => {
    if (!isOwner || !autoAssign || loading || staff.length === 0) return;
    const unassigned = rows.filter((r) => !r.assigned_to && r.id);
    if (unassigned.length === 0) return;

    const counts = new Map<string, number>();
    staff.forEach((s) => counts.set(s.staff_user_id, 0));
    rows.forEach((r) => {
      if (r.assigned_to && counts.has(r.assigned_to)) {
        counts.set(r.assigned_to, (counts.get(r.assigned_to) || 0) + 1);
      }
    });

    (async () => {
      const updates: { id: string; staffId: string }[] = [];
      for (const lead of unassigned) {
        let target = staff[0].staff_user_id;
        let min = Infinity;
        for (const s of staff) {
          const c = counts.get(s.staff_user_id) || 0;
          if (c < min) {
            min = c;
            target = s.staff_user_id;
          }
        }
        counts.set(target, (counts.get(target) || 0) + 1);
        updates.push({ id: lead.id as string, staffId: target });
      }
      await Promise.all(
        updates.map((u) =>
          (supabase.from("leads" as any) as any)
            .update({ assigned_to: u.staffId })
            .eq("id", u.id)
        )
      );
      updates.forEach((u) => {
        const lead = rows.find((r) => r.id === u.id);
        if (lead) notifyStaffAssignment(u.staffId, lead);
      });
      setRows((prev) =>
        prev.map((r) => {
          const u = updates.find((x) => x.id === r.id);
          return u ? { ...r, assigned_to: u.staffId } : r;
        })
      );
    })();
  }, [autoAssign, rows, staff, isOwner, loading]);

  const toggleAutoAssign = async (checked: boolean) => {
    if (!effectiveUserId) return;
    setAutoAssign(checked);
    const { error } = await supabase
      .from("settings")
      .upsert(
        { user_id: effectiveUserId, key: "leads_auto_assign", value: { enabled: checked } },
        { onConflict: "user_id,key" }
      );
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: checked ? "Auto-assign enabled" : "Auto-assign disabled" });
  };

  // Notify the staff member on WhatsApp that a customer was assigned to them
  const notifyStaffAssignment = async (staffUserId: string, row: LeadRow) => {
    try {
      const member = staff.find((s) => s.staff_user_id === staffUserId);
      const number = member?.whatsapp_number?.trim();
      if (!number || !effectiveUserId) return;

      const { data: sessionData } = await supabase
        .from("user_wsender_sessions" as any)
        .select("session_api_key, session_id")
        .eq("user_id", effectiveUserId)
        .limit(1)
        .maybeSingle();

      const displayPhone = String(row.phone_number || "").split("@")[0];
      const message = `👤 NEW CUSTOMER ASSIGNED\n\nName: ${row.customer_name || "Unknown"}\nContact: ${displayPhone}\n\nPlease follow up with this customer.`;

      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-whatsapp-Dakshila_Dilina`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: number,
          message,
          sessionApiKey:
            (sessionData as any)?.session_api_key || (sessionData as any)?.session_id,
        }),
      });
    } catch (e) {
      console.error("Staff assignment notification failed", e);
    }
  };

  const updateLead = async (row: LeadRow, patch: Record<string, any>) => {
    if (!row.id) return;
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...patch } : r)));
    const { error } = await (supabase.from("leads" as any) as any)
      .update(patch)
      .eq("id", row.id);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      load();
      return;
    }
    if (
      Object.prototype.hasOwnProperty.call(patch, "assigned_to") &&
      patch.assigned_to &&
      patch.assigned_to !== row.assigned_to
    ) {
      notifyStaffAssignment(patch.assigned_to, { ...row, ...patch });
    }
  };

  const staffName = (id: string | null) => {
    if (!id) return "Unassigned";
    const s = staff.find((x) => x.staff_user_id === id);
    return s?.staff_name || s?.staff_email || "Staff";
  };

  const isQualified = (r: LeadRow) => r.inbound_count >= 6 || r.has_order;

  const visibleRows = useMemo(() => {
    let list = rows;
    if (isStaff && user) list = list.filter((r) => r.assigned_to === user.id);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.phone_number.toLowerCase().includes(q) ||
          r.customer_name.toLowerCase().includes(q)
      );
    }
    if (isOwner) {
      if (filterStaff !== ALL) {
        list = list.filter((r) =>
          filterStaff === UNASSIGNED ? !r.assigned_to : r.assigned_to === filterStaff
        );
      }
      if (filterStatus !== ALL) list = list.filter((r) => r.status === filterStatus);
      if (filterSource !== ALL) {
        list = list.filter((r) => (r.lead_source || "direct").toLowerCase() === filterSource.toLowerCase());
      }
      if (filterProduct !== ALL) {
        list = list.filter((r) => (r.selected_product || "").toLowerCase().includes(filterProduct.toLowerCase()));
      }
      if (filterFollowup !== ALL) {
        list = list.filter((r) => (r.followup_status || "active").toLowerCase() === filterFollowup.toLowerCase());
      }
      if (dateFrom) {
        list = list.filter((r) => r.last_time && r.last_time.slice(0, 10) >= dateFrom);
      }
      if (dateTo) {
        list = list.filter((r) => r.last_time && r.last_time.slice(0, 10) <= dateTo);
      }
      if (qualifiedOnly) list = list.filter(isQualified);
    }
    return list;
  }, [rows, isStaff, user, search, isOwner, filterStaff, filterStatus, filterSource, filterProduct, filterFollowup, dateFrom, dateTo, qualifiedOnly]);

  const uniqueProducts = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => {
      if (r.selected_product) {
        r.selected_product.split(",").forEach((p) => {
          const trimmed = p.trim();
          if (trimmed) set.add(trimmed);
        });
      }
    });
    return Array.from(set);
  }, [rows]);

  const handleExportPdfReport = () => {
    if (visibleRows.length === 0) {
      toast({ title: "No leads match the filter to export", variant: "destructive" });
      return;
    }
    const reportData: LeadReportItem[] = visibleRows.map((r) => ({
      customer_name: r.customer_name,
      whatsapp_phone: r.phone_number,
      normal_phone: r.normal_phone || r.phone_number,
      delivery_address: r.delivery_address || "Not provided",
      lead_source: r.lead_source || "direct",
      selected_product: r.selected_product || "General Inquiry",
      status: r.status,
      followup_status: r.followup_status || "active",
      date: r.last_time ? format(new Date(r.last_time), "yyyy-MM-dd") : "N/A",
    }));

    const dateRangeLabel = dateFrom && dateTo
      ? `${dateFrom} to ${dateTo}`
      : dateFrom
      ? `From ${dateFrom}`
      : dateTo
      ? `Up to ${dateTo}`
      : "All Recorded Time";

    openPrintableLeadReport(reportData, {
      leadSource: filterSource !== ALL ? filterSource : "All Sources",
      product: filterProduct !== ALL ? filterProduct : "All Products",
      status: filterStatus !== ALL ? filterStatus : "All Statuses",
      followupStatus: filterFollowup !== ALL ? filterFollowup : "All Follow-up States",
      dateRange: dateRangeLabel,
    });
    toast({ title: "Lead Contact & Address Report opened for printing / PDF download" });
  };

  if (planLoading) {
    return (
      <DashboardLayout>
        <p className="text-muted-foreground">Loading...</p>
      </DashboardLayout>
    );
  }

  if (!isGrowth) {
    return (
      <DashboardLayout>
        <div className="max-w-xl mx-auto mt-10">
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-2">
                <Lock className="h-6 w-6 text-muted-foreground" />
              </div>
              <CardTitle>Leads is a Growth plan feature</CardTitle>
              <CardDescription>
                Upgrade to the Growth plan to track customers, assign leads to your staff and
                follow up on qualified buyers.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-center">
              <Button onClick={() => navigate("/dashboard/settings")}>View plan details</Button>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Leads</h1>
            <p className="text-muted-foreground text-sm">
              {isStaff
                ? "Leads assigned to you"
                : "Customers who have chatted with your WhatsApp bot"}
            </p>
          </div>
          {isOwner && (
            <div className="flex items-center gap-2 rounded-lg border p-3">
              <Switch
                id="auto-assign"
                checked={autoAssign}
                onCheckedChange={toggleAutoAssign}
                disabled={staff.length === 0}
              />
              <Label htmlFor="auto-assign" className="text-sm cursor-pointer">
                Assign automatically
              </Label>
            </div>
          )}
        </div>

        {/* PRD §3.5 Multi-Filter Controls */}
        <div className="flex flex-wrap gap-2 items-center bg-card p-3 rounded-lg border">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search name, phone, or address"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          {isOwner && (
            <>
              <Select value={filterSource} onValueChange={setFilterSource}>
                <SelectTrigger className="w-[140px] h-9">
                  <SelectValue placeholder="All Sources" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All Sources</SelectItem>
                  <SelectItem value="facebook">Facebook Leads</SelectItem>
                  <SelectItem value="tiktok">TikTok Leads</SelectItem>
                  <SelectItem value="direct">Direct WhatsApp</SelectItem>
                </SelectContent>
              </Select>

              {uniqueProducts.length > 0 && (
                <Select value={filterProduct} onValueChange={setFilterProduct}>
                  <SelectTrigger className="w-[140px] h-9">
                    <SelectValue placeholder="All Products" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All Products</SelectItem>
                    {uniqueProducts.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-[150px] h-9">
                  <SelectValue placeholder="Order / Lead Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All Statuses</SelectItem>
                  {LEAD_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={filterFollowup} onValueChange={setFilterFollowup}>
                <SelectTrigger className="w-[145px] h-9">
                  <SelectValue placeholder="Follow-Up Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All Follow-ups</SelectItem>
                  <SelectItem value="active">Active (Pending)</SelectItem>
                  <SelectItem value="stopped_ordered">Ordered (Stopped)</SelectItem>
                  <SelectItem value="stopped_replied">Replied (Stopped)</SelectItem>
                  <SelectItem value="stopped_staff_handoff">Staff Handoff</SelectItem>
                  <SelectItem value="stopped_opted_out">Opted Out</SelectItem>
                </SelectContent>
              </Select>

              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>From:</span>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-[130px] h-9 text-xs"
                />
                <span>To:</span>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-[130px] h-9 text-xs"
                />
              </div>

              {(dateFrom || dateTo || filterSource !== ALL || filterStatus !== ALL || filterProduct !== ALL || filterFollowup !== ALL) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 text-xs"
                  onClick={() => {
                    setFilterSource(ALL);
                    setFilterStatus(ALL);
                    setFilterProduct(ALL);
                    setFilterFollowup(ALL);
                    setDateFrom("");
                    setDateTo("");
                  }}
                >
                  Clear Filters
                </Button>
              )}

              <Button
                variant="default"
                onClick={handleExportPdfReport}
                disabled={visibleRows.length === 0}
                className="gap-1.5 h-9 bg-primary hover:bg-primary/90 ml-auto"
              >
                <FileText className="h-4 w-4" />
                Download PDF Report
              </Button>
            </>
          )}
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Users className="h-5 w-5" />
              {visibleRows.length} lead{visibleRows.length === 1 ? "" : "s"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-muted-foreground">Loading...</p>
            ) : visibleRows.length === 0 ? (
              <p className="text-muted-foreground">No leads to show yet.</p>
            ) : (
              <div className="space-y-3">
                {visibleRows.map((row) => {
                  const qualified = isQualified(row);
                  return (
                    <div
                      key={row.phone_number}
                      className={cn(
                        "flex flex-col lg:flex-row lg:items-center gap-3 p-3 rounded-lg border",
                        qualified && "border-primary/50 bg-primary/5"
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium truncate">{row.customer_name}</p>
                          {row.lead_source && (
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px] uppercase font-semibold",
                                (row.lead_source || "").toLowerCase().includes("facebook") && "bg-blue-500/10 text-blue-600 border-blue-500/30",
                                (row.lead_source || "").toLowerCase().includes("tiktok") && "bg-purple-500/10 text-purple-600 border-purple-500/30"
                              )}
                            >
                              {row.lead_source}
                            </Badge>
                          )}
                          {row.ad_name && (
                            <span className="text-[10px] text-muted-foreground font-medium inline-flex items-center gap-1 bg-muted/60 px-2 py-0.5 rounded border">
                              <Megaphone className="h-3 w-3 text-primary shrink-0" />
                              <span className="truncate max-w-[220px]" title={row.ad_name}>{row.ad_name}</span>
                              {row.ad_id && <span className="opacity-75 font-mono">({row.ad_id})</span>}
                            </span>
                          )}
                          {qualified && (
                            <Badge className="text-[10px]">
                              <Sparkles className="h-3 w-3 mr-1" />
                              Qualified
                            </Badge>
                          )}
                          {row.has_order && (
                            <Badge variant="secondary" className="text-[10px]">
                              Ordered
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          WA: {row.phone_number} {row.normal_phone ? `· Alt: ${row.normal_phone}` : ""} · {row.inbound_count} message
                          {row.inbound_count === 1 ? "" : "s"}
                        </p>
                        {row.delivery_address && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            📍 {row.delivery_address}
                          </p>
                        )}
                        {/* PRD §3.7 Follow-up Automation Status */}
                        <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground flex-wrap">
                          <span className="inline-flex items-center gap-1 font-mono text-[11px] bg-muted/60 px-2 py-0.5 rounded border">
                            <Clock className="h-3 w-3 text-primary" />
                            Follow-ups: {row.followups_sent || 0} / {row.max_followup_limit || 4}
                          </span>
                          {row.next_followup_at && row.followup_status === "active" && (
                            <span className="text-[11px] text-primary font-medium">
                              Next: {format(new Date(row.next_followup_at), "dd MMM, hh:mm a")}
                            </span>
                          )}
                          {row.followup_status && row.followup_status !== "active" && (
                            <Badge variant="outline" className={cn(
                              "text-[10px] capitalize",
                              row.followup_status === "completed" && "bg-slate-100 text-slate-700",
                              row.followup_status === "stopped_replied" && "bg-emerald-50 text-emerald-700 border-emerald-200",
                              row.followup_status === "stopped_ordered" && "bg-green-50 text-green-700 border-green-200",
                              row.followup_status === "stopped_opted_out" && "bg-red-50 text-red-700 border-red-200"
                            )}>
                              {row.followup_status.replace("stopped_", "Stopped: ")}
                            </Badge>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {isOwner ? (
                          <Select
                            value={row.assigned_to || UNASSIGNED}
                            onValueChange={(v) =>
                              updateLead(row, { assigned_to: v === UNASSIGNED ? null : v })
                            }
                          >
                            <SelectTrigger className="w-[170px]">
                              <SelectValue placeholder="Assign to" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                              {staff.map((s) => (
                                <SelectItem key={s.staff_user_id} value={s.staff_user_id}>
                                  {s.staff_name || s.staff_email}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge variant="outline">{staffName(row.assigned_to)}</Badge>
                        )}

                        <Select
                          value={row.status}
                          onValueChange={(v) => updateLead(row, { status: v })}
                        >
                          <SelectTrigger className="w-[140px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {LEAD_STATUSES.map((s) => (
                              <SelectItem key={s.value} value={s.value}>
                                {s.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            navigate(
                              `/dashboard/conversations?phone=${encodeURIComponent(
                                row.phone_number
                              )}`
                            )
                          }
                        >
                          <MessageSquare className="h-4 w-4 mr-2" />
                          Chat
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
