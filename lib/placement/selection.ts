// The adaptive engine lives in adaptive.ts. This file is a thin re-export
// for back-compat with existing imports of `planNextItem` / `totalPlanned`
// and to keep the call sites stable.

export {
  planNextItem,
  estimatePlacement,
  totalPlanned,
  determineStage,
  type PlanContext,
} from "./adaptive";
