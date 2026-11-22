import type { Model } from "./model.js";
import type { Decision, Harness, LineItem, Reply } from "./types.js";

/** Run the frozen model once under a harness. A bad completion becomes a decline. */
export async function runAgent(model: Model, harness: Harness, lead: string): Promise<Reply> {
  const raw = await model.complete({ role: "executor", harness, lead });
  try {
    return parseReply(raw);
  } catch {
    return {
      decision: "decline",
      items: [],
      total: null,
      notes: ["The reply was not valid JSON."],
    };
  }
}

export function parseReply(raw: string): Reply {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced?.[1] ?? raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Model reply did not contain JSON");
  const value: unknown = JSON.parse(body.slice(start, end + 1));
  if (!isReply(value)) throw new Error("Model reply did not match the quote schema");
  return value;
}

function isReply(value: unknown): value is Reply {
  if (!value || typeof value !== "object") return false;
  const reply = value as Partial<Reply>;
  if (!isDecision(reply.decision)) return false;
  if (!Array.isArray(reply.items) || !reply.items.every(isLineItem)) return false;
  if (reply.total !== null && typeof reply.total !== "number") return false;
  if (!Array.isArray(reply.notes) || !reply.notes.every((note) => typeof note === "string")) return false;
  return true;
}

function isDecision(value: unknown): value is Decision {
  return value === "quote" || value === "decline" || value === "counter";
}

function isLineItem(value: unknown): value is LineItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<LineItem>;
  return typeof item.sku === "string" && typeof item.qty === "number" && typeof item.unitPrice === "number";
}
