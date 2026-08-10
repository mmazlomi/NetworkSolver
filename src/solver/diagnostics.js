// Normalizes validation + hydraulic + thermal outputs into one diagnostics
// object with a stable shape, so the UI only needs to render one structure.

export function buildDiagnostics({ validation, hydraulic, thermal }) {
  const errors = [
    ...(validation ? validation.errors : []),
    ...(hydraulic ? hydraulic.errors : []),
    ...(thermal ? thermal.errors : []),
  ];
  const warnings = [
    ...(validation ? validation.warnings : []),
    ...(hydraulic ? hydraulic.warnings : []),
    ...(thermal ? thermal.warnings : []),
  ];

  let status = 'ok';
  if (errors.length > 0) status = 'error';
  else if (hydraulic && !hydraulic.converged) status = 'notConverged';
  else if (warnings.length > 0) status = 'warning';

  return {
    status, // 'ok' | 'warning' | 'notConverged' | 'error'
    errors,
    warnings,
    hydraulic: hydraulic
      ? {
        converged: hydraulic.converged,
        status: hydraulic.status,
        iterations: hydraulic.iterations,
        residualNorm: hydraulic.residualNorm,
        history: hydraulic.history,
      }
      : null,
  };
}
