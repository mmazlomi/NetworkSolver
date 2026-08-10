# User Manual — NetworkSolver

NetworkSolver is a browser-based tool for building a thermo-hydraulic
network (pipes, valves, pumps, heat exchangers), solving its steady-state
pressure/flow/temperature distribution, and adjusting pipe/valve
admittances to hit target branch flows.

## 1. Installing and starting the application

```bash
cd NetworkSolver
npm install       # installs ESLint only (the only dependency; see docs/research.md)
npm start         # starts the static dev server at http://localhost:4173
```

Open `http://localhost:4173` in a browser. There is no build step to run
the app in development — the browser loads the ES modules directly.

## 2. Screen layout

- **Toolbar** (top): New, an example selector + Load Example, Load File,
  Save File, Undo, Redo, Solve.
- **Banner** (below toolbar): appears when there are validation errors or
  warnings, or after a solve.
- **Palette** (left): tools — Select/Move, Add Node, Add Reservoir, Add
  Tank, Add Pipe, Add Valve, Add Pump, Add Heat Exchanger, Copy selected,
  Paste, and Delete selected.
- **Canvas** (center): the network schematic (SVG), with a floating
  zoom/pan control in the bottom-right corner (§3).
- **Side panel** (right), three tabs:
  - **Properties** — editable fields for whatever is currently selected,
    or the network-wide **Network Settings** panel (pipe headloss model —
    §3) when nothing is selected.
  - **Results** — solver status, diagnostics, result tables, and an
    **Export Results (CSV)** button.
  - **Goal Seek** — target-flow / adjustable-element configuration, run
    control, and optimization history.

## 3. Building a network graphically

1. Click **Add Node** (a plain junction), **Add Reservoir**, or **Add
   Tank** in the palette, then click on the canvas to place it. Repeat for
   every node you need. Click **Select / Move** (or press `Esc`) to leave
   node-placement mode. See §4 for the difference between the three node
   types.
2. Click **Add Pipe** (or Valve / Pump / Heat Exchanger), then click the
   source node, then the target node, to create that element between
   them. The tool switches back to Select automatically after the
   connection is made.
3. In **Select / Move** mode:
   - Click a node or element to select it (its properties appear in the
     **Properties** tab).
   - Drag a node to reposition it; connected elements follow.
   - When an element is selected, two small square handles appear at its
     source and target ends — drag either one onto a different node to
     reconnect that end (a dashed preview line follows the pointer;
     dropping on empty space or back on the other end cancels). You can
     also change an element's Source/Target node directly from dropdowns
     in the Properties panel's "Connections" section.
   - Press `Delete`/`Backspace` (or click **Delete selected**) to remove
     the current selection. Deleting a node also removes every element
     attached to it.
4. **Undo / Redo**: every edit (adding, moving, or deleting a node/element;
   editing any property; applying a goal-seek result; loading an example;
   starting a new network; importing a file) can be undone with the
   **Undo** button or `Ctrl+Z` (`Cmd+Z` on macOS), and redone with **Redo**
   or `Ctrl+Shift+Z`/`Ctrl+Y`. Dragging a node counts as a single undo
   step regardless of how far you move it, not one step per pixel.
   Undo/redo only cover edits to the network itself (topology, positions,
   parameters, boundary conditions, applied admittances) — solving and
   running a goal-seek are computations, not edits, so they don't add undo
   steps themselves; re-solving after an undo happens automatically.
5. **Copy / Paste**: select a node or element and click **Copy selected**
   (or `Ctrl+C`/`Cmd+C`), then **Paste** (or `Ctrl+V`/`Cmd+V`):
   - Pasting a **node** creates an independent copy (same boundary
     conditions, elevation, notes) at a small offset from the original, so
     you can immediately reposition it and connect elements to it.
   - Pasting an **element** creates a new element of the same type and
     parameters/admittance connected between the *same* two nodes as the
     original — an instant parallel duplicate (e.g. copy a pipe to add a
     second parallel pipe on the same branch). If you want it between
     different nodes instead, drag its endpoint handles afterward (see
     step 3) or edit its Source/Target node in the Properties panel. If
     you deleted the original's nodes since copying, paste is a no-op.
   - Pasting repeatedly steps the offset/duplicate further out each time,
     so copies don't stack exactly on top of each other or of each
     other's markers. Multiple elements sharing the same two endpoints are
     automatically fanned out on the canvas so each stays individually
     clickable.
6. Visual conventions on the canvas:
   - **Junctions** are circles. **Reservoirs** are a hatched rectangle
     (echoing the standard reservoir/ground symbol); **Tanks** are a
     plain, taller rectangle. Both are always filled like a fixed-pressure
     boundary node, since they always are one.
   - **Pipes** are blue lines, **valves** show an "✕" marker, **pumps** a
     circle with a triangle, **heat exchangers** a rectangle.
   - A **dashed halo** around a *junction* marks it as a (manually)
     fixed-pressure boundary node — reservoirs/tanks don't need this halo,
     since their shape already conveys it.
   - **Dashed lines** mean the element hasn't been solved yet (or the
     network changed since the last solve); solid lines mean it has.
   - Small triangular **flow arrows** appear at the midpoint of a solved
     element, pointing in the actual (possibly reversed) flow direction.
   - **Red** outlines mark elements/nodes with a validation error; **amber**
     marks a warning (e.g. a valve exceeding its configured maximum ΔP).
   - A newly added or pasted node isn't connected to anything yet; solving
     while it's still disconnected reports a solver diagnostic rather than
     silently ignoring it — connect it with an element (or delete it)
     before solving.
7. **Zoom and pan** (a floating control in the canvas's bottom-right corner):
   - **− / +** buttons, mouse/trackpad **scroll wheel**, or `Ctrl`+`+`/`Ctrl`+`-`
     (`Cmd` on macOS) zoom in/out, from 25% up to 400%, centered on the
     cursor (scroll wheel) or on the current view's center (buttons/keys).
   - **Fit** frames every node on the canvas with some padding — useful
     after loading a large network or zooming in far from where you are.
   - **100%** (or `Ctrl`+`0`/`Cmd`+`0`) resets to the canvas's original
     extent.
   - **Click-and-drag on empty canvas** pans the view. A plain click with
     no drag still deselects/shows Network Settings as before — only a
     drag beyond a few pixels pans instead.
   - Zoom/pan is a view-only setting: it isn't saved with the network file,
     isn't affected by Undo/Redo, and doesn't change node coordinates —
     only what part of the canvas you're currently looking at.

## 4. Setting boundary conditions

There are three node types, each placed with its own palette tool:

- **Junction** (plain node): select it and use the **Properties** tab —
  - **Fixed pressure**: check the box and enter a value (Pa). At least
    one node in every connected region of the network must have fixed
    pressure — this is the hydraulic reference point (like a reservoir).
    Solving without one produces a `NO_PRESSURE_REFERENCE` error.
  - **Fixed external flow**: check the box and enter a value (m³/s).
    Positive means fluid is injected into the network at this node;
    negative means fluid is extracted (a demand/consumption point). Leave
    unchecked for an ordinary internal junction (implicit external flow
    of 0).
  - A junction cannot have **both** fixed pressure and fixed flow at the
    same time (over-constrained) — this is rejected as a validation
    error.
- **Reservoir**: an infinite fixed-head source — pressure is *always*
  fixed at 0 (a free water surface), so there's no pressure/flow toggle to
  set. The only thing you enter is **Elevation / fixed head (m)**, which
  *is* its entire hydraulic significance (matching EPANET's own
  Reservoir, which is defined by a single "Head" value).
- **Tank**: a finite fixed-head source/sink for the current steady-state
  snapshot — also always fixed at 0 pressure. You enter **Base elevation
  (m)** plus **Diameter (m)**, **Min level (m)**, **Max level (m)**, and
  **Current level (m)**; the tank's effective hydraulic head is base
  elevation + current level. NetworkSolver does not simulate a tank
  filling or draining over time — "current level" is a fixed snapshot you
  set, not something that evolves as you solve. If the current level is
  outside `[min, max]`, you'll see a non-blocking
  `TANK_LEVEL_OUT_OF_RANGE` warning; diameter must be positive
  and `min ≤ max`, or validation rejects the network with
  `INVALID_TANK_PARAMS`.

All three node types support **Fixed temperature** (check the box, enter
°C). Any node that can act as a source of flow into the network (fixed
pressure, a positive fixed external flow, or a reservoir/tank) should have
one — otherwise the temperature entering the network there is
undetermined, and the Results tab will show a `MISSING_INFLOW_TEMPERATURE`
warning.

Element (pipe/valve/pump/heat exchanger) properties, also edited from the
**Properties** tab once an element is selected:

- **Admittance** (pipes, valves, heat exchangers): Initial, Current, Min,
  Max. `Current` is what the solver actually uses; `Initial` is a
  reference value you can revert to. Min/Max bound what the goal-seek
  optimizer (§6) is allowed to move `Current` to. For pipes and valves,
  editing a geometry/opening field below (length, diameter, roughness or
  Hazen-Williams C; opening %, Kv, characteristic) automatically
  recomputes `Current` to match — the solver never reads geometry
  directly, only `Current`, so this is what makes changing a pipe's
  diameter or a valve's opening actually change the solved flow. Editing
  `Current` directly overrides that (e.g. to match a goal-seek result, or
  to test a "what-if" admittance without touching geometry); it stays put
  until you next edit a geometry/opening field.
- **Parameters**: geometry (pipe length/diameter, plus either roughness or
  Hazen-Williams C — see below), valve opening/Kv/characteristic, pump
  curve or fixed head, heat exchanger UA/effectiveness/secondary
  temperature, etc. — the full parameter list for each type is in
  `docs/technical_specs.md` §2.
- **Enabled**: unchecking disables the element (its flow is forced to
  zero, as if closed/removed, without deleting it).

**Network Settings — pipe headloss model.** Click empty canvas space (or
anything that clears the selection) to show the **Network Settings** panel
in place of the Properties inspector. It has one control, **Pipe headloss
model**: **Darcy-Weisbach** (the default) or **Hazen-Williams**, matching
EPANET's own network-wide `Headloss` option — this is a single choice for
every pipe in the network, not a per-pipe setting. Switching it changes
which pipe parameter field the Properties tab shows (**Roughness** under
Darcy-Weisbach, **Hazen-Williams C** under Hazen-Williams) and immediately
recomputes every pipe's `Current` admittance from its geometry under the
newly selected model, so the next solve actually uses it. The two models
are genuinely different physics (a different flow-vs-pressure-drop
exponent, not just a unit conversion of the same curve — see
`docs/research.md` §2.8), so switching models will change solved flows
even with identical pipe geometry; Hazen-Williams also ignores each pipe's
local loss coefficient and (per its own textbook basis) is only intended
for water.

## 5. Running a hydraulic + thermal calculation

Click **Solve** in the toolbar. This:

1. Validates the network (structure, boundary conditions, parameters).
   If validation fails, the banner shows the errors and nothing is
   solved.
2. Runs the steady-state hydraulic solve (Newton-Raphson).
3. Runs the steady-state thermal solve using the converged flows.
4. Switches to the **Results** tab, showing:
   - Solver status (converged / not converged, iteration count, residual).
   - Any errors/warnings (e.g. a valve over its max ΔP, an indeterminate
     temperature).
   - A **Nodes** table: pressure, temperature, mass-balance residual.
   - An **Elements** table: flow, pressure drop (source − target
     convention), inlet/outlet temperature, heat duty.

If the solver does not converge within its iteration budget, the status
banner and Results tab report `maxIterationsReached` (or
`singularJacobian` for a structurally unsolvable system) rather than
showing plausible-looking but meaningless numbers.

Click **Export Results (CSV)** at the top of the Results tab to download
the current Nodes and Elements tables (plus the goal-seek target/achieved
comparison, if a goal-seek result is pending) as a CSV file, which opens
directly in Excel, Google Sheets, or any spreadsheet tool. The Elements
table in the export includes **Initial admittance**, **Current admittance
(old)**, and — only when a goal-seek result hasn't been applied yet — a
**Goal-seek admittance (proposed)** column, so you can review or archive
the before/after comparison outside the app.

## 6. Simultaneous admittance adjustment (Goal Seek)

Open the **Goal Seek** tab.

1. **Target flows**: click **+ Add target**, pick an element from the
   dropdown, and enter the desired flow (**kg/s**, signed — matching the
   source→target convention). Add as many targets as needed; they may be
   on different (even hydraulically coupled) branches. Goal Seek is
   presented entirely in mass flow (kg/s) rather than the volumetric flow
   (m³/s) used elsewhere in the app, since that's usually the more natural
   unit for thermal/process work; internally it's converted to/from m³/s
   using the network's fluid density (the same conversion already used for
   the Results tab's "Mass flow" column), so this is purely a
   display/input choice — the solver itself is unaffected.
2. **Adjustable elements**: click **+ Add adjustable element**, pick a
   pipe, valve, or heat exchanger — any element type with an admittance
   works, not just valves (pumps cannot be adjusted this way, since
   they're driven by their head curve rather than an admittance), and set
   Min/Max admittance bounds. You can adjust more elements than you have
   targets (underdetermined — fine) or fewer (overconstrained — a warning
   is shown, but the solver still tries).
3. Set **Tolerance** (residual norm on the target flows, kg/s) and **Max
   iterations**.
4. Click **Run goal seek**. The optimizer re-solves the full network for
   every candidate admittance set, so coupled parallel branches are
   handled correctly, not approximated.
5. Review the **Optimization result**:
   - **Status**: `converged`, `unreachableTarget` (bounds were pinned and
     the target still couldn't be hit), `maxIterationsReached`, `stalled`,
     or `invalidConfiguration`.
   - The **"Admittance: old vs. goal-seek result"** table lists, for each
     adjustable element, its current (pre-apply) admittance side by side
     with the goal-seek result and the percentage change — a quick summary
     of exactly what **Apply** would change, before you commit to it.
   - The **History** table lists every iteration's admittances, resulting
     flows, residual norm, and hydraulic solver status.
6. **Apply result** writes the best iterate's admittances into the
   network and immediately re-solves so the canvas/Results reflect it.
   **Revert** discards the optimization result without touching the
   network — your original admittances are safe until you explicitly
   apply.

## 7. Save, load, and the built-in examples

- **Save File** downloads the current network (topology, parameters,
  boundary conditions, canvas positions, goal-seek configuration) as a
  versioned JSON file via the browser's download mechanism.
- **Load File** opens a file picker; the selected file is validated
  (schema version, structure, node/element references) before being
  accepted. Invalid or incompatible files are rejected with a specific
  message and the current network is left untouched. Results are always
  recomputed after loading — cached values in the file are discarded, not
  trusted.
- **Load Example** loads whichever built-in example is selected in the
  dropdown next to it, and solves it immediately. There are four, listed
  in the dropdown in this order (the first entry is the default):
  - **Complex Network Example** *(default)* — a larger, ~40-element
    network (a main trunk, an auxiliary injection source, two distribution
    manifolds, a genuine hydraulic loop, a secondary sink, and a
    fixed-flow extraction point) meant to stress-test the solver and
    goal-seek on a realistically sized topology. See §8 below for the full
    breakdown. Its **Goal Seek** tab comes pre-configured with a
    four-target, five-adjustable-element scenario spanning both
    manifolds.
  - **Series/Parallel Loop** — the original, small demonstration network
    (one pump, one heat exchanger, a series main, two parallel
    pipe+valve branches). Its **Goal Seek** tab comes pre-configured with a
    two-target, two-adjustable-element scenario on the two parallel
    branches.
  - **EPANET Net1 Benchmark** — the classic "Net1" tutorial network
    distributed with EPANET (US EPA, public domain), a widely-cited
    benchmark in water-distribution modeling: a reservoir and pump feeding
    a two-loop, 9-junction network with an elevated tank. See §9 below for
    the full conversion write-up (unit conversions, and the modeling
    approximations needed since NetworkSolver is steady-state-only and
    Darcy-Weisbach-based, unlike EPANET's Hazen-Williams/EPS model). Its
    **Goal Seek** tab comes pre-configured with a three-target,
    three-adjustable-pipe scenario inside the network's loops.
  - **Three-Reservoir Problem (Handbook Benchmark)** — a classic textbook
    pipe-network problem (not tied to any particular software, unlike the
    EPANET benchmark above): three reservoirs at fixed elevations feeding a
    single junction with an external demand. See §10 below for the source
    citation, exact input data, and how closely NetworkSolver reproduces
    the published answer. Its **Goal Seek** tab comes pre-configured with a
    single-target, single-adjustable-pipe scenario.
  Adding another built-in example only requires a new builder module
  under `src/solver/` and one entry in the `EXAMPLES` registry in
  `src/web/js/state.js` (its position in that array controls both dropdown
  order and which one is the default) — no other UI code needs to change.
- **New** clears the canvas and starts an empty network (with a
  confirmation prompt, since it discards unsaved work).

## 8. The Complex Network Example in detail

Loadable via the example selector as **"Complex Network Example"**. It
exists to demonstrate the tool on a network too large to trace by eye, and
to give the solver and goal-seek optimizer a realistic stress test.

**Topology** — a main trunk (Main Supply Header → circulation pump → two
trunk pipes) splits at a junction into two independent paths that both
reach **Manifold 2**: one long path through **Manifold 1**'s four parallel
branches (pipe/valve/heat-exchanger combinations of varying length) and a
booster pump, the other a short direct loop-bridge valve — these two
paths, plus a third independent inflow from the **Auxiliary Supply
Header** (its own pump), all converge on Manifold 2, forming a genuinely
looped, hydraulically coupled region (not just parallel branches between
two nodes). Manifold 2 fans out into four more branches: three rejoin at a
second merge point, the fourth exits directly to the **Secondary Sink**
boundary. From the second merge point, flow splits again toward the
**Process Extraction Point** (a fixed-flow demand boundary) and the **Main
Return Header** (through a second booster pump and a return-side heat
exchanger).

**Element count**: 40 total — 22 pipes, 10 valves, 4 pumps, 4 heat
exchangers. **Node count**: 35 (5 boundary + 30 internal junctions).

**Boundary nodes** (5):
| Node | BC type | Role |
|---|---|---|
| Main Supply Header | fixed pressure (420 kPa) + fixed temperature (82 °C) | primary hot source |
| Main Return Header | fixed pressure (140 kPa) | primary sink / hydraulic reference |
| Auxiliary Supply Header | fixed pressure (320 kPa) + fixed temperature (58 °C) | secondary source feeding Manifold 2, the source of the loop coupling |
| Secondary Sink | fixed pressure (130 kPa) | alternate exit path (exercises redistribution between two possible returns) |
| Process Extraction Point | fixed flow (−0.006 m³/s) | metered demand/consumption point — the only fixed-*flow* boundary in either example |

**Predefined goal-seek scenario**: 4 targets, 5 adjustable elements
(M2 Branch1/2/3 valves, the Loop Bridge valve, and the M1 Branch3 valve).
The Loop Bridge valve in particular affects every Manifold-2-side target
at once (it controls how much of Manifold 2's total inflow arrives via the
short bridge vs. the long Manifold-1 path), so the scenario is genuinely
coupled rather than four independent single-valve adjustments. Click **Run
goal seek** to see the residual drop from its seed value to within
tolerance in a handful of iterations.

This example is a good starting point for exploring larger networks: load
it, inspect a manifold's branches by clicking through them, then try
changing one boundary condition (e.g. lowering the Auxiliary Supply
Header's pressure) and re-solving to see how the loop redistributes flow.

## 9. The EPANET Net1 Benchmark in detail

Loadable via the example selector as **"EPANET Net1 Benchmark"**. Unlike
the other two examples (built specifically to demonstrate NetworkSolver),
this one is a real, external, independently-published network: the
"Net1" tutorial network distributed with
[EPANET](https://github.com/OpenWaterAnalytics/EPANET) (US EPA, public
domain), one of the most widely cited benchmarks in water-distribution
modeling literature and software tutorials. It exists to give the tool a
credible, third-party reference case rather than only self-authored ones.

**Topology**: a Reservoir feeds a Pump, which discharges into a
9-junction, two-loop pipe network (junctions 10/11/12/13 in one loop,
21/22/23 in a second row, 31/32 below that, cross-connected into two
loops), with an elevated Tank tying into junction 12 through a short pipe.
12 pipes total, matching the source `Net1.inp` file's pipe list exactly
(same IDs: Pipe 10, 11, 12, 21, 22, 31, 110, 111, 112, 113, 121, 122).

**Element count**: 13 total — 12 pipes, 1 pump. **Node count**: 11 (2
boundary + 9 internal junctions). No valves or heat exchangers — this is a
faithful property of the real source network, not a gap.

**Boundary nodes** (2, using NetworkSolver's dedicated **Reservoir** and
**Tank** node types — §4 — matching EPANET's own Reservoir/Tank vs.
ordinary-junction distinction exactly, rather than generic fixed-pressure
junctions):
| Node | Source data | Role |
|---|---|---|
| Reservoir 9 | Head = 800 ft | primary source |
| Tank 2 | Elevation 850 ft, level 120 ft (range 100-150 ft), diameter 50.5 ft — all preserved directly as this node's fields | secondary source/sink depending on solved flow direction |

The 9 junctions each carry the source file's original elevation, and 8 of
them (all but Junction 10) carry the original fixed demand (converted from
GPM) as a NetworkSolver fixed-flow (extraction) boundary condition.

**Unit conversions and modeling approximations** (also recorded in each
element's `notes` field in the app): EPANET Net1 uses US customary units
(feet, inches, GPM) — converted to SI throughout. This example sets the
network's **headloss model** (§3, Network Settings) to **Hazen-Williams**
with `C=100` on every pipe, exactly matching the source file's own
Hazen-Williams roughness coefficient — no roughness-model conversion or
approximation is needed for the pipes. The pump's single-point curve (1500 GPM @ 250 ft) is extrapolated
to a 1.33×-design-head shutoff point, EPANET's own documented convention
for single-point curves. NetworkSolver is steady-state only (no
fill/drain simulation), so the Tank's "Current level" is EPANET's
InitLevel — a single-instant snapshot of what EPANET would otherwise
treat as a time-varying element; everything else about the tank
(elevation, min/max level, diameter) is preserved directly, unlike an
earlier version of this conversion which collapsed elevation+level into a
single manually-computed number and discarded min/max/diameter entirely.
EPANET's base network doesn't model temperature (only a generic quality
tracer), so a uniform reference temperature (20 °C) is assumed at both
boundary sources.

**Predefined goal-seek scenario**: 3 targets and 3 adjustable pipes
(Pipe 12, Pipe 112, Pipe 121) inside the network's loops — converges in a
few iterations, demonstrating the same coupled-loop redistribution
behavior as the Complex Network Example, but on a real, external benchmark
rather than a self-authored one.

## 10. The Three-Reservoir Problem benchmark in detail

Loadable via the example selector as **"Three-Reservoir Problem (Handbook
Benchmark)"**. Where the EPANET Net1 benchmark (§9) is a real *software*
benchmark, this one is a real *textbook* benchmark: a classic worked
example from a standard hydraulics/fluid-mechanics handbook, independent
of any particular network-modeling software — exactly the kind of
reference case fluid-mechanics courses use to teach junction-node pipe
analysis.

**Source**: Larock, B.E., Jeppson, R.W. and Watters, G.Z., *Hydraulics of
Pipeline Systems* (2000, CRC Press), Example 2.7, p.26 — cross-checked
against an independent citation of the same example (a commercial
pipe-network solver's published results-verification page) before being
encoded here.

**Topology**: three reservoirs at different fixed elevations — A
(highest, 100 m), B (middle, 85 m), C (lowest, 60 m) — each connected by
one pipe to a single common Junction J, which also has a fixed external
demand of 0.06 m³/s withdrawn from the network. 4 nodes, 3 pipes, no
valves/pumps/heat exchangers — this is a faithful property of the source
problem (it's deliberately the *simplest* junction-network case), not a
missing feature.

| Pipe | Length | Diameter | Roughness |
|---|---|---|---|
| 1 (A→J) | 2000 m | 300 mm | 0.5 mm |
| 2 (B→J) | 1500 m | 250 mm | 0.5 mm |
| 3 (J→C) | 3000 m | 250 mm | 0.5 mm |

**Published reference solution**: Q1 (A into J) = 0.1023 m³/s, Q2 (B into
J) = 0.02 m³/s, Q3 (J into C) = 0.0622 m³/s. NetworkSolver reproduces
these to within about 2% (`test/example.test.js`), not to 4 significant
figures: the reference iterates the Colebrook-White friction factor at
each pipe's actual converged velocity, while NetworkSolver evaluates each
pipe's Darcy-Weisbach admittance once, from a friction factor at a single
representative reference velocity (the same documented simplification
described for every pipe in `docs/research.md` §2.3/§2.8 — this isn't a
benchmark-specific issue). The junction's mass balance itself closes
exactly regardless of this, since that's a structural property of the
Newton-Raphson solver, not of the friction model.

**Predefined goal-seek scenario**: 1 target (Pipe 3's flow into Reservoir
C, retargeted from its natural ~0.062 to 0.05 m³/s) and 1 adjustable
element (Pipe 3 itself) — the simplest possible goal-seek case, useful as
a first example of the feature before trying the multi-target scenarios
in the other three examples.

## 11. Reading validation and error messages

Every message in the banner and Results tab carries a stable `code` (e.g.
`NO_PRESSURE_REFERENCE`, `DISCONNECTED_REGION`, `OVER_CONSTRAINED_NODE`,
`INVALID_ADMITTANCE_BOUNDS`, `ELEMENT_CONSTRAINT_VIOLATED`,
`TEMPERATURE_INDETERMINATE`) so the same condition always reads the same
way. Errors block solving; warnings do not, but flag a value that is
present but not fully trustworthy (e.g. an indeterminate temperature) — see
`docs/technical_specs.md` §6 for the full code list.
