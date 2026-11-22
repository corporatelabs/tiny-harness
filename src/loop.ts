import { runAgent } from "./agent.js";
import { grade } from "./grader.js";
import { phrases } from "./harness/phrases.js";
import { DOMAIN_RULES } from "./harness/rules.js";
import type { Model } from "./model.js";
import type { Edit, Grade, Harness, Lesson, Reply, Task } from "./types.js";

/**
 * Propose–Probe–Compose, plus a lesson library.
 * The composer keeps the probed candidate with the highest grader score.
 * A tie breaks toward fewer edits, so a neutral edit is not adopted.
 * The proposer never sees the grader.
 */

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
  grade: Grade;
}

const NAME_RANK: Record<Probe["name"], number> = {
  reference: 0,
  domain: 1,
  invariant: 2,
  merged: 3,
};

/** Adopt the probe the grader supports. Fewer edits win a tie. */
export function chooseByProbeScore(probes: readonly Probe[]): Probe {
  const ranked = [...probes].sort((a, b) => {
    if (a.grade.score !== b.grade.score) return b.grade.score - a.grade.score;
    if (a.edits.length !== b.edits.length) return a.edits.length - b.edits.length;
    return NAME_RANK[a.name] - NAME_RANK[b.name];
  });
  const best = ranked[0];
  if (!best) throw new Error("chooseByProbeScore requires at least one probe");
  return best;
}

export async function probeEdits(
  model: Model,
  task: Task,
  harness: Harness,
  proposal: Proposal,
  reference?: { reply: Reply; grade: Grade },
): Promise<Probe[]> {
  const reply = reference?.reply ?? (await runAgent(model, harness, task.lead));
  const probes: Probe[] = [
    {
      name: "reference",
      edits: [],
      reply,
      grade: reference?.grade ?? grade(task, reply),
    },
  ];
  const candidates: { name: Probe["name"]; edits: Edit[] }[] = [
    { name: "invariant", edits: [proposal.invariant] },
  ];
  if (proposal.domain) {
    candidates.push({ name: "domain", edits: [proposal.domain] });
    candidates.push({ name: "merged", edits: [proposal.invariant, proposal.domain] });
  }
  for (const candidate of candidates) {
    const next = applyEdits(harness, candidate.edits);
    const candidateReply = await runAgent(model, next, task.lead);
    probes.push({
      name: candidate.name,
      edits: candidate.edits,
      reply: candidateReply,
      grade: grade(task, candidateReply),
    });
  }
  return probes;
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

/** One run of the base harness. No edits. */
export async function runBaseline(model: Model, taskList: readonly Task[], harness: Harness): Promise<ArmRun> {
  const tasks: TaskRun[] = [];
  for (const task of taskList) {
    const reply = await runAgent(model, harness, task.lead);
    tasks.push({ id: task.id, score: grade(task, reply).score, adopted: [], probes: [] });
  }
  return finish("baseline", tasks, []);
}

/**
 * Propose the same way, then adopt every edit without probing.
 * Lessons are not carried. This is the "edit without execution" arm.
 */
export async function runBlind(model: Model, taskList: readonly Task[], harness: Harness): Promise<ArmRun> {
  const tasks: TaskRun[] = [];
  for (const task of taskList) {
    const reply = await runAgent(model, harness, task.lead);
    const proposal = proposeEdits(task.lead, reply, []);
    const edits = [proposal.invariant, ...(proposal.domain ? [proposal.domain] : [])];
    const adopted = applyEdits(harness, edits);
    const finalReply = await runAgent(model, adopted, task.lead);
    tasks.push({
      id: task.id,
      score: grade(task, finalReply).score,
      adopted: ruleIds(edits),
      probes: [],
    });
  }
  return finish("no-probe", tasks, []);
}

/** Propose, probe the reference and each candidate, compose by probe score, keep lessons. */
export async function runHarness2(model: Model, taskList: readonly Task[], harness: Harness): Promise<ArmRun> {
  let library: Lesson[] = [];
  const tasks: TaskRun[] = [];
  for (const task of taskList) {
    const reply = await runAgent(model, harness, task.lead);
    const proposal = proposeEdits(task.lead, reply, library);
    const probes = await probeEdits(model, task, harness, proposal, {
      reply,
      grade: grade(task, reply),
    });
    const chosen = chooseByProbeScore(probes);
    for (const edit of chosen.edits) {
      if (edit.scope !== "domain") continue;
      for (const rule of edit.rules) {
        if (!library.some((lesson) => lesson.id === rule.id)) library = [...library, toLesson(rule)];
      }
    }
    tasks.push({
      id: task.id,
      score: chosen.grade.score,
      adopted: ruleIds(chosen.edits),
      probes: probes.map((probe) => ({
        name: probe.name,
        score: probe.grade.score,
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
