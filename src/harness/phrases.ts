/**
 * Phrases the scripted executor understands.
 * A phrase does nothing until it is written into the harness.
 * The editor proposes these strings; it does not reach into the executor.
 */
export const phrases = {
  noInvent: "Do not invent prices for products that are not in the catalog.",
  wordNumbers:
    "Interpret word numbers before quoting: a dozen is 12, half a dozen is 6, and a couple is 2.",
  cancellations: "When the lead scratches or cancels a quantity, subtract it before quoting.",
  seatMinimum:
    "The Floor plan requires at least 5 seats. If the lead wants fewer, decline without a total.",
  annual:
    "The Floor plan is billed annually only. Multiply the monthly price by 12 and say that it is billed annually.",
  leadTime:
    "The Rise standing desk ships in 14 days. If the lead needs it sooner, do not promise that date.",
  noDiscount: "Quote list price only. Do not discount.",
  budget:
    "If the lead states a budget, omit any item priced above that budget and name the item that is over the stated budget.",
  alwaysQuote:
    "Always include a numeric dollar total. If the item is not in the catalog, quote a custom equivalent at $99 so the lead still receives a price.",
  restate: "Open the reply by restating the lead's request in one sentence.",
} as const;
