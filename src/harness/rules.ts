import { product } from "../catalog.js";
import { parseLead, seatCount } from "../parse.js";
import type { Lesson, Reply } from "../types.js";
import { phrases } from "./phrases.js";

/**
 * Checklist the scripted editor can propose, standing in for a strong editor model.
 * The loop proposes at most one fresh rule per task. Lessons already in the library
 * may ride along in that same domain edit.
 * `violated` sees the lead and the reference reply. It does not see the grader.
 */
export interface DomainRule extends Lesson {
  violated: (lead: string, reply: Reply) => boolean;
}

export const DOMAIN_RULES: readonly DomainRule[] = [
  {
    id: "word-numbers",
    text: phrases.wordNumbers,
    keywords: ["dozen", "couple"],
    violated(lead, reply) {
      const text = lead.toLowerCase();
      if (text.includes("half a dozen")) return !reply.items.some((item) => item.qty >= 6);
      if (text.includes("dozen")) return !reply.items.some((item) => item.qty >= 12);
      if (text.includes("couple")) return !reply.items.some((item) => item.qty >= 2);
      return false;
    },
  },
  {
    id: "cancellations",
    text: phrases.cancellations,
    keywords: ["scratch"],
    violated(lead, reply) {
      const corrected = parseLead(lead, { wordNumbers: false, cancellations: true });
      if (corrected.cancellations.length === 0) return false;
      const wanted = new Map(corrected.requests.map((item) => [item.sku, item.qty]));
      const skus = new Set([...wanted.keys(), ...reply.items.map((item) => item.sku)]);
      for (const sku of skus) {
        const qty = reply.items.find((item) => item.sku === sku)?.qty ?? 0;
        if (qty !== (wanted.get(sku) ?? 0)) return true;
      }
      return false;
    },
  },
  {
    id: "seat-minimum",
    text: phrases.seatMinimum,
    keywords: ["floor"],
    violated(lead, reply) {
      if (!/floor/i.test(lead)) return false;
      const seats = seatCount(lead);
      if (seats == null || seats >= 5) return false;
      return reply.decision === "quote";
    },
  },
  {
    id: "annual",
    text: phrases.annual,
    keywords: ["monthly"],
    violated(lead, reply) {
      if (!/floor/i.test(lead) || !/monthly|per month/i.test(lead)) return false;
      if (reply.decision !== "quote") return false;
      const seats = seatCount(lead);
      if (seats == null) return false;
      return reply.total === seats * product("Floor").price;
    },
  },
  {
    id: "lead-time",
    text: phrases.leadTime,
    keywords: ["friday"],
    violated(lead, reply) {
      if (!/\bfriday\b/i.test(lead) || !/rise|standing desk/i.test(lead)) return false;
      const notes = reply.notes.join(" ").toLowerCase();
      return notes.includes("can deliver by friday") || !notes.includes("14 days");
    },
  },
  {
    id: "no-discount",
    text: phrases.noDiscount,
    keywords: ["% off"],
    violated(lead, reply) {
      if (!/%\s*off/i.test(lead)) return false;
      const headset = reply.items.find((item) => item.sku === "Quiet");
      if (!headset) return false;
      return headset.unitPrice < product("Quiet").price;
    },
  },
  {
    id: "budget",
    text: phrases.budget,
    keywords: ["budget"],
    violated(lead, reply) {
      const match = lead.match(/budget(?:\s+is)?\s+\$(\d+)/i);
      if (!match?.[1]) return false;
      const budget = Number(match[1]);
      return reply.items.some((item) => item.unitPrice > budget);
    },
  },
];
