// Verified PixInsight tool behaviour, as data the server enforces on run_process.
//
// get_process_parameters works by introspection, and introspection is wrong in two ways: it
// reports dead aliases as settable (NXT denoise at 0.1 and 0.9 give byte identical output) and
// reports this machine's persisted last used values as defaults. A caller that trusts it sets a
// parameter that does nothing, and the call reports success anyway. Keeping the facts in the
// server means every MCP client gets them.
//
// Scope: objective, reproducible tool behaviour only. A fact says what is broken, never what
// looks better. Each fact records the PixInsight version it was verified on, and a newer
// version does not relax it, only a repeated probe does. A human can disarm blocking with
// PIXINSIGHT_MCP_ALLOW_UNSAFE on the server process, deliberately not a tool parameter.

/** What the server does when a fact matches a call. */
export type FactSeverity =
  /** Refuse the call. Fatal (hangs, crashes) or silently does nothing, which is worse than an error. */
  | "block"
  /** Run it, but say what is probably wrong. Used where the value is legal but usually a mistake. */
  | "warn"
  /** Never fires on a call, get_process_parameters shows it. */
  | "note";

export interface Fact {
  /** Stable id. Quoted in errors and worth recording in a run log. */
  id: string;
  /** Process class names this applies to, matched ignoring case. */
  processes: string[];
  severity: FactSeverity;
  /** One line, shown to the caller verbatim. */
  summary: string;
  /** What to do instead. Required for anything that blocks. */
  fix?: string;
  /** Settings keys verified to do nothing, or that do not exist. Setting one blocks the call. */
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

const verifiedOn194 = (date: string) => ({ piVersion: "1.9.4", date });

const isTrue = (value: unknown): boolean => value === true || value === 1;

export const FACTS: Fact[] = [
  // --- fatal ---------------------------------------------------------------
  {
    id: "spcc-narrowband-deadlock",
    processes: ["SpectrophotometricColorCalibration"],
    severity: "block",
    summary:
      "SPCC narrowbandMode=true deadlocks PixInsight on OSC data. The application stops " +
      "responding and the session is lost, so this call is refused rather than attempted.",
    fix:
      "Use broadband mode with duoband curves instead. Filter curves can be sliced out of " +
      "<PixInsight>/library/filters.xspd (the data=\"...\" attribute). Pair the " +
      "\"Sony Color Sensor R/G/B\" entries only with \"Ideal QE curve\", since they already " +
      "embed CFA and QE, a real QE curve counts it twice.",
    when: (call) => isTrue(call.settings.narrowbandMode),
    verified: verifiedOn194("2026-07-28"),
  },
  {
    id: "pixelmath-global-sameastarget",
    processes: ["PixelMath"],
    severity: "block",
    summary:
      "PixelMath newImageColorSpace=0 (SameAsTarget) throws under a global invocation: there is " +
      "no target image to copy the color space from. Through the bridge this surfaces only as " +
      "\"Script error: undefined\" with no line number, which is undiagnosable.",
    fix:
      "Name the color space explicitly, 1 = RGB or 2 = GRAY. SameAsTarget is only valid when " +
      "running on a view (pass viewId).",
    when: (call) =>
      call.viewId === undefined &&
      isTrue(call.settings.createNewImage) &&
      call.settings.newImageColorSpace === 0,
    verified: verifiedOn194("2026-07-28"),
  },

  // --- silently does nothing, refused because a successful result is a lie --
  {
    id: "mgc-empty-mars-database",
    processes: ["MultiscaleGradientCorrection"],
    severity: "block",
    summary:
      "Headless MGC silently does nothing with an empty marsDatabaseFiles list. It returns success and " +
      "leaves the image byte identical, so the failure is invisible until something downstream " +
      "makes no sense. GUI configuration does not transfer to a headless instance.",
    fix:
      "Pass useMARSDatabase: true and marsDatabaseFiles: [[true, \"<absolute path to .xmars>\"]]. " +
      "The .xmars files have no default location on any platform: they are downloaded by the user " +
      "and their paths are configuration (MGC's own Preferences). Take the path as an input, do " +
      "not guess a directory.",
    when: (call) => {
      const files = call.settings.marsDatabaseFiles;
      const empty = files === undefined || (Array.isArray(files) && files.length === 0);
      return empty && (isTrue(call.settings.useMARSDatabase) || call.settings.useMARSDatabase === undefined);
    },
    verified: verifiedOn194("2026-07-28"),
  },
  {
    id: "bxt-dead-psf-aliases",
    processes: ["BlurXTerminator"],
    severity: "block",
    deadParams: ["auto_nonstellar_psf", "nonstellar_psf_diameter"],
    summary: "These BlurXTerminator parameters are dead aliases, setting them changes nothing.",
    fix: "Use auto_nonstellar_radius and nonstellar_diameter (FWHM px, cap 8). Set both pairs if unsure.",
    verified: verifiedOn194("2026-07-28"),
  },
  {
    id: "nxt-dead-denoise-alias",
    processes: ["NoiseXTerminator"],
    severity: "block",
    deadParams: ["denoise", "detail"],
    summary:
      "NoiseXTerminator's top level denoise/detail parameters are dead aliases from the old " +
      "parameter model. Tested: 0.1 and 0.9 produce byte identical output.",
    fix:
      "Use the live dials: denoise_intensity_low_freq, denoise_intensity_high_freq, and the " +
      "denoise_color_* pair.",
    verified: verifiedOn194("2026-07-28"),
  },
  {
    id: "sxt-nonexistent-params",
    processes: ["StarXTerminator"],
    severity: "block",
    deadParams: ["starmask", "linear"],
    summary: "StarXTerminator has no starmask or linear parameter, they do not exist on the process.",
    fix: "Live parameters are stars (default false), unscreen (default false) and overlap (default 0.20).",
    verified: verifiedOn194("2026-07-28"),
  },
  {
    id: "mt-structurewaytable-broken",
    processes: ["MorphologicalTransformation"],
    severity: "block",
    deadParams: ["structureWayTable"],
    summary: "MorphologicalTransformation structureWayTable is broken, array assignment errors out.",
    fix: "Use structureSize instead.",
    verified: verifiedOn194("2026-07-28"),
  },
  {
    id: "hdrmt-invertediterations-type",
    processes: ["HDRMultiscaleTransform"],
    severity: "block",
    summary: "HDRMultiscaleTransform invertedIterations must be a boolean, a number is rejected by the process.",
    fix: "Pass true or false.",
    when: (call) =>
      call.settings.invertedIterations !== undefined &&
      typeof call.settings.invertedIterations !== "boolean",
    verified: verifiedOn194("2026-07-28"),
  },

  // --- legal values that are usually a mistake ------------------------------
  {
    id: "scnr-colortoremove-is-red",
    processes: ["SCNR"],
    severity: "warn",
    summary:
      "SCNR colorToRemove=0 removes red, not green. Green is 1 (0 = red, 1 = green, 2 = blue). " +
      "Removing red flattens saturation on warm targets and makes green relatively dominant, " +
      "which reads as SCNR having made the green worse.",
    fix: "For the usual green cast, pass colorToRemove: 1.",
    when: (call) => call.settings.colorToRemove === 0,
    verified: verifiedOn194("2026-08-01"),
  },

  // --- notes, surfaced by get_process_parameters ----------------------------
  {
    id: "xt-persisted-defaults",
    processes: ["BlurXTerminator", "NoiseXTerminator", "StarXTerminator"],
    severity: "note",
    summary:
      "A bare `new <XT process>` inherits this machine's persisted last used settings, not factory " +
      "defaults, so the values reported here may be someone's old run rather than a default.",
    fix: "Set every parameter that matters explicitly instead of relying on what is reported.",
    verified: verifiedOn194("2026-07-28"),
  },
  {
    id: "abe-noop-default",
    processes: ["AutomaticBackgroundExtractor"],
    severity: "note",
    summary:
      "ABE's default targetCorrection is None: it builds a model and leaves the image untouched, " +
      "then reports success.",
    fix: "To actually correct, pass targetCorrection: 1 (Subtract) or 2 (Divide) plus replaceTarget: true.",
    verified: verifiedOn194("2026-07-28"),
  },
  {
    id: "nxt-measure-with-mrs",
    processes: ["NoiseXTerminator"],
    severity: "note",
    summary:
      "Gauge denoising with an MRS noise estimate, never stdDev. stdDev is dominated by signal and " +
      "can rise after a good denoise, which looks like the denoise failed.",
    verified: verifiedOn194("2026-07-28"),
  },
  {
    id: "spcc-needs-wcs",
    processes: ["SpectrophotometricColorCalibration"],
    severity: "note",
    summary: "SPCC needs an astrometric solution, and PixelMath composites lose it.",
    fix: "Restore it first with dstWindow.copyAstrometricSolution(srcWindow).",
    verified: verifiedOn194("2026-07-28"),
  },
];
