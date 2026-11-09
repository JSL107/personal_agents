export const REEL_FORMAT_PLANNER_PORT = Symbol('REEL_FORMAT_PLANNER_PORT');

export interface PlannerProposalInput {
  statsSummary: string;
  candidateIds: readonly string[];
  reverseChallenge: boolean;
}

export interface PlannerProposal {
  candidateId?: string;
  hypothesis: string;
  interpretation: string;
  raw: string;
}

export interface ReelFormatPlannerPort {
  propose(input: PlannerProposalInput): Promise<PlannerProposal>;
}
