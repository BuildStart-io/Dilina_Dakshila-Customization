import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { planLabel } from "@/lib/planLabels";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Package,
  HelpCircle,
  ShoppingCart,
  Users,
  TrendingUp,
  Clock,
  CalendarDays,
  PauseCircle,
  MessageSquare,
  AlertTriangle,
  Award,
  Share2,
  Truck,
  CheckCircle2,
  ArrowRight,
  TrendingDown,
  DollarSign,
  Megaphone,
  Download,
  Filter,
} from "lucide-react";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import LimitWarningBanner from "@/components/LimitWarningBanner";
import { openPrintableAdPerformanceReport } from "@/lib/pdfReportGenerator";
import { cn } from "@/lib/utils";

interface Stats {
  pendingOrders: number;
  recentOrders: any[];
}

interface DailyCapacity {
  contacts: number;
  sentMessages: number;
  receivedMessages: number;
  totalMessages: number;
  limit: number;
  remaining: number;
}

interface AdStat {
  source: string;
  inquiries: number;
  orders: number;
  revenue: number;
  conversionRate: number;
}

interface CampaignAdStat {
  id: string;
  name: string;
  campaignId: string;
  platform: string;
  inquiries: number;
  orders: number;
  revenue: number;
  conversionRate: number;
  isTop?: boolean;
  isUnderperforming?: boolean;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { limits, usage, planTier, billing, loading: limitsLoading } = usePlanLimits();
  const [stats, setStats] = useState<Stats>({ pendingOrders: 0, recentOrders: [] });
  const [dailyCapacity, setDailyCapacity] = useState<DailyCapacity>({
    contacts: 0,
    sentMessages: 0,
    receivedMessages: 0,
    totalMessages: 0,
    limit: 300,
    remaining: 300,
  });
  const [adStats, setAdStats] = useState<AdStat[]>([]);
  const [campaignAds, setCampaignAds] = useState<CampaignAdStat[]>([]);
  const [selectedAdPlatform, setSelectedAdPlatform] = useState<string>("all");
  const [humanRequestsCount, setHumanRequestsCount] = useState<number>(0);
  const [orderPipeline, setOrderPipeline] = useState({
    total: 0,
    pending: 0,
    confirmed: 0,
    dispatched: 0,
    delivered: 0,
    totalCodPending: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const [pendingRes, recentRes, todayConvsRes, allLeadsRes, allOrdersRes] =
          await Promise.all([
            supabase
              .from("orders")
              .select("id", { count: "exact", head: true })
              .eq("status", "pending"),
            supabase
              .from("orders")
              .select("*")
              .order("created_at", { ascending: false })
              .limit(5),
            supabase
              .from("conversations")
              .select("direction, phone_number")
              .gte("created_at", todayStart.toISOString()),
            supabase
              .from("leads" as any)
              .select("id, phone_number, lead_source, ad_name, ad_id, campaign_id, campaign_name, human_assistance_requested"),
            supabase
              .from("orders")
              .select("id, lead_source, ad_id, campaign_id, total_amount, customer_phone, created_at, status, payment_method, courier_status"),
          ]);

        const recentOrders = recentRes.data || [];
        setStats({
          pendingOrders: pendingRes.count || 0,
          recentOrders,
        });

        const leads = (allLeadsRes.data as any[]) || [];
        const orders = allOrdersRes.data || [];

        // Track Human Assistance Requests count
        const staffRequests = leads.filter((l) => l.human_assistance_requested).length;
        setHumanRequestsCount(staffRequests);

        // 1. Calculate Daily Contact Capacity (300 Contacts/Day Test Limit per PRD)
        const convs = todayConvsRes.data || [];
        const sentCount = convs.filter((c: any) => c.direction === "outbound").length;
        const receivedCount = convs.filter((c: any) => c.direction === "inbound").length;
        const totalMessages = sentCount + receivedCount;

        // Unique customer contacts that interacted today
        const uniquePhones = new Set<string>();
        convs.forEach((c: any) => {
          if (c.phone_number) uniquePhones.add(c.phone_number);
        });
        orders.forEach((o: any) => {
          const createdAt = o.created_at ? new Date(o.created_at) : null;
          if (createdAt && createdAt >= todayStart && o.customer_phone) {
            uniquePhones.add(o.customer_phone);
          }
        });
        const contactsCount = Math.max(uniquePhones.size, convs.length > 0 ? 1 : 0);
        const limitCount = 300;

        setDailyCapacity({
          contacts: contactsCount,
          sentMessages: sentCount,
          receivedMessages: receivedCount,
          totalMessages: totalMessages,
          limit: limitCount,
          remaining: Math.max(0, limitCount - contactsCount),
        });

        // Map phone numbers to lead's attribution so orders inherit the ad info
        const leadPhoneMap = new Map<string, any>();
        leads.forEach((l) => {
          if (l.phone_number) leadPhoneMap.set(l.phone_number, l);
        });

        // 2. Calculate Order Pipeline & COD Lifecycle
        const confirmedOrders = orders.filter(
          (o) => o.status === "confirmed" || o.status === "completed" || o.status === "processing" || o.status === "shipped"
        ).length;
        const dispatchedOrders = orders.filter(
          (o) => o.status === "shipped" || o.courier_status === "Courier Accepted" || o.courier_status === "data_transferred" || o.courier_status === "out_for_delivery"
        ).length;
        const deliveredOrders = orders.filter((o) => o.courier_status === "delivered" || o.status === "delivered").length;
        const codPending = orders
          .filter((o) => (o.payment_method || "").toLowerCase() === "cod" && o.courier_status !== "delivered")
          .reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);

        setOrderPipeline({
          total: orders.length,
          pending: pendingRes.count || 0,
          confirmed: confirmedOrders,
          dispatched: dispatchedOrders,
          delivered: deliveredOrders,
          totalCodPending: codPending,
        });

        // 3. Calculate Platform Ad Performance (Facebook vs TikTok)
        const sources = ["facebook", "tiktok", "direct"];
        const metrics: AdStat[] = sources.map((src) => {
          const rawLeads = leads.filter(
            (l) => (l.lead_source || "direct").toLowerCase() === src
          ).length;
          const srcOrders = orders.filter((o) => {
            const leadAttr = leadPhoneMap.get(o.customer_phone);
            const ordSrc = (o.lead_source || leadAttr?.lead_source || "direct").toLowerCase();
            return ordSrc === src;
          });
          const revenue = srcOrders.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
          const ordersCount = srcOrders.length;
          const totalInquiries = Math.max(rawLeads, ordersCount);
          const convRate = totalInquiries > 0 ? (ordersCount / totalInquiries) * 100 : 0;

          return {
            source: src === "facebook" ? "Facebook Ads" : src === "tiktok" ? "TikTok Ads" : "Direct WhatsApp",
            inquiries: totalInquiries,
            orders: ordersCount,
            revenue,
            conversionRate: parseFloat(convRate.toFixed(1)),
          };
        });
        setAdStats(metrics);

        // 4. Calculate Specific Ad / Campaign Performance
        const adMap = new Map<
          string,
          {
            id: string;
            name: string;
            campaignId: string;
            platform: string;
            inquiries: number;
            orders: number;
            revenue: number;
          }
        >();

        leads.forEach((l) => {
          const platform =
            (l.lead_source || "").toLowerCase() === "facebook"
              ? "Facebook"
              : (l.lead_source || "").toLowerCase() === "tiktok"
              ? "TikTok"
              : "Direct";

          const name =
            l.ad_name ||
            (platform === "Facebook"
              ? "Facebook General Ad"
              : platform === "TikTok"
              ? "TikTok Video Ad"
              : "WhatsApp Direct Inquiries");

          const adId = l.ad_id || "N/A";
          const campaignId = l.campaign_id || l.campaign_name || "N/A";
          const adKey = `${platform}__${name}__${adId}__${campaignId}`;

          if (!adMap.has(adKey)) {
            adMap.set(adKey, {
              id: adId,
              name,
              campaignId,
              platform,
              inquiries: 0,
              orders: 0,
              revenue: 0,
            });
          }
          adMap.get(adKey)!.inquiries += 1;
        });

        orders.forEach((o) => {
          const leadAttr = leadPhoneMap.get(o.customer_phone);
          const platform =
            (o.lead_source || leadAttr?.lead_source || "").toLowerCase() === "facebook"
              ? "Facebook"
              : (o.lead_source || leadAttr?.lead_source || "").toLowerCase() === "tiktok"
              ? "TikTok"
              : "Direct";

          const name =
            o.ad_name ||
            leadAttr?.ad_name ||
            (platform === "Facebook"
              ? "Facebook General Ad"
              : platform === "TikTok"
              ? "TikTok Video Ad"
              : "WhatsApp Direct Inquiries");

          const adId = o.ad_id || leadAttr?.ad_id || "N/A";
          const campaignId = o.campaign_id || leadAttr?.campaign_id || leadAttr?.campaign_name || "N/A";
          const adKey = `${platform}__${name}__${adId}__${campaignId}`;

          if (!adMap.has(adKey)) {
            adMap.set(adKey, {
              id: adId,
              name,
              campaignId,
              platform,
              inquiries: 1,
              orders: 0,
              revenue: 0,
            });
          }
          adMap.get(adKey)!.orders += 1;
          adMap.get(adKey)!.revenue += Number(o.total_amount) || 0;
        });

        const campaigns: CampaignAdStat[] = Array.from(adMap.values()).map((c) => {
          const conv = c.inquiries > 0 ? (c.orders / c.inquiries) * 100 : 0;
          return {
            ...c,
            conversionRate: parseFloat(conv.toFixed(1)),
          };
        });

        // Sort by orders descending then conversion rate then inquiries
        campaigns.sort((a, b) => b.orders - a.orders || b.conversionRate - a.conversionRate || b.inquiries - a.inquiries);
        if (campaigns.length > 0 && campaigns[0].orders > 0) {
          campaigns[0].isTop = true;
        }
        // Identify lowest / underperforming ad (inquiries >= 1 and zero orders)
        const under = [...campaigns].reverse().find((c) => c.inquiries >= 1 && c.orders === 0 && !c.isTop);
        if (under) {
          under.isUnderperforming = true;
        }

        setCampaignAds(campaigns);
      } catch (error) {
        console.error("Error fetching dashboard stats:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, []);

  const isReady = !loading && !limitsLoading && usage && limits;
  const capacityPct = Math.min((dailyCapacity.contacts / dailyCapacity.limit) * 100, 100);
  const isCapacityNear = capacityPct >= 80;
  const isCapacityFull = capacityPct >= 100;

  const usageCards = isReady
    ? [
        {
          title: "Products",
          used: usage.products,
          max: limits.max_products,
          icon: Package,
        },
        {
          title: "FAQs",
          used: usage.faqs,
          max: limits.max_faqs,
          icon: HelpCircle,
        },
        {
          title: "Orders (This Month)",
          used: usage.orders_this_month,
          max: limits.max_orders_per_month,
          icon: ShoppingCart,
        },
        {
          title: "Contacts (This Month)",
          used: usage.contacts_this_month,
          max: limits.contacts_per_month,
          icon: Users,
        },
      ]
    : [];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Pause Warning */}
        {billing.is_paused && <LimitWarningBanner type="products" />}

        {/* Human Assistance Alert Banner */}
        {humanRequestsCount > 0 && (
          <Card className="border-amber-400 bg-amber-50 dark:bg-amber-950/20 border-2">
            <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between py-3 px-4 gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-500/20 rounded-full shrink-0">
                  <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <CardTitle className="text-sm sm:text-base font-bold text-amber-900 dark:text-amber-100 flex items-center gap-2">
                    Human Attention Requested
                    <Badge className="bg-amber-600 text-white text-xs">{humanRequestsCount} Customer{humanRequestsCount > 1 ? "s" : ""}</Badge>
                  </CardTitle>
                  <CardDescription className="text-xs text-amber-700 dark:text-amber-300">
                    Customers in Conversations requested assistance from store staff. The AI bot remains active.
                  </CardDescription>
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => navigate("/dashboard/conversations")}
                className="bg-amber-600 hover:bg-amber-700 text-white text-xs gap-1.5 self-start sm:self-auto"
              >
                <MessageSquare className="h-4 w-4" /> View Pending Chats
              </Button>
            </CardHeader>
          </Card>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Dashboard</h1>
            <p className="text-muted-foreground text-sm sm:text-base">
              WhatsApp Sales Support Operations & Performance Overview
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isReady && billing.next_cycle_date && (
              <Badge variant="outline" className="text-xs flex items-center gap-1">
                <CalendarDays className="h-3 w-3" />
                Next cycle: {new Date(billing.next_cycle_date).toLocaleDateString()}
              </Badge>
            )}
            {isReady && billing.is_paused && (
              <Badge variant="destructive" className="flex items-center gap-1">
                <PauseCircle className="h-3 w-3" />
                Paused
              </Badge>
            )}
            {isReady && <Badge variant="outline" className="text-sm">{planLabel(planTier)} Plan</Badge>}
          </div>
        </div>

        {/* Daily Contact Capacity (300 Contacts / Day Test Limit per PRD) */}
        <Card className={`border-2 ${isCapacityFull ? "border-destructive bg-destructive/5" : isCapacityNear ? "border-amber-500 bg-amber-50/30 dark:bg-amber-950/20" : "border-primary/20"}`}>
          <CardHeader className="pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                Daily Contact Capacity Monitor (300 Contacts / Day Limit)
                {isCapacityFull && (
                  <Badge variant="destructive" className="animate-pulse">Limit Reached</Badge>
                )}
                {isCapacityNear && !isCapacityFull && (
                  <Badge className="bg-amber-600 hover:bg-amber-700">80% Threshold Reached</Badge>
                )}
              </CardTitle>
              <CardDescription>
                Test capacity tracking unique customer contacts handled today (with message volume breakdown)
              </CardDescription>
            </div>
            <div className="text-sm font-semibold">
              <span className="text-2xl font-bold">{dailyCapacity.contacts}</span> / {dailyCapacity.limit} Contacts
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress
              value={capacityPct}
              className={`h-3 ${isCapacityFull ? "[&>div]:bg-destructive" : isCapacityNear ? "[&>div]:bg-amber-500" : "[&>div]:bg-primary"}`}
            />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div className="p-2.5 rounded-lg bg-background border">
                <p className="text-xs text-muted-foreground">Unique Contacts Today</p>
                <p className="text-lg font-bold text-primary mt-0.5">{dailyCapacity.contacts}</p>
              </div>
              <div className="p-2.5 rounded-lg bg-background border">
                <p className="text-xs text-muted-foreground">Messages Exchanged</p>
                <p className="text-lg font-bold text-emerald-600 mt-0.5">{dailyCapacity.totalMessages} msgs</p>
                <p className="text-[10px] text-muted-foreground">Out: {dailyCapacity.sentMessages} · In: {dailyCapacity.receivedMessages}</p>
              </div>
              <div className="p-2.5 rounded-lg bg-background border">
                <p className="text-xs text-muted-foreground">Remaining Contact Slots</p>
                <p className={`text-lg font-bold mt-0.5 ${dailyCapacity.remaining < 50 ? "text-destructive" : "text-primary"}`}>
                  {dailyCapacity.remaining} contacts
                </p>
              </div>
              <div className="p-2.5 rounded-lg bg-background border">
                <p className="text-xs text-muted-foreground">Daily Test Capacity</p>
                <p className="text-lg font-bold mt-0.5">300 Contacts</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* PRD §3.4 & §3.9: Order Lifecycle Pipeline & COD Status */}
        <Card className="border">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                <Truck className="h-5 w-5 text-primary" />
                Order Tracking & Courier Delivery Pipeline
              </CardTitle>
              <CardDescription>
                Track live order stages, courier transfers, and Cash on Delivery (COD) collection
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => navigate("/dashboard/orders")} className="text-xs gap-1">
              View All Orders <ArrowRight className="h-3 w-3" />
            </Button>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div className="p-3 rounded-lg border bg-muted/20">
                <p className="text-xs text-muted-foreground">Total Orders</p>
                <p className="text-xl font-bold mt-1">{orderPipeline.total}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">All time orders</p>
              </div>
              <div className="p-3 rounded-lg border bg-amber-50/50 dark:bg-amber-950/20 border-amber-200">
                <p className="text-xs text-amber-800 dark:text-amber-200 font-medium">Pending Processing</p>
                <p className="text-xl font-bold text-amber-700 mt-1">{orderPipeline.pending}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Awaiting dispatch</p>
              </div>
              <div className="p-3 rounded-lg border bg-blue-50/50 dark:bg-blue-950/20 border-blue-200">
                <p className="text-xs text-blue-800 dark:text-blue-200 font-medium">Confirmed</p>
                <p className="text-xl font-bold text-blue-700 mt-1">{orderPipeline.confirmed}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Order verified</p>
              </div>
              <div className="p-3 rounded-lg border bg-purple-50/50 dark:bg-purple-950/20 border-purple-200">
                <p className="text-xs text-purple-800 dark:text-purple-200 font-medium">Courier Dispatched</p>
                <p className="text-xl font-bold text-purple-700 mt-1">{orderPipeline.dispatched}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">In courier transit</p>
              </div>
              <div className="p-3 rounded-lg border bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 col-span-2 sm:col-span-1">
                <p className="text-xs text-emerald-800 dark:text-emerald-200 font-medium">Delivered</p>
                <p className="text-xl font-bold text-emerald-700 mt-1">{orderPipeline.delivered}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Successfully handed over</p>
              </div>
            </div>

            <div className="mt-4 p-3 bg-muted/30 border rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-emerald-600" />
                <span className="font-semibold text-foreground">Cash on Delivery (COD) Pending Courier Collection:</span>
              </div>
              <div className="font-bold text-sm text-emerald-600">
                LKR {orderPipeline.totalCodPending.toLocaleString()}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Facebook & TikTok Advertisement Performance Tracking */}
        <Card className="border">
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                  <Share2 className="h-5 w-5 text-indigo-600" />
                  Advertisement & Campaign Performance
                </CardTitle>
                <CardDescription>
                  Track contact inquiries, confirmed orders, and conversion rates across Facebook & TikTok advertising campaigns
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const summary = {
                    totalInquiries: campaignAds.reduce((acc, c) => acc + c.inquiries, 0),
                    fbInquiries: campaignAds.filter((c) => c.platform === "Facebook").reduce((acc, c) => acc + c.inquiries, 0),
                    tiktokInquiries: campaignAds.filter((c) => c.platform === "TikTok").reduce((acc, c) => acc + c.inquiries, 0),
                    directInquiries: campaignAds.filter((c) => c.platform === "Direct").reduce((acc, c) => acc + c.inquiries, 0),
                    totalOrders: campaignAds.reduce((acc, c) => acc + c.orders, 0),
                    totalRevenue: campaignAds.reduce((acc, c) => acc + c.revenue, 0),
                    overallConversionRate:
                      campaignAds.reduce((acc, c) => acc + c.inquiries, 0) > 0
                        ? parseFloat(
                            (
                              (campaignAds.reduce((acc, c) => acc + c.orders, 0) /
                                campaignAds.reduce((acc, c) => acc + c.inquiries, 0)) *
                              100
                            ).toFixed(1)
                          )
                        : 0,
                  };

                  const filtered =
                    selectedAdPlatform === "all"
                      ? campaignAds
                      : campaignAds.filter((c) => c.platform.toLowerCase() === selectedAdPlatform.toLowerCase());

                  openPrintableAdPerformanceReport(
                    filtered.map((c) => ({
                      ...c,
                      status: c.isTop ? "Top Performing" : c.isUnderperforming ? "Underperforming" : "Active",
                    })),
                    summary,
                    selectedAdPlatform === "facebook"
                      ? "Facebook Ads"
                      : selectedAdPlatform === "tiktok"
                      ? "TikTok Ads"
                      : selectedAdPlatform === "direct"
                      ? "Direct WhatsApp"
                      : "All Platforms"
                  );
                }}
                className="gap-2 shrink-0 border-indigo-200 hover:bg-indigo-50 dark:border-indigo-800 dark:hover:bg-indigo-950/30"
              >
                <Download className="h-4 w-4 text-indigo-600" />
                Download Ad Report (PDF)
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Channel Comparison Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {adStats.map((ad, idx) => {
                const isTop = idx === 0 && ad.orders > 0;
                return (
                  <div
                    key={ad.source}
                    className={`p-4 rounded-xl border relative space-y-3 ${
                      isTop
                        ? "bg-indigo-50/40 dark:bg-indigo-950/20 border-indigo-300 dark:border-indigo-800"
                        : "bg-card"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-base">{ad.source}</span>
                        {isTop && (
                          <Badge className="bg-amber-500 hover:bg-amber-600 gap-1 text-[10px] py-0">
                            <Award className="h-3 w-3" /> Top Channel
                          </Badge>
                        )}
                      </div>
                      <Badge variant="outline" className="font-mono text-xs">
                        {ad.conversionRate}% Conv.
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="p-2 rounded bg-muted/30">
                        <p className="text-muted-foreground">Inquiries / Leads</p>
                        <p className="text-base font-bold mt-0.5">{ad.inquiries}</p>
                      </div>
                      <div className="p-2 rounded bg-muted/30">
                        <p className="text-muted-foreground">Confirmed Orders</p>
                        <p className="text-base font-bold text-green-600 mt-0.5">{ad.orders}</p>
                      </div>
                    </div>

                    <div className="pt-2 border-t flex items-center justify-between text-xs text-muted-foreground">
                      <span>Total Revenue:</span>
                      <span className="font-bold text-foreground">
                        LKR {ad.revenue.toLocaleString()}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Campaign-Specific High / Low Conversion Analysis & Full Table */}
            <div className="space-y-4 pt-2 border-t">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-primary" />
                    Ad Campaign Breakdown & ROI Analysis
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Differentiated by platform with Contact Count, Orders, and Conversion Rate %
                  </p>
                </div>

                {/* Platform Filter Buttons */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant={selectedAdPlatform === "all" ? "default" : "outline"}
                    onClick={() => setSelectedAdPlatform("all")}
                    className="text-xs h-7 px-2.5"
                  >
                    All ({campaignAds.length})
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={selectedAdPlatform === "facebook" ? "default" : "outline"}
                    onClick={() => setSelectedAdPlatform("facebook")}
                    className={cn(
                      "text-xs h-7 px-2.5",
                      selectedAdPlatform !== "facebook" && "border-blue-500/30 text-blue-600 dark:text-blue-400"
                    )}
                  >
                    Facebook ({campaignAds.filter((c) => c.platform === "Facebook").length})
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={selectedAdPlatform === "tiktok" ? "default" : "outline"}
                    onClick={() => setSelectedAdPlatform("tiktok")}
                    className={cn(
                      "text-xs h-7 px-2.5",
                      selectedAdPlatform !== "tiktok" && "border-purple-500/30 text-purple-600 dark:text-purple-400"
                    )}
                  >
                    TikTok ({campaignAds.filter((c) => c.platform === "TikTok").length})
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={selectedAdPlatform === "direct" ? "default" : "outline"}
                    onClick={() => setSelectedAdPlatform("direct")}
                    className="text-xs h-7 px-2.5"
                  >
                    Direct ({campaignAds.filter((c) => c.platform === "Direct").length})
                  </Button>
                </div>
              </div>

              {/* Highlights for Top & Underperforming Ads */}
              {campaignAds.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {campaignAds.find((c) => c.isTop) && (
                    <div className="p-3 rounded-lg border bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-300 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Badge className="bg-emerald-600 text-white text-[10px] gap-1">
                          <Award className="h-3 w-3" /> Top Performing Ad
                        </Badge>
                        <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
                          {campaignAds.find((c) => c.isTop)!.conversionRate}% Conversion
                        </span>
                      </div>
                      <p className="font-bold text-sm text-foreground">
                        {campaignAds.find((c) => c.isTop)!.name}
                      </p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
                        <span>Platform: <strong>{campaignAds.find((c) => c.isTop)!.platform}</strong></span>
                        <span>Contacts: <strong>{campaignAds.find((c) => c.isTop)!.inquiries}</strong></span>
                        <span>Orders: <strong className="text-emerald-700 dark:text-emerald-400">{campaignAds.find((c) => c.isTop)!.orders}</strong></span>
                        <span>Revenue: <strong>LKR {campaignAds.find((c) => c.isTop)!.revenue.toLocaleString()}</strong></span>
                      </div>
                    </div>
                  )}

                  {campaignAds.find((c) => c.isUnderperforming) && (
                    <div className="p-3 rounded-lg border bg-amber-50/40 dark:bg-amber-950/20 border-amber-300 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Badge className="bg-amber-600 text-white text-[10px] gap-1">
                          <TrendingDown className="h-3 w-3" /> Underperforming Ad Warning
                        </Badge>
                        <span className="text-xs font-bold text-amber-700 dark:text-amber-400">
                          {campaignAds.find((c) => c.isUnderperforming)!.conversionRate}% Conversion
                        </span>
                      </div>
                      <p className="font-bold text-sm text-foreground">
                        {campaignAds.find((c) => c.isUnderperforming)!.name}
                      </p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
                        <span>Contacts: <strong>{campaignAds.find((c) => c.isUnderperforming)!.inquiries}</strong></span>
                        <span>Orders: <strong className="text-destructive">{campaignAds.find((c) => c.isUnderperforming)!.orders}</strong></span>
                        <span className="text-amber-800 dark:text-amber-400 text-[10px]">High contact inquiries with 0 orders</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Comprehensive Campaign Table */}
              {(() => {
                const filteredList =
                  selectedAdPlatform === "all"
                    ? campaignAds
                    : campaignAds.filter((c) => c.platform.toLowerCase() === selectedAdPlatform.toLowerCase());

                if (filteredList.length === 0) {
                  return (
                    <div className="p-8 text-center border rounded-lg bg-muted/10 text-muted-foreground text-sm">
                      No campaigns found for the selected filter.
                    </div>
                  );
                }

                return (
                  <div className="border rounded-lg overflow-hidden bg-card">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50 border-b">
                          <tr>
                            <th className="text-left font-semibold p-3">Platform</th>
                            <th className="text-left font-semibold p-3">Campaign / Ad Name</th>
                            <th className="text-left font-semibold p-3">Ad ID</th>
                            <th className="text-left font-semibold p-3">Campaign ID</th>
                            <th className="text-right font-semibold p-3">Contacts</th>
                            <th className="text-right font-semibold p-3">Orders</th>
                            <th className="text-right font-semibold p-3">Conv. Rate</th>
                            <th className="text-right font-semibold p-3">Revenue</th>
                            <th className="text-center font-semibold p-3">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {filteredList.map((c) => (
                            <tr key={`${c.platform}_${c.name}_${c.id}`} className="hover:bg-muted/20 transition-colors">
                              <td className="p-3">
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "text-[10px] uppercase font-bold",
                                    c.platform === "Facebook" && "bg-blue-500/10 text-blue-600 border-blue-500/30",
                                    c.platform === "TikTok" && "bg-purple-500/10 text-purple-600 border-purple-500/30",
                                    c.platform === "Direct" && "bg-slate-500/10 text-slate-600 border-slate-500/30"
                                  )}
                                >
                                  {c.platform}
                                </Badge>
                              </td>
                              <td className="p-3 font-semibold text-foreground min-w-[180px]">
                                <div className="flex items-center gap-1.5">
                                  <Megaphone className="h-3.5 w-3.5 text-primary shrink-0" />
                                  <span>{c.name}</span>
                                </div>
                              </td>
                              <td className="p-3 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                                {c.id !== "N/A" ? (
                                  <span className="bg-muted/60 px-1.5 py-0.5 rounded border">{c.id}</span>
                                ) : (
                                  <span className="opacity-40">-</span>
                                )}
                              </td>
                              <td className="p-3 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                                {c.campaignId !== "N/A" ? (
                                  <span className="bg-muted/60 px-1.5 py-0.5 rounded border">{c.campaignId}</span>
                                ) : (
                                  <span className="opacity-40">-</span>
                                )}
                              </td>
                              <td className="p-3 text-right font-bold text-foreground">
                                {c.inquiries}
                              </td>
                              <td className="p-3 text-right font-bold text-emerald-600">
                                {c.orders}
                              </td>
                              <td className="p-3 text-right">
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "font-bold text-[10px]",
                                    c.conversionRate >= 15 && "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
                                    c.conversionRate > 0 && c.conversionRate < 15 && "bg-blue-500/10 text-blue-600 border-blue-500/30",
                                    c.conversionRate === 0 && "bg-amber-500/10 text-amber-600 border-amber-500/30"
                                  )}
                                >
                                  {c.conversionRate}%
                                </Badge>
                              </td>
                              <td className="p-3 text-right font-mono font-bold whitespace-nowrap">
                                LKR {c.revenue.toLocaleString()}
                              </td>
                              <td className="p-3 text-center">
                                {c.isTop ? (
                                  <Badge className="bg-emerald-600 text-white text-[9px] py-0 gap-1">
                                    <Award className="h-2.5 w-2.5" /> Top Ad
                                  </Badge>
                                ) : c.isUnderperforming ? (
                                  <Badge className="bg-amber-600 text-white text-[9px] py-0 gap-1">
                                    <TrendingDown className="h-2.5 w-2.5" /> Low Conv.
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[9px] text-muted-foreground py-0">
                                    Active
                                  </Badge>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}
            </div>
          </CardContent>
        </Card>

        {/* Usage Cards with Limits */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {!isReady
            ? Array.from({ length: 4 }).map((_, i) => (
                <Card key={i}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Loading...</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">...</div>
                  </CardContent>
                </Card>
              ))
            : usageCards.map((card) => {
                const pct = card.max > 0 ? Math.min((card.used / card.max) * 100, 100) : 0;
                const isNearLimit = pct >= 80;
                const isAtLimit = pct >= 100;
                return (
                  <Card
                    key={card.title}
                    className={isAtLimit ? "border-destructive/50" : isNearLimit ? "border-yellow-500/50" : ""}
                  >
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
                      <card.icon className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="flex items-baseline justify-between">
                        <span className="text-2xl font-bold">{card.used}</span>
                        <span className="text-sm text-muted-foreground">/ {card.max}</span>
                      </div>
                      <Progress
                        value={pct}
                        className={`h-2 ${isAtLimit ? "[&>div]:bg-destructive" : isNearLimit ? "[&>div]:bg-yellow-500" : ""}`}
                      />
                      {isAtLimit && (
                        <p className="text-xs text-destructive font-medium">Limit reached</p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
        </div>

        {/* Recent Orders */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Recent Orders
              </CardTitle>
              <CardDescription>Latest orders from your WhatsApp customers</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard/orders")} className="text-xs">
              View All
            </Button>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-muted-foreground">Loading...</p>
            ) : stats.recentOrders.length === 0 ? (
              <p className="text-muted-foreground">
                No orders yet. Orders will appear here once customers start ordering via WhatsApp.
              </p>
            ) : (
              <div className="space-y-4">
                {stats.recentOrders.map((order) => (
                  <div
                    key={order.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-3 sm:p-4 rounded-lg border gap-2"
                  >
                    <div>
                      <p className="font-medium text-sm sm:text-base">{order.customer_name}</p>
                      <p className="text-xs sm:text-sm text-muted-foreground">
                        {order.customer_phone} · {order.payment_method === "cod" ? "COD" : "Bank Transfer"}
                      </p>
                    </div>
                    <div className="flex items-center justify-between sm:text-right gap-3">
                      <p className="font-medium text-sm sm:text-base">LKR {order.total_amount?.toLocaleString()}</p>
                      <span
                        className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                          order.status === "pending"
                            ? "bg-yellow-100 text-yellow-800"
                            : order.status === "confirmed"
                            ? "bg-green-100 text-green-800"
                            : order.status === "processing"
                            ? "bg-blue-100 text-blue-800"
                            : order.status === "delivered"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {order.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
