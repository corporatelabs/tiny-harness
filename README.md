# Tiny Harness

A small TypeScript sales agent that qualifies an inbound lead and drafts a quote from a five-product catalog. The model is frozen. What changes is the harness around it: a system prompt, guardrails, and skill notes.

The loop is a minimal demo of [Harness²](https://arxiv.org/abs/2610.14224) (Xu et al., arXiv:2610.14224). For each lead it runs the current harness once, proposes an invariant edit and a domain edit, probes each candidate on that same lead, and keeps an edit only when the probe score supports it. A lesson library carries adopted domain rules to later leads.

The executor is a deterministic stand-in, not a language model. It follows a fixed set of phrases in the harness text. The scores show that mechanism. They are not a benchmark, and they are not a reproduction of the paper's results.

## Quickstart

Node 22 or newer. No API key.

```bash
npm ci
npm run typecheck
npm test
npm run demo
```

`npm run demo` always uses the scripted model. It does not read `OPENAI_API_KEY`.

## What the demo shows

Three arms, same nine leads, each starting from the baseline harness:

| Arm | What it does |
| --- | --- |
| Baseline | One run. No edits. |
| No probe | Propose an invariant edit and a domain edit from the reference reply, then adopt both without running them. No lesson library. |
| Harness² | Probe the reference, each edit, and the merge. Keep the candidate with the best probe score. Ties keep fewer edits. Adopted domain rules become lessons for later leads. |

The stand-in reaches a perfect score once a needed phrase is actually in the harness, so Harness²'s mean of 100 is the ceiling of this toy. It gets there because probe scores select the edits, which you can see in the per-lead traces. Two leads are the point of the loop:

- **coffee-machine.** The baseline already refuses an item that is not in the catalog (100). The editor treats "no total" as a failed close and proposes a rule that invents a $99 custom item. That probe scores 0, so Harness² keeps the baseline. The no-probe arm adopts the rule and drops to 0.
- **floor-four-monthly.** The editor may propose only one new domain rule. An earlier lead has already stored "Floor requires 5 seats." With that lesson, the domain edit also adds annual billing, and the probe of that combined edit scores 100. Without the library the same lead stops at the seat rule and scores 80. The no-probe arm never stores the lesson, so it stays at 80.

No-probe still raises the average, because most of its edits are useful. The coffee lead is why a higher average is not a reason to skip the probe.

## Architecture

```
src/harness/     baseline harness and the phrase catalog (plain data)
src/agent.ts     one executor call; a bad completion becomes a decline
src/model.ts     Model interface, scripted stand-in, optional OpenAI adapter
src/loop.ts      propose, probe, compose, lesson library, three arms
src/tasks/       the fixed leads and their hidden answer keys
src/grader.ts    deterministic partial-credit grader
src/demo.ts      baseline vs no-probe vs Harness²
```

`src/catalog.ts` is the price list the grader treats as ground truth. The executor uses those SKUs to recognize a product, then reads the dollar amount from the skill text, so a harness that lists a different price quotes a different price.

Each Harness² lead starts again from the baseline files. The library does not silently rewrite the harness between leads. It only gives the proposer rules that earlier probes already supported. The proposer sees the lead and the reference reply. It does not see the answer key. The composer sees probe scores from the grader and nothing about which rule "should" win.

Invariant edits are appended to guardrails. Domain edits are appended to skills.

## The stand-in

`ScriptedModel` returns quote JSON. Behavior changes only when the harness contains a phrase from `src/harness/phrases.ts`, for example the Floor seat minimum, annual billing, or "do not discount." The scripted editor proposes those same phrases from a checklist: at most one new domain rule, plus any stored lesson whose keyword appears in the lead.

The checklist is a stand-in for a strong editor, and it is not careful. On a refusal it proposes "always quote a custom equivalent at $99." `chooseByProbeScore` is ordinary comparison:

1. Highest probe score.
2. Fewer edits on a tie, so a neutral "restate the lead" rule is not kept.

There is no table of per-lead outcomes in the loop. The coffee regression and the Floor lesson fall out of those rules.

This is stricter than the paper in one place and weaker everywhere else. The paper's composer has no answer key. It compares behavior. This sample lets the composer see the deterministic grader, because a cheap check you already have (a total, a schema, a fixture) is worth using before you adopt a prompt edit. The paper's editor, executor, and harness are frontier-scale. Nothing here measures those.

## Optional real model

`createModel({ HARNESS_MODEL: "openai", OPENAI_API_KEY, OPENAI_MODEL })` sends the harness and the lead to the OpenAI chat completions API and expects quote JSON back. The adapter covers the executor only. Tests, CI, and `npm run demo` do not call it. Without a key, constructing it throws.

## Limitations

- The executor is a phrase matcher. A real model would not jump to 100 because a sentence was appended, and would not reliably obey it either.
- One invariant candidate and one domain candidate. No parallel k, no second step.
- The editor is a fixed checklist with a fixed priority. It can miss a second gap unless a lesson already covers the first.
- The composer sees grader scores. A verifier-free judge, as in the paper, is a different and harder problem.
- Nine hand-written leads and five products. Partial credit is a handful of checks (decision, line items, total, notes).
- Lessons match on keywords in the lead text. That is enough for this catalog and brittle beyond it.
- No tools, retrieval, or multi-file workspace. The harness is three lists of strings.

## License

MIT.
