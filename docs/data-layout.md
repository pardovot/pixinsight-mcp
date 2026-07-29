# Data layout

Everything a run reads or writes lives under **`data/`** (renamed from `result-tests/` 2026-07-30:
it was never tests, and it holds the source masters, not only results). Gitignored in full.

```
data/
  SCOREBOARD.md                      one line per v2 run, all targets
  _pre-v2/                           pre-2026-07-30 runs, INPUT-ONLY (see below)
  <Telescope>/<Object>/<CameraType>/<CaptureType>/
      masterLight_*.xisf             the input master(s)
      runs/<yyyy-mm-dd>/             one dir per run, never overwritten
          RUNLOG.md
          linear/                    <base>_{linear,starless,stars}.xisf
          crop/                      matched crop of starless + stars
          variants/                  v1..v4 + the replayable op list for each
          profiles/                  profiler JSON per variant (native scale)
          contact-sheet.jpg
      final.xisf                     mirror of the currently accepted variant
```

Examples:

```
data/C8/M106/OSC/RGB/
data/C8/M106/Mono/Ha/
data/FMA180/NorthSadr/OSC/Duoband/
```

## The four levels

| level | values | notes |
|---|---|---|
| Telescope | `C8`, `C8-Reducer`, `FRA500`, `FMA180`, `Esprit120`, `Sharpstar61`, `SW200P`, ... | the optic, not the mount. Reducer is part of the optical train, so it is a separate telescope. |
| Object | `M106`, `NGC4565`, `NorthSadr`, `RhoOphiuchi-P1`, ... | no spaces. Mosaic panels are separate objects (`-P1`, `-P2`), they are separately captured and separately processed. |
| CameraType | `OSC` \| `Mono` | how colour was acquired, which decides whether channel combination is needed. |
| CaptureType | see below | what the sensor saw through, which decides the recipe. |

**CaptureType vocabulary.** OSC: `RGB` (broadband, no filter), `Duoband` (ALP-T / L-eXtreme /
L-eNhance). Mono: `Ha`, `Oiii`, `Sii`, `L`, `R`, `G`, `B`, or a combined set `LRGB` / `SHO` / `HOO`
when the leaf holds the per-filter masters that one run consumes together.

This is the level that routes to a recipe, so it must be honest. `FILTER` in the FITS header is
unreliable (duoband is commonly logged `NoFilter`), which is exactly why capture type is a path the
human sets and never a value inferred at run time.

| CaptureType | recipe |
|---|---|
| `OSC/RGB` | `recipes/osc-rgb-linear.js` |
| `OSC/Duoband` | none yet, stop and report |
| `Mono/*` | none yet, stop and report |

## Two taxonomies, do not confuse them

The directory tree says **how the data was captured**. The reference class in
`references/library.json` (`galaxy`, `emission-nebula-filling`, `dark-nebula`, ...) says **what the
object is**. They are orthogonal: `OSC/RGB` covers galaxies and nebulae alike, and one object can
appear under several capture types.

The class is never derived from the path. It comes from the user's prompt at run time, per
`process-v2` section 1.

## `_pre-v2/` is INPUT-ONLY

Reading a stacked linear master out of it is fine, that data is pipeline-independent. Reading its
finals, `metrics.json`, `HISTORY.md`, `RUNLOG.md` or `versions/` is not: those numbers describe a
pipeline that no longer exists, and the library was reset precisely so they stop being references.
Its layout is the old flat per-target one and is frozen; nothing new goes in.

## Master hygiene, check before a run

- **Prefer `*_autocrop`.** Uncropped masters carry black/bright edges, and GradientCorrection
  artifacts on those (crop first).
- **Watch for split stacks.** WBPP treats `No-Filter` and `NoFilter` as different filters, so one
  target can end up integrated twice at partial depth. Measured on M106: `No-Filter` had 12% less
  grain than `NoFilter`, about 30% more frames. Compare `grainRelSky` between candidates and take
  the deeper one, or combine them. The same split exists in `NGC 4565` and the Veil `BPP`/`BPP2`
  dirs.
- **Avoid `drizzle_1x` unless verified.** On M106 its channel structure was off the plain
  integration (`RoverG` 0.503 vs 0.744), so it is not a like-for-like substitute.
- **Save copies with compression.** `"compression-codec zlib+sh"` as `saveAs`'s 6th argument, which
  is what `save_image` does. Measured on the M106 master: 342 MB -> 201 MB, lossless.
- **Confirm the solve.** The recipe hard-errors without WCS. `PCL:AstrometricSolution` as an XISF
  property is the authority; `Observation:Center:RA` alone is not a solution, and `CTYPE*`/`CRVAL*`
  keywords are often absent even on solved files.
