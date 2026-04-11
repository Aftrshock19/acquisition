// Adaptive engine lives in adaptive.ts. The legacy band-based estimator
// has been retired in favor of checkpoint-based routing + estimation.
// This file remains as a thin re-export to keep external imports working.

export { estimatePlacement } from "./adaptive";
