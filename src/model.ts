import { CATALOG } from "./catalog.js";
import { phrases } from "./harness/phrases.js";
import { parseLead } from "./parse.js";
import type { Decision, Harness, LineItem, Reply } from "./types.js";

/** The frozen model. The demo and the tests use {@link ScriptedModel}. */
export interface ModelRequest {
  role: "executor";
  harness: Harness;
  lead: string;
}

export interface Model {
  complete(request: ModelRequest): Promise<string>;
}

export function harnessText(harness: Harness): string {
  return [harness.system, ...harness.guardrails, ...harness.skills].join("\n");
}

export function renderHarness(harness: Harness): string {
  return [
    harness.system,
    "",
    "Guardrails:",
    ...harness.guardrails.map((line) => `- ${line}`),
    "",
    "Skills:",
    ...harness.skills.map((line) => `- ${line}`),
    "",
    'Reply with JSON only: {"decision":"quote"|"decline"|"counter","items":[{"sku":"","qty":0,"unitPrice":0}],"total":0,"notes":[]}. Use null for total when you decline.',
  ].join("\n");
}

interface Flags {
  wordNumbers: boolean;
  cancellations: boolean;
  seatMinimum: boolean;
  annual: boolean;
  leadTime: boolean;
  noDiscount: boolean;
  budget: boolean;
  noInvent: boolean;
  alwaysQuote: boolean;
  restate: boolean;
}

function flagsFrom(text: string): Flags {
  return {
    wordNumbers: text.includes(phrases.wordNumbers),
    cancellations: text.includes(phrases.cancellations),
    seatMinimum: text.includes(phrases.seatMinimum),
    annual: text.includes(phrases.annual),
    leadTime: text.includes(phrases.leadTime),
    noDiscount: text.includes(phrases.noDiscount),
    budget: text.includes(phrases.budget),
    noInvent: text.includes(phrases.noInvent),
    alwaysQuote: text.includes(phrases.alwaysQuote),
    restate: text.includes(phrases.restate),
  };
}

function pricesFrom(text: string): Record<string, number> {
  const prices: Record<string, number> = {};
  for (const item of CATALOG) {
    const match = text.match(new RegExp(`${item.sku}[^\\n$]*\\$(\\d+)`));
    if (match?.[1]) prices[item.sku] = Number(match[1]);
  }
  return prices;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Deterministic stand-in for a sales model.
 * It prices from the catalog written in the harness, and it changes behavior
 * only when a known phrase is present. It is not a language model.
 */
export function scriptedReply(harness: Harness, lead: string): Reply {
  const text = harnessText(harness);
  const flags = flagsFrom(text);
  const prices = pricesFrom(text);
  const parsed = parseLead(lead, flags);
  const notes: string[] = [];
  if (flags.restate) notes.push(`Request: ${lead}`);

  const unknownOnly = parsed.unknown.length > 0 && parsed.requests.length === 0;
  if (unknownOnly) {
    if (flags.alwaysQuote || !flags.noInvent) {
      return {
        decision: "quote",
        items: [{ sku: "Custom", qty: 1, unitPrice: 99 }],
        total: 99,
        notes: [...notes, "Quoted a custom equivalent at $99."],
      };
    }
    const name = parsed.unknown[0] ?? "that item";
    return {
      decision: "decline",
      items: [],
      total: null,
      notes: [...notes, `${name} is not in the catalog.`],
    };
  }

  const floor = parsed.requests.find((item) => item.sku === "Floor");
  if (flags.seatMinimum && floor && floor.qty < 5 && !flags.alwaysQuote) {
    if (flags.annual) notes.push("Floor is billed annually, not monthly.");
    notes.push("The Floor plan requires at least 5 seats.");
    return { decision: "decline", items: [], total: null, notes };
  }

  let requests = parsed.requests;
  let decision: Decision = "quote";
  if (flags.budget && parsed.budget != null) {
    const budget = parsed.budget;
    const omitted: string[] = [];
    requests = requests.filter((item) => {
      const price = prices[item.sku] ?? 0;
      if (price > budget) {
        omitted.push(item.sku);
        return false;
      }
      return true;
    });
    if (omitted.length > 0) {
      decision = "counter";
      notes.push(`${omitted.join(", ")} is over the stated budget.`);
    }
  }

  const items: LineItem[] = requests.map((item) => {
    let unit = prices[item.sku] ?? 0;
    if (item.sku === "Floor" && flags.annual) unit *= 12;
    if (parsed.discountPct != null && !flags.noDiscount) {
      unit = (unit * (100 - parsed.discountPct)) / 100;
    }
    return { sku: item.sku, qty: item.qty, unitPrice: roundMoney(unit) };
  });

  if (flags.annual && items.some((item) => item.sku === "Floor")) {
    notes.push("Floor is billed annually, not monthly.");
  }
  if (flags.noDiscount && parsed.discountPct != null) {
    notes.push("Quoted at list price only; we do not discount.");
  }
  if (items.some((item) => item.sku === "Rise") && parsed.wantsFriday) {
    if (flags.leadTime) {
      if (decision === "quote") decision = "counter";
      notes.push("Rise ships in 14 days and cannot arrive by Friday.");
    } else {
      notes.push("We can deliver by Friday.");
    }
  }

  if (items.length === 0) {
    return { decision: "decline", items: [], total: null, notes };
  }
  const total = roundMoney(items.reduce((sum, item) => sum + item.qty * item.unitPrice, 0));
  return { decision, items, total, notes };
}

export class ScriptedModel implements Model {
  async complete(request: ModelRequest): Promise<string> {
    return JSON.stringify(scriptedReply(request.harness, request.lead));
  }
}

/**
 * Optional real-model adapter. The demo and the tests never construct it.
 * `HARNESS_MODEL=openai` selects it; `OPENAI_API_KEY` is required.
 */
export class OpenAIModel implements Model {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async complete(request: ModelRequest): Promise<string> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        messages: [
          { role: "system", content: renderHarness(request.harness) },
          { role: "user", content: request.lead },
        ],
      }),
    });
    if (!response.ok) {
      throw new Error(`OpenAI request failed (${response.status})`);
    }
    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error("OpenAI response had no content");
    return content;
  }
}

export function createModel(env: Record<string, string | undefined>): Model {
  if (env.HARNESS_MODEL === "openai") {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is required when HARNESS_MODEL=openai");
    return new OpenAIModel(apiKey, env.OPENAI_MODEL ?? "gpt-4o-mini");
  }
  return new ScriptedModel();
}
