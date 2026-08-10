# Research Report — Browser Thermo-Hydraulic Network Tool

Date: 2026-08-02

## 1. Scope of research

Before writing any code, existing tools, libraries and numerical approaches
were reviewed across the categories requested: web-based hydraulic/thermal
network tools, open-source solvers, EPANET-family applications, browser graph
editors, JS numerical libraries, engineering-simulation UI conventions, and
save/load practices.

## 2. Tools and libraries reviewed

### 2.1 Hydraulic/thermo-hydraulic network tools
- **EPANET (US EPA)** — the reference open-source water-distribution solver.
  Public-domain (US government work), source at
  https://github.com/USEPA/EPANET2.2 / https://www.epa.gov/water-research/epanet.
  Uses steady-state and extended-period simulation of pressurized pipe
  networks. Its bundled tutorial network **"Net1"** (`example-networks/Net1.inp`,
  https://github.com/OpenWaterAnalytics/EPANET) — a reservoir + pump + tank
  feeding a two-loop 9-junction network — is one of the most widely cited
  benchmark networks in water-distribution literature and software
  tutorials, and was later adopted verbatim (converted to SI units, with a
  documented approximation for the one part of EPANET's model NetworkSolver
  doesn't share — dynamic tanks, since NetworkSolver is steady-state only;
  the Hazen-Williams roughness itself is now reproduced exactly, not
  approximated, once the network-wide headloss model feature existed — see
  §2.8) as the built-in **"EPANET Net1 Benchmark"** example; see
  docs/user_manual.md §9 for the full conversion write-up. No EPANET code
  was used, only its published, public-domain input-file data.
- **Larock, Jeppson & Watters, *Hydraulics of Pipeline Systems*** (2000, CRC
  Press) — a standard hydraulics/fluid-mechanics handbook. Its Example 2.7
  (the classic "three-reservoir problem": three fixed-elevation reservoirs
  feeding one junction with an external demand) is a widely reproduced
  textbook benchmark for junction-node pipe network analysis, independent
  of any particular modeling software — unlike the EPANET Net1 benchmark
  above, which validates against a *software* reference, this validates
  against a *textbook* one. Adopted as the built-in **"Three-Reservoir
  Problem (Handbook Benchmark)"** example after cross-checking its input
  data and published answer against a second, independent citation of the
  same example (a commercial pipe-network solver's own published
  results-verification page, which cites the same textbook/example
  number) — see docs/user_manual.md §10 for the full write-up, including
  how closely NetworkSolver's own solve reproduces the published flows.
- **EPANET 3 / Global Gradient Algorithm (GGA) research** —
  "Extending EPANET Hydraulic Solver Capacity with Rigid Water Column Global
  Gradient Algorithm" (ScienceDirect: https://www.sciencedirect.com/science/article/abs/pii/S1570644322000211,
  Zenodo record: https://zenodo.org/records/5105780). Confirms GGA is a
  Newton-based simultaneous solution of mass and energy conservation, and is
  the algorithm EPANET's developers judged to have the best convergence and
  efficiency among alternatives.
- **epanet-js** (https://epanetjs.com/) — a browser port of EPANET with a
  visual editor; confirms that "solver in the browser, no server round trip"
  is a proven, accepted product shape for this problem domain.
- **HydroBOA** (https://hydroboa.com/epanet-online), **SimuPipe**
  (https://simupipe.com/), **Fluid Network Studio**
  (https://www.fluidnetworkstudio.com/) — commercial/hosted pipe-network
  simulators. Useful for UI conventions (network canvas + property inspector
  + results table + `.inp`-like import) but source is closed; no code or
  text was reused. district-heating-specific open tools were not found to be
  as mature as water-network tools (confirmed via the EPANET forum thread on
  district heating: https://www.openepanet.org/Topic/23038/district-heating-simulation),
  which supports building a general-purpose thermo-hydraulic (not
  water-distribution-specific) tool rather than assuming EPANET's exact
  domain model.

### 2.2 Numerical method for pipe networks
- Hardy Cross method (1936 loop-correction method) vs. Newton-Raphson —
  per multiple sources (ResearchGate "Analysis of a Water Distribution
  Network by Newton-Raphson Multivariable Method",
  https://www.researchgate.net/publication/340681812;
  "Hardy Cross Method for Pipe Networks",
  https://www.researchgate.net/publication/331095044) Newton-Raphson solves
  the whole system of nodal/loop equations simultaneously and converges
  faster and more reliably than Hardy Cross, which corrects one loop/node at
  a time. GGA (used by EPANET) is itself a Newton-based method.
- **Conclusion adopted:** use a Newton-Raphson formulation rather than Hardy
  Cross. Hardy Cross is easier to hand-compute but converges slowly and
  poorly on networks with widely varying resistances (exactly the situation
  created by the admittance goal-seek feature, which pushes admittances
  toward their bounds). Newton-Raphson is standard, well documented, and
  keeps the solver aligned with what EPANET/GGA and current literature use.

### 2.3 Valve/pipe flow-pressure relations
- Cv/Kv flow-coefficient definitions and the governing equation
  `Q = Kv * sqrt(Δp / ρ)` (H2X Engineering guide:
  https://www.h2xengineering.com/blogs/flow-coefficient-guide-valve-sizing/;
  Tameson Kv calculator: https://tameson.com/pages/kv-calculator). This
  confirms a **flow-coefficient ("admittance") formulation**, `Q = A · sign(Δh) · sqrt(|Δh|)`,
  is the natural unifying representation for both pipes (where the pipe
  resistance from Darcy–Weisbach + minor losses is condensed into an
  equivalent admittance `A = 1/√R`) and valves (whose Kv/Cv rating is
  literally this same coefficient). This directly matches the task's
  requirement that pipes *and* valves expose an adjustable "admittance" —
  the spec's vocabulary lines up with standard valve-sizing theory, so the
  admittance model was chosen as the single element abstraction rather than
  inventing a parallel resistance-based model.

### 2.4 JS numerical libraries
- `math.js` (https://mathjs.org/), `ml-matrix`
  (https://www.npmjs.com/package/ml-matrix), `numeric.js`, `linear-algebra`
  (npm) all provide dense linear-algebra/matrix-solve primitives.
  **Rejected** for this project: the network sizes targeted by an
  interactive browser editor are small (tens of nodes/elements), so a full
  external linear-algebra dependency is unjustified weight. Just as
  importantly, this project deliberately ships **no bundler** (plain
  `<script type="module">` ES modules loaded by the browser); pulling in an
  npm package for in-browser use would require either a bundler/import-map
  or vendoring the library, which conflicts with the "lightweight, easy to
  maintain, framework-free" constraint. A ~60-line dense Gaussian-elimination
  solver with partial pivoting was written instead
  (`src/solver/linalg.js`), sized exactly to the problem (small dense
  systems from Newton iteration and thermal mixing), with no dependency
  footprint and no build step required for the browser to load it directly.
- No JS Levenberg-Marquardt library with first-class bound constraints was
  found that is small, actively maintained, and browser-loadable without a
  bundler (search: "bounded multivariable nonlinear least squares
  Levenberg-Marquardt JavaScript library"). **Decision:** implement a small
  bounded Gauss-Newton / Levenberg-Marquardt-style solver in-house
  (`src/solver/optimize.js`) using a forward-difference Jacobian and
  a damping parameter, with explicit projection onto `[min, max]` admittance
  bounds after each step (documented academic pattern: "A Levenberg-Marquardt
  method for large-scale bound-constrained nonlinear least-squares",
  https://open.library.ubc.ca/soa/cIRcle/collections/ubctheses/24/items/1.0051461).
  This mirrors the method's spirit without importing a mismatched general
  optimization package.

### 2.5 Browser graph/schematic editors
- **LiteGraph.js** (https://github.com/jagenjo/litegraph.js) — MIT-licensed,
  dependency-free, canvas-based node-graph editor. Actively used for
  "blueprint"/dataflow-style editors.
- **Rete.js, Drawflow, jsPlumb, Cytoscape.js** — also reviewed
  (https://js.cytoscape.org/, GitHub topic search "node-graph").
- **Rejected.** All of the above model a graph as *boxes with input/output
  ports* (dataflow/blueprint programming UI) or as an *abstract graph for
  analysis* (Cytoscape). This project's domain graph is different: **nodes
  are physical junctions (vertices) and elements are two-terminal physical
  components (edges)** — the same shape as an electrical/P&ID schematic, not
  a dataflow graph. Forcing a blueprint-node library onto a vertex/edge
  network means fighting its port/socket abstraction for no benefit, adds a
  non-trivial dependency, and works against the "keep the UI lightweight and
  maintainable" and "modular `.js` files with native DOM events" constraints.
  Given the small, well-bounded interaction surface required (place a node,
  drag between two nodes to create an element, select/move/delete), a
  focused hand-written SVG editor (`src/web/js/editor/`) using native SVG +
  pointer events is simpler, has zero dependency risk, and is easier to
  extend when new element types are added. This is an explicit "library vs.
  hand-rolled" engineering trade-off, made in line with the constraint that
  a library should only be used "if necessary" — it was judged not
  necessary here because the interaction set is small and the domain
  mismatch with existing libraries is significant.

### 2.6 Engineering-simulation UI conventions
Reviewed conventions common to EPANET-family and process-simulation tools
(from HydroBOA/epanet-js/SimuPipe product pages and general P&ID editor
practice): canvas + palette + property inspector + results table is the
near-universal layout; colour/style coding of pipes vs. valves vs. pumps;
a separate results/diagnostics panel that never overlaps the canvas; distinct
treatment of boundary nodes (fixed pressure/temperature) vs. internal nodes.
These conventions were adopted directly into the UI design (Phase 8).

### 2.7 Save/load and schema versioning
- General schema-versioning guidance (offlinetools.org "Schema Versioning
  for JSON Configuration Files": https://offlinetools.org/a/json-formatter/schema-versioning-for-json-configuration-files;
  Confluent schema-evolution docs: https://docs.confluent.io/platform/current/schema-registry/fundamentals/schema-evolution.html)
  confirms the common pattern: **integer `schemaVersion` field**, bump only
  on breaking changes, unknown fields preserved/ignored by readers so old
  files keep loading. This is exactly the pattern implemented in
  `src/solver/io.js`: an explicit `schemaVersion`, a permissive importer that
  keeps unrecognized top-level keys, and validation that rejects files with
  an incompatible (newer, unknown) major version with a clear message rather
  than guessing.

### 2.8 EPANET's headloss models (Darcy-Weisbach vs. Hazen-Williams)
- EPANET's general headloss equation is `h_L = A · q^B` (per element, `A` a
  resistance coefficient and `B` an exponent), with three selectable
  network-wide `[OPTIONS] Headloss` formulas: **Hazen-Williams** (`B=1.852`,
  `A` a constant derived from length/diameter/roughness-coefficient `C`,
  independent of flow), **Darcy-Weisbach** (`B=2`, `A` depends on a
  flow-dependent friction factor recomputed every iteration), and
  **Chezy-Manning** (open-channel, not applicable to a pressurized-pipe
  network like this one). This confirmed two things used in this feature:
  (1) NetworkSolver's existing admittance exponent (0.5, i.e. EPANET's
  `B=2`/Darcy-Weisbach) was already consistent with one of EPANET's two
  pressurized-flow options, and (2) EPANET treats the headloss *model choice*
  as **network-wide**, not per-element — a user picks one formula for the
  whole project, matching exactly what was requested here (a single toggle,
  not a per-pipe setting).
- The SI Hazen-Williams equation used is the standard textbook form
  `h_L = 10.67 · L · Q^1.852 / (C^1.852 · D^4.8704)` (h_L, L, D in metres, Q
  in m³/s, C a dimensionless roughness coefficient) — this is the same
  equation EPANET itself implements for its Hazen-Williams option. Converting
  to a pressure basis (`Δp = ρ·g·h_L`) and inverting for `Q` gives an
  admittance-flow relation of the same `Q = A · sign(Δp) · |Δp|^n` shape
  already used throughout NetworkSolver, just with `n = 1/1.852` instead of
  `n = 0.5` — so the feature could be added as a per-network exponent choice
  without changing the Newton-Raphson solver itself (see §6).
- **Decision:** rather than expose a raw numeric exponent to the user (which
  would mean nothing physically to most users and could be set to values
  EPANET itself doesn't support), the UI presents the two named EPANET
  formulas directly (`network.headlossModel: 'darcyWeisbach' | 'hazenWilliams'`),
  keeping the exponent an internal implementation detail. Hazen-Williams'
  minor losses are intentionally *not* modeled (see §7) — EPANET itself adds
  them as a separate Darcy-Weisbach-style term even under Hazen-Williams,
  which would make a pipe's `Q(Δp)` relation a non-invertible two-term sum;
  omitting them under Hazen-Williams keeps every element's `flow()`
  closed-form, at the cost of slightly under-predicting losses on pipes with
  large local-loss coefficients under that model.

## 3. Main ideas adopted
1. **Admittance-based unified element model** (`Q = A · sign(Δh) · sqrt(|Δh|)`,
   smoothed near `Δh = 0`) for pipes and valves, extended with an invertible
   quadratic head-flow curve for pumps and a duty/ΔT model for heat
   exchangers — from Cv/Kv valve theory and Darcy-Weisbach pipe theory.
2. **Newton-Raphson nodal solve** (heads as unknowns, mass-balance residual
   per node, numerical/finite-difference Jacobian) instead of Hardy Cross —
   from EPANET/GGA literature and Newton-vs-Hardy-Cross comparisons.
3. **Bounded Gauss-Newton/Levenberg-Marquardt-style goal seek** with a
   forward-difference Jacobian and bound projection, run against the full
   nodal solver at every candidate step — informed by bound-constrained LM
   literature, implemented in-house.
4. **Hand-written SVG schematic editor** instead of a dataflow-graph library
   — domain mismatch made existing libraries a poor fit; native SVG/DOM
   keeps the app dependency-free and consistent with the "vanilla JS, no
   framework" constraint.
5. **In-house dense linear solver** instead of an external matrix library —
   avoids a bundler/import-map requirement for the browser and is correctly
   sized for the small dense systems this app produces.
6. **Integer `schemaVersion` + permissive import + explicit validation** for
   save/load — from JSON schema-versioning best practice.
7. Canvas + palette + property inspector + results table + diagnostics
   panel UI layout — from EPANET-family product conventions.
8. **CSV for "export results to Excel"** (`src/web/js/io/csvExport.js`)
   instead of a native binary `.xlsx` — CSV opens natively in Excel (and
   every other spreadsheet tool) with zero dependencies and zero
   format-correctness risk, which a from-scratch OOXML/ZIP writer would
   not have (this environment has no Excel to verify a hand-rolled binary
   format against). Includes both the "old" (current, pre-apply) and the
   pending goal-seek admittance side by side per element, when a goal-seek
   result exists but hasn't been applied yet.
9. **Network-wide pipe headloss model selector** (`darcyWeisbach` |
   `hazenWilliams`), matching EPANET's own network-wide `[OPTIONS] Headloss`
   setting rather than a per-pipe exponent — from the EPANET headloss-model
   comparison in §2.8. Implemented as a generalized `signedPow(x, n, delta)`
   admittance-flow primitive (`n=0.5` for Darcy-Weisbach, `n=1/1.852` for
   Hazen-Williams) so the Newton-Raphson solver core needed no changes —
   only `pipe.js` and the ctx passed into its `flow()` function.

## 4. Ideas rejected and why
| Idea | Why rejected |
|---|---|
| Reuse/port EPANET's C source or `.inp` format | GGA/EPANET solves *water distribution* (reservoirs/tanks/pumps) with a specific matrix formulation (loop null-space augmentation) tuned for large looped water networks; this app targets general thermo-hydraulic circuits with pumps, valves and heat exchangers at interactive/small scale — a from-scratch admittance/Newton formulation is simpler to extend (thermal + optimization) than adapting EPANET's C engine or file format. No EPANET code was copied; only the published *numerical strategy* (Newton-based simultaneous solve) informed the design, which is a standard, uncopyrightable numerical method. |
| `ml-matrix` / `math.js` / `numeric.js` for linear algebra | Unjustified dependency weight and, more importantly, incompatible with the "no bundler, plain ES modules in the browser" constraint without extra tooling. |
| A JS `.xlsx` library (e.g. SheetJS) or a hand-rolled OOXML/ZIP writer for "export to Excel" | Same dependency-weight/bundler concerns as the linear-algebra libraries above, plus (for a hand-rolled writer) real format-correctness risk with no way to test-open the result in actual Excel in this environment. CSV achieves the same practical outcome (opens in Excel) with neither problem. |
| LiteGraph.js / Rete.js / Drawflow / jsPlumb / Cytoscape.js for the editor | Domain mismatch (dataflow/analysis graphs vs. physical two-terminal network schematic); adds dependency and abstraction fighting for a small, well-defined interaction set. |
| Hardy Cross loop method | Converges slower and less reliably than Newton-Raphson, especially once admittances are pushed toward bounds by the goal-seek feature; harder to generalize to heterogeneous element types. |
| Full nonlinear-programming library (e.g., general SQP/interior-point) for goal seek | Overkill for a smooth, low-dimensional (few adjustable elements), bound-constrained least-squares problem; a compact in-house bounded Gauss-Newton/LM solver is easier to audit, test and keep dependency-free. |
| Analytic per-element Jacobian entries in the hydraulic Newton solve | Would require hand-deriving and maintaining a derivative for every element type, working against the requirement that new element types can be added "without rewriting the entire engine." A numerical (finite-difference) Jacobian keeps the solver generic: any element only needs to implement a `flow(headIn, headOut, params)` function. |

## 5. Chosen architecture
- **Solver core** (`src/solver/`): pure ES modules, framework- and
  DOM-independent, importable unmodified by both Node (tests, optional
  server-side use) and the browser (no build step).
  - `model.js` — network/node/element data structures and factories.
  - `elements/` — one module per element type (`pipe.js`, `valve.js`,
    `pump.js`, `heatExchanger.js`) each exporting a `flow()` function and a
    parameter schema, so new element types plug in without touching the
    solver.
  - `linalg.js` — dense Gaussian elimination with partial pivoting.
  - `validate.js` — structural/physical validation, connectivity check.
  - `hydraulics.js` — Newton-Raphson steady-state hydraulic solve.
  - `thermal.js` — linear energy-balance solve given converged flows.
  - `diagnostics.js` — normalizes solver output into warnings/errors with
    stable codes.
  - `optimize.js` — bounded multi-variable admittance goal seek.
  - `io.js` — versioned JSON export/import + validation.
  - `example.js`, `complexExample.js`, `net1BenchmarkExample.js`,
    `threeReservoirExample.js` — the four built-in example networks (see
    docs/user_manual.md §7-10 for what each demonstrates).
  - `index.js` — public API surface re-exporting the above.
- **Dev server** (`src/server/server.js`): a small dependency-free
  `node:http` static file server (needed only because browsers block
  `type="module"` imports from `file://`; no application logic lives here —
  the solver runs entirely client-side).
- **Frontend** (`src/web/`): plain HTML/CSS/ES modules.
  - `editor/` — SVG schematic canvas (rendering + pointer-event interaction).
  - `ui/` — property inspector, results tables, goal-seek panel, validation
    banner.
  - `io/` — file save/load glue over the solver's `io.js`.
  - `state.js` — single in-memory application state + a tiny pub/sub used to
    keep panels in sync without a framework.
- **Tests** (`test/`): Node's built-in `node:test` + `node:assert`, zero
  extra dependency.

## 6. Chosen numerical approach (summary)
- **Hydraulics:** steady-state Newton-Raphson on node heads (pressures),
  with the mass-balance residual at each non-boundary node built from each
  element's `Q = A · sign(Δh) · |Δh|^n`-family flow function (smoothed near
  zero via `signedPow` to keep the Jacobian finite; `n=0.5` for valves, heat
  exchangers and Darcy-Weisbach pipes, `n=1/1.852` for pipes when the
  network's `headlossModel` is `'hazenWilliams'` — see §2.8), fixed-pressure
  nodes clamped as boundary conditions, fixed-flow/injection nodes
  contributing a source term.
  Jacobian obtained by forward finite differences (generic across element
  types); solved via the in-house Gaussian-elimination `linalg.js`; damped
  step with a backtracking line search and a step-size cap for robustness;
  convergence measured by max residual and max head-update norm, with
  iteration count, residual history and status returned explicitly.
- **Thermal:** once flow directions/magnitudes are converged, per-node
  energy balance (flow-weighted mixing, `Σ ṁ·cp·T_in = (Σ ṁ·cp)·T_node`) is
  linear in temperatures and solved with the same linear solver; pipes apply
  exponential heat loss to ambient (`T_out = T_amb + (T_in − T_amb)·e^{−UA/(ṁcp)}`);
  heat exchangers apply a duty/effectiveness relation against a reference
  secondary-side temperature.
- **Admittance optimization:** bounded Gauss-Newton/LM-style iteration —
  each candidate admittance vector triggers a full hydraulic (+thermal)
  re-solve, forward-difference sensitivities of target flows w.r.t.
  adjustable admittances build a Jacobian, a damped Gauss-Newton step is
  taken and clipped to `[min, max]`, iterated until the target-flow residual
  norm is under tolerance or max iterations is reached; the best feasible
  iterate (lowest residual with a converged hydraulic solve) is retained
  even without full convergence.

## 7. Known limitations and assumptions
- Steady-state only (no transient/extended-period simulation).
- Single-phase, incompressible, constant-density fluid model; fluid
  properties (density, specific heat, viscosity) are per-network constants,
  not per-node composition tracking.
- Thermal model assumes fully-mixed nodes and does not solve axial
  temperature gradients within a pipe beyond the lumped exponential
  heat-loss relation.
- Pump curves are modeled as a single quadratic (`H = H0 − k·Q²`) or a
  fixed-head source; full multi-point vendor curve fitting is out of scope.
- The finite-difference Jacobian (both hydraulic Newton solve and
  admittance goal seek) trades some performance for generality/extensibility;
  acceptable at the interactive, tens-of-nodes network scale this tool
  targets, but not intended for large-scale (hundreds/thousands of nodes)
  networks.
- The SVG schematic editor is intentionally minimal (no auto-routing,
  undo/redo is a possible future extension, no multi-user collaboration).
- Under the Hazen-Williams headloss model, a pipe's minor losses
  (`localLossCoefficient`) are not included in its resistance — only the
  Darcy-Weisbach model does (see §2.8 for why). Hazen-Williams is also, by
  its own well-documented empirical basis, only valid for water near
  ordinary temperatures; NetworkSolver does not check or warn if the
  network's fluid is something else while `hazenWilliams` is selected.
- No authentication, persistence database, or multi-user features — save/load
  is local-file based only, per the spec.

## 8. Licensing considerations
- No third-party source code was copied into this repository. Ideas drawn
  from EPANET/GGA and valve Cv/Kv theory are standard, published numerical
  methods and engineering formulae (not copyrightable expression); no
  EPANET code (public-domain US-government software) was vendored or
  translated.
- The only runtime-external tooling dependency introduced is **ESLint**
  (devDependency, MIT-licensed, dev-time only, not shipped to the browser or
  required at runtime) for the "run lint" step requested in the process.
  No other npm packages are added; the solver, server and frontend runtime
  code have zero third-party dependencies, avoiding any further licensing
  review.
