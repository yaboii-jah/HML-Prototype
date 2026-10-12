import { actorName, auditTime } from "../domain/audit.ts";
import { validTransferReceipt } from "../domain/transfer-document.ts";
import type { TransferReceiptData } from "../domain/types.ts";
import { renderReceiptPdf } from "./delivery-receipt-pdf.ts";
import { documentDate } from "./document-template.ts";

export async function generateTransferReceiptPdf(data: TransferReceiptData) {
  if (!validTransferReceipt(data)) throw new Error("Invalid linked transfer receipt.");
  const { delivery, transfer, request } = data;
  const received = delivery.status === "confirmed" || delivery.status === "posted";
  return renderReceiptPdf({
    title: "STOCK TRANSFER RECEIPT", ref: delivery.ref, stage: received ? delivery.status === "posted" ? "STOCK POSTED" : "RECEIVED" : "PENDING RECEIPT", received,
    fields: [
      { label: "TRANSFER / MRF #", value: transfer.ref + " / " + request.ref },
      { label: "ROUTE", value: transfer.origin.name + " → " + transfer.destination.name },
      { label: "FROM", value: delivery.origin.name + "\n" + delivery.origin.address },
      { label: "DELIVERY LOCATION", value: delivery.destination.name + "\n" + delivery.destination.address },
      { label: "SOURCE RELEASE", value: auditTime(transfer.reviewedAt) + " · " + actorName("Site Personnel", transfer.reviewedBy) },
      { label: "SCHEDULED DATE", value: documentDate(delivery.scheduledDate) },
      { label: "DISPATCH RECORDED", value: auditTime(delivery.dispatchedAt) + " · " + actorName("Logistics", delivery.dispatchedBy) },
      { label: "RECEIPT RECORDED", value: received ? auditTime(delivery.receivedAt) + " · " + actorName("Site Personnel", delivery.receivedBy) : "Awaiting receiving confirmation" },
      { label: "EVIDENCE", value: delivery.evidence }
    ],
    materials: delivery.lines.map(line => { const item = request.items.find(item => item.id === line.itemId)!, source = transfer.lines.find(source => source.id === line.transferLineId)!; return { name: item.name + (item.name !== source.sourceName ? "\nSource stock: " + source.sourceName : ""), unit: item.unit, expected: line.expected, accepted: line.accepted, issue: line.issue }; }),
    footerFields: [...(delivery.reason ? [{ label: "POSTING CORRECTION", value: delivery.reason }] : []), ...(delivery.status === "posted" ? [{ label: "STOCK POSTED", value: auditTime(delivery.postedAt) + " · " + actorName("Site Personnel", delivery.postedBy) }] : [])],
    signatureLabels: ["Prepared / dispatched by", "Received at destination site by"]
  });
}
