import { Inject, Injectable, Logger } from '@nestjs/common';
import { isMatching } from 'ts-pattern';

import { DomainStatus } from '../../../common/exception/domain-status.enum';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../../github/domain/port/github-client.port';
import { ApplyResult } from '../../../preview-gate/domain/apply-result.type';
import { PreviewApplier } from '../../../preview-gate/domain/port/preview-applier.port';
import { PreviewActionException } from '../../../preview-gate/domain/preview-action.exception';
import {
  PREVIEW_KIND,
  PreviewAction,
  PreviewKind,
} from '../../../preview-gate/domain/preview-action.type';
import { PreviewActionErrorCode } from '../../../preview-gate/domain/preview-action-error-code.enum';
import {
  BLOG_PROMPT_FILE,
  isSafeBlogLiteral,
} from '../domain/blog-editable-surface';
import {
  HumanizeResearchProposal,
  ProposalTarget,
} from '../domain/humanize-research.type';
import {
  BLOG_REPO,
  CANON_REPO,
  HUMANIZE_RULE_PR_PAYLOAD_PATTERN,
  HumanizeRulePrPayload,
  RULE_LINKS_FILE,
} from '../domain/humanize-rule-pr.type';
import { CANON_RULES_FILE, countMatches } from '../domain/proposal-gate';
import { CanonCheckRunner } from './canon-check.runner';

const PR_BODY_CAP = 4_000;
const COMMIT_SUBJECT_CAP = 50;

@Injectable()
export class HumanizeRulePrApplier implements PreviewApplier {
  readonly kind: PreviewKind = PREVIEW_KIND.HUMANIZE_RULE_PR;
  private readonly logger = new Logger(HumanizeRulePrApplier.name);

  constructor(
    @Inject(GITHUB_CLIENT_PORT) private readonly githubClient: GithubClientPort,
    private readonly canonCheckRunner: CanonCheckRunner,
  ) {}

  async apply(preview: PreviewAction): Promise<ApplyResult> {
    const payload = preview.payload;
    const validPayload = isMatching(HUMANIZE_RULE_PR_PAYLOAD_PATTERN, payload);
    if (!validPayload) {
      throw new PreviewActionException({
        code: PreviewActionErrorCode.NO_APPLIER_FOR_KIND,
        message: 'HUMANIZE_RULE_PR payload 형식이 맞지 않습니다.',
        status: DomainStatus.INTERNAL,
      });
    }
    const canon = payload.target === ProposalTarget.CANON;
    const repo = canon ? CANON_REPO : BLOG_REPO;
    if (payload.repo !== repo || payload.baseBranch !== 'main') {
      throw new Error('제안 대상 저장소 또는 기준 브랜치가 맞지 않습니다.');
    }
    const allowedFile = canon ? CANON_RULES_FILE : BLOG_PROMPT_FILE;
    if (payload.file !== allowedFile) {
      throw new Error('제안 대상 파일이 맞지 않습니다.');
    }
    if (!canon) {
      const safeOldString = isSafeBlogLiteral(payload.oldString);
      const safeNewString = isSafeBlogLiteral(payload.newString);
      if (!safeOldString || !safeNewString) {
        throw new Error('UNSAFE_BLOG_LITERAL');
      }
    }
    const checkedContent = canon
      ? await this.readCheckedCanonContent({ payload, repo })
      : null;
    const paths = canon ? [payload.file] : [BLOG_PROMPT_FILE, RULE_LINKS_FILE];
    const files: { path: string; content: string }[] = [];
    for (const path of paths) {
      const file = await this.githubClient.getFileFromBranch({
        repo,
        branch: 'main',
        path,
      });
      if (file.content === undefined) {
        throw new Error(`${path} 본문을 받지 못했습니다.`);
      }
      if (canon && file.content !== checkedContent) {
        throw new Error(
          `STALE_PROPOSAL: ${path} 가 검사 이후 main 에서 바뀌었습니다`,
        );
      }
      const count = countMatches({
        text: file.content,
        search: payload.oldString,
      });
      if (count !== 1) {
        throw new Error(
          `STALE_PROPOSAL: ${path} 에서 기존 문구가 ${count}회 나옵니다`,
        );
      }
      const content = file.content.replace(
        payload.oldString,
        () => payload.newString,
      );
      files.push({ path, content });
    }
    const branchName = `humanize-rule/${preview.id}`;
    const subjectPrefix = canon ? 'docs(quick-rules): ' : 'feat(humanize): ';
    const subject = `${subjectPrefix}${payload.targetMetric}`.slice(
      0,
      COMMIT_SUBJECT_CAP,
    );
    const commitMessage = `${subject}\n\n${payload.rationale}`;
    const prTitle = `윤문 규칙 제안: ${payload.targetMetric}`.slice(0, 80);
    const prBody = buildPrBody(payload);
    try {
      const result = await this.githubClient.pushBranchAndOpenPr({
        repo,
        baseBranch: 'main',
        branchName,
        commitMessage,
        files,
        prTitle,
        prBody,
        assignees: ['JSL107'],
      });
      const message = `윤문 규칙 PR 생성됨: <${result.prUrl}|#${result.prNumber}>. 머지 전 사람 검토 필수.`;
      return {
        message,
        artifacts: [{ type: 'github_pr', repo, prNumber: result.prNumber }],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`윤문 규칙 PR open 실패: ${message}`);
      const previewMessage = message.slice(0, 300);
      throw new PreviewActionException({
        code: PreviewActionErrorCode.NO_APPLIER_FOR_KIND,
        message: `윤문 규칙 PR open 실패: ${previewMessage}`,
        status: DomainStatus.BAD_GATEWAY,
      });
    }
  }

  private async readCheckedCanonContent({
    payload,
    repo,
  }: {
    payload: HumanizeRulePrPayload;
    repo: string;
  }): Promise<string> {
    const proposal: HumanizeResearchProposal = {
      target: payload.target,
      file: payload.file,
      oldString: payload.oldString,
      newString: payload.newString,
      rationale: payload.rationale,
      targetMetric: payload.targetMetric,
      evidence: payload.evidence,
    };
    const check = await this.canonCheckRunner.check(proposal);
    if (check.reason !== null) {
      throw new Error(`정본 검사 실패: ${check.reason}`);
    }
    const checkedFile = await this.githubClient.getFileFromBranch({
      repo,
      branch: check.baseSha,
      path: payload.file,
    });
    if (checkedFile.content === undefined) {
      throw new Error(`${payload.file} 본문을 받지 못했습니다.`);
    }
    return checkedFile.content;
  }
}

const buildPrBody = (payload: HumanizeRulePrPayload): string => {
  const target = payload.target === ProposalTarget.CANON ? '정본' : '블로그';
  const evidence = payload.evidence.map((id) => {
    const line = `- ${id}`;
    return line;
  });
  const lines = [
    `대상: ${target} (${payload.file})`,
    ...(payload.baseSha ? [`기준 SHA: ${payload.baseSha}`] : []),
    `목표 지표: ${payload.targetMetric}`,
    `근거: ${payload.rationale}`,
    ...evidence,
  ];
  if (payload.target === ProposalTarget.CANON) {
    const excerpts = payload.evidenceExcerpts.map((excerpt) => {
      const line = `- ${excerpt}`;
      return line;
    });
    lines.push(...excerpts);
  } else {
    lines.push('증거 발췌는 공개 저장소이므로 생략했습니다.');
  }
  if (
    payload.target === ProposalTarget.CANON &&
    payload.linkedBlogText !== null
  ) {
    lines.push(`블로그 쪽 미반영: ${payload.linkedBlogText}`);
  }
  const footer = '\n\n머지 전 사람 검토 필수';
  const content = lines.join('\n\n');
  const trimmed = content.slice(0, PR_BODY_CAP - footer.length);
  const body = `${trimmed}${footer}`;
  return body;
};
