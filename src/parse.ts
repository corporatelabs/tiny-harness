import { CATALOG } from "./catalog.js";

export interface ParseFlags {
  wordNumbers: boolean;
  cancellations: boolean;
}

export interface ParsedLead {
  requests: { sku: string; qty: number }[];
  unknown: string[];
  budget: number | null;
  discountPct: number | null;
  wantsFriday: boolean;
  monthly: boolean;
  cancellations: { sku: string; qty: number }[];
}

const CANCEL_SKU: Record<string, string> = {
  arm: "Arc",
  "monitor arm": "Arc",
  lamp: "Lumen",
  headset: "Quiet",
  desk: "Rise",
};

/** Read a lead the way the scripted executor does. Flags turn two readings on or off. */
export function parseLead(lead: string, flags: ParseFlags): ParsedLead {
  let text = lead.toLowerCase();
  if (flags.wordNumbers) {
    text = text.replace(/half a dozen/g, "6");
    text = text.replace(/a dozen/g, "12");
    text = text.replace(/a couple of/g, "2");
    text = text.replace(/a couple/g, "2");
  }

  const seats = seatCount(text);
  const requests: { sku: string; qty: number }[] = [];
  for (const item of CATALOG) {
    const mention = earliest(text, item.pattern);
    if (!mention) continue;
    const qty = item.sku === "Floor" && seats != null ? seats : mention.qty;
    requests.push({ sku: item.sku, qty });
  }

  const cancellations: { sku: string; qty: number }[] = [];
  for (const match of text.matchAll(/scratch\s+(\d+)\s+(monitor arm|arm|lamp|headset|desk)s?/g)) {
    const qtyText = match[1];
    const word = match[2];
    if (!qtyText || !word) continue;
    const sku = CANCEL_SKU[word];
    if (!sku) continue;
    cancellations.push({ sku, qty: Number(qtyText) });
  }

  let next = requests.map((item) => ({ ...item }));
  if (flags.cancellations) {
    for (const cancel of cancellations) {
      const item = next.find((entry) => entry.sku === cancel.sku);
      if (item) item.qty -= cancel.qty;
    }
    next = next.filter((item) => item.qty > 0);
  }

  const budgetMatch = text.match(/budget(?:\s+is)?\s+\$(\d+)/);
  const discountMatch = text.match(/(\d+)\s*%\s*off/);
  const unknown: string[] = [];
  if (/\bcoffee\b/.test(text)) unknown.push("coffee machine");

  return {
    requests: next,
    unknown,
    budget: budgetMatch?.[1] ? Number(budgetMatch[1]) : null,
    discountPct: discountMatch?.[1] ? Number(discountMatch[1]) : null,
    wantsFriday: /\bfriday\b/.test(text),
    monthly: /\bmonthly\b|\bper month\b/.test(text),
    cancellations,
  };
}

export function seatCount(text: string): number | null {
  const match = text.toLowerCase().match(/\b(\d+)\s+(people|person|seats|seat|users|user)\b/);
  return match?.[1] ? Number(match[1]) : null;
}

function earliest(text: string, pattern: string): { index: number; qty: number } | null {
  const re = new RegExp(`\\b(?:${pattern})\\b`, "gi");
  let best: { index: number; qty: number } | null = null;
  for (const match of text.matchAll(re)) {
    const index = match.index ?? 0;
    const qty = qtyBefore(text, index) ?? 1;
    if (!best || index < best.index) best = { index, qty };
  }
  return best;
}

function qtyBefore(text: string, index: number): number | null {
  const prefix = text.slice(0, index).trimEnd();
  const digit = prefix.match(/(?:^|\s)(\d+)$/);
  if (digit?.[1]) return Number(digit[1]);
  if (/(?:^|\s)(?:a|an|one)$/.test(prefix)) return 1;
  return null;
}
