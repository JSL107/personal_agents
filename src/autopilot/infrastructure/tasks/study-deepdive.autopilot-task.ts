import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ExpandStudyBriefUsecase } from '../../../study-brief-cron/application/expand-study-brief.usecase';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

// 오늘의 공부(09:30) → 딥다이브 확장(11:00) → 블로그 초안 DB.
// 앞 단계와 시각을 벌려 둔 이유: 브리프 크론은 Hermes 12분 + CTO 판정까지 최악 30분이 걸린다.
// 같은 슬롯에 붙이면 그날 브리프가 저장되기 전에 이 task 가 돌아 매번 '확장할 것 없음' 이 된다.
@Injectable()
export class StudyDeepdiveAutopilotTask implements AutopilotTask {
  readonly id = 'study-deepdive';

  constructor(
    private readonly expandStudyBrief: ExpandStudyBriefUsecase,
    private readonly config: ConfigService,
  ) {}

  async run({
    ownerSlackUserId,
    firedAtKst,
  }: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    if (this.config.get<string>('STUDY_DEEPDIVE_ENABLED') === 'false') {
      return { skip: true };
    }
    // 블로그 초안 DB 를 설정하지 않은 환경에서는 매일 FAILED AgentRun 만 쌓인다.
    // (blog-github-publish task 와 같은 판단 — 자동 경로만 조용히 넘긴다.)
    if (!this.expandStudyBrief.isConfigured()) {
      return { skip: true };
    }

    const outcome = await this.expandStudyBrief.execute({
      ownerSlackUserId,
      firedAtKst,
    });
    const result = outcome.result;
    if (result.status === 'empty') {
      return { skip: true };
    }
    return {
      skip: false,
      summaryText: `오늘의 공부 '${result.topic}' 를 블로그 초안으로 펼쳤습니다 (${result.bodyLength.toLocaleString('ko-KR')}자) — ${result.notionUrl}`,
    };
  }
}
