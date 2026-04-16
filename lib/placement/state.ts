import type {
  AdaptivePlacementEstimate,
  PlacementItem,
  PlacementPlan,
  PlacementRunStatus,
} from "./types";

export type PlacementState = {
  runId: string | null;
  status: PlacementRunStatus | "none";
  language: string;
  sequenceIndex: number;
  currentItem: PlacementItem | null;
  currentPlan: PlacementPlan | null;
  estimate: AdaptivePlacementEstimate | null;
  hasCompletedRun: boolean;
  completedEstimate: AdaptivePlacementEstimate | null;
  bankEmpty: boolean;
};

export type SubmitPlacementAnswerInput = {
  runId: string;
  itemBankId: string;
  chosenOptionIndex?: number | null;
  chosenText?: string | null;
  usedIdk?: boolean;
  latencyMs?: number | null;
};
