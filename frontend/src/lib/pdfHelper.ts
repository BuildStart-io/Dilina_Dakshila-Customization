/**
 * Helper to resolve and open invoice / customer bill PDF URLs reliably in self-hosted environments.
 */

export function resolvePdfUrl(rawUrl?: string | null): string {
  if (!rawUrl) return "";
  if (rawUrl.startsWith("data:")) return rawUrl;

  // Replace docker internal api-gw:8000 with the active browser host on port 8000
  return rawUrl.replace(
    /https?:\/\/api-gw:8000/g,
    `${window.location.protocol}//${window.location.hostname}:8000`
  );
}

export function openOrDownloadPdf(rawUrl: string, filename?: string) {
  if (!rawUrl) return;
  const resolved = resolvePdfUrl(rawUrl);

  if (resolved.startsWith("data:application/pdf;base64,")) {
    try {
      const base64Data = resolved.replace("data:application/pdf;base64,", "");
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: "application/pdf" });
      const blobUrl = URL.createObjectURL(blob);
      const win = window.open(blobUrl, "_blank");
      if (!win) {
        // Fallback for popup blockers
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = filename || "order_invoice.pdf";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
      return;
    } catch (e) {
      console.error("Failed to decode base64 PDF:", e);
    }
  }

  const win = window.open(resolved, "_blank");
  if (!win) {
    const a = document.createElement("a");
    a.href = resolved;
    a.target = "_blank";
    a.download = filename || "order_invoice.pdf";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}
