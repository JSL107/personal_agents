import { PlainDate } from '../../../schedule/domain/schedule.type';

export const IDEA_TRIAGE_REPOSITORY_PORT = Symbol(
  'IDEA_TRIAGE_REPOSITORY_PORT',
);

export interface CreateIdeaTriageInput {
  channelId: string;
  messageTs: string;
  authorSlackUserId: string | null;
  ideaText: string;
  verdict: string;
  reason: string;
  counterpoint: string;
  scheduleTitle: string;
  effort: string;
  proposedDate: PlainDate;
  agentRunId: number | null;
}

export interface IdeaTriageRecord extends CreateIdeaTriageInput {
  id: number;
  status: string;
  replyTs: string | null;
  previewId: string | null;
  scheduleItemId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IdeaTriageRepositoryPort {
  findExisting(channelId: string, messageTsList: string[]): Promise<string[]>;
  // 동시 실행으로 unique 충돌이 나면 null. 다른 DB 실패는 그대로 전달한다.
  create(input: CreateIdeaTriageInput): Promise<IdeaTriageRecord | null>;
  markReplySent(id: number, replyTs: string): Promise<void>;
  markPreviewCreated(id: number, previewId: string): Promise<void>;
  markPosted(id: number, replyTs: string, previewId?: string): Promise<void>;
  findUnposted(channelId: string): Promise<IdeaTriageRecord[]>;
  markScheduled(id: number, scheduleItemId: number): Promise<void>;
  findById(id: number): Promise<IdeaTriageRecord | null>;
}
