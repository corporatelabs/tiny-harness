import { CATALOG, type Product } from "./catalog.js";
import { parseLead, seatCount, type ParsedLead } from "./parse.js";
import type { Reply } from "./types.js";

/**
 * Runtime probe. It sees the lead text, the reply, and catalog policy.
 * It does not see a task id or the hidden answer key.
 */
export interface ProbeScore {
  score: number;
  checks: { name: string; passed: boolean }[];
}

const CHECKS: { name: string; passed: (lead: string, reply: Reply) => boolean }[] = [
  { name: "schema", passed: validSchema },
  { name: "known-skus", passed: (_lead, reply) => reply.items.every((item) => productFor(item.sku) != null) },
  { name: "list-price", passed: (_lead, reply) => respectsListPrice(reply) },
  { name: "arithmetic", passed: (_lead, reply) => arithmeticHolds(reply) },
  { name: "seat-minimum", passed: respectsSeatMinimum },
  { name: "annual-billing", passed: (_lead, reply) => respectsAnnualBilling(reply) },
  { name: "budget", passed: respectsBudget },
  { name: "deadline", passed: respectsDeadline },
  { name: "stated-quantities", passed: respectsQuantities },
  { name: "catalog-coverage", passed: respectsCatalogCoverage },
];

/** Score a reply with the proxy signal. `lead` is the only task input. */
export function probeSignal(lead: string, reply: Reply): ProbeScore {
  const checks = CHECKS.map((check) => ({ name: check.name, passed: check.passed(lead, reply) }));
  const passed = checks.filter((check) => check.passed).length;
  const score = checks.length === 0 ? 0 : Math.round((passed / checks.length) * 100);
  return { score, checks };
}

function productFor(sku: string): Product | undefined {
  return CATALOG.find((item) => item.sku === sku);
}

function askedLead(lead: string): ParsedLead {
  return parseLead(lead, { wordNumbers: true, cancellations: true });
}

function validSchema(_lead: string, reply: Reply): boolean {
  if (reply.decision !== "quote" && reply.decision !== "decline" && reply.decision !== "counter") return false;
  if (!reply.notes.every((note) => typeof note === "string")) return false;
  for (const item of reply.items) {
    if (!item.sku || !Number.isInteger(item.qty) || item.qty <= 0) return false;
    if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) return false;
  }
  if (reply.decision === "decline") return reply.items.length === 0 && reply.total === null;
  return reply.items.length > 0 && typeof reply.total === "number";
}

function respectsListPrice(reply: Reply): boolean {
  return reply.items.every((item) => {
    const product = productFor(item.sku);
    if (!product) return false;
    if (item.unitPrice === product.price) return true;
    return product.billedAnnually === true && item.unitPrice === product.price * 12;
  });
}

function arithmeticHolds(reply: Reply): boolean {
  if (reply.decision === "decline") return reply.total === null;
  if (typeof reply.total !== "number") return false;
  const sum = reply.items.reduce((total, item) => total + item.qty * item.unitPrice, 0);
  return Math.abs(sum - reply.total) < 0.001;
}

function respectsSeatMinimum(lead: string, reply: Reply): boolean {
  const asked = askedLead(lead);
  for (const product of CATALOG) {
    if (product.minQty == null) continue;
    const requested = asked.requests.some((item) => item.sku === product.sku);
    const seats = seatCount(lead);
    if (!requested || seats == null || seats >= product.minQty) continue;
    const quoted = reply.items.some((item) => item.sku === product.sku);
    if (quoted || reply.decision !== "decline") return false;
  }
  return true;
}

function respectsAnnualBilling(reply: Reply): boolean {
  return reply.items.every((item) => {
    const product = productFor(item.sku);
    if (!product?.billedAnnually) return true;
    return item.unitPrice === product.price * 12;
  });
}

function respectsBudget(lead: string, reply: Reply): boolean {
  const budget = askedLead(lead).budget;
  if (budget == null) return true;
  if (reply.items.some((item) => item.unitPrice > budget)) return false;
  return reply.total == null || reply.total <= budget;
}

function respectsDeadline(lead: string, reply: Reply): boolean {
  if (!/\bfriday\b/i.test(lead)) return true;
  const notes = reply.notes.join(" ").toLowerCase();
  if (notes.includes("can deliver by friday")) return false;
  const slow = reply.items.find((item) => {
    const product = productFor(item.sku);
    return product?.leadTimeDays != null && product.leadTimeDays > 1;
  });
  if (!slow) return true;
  const product = productFor(slow.sku);
  const days = product?.leadTimeDays;
  if (days == null) return true;
  return notes.includes(`${days} days`);
}

function respectsQuantities(lead: string, reply: Reply): boolean {
  const asked = askedLead(lead);
  if (asked.unknown.length > 0 && asked.requests.length === 0) return reply.items.length === 0;
  const askedSkus = new Set(asked.requests.map((item) => item.sku));
  for (const item of reply.items) {
    if (!askedSkus.has(item.sku)) return false;
    const want = asked.requests.find((request) => request.sku === item.sku);
    if (!want || item.qty !== want.qty) return false;
  }
  for (const want of asked.requests) {
    if (reply.items.some((item) => item.sku === want.sku)) continue;
    if (!omissionAllowed(want.sku, asked, lead)) return false;
  }
  return true;
}

function omissionAllowed(sku: string, asked: ParsedLead, lead: string): boolean {
  const product = productFor(sku);
  if (!product) return false;
  if (product.minQty != null) {
    const seats = seatCount(lead);
    if (seats != null && seats < product.minQty) return true;
  }
  return asked.budget != null && product.price > asked.budget;
}

function respectsCatalogCoverage(lead: string, reply: Reply): boolean {
  const asked = askedLead(lead);
  if (asked.unknown.length > 0 && asked.requests.length === 0) {
    return reply.decision === "decline" && reply.items.length === 0 && reply.total === null;
  }
  return reply.items.every((item) => productFor(item.sku) != null);
}
