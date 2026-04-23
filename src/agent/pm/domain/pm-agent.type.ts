export interface DailyPlan {
  topPriority: string;
  morning: string[];
  afternoon: string[];
  blocker: string | null;
  estimatedHours: number;
  reasoning: string;
}

export interface GenerateDailyPlanInput {
  tasksText: string;
  slackUserId: string;
}
