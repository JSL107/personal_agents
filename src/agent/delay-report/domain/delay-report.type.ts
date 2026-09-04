import {
  ActiveRunSnapshot,
  FailedRunDetail,
  RecentlyFinishedRun,
} from '../../../agent-run/domain/port/agent-run.repository.port';
import { PreviewAction } from '../../../preview-gate/domain/preview-action.type';

export interface DelayReportIntegrations {
  githubConfigured: boolean;
  notionConfigured: boolean;
}

export interface DelayReportInput {
  openPreviews: PreviewAction[];
  activeRuns: ActiveRunSnapshot[];
  failedRuns: FailedRunDetail[];
  recentlyFinished: RecentlyFinishedRun[];
  integrations: DelayReportIntegrations;
  now: Date;
  unavailableAxes: string[];
}

export type DelayCause =
  | 'APPROVAL_WAIT'
  | 'RUN_IN_PROGRESS'
  | 'UNRESOLVED_FAILURE'
  | 'NONE';

export interface DelayVerdict {
  primaryCause: DelayCause;
  detail: string;
  secondaryNotes: string[];
  unavailableAxes: string[];
}
