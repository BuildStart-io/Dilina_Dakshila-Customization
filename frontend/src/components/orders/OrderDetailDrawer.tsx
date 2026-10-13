import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Phone,
  MapPin,
  CreditCard,
  Package,
  Calendar,
  CheckCircle2,
  XCircle,
  Truck,
  Download,
  ExternalLink,
  MessageSquare,
  FileText,
  Clock,
  AlertCircle,
  Loader2,
  RefreshCw,
  Send,
} from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { openOrDownloadPdf } from "@/lib/pdfHelper";

function formatDateSafe(dateStr?: string | null, formatPattern = "PPpp") {
  if (!dateStr) return "N/A";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "N/A";
    return format(d, formatPattern);
  } catch {
    return "N/A";
  }
}

export interface OrderDetail {
  id: string;
  user_id?: string;
  customer_name: string;
  customer_phone: string;
  whatsapp_phone: string | null;
  normal_phone?: string | null;
  district: string | null;
  customer_address: string | null;
  order_items: any;
  special_instructions: string | null;
  payment_method: string;
  payment_status?: string | null;
  payment_slip_url?: string | null;
  status: string;
  total_amount: number;
  created_at: string;
  courier_status?: string | null;
  courier_tracking_id?: string | null;
  courier_dispatch_log?: any[];
  bill_pdf_url?: string | null;
  lead_source?: string | null;
  ad_id?: string | null;
  campaign_id?: string | null;
  customer_notes?: string | null;
}

interface OrderDetailDrawerProps {
  order: OrderDetail | null;
  isOpen: boolean;
  onClose: () => void;
  onVerifyPayment?: (orderId: string) => void;
  onRejectPayment?: (orderId: string) => void;
  onRetryCourier?: (orderId: string) => void;
  onOrderUpdated?: () => void;
}

export default function OrderDetailDrawer({
  order,
  isOpen,
  onClose,
  onVerifyPayment,
  onRejectPayment,
  onRetryCourier,
  onOrderUpdated,
}: OrderDetailDrawerProps) {
  if (!order) return null;

  const [isGenerating, setIsGenerating] = useState(false);
  const [isSendingWhatsApp, setIsSendingWhatsApp] = useState(false);
  const { toast } = useToast();

  const items = Array.isArray(order.order_items)
    ? order.order_items
    : typeof order.order_items === "string"
    ? (() => { try { return JSON.parse(order.order_items); } catch { return []; } })()
    : [];

  const dispatchLogs = Array.isArray(order.courier_dispatch_log)
    ? order.courier_dispatch_log
    : typeof order.courier_dispatch_log === "string"
    ? (() => { try { return JSON.parse(order.courier_dispatch_log); } catch { return []; } })()
    : [];

  const orderRef = order?.id ? `BS-ORD-${order.id.substring(0, 8).toUpperCase()}` : "BS-ORD-NEW";

  const handleGenerateOrViewInvoice = async (forceRegenerate = false) => {
    if (order.bill_pdf_url && !forceRegenerate) {
      openOrDownloadPdf(order.bill_pdf_url, `${orderRef}_Invoice.pdf`);
      return;
    }

    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-invoice-pdf-Dakshila_Dilina", {
        body: {
          orderId: order.id,
          userId: order.user_id,
        },
      });

      if (error) throw error;
      if (data?.pdfUrl) {
        toast({
          title: "Customer Bill PDF Ready!",
          description: `Official invoice generated for Order ${orderRef}.`,
        });
        order.bill_pdf_url = data.pdfUrl;
        if (onOrderUpdated) onOrderUpdated();
        openOrDownloadPdf(data.pdfUrl, `${orderRef}_Invoice.pdf`);
      } else {
        throw new Error(data?.error || "Failed to generate bill PDF");
      }
    } catch (err: any) {
      toast({
        title: "Invoice Generation Failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSendInvoiceViaWhatsApp = async () => {
    const customerPhone = order.whatsapp_phone || order.customer_phone;
    if (!customerPhone) {
      toast({
        title: "Customer Phone Missing",
        description: "No WhatsApp number or contact number found for this order.",
        variant: "destructive",
      });
      return;
    }

    setIsSendingWhatsApp(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-invoice-pdf-Dakshila_Dilina", {
        body: {
          orderId: order.id,
          userId: order.user_id,
        },
      });

      if (error) throw error;
      if (data?.success) {
        toast({
          title: "Bill Sent via WhatsApp!",
          description: `Invoice PDF document dispatched to ${customerPhone}.`,
        });
        if (data.pdfUrl) {
          order.bill_pdf_url = data.pdfUrl;
        }
        if (onOrderUpdated) onOrderUpdated();
      } else {
        throw new Error(data?.error || "Failed to dispatch bill via WhatsApp");
      }
    } catch (err: any) {
      toast({
        title: "WhatsApp Dispatch Failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsSendingWhatsApp(false);
    }
  };

  const getPaymentStatusBadge = (status?: string | null) => {
    switch (status) {
      case "payment_verified":
      case "verified":
        return <Badge className="bg-green-600 hover:bg-green-700">Verified</Badge>;
      case "verification_pending":
        return <Badge className="bg-amber-600 hover:bg-amber-700 animate-pulse">Verification Pending</Badge>;
      case "payment_rejected":
      case "rejected":
        return <Badge variant="destructive">Rejected</Badge>;
      case "cod":
        return <Badge className="bg-blue-600 hover:bg-blue-700">Cash on Delivery</Badge>;
      default:
        return <Badge variant="outline">Pending</Badge>;
    }
  };

  const getCourierStatusBadge = (status?: string | null) => {
    switch (status) {
      case "delivered":
        return <Badge className="bg-emerald-600">Delivered</Badge>;
      case "out_for_delivery":
        return <Badge className="bg-purple-600">Out for Delivery</Badge>;
      case "courier_accepted":
      case "data_transferred":
        return <Badge className="bg-sky-600">Transferred to Courier</Badge>;
      case "courier_transfer_failed":
      case "failed":
        return <Badge variant="destructive">Transfer Failed</Badge>;
      default:
        return <Badge variant="outline">Pending Dispatch</Badge>;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader className="border-b pb-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <DialogTitle className="text-xl font-bold flex items-center gap-2">
                Order {orderRef}
                {getPaymentStatusBadge(order.payment_status)}
              </DialogTitle>
              <DialogDescription>
                Placed on {formatDateSafe(order.created_at)}
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2">
              {order.bill_pdf_url ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300"
                  onClick={() => handleGenerateOrViewInvoice(false)}
                >
                  <FileText className="h-4 w-4" />
                  View Customer Bill PDF
                </Button>
              ) : (
                <Button
                  variant="default"
                  size="sm"
                  className="gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white"
                  onClick={() => handleGenerateOrViewInvoice(false)}
                  disabled={isGenerating}
                >
                  {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                  Generate Bill PDF
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          {/* Card 1: Customer & Contacts */}
          <Card>
            <CardHeader className="py-3 px-4 bg-muted/40">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Phone className="h-4 w-4 text-primary" />
                Customer Contact Details (Dual Phone)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Customer Name</p>
                <p className="font-semibold text-base">{order.customer_name}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Delivery Address</p>
                <p className="font-medium flex items-start gap-1 mt-0.5">
                  <MapPin className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                  <span>
                    {order.customer_address || "Not provided"}{" "}
                    {order.district ? `(${order.district} District)` : ""}
                  </span>
                </p>
              </div>
              <div className="p-2.5 rounded bg-muted/30 border">
                <p className="text-muted-foreground text-xs flex items-center gap-1">
                  <MessageSquare className="h-3.5 w-3.5 text-green-600" />
                  WhatsApp Number
                </p>
                <p className="font-mono font-medium text-sm mt-0.5">
                  {order.whatsapp_phone || order.customer_phone}
                </p>
              </div>
              <div className="p-2.5 rounded bg-muted/30 border">
                <p className="text-muted-foreground text-xs flex items-center gap-1">
                  <Phone className="h-3.5 w-3.5 text-blue-600" />
                  Normal / Alternate Contact
                </p>
                <p className="font-mono font-medium text-sm mt-0.5">
                  {order.normal_phone || order.customer_phone}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Card 2: Marketing & Ad Attribution */}
          <Card>
            <CardHeader className="py-3 px-4 bg-muted/40">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <ExternalLink className="h-4 w-4 text-primary" />
                Ad Campaign Attribution (FB / TikTok)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Acquisition Channel</p>
                <Badge variant="outline" className="capitalize mt-1 font-semibold">
                  {order.lead_source || "Direct WhatsApp"}
                </Badge>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Ad ID</p>
                <p className="font-mono text-xs mt-1 text-muted-foreground">
                  {order.ad_id || "N/A"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Campaign ID</p>
                <p className="font-mono text-xs mt-1 text-muted-foreground">
                  {order.campaign_id || "N/A"}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Card 3: Ordered Products */}
          <Card>
            <CardHeader className="py-3 px-4 bg-muted/40">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Package className="h-4 w-4 text-primary" />
                Order Items & Product Particulars
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              <div className="divide-y text-sm">
                {items.map((item: any, idx: number) => (
                  <div key={idx} className="py-2.5 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">{item.name}</p>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                        {item.size_color && (
                          <Badge variant="secondary" className="text-[10px] py-0 px-1.5">
                            {item.size_color}
                          </Badge>
                        )}
                        <span>Qty: {item.quantity || 1}</span>
                        <span>•</span>
                        <span>LKR {(item.price || 0).toLocaleString()} each</span>
                      </div>
                    </div>
                    <div className="font-semibold text-sm">
                      LKR {((item.quantity || 1) * (item.price || 0)).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-3 border-t flex items-center justify-between font-bold text-base">
                <span>Total Order Value</span>
                <span className="text-primary text-lg">
                  LKR {order.total_amount.toLocaleString()}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Card: Customer Order Summary & Invoice PDF */}
          <Card className="border-indigo-200 dark:border-indigo-900 shadow-sm bg-gradient-to-br from-indigo-50/20 via-background to-background">
            <CardHeader className="py-3 px-4 bg-indigo-50/60 dark:bg-indigo-950/40 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-indigo-950 dark:text-indigo-200">
                <FileText className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                Customer Order Summary & Invoice (Bill PDF)
              </CardTitle>
              {order.bill_pdf_url ? (
                <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  PDF Ready
                </Badge>
              ) : (
                <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 dark:bg-amber-950/40 text-[11px]">
                  Pending Generation
                </Badge>
              )}
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="p-2.5 rounded bg-muted/40 border">
                  <span className="text-muted-foreground block text-[11px]">Order Reference</span>
                  <span className="font-mono font-bold text-sm text-foreground mt-0.5 block">{orderRef}</span>
                </div>
                <div className="p-2.5 rounded bg-muted/40 border">
                  <span className="text-muted-foreground block text-[11px]">Payable Total</span>
                  <span className="font-bold text-sm text-indigo-700 dark:text-indigo-400 mt-0.5 block">
                    LKR {order.total_amount.toLocaleString()}
                  </span>
                </div>
                <div className="p-2.5 rounded bg-muted/40 border">
                  <span className="text-muted-foreground block text-[11px]">Customer WhatsApp</span>
                  <span className="font-mono font-medium text-xs text-foreground mt-0.5 block truncate">
                    {order.whatsapp_phone || order.customer_phone || "Not specified"}
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button
                  size="sm"
                  className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5"
                  onClick={() => handleGenerateOrViewInvoice(false)}
                  disabled={isGenerating}
                >
                  {isGenerating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <FileText className="h-4 w-4" />
                  )}
                  {order.bill_pdf_url ? "Open / Print Customer Invoice" : "Generate Official Bill PDF"}
                </Button>

                <Button
                  size="sm"
                  variant="outline"
                  className="border-green-300 text-green-700 hover:bg-green-50 dark:text-green-400 dark:border-green-800 dark:hover:bg-green-950/40 gap-1.5"
                  onClick={handleSendInvoiceViaWhatsApp}
                  disabled={isSendingWhatsApp || isGenerating}
                >
                  {isSendingWhatsApp ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <MessageSquare className="h-4 w-4" />
                  )}
                  Send PDF to Customer via WhatsApp
                </Button>

                {order.bill_pdf_url && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1 text-xs text-muted-foreground hover:text-foreground ml-auto"
                    onClick={() => handleGenerateOrViewInvoice(true)}
                    disabled={isGenerating}
                    title="Regenerate invoice with latest order items"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isGenerating ? "animate-spin" : ""}`} />
                    Regenerate
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Card 4: Payment & Slip Verification */}
          <Card>
            <CardHeader className="py-3 px-4 bg-muted/40">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-primary" />
                Payment Verification Workflow
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs text-muted-foreground">Payment Method</p>
                  <p className="font-medium uppercase text-sm">
                    {order.payment_method === "cod" ? "Cash on Delivery (COD)" : "Bank Transfer"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Payment Verification</p>
                  {getPaymentStatusBadge(order.payment_status)}
                </div>
              </div>

              {/* Payment Slip Image Preview */}
              {order.payment_slip_url && order.payment_slip_url !== "received_via_whatsapp" ? (
                <div className="rounded-lg border p-3 bg-muted/20 space-y-2">
                  <p className="text-xs font-semibold flex items-center gap-1.5">
                    <FileText className="h-4 w-4 text-primary" />
                    Uploaded Bank Transfer Slip:
                  </p>
                  <div className="relative group max-w-sm rounded overflow-hidden border">
                    <img
                      src={order.payment_slip_url}
                      alt="Bank Transfer Slip"
                      className="max-h-60 w-auto object-contain bg-black/5 rounded cursor-pointer hover:opacity-95"
                      onClick={() => window.open(order.payment_slip_url!, "_blank")}
                    />
                    <a
                      href={order.payment_slip_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="absolute bottom-2 right-2 bg-background/80 backdrop-blur px-2 py-1 rounded text-xs flex items-center gap-1 shadow"
                    >
                      <ExternalLink className="h-3 w-3" /> Full Size
                    </a>
                  </div>
                </div>
              ) : order.payment_method === "bank_transfer" ? (
                <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded text-xs text-amber-800 dark:text-amber-200 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  Bank transfer selected. Awaiting customer payment slip upload via WhatsApp.
                </div>
              ) : null}

              {/* Action buttons for Payment Slip Verification */}
              {order.payment_status === "verification_pending" && (
                <div className="flex items-center gap-3 pt-2">
                  <Button
                    onClick={() => onVerifyPayment && onVerifyPayment(order.id)}
                    className="bg-green-600 hover:bg-green-700 text-white gap-1.5"
                    size="sm"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Verify & Confirm Payment
                  </Button>
                  <Button
                    onClick={() => onRejectPayment && onRejectPayment(order.id)}
                    variant="destructive"
                    size="sm"
                    className="gap-1.5"
                  >
                    <XCircle className="h-4 w-4" />
                    Reject Slip
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Card 5: Courier Integration & Dispatch */}
          <Card>
            <CardHeader className="py-3 px-4 bg-muted/40">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Truck className="h-4 w-4 text-primary" />
                Courier Service Data Transfer & Tracking
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Courier Transfer Status</p>
                  <div className="mt-1">{getCourierStatusBadge(order.courier_status)}</div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Tracking ID / Waybill</p>
                  <p className="font-mono text-sm font-medium mt-1">
                    {order.courier_tracking_id || "Not generated yet"}
                  </p>
                </div>
              </div>

              {order.courier_status === "courier_transfer_failed" && (
                <div className="p-3 bg-destructive/10 border border-destructive/20 rounded flex items-center justify-between gap-3 text-xs text-destructive">
                  <span>Courier API transfer failed. Please retry or check settings.</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onRetryCourier && onRetryCourier(order.id)}
                  >
                    Retry API Dispatch
                  </Button>
                </div>
              )}

              <div className="pt-2 flex flex-wrap items-center gap-2">
                {order.courier_status !== "Courier Accepted" ? (
                  <Button
                    size="sm"
                    className="gap-1.5"
                    onClick={() => onRetryCourier && onRetryCourier(order.id)}
                  >
                    <Truck className="h-4 w-4" />
                    Dispatch to Courier API Now
                  </Button>
                ) : (
                  <div className="text-xs text-emerald-600 font-medium flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-950/30 p-2.5 rounded border border-emerald-200">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span>Parcel booked & tracking number registered with Courier service.</span>
                  </div>
                )}

                {order.bill_pdf_url && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-xs ml-auto"
                    onClick={() => openOrDownloadPdf(order.bill_pdf_url!, `${orderRef}_Invoice.pdf`)}
                  >
                    <FileText className="h-4 w-4 text-primary" />
                    View Bill PDF
                  </Button>
                )}
              </div>

              {/* Courier API HTTP Request / Response Audit Inspector */}
              <div className="mt-4 pt-4 border-t space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
                    <FileText className="h-4 w-4 text-primary" />
                    Courier API HTTP Transmission Audit:
                  </p>
                  {dispatchLogs.length > 0 && (
                    <Badge variant="outline" className="text-[10px]">
                      {dispatchLogs.length} Attempt{dispatchLogs.length > 1 ? "s" : ""} Logged
                    </Badge>
                  )}
                </div>

                {dispatchLogs.length > 0 ? (
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {dispatchLogs.map((log: any, idx: number) => {
                      const isOk = log.http_status === 200 || log.success;
                      return (
                        <div key={idx} className="rounded-md border p-2.5 bg-muted/30 text-xs space-y-1.5 font-mono">
                          <div className="flex items-center justify-between font-sans">
                            <div className="flex items-center gap-1.5">
                              <Badge className={isOk ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-destructive text-white"}>
                                {log.http_status ? `HTTP ${log.http_status}` : "FAILED"} {isOk ? "OK" : "DENIED"}
                              </Badge>
                              <span className="text-[11px] font-medium text-foreground truncate max-w-[200px]">
                                {log.provider || "Courier API"}
                              </span>
                            </div>
                            <span className="text-[10px] text-muted-foreground font-sans">
                              {log.timestamp ? formatDateSafe(log.timestamp, "MMM dd, HH:mm:ss") : ""}
                            </span>
                          </div>

                          <div className="text-[11px] text-muted-foreground break-all">
                            <span className="font-semibold text-foreground">Endpoint:</span> {log.endpoint_url}
                          </div>

                          {log.error_message && (
                            <div className="text-[11px] text-destructive bg-destructive/10 p-1.5 rounded">
                              <strong>Reason:</strong> {log.error_message}
                            </div>
                          )}

                          <details className="mt-1 pt-1 border-t text-[10px]">
                            <summary className="cursor-pointer text-primary font-sans hover:underline">
                              Inspect HTTP Request Payload & Server Response
                            </summary>
                            <div className="mt-2 space-y-2">
                              <div>
                                <p className="font-semibold text-foreground font-sans">Outbound Request JSON:</p>
                                <pre className="bg-black/10 dark:bg-black/40 p-2 rounded max-h-32 overflow-x-auto text-[10px] whitespace-pre-wrap">
                                  {JSON.stringify(log.request_payload, null, 2)}
                                </pre>
                              </div>
                              <div>
                                <p className="font-semibold text-foreground font-sans">Inbound Courier Response Body:</p>
                                <pre className="bg-black/10 dark:bg-black/40 p-2 rounded max-h-32 overflow-x-auto text-[10px] whitespace-pre-wrap">
                                  {typeof log.response_payload === "object"
                                    ? JSON.stringify(log.response_payload, null, 2)
                                    : String(log.response_payload)}
                                </pre>
                              </div>
                            </div>
                          </details>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="p-2.5 bg-muted/20 border rounded text-xs text-muted-foreground">
                    No API transmissions recorded yet. Click "Dispatch to Courier API Now" to send order data and inspect HTTP responses.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Card 6: Follow-Up Automation Progress */}
          <Card>
            <CardHeader className="py-3 px-4 bg-muted/40">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                Follow-Up Automation Progress
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <div className="p-2.5 bg-muted/20 border rounded">
                  <p className="text-muted-foreground">Follow-Up Status</p>
                  <p className="font-semibold text-foreground mt-0.5 capitalize">
                    {order.status === "completed" || order.status === "confirmed" ? "Stopped (Ordered)" : "Active"}
                  </p>
                </div>
                <div className="p-2.5 bg-muted/20 border rounded">
                  <p className="text-muted-foreground">Follow-Ups Sent</p>
                  <p className="font-semibold text-foreground mt-0.5">
                    {order.status === "completed" || order.status === "confirmed" ? "Completed" : "0 / 4"}
                  </p>
                </div>
                <div className="p-2.5 bg-muted/20 border rounded">
                  <p className="text-muted-foreground">Follow-Up Limit</p>
                  <p className="font-semibold text-foreground mt-0.5">4 Messages Max</p>
                </div>
                <div className="p-2.5 bg-muted/20 border rounded">
                  <p className="text-muted-foreground">Remaining Follow-Ups</p>
                  <p className="font-semibold text-foreground mt-0.5">
                    {order.status === "completed" || order.status === "confirmed" ? "0 (Order Placed)" : "4"}
                  </p>
                </div>
                <div className="p-2.5 bg-muted/20 border rounded col-span-2 sm:col-span-2">
                  <p className="text-muted-foreground">Stop Trigger Condition</p>
                  <p className="font-semibold text-emerald-600 mt-0.5">
                    Order confirmed — automated follow-ups permanently halted
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}
