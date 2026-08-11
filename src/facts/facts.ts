// Verified PixInsight tool facts, as data the server can ENFORCE.
//
// Why this exists: `get_process_parameters` works by introspection, and
// introspection lies. It reports dead aliases as settable (NXT `denoise` at 0.1
// and 0.9 produce byte-identical output) and reports "defaults" that are really
// this machine's persisted last-used values. A caller that trusts the tool sets
// a no-op and gets a successful result with an unchanged image. Documentation
// cannot fix a tool that answers incorrectly, so the corrections live here,
// where every client gets them: Claude Code, Claude Desktop, Cursor, Codex, a
// bare agent loop.
//
// SCOPE, same gate as docs/facts.md: objective, reproducible tool/API behaviour
// only. No aesthetics, no recipes, no thresholds. A fact says what is BROKEN,
// never what looks BETTER. The moment an entry expresses a preference it belongs
// in a workflow, not here.
//
// FAIL CLOSED. Each fact records the PixInsight version it was verified against,
// but a newer PixInsight does NOT relax it. Only evidence does: re-run the probe,
// then widen the fact. A wall a user can hit is recoverable; a deadlocked session
// mid-run is not. The single escape hatch is PIXINSIGHT_MCP_ALLOW_UNSAFE, set by
// a human on the server process, deliberately NOT a tool parameter an agent can
// pass to itself.

/** What the server does when a fact matches a call. */
export type FactSeverity =
  /** Refuse the call. Fatal (hangs, crashes) or silent no-op, which is worse than an error. */
  | "block"
  /** Run it, but say what is probably wrong. Used where the value is legal but usually a mistake. */
  | "warn"
  /** Never fires on a call; surfaced by get_process_parameters. */
  | "note";

export interface Fact {
  /** Stable id. Quoted in errors and worth recording in a run log. */
  id: string;
  /** Process class names this applies to, matched case-insensitively. */
  processes: string[];
  severity: FactSeverity;
  /** One line, shown to the caller verbatim. */
  summary: string;
  /** What to do instead. Required for anything that blocks. */
  fix?: string;
  /** Settings keys that are verified no-ops or do not exist. Setting one blocks the call. */
  deadParams?: string[];
  /** Fires when this returns true. Omit for facts that only depend on deadParams. */
  when?: (call: ProcessCall) => boolean;
  verified: { piVersion: string; date: string };
}

export interface ProcessCall {
  processId: string;
  /** Absent means a global invocation (executeGlobal). */
  viewId?: string;
  settings: Record<string, unknown>;
}

const V194 = (date: string) => ({ piVersion: "1.9.4", date });

const isTrue = (value: unknown): boolean => value === true || value === 1;

export const FACTS: Fact[] = [
  // --- fatal ---------------------------------------------------------------
  {
    id: "spcc-narrowband-deadlock",
    processes: ["SpectrophotometricColorCalibration", "SPCC"],
    severity: "block",
    summary:
      "SPCC narrowbandMode=true HARD-DEADLOCKS PixInsight on OSC data. The application stops " +
      "responding and the session is lost, so this call is refused rather than attempted.",
    fix:
      "Use broadband mode with duoband curves instead. Filter curves can be sliced out of " +
      "<PixInsight>/library/filters.xspd (the data=\"...\" attribute). Pair the " +
      "\"Sony Color Sensor R/G/B\" entries ONLY with \"Ideal QE curve\", since they already " +
      "embed CFA + QE; a real QE curve double-counts.",
    when: (call) => isTrue(call.settings.narrowbandMode),
    verified: V194("2026-07-28"),
  },
  {
    id: "pixelmath-global-sameastarget",
    processes: ["PixelMath"],
    severity: "block",
    summary:
      "PixelMath newImageColorSpace=0 (SameAsTarget) throws under a global invocation: there is " +
      "no target image to copy the colour space from. Through the bridge this surfaces only as " +
      "\"Script error: undefined\" with no line number, which is undiagnosable.",
    fix:
      "Name the colour space explicitly, 1 = RGB or 2 = GRAY. SameAsTarget is only valid when " +
      "running on a view (pass viewId).",
    when: (call) =>
      call.viewId === undefined &&
      isTrue(call.settings.createNewImage) &&
      call.settings.newImageColorSpace === 0,
    verified: V194("2026-07-28"),
  },

  // --- silent no-ops, refused because a successful result is a lie ---------
  {
    id: "mgc-empty-mars-database",
    processes: ["MultiscaleGradientCorrection", "MGC"],
    severity: "block",
    summary:
      "Headless MGC silently no-ops with an empty marsDatabaseFiles list. It returns success and " +
      "leaves the image byte-identical, so the failure is invisible until something downstream " +
      "makes no sense. GUI configuration does NOT transfer to a headless instance.",
    fix:
      "Pass useMARSDatabase: true AND marsDatabaseFiles: [[true, \"<absolute path to .xmars>\"]] " +
      "(Windows: %APPDATA%/Pleiades/XMARS/).",
    when: (call) => {
      const files = call.settings.marsDatabaseFiles;
      const empty = files === undefined || (Array.isArray(files) && files.length === 0);
      return empty && (isTrue(call.settings.useMARSDatabase) || call.settings.useMARSDatabase === undefined);
    },
    verified: V194("2026-07-28"),
  },
  {
    id: "bxt-dead-psf-aliases",
    processes: ["BlurXTerminator", "BXT"],
    severity: "block",
    deadParams: ["auto_nonstellar_psf", "nonstellar_psf_diameter"],
    summary: "These BlurXTerminator parameters are dead aliases, verified no-ops. Setting them changes nothing.",
    fix: "Use auto_nonstellar_radius and nonstellar_diameter (FWHM px, cap 8). Set both pairs if unsure.",
    verified: V194("2026-07-28"),
  },
  {
    id: "nxt-dead-denoise-alias",
    processes: ["NoiseXTerminator", "NXT"],
    severity: "block",
    deadParams: ["denoise", "detail"],
    summary:
      "NoiseXTerminator's top-level denoise/detail parameters are dead aliases from the old " +
      "parameter model. Behaviour-tested: 0.1 and 0.9 produce byte-identical output.",
    fix:
      "Use the live dials: denoise_intensity_low_freq, denoise_intensity_high_freq, and the " +
      "denoise_color_* pair.",
    verified: V194("2026-07-28"),
  },
  {
    id: "sxt-nonexistent-params",
    processes: ["StarXTerminator", "SXT"],
    severity: "block",
    deadParams: ["starmask", "linear"],
    summary: "StarXTerminator has no starmask or linear parameter; they do not exist on the process.",
    fix: "Live parameters are stars (default false), unscreen (default false) and overlap (default 0.20).",
    verified: V194("2026-07-28"),
  },
  {
    id: "mt-structurewaytable-broken",
    processes: ["MorphologicalTransformation"],
    severity: "block",
    deadParams: ["structureWayTable"],
    summary: "MorphologicalTransformation structureWayTable is broken, array assignment errors out.",
    fix: "Use structureSize instead.",
    verified: V194("2026-07-28"),
  },
  {
    id: "hdrmt-invertediterations-type",
    processes: ["HDRMultiscaleTransform", "HDRMT"],
    severity: "block",
    summary: "HDRMultiscaleTransform invertedIterations must be a boolean; a number is rejected by the process.",
    fix: "Pass true or false.",
    when: (call) =>
      call.settings.invertedIterations !== undefined &&
      typeof call.settings.invertedIterations !== "boolean",
    verified: V194("2026-07-28"),
  },

  // --- legal values that are usually a mistake ------------------------------
  {
    id: "scnr-colortoremove-is-red",
    processes: ["SCNR"],
    severity: "warn",
    summary:
      "SCNR colorToRemove=0 removes RED, not green. Green is 1 (0 = RED, 1 = GREEN, 2 = BLUE). " +
      "Removing red flattens saturation on warm targets and makes green relatively dominant, " +
      "which reads as SCNR having made the green worse.",
    fix: "For the usual green cast, pass colorToRemove: 1.",
    when: (call) => call.settings.colorToRemove === 0,
    verified: V194("2026-08-01"),
  },

  // --- notes, surfaced by get_process_parameters ----------------------------
  {
    id: "xt-persisted-defaults",
    processes: ["BlurXTerminator", "NoiseXTerminator", "StarXTerminator", "BXT", "NXT", "SXT"],
    severity: "note",
    summary:
      "A bare `new <XT process>` inherits this machine's persisted LAST-USED settings, not factory " +
      "defaults, so the values reported here may be someone's old run rather than a default.",
    fix: "Pin every load-bearing parameter explicitly instead of relying on what is reported.",
    verified: V194("2026-07-28"),
  },
  {
    id: "abe-noop-default",
    processes: ["AutomaticBackgroundExtractor", "ABE"],
    severity: "note",
    summary:
      "ABE's default targetCorrection is None: it builds a model and leaves the image untouched, " +
      "then reports success.",
    fix: "To actually correct, pass targetCorrection: 1 (Subtract) or 2 (Divide) plus replaceTarget: true.",
    verified: V194("2026-07-28"),
  },
  {
    id: "nxt-measure-with-mrs",
    processes: ["NoiseXTerminator", "NXT"],
    severity: "note",
    summary:
      "Gauge denoising with an MRS noise estimate, never stdDev. stdDev is signal-dominated and " +
      "can RISE after a good denoise, which looks like the denoise failed.",
    verified: V194("2026-07-28"),
  },
  {
    id: "bxt-before-nxt",
    processes: ["BlurXTerminator", "NoiseXTerminator", "BXT", "NXT"],
    severity: "note",
    summary: "BlurXTerminator performs worse on denoised data (per its author), so deconvolve before denoising.",
    verified: V194("2026-07-28"),
  },
  {
    id: "spcc-needs-wcs",
    processes: ["SpectrophotometricColorCalibration", "SPCC"],
    severity: "note",
    summary: "SPCC needs an astrometric solution, and PixelMath composites lose it.",
    fix: "Restore it first with dstWindow.copyAstrometricSolution(srcWindow).",
    verified: V194("2026-07-28"),
  },
];
