import { describe, expect, it } from "vitest";
import { runAgent } from "../src/agent.js";
import { grade } from "../src/grader.js";
import { baselineHarness } from "../src/harness/baseline.js";
import { phrases } from "../src/harness/phrases.js";
import { applyEdits } from "../src/loop.js";
import { ScriptedModel } from "../src/model.js";
import { probeSignal } from "../src/probe.js";
import { taskById } from "../src/tasks/tasks.js";
import type { Reply } from "../src/types.js";

const model = new ScriptedModel();

describe("probe signal", () => {
  it("scores from catalog, arithmetic, and the lead text", () => {
    const lead = taskById("dozen-headsets").lead;
    const reply: Reply = {
      decision: "quote",
      items: [{ sku: "Quiet", qty: 1, unitPrice: 129 }],
      total: 129,
      notes: [],
    };
    const score = probeSignal(lead, reply);
    expect(score.checks.map((check) => check.name)).toEqual([
      "schema",
      "known-skus",
      "list-price",
      "arithmetic",
      "seat-minimum",
      "annual-billing",
      "budget",
      "deadline",
      "stated-quantities",
      "catalog-coverage",
    ]);
    expect(score.checks.find((check) => check.name === "stated-quantities")?.passed).toBe(false);
    expect(score.checks.find((check) => check.name === "arithmetic")?.passed).toBe(true);
  });

  it("rejects a catalog SKU whose total does not add up", () => {
    const lead = "Please quote 2 Lumen desk lamps.";
    const broken: Reply = {
      decision: "quote",
      items: [{ sku: "Lumen", qty: 2, unitPrice: 49 }],
      total: 1,
      notes: [],
    };
    const sound: Reply = { ...broken, total: 98 };
    expect(probeSignal(lead, broken).checks.find((check) => check.name === "arithmetic")?.passed).toBe(false);
    expect(probeSignal(lead, sound).score).toBe(100);
    expect(probeSignal(lead, broken).score).toBeLessThan(100);
  });

  it("rejects an invented SKU and a discounted list price", () => {
    const coffee = taskById("coffee-machine").lead;
    const invented: Reply = {
      decision: "quote",
      items: [{ sku: "Custom", qty: 1, unitPrice: 99 }],
      total: 99,
      notes: ["Quoted a custom equivalent at $99."],
    };
    const declined: Reply = {
      decision: "decline",
      items: [],
      total: null,
      notes: ["coffee machine is not in the catalog."],
    };
    expect(probeSignal(coffee, invented).score).toBeLessThan(probeSignal(coffee, declined).score);

    const discount = taskById("discount-headsets").lead;
    const half: Reply = {
      decision: "quote",
      items: [{ sku: "Quiet", qty: 4, unitPrice: 64.5 }],
      total: 258,
      notes: [],
    };
    expect(probeSignal(discount, half).checks.find((check) => check.name === "list-price")?.passed).toBe(false);
  });

  it("treats a dozen and a scratch as constraints written in the lead", async () => {
    const dozen = taskById("dozen-headsets");
    const one = await runAgent(model, baselineHarness, dozen.lead);
    const twelve = await runAgent(
      model,
      applyEdits(baselineHarness, [
        { scope: "domain", rules: [{ id: "word-numbers", text: phrases.wordNumbers, keywords: [] }] },
      ]),
      dozen.lead,
    );
    expect(probeSignal(dozen.lead, one).score).toBeLessThan(probeSignal(dozen.lead, twelve).score);

    const scratch = taskById("scratch-arms");
    const kept = await runAgent(model, baselineHarness, scratch.lead);
    const reduced = await runAgent(
      model,
      applyEdits(baselineHarness, [
        { scope: "domain", rules: [{ id: "cancellations", text: phrases.cancellations, keywords: [] }] },
      ]),
      scratch.lead,
    );
    expect(probeSignal(scratch.lead, kept).score).toBeLessThan(probeSignal(scratch.lead, reduced).score);
  });

  it("can pass while the hidden grader does not, when a required sentence is missing", async () => {
    const task = taskById("floor-four-monthly");
    const reply = await runAgent(
      model,
      applyEdits(baselineHarness, [
        { scope: "domain", rules: [{ id: "seat-minimum", text: phrases.seatMinimum, keywords: ["floor"] }] },
      ]),
      task.lead,
    );
    expect(probeSignal(task.lead, reply).score).toBe(100);
    expect(grade(task, reply).score).toBe(80);
  });
});
