import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PublishNotionDraftUsecase } from '../../../agent/blog/application/publish-notion-draft.usecase';
import { BlogPublishCandidate } from '../../../agent/blog/domain/blog.type';
import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { PREVIEW_KIND } from '../../../preview-gate/domain/preview-action.type';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

@Injectable()
export class BlogGithubPublishAutopilotTask implements AutopilotTask {
  readonly id = 'blog-github-publish';

  constructor(
    private readonly publishNotionDraft: PublishNotionDraftUsecase,
    private readonly agentRunService: AgentRunService,
    private readonly config: ConfigService,
  ) {}

  async run({
    ownerSlackUserId,
    firedAtKst,
  }: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    if (this.config.get<string>('BLOG_GITHUB_PUBLISH_ENABLED') === 'false') {
      return { skip: true };
    }
    // 블로그 발행 설정(.env)이 비어 있는 환경 — `.env.example` 기본값이 그렇다 — 에서는
    // 아래 후보 준비가 매번 PUBLISH_CONFIG_REQUIRED 로 죽어 evening digest 에 실패 줄과
    // FAILED AgentRun 만 매일 쌓인다. 설정하지 않은 환경에서는 기능이 없는 것처럼 조용히 넘긴다.
    // (수동 `/blog-publish` 는 그대로 실패한다 — 사용자가 무엇을 안 채웠는지 알아야 한다.)
    if (!this.publishNotionDraft.isPublishConfigured()) {
      return { skip: true };
    }

    // AgentRun 으로 감싼다 — 실패율·소요시간을 보는 도구는 agent_run 하나뿐이라, 여기 없으면
    // "안 돌았는지 / 돌다 깨졌는지" 가 똑같이 '기록 없음' 으로 보인다. 저녁마다 익명화 모델을
    // 호출하는 task 라 쿼터 소모도 원장에 남아야 한다. 차단된 원문(hits) 도 여기에만 남는다.
    const outcome = await this.agentRunService.execute<BlogPublishCandidate>({
      agentType: AgentType.BLOG_PUBLISH,
      triggerType: TriggerType.AUTOPILOT_BLOG_PUBLISH_CRON,
      inputSnapshot: {
        taskId: this.id,
        // 사용자 한정 원장 집계(`/quota` 등)가 inputSnapshot.slackUserId 로 필터하므로
        // 이 키가 없으면 이 실행이 그 표면에서 통째로 빠진다.
        slackUserId: ownerSlackUserId,
        firedAtKst,
      },
      run: async () => {
        const { candidate, modelUsed } =
          await this.publishNotionDraft.buildPublishCandidate({
            slackUserId: ownerSlackUserId,
          });
        return { result: candidate, modelUsed, output: candidate };
      },
    });

    const candidate = outcome.result;
    if (candidate.status === 'empty') {
      return { skip: true };
    }
    // 발행 부적합으로 보류된 초안은 알린다 — 조용히 넘기면 초안이 쌓이는 것도, 왜 안 나가는지도
    // 사용자가 알 방법이 없다. 반대로 카드가 이미 열려 있는 회차는 카드 자체가 신호라 넘긴다.
    if (candidate.status === 'skipped') {
      if (candidate.cause === 'card-open') {
        return { skip: true };
      }
      return { skip: false, summaryText: candidate.message };
    }
    if (candidate.status === 'blocked') {
      return {
        skip: false,
        summaryText: candidate.message,
      };
    }
    return {
      skip: false,
      summaryText: `Notion 블로그 초안 '${candidate.title}'의 GitHub 발행 승인을 기다립니다.`,
      // 카드의 previewText 는 제목·경로·요약뿐이다. 실제로 공개 저장소에 커밋될 본문을 보지 않고
      // ✅ 를 누르면 익명화가 잘못된 글이 그대로 공개된다. 전문을 스레드 댓글로 함께 보낸다.
      detailText: `*발행될 파일* \`${candidate.path}\`\n\n${candidate.content}`,
      preview: {
        kind: PREVIEW_KIND.BLOG_GITHUB_PUBLISH,
        payload: candidate.payload,
        previewText: candidate.previewText,
      },
    };
  }
}
