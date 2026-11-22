import { describe, expect, it } from "vitest";
import { baselineHarness } from "../src/harness/baseline.js";
import { phrases } from "../src/harness/phrases.js";
import {
  chooseByProbeScore,
  probeEdits,
  proposeEdits,
  runBaseline,
  runBlind,
  runHarness2,
  type Probe,
  type Proposal,
} from "../src/loop.js";
import { ScriptedModel } from "../src/model.js";
import { taskById, tasks } from "../src/tasks/tasks.js";
import type { Edit, Reply } from "../src/types.js";

const model = new ScriptedModel();

function edit(scope: Edit["scope"], id: string, text: string): Edit {
  return { scope, rules: [{ id, text, keywords: [] }] };
}

function fake(name: Probe["name"], score: number, edits: Edit[]): Probe {
  return {
    name,
    edits,
    reply: { decision: "decline", items: [], total: null, notes: [] },
    grade: { score, checks: [] },
  };
}

const quoted: Reply = {
  decision: "quote",
  items: [{ sku: "Custom", qty: 1, unitPrice: 99 }],
  total: 99,
  notes: [],
};

describe("propose", () => {
  it("proposes a word-number skill when the reference left a dozen as one", async () => {
    const task = taskById("dozen-headsets");
    const reply = await model.complete({ role: "executor", harness: baselineHarness, lead: task.lead });
    const proposal = proposeEdits(task.lead, JSON.parse(reply) as Reply, []);
    expect(proposal.domain?.rules.map((rule) => rule.id)).toEqual(["word-numbers"]);
  });

  it("proposes no domain edit once the dozen is already expanded", () => {
    const lead = taskById("dozen-headsets").lead;
    const reply: Reply = {
      decision: "quote",
      items: [{ sku: "Quiet", qty: 12, unitPrice: 129 }],
      total: 1548,
      notes: [],
    };
    expect(proposeEdits(lead, reply, []).domain).toBeNull();
  });

  it("proposes the harmful always-quote rule from a refusal, not from the task name", () => {
    const lead = taskById("coffee-machine").lead;
    const refused: Reply = { decision: "decline", items: [], total: null, notes: ["not in the catalog"] };
    expect(proposeEdits(lead, refused, []).invariant.rules[0]?.id).toBe("always-quote");
    expect(proposeEdits(lead, refused, []).domain).toBeNull();
    expect(proposeEdits(lead, quoted, []).invariant.rules[0]?.id).toBe("restate");
  });

  it("proposes one fresh domain rule, and stacks a matching lesson in front of it", async () => {
    const task = taskById("floor-four-monthly");
    const raw = await model.complete({ role: "executor", harness: baselineHarness, lead: task.lead });
    const reply = JSON.parse(raw) as Reply;
    const alone = proposeEdits(task.lead, reply, []);
    expect(alone.domain?.rules.map((rule) => rule.id)).toEqual(["seat-minimum"]);
    const withLesson = proposeEdits(task.lead, reply, [
      { id: "seat-minimum", text: phrases.seatMinimum, keywords: ["floor"] },
    ]);
    expect(withLesson.domain?.rules.map((rule) => rule.id)).toEqual(["seat-minimum", "annual"]);
  });
});

describe("probe", () => {
  it("scores the domain candidate above the reference on the dozen lead", async () => {
    const task = taskById("dozen-headsets");
    const raw = await model.complete({ role: "executor", harness: baselineHarness, lead: task.lead });
    const reply = JSON.parse(raw) as Reply;
    const proposal = proposeEdits(task.lead, reply, []);
    const probes = await probeEdits(model, task, baselineHarness, proposal);
    const reference = probes.find((probe) => probe.name === "reference");
    const domain = probes.find((probe) => probe.name === "domain");
    expect(reference?.grade.score).toBe(33);
    expect(domain?.grade.score).toBe(100);
  });
});

describe("compose", () => {
  it("keeps the higher probe score and drops an edit that scores worse", () => {
    const domain = edit("domain", "seat-minimum", phrases.seatMinimum);
    const invariant = edit("invariant", "always-quote", phrases.alwaysQuote);
    const chosen = chooseByProbeScore([
      fake("reference", 60, []),
      fake("invariant", 40, [invariant]),
      fake("domain", 90, [domain]),
      fake("merged", 55, [invariant, domain]),
    ]);
    expect(chosen.name).toBe("domain");
  });

  it("breaks a score tie toward fewer edits, and toward the reference when the edit is neutral", () => {
    const extra = edit("invariant", "restate", phrases.restate);
    const fewer = chooseByProbeScore([
      fake("reference", 100, []),
      fake("invariant", 100, [extra]),
    ]);
    expect(fewer.name).toBe("reference");
  });

  it("rejects the merge when always-quote undoes a seat-minimum refusal", async () => {
    const task = taskById("floor-too-small");
    const proposal: Proposal = {
      invariant: edit("invariant", "always-quote", phrases.alwaysQuote),
      domain: edit("domain", "seat-minimum", phrases.seatMinimum),
    };
    const probes = await probeEdits(model, task, baselineHarness, proposal);
    const domain = probes.find((probe) => probe.name === "domain");
    const merged = probes.find((probe) => probe.name === "merged");
    expect(domain?.grade.score).toBe(100);
    expect(merged?.grade.score).toBeLessThan(100);
    expect(chooseByProbeScore(probes).name).toBe("domain");
  });
});

describe("library and arms", () => {
  it("carries the seat-minimum lesson so the later Floor lead can also learn annual billing", async () => {
    const first = taskById("floor-too-small");
    const second = taskById("floor-four-monthly");
    const harness2 = await runHarness2(model, [first, second], baselineHarness);
    expect(harness2.tasks[0]?.score).toBe(100);
    expect(harness2.tasks[1]?.adopted).toEqual(["seat-minimum", "annual"]);
    expect(harness2.tasks[1]?.score).toBe(100);
    expect(harness2.lessons).toEqual(["seat-minimum", "annual"]);

    const withoutLesson = await runHarness2(model, [second], baselineHarness);
    expect(withoutLesson.tasks[0]?.score).toBe(80);
    expect(withoutLesson.tasks[0]?.adopted).toEqual(["seat-minimum"]);

    const blind = await runBlind(model, [first, second], baselineHarness);
    expect(blind.tasks[1]?.score).toBe(80);
    expect(blind.lessons).toEqual([]);
  });

  it("adopts the coffee refusal's harmful edit only when nobody probes it", async () => {
    const task = taskById("coffee-machine");
    const baseline = await runBaseline(model, [task], baselineHarness);
    const blind = await runBlind(model, [task], baselineHarness);
    const harness2 = await runHarness2(model, [task], baselineHarness);
    expect(baseline.tasks[0]?.score).toBe(100);
    expect(blind.tasks[0]?.score).toBe(0);
    expect(blind.tasks[0]?.adopted).toEqual(["always-quote"]);
    expect(harness2.tasks[0]?.score).toBe(100);
    expect(harness2.tasks[0]?.adopted).toEqual([]);
    const invariant = harness2.tasks[0]?.probes.find((probe) => probe.name === "invariant");
    expect(invariant?.score).toBe(0);
  });

  it("improves the fixed lead set from probe scores, and repeats exactly", async () => {
    const [baseline, blind, harness2, again] = await Promise.all([
      runBaseline(model, tasks, baselineHarness),
      runBlind(model, tasks, baselineHarness),
      runHarness2(model, tasks, baselineHarness),
      runHarness2(model, tasks, baselineHarness),
    ]);
    expect(baseline.tasks.map((task) => task.score)).toEqual([100, 33, 33, 0, 100, 40, 25, 0, 0]);
    expect(blind.tasks.map((task) => task.score)).toEqual([100, 100, 100, 100, 0, 100, 100, 100, 80]);
    expect(harness2.tasks.map((task) => task.score)).toEqual([100, 100, 100, 100, 100, 100, 100, 100, 100]);
    expect(harness2.tasks.map((task) => task.adopted)).toEqual(again.tasks.map((task) => task.adopted));
    expect(harness2.mean).toBeGreaterThan(baseline.mean);
    expect(harness2.mean).toBeGreaterThan(blind.mean);
    const regressed = blind.tasks.filter((task, index) => task.score < (baseline.tasks[index]?.score ?? 0));
    expect(regressed.map((task) => task.id)).toEqual(["coffee-machine"]);
    for (const [index, task] of harness2.tasks.entries()) {
      expect(task.score).toBeGreaterThanOrEqual(baseline.tasks[index]?.score ?? 0);
    }
  });
});
