import { runAgent } from "./agent.js";
import { phrases } from "./harness/phrases.js";
import { DOMAIN_RULES } from "./harness/rules.js";
import type { Model } from "./model.js";
import { probeSignal, type ProbeScore } from "./probe.js";
import type { Edit, Grade, Harness, Lesson, Reply, Task } from "./types.js";

/**
 * Propose–Probe–Compose, plus a lesson library.
 * The composer keeps the candidate with the best proxy score.
 * A tie breaks toward fewer edits, so a neutral edit is not adopted.
 * Reporting functions take an answer-key grader and call it only after selection.
 */

/** Scores a finished reply against the hidden answer key. Selection must not call it. */
export type AnswerKeyGrader = (task: Task, reply: Reply) => Grade;

export interface Proposal {
  invariant: Edit;
  domain: Edit | null;
}

export function proposeEdits(lead: string, reply: Reply, library: Lesson[]): Proposal {
  const relevant = library.filter((lesson) =>
    lesson.keywords.some((keyword) => lead.toLowerCase().includes(keyword.toLowerCase())),
  );
  const seen = new Set(relevant.map((lesson) => lesson.id));
  const fresh = DOMAIN_RULES.find((rule) => !seen.has(rule.id) && rule.violated(lead, reply));
  const rules = dedupe([
    ...relevant.map(toLesson),
    ...(fresh ? [toLesson(fresh)] : []),
  ]);
  return {
    invariant: proposeInvariant(reply),
    domain: rules.length > 0 ? { scope: "domain", rules } : null,
  };
}

function proposeInvariant(reply: Reply): Edit {
  // A decline with no total looks, to this editor, like a failed close.
  // That guess is often wrong. Probing is what drops it.
  if (reply.decision !== "quote" && reply.total == null) {
    return {
      scope: "invariant",
      rules: [{ id: "always-quote", text: phrases.alwaysQuote, keywords: [] }],
    };
  }
  return {
    scope: "invariant",
    rules: [{ id: "restate", text: phrases.restate, keywords: [] }],
  };
}

function toLesson(rule: Lesson): Lesson {
  return { id: rule.id, text: rule.text, keywords: [...rule.keywords] };
}

function dedupe(rules: Lesson[]): Lesson[] {
  const seen = new Set<string>();
  const out: Lesson[] = [];
  for (const rule of rules) {
    if (seen.has(rule.id)) continue;
    seen.add(rule.id);
    out.push(rule);
  }
  return out;
}

export function applyEdits(harness: Harness, edits: Edit[]): Harness {
  const next: Harness = {
    system: harness.system,
    guardrails: [...harness.guardrails],
    skills: [...harness.skills],
  };
  for (const edit of edits) {
    const bucket = edit.scope === "invariant" ? next.guardrails : next.skills;
    for (const rule of edit.rules) {
      if (!bucket.includes(rule.text)) bucket.push(rule.text);
    }
  }
  return next;
}

export interface Probe {
  name: "reference" | "invariant" | "domain" | "merged";
  edits: Edit[];
  reply: Reply;
  signal: ProbeScore;
}

const NAME_RANK: Record<Probe["name"], number> = {
  reference: 0,
  domain: 1,
  invariant: 2,
  merged: 3,
};

/** Adopt the candidate the proxy supports. Fewer edits win a tie. */
export function chooseByProbeScore(probes: readonly Probe[]): Probe {
  const ranked = [...probes].sort((a, b) => {
    if (a.signal.score !== b.signal.score) return b.signal.score - a.signal.score;
    if (a.edits.length !== b.edits.length) return a.edits.length - b.edits.length;
    return NAME_RANK[a.name] - NAME_RANK[b.name];
  });
  const best = ranked[0];
  if (!best) throw new Error("chooseByProbeScore requires at least one probe");
  return best;
}

export async function probeEdits(
  model: Model,
  lead: string,
  harness: Harness,
  proposal: Proposal,
  reference?: Reply,
): Promise<Probe[]> {
  const reply = reference ?? (await runAgent(model, harness, lead));
  const probes: Probe[] = [scored("reference", [], reply, lead)];
  const candidates: { name: Probe["name"]; edits: Edit[] }[] = [
    { name: "invariant", edits: [proposal.invariant] },
  ];
  if (proposal.domain) {
    candidates.push({ name: "domain", edits: [proposal.domain] });
    candidates.push({ name: "merged", edits: [proposal.invariant, proposal.domain] });
  }
  for (const candidate of candidates) {
    const next = applyEdits(harness, candidate.edits);
    const candidateReply = await runAgent(model, next, lead);
    probes.push(scored(candidate.name, candidate.edits, candidateReply, lead));
  }
  return probes;
}

function scored(name: Probe["name"], edits: Edit[], reply: Reply, lead: string): Probe {
  return { name, edits, reply, signal: probeSignal(lead, reply) };
}

export interface Selection {
  proposal: Proposal;
  probes: Probe[];
  chosen: Probe;
}

/**
 * Propose, probe, and compose for one lead.
 * `gradeReply` is injected so a caller can spy on it. This function does not call it.
 */
export async function proposeProbeCompose(
  model: Model,
  lead: string,
  harness: Harness,
  library: Lesson[],
  deps: { gradeReply: AnswerKeyGrader },
): Promise<Selection> {
  if (typeof deps.gradeReply !== "function") throw new Error("gradeReply must be a function");
  const reply = await runAgent(model, harness, lead);
  const proposal = proposeEdits(lead, reply, library);
  const probes = await probeEdits(model, lead, harness, proposal, reply);
  return { proposal, probes, chosen: chooseByProbeScore(probes) };
}

export interface TaskRun {
  id: string;
  score: number;
  adopted: string[];
  probes: { name: string; score: number; rules: string[] }[];
}

export interface ArmRun {
  name: string;
  tasks: TaskRun[];
  mean: number;
  lessons: string[];
}

function ruleIds(edits: readonly Edit[]): string[] {
  return edits.flatMap((edit) => edit.rules.map((rule) => rule.id));
}

function finish(name: string, tasks: TaskRun[], lessons: string[]): ArmRun {
  const mean = tasks.length === 0 ? 0 : tasks.reduce((sum, task) => sum + task.score, 0) / tasks.length;
  return { name, tasks, mean, lessons };
}

/** One run of the base harness. No edits. `gradeReply` only reports the run. */
export async function runBaseline(
  model: Model,
  taskList: readonly Task[],
  harness: Harness,
  gradeReply: AnswerKeyGrader,
): Promise<ArmRun> {
  const tasks: TaskRun[] = [];
  for (const task of taskList) {
    const reply = await runAgent(model, harness, task.lead);
    tasks.push({ id: task.id, score: gradeReply(task, reply).score, adopted: [], probes: [] });
  }
  return finish("baseline", tasks, []);
}

/**
 * Propose the same way, then adopt every edit without probing.
 * Lessons are not carried. This is the "edit without execution" arm.
 */
export async function runBlind(
  model: Model,
  taskList: readonly Task[],
  harness: Harness,
  gradeReply: AnswerKeyGrader,
): Promise<ArmRun> {
  const tasks: TaskRun[] = [];
  for (const task of taskList) {
    const reply = await runAgent(model, harness, task.lead);
    const proposal = proposeEdits(task.lead, reply, []);
    const edits = [proposal.invariant, ...(proposal.domain ? [proposal.domain] : [])];
    const adopted = applyEdits(harness, edits);
    const finalReply = await runAgent(model, adopted, task.lead);
    tasks.push({
      id: task.id,
      score: gradeReply(task, finalReply).score,
      adopted: ruleIds(edits),
      probes: [],
    });
  }
  return finish("no-probe", tasks, []);
}

/** Propose, probe, compose by proxy score, then report the chosen reply with the answer key. */
export async function runHarness2(
  model: Model,
  taskList: readonly Task[],
  harness: Harness,
  gradeReply: AnswerKeyGrader,
): Promise<ArmRun> {
  let library: Lesson[] = [];
  const tasks: TaskRun[] = [];
  for (const task of taskList) {
    const selected = await proposeProbeCompose(model, task.lead, harness, library, { gradeReply });
    for (const edit of selected.chosen.edits) {
      if (edit.scope !== "domain") continue;
      for (const rule of edit.rules) {
        if (!library.some((lesson) => lesson.id === rule.id)) library = [...library, toLesson(rule)];
      }
    }
    tasks.push({
      id: task.id,
      score: gradeReply(task, selected.chosen.reply).score,
      adopted: ruleIds(selected.chosen.edits),
      probes: selected.probes.map((probe) => ({
        name: probe.name,
        score: probe.signal.score,
        rules: ruleIds(probe.edits),
      })),
    });
  }
  return finish(
    "harness2",
    tasks,
    library.map((lesson) => lesson.id),
  );
}
