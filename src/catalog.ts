/** Products the grader treats as ground truth. The agent prices from the harness text. */
export interface Product {
  sku: string;
  name: string;
  /** Monthly price for Floor; unit price for everything else. */
  price: number;
  /** Alternation placed inside a word-boundary regex when reading a lead. */
  pattern: string;
}

export const CATALOG: readonly Product[] = [
  { sku: "Lumen", name: "desk lamp", price: 49, pattern: "lumen|desk lamps?|lamps?" },
  { sku: "Rise", name: "standing desk", price: 399, pattern: "rise|standing desks?" },
  { sku: "Arc", name: "monitor arm", price: 89, pattern: "arc|monitor arms?" },
  { sku: "Quiet", name: "headset", price: 129, pattern: "quiet|headsets?" },
  { sku: "Floor", name: "team plan", price: 19, pattern: "floor|team plans?" },
];

export function product(sku: string): Product {
  const found = CATALOG.find((item) => item.sku === sku);
  if (!found) throw new Error(`Unknown sku ${sku}`);
  return found;
}
