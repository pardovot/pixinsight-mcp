// Enforcement of the verified facts. Pure functions, no bridge, no I/O, so the
// whole guard is unit-testable without PixInsight.

import { FACTS, type Fact, type ProcessCall } from "./facts.js";

/** Set by a human on the server process to disarm blocking. Never a tool parameter. */
const OVERRIDE_ENV = "PIXINSIGHT_MCP_ALLOW_UNSAFE";

export interface FactHit {
  fact: Fact;
  /** Settings keys that triggered it, when the trigger was a dead parameter. */
  params?: string[];
}

export function overrideEnabled(): boolean {
  const value = process.env[OVERRIDE_ENV];
  return value === "1" || value?.toLowerCase() === "true";
}

const appliesTo = (fact: Fact, processId: string): boolean =>
  fact.processes.some((name) => name.toLowerCase() === processId.toLowerCase());

/** Facts of a given severity registered for a process, regardless of the call. */
export function factsForProcess(processId: string, severity?: Fact["severity"]): Fact[] {
  return FACTS.filter((fact) => appliesTo(fact, processId) && (!severity || fact.severity === severity));
}

/** Dead/nonexistent parameter name -> the fact that says so, for one process. */
export function deadParamsFor(processId: string): Map<string, Fact> {
  const dead = new Map<string, Fact>();
  for (const fact of factsForProcess(processId)) {
    for (const param of fact.deadParams ?? []) dead.set(param.toLowerCase(), fact);
  }
  return dead;
}

/** Evaluate one run_process call against every fact registered for that process. */
export function checkProcessCall(call: ProcessCall): { blocks: FactHit[]; warnings: FactHit[] } {
  const blocks: FactHit[] = [];
  const warnings: FactHit[] = [];

  for (const fact of factsForProcess(call.processId)) {
    if (fact.severity === "note") continue;

    // A dead parameter fires whenever the caller set it, whatever the value:
    // the point is that the value cannot matter.
    const hitParams = (fact.deadParams ?? []).filter((param) =>
      Object.keys(call.settings).some((key) => key.toLowerCase() === param.toLowerCase()),
    );

    let fired = hitParams.length > 0;
    if (!fired && fact.when) {
      try {
        fired = fact.when(call);
      } catch {
        // A predicate must never take down a call it was meant to protect.
        fired = false;
      }
    }
    if (!fired) continue;

    const hit: FactHit = hitParams.length > 0 ? { fact, params: hitParams } : { fact };
    (fact.severity === "block" ? blocks : warnings).push(hit);
  }

  return { blocks, warnings };
}

const render = (hit: FactHit): string => {
  const { fact } = hit;
  const head = hit.params?.length ? `${fact.summary} (${hit.params.join(", ")})` : fact.summary;
  const fix = fact.fix ? `\n  Instead: ${fact.fix}` : "";
  return `- [${fact.id}] ${head}${fix}\n  Verified against PixInsight ${fact.verified.piVersion}, ${fact.verified.date}.`;
};

/** The refusal text for a blocked call. */
export function formatBlocks(processId: string, blocks: FactHit[]): string {
  return (
    `Refused: ${processId} would hit ${blocks.length === 1 ? "a known, verified defect" : "known, verified defects"}.\n` +
    blocks.map(render).join("\n") +
    `\nThis is a verified tool fact, not a guess, and it does not relax on a newer PixInsight ` +
    `without re-verification. A human can disarm it for the whole server with ${OVERRIDE_ENV}=1.`
  );
}

/** Non-blocking remarks appended to a successful result. */
export function formatWarnings(warnings: FactHit[]): string {
  return `\n\nWarnings:\n${warnings.map(render).join("\n")}`;
}

/** The "known traps" block appended to get_process_parameters. */
export function formatNotes(processId: string): string {
  const notes = factsForProcess(processId).filter((fact) => fact.severity !== "block" || fact.deadParams);
  if (notes.length === 0) return "";
  return `\n\nKnown traps for ${processId}:\n${notes.map((fact) => render({ fact })).join("\n")}`;
}
