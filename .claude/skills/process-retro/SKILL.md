---
name: process-retro
description: >
  Review a completed PixInsight processing run and turn it into concrete improvements to the
  knowledge base. Use after a run when the user pastes a transcript and/or their notes and wants
  to "learn from this run", "analyze what went wrong", "improve the pipeline", or run a training
  iteration. Reads the current playbook + skill + journal, types every finding, applies the safe
  fixes, queues the rest, and appends a dated entry to docs/PROCESSING_JOURNAL.md.
---

# Process retro — learn from a run

You are closing the loop on a processing run: transcript + the user's observations in, concrete
improvements out. The goal is that the **next** run is measurably less painful and less wrong.

## Inputs
- The run transcript (the user pastes it).
- The user's own notes/observations (often sharper than the transcript — weight them heavily; the
  user is at the machine and sees the actual image, which you did not).

## Step 1 — load current state (do not skip)
Read, in full: `CLAUDE.md`, the run's playbook (`docs/workflows/<category>.md`), the
`process-master` skill, and `docs/PROCESSING_JOURNAL.md`. You are editing these; know what they say.

## Step 2 — extract and TYPE every finding
List every issue from the transcript and the user's notes. Tag each with exactly one type — this
classification is the entire value of the exercise:

- **`[correctness]`** — the agent did something technically wrong: bad API, wrong assumption,
  swallowed error, misread state. *The knowledge was available or knowable; execution was wrong.*
- **`[tooling]`** — a task was painful or impossible because a tool is missing or inadequate
  (timeouts, no undo, no measurement primitive, silent no-ops). *No prompt wording fixes this; it
  needs a tool.*
- **`[quality]`** — the **recommended process** produced a poor image (dim stretch, wrong color,
  over-aggressive setting). *The playbook itself is wrong or thin here.*
- **`[method]`** — the measure/verify loop was flawed (wrong metric, verified the wrong thing).

If a finding feels like two types, split it. "The stretch was dim AND I had to undo it by hand" is
`[quality]` (dim) + `[tooling]` (no undo).

## Step 3 — apply what's safe, queue what needs research
- **`[correctness]` / `[method]`** → edit `process-master` / `CLAUDE.md` / the playbook directly so
  it can't recur. Cite the run evidence in the edit or commit. These are the cheap, high-value wins.
- **`[tooling]`** → add or sharpen an item in the journal's **Tooling backlog** with the concrete
  symptom + the proposed tool + a priority. Do **not** paper over a missing tool with more prompt
  instructions — that just moves the cost to every future run.
- **`[quality]`** → add an **Open research question** to the journal: what to research and why.
  **Never invent replacement processing numbers to "fix" a quality issue.** A good stretch value is
  a research output, not a guess — that is the project's core rule (measure → configure → verify,
  research-backed playbooks). If the user gave a specific correction ("stars need to be much more
  aggressive"), record it as a *constraint for the research*, not as a new hardcoded default.

## Step 4 — append a Run entry to `docs/PROCESSING_JOURNAL.md`
Follow the existing Run-log format: date, category, target/gear, outcome, the typed findings, what
you changed, what's still open. Update the **Current pipeline state** table and the backlog/research
sections if this run shifts them. Keep it tight — it's a working log, not prose.

## Step 5 — report to the user
Concise: what you changed (files + one line each), what you queued (tooling + research), and the
single highest-value next task. Then ask whether to proceed with it.

## Guardrails
- **Separate "the run was painful" from "the output was bad."** Tooling friction and image quality
  are different problems with different owners; fixing one does not fix the other.
- **One run rarely proves a setting.** Note confidence; a single datapoint is a hint, not a law.
- **Newer ≠ better; the user's eyes beat your statistics.** When the numbers said "fine" but the
  user saw "bad" (or vice versa), trust the user and fix your metric.
- **Don't fabricate.** Quality fixes are research tasks, full stop.
