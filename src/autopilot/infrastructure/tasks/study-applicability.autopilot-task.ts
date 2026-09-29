import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PREVIEW_KIND } from '../../../preview-gate/domain/preview-action.type';
import { escapeSlackMrkdwn } from '../../../slack/format/mrkdwn.util';
import { JudgeStudyApplicabilityUsecase } from '../../../study-brief-cron/application/judge-study-applicability.usecase';
import { APPLICABILITY_VERDICT } from '../../../study-brief-cron/domain/study-applicability.type';
import {
  buildStudyApplyIssue,
  buildStudyApplyPreviewText,
} from '../../../study-brief-cron/domain/study-apply-issue.format';
import {
  GITHUB_REPO_PATTERN,
  StudyApplyIssuePayload,
} from '../../../study-brief-cron/domain/study-apply-issue.payload';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

export const STUDY_APPLY_PREVIEW_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class StudyApplicabilityAutopilotTask implements AutopilotTask {
  readonly id = 'study-applicability';

  constructor(
    private readonly judgeStudyApplicability: JudgeStudyApplicabilityUsecase,
    private readonly config: ConfigService,
  ) {}

  async run({
    ownerSlackUserId,
    firedAtKst,
  }: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    const result = await this.judgeStudyApplicability.execute({
      ownerSlackUserId,
      firedAtKst,
    });
    if (result.status === 'empty') {
      return { skip: true };
    }
    if (
      result.judgement.verdict !== APPLICABILITY_VERDICT.APPLY ||
      !result.saved
    ) {
      return { skip: true };
    }
    const summaryText = `🧭 *오늘의 공부 적용 판정* — ${escapeSlackMrkdwn(result.topic)} · 적용 제안 1건`;
    const repo = this.config.get<string>('STUDY_APPLY_ISSUE_REPO')?.trim();
    if (!repo) {
      return {
        skip: false,
        summaryText: `${summaryText} (STUDY_APPLY_ISSUE_REPO 미설정 — 카드 생략)`,
      };
    }
    if (!GITHUB_REPO_PATTERN.test(repo)) {
      return {
        skip: false,
        summaryText: `${summaryText} (STUDY_APPLY_ISSUE_REPO 가 owner/repo 형식이 아님 — 카드 생략)`,
      };
    }
    const issue = buildStudyApplyIssue({
      topic: result.topic,
      notionUrl: result.notionUrl,
      judgement: result.judgement,
    });
    const payload: StudyApplyIssuePayload = {
      studyBriefId: result.briefId,
      repo,
      title: issue.title,
      body: issue.body,
    };
    return {
      skip: false,
      summaryText,
      preview: {
        kind: PREVIEW_KIND.STUDY_APPLY_ISSUE,
        payload,
        previewText: buildStudyApplyPreviewText({
          topic: result.topic,
          judgement: result.judgement,
          repo,
        }),
        ttlMs: STUDY_APPLY_PREVIEW_TTL_MS,
      },
    };
  }
}
