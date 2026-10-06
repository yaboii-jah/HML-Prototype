import type { QuoteAdjustment } from "./types.ts";

// Classification describes the purchase, independently of its tax treatment.
export const MATERIAL_CLASSIFICATION = "Goods";
export function adjustmentClassification(kind: QuoteAdjustment["kind"]) {
  return kind === "shipping" || kind === "other" ? "Services" : "Financial adjustment";
}
