# Test Report — NetworkSolver

## 1. Test architecture

- **Runner**: Node's built-in `node:test` + `node:assert/strict` — zero
  extra dependency (see docs/research.md §2.4/§8 for why: the solver core
  has no runtime dependencies, and the built-in runner is sufficient for
  pure-function testing of framework-free ES modules).
- **Location**: `test/*.test.js`, run with `npm test` (`node --test`,
  auto-discovery).
- **Scope**: the solver core (`src/solver/`) only. The solver is
  deliberately DOM/framework-independent (docs/research.md §5), so it can
  be exercised directly with plain function calls and analytic
  assertions, without a browser or DOM shim.
- **Style**: each file targets one solver module (`linalg`, `hydraulics`,
  `thermal`, `validate`, `optimize`, `io`), plus `example.test.js` for the
  full Phase-10 end-to-end scenario (load → validate → solve → goal-seek →
  export → import → verify), run against **both** built-in examples via a
  shared `runExampleWorkflow()` helper rather than duplicating the
  assertions per example.

## 2. Test files and case summary

| File | Cases | What it covers |
|---|---|---|
| `test/model.test.js` | 8 | `createNode()` defaults (plain junction, no fixed BCs); reservoir auto-fixes pressure=0; tank auto-fixes pressure=0 plus default diameter/minLevel/maxLevel/level; auto-defaults are still explicitly overridable; a cloned node (id/computed stripped) gets a fresh id, not `undefined`; `getEffectiveElevation()` returns raw elevation for junction/reservoir and elevation+level for a tank; `pruneGoalSeekReferences()` drops target/adjustable entries whose elementId no longer exists (leaving tolerance/maxIterations/history untouched) and returns the same object by reference when nothing needs pruning. |
| `test/linalg.test.js` | 8 | Dense linear solve correctness + singular-matrix detection; `signedSqrt` asymptotic/zero behavior; `signedPow` matches `signedSqrt` at n=0.5, matches `sign(x)·\|x\|^n` at a non-0.5 exponent (Hazen-Williams' 1/1.852), and stays finite at zero for any exponent; `norm2`/`normInf`. |
| `test/hydraulics.test.js` | 8 | Single pipe (both nodes fixed-pressure, trivial case); single pipe with an internal demand node (exercises the Newton loop, n=1 unknown); series pipes; parallel-then-series pipes; missing pressure reference; flow-direction reversal; a reservoir/tank pair driving flow purely through effective elevation (both nodes at 0 pressure) vs. the closed form `Q = A·√(ρg·Δz)`; `network.headlossModel='hazenWilliams'` end-to-end through the solver vs. the closed form `Q = A·Δp^(1/1.852)`. |
| `test/pipe.test.js` | 6 | `computeNominalAdmittance` defaults to Darcy-Weisbach with no `headlossModel` arg; Hazen-Williams admittance matches the closed-form SI headloss equation (round-trip through `flow()`, relative error ~1e-16); Darcy-Weisbach and Hazen-Williams give different flows for the same pipe/Δp (not a no-op); Hazen-Williams admittance is `null` for invalid geometry, matching Darcy-Weisbach; `flow()` respects `enabled=false` under either model; `validateParams` rejects non-positive `hazenWilliamsC` regardless of the active model. |
| `test/thermal.test.js` | 4 | Pipe exponential heat loss vs. closed form; two-inflow node mixing vs. flow-weighted average; heat-exchanger effectiveness-NTU vs. closed form; indeterminate-temperature warning on an unreached node. |
| `test/validate.test.js` | 14 | Clean network passes; no pressure reference; disconnected region without its own reference; over-constrained node; duplicate element id; dangling node reference; invalid pipe geometry; non-positive `hazenWilliamsC` rejected even under Darcy-Weisbach; invalid admittance bounds; isolated-node warning (non-blocking); a well-formed reservoir/tank network; tank with non-positive diameter rejected; tank with minLevel > maxLevel rejected; tank level outside [min, max] warns without blocking. |
| `test/optimize.test.js` | 7 | One target/one adjustable (exact algebraic check); bounds always respected under an unreachable target; unreachable-target status; multiple targets/multiple adjustable on coupled parallel branches (the example network); graceful degradation when the hydraulic solve can't converge; invalid configuration (no targets/no adjustable); rejecting a non-pipe/valve/HX adjustable element. |
| `test/io.test.js` | 10 | Export shape/schemaVersion; export→import round trip preserves topology/parameters; a hand-edited file with a goal-seek target/adjustable referencing a missing element id has it dropped, with a warning; round trip preserves a non-default `headlossModel`; a file with no `headlossModel` field (older save) imports as the `darcyWeisbach` default; imported results are reset (not trusted); malformed JSON rejected; missing schemaVersion rejected; newer/incompatible schemaVersion rejected; dangling node reference on import rejected. |
| `test/example.test.js` | 11 | Phase 10 end-to-end, run against **all four** built-in examples via the shared `runExampleWorkflow()` helper: load → validate → solve (flows/pressures finite, mass balance closes) → run goal seek (converges within tolerance **and** materially reduces the seed residual) → apply → re-solve → export → import → verify topology/parameters/admittances preserved and results reset. Plus Complex-Network-specific checks (exact element counts by type, exactly 5 boundary nodes, full connectivity, coupling); EPANET-Net1-specific checks: exact topology fidelity against the source `Net1.inp` (2 boundary + 9 junctions using the dedicated Reservoir/Tank node types, 12 pipes + 1 pump, no valves/heat exchangers, all of the Tank's EPANET fields preserved exactly) and physical plausibility of the solved state (no negative pressure anywhere; the pump's flow passes straight through its zero-demand downstream junction into Pipe 10 unchanged), solved under the network's native Hazen-Williams C=100 headloss model, matching the source file exactly; and Three-Reservoir-Problem-specific checks (handbook benchmark, Larock/Jeppson/Watters Example 2.7): exact topology/geometry fidelity against the cited input data (3 reservoirs at 100/85/60 m, 3 pipes with the cited length/diameter/roughness, the junction's cited 0.06 m³/s demand), and solved flows matching the published reference solution to within ~2% with an exact junction mass balance. |

**Total: 76 test cases, all passing.**

```
$ npm test
...
ℹ tests 76
ℹ suites 0
ℹ pass 76
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

## 3. Numerical accuracy against analytical values

Several tests assert the solver's output against a closed-form solution
computed independently in the test file (not just "did it run"):

- **Single pipe, both ends fixed-pressure**: `Q_solver` vs.
  `A·√(Δp)` directly — relative error `< 1e-6`.
- **Single pipe with an internal demand node** (forces one Newton
  iteration to run): solved flow vs. the demand value (relative error
  `< 1e-5`), and solved downstream pressure vs. `p_1 − (Q/A)²`.
- **Series pipes**: solved flow vs.
  `Q = √(Δp_total / (1/A1² + 1/A2²))` — the series-resistance closed form
  — relative error `< 1e-5` on both elements.
- **Parallel pipes feeding a series pipe**: solved flow vs. the
  equivalent-admittance closed form `A_eq = A1+A2` combined in series with
  `A3` — relative error `< 1e-5`; mass balance at the merge node closes to
  `< 1e-6` m³/s.
- **Reservoir/tank effective elevation**: a reservoir (elevation 100 m)
  and a tank (base 50 m + level 8 m) both at 0 pressure, connected by one
  pipe, solved flow vs. `Q = A·√(ρg·Δz)` with `Δz` = the two nodes'
  *effective* elevations — relative error `< 1e-6`. Directly verifies
  `getEffectiveElevation()` is what the Newton solve actually uses, not
  each node's raw `elevation` field.
- **Hazen-Williams pipe admittance/flow**: given an arbitrary flow `Q`,
  compute the textbook headloss `h_L = 10.67·L·Q^1.852/(C^1.852·D^4.8704)`,
  convert to a pressure drop, and confirm the pipe's own
  `computeNominalAdmittance`/`flow()` reproduce the same `Q` from that
  pressure drop — relative error `~5e-16` (floating-point noise, i.e. an
  exact match to the closed form). Also confirms `signedPow(x, 0.5)` and
  `signedSqrt(x)` agree (relative error `< 1e-12`) and that switching
  `network.headlossModel` to `'hazenWilliams'` end-to-end through
  `solveHydraulics()` reproduces `Q = A·Δp^(1/1.852)` for a two-node
  network — relative error `< 1e-6`.
- **Pipe heat loss**: solved outlet temperature vs. the exponential
  ambient-decay formula `T_amb + (T_in−T_amb)·e^{−UA/(ṁcp)}` — absolute
  error `< 1e-6` °C.
- **Node mixing**: solved node temperature vs. the flow-weighted average
  of two known inlet streams — absolute error `< 1e-6` °C.
- **Heat exchanger**: solved effectiveness and outlet temperature vs. the
  standard counter-flow ε-NTU closed form, computed independently in the
  test — error `< 1e-9` (effectiveness) and `< 1e-6` °C (outlet temperature).
- **Goal seek, one target/one adjustable**: solved admittance vs. the
  exact algebraic solution `A = targetFlow/√(Δp)` — relative error
  `< 1e-3`; achieved flow vs. target — absolute error `< 1e-6` m³/s.
- **Goal seek, example network** (two coupled parallel branches): both
  target flows achieved to `< 1e-3` m³/s absolute error, converging in a
  small number of iterations (3–4 typically, see below).

Example-network convergence observed during development (not asserted
verbatim in tests, since exact iteration counts aren't a correctness
property, but the *status* and *tolerance* are asserted):

```
Hydraulic solve:  converged, 9 iterations, residual norm 1.0e-8 m³/s
Goal seek:        converged, 4 evaluations, residual norm 1.7e-8 (targets 7.5e-3 / 3.5e-3 m³/s)
```

**Complex Network Example** (40 elements, 35 nodes, one genuine hydraulic
loop) convergence observed during development, also not asserted verbatim
(the tests assert convergence status, mass-balance closure `< 1e-4`, and
target-flow error `< 1e-3`, not these exact figures):

```
Hydraulic solve:  converged, 10 iterations, residual norm 2.2e-10 m³/s
                  pressure range 106,581 .. 540,580 Pa (all positive/plausible)
                  flow range 0.00094 .. 0.01245 m³/s
Goal seek:        converged, 5 accepted iterations, residual norm 5.4e-5 m³/s
                  (seed residual 2.1e-3 m³/s, ~38x reduction), one adjustable
                  (Loop Bridge Valve) pinned at its lower bound at the best
                  iterate -- a real example of bounded optimization, not just
                  an unconstrained fit.
```

An earlier parameterization of this example put an under-sized valve/pipe
on the fixed-flow extraction branch, which forced that boundary node's
solved pressure to **−463,166 Pa** (a non-physical negative absolute
pressure) even though the Newton solve still numerically "converged" —
convergence alone does not guarantee a physically sane result for a
poorly-conditioned boundary path. This was caught by inspecting the solved
node-pressure table during development (not by an automated assertion),
and fixed by widening the extraction pipe/valve so the fixed 0.006 m³/s
demand is met at a modest, physically reasonable pressure drop (final
extraction-node pressure 106,581 Pa). This is noted here as a numerical-
stability lesson: **a future improvement would be an automated test/
diagnostic asserting all solved node pressures stay within a plausible
range**, since the solver itself has no way to know what counts as
"plausible" for a given fluid/application without additional bounds
metadata.

**EPANET Net1 Benchmark** (11 nodes, 13 elements, a real external
network, not self-authored) convergence and a spot-checked mass balance
against hand-tracked values, observed during development (the tests
assert convergence status, non-negative pressure everywhere, and the
pump-flow-equals-first-pipe-flow identity, not these exact figures):

```
Hydraulic solve:  converged, 49 iterations, residual norm 7.9e-9 m3/s
                  all 11 node pressures positive (766,198 .. 863,881 Pa)
Mass balance spot check at Junction 11 (demand 150 GPM = 9.4635e-3 m3/s):
  inflow (Pipe 10)                     = 0.120116 m3/s
  outflow (Pipe 11 + Pipe 111 + demand) = 0.079662 + 0.030991 + 0.009464 = 0.120117 m3/s  (closes to < 1e-6)
Goal seek:        converged, 3 iterations, residual norm 1.53e-4 m3/s (seed 1.56e-3, ~10x reduction)
```

This network converges in noticeably more Newton iterations (49, vs. 7-10
for the other two examples) — expected and not a red flag: it is the
first built-in example with non-zero, *varied* node elevations (695-710 ft
apart across junctions), which the other two examples deliberately kept
at zero for simplicity, so this is also the first example to meaningfully
exercise the elevation term in `effectiveDeltaPressure` (docs/technical_specs.md
§2.1). One of the two fixed-pressure boundaries (the Tank, modeled as a
steady-state snapshot at its initial water level -- see
docs/user_manual.md §9) ends up *absorbing* flow rather than supplying it
at this snapshot (Pipe 110 solves to a negative flow, i.e. reversed from
its defined source→target direction) -- a legitimate, physically sensible
result for a tank caught mid-fill, not a bug.

**Three-Reservoir Problem benchmark** (4 nodes, 3 elements, a textbook
benchmark independent of any modeling software -- see docs/user_manual.md
§10) -- solved flows vs. the published reference solution (Larock,
Jeppson & Watters, *Hydraulics of Pipeline Systems*, Example 2.7):

```
Pipe 1 (A->J): solved 0.1016 m3/s, published 0.1023 m3/s  (0.68% low)
Pipe 2 (B->J): solved 0.0204 m3/s, published 0.0200 m3/s  (2.0% high)
Pipe 3 (J->C): solved 0.0620 m3/s, published 0.0622 m3/s  (0.32% low)
Junction mass balance residual: 1.5e-10 m3/s (exact, to solver tolerance)
Goal seek: converged, residual norm 7.2e-7 (target 0.05 m3/s on Pipe 3)
```

The 0.3-2% deviation from the published figures is expected, not a defect:
the reference solves the Colebrook-White friction factor iteratively at
each pipe's actual converged velocity, while NetworkSolver's Darcy-Weisbach
admittance is computed once from a friction factor evaluated at a single
representative reference velocity (docs/research.md §2.3/§2.8, same
simplification as every other pipe in the app). The test
(`test/example.test.js`) asserts flow direction and a 3% relative-error
bound against the published values (comfortably covering the ~2% observed),
plus an exact junction mass balance -- the latter is a structural property
of the Newton-Raphson solver and holds regardless of the friction-model
difference.

## 4. Error-handling and diagnostics validation

- **Structural validation** (`validate.test.js`): duplicate ids, dangling
  node references, self-referencing elements (not exercised in an
  isolated test but covered by the `MISSING_TARGET_NODE`/self-loop checks
  in `validate.js`), invalid geometry, invalid admittance bounds — all
  produce `errors[]` with stable `code`s rather than throwing.
- **Connectivity validation**: a disconnected region without its own
  pressure reference is rejected (`DISCONNECTED_REGION`); an isolated node
  is only a warning (`ISOLATED_NODE`), not blocking.
- **Over-constrained boundary conditions**: a node with both fixed
  pressure and fixed flow is rejected (`OVER_CONSTRAINED_NODE`).
- **Tank parameters** (`validate.test.js`): non-positive diameter and
  `minLevel > maxLevel` are rejected (`INVALID_TANK_PARAMS`); a current
  level outside `[minLevel, maxLevel]` is only a warning
  (`TANK_LEVEL_OUT_OF_RANGE`), since it doesn't make the network
  unsolvable, just physically implausible.
- **No physical reference**: a network with no fixed-pressure node is
  rejected both at validation (`NO_PRESSURE_REFERENCE`) and, defensively,
  again at the hydraulics-solver level (`status: 'invalidNetwork'`) if it
  ever reaches `solveHydraulics()` directly without going through
  `validateNetwork()` first.
- **Non-finite results**: `hydraulics.js` explicitly checks every element
  flow with `Number.isFinite()` and raises `NON_FINITE_FLOW` rather than
  letting `NaN`/`Infinity` propagate into the UI.
- **Singular/unsolvable systems**: a singular Newton Jacobian is detected
  by `linalg.js`'s pivoting check and reported as `status:
  'singularJacobian'` rather than returning garbage.
- **Optimizer robustness**: `optimize.test.js` covers (a) bounds are never
  violated even under an intentionally unreachable target, (b) an
  unreachable target (bounds pinned, tolerance not met) is reported as a
  distinct `unreachableTarget` status rather than conflated with ordinary
  non-convergence, (c) a hydraulic solve that cannot converge for any
  candidate (forced via `hydraulicOptions.maxIterations: 0` in the test)
  degrades to a `hydraulicConverged: false` best-effort result instead of
  crashing or falsely reporting success, (d) invalid configurations
  (missing targets/adjustable elements, a non-pipe/valve/HX adjustable
  element) are rejected up front.
- **File import validation** (`io.test.js`): malformed JSON, a missing
  `schemaVersion`, a `schemaVersion` newer than supported, and a dangling
  node reference are each rejected with a specific, human-readable error
  string and `network: null` (the current in-memory network is left
  untouched by a failed import — verified by the app wiring in
  `src/web/js/state.js`, which only calls `setState` on success).
- **Goal-seek stale-reference pruning** (`model.test.js`, `io.test.js`):
  fixes a real user-reported bug (`Adjustable element "el_valve_b" not
  found`) caused by `network.goalSeek.targets`/`adjustable` keeping a
  reference to an element after it (or its node, cascading) was deleted,
  or a hand-edited save file listing one that never existed --
  `optimizeAdmittances()` correctly rejected these as
  `invalidConfiguration`, but nothing had previously stopped the stale
  reference from existing in the first place. `pruneGoalSeekReferences()`
  is now called from both `state.js`'s `deleteSelection()` and `io.js`'s
  `importNetwork()` (the latter with a warning) so Goal Seek only ever
  lists elements that actually exist.

## 5. Static/dynamic verification beyond the unit tests

In addition to `npm test`:

- **Lint**: `npx eslint .` — 0 errors, 0 warnings across `src/` and
  `test/` (ESLint flat config, `eslint.config.js`).
- **Build**: `node scripts/build.js` — copies `src/web` + `src/solver`
  into `dist/`, then statically re-resolves every relative `import`
  found in the copied files and fails the build if any target file is
  missing. Passed (40 JS files copied and resolved cleanly).
- **Live module-graph verification**: `npm start` was run and a script
  fetched `src/web/js/app.js` over HTTP and recursively followed every
  relative `import` specifier exactly as a browser's module loader would
  (resolving against each file's own served URL, not its filesystem
  path). This is a stronger check than the build script's filesystem-based
  check, because it exercises the exact URL-resolution semantics a real
  browser uses. **This originally caught a real bug** (in an earlier
  session): the browser-side `src/web/js/state.js` imported the solver
  core with `from '../../solver/index.js'` (one `..` too many — it only
  "worked" locally because the extra `..` clamped at the domain root,
  which happened to be where the solver was also served). That path
  broke as soon as the app was reverse-proxied under an nginx sub-path
  prefix (`/NetworkSolver/`), since the extra `..` then escaped the
  prefix entirely. Fixed by correcting the import to `from
  '../solver/index.js'` (the actually-correct relative depth, which
  resolves correctly under any mount path) and by giving
  `src/server/server.js` a `SOLVER_ROOT` for `/solver/*` requests. The
  live module-graph walk was re-run after adding `complexExample.js` in
  this round of work and confirmed all modules (including the new file)
  still resolve with HTTP 200, both at the domain root and through the
  nginx `/NetworkSolver/` prefix.
- **Element ID cross-check**: every `document.getElementById(...)` call in
  `src/web/js/*.js` was grepped and cross-checked against the `id="..."`
  attributes in `src/web/index.html` — all match.

## 6. Known gap: no interactive (click-through) browser test

This environment's execution policy blocked installing a headless-browser
automation tool (the attempted `npm install playwright` was refused by
the sandbox's automated safety classifier as an undeclared dependency
whose install step executes/downloads external binaries), and no
browser-automation tool was already available. As a result, **the UI was
not visually exercised by clicking through it in an actual rendered
browser** (e.g. confirming pixel-level rendering, actually dragging a node
with the mouse, watching the results tables populate on screen). What
*was* verified, as detailed above, is: the solver logic the UI calls into
(automated, 39 passing tests including the exact example-network
workflow), that every asset and ES module the browser would request is
served correctly and every import resolves (live HTTP module-graph walk,
which did catch and fix a real routing bug), full lint cleanliness, a
successful build, and a manual code-review pass of the DOM/event-handling
code (ID cross-references, event listener wiring, state-update flow).
Recommended next step for full confidence: run `npm start` and open
`http://localhost:4173` in a real browser (or install a browser-automation
tool with explicit user approval) to click through Load Example → Solve →
Goal Seek → Save/Load.
