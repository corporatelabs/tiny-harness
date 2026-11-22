/** A quote, a refusal, or a quote that pushes back on the lead. */
export type Decision = "quote" | "decline" | "counter";

export interface LineItem {
  sku: string;
  qty: number;
  unitPrice: number;
}

/** What the sales agent returns. The grader reads this shape and nothing else. */
export interface Reply {
  decision: Decision;
  items: LineItem[];
  total: number | null;
  notes: string[];
}

/**
 * The editable files around the frozen model.
 * Plain data: a system prompt, guardrails, and skill notes.
 */
export interface Harness {
  system: string;
  guardrails: string[];
  skills: string[];
}

/** A lesson the library can carry to a later task. */
export interface Lesson {
  id: string;
  text: string;
  keywords: string[];
}

/** One proposed change. Invariant edits land in guardrails; domain edits land in skills. */
export interface Edit {
  scope: "invariant" | "domain";
  rules: Lesson[];
}

/** Hidden answer key for one lead. The proposer never receives this. */
export interface Expectation {
  decision: Decision;
  items: LineItem[];
  total: number | null;
  notesInclude: string[];
  notesExclude: string[];
}

export interface Task {
  id: string;
  lead: string;
  expect: Expectation;
}

export interface Grade {
  score: number;
  checks: { name: string; passed: boolean }[];
}
