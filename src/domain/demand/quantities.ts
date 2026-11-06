/** Internal quantity contract; owning workflows supply authorized source records. */
export const demandOwnerKinds = ["award", "purchase_order", "suitability", "transfer"] as const;
export type DemandOwnerKind = typeof demandOwnerKinds[number];
export type DemandClaim = {
  claimId: string;
  itemId: string;
  ownerKind: DemandOwnerKind;
  ownerId: string;
  ownerLineId: string;
  quantity: string;
};
export type DemandChange = DemandClaim;
export type DemandTotals = {
  requested: string;
  awarded: string;
  ordered: string;
  suitability: string;
  transfers: string;
  purchase: string;
  unassigned: string;
};

function parts(value: string): { digits: bigint; places: number } {
  if (typeof value !== "string" || value.length > 80 || !/^\d+(?:\.\d+)?$/.test(value)) {
    throw Error("Enter an exact nonnegative demand quantity.");
  }
  const [whole, fraction = ""] = value.split(".");
  return { digits: BigInt(whole + fraction), places: fraction.length };
}

/** No quantity rounding or clamping: invalid/oversourced state must be visible. */
export function demandTotals(
  requested: string,
  claims: readonly Pick<DemandClaim, "ownerKind" | "quantity">[],
): DemandTotals {
  const requirement = parts(requested);
  if (requirement.digits === BigInt(0)) throw Error("Requested demand must be positive.");
  const parsed = claims.map(claim => {
    if (!demandOwnerKinds.includes(claim.ownerKind)) throw Error("Unknown demand owner.");
    return { ...parts(claim.quantity), kind: claim.ownerKind };
  });
  const places = parsed.reduce((scale, claim) => Math.max(scale, claim.places), requirement.places);
  const scaled = (value: { digits: bigint; places: number }) => value.digits * BigInt(10) ** BigInt(places - value.places);
  const totals: Record<DemandOwnerKind, bigint> = { award: BigInt(0), purchase_order: BigInt(0), suitability: BigInt(0), transfer: BigInt(0) };
  for (const claim of parsed) totals[claim.kind] += scaled(claim);
  const required = scaled(requirement);
  const purchase = required - totals.purchase_order - totals.suitability - totals.transfer;
  const unassigned = purchase - totals.award;
  if (unassigned < BigInt(0)) throw Error("Demand claims exceed requested quantity.");
  const format = (value: bigint) => {
    const digits = value.toString().padStart(places + 1, "0");
    return places === 0 ? digits : `${digits.slice(0, -places)}.${digits.slice(-places)}`.replace(/0+$/, "").replace(/\.$/, "");
  };
  return {
    requested: format(required), awarded: format(totals.award), ordered: format(totals.purchase_order),
    suitability: format(totals.suitability), transfers: format(totals.transfer),
    purchase: format(purchase), unassigned: format(unassigned),
  };
}
