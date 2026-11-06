/** Internal contracts. Future checked owning workflows authorize source/actions. */
export type StockAccountInput = {
  accountId: string; projectId: string; description: string; unit: string; expectedVersion: string;
};
export type StockPosting = {
  accountId: string;
  sourceKind: 'purchase_receipt' | 'transfer_receipt' | 'transfer_trip' | 'usage_entry' | 'stock_adjustment';
  sourceId: string; sourceLineId: string;
  postingKind: 'receipt' | 'dispatch' | 'usage' | 'adjustment';
  quantity: string; reservationId?: string | null;
};
export type StockReservationChange = {
  reservationId: string; accountId: string; ownerKind: 'transfer';
  ownerId: string; ownerLineId: string; quantity: string;
};
export type StockBatch = {
  accounts: StockAccountInput[]; postings: StockPosting[]; reservations: StockReservationChange[]; reason: string;
};
export type StockBalance = { onHand: string; reserved: string; available: string };

function quantity(value: string, signed: boolean) {
  if (typeof value !== 'string' || value.replace(/^-/, '').length > 80 || !(signed ? /^-?\d+(?:\.\d+)?$/ : /^\d+(?:\.\d+)?$/).test(value)) {
    throw Error('Enter an exact stock quantity.');
  }
  const [whole, fraction = ''] = value.split('.');
  return { digits: BigInt(whole + fraction), places: fraction.length };
}

/** No rounding, tolerance or clamping of invalid negative/overreserved state. */
export function stockBalance(movements: readonly string[], reservations: readonly string[]): StockBalance {
  const posted = movements.map(value => quantity(value, true));
  const held = reservations.map(value => quantity(value, false));
  const places = [...posted, ...held].reduce((scale, value) => Math.max(scale, value.places), 0);
  const total = (values: typeof posted) => values.reduce((sum, value) => sum + value.digits * BigInt(10) ** BigInt(places - value.places), BigInt(0));
  const onHand = total(posted), reserved = total(held), available = onHand - reserved;
  if (onHand < BigInt(0) || available < BigInt(0)) throw Error('Stock cannot be negative or below reservations.');
  const format = (value: bigint) => {
    const digits = value.toString().padStart(places + 1, '0');
    return places === 0 ? digits : `${digits.slice(0, -places)}.${digits.slice(-places)}`.replace(/0+$/, '').replace(/\.$/, '');
  };
  return { onHand: format(onHand), reserved: format(reserved), available: format(available) };
}
