import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  BLOG_PREVIEW_CONFIRM_LINE,
  PublishNotionDraftUsecase,
} from '../../../agent/blog/application/publish-notion-draft.usecase';
import {
  BlogPublishCandidate,
  buildBlogRunOutput,
} from '../../../agent/blog/domain/blog.type';
import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { PREVIEW_KIND } from '../../../preview-gate/domain/preview-action.type';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

// 저녁 카드는 다이제스트와 따로 오는 메시지라 "아래" 에 전문이 없다. 전문이 실제로 있는 곳을 적는다.
export const EVENING_BLOG_CONFIRM_LINE =
  '저녁 다이제스트 스레드에 첨부한 전문(.md 파일)을 열어 확인한 뒤 ✅ 적용 / ❌ 취소를 눌러주세요.';

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
    const inputSnapshot = {
      taskId: this.id,
      // 사용자 한정 원장 집계(`/quota` 등)가 inputSnapshot.slackUserId 로 필터하므로
      // 이 키가 없으면 이 실행이 그 표면에서 통째로 빠진다.
      slackUserId: ownerSlackUserId,
      firedAtKst,
    };
    const outcome = await this.agentRunService.execute<BlogPublishCandidate>({
      agentType: AgentType.BLOG_PUBLISH,
      triggerType: TriggerType.AUTOPILOT_BLOG_PUBLISH_CRON,
      inputSnapshot,
      run: async ({ updateInputSnapshot }) => {
        const { candidate, modelUsed, stages } =
          await this.publishNotionDraft.buildPublishCandidate(
            { slackUserId: ownerSlackUserId },
            // 어느 초안을 골랐는지 원장에 남긴다. 이 값이 없으면 실패·차단 회차가 **어느 글
            // 때문이었는지** 조회할 수 없고, 큐가 막혀도 무엇이 막고 있는지 알 수 없다.
            //
            // 위 base 를 함께 펼친다 — 콜백은 스냅샷을 통째로 교체하므로, 넘긴 값만 쓰면
            // `taskId` 와 `firedAtKst` 가 지워진다.
            async (selected) =>
              updateInputSnapshot({ ...inputSnapshot, ...selected }),
          );
        // 단계별 구조 수치를 원장에 함께 남긴다. 저녁 발행은 **이 경로로만** 돈다 —
        // usecase 의 `execute` 는 수동 `/blog-publish` 전용이라, 거기에만 넣으면 매일 도는
        // 회차가 계측에서 통째로 빠진다.
        return {
          result: candidate,
          modelUsed,
          output: buildBlogRunOutput(candidate, stages),
        };
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
      // ✅ 를 누르면 익명화가 잘못된 글이 그대로 공개된다. 그래서 전문을 스레드에 함께 싣되,
      // 댓글 본문이 아니라 파일로 올린다 — 댓글로 펼치면 한 화면을 넘겨 스레드를 덮는다.
      // 슬랙은 파일을 접힌 미리보기로 보여 주고 누르면 전문이 열린다. 승인 전에 글을 외부
      // (공개 저장소·Notion)에 미리 쓰는 링크는 쓰지 않는다 — 그것이 이 게이트가 막는 일이다.
      detailText: `*발행될 파일* \`${candidate.path}\` — 전문은 아래 첨부 파일로 확인하세요.`,
      detailFile: {
        content: candidate.content,
        filename: candidate.path.split('/').at(-1) ?? 'post.md',
        title: candidate.title,
      },
      preview: {
        kind: PREVIEW_KIND.BLOG_GITHUB_PUBLISH,
        payload: candidate.payload,
        previewText: candidate.previewText.replace(
          BLOG_PREVIEW_CONFIRM_LINE,
          EVENING_BLOG_CONFIRM_LINE,
        ),
        // 전문 파일이 못 나간 회차에는 카드도 만들지 않는다. 카드 본문은 "첨부한 전문을 확인한 뒤"
        // 라고 적고 있는데, 그 전문이 유실되면 확인할 것이 없는 채로 승인 버튼만 남는다.
        // Notion 원본으로 대신 확인할 수도 없다 — 커밋되는 것은 익명화를 거친 글이라
        // 원본과 다르고, 그 차이가 바로 사람이 봐야 하는 부분이다.
        requiresDetailDelivery: true,
      },
    };
  }
}
