import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { RunHumanizeResearchUsecase } from '../../../agent/humanize-research/application/run-humanize-research.usecase';
import { BLOG_PROMPT_FILE } from '../../../agent/humanize-research/domain/blog-editable-surface';
import {
  CollectedItem,
  GatedProposal,
  ProposalTarget,
} from '../../../agent/humanize-research/domain/humanize-research.type';
import {
  BLOG_REPO,
  CANON_REPO,
  HumanizeRulePrPayload,
} from '../../../agent/humanize-research/domain/humanize-rule-pr.type';
import { HUMANIZE_RULE_LINKS } from '../../../humanize/domain/humanize-rule-links';
import { PREVIEW_KIND } from '../../../preview-gate/domain/preview-action.type';
import { formatHumanizeResearch } from '../../../slack/format/humanize-research.formatter';
import {
  AutopilotPreviewRequest,
  AutopilotTask,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

@Injectable()
export class HumanizeResearchAutopilotTask implements AutopilotTask {
  readonly id = 'humanize-research';
  private readonly logger = new Logger(HumanizeResearchAutopilotTask.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly research: RunHumanizeResearchUsecase,
  ) {}

  async run(): Promise<AutopilotTaskResult> {
    const enabled =
      this.configService.get<string>('HUMANIZE_RESEARCH_ENABLED') === 'true';
    if (!enabled) {
      this.logger.log('skip — 게이트 OFF (HUMANIZE_RESEARCH_ENABLED !== true)');
      return { skip: true };
    }
    const result = await this.research.execute();
    const summaryText = formatHumanizeResearch(result.output);
    const prEnabled =
      this.configService.get<string>('HUMANIZE_RULE_PR_ENABLED') === 'true';
    if (!prEnabled) {
      return { skip: false, summaryText };
    }
    const previews = result.output.proposals.map((proposal) => {
      const preview = buildHumanizeRulePreview({
        proposal,
        included: result.included,
      });
      return preview;
    });
    return { skip: false, summaryText, previews };
  }
}

const buildHumanizeRulePreview = ({
  proposal,
  included,
}: {
  proposal: GatedProposal;
  included: CollectedItem[];
}): AutopilotPreviewRequest => {
  const canon = proposal.target === ProposalTarget.CANON;
  const evidenceExcerpts = proposal.evidence.flatMap((id) => {
    const item = included.find((entry) => entry.id === id);
    if (!item) {
      return [];
    }
    const excerpt = item.text.slice(0, 600);
    const labeledExcerpt = `[${id}] ${excerpt}`;
    return [labeledExcerpt];
  });
  const link = HUMANIZE_RULE_LINKS.find((entry) => {
    const contains = entry.local.text.includes(proposal.oldString);
    const matches = entry.local.file === BLOG_PROMPT_FILE && contains;
    return matches;
  });
  const ruleId = /\| ([A-Z]-\d+) \|/u.exec(proposal.oldString)?.[1];
  const linked = HUMANIZE_RULE_LINKS.filter((entry) => {
    const matches =
      entry.upstream?.kind === 'quick-rule' && entry.upstream.ruleId === ruleId;
    return matches;
  });
  const linkedTexts = linked.map((entry) => entry.local.text);
  const joinedTexts = linkedTexts.join('\n');
  const linkedBlogText = canon && joinedTexts.length > 0 ? joinedTexts : null;
  const payload: HumanizeRulePrPayload = {
    ...proposal,
    repo: canon ? CANON_REPO : BLOG_REPO,
    baseBranch: 'main',
    linkId: canon ? null : (link?.id ?? null),
    evidenceExcerpts,
    linkedBlogText,
  };
  const target = canon ? '정본' : '블로그';
  const replacement =
    proposal.newString.length > 0 ? proposal.newString : '(규칙 행 삭제)';
  const excerpts = evidenceExcerpts.join('\n');
  const warning = linkedBlogText ? `\n블로그 쪽 미반영: ${linkedBlogText}` : '';
  const previewText = [
    `대상: ${target}`,
    `파일: ${proposal.file}`,
    `지표: ${proposal.targetMetric}`,
    `근거: ${proposal.rationale}`,
    `전 문구:\n${proposal.oldString}`,
    `후 문구:\n${replacement}`,
    `근거 발췌:\n${excerpts}${warning}`,
    '✅ 적용 시 PR 이 열립니다(머지는 사람)',
  ].join('\n\n');
  return { kind: PREVIEW_KIND.HUMANIZE_RULE_PR, payload, previewText };
};
