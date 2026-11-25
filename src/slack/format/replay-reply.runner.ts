import { Injectable } from '@nestjs/common';

import { HumanizeService } from '../../humanize/application/humanize.service';
import { humanizeEvaluationOutput } from '../../humanize/application/humanize-report.adapter';
import { PreparedReplay } from '../../run-replay/application/replay-failed-run.usecase';
import { formatCeoMetaOutput } from './ceo-meta.formatter';
import { formatDailyPlan } from './daily-plan.formatter';
import { formatDailyReview } from './daily-review.formatter';
import { FormattedReport } from './formatted-report.type';
import { formatImpactReport } from './impact-report.formatter';
import { formatEvaluationOutput } from './po-evaluation.formatter';
import { formatPoShadowReport } from './po-shadow.formatter';
import { formatPullRequestReviewResponse } from './pull-request-review-response';
import { formatVideoWatch } from './video-watch.formatter';

export interface ReplayReply {
  agentRunId: number;
  text: string;
  preview?: { id: string; text: string };
  followupText?: string;
}

@Injectable()
export class ReplayReplyRunner {
  constructor(private readonly humanizeService: HumanizeService) {}

  async run(prepared: PreparedReplay): Promise<ReplayReply> {
    switch (prepared.agentType) {
      case 'PM': {
        const outcome = await prepared.run();
        const report = formatDailyPlan(
          outcome.result.plan,
          outcome.result.inputTruncation,
        );
        return toReplayReply({
          agentRunId: outcome.agentRunId,
          formatted: report,
        });
      }
      case 'WORK_REVIEWER': {
        const outcome = await prepared.run();
        return toReplayReply({
          agentRunId: outcome.agentRunId,
          formatted: formatDailyReview(outcome.result),
        });
      }
      case 'CODE_REVIEWER': {
        const outcome = await prepared.run();
        const report = formatPullRequestReviewResponse({
          prRef: prepared.prRef,
          prTitle: outcome.prTitle,
          review: outcome.result,
        });
        return toReplayReply({
          agentRunId: outcome.agentRunId,
          formatted: report,
        });
      }
      case 'IMPACT_REPORTER': {
        const outcome = await prepared.run();
        return toReplayReply({
          agentRunId: outcome.agentRunId,
          formatted: formatImpactReport(outcome.result),
        });
      }
      case 'PO_SHADOW': {
        const outcome = await prepared.run();
        return toReplayReply({
          agentRunId: outcome.agentRunId,
          formatted: formatPoShadowReport(outcome.result),
        });
      }
      case 'PO_EVAL': {
        const outcome = await prepared.run();
        const humanized = await humanizeEvaluationOutput(
          outcome.result,
          this.humanizeService,
        );
        return toReplayReply({
          agentRunId: outcome.agentRunId,
          formatted: formatEvaluationOutput(humanized),
        });
      }
      case 'CEO': {
        const outcome = await prepared.run();
        return toReplayReply({
          agentRunId: outcome.agentRunId,
          formatted: formatCeoMetaOutput(outcome.result),
        });
      }
      case 'VIDEO_WATCH': {
        const outcome = await prepared.run();
        const report = outcome.report ?? {
          title: null,
          uploader: null,
          platform: prepared.platform,
          videoId: prepared.videoId,
          frameCount: 0,
          transcriptSource: null,
        };
        return toReplayReply({
          agentRunId: outcome.agentRunId,
          formatted: formatVideoWatch(outcome.result, report),
        });
      }
      case 'PAPER_RECOMMEND': {
        const result = await prepared.run();
        const completed = result.completed[0];
        if (completed) {
          return {
            agentRunId: completed.agentRunId,
            text: `${completed.strategy} 추천 재실행 완료: PENDING 주문 ${completed.ordersCreated}건`,
          };
        }
        return {
          agentRunId: 0,
          text: `${prepared.strategy} 추천 재실행 실패: ${result.failed[0]?.message ?? '알 수 없는 오류'}`,
        };
      }
      case 'BLOG_PUBLISH': {
        const outcome = await prepared.run();
        if (outcome.result.status !== 'preview') {
          return {
            agentRunId: outcome.agentRunId,
            text: outcome.result.message,
          };
        }
        return {
          agentRunId: outcome.agentRunId,
          text: outcome.result.previewText,
          preview: {
            id: outcome.result.previewId,
            text: outcome.result.previewText,
          },
          followupText: outcome.result.content,
        };
      }
    }
  }
}

const toReplayReply = ({
  agentRunId,
  formatted,
}: {
  agentRunId: number;
  formatted: FormattedReport | string;
}): ReplayReply => {
  const text =
    typeof formatted === 'string'
      ? formatted
      : `${formatted.summary}\n\n${formatted.detail}`;
  return { agentRunId, text };
};
