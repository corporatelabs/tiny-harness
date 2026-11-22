import { product } from "../catalog.js";
import type { LineItem, Task } from "../types.js";

function item(sku: string, qty: number, unitPrice = product(sku).price): LineItem {
  return { sku, qty, unitPrice };
}

/**
 * Fixed inbound leads. `expect` is the hidden answer key used only by the grader.
 */
export const tasks: Task[] = [
  {
    id: "simple-lamps",
    lead: "Please quote 2 Lumen desk lamps.",
    expect: {
      decision: "quote",
      items: [item("Lumen", 2)],
      total: 98,
      notesInclude: [],
      notesExclude: [],
    },
  },
  {
    id: "dozen-headsets",
    lead: "We need a dozen Quiet headsets for the support team.",
    expect: {
      decision: "quote",
      items: [item("Quiet", 12)],
      total: 12 * product("Quiet").price,
      notesInclude: [],
      notesExclude: [],
    },
  },
  {
    id: "scratch-arms",
    lead: "Quote 4 Arc monitor arms and 2 Lumen lamps. Scratch 1 arm.",
    expect: {
      decision: "quote",
      items: [item("Arc", 3), item("Lumen", 2)],
      total: 3 * product("Arc").price + 2 * product("Lumen").price,
      notesInclude: [],
      notesExclude: [],
    },
  },
  {
    id: "floor-too-small",
    lead: "Please quote the Floor plan for 3 seats.",
    expect: {
      decision: "decline",
      items: [],
      total: null,
      notesInclude: ["at least 5"],
      notesExclude: [],
    },
  },
  {
    id: "coffee-machine",
    lead: "Can you quote a coffee machine for the kitchen?",
    expect: {
      decision: "decline",
      items: [],
      total: null,
      notesInclude: ["not in the catalog"],
      notesExclude: ["custom equivalent"],
    },
  },
  {
    id: "friday-desk",
    lead: "We need one Rise standing desk delivered by Friday.",
    expect: {
      decision: "counter",
      items: [item("Rise", 1)],
      total: product("Rise").price,
      notesInclude: ["14 days"],
      notesExclude: ["can deliver by Friday"],
    },
  },
  {
    id: "discount-headsets",
    lead: "I'll take 4 Quiet headsets if you do 50% off.",
    expect: {
      decision: "quote",
      items: [item("Quiet", 4)],
      total: 4 * product("Quiet").price,
      notesInclude: ["do not discount"],
      notesExclude: [],
    },
  },
  {
    id: "budget-desk",
    lead: "Our budget is $200. We want a Rise desk and a Lumen lamp.",
    expect: {
      decision: "counter",
      items: [item("Lumen", 1)],
      total: product("Lumen").price,
      notesInclude: ["over the stated budget"],
      notesExclude: [],
    },
  },
  {
    id: "floor-four-monthly",
    lead: "4 people want Floor, billed monthly.",
    expect: {
      decision: "decline",
      items: [],
      total: null,
      notesInclude: ["at least 5", "billed annually"],
      notesExclude: [],
    },
  },
];

export function taskById(id: string): Task {
  const found = tasks.find((task) => task.id === id);
  if (!found) throw new Error(`Unknown task ${id}`);
  return found;
}
