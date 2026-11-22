import { describe, expect, it } from "vitest";
import { parseReply, runAgent } from "../src/agent.js";
import { grade } from "../src/grader.js";
import { baselineHarness } from "../src/harness/baseline.js";
import { phrases } from "../src/harness/phrases.js";
import { applyEdits } from "../src/loop.js";
import { createModel, type Model } from "../src/model.js";
import { taskById } from "../src/tasks/tasks.js";
import type { Harness, Lesson } from "../src/types.js";

const model = createModel({});

function withRules(rules: Lesson[]): Harness {
  return applyEdits(baselineHarness, [{ scope: "domain", rules }]);
}

function rule(id: keyof typeof phrases | string, text: string, keywords: string[] = []): Lesson {
  return { id, text, keywords };
}

describe("sales agent", () => {
  it("quotes a straightforward catalog request from the baseline harness", async () => {
    const task = taskById("simple-lamps");
    const reply = await runAgent(model, baselineHarness, task.lead);
    expect(grade(task, reply).score).toBe(100);
    expect(reply.total).toBe(98);
  });

  it("reads prices from the harness text", async () => {
    const harness: Harness = {
      ...baselineHarness,
      skills: baselineHarness.skills.map((line) => line.replace("$49", "$10")),
    };
    const reply = await runAgent(model, harness, "Please quote 2 Lumen desk lamps.");
    expect(reply.items[0]?.unitPrice).toBe(10);
    expect(reply.total).toBe(20);
  });

  it("expands word numbers only when the skill says so", async () => {
    const plain = await runAgent(model, baselineHarness, "We need a dozen Quiet headsets.");
    expect(plain.items[0]?.qty).toBe(1);
    const taught = withRules([rule("word-numbers", phrases.wordNumbers)]);
    const dozen = await runAgent(model, taught, "We need a dozen Quiet headsets.");
    const half = await runAgent(model, taught, "Please quote half a dozen Quiet headsets.");
    const couple = await runAgent(model, taught, "Please quote a couple of Quiet headsets.");
    expect(dozen.items[0]?.qty).toBe(12);
    expect(half.items[0]?.qty).toBe(6);
    expect(couple.items[0]?.qty).toBe(2);
  });

  it("subtracts a scratched item only when the skill says so", async () => {
    const lead = taskById("scratch-arms").lead;
    const plain = await runAgent(model, baselineHarness, lead);
    expect(plain.items.find((item) => item.sku === "Arc")?.qty).toBe(4);
    const taught = withRules([rule("cancellations", phrases.cancellations)]);
    const fixed = await runAgent(model, taught, lead);
    expect(fixed.items.find((item) => item.sku === "Arc")?.qty).toBe(3);
    expect(fixed.total).toBe(3 * 89 + 2 * 49);
  });

  it("declines an undersized Floor plan only when the skill says so", async () => {
    const lead = taskById("floor-too-small").lead;
    const plain = await runAgent(model, baselineHarness, lead);
    expect(plain.decision).toBe("quote");
    expect(plain.total).toBe(57);
    const taught = withRules([rule("seat-minimum", phrases.seatMinimum)]);
    const fixed = await runAgent(model, taught, lead);
    expect(grade(taskById("floor-too-small"), fixed).score).toBe(100);
  });

  it("uses the catalog guardrail, and invents a price when that guardrail is removed", async () => {
    const lead = taskById("coffee-machine").lead;
    const declined = await runAgent(model, baselineHarness, lead);
    expect(grade(taskById("coffee-machine"), declined).score).toBe(100);
    const loose: Harness = { ...baselineHarness, guardrails: ["Be polite and concise."] };
    const invented = await runAgent(model, loose, lead);
    expect(invented.total).toBe(99);
    expect(invented.items[0]?.sku).toBe("Custom");
  });

  it("lets an always-quote guardrail override a correct refusal", async () => {
    const coffee = await runAgent(
      model,
      applyEdits(baselineHarness, [
        { scope: "invariant", rules: [rule("always-quote", phrases.alwaysQuote)] },
      ]),
      taskById("coffee-machine").lead,
    );
    expect(coffee.total).toBe(99);
    const seats = await runAgent(
      model,
      applyEdits(baselineHarness, [
        {
          scope: "domain",
          rules: [rule("seat-minimum", phrases.seatMinimum)],
        },
        { scope: "invariant", rules: [rule("always-quote", phrases.alwaysQuote)] },
      ]),
      taskById("floor-too-small").lead,
    );
    expect(seats.decision).toBe("quote");
    expect(seats.total).toBe(57);
  });

  it("stops promising Friday once the lead-time skill is present", async () => {
    const lead = taskById("friday-desk").lead;
    const plain = await runAgent(model, baselineHarness, lead);
    expect(plain.notes.join(" ")).toContain("can deliver by Friday");
    const taught = withRules([rule("lead-time", phrases.leadTime)]);
    const fixed = await runAgent(model, taught, lead);
    expect(grade(taskById("friday-desk"), fixed).score).toBe(100);
  });

  it("keeps list price once the no-discount skill is present", async () => {
    const lead = taskById("discount-headsets").lead;
    const plain = await runAgent(model, baselineHarness, lead);
    expect(plain.total).toBe(258);
    const taught = withRules([rule("no-discount", phrases.noDiscount)]);
    const fixed = await runAgent(model, taught, lead);
    expect(grade(taskById("discount-headsets"), fixed).score).toBe(100);
  });

  it("drops items over the stated budget only when the skill says so", async () => {
    const lead = taskById("budget-desk").lead;
    const plain = await runAgent(model, baselineHarness, lead);
    expect(plain.total).toBe(448);
    const taught = withRules([rule("budget", phrases.budget)]);
    const fixed = await runAgent(model, taught, lead);
    expect(grade(taskById("budget-desk"), fixed).score).toBe(100);
  });

  it("bills Floor annually when that skill is present and the plan is large enough", async () => {
    const lead = "Quote Floor for 8 people, billed monthly.";
    const plain = await runAgent(model, baselineHarness, lead);
    expect(plain.total).toBe(8 * 19);
    const taught = withRules([rule("annual", phrases.annual)]);
    const fixed = await runAgent(model, taught, lead);
    expect(fixed.total).toBe(8 * 19 * 12);
    expect(fixed.notes.join(" ").toLowerCase()).toContain("billed annually");
  });

  it("satisfies the two-constraint Floor lead only when both skills are present", async () => {
    const task = taskById("floor-four-monthly");
    const seatsOnly = withRules([rule("seat-minimum", phrases.seatMinimum)]);
    const both = withRules([
      rule("seat-minimum", phrases.seatMinimum),
      rule("annual", phrases.annual),
    ]);
    expect(grade(task, await runAgent(model, seatsOnly, task.lead)).score).toBe(80);
    expect(grade(task, await runAgent(model, both, task.lead)).score).toBe(100);
  });

  it("turns an unreadable completion into a decline", async () => {
    const broken: Model = { async complete() { return "sorry, no json here"; } };
    const reply = await runAgent(broken, baselineHarness, "Please quote 2 Lumen desk lamps.");
    expect(reply.decision).toBe("decline");
    expect(reply.notes[0]).toContain("not valid JSON");
  });

  it("parses a JSON reply wrapped in a fence", () => {
    const reply = parseReply('```json\n{"decision":"decline","items":[],"total":null,"notes":["no"]}\n```');
    expect(reply.decision).toBe("decline");
    expect(reply.total).toBeNull();
  });

  it("refuses to construct the OpenAI adapter without a key", () => {
    expect(() => createModel({ HARNESS_MODEL: "openai" })).toThrow(/OPENAI_API_KEY/);
  });
});
