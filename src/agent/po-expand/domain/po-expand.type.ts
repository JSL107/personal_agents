export interface GeneratePoOutlineInput {
  subject: string;
  slackUserId: string;
}

export interface PoOutline {
  subject: string;
  outline: string[];
  clarifyingQuestions: string[];
}
