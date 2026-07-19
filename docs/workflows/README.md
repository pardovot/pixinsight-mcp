# PixInsight processing-workflow knowledge base — build handoff

This directory holds **per-acquisition-category processing playbooks** researched via
multi-agent web-research workflows, verified for recency/evidence. They ground the
autonomous-processing agent (the MCP drives PixInsight; these tell it *how* to process
each kind of data). This README lets a fresh session continue the series at full quality.

> **⚠️ Read `/CLAUDE.md` (repo root) first for the architecture + tool-design decisions.**
> Two things that are easy to regress on and are NOT in this file:
> 1. **Use the generic `run_process(processId, viewId, settings)` + `get_process_parameters`.
>    NEVER add per-process MCP tools** — that anti-pattern was deliberately abandoned.
>    Existing `run_bxt`/`sharpen`/etc. are legacy wrappers only.
> 2. **The end goal is autonomous processing from a SHORT goal-driven prompt** (state the
>    outcome; the agent picks + configures processes, measures, and verifies) — not
>    step-by-step per-process instructions. These playbooks are that agent's knowledge layer.
>
> Also in CLAUDE.md: the non-blocking native C++ module (why PixInsight stays interactive),
> the V8 (not ES5) reality, and the measure→configure→verify methodology.

## Status

| Category | File | Status |
|---|---|---|
| OSC-HOO (duoband) | `osc-hoo.md` | ✅ verified |
| OSC-RGB (broadband) | `osc-rgb.md` | ✅ verified |
| mono-RGB | `mono-rgb.md` | ✅ verified |
| mono-LRGB | `mono-lrgb.md` | ✅ verified |
| mono-HaLRGB | `mono-halrgb.md` | ✅ verified (17-leg re-run; replaced the provisional draft; surfaced PhotometricContinuumSubtraction/PCS Oct-2024) |
| mono-SHO | `mono-sho.md` | ✅ verified (Tier-1 capstone; narrowband palette) |

Tier-2 (later): OSC-SHO/foraxx, hybrid mono-Ha+OSC, dual-scope blends.

## Why the HaLRGB run was provisional
The session hit `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION` (was 200). It's now raised to
**1000** in `~/.claude/settings.json` (`env`), effective next session. So a fresh session
can re-run HaLRGB (verified) and do SHO without hitting the cap.

## The decomposition model (validated across 4 categories)
Do **not** research each workflow as an independent monolith. Decompose into:
- **A shared operation set** (crop, BXT-correct, plate solve, SPFC, gradient/MGC, SPCC, BXT-sharpen, NXT, stretch, color, stars).
- **A combination point** that splits every workflow into **pre-combination (per-channel)** and **post-combination (RGB)** stages.
- **Placement rules**, some fixed, some open:
  - *Fixed:* SPCC is post-combine (needs an RGB image; cannot run on a single mono channel). Palette mapping is at/after combine.
  - *Sensor-dependent:* the per-channel pre-combine stage **exists for mono** (separate filter masters) and for **OSC-duoband after extraction**, but is **absent for OSC-broadband/HOO** (already one RGB image — do NOT split OSC channels by default).
  - *Governing rule (from mono-RGB):* additive+filter-specific (gradients) or geometric (registration, per-filter aberration) → **pre-combine per-channel**; anything solving a relationship across channels (color/flux/chroma) → **post-combine**.
- **Mono SPCC gotcha:** mono uses **real filter curves + real sensor QE**; the OSC "Ideal QE" rule is OSC-ONLY. Never pick a "Sony Color Sensor" entry for mono.

## Conventions (apply to every playbook)
- **Starless / StarXTerminator is an OPTIONAL branch, never a baseline step** (user-confirmed; research agrees — "beneficial not necessary"). Don't bake it into the main order.
- **Evidence grading:** tag each step Confidence (high/med/low) + consensus/contested. Distinguish *objectively better (with evidence)* from *preference*. Newer ≠ better — flag recency traps (e.g. "BXT AI4 is Dec 2023, not a 2025 advance"; "NXT is 2/AI3, not AI4").
- **Never fabricate numeric settings/expressions.** Flag unsourced ones (`[UNSOURCED]` / "drive from image measurement"). Our whole philosophy is measure→configure→verify, so tuning ranges > hard numbers anyway.
- **Answer, don't edit:** if the user asks a clarifying question, answer it — don't change the playbook unless asked.

## The workflow-script pattern (reproduce per category)
Each category = one `Workflow` call. Structure (see prior scripts / the committed playbooks for the realized version):
1. `meta` (pure literal): name, description, phases Research/Verify/Synthesize.
2. `SUBTOPICS` array — one leg per workflow step/module, each `{ key, focus }`. For a new category, keep the shared post-combine legs light and focus new legs on what's *different* (e.g. mono adds registration/LinearFit/ChannelCombination; LRGB adds the L-track + LRGBCombination; HaLRGB adds continuum subtraction + Ha blend; SHO adds palette mapping/SCNR/star handling + linear-vs-nonlinear NB combine).
3. `FINDING` JSON schema: step, (stage/track), recommendation, process, settings[], decisionCriteria, confidence, consensus, recency, objectivelyBetter, contested, sources[{title,url,accessible}], needsBrowser[]. Add a `stage`/`track` enum for multi-stage categories.
4. `VERDICT` schema: step, holdsUp, correction, finalConfidence.
5. `RESEARCH_GUIDE` string baked into every research prompt: the category context + "single image vs per-channel" rules + "prefer 2025-2026 authoritative sources (pixinsight.com, RC Astro, SetiAstro); record 403'd URLs under needsBrowser, do NOT invent; newer≠better; never fabricate settings."
6. `pipeline(SUBTOPICS, research→FINDING, verify→VERDICT)` — research each leg then adversarially verify (recency + evidence-vs-preference + stage correctness).
7. A single `synthesize` agent → the Markdown playbook (structured by stage), + a "what changed & is it better" table + contested list + needsBrowser.
8. **Browser-fallback stage (auto, not manual):** after synthesize, dedup `needsBrowser` and resolve the load-bearing URLs via `claude-in-chrome` — WebFetch/WebSearch 403s are a tool limitation, not a dead end, so the browser should be *dispatched automatically on failure*, not parked in a list for a human. **Constraint:** claude-in-chrome drives ONE shared tab, so this MUST be a **serial post-research stage in the main loop** (or a single dedicated agent) — never inline in the parallel research legs (they'd fight over the browser + spawn permission prompts). Skip a URL only if the fact is already `[SOURCED VERBATIM]` from an accessible mirror (check first — research often captures the formula from a secondary source even when the primary 403s).
9. `return { playbook, needsBrowser, contested, stepCount }`.

Scale ≈ 21-25 agents, ~250-320s, ~500-700k subagent tokens per category. User is on Max; multi-agent is authorized for this series.

## Lean output flow (keeps main context small — use this)
Do NOT read the full ~30-47k-char task output into context. Extract verbatim to the doc:
```
node <<'EOF' with a small script that JSON.parse(outputFile).result.playbook,
prepends a provenance header, writes docs/workflows/<cat>.md, and prints only
size/section sanity checks (chars, heading count, key-section presence, last 120 chars).
EOF
```
(A reusable extractor was written to the scratchpad as `extract-playbook.mjs`; re-create if gone.)
Then commit and summarize highlights from the notification's truncated preview only.

## Primary-source cross-check (browser, not subject to the search cap)
**This is step 8 of the pattern above — do it automatically, don't wait to be asked.** When a run flags authoritative pages under `needsBrowser` (they 403 the WebFetch/WebSearch tools), verify the load-bearing ones via `claude-in-chrome` (navigate + read_page) as a serial post-research pass. Confirmed primary facts already captured: SPCC narrowband lines (Hα 656.0, [OIII] 500.7, [SII] 674.2, [NII] 658.4, Hβ 486.1); OSC → Ideal QE, mono → real QE; MGC = observational additive gradient (needs plate-solve + SPFC + MARS); MARS DR2 ~1.35 GB (1 Aug 2025).

## To resume (fresh session)
**Tier-1 is COMPLETE (6/6 verified).** Next work is Tier-2 and optional primary cross-checks.

1. Confirm the search cap is raised (settings.json env; ≥1000).
2. **Tier-2 categories** (author each as one `Workflow` per the pattern above): OSC-SHO/foraxx, hybrid mono-Ha+OSC, dual-scope blends.
3. **Optional primary-source cross-check** (browser, not search-cap-limited): the HaLRGB + SHO playbooks each carry a large `needsBrowser` list (RC Astro, pixinsight.com, Light Vortex, Cloudy Nights, SetiAstro all 403/SSL/JS-only). Verify the load-bearing ones via `claude-in-chrome` — priority: Foraxx/dynamic-palette published expressions, PhotometricContinuumSubtraction (PCS) algorithm/params, NBRGBCombination internal math, current BXT/NXT NB defaults.
4. Commit each as `docs/workflows/<cat>.md`; keep this README's status table updated.

Reusable workflow scripts + extractor live in the session scratchpad (`wf-halrgb.mjs`, `wf-sho.mjs`, `extract-playbook.mjs`) — copy their shape for Tier-2.
