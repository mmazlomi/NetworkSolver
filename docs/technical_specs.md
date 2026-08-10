# Technical Specification — NetworkSolver

This document describes the mathematical model, numerical formulation, and
solver/optimizer algorithms actually implemented in `src/solver/`. It
assumes the reader has read `docs/research.md` for the rationale behind
each choice.

## 1. Notation and units

- Pressure `p`: pascals (Pa), absolute or gauge consistently per project.
- Elevation `z`: metres (m).
- Flow `Q`: m³/s, signed. For an element with `sourceNodeId`/`targetNodeId`,
  `Q > 0` means flow from source to target.
- Temperature `T`: °C.
- Admittance `A`: m³/s per √Pa, i.e. `Q = A·sign(Δp)·√|Δp|`.
- Fluid properties: density `ρ` (kg/m³), specific heat `cp` (J/(kg·K)),
  viscosity `μ` (Pa·s) — network-level constants (`network.fluid`).

### 1.1 Node types (`model.js`)

`nodeType` is `'junction'` (default), `'reservoir'`, or `'tank'`:

- **Junction** — a plain node. `boundary.pressure`/`flow`/`temperature`
  are independent user toggles, as described throughout this document.
- **Reservoir** — an infinite fixed-head source. `createNode()` always
  sets `boundary.pressure = {fixed: true, value: 0}` for a reservoir (a
  free water surface is, by definition, at 0 gauge/reference pressure);
  its entire hydraulic significance is carried by `elevation`. This
  mirrors EPANET's own Reservoir concept (a single "Head" value).
- **Tank** — a finite fixed-head source/sink for one steady-state
  snapshot. Same automatic `pressure = {fixed: true, value: 0}` as a
  reservoir, plus `params: {diameter, minLevel, maxLevel, level}` (all in
  meters; `diameter` is informational only — NetworkSolver does not
  simulate fill/drain over time). A tank's hydraulic significance is
  `elevation + params.level` (its base elevation plus its current water
  depth), obtained via `getEffectiveElevation(node)`.

`getEffectiveElevation(node)` is what the hydraulic solver actually reads
(§2.1) — always use it instead of `node.elevation` directly when a value
needs to reflect a tank's current level. `validateNetwork()` additionally
rejects a tank with `diameter <= 0` or `minLevel > maxLevel`
(`INVALID_TANK_PARAMS`), and warns (non-blocking) if `level` is currently
outside `[minLevel, maxLevel]` (`TANK_LEVEL_OUT_OF_RANGE`).

## 2. Element mathematical models

All hydraulic element models reduce to a function
`Q = flow(pIn, pOut, zIn, zOut, admittance, params, fluid)`, where `pIn/zIn`
and `pOut/zOut` are the source/target node pressure and elevation. This
uniform interface (`src/solver/elements/*.js`) is what lets the hydraulic
solver treat every element type identically (see §3).

### 2.1 Effective driving pressure

For every element type:

```
Δp_eff = (pIn + ρ·g·zIn) − (pOut + ρ·g·zOut)      [common.js: effectiveDeltaPressure]
```

`g = 9.80665 m/s²`. Elevation is optional (defaults to 0), folding
hydrostatic head directly into the pressure-based formulation instead of
introducing a separate head/elevation unit system. `zIn`/`zOut` are each
node's `getEffectiveElevation()` (§1.1), not necessarily its raw
`elevation` field — for a tank, this is elevation + current level.

### 2.2 Pipe

The network as a whole selects one of two headloss models via
`network.headlossModel` (`'darcyWeisbach'` default, or `'hazenWilliams'`) —
a network-wide choice, not per-pipe, matching EPANET's own network-wide
`[OPTIONS] Headloss` setting (see docs/research.md §2.8). Every pipe's flow
reduces to the same admittance-flow shape, `Q = A · sign(Δp) · |Δp|^n`, with
the exponent `n` and the admittance `A` computed differently per model:

**Darcy-Weisbach** (`n = 0.5`) — friction factor + minor losses, condensed to
a resistance `R` such that `Δp = R·Q·|Q|`, re-expressed as `A = 1/√R`:

```
Re = ρ·v_ref·D / μ                    (v_ref = 1 m/s, representative velocity)
f  = 64/Re                            if Re < 2300 (laminar)
f  = 0.25 / [log10(ε/(3.7D) + 5.74/Re^0.9)]²     otherwise (Swamee-Jain)
R  = [f·(L/D) + K_local] · ρ / (2·Area²),   Area = πD²/4
A_nominal = 1/√R
```

**Hazen-Williams** (`n = 1/1.852`) — inverted from the standard SI headloss
equation `h_L = 10.67·L·Q^1.852 / (C^1.852·D^4.8704)` (h_L, L, D in metres, Q
in m³/s, `C` the pipe's `hazenWilliamsC` roughness coefficient), converted to
a pressure basis via `Δp = ρ·g·h_L`:

```
A_nominal = [C^1.852 · D^4.8704 / (10.67 · L · ρ · g)]^(1/1.852)
```

Minor losses (`K_local`) are **not** included under Hazen-Williams — see
docs/research.md §2.8/§7 for why (EPANET itself adds them as a separate
Darcy-Weisbach-style term, which would make `Q(Δp)` a non-invertible
two-term sum; this is a documented simplification). Hazen-Williams is also
only valid for water, per its own empirical basis.

`A_nominal` is a convenience value (`computeNominalAdmittance(params, fluid,
headlossModel)`) used to seed `admittance.initial`/`current` from geometry;
the solver itself always uses whichever value is in `admittance.current`
(constant during a solve — see docs/research.md §2.3 for why the friction
factor is not re-linearized every Newton iteration). Because of this,
editing `params.length`/`diameter`/`roughness`/`hazenWilliamsC`/etc., or
switching `network.headlossModel` itself, has **no effect on the solve** by
itself -- the UI is responsible for recomputing `admittance.current`:
`src/web/js/ui/inspector.js`'s `updateElementParam` recomputes it whenever a
geometry/roughness/C field changes, and `src/web/js/state.js`'s
`store.setHeadlossModel(model)` recomputes it for *every* pipe in the
network when the model itself is switched (otherwise a pipe would keep an
admittance sized for the old model while the new model's exponent gets
applied to it in `flow()`, silently producing wrong physics). Code that
constructs a network directly (tests, example builders, scripted imports)
must call `computeNominalAdmittance` itself if it wants `admittance.current`
to reflect its geometry — creating an element with new geometry params does
*not* implicitly (re)compute admittance.

Flow: `Q = admittanceFlow(Δp_eff, A, n) = A · signedPow(Δp_eff, n)`, where
`signedPow(x, n, delta) = x · (x² + delta²)^((n−1)/2)` is a smoothed
generalization of `signedSqrt` (`signedPow(x, 0.5, delta) ≡ signedSqrt(x,
delta)`) — smooth and finite at `Δp_eff = 0` for any exponent, keeping the
Newton Jacobian finite regardless of which headloss model is active.

Thermal (exponential heat loss to ambient), affine in inlet temperature:

```
ṁ = ρ·|Q|,  UA_pipe = h·(π·D)·L
Tout = a·Tin + b,  a = exp(−UA_pipe / (ṁ·cp)),  b = T_ambient·(1 − a)
```

### 2.3 Valve

Kv-rating-based admittance, scaled by an opening-percent characteristic
curve:

```
x = clip(openingPercent/100, 0, 1)
Kv_eff = Kv_rated · x                          (linear)
       = Kv_rated · √x                          (quick opening)
       = Kv_rated · 50^(x−1)                     (equal percentage, rangeability 50)
A_nominal = (Kv_eff / 3600) · √(1 / (1e5 · SG)),   SG = ρ/1000
```

(from `Q[m³/h] = Kv·√(Δp[bar]/SG)`, converted to SI Pa/m³/s.)

Same caveat as the pipe (§2.2): `A_nominal` only seeds `admittance.current`
when something explicitly calls `computeNominalAdmittance` — the property
inspector does this automatically whenever `openingPercent`, `kvRated`, or
`characteristic` changes, which is what makes moving a valve's opening
actually change the solved flow.

Flow: same admittance relation as the pipe. If `|Δp_eff|` exceeds
`params.maxDeltaP`, the element is marked `valid: false` with a diagnostic
message (does not stop the solve — the flow value is still physical, just
outside the configured limit).

Thermal: adiabatic (`Tout = Tin`) — throttling temperature effects are not
modeled (documented limitation).

### 2.4 Pump

A quadratic head-flow curve, `H(Q) = H0 − k·Q²` (Pa), derived from
parameters:

- `mode: 'curve'` — `H0 = curveShutoffHead`, `k = (H0 − nominalHead)/nominalFlow²`.
- `mode: 'fixedHead'` — approximated by a very steep curve,
  `H0 = fixedHead`, `k = H0·1e-6/refFlow²` (see docs/research.md for why a
  literal constant-head source is not solvable in this Q(Δp) formulation
  and why a steep curve is an adequate, numerically well-posed stand-in).
- `speedFactor s` applies the affinity-law transform `H(s,Q) = s²H0 − kQ²`.

With `dp_ST = Δp_eff` (source→target, as in §2.1) and `forward` = pump
installed to push flow source→target (`direction: 'sourceToTarget'`):

```
deltaRiseForward = forward ? −dp_ST : dp_ST
Qforward = signedSqrt(H0 − deltaRiseForward) / √k
Q = forward ? Qforward : −Qforward
```

This keeps the pump inside the same `Q = f(Δp)` shape every other element
uses, including graceful (smooth, signed) behavior in reverse/shutoff
conditions rather than a hard clamp.

Optional thermal contribution (irreversible heating from pump
inefficiency), only if `params.thermalContribution` is enabled:

```
hydraulicPower = max(H0 − kQ², 0) · |Q|
wasteHeat = hydraulicPower · (1 − efficiency)
ΔT = wasteHeat / (ρ·|Q|·cp)     (added as the affine "b" term, a = 1)
```

### 2.5 Heat exchanger

Hydraulically identical to a pipe/valve (admittance-based
`Q = A·signedSqrt(Δp_eff)`), with `admittance.current` set directly (no
geometry-based nominal-admittance derivation).

Thermal: effectiveness-NTU, counter-flow correlation:

```
C1 = ρ·|Q|·cp                       (primary capacity rate)
Cmin = min(C1, secondaryCapacityRate),  Cmax = max(C1, secondaryCapacityRate)
Cr = Cmin/Cmax
NTU = ua / Cmin
ε = NTU/(1+NTU)                                   if Cr ≈ 1
ε = (1 − e^{−NTU(1−Cr)}) / (1 − Cr·e^{−NTU(1−Cr)}) otherwise
```

(or `ε = params.effectivenessValue` directly, if `effectivenessMode ===
'effectiveness'`.) Duty and outlet temperature:

```
Qdot = ε·Cmin·(Tin − Tsecondary)
Tout = Tin − Qdot/C1              i.e. a = 1 − ε·Cmin/C1, b = ε·Cmin/C1·Tsecondary
```

## 3. Hydraulic network equations and Newton-Raphson solution

**File:** `src/solver/hydraulics.js`

### 3.1 Formulation

Nodes are partitioned into:
- **Fixed-pressure nodes** (`boundary.pressure.fixed`): pressure is a
  known boundary condition (like a reservoir/plenum); at least one is
  required (validated in `validate.js`, code `NO_PRESSURE_REFERENCE`).
- **Internal nodes**: unknowns, one scalar (pressure) each. External
  injection is `boundary.flow.value` (default 0), positive meaning flow
  *into* the network at that node.

For each internal node `i`, the steady-state mass-balance residual is:

```
R_i(p) = Σ_{elements with source=i} Q_e(p) − Σ_{elements with target=i} Q_e(p) − injection_i
```

The unknown vector `x` (internal node pressures) satisfies `R(x) = 0`.
This is a system of `n` nonlinear equations (`n` = number of internal
nodes), each equation nonlinear because every `Q_e` is a `signedSqrt` (or
pump-curve) function of `x`.

### 3.2 Newton-Raphson iteration

```
x_{k+1} = x_k − factor · J(x_k)^{-1} R(x_k)
```

- **Jacobian `J`**: computed by forward finite differences,
  `J[:,j] = (R(x + h·e_j) − R(x)) / h`, `h = finiteDiffStep` (default
  1e-2 Pa). This is deliberately generic — it never branches on element
  type, so a new element module only needs a `flow()` function to
  participate correctly (docs/research.md §4, "ideas rejected: analytic
  Jacobian").
- **Linear solve**: dense Gaussian elimination with partial pivoting
  (`linalg.js: solveLinearSystem`), sized for the small (tens-of-nodes)
  networks this tool targets.
- **Damped step / backtracking line search**: `factor` starts at 1 and is
  halved (down to a floor) until the trial step reduces
  `‖R‖_∞`, guarding against Newton overshoot from the nonlinear
  `signedSqrt` terms.
- **Convergence**: `‖R‖_∞ < flowTolerance` (default 1e-6 m³/s) **and**
  `‖Δx‖_∞ < headTolerance` (default 1e-2 Pa).
- **Smoothing near zero flow**: `signedSqrt(x, δ) = x / √(√(x² + δ²))`
  (`linalg.js`) replaces a bare `sign(x)·√|x|`, keeping the Jacobian
  finite at `Δp = 0` — without this, near-balanced branches produce an
  infinite/undefined derivative and Newton fails to converge.

### 3.3 Status and diagnostics

`solveHydraulics()` returns `{ status, converged, iterations, residualNorm,
history[], nodePressures, massBalanceResidual, elementResults, errors,
warnings }`. `status` is one of `converged`, `maxIterationsReached`,
`singularJacobian`, `stalled`, `invalidNetwork` (no pressure reference).
Non-finite element flows are surfaced as `NON_FINITE_FLOW` errors rather
than silently propagating `NaN`/`Infinity`. `history[]` records
`{iteration, residualNorm, maxDx, stepFactor}` per accepted step.

## 4. Thermal network equations

**File:** `src/solver/thermal.js`

Once hydraulics has converged, flow direction and magnitude are known for
every element, and the energy balance is **linear** in temperature — no
iteration is required (a deliberate simplification enabled by solving
hydraulics first; see docs/research.md §6).

For each element, the upstream/downstream node is whichever the resolved
flow sign implies, and each element module supplies
`thermalTransfer({Q, params, fluid}) -> {a, b}` such that
`Tout = a·Tin + b` (§2.2–2.5).

For every node without a fixed temperature and with at least one inbound
flow, perfect mixing gives a linear equation:

```
(Σ_e ṁ_e·cp) · T_i − Σ_e (ṁ_e·cp·a_e)·T_upstream(e) = Σ_e (ṁ_e·cp·b_e)
```

summed over inbound elements `e` (`ṁ_e = ρ·|Q_e|`). Nodes with a fixed
temperature contribute their value directly to the right-hand side of
downstream rows (Dirichlet condition) rather than being solved for.
Assembled into a dense `M·T = b` system and solved with the same
`solveLinearSystem`. Nodes with no fixed temperature and no inbound flow
are reported as `null` with a `TEMPERATURE_INDETERMINATE` warning rather
than guessed.

Per-element `heatDuty = ṁ·cp·(Tin − Tout)` is reported for every element
type (0 for adiabatic ones).

## 5. Admittance goal-seek (simultaneous multi-variable optimization)

**File:** `src/solver/optimize.js`

### 5.1 Problem statement

Given `k` targets `{elementId, targetFlow}` and `p` adjustable elements
(pipes/valves/heat exchangers only -- any element type with an
admittance, not just valves; pumps are excluded since they're driven by a
head curve, not an admittance) each with bounds `[min, max]`, find
admittances `x ∈ ℝ^p` minimizing

Note: `targetFlow`, `tolerance`, and every flow in `optimize.js` and
`network.goalSeek` are m³/s internally, same as every other flow in the
solver. The Goal Seek UI (`src/web/js/ui/goalSeekPanel.js`) displays and
accepts these in kg/s instead (converting via the network's fluid
density, exactly like the Results tab's mass-flow column) -- a
display-only choice at the UI boundary, not a change to this data model.

```
F(x) = [ Q_1(x) − target_1, ..., Q_k(x) − target_k ]     (residual vector)
minimize ‖F(x)‖₂²   subject to   min_j ≤ x_j ≤ max_j
```

where `Q_i(x)` requires a **full hydraulic re-solve** of the network with
the candidate admittances applied — coupled branches are handled exactly,
never approximated (Phase 7 requirement).

`optimizeAdmittances()` rejects (`status: 'invalidConfiguration'`) if any
target/adjustable `elementId` doesn't resolve to an element in the
network. To keep that from being reachable through ordinary use rather
than only reported after the fact, `model.js`'s `pruneGoalSeekReferences(goalSeek, elements)`
drops any target/adjustable entry whose `elementId` isn't in `elements`,
and is called from both of the two places a reference can otherwise go
stale: `state.js`'s `deleteSelection()` (deleting an element, or a node —
which cascades to delete its attached elements) and `io.js`'s
`importNetwork()` (a hand-edited or corrupted save file), the latter
emitting a warning when it prunes anything.

### 5.2 Algorithm — bounded Levenberg-Marquardt

1. `x_0` = current admittances of the adjustable elements (clipped to bounds).
2. At each iteration:
   - Build the `k×p` Jacobian `J` by forward differences: perturb each
     `x_j` (clipped to its bound), re-solve hydraulics, record
     `∂residual_i/∂x_j`.
   - Solve the damped normal equations
     `(JᵀJ + λ·diag(JᵀJ)) Δx = −Jᵀr` via `solveLinearSystem`.
   - Trial step `x_trial = clip(x + Δx, min, max)`, evaluated with a full
     hydraulic re-solve.
   - **Accept** if the hydraulic solve converged and
     `‖F(x_trial)‖ < ‖F(x)‖`: adopt `x_trial`, decrease `λ ← λ/3`.
   - **Reject** otherwise: increase `λ ← λ·4` (Levenberg-Marquardt
     trust-region behavior — large `λ` degrades toward gradient descent
     with a small step, small `λ` toward Gauss-Newton).
3. Stop when `‖F(x)‖ < tolerance` (**converged**), `maxIterations` is
   reached, `λ` saturates without an accepted step (**stalled**), or the
   normal-equations solve is singular.
4. **Bounds are enforced by clipping every candidate**, never by relaxing
   them — admittances are never negative or outside `[min, max]`.
5. **Best-feasible tracking**: every iterate (`accepted` or `rejected`) is
   recorded in `history[]`; `best` is the lowest-residual iterate whose
   hydraulic solve converged, even if the run overall did not reach
   `tolerance`. The base network is never mutated — `applyOptimizationResult()`
   is a separate, explicit step (Phase 7: "preserve the original network
   until the user applies the result").
6. **Unreachable-target detection**: if the run ends without meeting
   tolerance and every adjustable variable in the best iterate sits at one
   of its bounds, the status is reported as `unreachableTarget` (distinct
   from ordinary non-convergence) — see the `unreachableTarget` test in
   `test/optimize.test.js`.
7. **Configuration validation**: missing targets/adjustable elements, an
   adjustable element that is not a pipe/valve/heat exchanger, or a
   nonexistent element id are rejected up front as `invalidConfiguration`
   without running any hydraulic solve. Fewer adjustable elements than
   targets produces a warning (possible over-constraint) but still runs.

### 5.3 History record shape

Each `history[]` entry: `{ iteration, note ('seed'|'accepted'|'rejected'),
admittances: {elementId: value}, actualFlows: {elementId: value},
targetErrors: {elementId: value}, residualNorm, boundsReached: [{elementId,
bound}], hydraulicStatus, hydraulicConverged }` — directly renderable as
the goal-seek history table (Phase 7 requirement list).

## 6. Diagnostics and result normalization

**Files:** `src/solver/diagnostics.js`, `src/solver/validate.js`

`validateNetwork()` runs structural/physical checks before any solve
(duplicate ids, dangling references, self-loops, invalid parameters,
admittance bounds, over-constrained nodes, disconnected regions without
their own pressure reference, isolated nodes, missing inflow-temperature
boundary conditions) and returns `{valid, errors[], warnings[]}` with
stable `code` values (see `validate.js` for the full list) rather than
throwing. `buildDiagnostics()` merges validation + hydraulic + thermal
output into one `{status, errors, warnings, hydraulic}` object consumed
uniformly by the UI; `status` is `ok`, `warning`, `notConverged`, or
`error`.

## 7. Save/load format

**File:** `src/solver/io.js` — see docs/research.md §2.7 for the
versioning rationale. `exportNetwork()` produces
`{schemaVersion, exportedAt, meta, fluid, headlossModel, nodes, elements,
goalSeek, resultsCache}`; `resultsCache` is explicitly labeled and discarded
(with a warning) on import — `importNetwork()` always returns a network with
`computed.*` reset to `null`, forcing a fresh solve rather than trusting
stale cached values. `headlossModel` round-trips through save/load like any
other network-wide setting; a file saved before this field existed simply
lacks it, and `createNetwork()`'s `overrides.headlossModel || 'darcyWeisbach'`
default means it imports as Darcy-Weisbach, preserving old files' original
behavior unchanged. Files with a `schemaVersion` newer than the
application's are rejected with a clear message; missing/malformed
structure is rejected with specific error strings (see
`test/io.test.js`).
