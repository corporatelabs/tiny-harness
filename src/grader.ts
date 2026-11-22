import type { Grade, LineItem, Reply, Task } from "./types.js";

/**
 * Deterministic partial-credit grader.
 * The executor and the proposer never call this. The composer does, as the probe.
 */
export function grade(task: Task, reply: Reply): Grade {
  const notes = reply.notes.join(" ").toLowerCase();
  const checks: { name: string; passed: boolean }[] = [
    { name: "decision", passed: reply.decision === task.expect.decision },
    { name: "items", passed: sameItems(reply.items, task.expect.items) },
    { name: "total", passed: reply.total === task.expect.total },
  ];
  for (const phrase of task.expect.notesInclude) {
    checks.push({ name: `note:${phrase}`, passed: notes.includes(phrase.toLowerCase()) });
  }
  for (const phrase of task.expect.notesExclude) {
    checks.push({ name: `absent:${phrase}`, passed: !notes.includes(phrase.toLowerCase()) });
  }
  const passed = checks.filter((check) => check.passed).length;
  const score = checks.length === 0 ? 0 : Math.round((passed / checks.length) * 100);
  return { score, checks };
}

function sameItems(actual: LineItem[], expected: LineItem[]): boolean {
  const key = (item: LineItem) => `${item.sku}:${item.qty}:${item.unitPrice}`;
  const left = actual.map(key).sort();
  const right = expected.map(key).sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
