import { PlainDate } from './schedule.type';

export interface MentionRequestJudgment {
  isRequest: boolean;
  title: string;
  dueDate: PlainDate | null;
}
