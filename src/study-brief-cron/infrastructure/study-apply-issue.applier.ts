import { Inject, Injectable, Logger } from '@nestjs/common';

import { DomainStatus } from '../../common/exception/domain-status.enum';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../github/domain/port/github-client.port';
import { ApplyResult } from '../../preview-gate/domain/apply-result.type';
import { PreviewApplier } from '../../preview-gate/domain/port/preview-applier.port';
import { PreviewActionException } from '../../preview-gate/domain/preview-action.exception';
import {
  PREVIEW_KIND,
  PreviewAction,
  PreviewKind,
} from '../../preview-gate/domain/preview-action.type';
import { PreviewActionErrorCode } from '../../preview-gate/domain/preview-action-error-code.enum';
import { escapeSlackMrkdwn } from '../../slack/format/mrkdwn.util';
import { isStudyApplyIssuePayload } from '../domain/study-apply-issue.payload';

const ISSUE_ASSIGNEE = 'JSL107';

@Injectable()
export class StudyApplyIssueApplier implements PreviewApplier {
  readonly kind: PreviewKind = PREVIEW_KIND.STUDY_APPLY_ISSUE;
  private readonly logger = new Logger(StudyApplyIssueApplier.name);

  constructor(
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
  ) {}

  async apply(preview: PreviewAction): Promise<ApplyResult> {
    if (!isStudyApplyIssuePayload(preview.payload)) {
      throw new PreviewActionException({
        code: PreviewActionErrorCode.NO_APPLIER_FOR_KIND,
        message: 'STUDY_APPLY_ISSUE payload 형식이 맞지 않습니다.',
        status: DomainStatus.INTERNAL,
      });
    }
    const { repo, title, body, studyBriefId } = preview.payload;
    try {
      const issue = await this.githubClient.createIssue({
        repo,
        title,
        body,
        assignees: [ISSUE_ASSIGNEE],
      });
      this.logger.log(
        `오늘의 공부 적용 issue 생성 — ${repo} #${issue.number} (brief ${studyBriefId})`,
      );
      return {
        message: [
          '🧭 *오늘의 공부 적용 제안 — issue 생성됨*',
          `• <${issue.url}|#${issue.number}> ${escapeSlackMrkdwn(title)}`,
          '_구현은 issue 를 보고 직접 시작하세요._',
        ].join('\n'),
        artifacts: [],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `오늘의 공부 적용 issue 생성 실패 — ${repo}: ${message}`,
      );
      throw new PreviewActionException({
        code: PreviewActionErrorCode.NO_APPLIER_FOR_KIND,
        message: `issue 생성 실패: ${message.slice(0, 300)}`,
        status: DomainStatus.BAD_GATEWAY,
      });
    }
  }
}
