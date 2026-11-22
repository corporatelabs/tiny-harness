# Tiny Harness

![Tiny Harness](docs/assets/hero.png)

A small TypeScript sales agent that qualifies an inbound lead and drafts a quote from a five-product catalog. The model is frozen. What changes is the harness around it: a system prompt, guardrails, and skill notes.

The loop is a minimal demo of [Harness²](https://arxiv.org/abs/2610.14224) (Xu et al., arXiv:2610.14224). For each lead it runs the current harness once, proposes an invariant edit and a domain edit, probes each candidate on that same lead, and keeps an edit only when the probe score supports it. A lesson library carries adopted domain rules to later leads.

The executor is a deterministic stand-in, not a language model. It follows a fixed set of phrases in the harness text. The scores show that mechanism. They are not a benchmark, and they are not a reproduction of the paper's results.

The probe does not see the answer key. It checks things a runtime checker can see: the reply matches the quote schema, SKUs and list prices match the catalog, line items add up, catalog policy holds (Floor's 5-seat minimum and annual billing, Rise's 14-day lead time), and constraints written in the lead are respected (a dozen, a scratch, a budget, a Friday deadline, a product that is not sold). The hidden grader in `src/grader.ts` compares the reply to a per-lead answer key and is used only to report the three arms.

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
| Harness² | Probe the reference, each edit, and the merge with the proxy. Keep the best proxy score. Ties keep fewer edits. Adopted domain rules become lessons for later leads. |

`npm run demo` prints two different numbers. The table is the hidden answer key. The traces are the proxy the composer actually used. On this stand-in the answer-key means are baseline **36.8**, no probe **86.7**, Harness² **100**. Harness² still reports 100 because the mistakes in these leads (a dozen read as one, a scratch ignored, a $99 invented SKU, a price under the catalog) are visible to the proxy, so the proxy ranks the same edits the answer key likes. That agreement is a property of this toy. It is not the composer reading the key.

The two scorers do come apart:

- On seven baseline leads the proxy is higher than the answer key. A one-headset quote at $129 fails only the proxy's stated-quantity check, so it scores 90. The answer key scores that same reply 33, because the line and the total are both wrong. The reference rows sit at 80 or 90 rather than 100, and the edits that fix the quantity, the scratch, the budget, or the Friday promise probe higher, so compose keeps them.
- A Floor refusal that cites the 5-seat minimum and says nothing about annual billing probes at **100** and grades at **80**. The full run still grades `floor-four-monthly` at 100, because an earlier lesson is already inside that domain edit. The probe did not ask for the extra sentence. Without the library the same lead stops at the seat rule: proxy 100, answer key 80. The no-probe arm never stores the lesson, so it stays at 80.

Two leads are why the probe exists:

- **coffee-machine.** The baseline refusal grades at 100 and probes at 100. The editor treats "no total" as a failed close and proposes a rule that invents a $99 custom item. That probe scores 60, so Harness² keeps the baseline. The no-probe arm adopts the rule and the answer key drops to 0.
- **floor-four-monthly.** One new domain rule per lead. The seat-minimum lesson from an earlier lead rides along with annual billing. The proxy accepts that combined edit. The no-probe arm has no library.

No-probe still raises the average, because most of its edits are useful. The coffee lead is why a higher average is not a reason to skip the probe.

## Architecture

```
src/harness/     baseline harness and the phrase catalog (plain data)
src/agent.ts     one executor call; a bad completion becomes a decline
src/model.ts     Model interface, scripted stand-in, optional OpenAI adapter
src/probe.ts     proxy signal: schema, catalog, arithmetic, lead constraints
src/loop.ts      propose, probe, compose, lesson library, three arms
src/tasks/       the fixed leads and their hidden answer keys
src/grader.ts    answer-key grader, used only to report finished replies
src/demo.ts      baseline vs no-probe vs Harness²
```

`src/catalog.ts` holds prices and sales policy (Floor's minimum and annual billing, Rise's lead time). The probe reads that policy. The executor uses the SKUs to recognize a product, then reads the dollar amount from the skill text, so a harness that lists a different price quotes a different price.

Each Harness² lead starts again from the baseline files. The library does not silently rewrite the harness between leads. It only gives the proposer rules that earlier probes already supported. The proposer sees the lead and the reference reply. The composer sees proxy scores. Neither is given `task.expect`. The arms call the answer-key grader once per lead, after selection, to fill the table.

Invariant edits are appended to guardrails. Domain edits are appended to skills.

## The stand-in

`ScriptedModel` returns quote JSON. Behavior changes only when the harness contains a phrase from `src/harness/phrases.ts`, for example the Floor seat minimum, annual billing, or "do not discount." The scripted editor proposes those same phrases from a checklist: at most one new domain rule, plus any stored lesson whose keyword appears in the lead.

The checklist is a stand-in for a strong editor, and it is not careful. On a refusal it proposes "always quote a custom equivalent at $99." `chooseByProbeScore` is ordinary comparison:

1. Highest probe score.
2. Fewer edits on a tie, so a neutral "restate the lead" rule is not kept.

There is no table of per-lead outcomes in the loop. The coffee regression and the Floor lesson fall out of those rules.

The paper's composer has no answer key. It compares behavior. This sample also withholds the answer key from propose, probe, and compose. The proxy is a stronger signal than "did the JSON parse," and a weaker one than the hidden grader: it cannot see required sentences, and a wrong-but-consistent quantity only fails when the lead text itself states the quantity. The paper's editor, executor, and harness are frontier-scale. Nothing here measures those.

## Optional real model

`createModel({ HARNESS_MODEL: "openai", OPENAI_API_KEY, OPENAI_MODEL })` sends the harness and the lead to the OpenAI chat completions API and expects quote JSON back. The adapter covers the executor only. Tests, CI, and `npm run demo` do not call it. Without a key, constructing it throws.

## Limitations

- The executor is a phrase matcher. A real model would not jump to 100 because a sentence was appended, and would not reliably obey it either.
- One invariant candidate and one domain candidate. No parallel k, no second step.
- The editor is a fixed checklist with a fixed priority. It can miss a second gap unless a lesson already covers the first.
- The proxy knows the catalog and can read quantities, budgets, and deadlines in the lead. A real verifier-free judge, looking only at behavior, would miss some of what this proxy catches. The proxy still misses note wording the answer key requires.
- Nine hand-written leads and five products. The reported score is a handful of answer-key checks (decision, line items, total, notes). The probe is a different handful.
- Lessons match on keywords in the lead text. That is enough for this catalog and brittle beyond it.
- No tools, retrieval, or multi-file workspace. The harness is three lists of strings.

## License

MIT.
