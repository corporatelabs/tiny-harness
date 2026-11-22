import { pathToFileURL } from "node:url";
import { runAgent } from "./agent.js";
import { grade } from "./grader.js";
import { baselineHarness } from "./harness/baseline.js";
import { phrases } from "./harness/phrases.js";
import { applyEdits, runBaseline, runBlind, runHarness2, type ArmRun, type TaskRun } from "./loop.js";
import { ScriptedModel } from "./model.js";
import { probeSignal } from "./probe.js";
import { tasks } from "./tasks/tasks.js";

/**
 * Before/after on the fixed lead set.
 * Always the scripted model, so `npm run demo` does not read API keys.
 */
export async function main(): Promise<void> {
  const model = new ScriptedModel();
  const [baseline, blind, harness2] = await Promise.all([
    runBaseline(model, tasks, baselineHarness, grade),
    runBlind(model, tasks, baselineHarness, grade),
    runHarness2(model, tasks, baselineHarness, grade),
  ]);

  console.log("Tiny Harness");
  console.log("");
  console.log("Deterministic stand-in model. It follows phrases written in the harness.");
  console.log("These scores illustrate Propose–Probe–Compose. They are not a benchmark.");
  console.log("");
  console.log("Answer-key scores. The loop does not see this grader.");
  console.log(table(baseline, blind, harness2));
  console.log("");
  console.log(regressions(baseline, blind));
  console.log("");
  console.log(proxyGaps(baseline, harness2));
  console.log("");
  console.log(await noteGap(model));
  console.log("");
  console.log(`Lessons carried by Harness²: ${harness2.lessons.join(", ") || "(none)"}`);
  console.log("");
  console.log("Probe traces (proxy only: catalog, arithmetic, and the lead's own constraints).");
  for (const task of harness2.tasks) {
    console.log("");
    console.log(task.id);
    for (const probe of task.probes) {
      const mark = sameChoice(task, probe) ? "  <- adopted" : "";
      const rules = probe.rules.length > 0 ? `  ${probe.rules.join("+")}` : "";
      console.log(`  ${probe.name.padEnd(12)} ${String(probe.score).padStart(3)}${rules}${mark}`);
    }
  }
}

function table(baseline: ArmRun, blind: ArmRun, harness2: ArmRun): string {
  const header = `${"Task".padEnd(22)} ${"Baseline".padStart(8)}  ${"No probe".padStart(8)}  ${"Harness²".padStart(8)}  Adopted`;
  const lines = [header];
  for (let i = 0; i < baseline.tasks.length; i += 1) {
    const base = baseline.tasks[i];
    const skipped = blind.tasks[i];
    const improved = harness2.tasks[i];
    if (!base || !skipped || !improved) continue;
    const adopted = improved.adopted.length > 0 ? improved.adopted.join(", ") : "—";
    lines.push(
      `${base.id.padEnd(22)} ${pad(base.score, 8)}  ${pad(skipped.score, 8)}  ${pad(improved.score, 8)}  ${adopted}`,
    );
  }
  lines.push("");
  lines.push(
    `${"Mean".padEnd(22)} ${pad(baseline.mean, 8)}  ${pad(blind.mean, 8)}  ${pad(harness2.mean, 8)}`,
  );
  return lines.join("\n");
}

function regressions(baseline: ArmRun, blind: ArmRun): string {
  const rows: string[] = [];
  for (let i = 0; i < baseline.tasks.length; i += 1) {
    const base = baseline.tasks[i];
    const skipped = blind.tasks[i];
    if (!base || !skipped || skipped.score >= base.score) continue;
    rows.push(`  ${base.id}  ${base.score} → ${skipped.score}`);
  }
  if (rows.length === 0) return "No-probe regressions: none";
  return ["No-probe regressions:", ...rows].join("\n");
}

function proxyGaps(baseline: ArmRun, harness2: ArmRun): string {
  const rows: string[] = [];
  for (let i = 0; i < baseline.tasks.length; i += 1) {
    const base = baseline.tasks[i];
    const improved = harness2.tasks[i];
    const reference = improved?.probes.find((probe) => probe.name === "reference");
    if (!base || !reference || reference.score === base.score) continue;
    rows.push(`  ${base.id}  answer key ${base.score}, proxy ${reference.score}`);
  }
  if (rows.length === 0) return "Baseline rows where the proxy and the answer key differ: none";
  return ["Baseline rows where the proxy and the answer key differ:", ...rows].join("\n");
}

async function noteGap(model: ScriptedModel): Promise<string> {
  const task = tasks.find((item) => item.id === "floor-four-monthly");
  if (!task) return "Proxy gap example: floor-four-monthly is missing";
  const harness = applyEdits(baselineHarness, [
    { scope: "domain", rules: [{ id: "seat-minimum", text: phrases.seatMinimum, keywords: ["floor"] }] },
  ]);
  const reply = await runAgent(model, harness, task.lead);
  const proxy = probeSignal(task.lead, reply).score;
  const hidden = grade(task, reply).score;
  return `Seat-only Floor refusal on floor-four-monthly: proxy ${proxy}, answer key ${hidden}.`;
}

function sameChoice(task: TaskRun, probe: { name: string; rules: string[] }): boolean {
  if (task.adopted.length === 0) return probe.name === "reference";
  if (probe.rules.length !== task.adopted.length) return false;
  return probe.rules.every((rule, index) => rule === task.adopted[index]);
}

function pad(score: number, width: number): string {
  const text = Number.isInteger(score) ? String(score) : score.toFixed(1);
  return text.padStart(width);
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
