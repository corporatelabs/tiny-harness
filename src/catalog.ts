/**
 * Catalog and sales policy the probe may use.
 * This is not the per-lead answer key. The executor still prices from harness text.
 */
export interface Product {
  sku: string;
  name: string;
  /** Monthly price for Floor; unit price for everything else. */
  price: number;
  /** Alternation placed inside a word-boundary regex when reading a lead. */
  pattern: string;
  /** Minimum quantity. Floor seats below this are not sold. */
  minQty?: number;
  /** Quote `price * 12` when this product is billed annually. */
  billedAnnually?: boolean;
  /** Days before the product can ship. */
  leadTimeDays?: number;
}

export const CATALOG: readonly Product[] = [
  { sku: "Lumen", name: "desk lamp", price: 49, pattern: "lumen|desk lamps?|lamps?" },
  { sku: "Rise", name: "standing desk", price: 399, pattern: "rise|standing desks?", leadTimeDays: 14 },
  { sku: "Arc", name: "monitor arm", price: 89, pattern: "arc|monitor arms?" },
  { sku: "Quiet", name: "headset", price: 129, pattern: "quiet|headsets?" },
  {
    sku: "Floor",
    name: "team plan",
    price: 19,
    pattern: "floor|team plans?",
    minQty: 5,
    billedAnnually: true,
  },
];

export function product(sku: string): Product {
  const found = CATALOG.find((item) => item.sku === sku);
  if (!found) throw new Error(`Unknown sku ${sku}`);
  return found;
}
