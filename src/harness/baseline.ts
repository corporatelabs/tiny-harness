import { CATALOG } from "../catalog.js";
import type { Harness } from "../types.js";
import { phrases } from "./phrases.js";

/**
 * Starting harness. Prices are listed. The constraints that make those prices
 * safe to quote (seat minimum, lead time, annual billing, and so on) are not.
 */
export const baselineHarness: Harness = {
  system:
    "You are a sales assistant. Qualify the inbound lead and draft a quote using only the catalog in your skills.",
  guardrails: ["Be polite and concise.", phrases.noInvent],
  skills: ["Catalog:", ...CATALOG.map((item) => `${item.sku} ${item.name}: $${item.price} each.`)],
};
