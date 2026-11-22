import { describe, expect, it } from "vitest";
import { grade } from "../src/grader.js";
import { taskById, tasks } from "../src/tasks/tasks.js";
import type { Reply, Task } from "../src/types.js";

function golden(task: Task): Reply {
  return {
    decision: task.expect.decision,
    items: task.expect.items.map((item) => ({ ...item })),
    total: task.expect.total,
    notes: [...task.expect.notesInclude],
  };
}

describe("grader", () => {
  it("scores a reply that matches the answer key at 100", () => {
    for (const task of tasks) {
      expect(grade(task, golden(task)).score, task.id).toBe(100);
    }
  });

  it("gives partial credit instead of an all-or-nothing mark", () => {
    const task = taskById("dozen-headsets");
    const reply: Reply = {
      decision: "quote",
      items: [{ sku: "Quiet", qty: 1, unitPrice: 129 }],
      total: 129,
      notes: [],
    };
    const result = grade(task, reply);
    expect(result.checks.map((check) => check.passed)).toEqual([true, false, false]);
    expect(result.score).toBe(33);
  });

  it("fails a note the lead must not contain", () => {
    const task = taskById("coffee-machine");
    const reply = golden(task);
    reply.notes = ["coffee machine is not in the catalog.", "Quoted a custom equivalent at $99."];
    const result = grade(task, reply);
    const absent = result.checks.find((check) => check.name.startsWith("absent:"));
    expect(absent?.passed).toBe(false);
    expect(result.score).toBeLessThan(100);
  });

  it("treats a wrong decision as a failed check", () => {
    const task = taskById("simple-lamps");
    const reply = golden(task);
    reply.decision = "decline";
    expect(grade(task, reply).score).toBeLessThan(100);
  });
});
