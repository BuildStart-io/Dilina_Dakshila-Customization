import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Eye, ShoppingCart, Loader2, Phone, MapPin, CreditCard, Package, MessageSquare, Trash2, Download, FileText, CheckCircle2, XCircle, Truck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import LimitWarningBanner from "@/components/LimitWarningBanner";
import OrderDetailDrawer, { OrderDetail } from "@/components/orders/OrderDetailDrawer";
import { openOrDownloadPdf, resolvePdfUrl } from "@/lib/pdfHelper";

const statusColors: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  confirmed: "bg-green-100 text-green-800",
  processing: "bg-blue-100 text-blue-800",
  shipped: "bg-purple-100 text-purple-800",
  delivered: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-red-100 text-red-800",
};

const statusOptions = [
  { value: "pending", label: "Pending" },
  { value: "confirmed", label: "Confirmed" },
  { value: "processing", label: "Processing" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];

export default function Orders() {
  const [orders, setOrders] = useState<OrderDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<OrderDetail | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [viewTab, setViewTab] = useState<"all" | "slips" | "courier">("all");
  const { toast } = useToast();
  const navigate = useNavigate();

  const fetchOrders = async () => {
    try {
      let query = supabase
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false });

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      if (viewTab === "slips") {
        query = query.eq("payment_status", "verification_pending");
      } else if (viewTab === "courier") {
        query = query.eq("courier_status", "courier_transfer_pending");
      }

      const { data, error } = await query;

      if (error) throw error;
      setOrders((data as any) || []);
    } catch (error: any) {
      toast({
        title: "Error fetching orders",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [statusFilter, viewTab]);

  const updateOrderStatus = async (orderId: string, newStatus: string) => {
    try {
      const { error } = await supabase
        .from("orders")
        .update({ status: newStatus })
        .eq("id", orderId);

      if (error) throw error;
      toast({ title: "Order status updated" });
      fetchOrders();

      if (selectedOrder?.id === orderId) {
        setSelectedOrder({ ...selectedOrder, status: newStatus });
      }
    } catch (error: any) {
      toast({
        title: "Error updating order",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const verifyPayment = async (orderId: string) => {
    try {
      const { error } = await supabase
        .from("orders")
        .update({
          payment_status: "verified",
          status: "confirmed",
          courier_status: "courier_transfer_pending",
          updated_at: new Date().toISOString(),
        })
        .eq("id", orderId);

      if (error) throw error;
      toast({ title: "Payment verified & order confirmed!" });
      fetchOrders();
      if (selectedOrder?.id === orderId) {
        setSelectedOrder({
          ...selectedOrder,
          payment_status: "verified",
          status: "confirmed",
          courier_status: "courier_transfer_pending",
        });
      }
    } catch (err: any) {
      toast({ title: "Verification failed", description: err.message, variant: "destructive" });
    }
  };

  const rejectPayment = async (orderId: string) => {
    try {
      const { error } = await supabase
        .from("orders")
        .update({
          payment_status: "rejected",
          updated_at: new Date().toISOString(),
        })
        .eq("id", orderId);

      if (error) throw error;
      toast({ title: "Payment slip marked as rejected" });
      fetchOrders();
      if (selectedOrder?.id === orderId) {
        setSelectedOrder({ ...selectedOrder, payment_status: "rejected" });
      }
    } catch (err: any) {
      toast({ title: "Action failed", description: err.message, variant: "destructive" });
    }
  };

  const [dispatchingId, setDispatchingId] = useState<string | null>(null);
  const [generatingPdfId, setGeneratingPdfId] = useState<string | null>(null);

  const handleViewOrGenerateInvoice = async (order: OrderDetail) => {
    if (order.bill_pdf_url) {
      openOrDownloadPdf(order.bill_pdf_url, `Invoice_${order.id.substring(0, 8)}.pdf`);
      return;
    }

    setGeneratingPdfId(order.id);
    try {
      const { data, error } = await supabase.functions.invoke("generate-invoice-pdf-Dakshila_Dilina", {
        body: { orderId: order.id, userId: (order as any).user_id },
      });

      if (error) throw error;
      if (data?.pdfUrl) {
        toast({
          title: "Customer Bill PDF Generated!",
          description: `Official invoice ready. Opening PDF...`,
        });
        await fetchOrders();
        if (selectedOrder?.id === order.id) {
          setSelectedOrder({ ...selectedOrder, bill_pdf_url: data.pdfUrl });
        }
        openOrDownloadPdf(data.pdfUrl, `Invoice_${order.id.substring(0, 8)}.pdf`);
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
      setGeneratingPdfId(null);
    }
  };

  const retryCourierTransfer = async (orderId: string) => {
    setDispatchingId(orderId);
    try {
      const { data, error } = await supabase.functions.invoke("dispatch-courier-Dakshila_Dilina", {
        body: { orderId },
      });

      if (error) throw error;
      if (data?.success) {
        toast({
          title: "Courier Dispatch Successful! (HTTP 200 OK)",
          description: `Parcel registered with Courier API. Tracking ID: ${data.tracking_id || "Active"}`,
        });
      } else {
        toast({
          title: `Courier Transfer Denied (${data?.http_status ? `HTTP ${data.http_status}` : "Failed"})`,
          description: data?.error || "Transfer failed. Inspect HTTP response log in Order drawer.",
          variant: "destructive",
        });
      }
      fetchOrders();
      if (selectedOrder?.id === orderId) {
        const { data: updatedOrder } = await supabase.from("orders").select("*").eq("id", orderId).single();
        if (updatedOrder) setSelectedOrder(updatedOrder as any);
      }
    } catch (err: any) {
      toast({ title: "Courier retry failed", description: err.message, variant: "destructive" });
    } finally {
      setDispatchingId(null);
    }
  };

  const deleteOrder = async (orderId: string) => {
    try {
      const { error } = await supabase.from("orders").delete().eq("id", orderId);
      if (error) throw error;
      toast({ title: "Order deleted" });
      if (selectedOrder?.id === orderId) setSelectedOrder(null);
      fetchOrders();
    } catch (error: any) {
      toast({ title: "Error deleting order", description: error.message, variant: "destructive" });
    }
  };

  const exportCourierManifest = () => {
    if (orders.length === 0) {
      toast({ title: "No orders to export", variant: "destructive" });
      return;
    }
    const headers = [
      "Order Reference",
      "Customer Name",
      "Delivery Address",
      "District",
      "WhatsApp Number",
      "Normal Contact Number",
      "Product Items",
      "Quantity",
      "Payment Method",
      "COD Amount (LKR)",
      "Delivery Notes",
    ];

    const rows = orders.map((o) => {
      const items = Array.isArray(o.order_items) ? o.order_items : [];
      const itemNames = items.map((i: any) => `${i.quantity || 1}x ${i.name} ${i.size_color ? `(${i.size_color})` : ""}`).join("; ");
      const totalQty = items.reduce((sum: number, i: any) => sum + (Number(i.quantity) || 1), 0);
      const codAmount = o.payment_method === "cod" ? o.total_amount : 0;
      const orderRef = `BS-ORD-${o.id.substring(0, 8).toUpperCase()}`;

      return [
        orderRef,
        o.customer_name,
        o.customer_address || "",
        o.district || "",
        o.whatsapp_phone || o.customer_phone,
        o.normal_phone || o.customer_phone,
        itemNames,
        totalQty,
        o.payment_method.toUpperCase(),
        codAmount,
        o.special_instructions || "",
      ];
    });

    const csvContent = [
      headers.join(","),
      ...rows.map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `courier_manifest_${format(new Date(), "yyyy-MM-dd")}.csv`;
    link.click();
    toast({ title: "Courier manifest exported successfully" });
  };

  const exportOrders = (type: "csv" | "excel") => {
    if (orders.length === 0) {
      toast({ title: "No orders to export", variant: "destructive" });
      return;
    }

    const headers = [
      "Order ID",
      "Customer Name",
      "Phone",
      "District",
      "Address",
      "Items",
      "Payment Method",
      "Payment Status",
      "Status",
      "Total Amount",
      "Special Instructions",
      "Created At",
    ];

    const rows = orders.map((o) => {
      const items = (Array.isArray(o.order_items) ? o.order_items : [])
        .map((i: any) => `${i.quantity}x ${i.name}`)
        .join("; ");
      return [
        o.id,
        o.customer_name,
        o.customer_phone,
        o.district || "",
        o.customer_address || "",
        items,
        o.payment_method === "cod" ? "Cash on Delivery" : "Bank Transfer",
        o.payment_status || "pending",
        o.status,
        o.total_amount.toFixed(2),
        o.special_instructions || "",
        format(new Date(o.created_at), "yyyy-MM-dd HH:mm"),
      ];
    });

    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const BOM = "\uFEFF";
    const blob = new Blob([BOM + csvContent], {
      type: type === "excel" ? "application/vnd.ms-excel;charset=utf-8" : "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `orders-${statusFilter}-${format(new Date(), "yyyy-MM-dd")}.${type === "excel" ? "xls" : "csv"}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: `Orders exported as ${type === "excel" ? "Excel" : "CSV"}` });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <LimitWarningBanner type="orders" />
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Orders & Dispatch</h1>
            <p className="text-muted-foreground text-sm sm:text-base">
              Manage WhatsApp customer orders, verify payment slips, and export courier manifests
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="default"
              size="sm"
              onClick={exportCourierManifest}
              className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5"
            >
              <Truck className="h-4 w-4" />
              Export Courier Manifest
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportOrders("csv")} disabled={orders.length === 0}>
              <Download className="mr-1.5 h-4 w-4" />
              CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportOrders("excel")} disabled={orders.length === 0}>
              <Download className="mr-1.5 h-4 w-4" />
              Excel
            </Button>
          </div>
        </div>

        {/* Tab Selection */}
        <div className="flex items-center gap-2 border-b pb-2">
          <Button
            variant={viewTab === "all" ? "default" : "ghost"}
            size="sm"
            onClick={() => setViewTab("all")}
          >
            All Orders
          </Button>
          <Button
            variant={viewTab === "slips" ? "default" : "ghost"}
            size="sm"
            onClick={() => setViewTab("slips")}
            className="relative"
          >
            Bank Slips (Pending Verification)
          </Button>
          <Button
            variant={viewTab === "courier" ? "default" : "ghost"}
            size="sm"
            onClick={() => setViewTab("courier")}
          >
            Ready for Courier Dispatch
          </Button>
        </div>

        <Card>
          <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 gap-2">
            <div>
              <CardTitle>Order List</CardTitle>
              <CardDescription>
                {orders.length} order{orders.length !== 1 ? "s" : ""} found
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Status:</span>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {statusOptions.map((status) => (
                    <SelectItem key={status.value} value={status.value}>
                      {status.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center items-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : orders.length === 0 ? (
              <div className="text-center py-12">
                <ShoppingCart className="mx-auto h-12 w-12 text-muted-foreground/50 mb-3" />
                <p className="text-muted-foreground">No orders found matching the filter.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead>Phones (WA / Normal)</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Payment & Slip</TableHead>
                      <TableHead>Order Status</TableHead>
                      <TableHead>Courier</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell className="font-medium">
                          <div>
                            <p>{order.customer_name}</p>
                            <p className="text-xs text-muted-foreground">{order.district || ""}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-xs space-y-0.5 font-mono">
                            <p className="text-green-700 dark:text-green-400">WA: {order.whatsapp_phone || order.customer_phone}</p>
                            {order.normal_phone && (
                              <p className="text-blue-700 dark:text-blue-400">Alt: {order.normal_phone}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="font-semibold">
                          LKR {order.total_amount.toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <span className="text-xs uppercase font-medium">
                              {order.payment_method === "cod" ? "COD" : "Bank Transfer"}
                            </span>
                            {order.payment_slip_url && order.payment_slip_url !== "received_via_whatsapp" ? (
                              <div className="flex items-center gap-1.5 mt-1">
                                <img
                                  src={order.payment_slip_url}
                                  alt="slip"
                                  className="w-8 h-8 rounded border object-cover cursor-pointer hover:scale-110 transition"
                                  onClick={() => setSelectedOrder(order)}
                                />
                                {order.payment_status === "verification_pending" && (
                                  <Badge className="bg-amber-600 text-[10px] py-0 px-1.5 animate-pulse">
                                    Verify Slip
                                  </Badge>
                                )}
                              </div>
                            ) : order.payment_method === "bank_transfer" ? (
                              <Badge variant="outline" className="text-[10px]">
                                Slip Pending
                              </Badge>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={order.status}
                            onValueChange={(value) => updateOrderStatus(order.id, value)}
                          >
                            <SelectTrigger className="w-[120px] h-8 text-xs">
                              <Badge className={statusColors[order.status] || "bg-gray-100"}>
                                {order.status}
                              </Badge>
                            </SelectTrigger>
                            <SelectContent>
                              {statusOptions.map((status) => (
                                <SelectItem key={status.value} value={status.value}>
                                  {status.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1 items-start">
                            <Badge
                              variant="outline"
                              className={`text-[11px] capitalize ${
                                order.courier_status === "Courier Accepted"
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300"
                                  : order.courier_status === "Courier Transfer Failed"
                                  ? "bg-red-50 text-red-700 border-red-300 dark:bg-red-950/40 dark:text-red-300"
                                  : "bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300"
                              }`}
                            >
                              {order.courier_status ? order.courier_status.replace(/_/g, " ") : "Pending Transfer"}
                            </Badge>
                            {order.courier_status !== "Courier Accepted" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-1.5 text-[10px] text-primary gap-1 hover:bg-primary/10"
                                onClick={() => retryCourierTransfer(order.id)}
                                disabled={dispatchingId === order.id}
                              >
                                {dispatchingId === order.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Truck className="h-3 w-3" />
                                )}
                                Dispatch API
                              </Button>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {format(new Date(order.created_at), "MMM d, yyyy")}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              className={`h-8 gap-1 text-xs ${
                                order.bill_pdf_url
                                  ? "border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300"
                                  : "border-indigo-200 text-indigo-700 bg-indigo-50/50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:text-indigo-300"
                              }`}
                              onClick={() => handleViewOrGenerateInvoice(order)}
                              disabled={generatingPdfId === order.id}
                              title={order.bill_pdf_url ? "Open Customer Bill PDF" : "Generate Customer Bill PDF"}
                            >
                              {generatingPdfId === order.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <FileText className="h-3.5 w-3.5" />
                              )}
                              <span>{order.bill_pdf_url ? "Bill PDF" : "Gen Bill"}</span>
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 gap-1 text-xs"
                              onClick={() => setSelectedOrder(order)}
                            >
                              <Eye className="h-3.5 w-3.5" />
                              View
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive">
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete Order</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This action will permanently delete this order.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => deleteOrder(order.id)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  >
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 24-Field Comprehensive Order Drawer */}
        <OrderDetailDrawer
          order={selectedOrder}
          isOpen={!!selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onVerifyPayment={verifyPayment}
          onRejectPayment={rejectPayment}
          onRetryCourier={retryCourierTransfer}
          onOrderUpdated={fetchOrders}
        />
      </div>
    </DashboardLayout>
  );
}
