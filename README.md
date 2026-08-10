# NetworkSolver

Browser-based interactive tool for building and solving thermo-hydraulic
networks — pipes, valves, pumps, heat exchangers, reservoirs, and tanks.
Draw a network on an SVG canvas, solve its steady-state pressure/flow/
temperature distribution, and use goal-seek to adjust pipe/valve admittances
until target branch flows are met.

The solver runs entirely client-side; the Node server just serves static
files (browsers block `type="module"` imports from `file://` URLs).

## Getting started

```bash
npm install       # installs ESLint only — the sole dependency
npm start         # serves the app at http://localhost:4173
```

Open `http://localhost:4173` in a browser. There is no build step for
development — the browser loads the ES modules directly.

## Scripts

| Command         | Description                                      |
| --------------- | ------------------------------------------------- |
| `npm start`     | Start the static dev server (`PORT`, default 4173) |
| `npm test`      | Run the test suite (`node --test`)                 |
| `npm run lint`  | Lint with ESLint                                   |
| `npm run build` | Produce a self-contained `dist/` for static hosting |

## Project layout

- `src/solver/` — the solver core (hydraulics, thermal, linear algebra,
  optimization, validation, I/O). Pure Node/ESM, no browser dependency.
- `src/web/` — the browser UI (canvas editor, inspector, results panel,
  goal-seek panel).
- `src/server/server.js` — dependency-free static file server for local
  development.
- `test/` — unit tests for the solver core.
- `docs/` — design rationale (`research.md`), the mathematical/numerical
  specification (`technical_specs.md`), the user manual
  (`user_manual.md`), and the test report (`test_report.md`).

## Documentation

See [`docs/user_manual.md`](docs/user_manual.md) for how to use the app,
and [`docs/technical_specs.md`](docs/technical_specs.md) for the underlying
model and algorithms.

## License

MIT
