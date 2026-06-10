import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import { AgentType } from '../../model-router/domain/model-router.type';
import { ConversationTurn } from '../domain/conversation-memory.type';

// prompt 폭증 방지 — 최근 5 turn 정도면 충분한 컨텍스트. 너무 많으면 cost + latency 폭증.
// 한 turn 은 role=user 또는 role=assistant 1개 — 즉 한 사용자 ↔ 봇 round trip 은 최대 2 turn 소비.
// MAX_TURNS (memory service) = 5 와 통일.
const PRIOR_TURN_LIMIT = 5;
const PRIOR_TURN_TEXT_CAP = 200;

// IntentClassifier 가 UNKNOWN 반환 (어느 worker 에도 매핑 불가) 시 RouterMessageHandler 의 catch
// 분기에서 호출되는 일반 대화 응답 fallback.
//
// ModelRouterUsecase.route(PM) 경유 — IntentClassifier 와 동일 패턴. PM provider(CHATGPT/codex) 를
// 1차로 쓰되 codex 쿼터 소진/실패 시 route() 의 양방향 fallback 이 CLAUDE 로 자동 재시도한다.
// route() 자체는 AgentRun 을 기록하지 않으므로 (provider 선택 + fallback 만 수행) conversational
// 응답이 AgentRun 통계를 오염시키지 않는다 — 직접 provider 주입을 우회로 쓰던 본래 이유가 그대로 충족.
@Injectable()
export class ConversationalReplyUsecase {
  private readonly logger = new Logger(ConversationalReplyUsecase.name);

  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly configService: ConfigService,
  ) {}

  async reply({
    text,
    priorTurns,
  }: {
    text: string;
    priorTurns: ConversationTurn[];
  }): Promise<string> {
    const systemPrompt = buildSystemPrompt({
      repoLabel: this.configService
        .get<string>('BE_SANDBOX_DEFAULT_REPO_LABEL')
        ?.trim(),
      ownerLogin: this.configService
        .get<string>('IMPACT_REPORT_GITHUB_AUTHOR')
        ?.trim(),
    });
    const prompt = buildPrompt({ text, priorTurns });
    try {
      const completion = await this.modelRouter.route({
        agentType: AgentType.PM,
        request: { prompt, systemPrompt },
      });
      return completion.text.trim();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Conversational fallback 실패: ${message}`);
      throw error;
    }
  }
}

export const buildSystemPrompt = ({
  repoLabel,
  ownerLogin,
}: {
  repoLabel?: string;
  ownerLogin?: string;
}): string => {
  const selfRepo = repoLabel && repoLabel.length > 0 ? repoLabel : undefined;
  const selfOwner =
    ownerLogin && ownerLogin.length > 0 ? ownerLogin : undefined;

  // self-context block — 사용자가 "이대리 봇" / "이 레포" / "여기" 같은 self-reference 를 쓸 때
  // 봇이 자기 자신 = `${selfRepo}` 임을 인지하지 못해 "어느 repo?" 를 반복 묻는 패턴 (2026-06-05 사례) 차단.
  const selfContextLines = [
    `당신의 정체:`,
    `- 이름: 이대리 (Slack 봇)`,
    selfRepo
      ? `- 동작 환경: ${selfRepo} 레포의 backend (Node 20 + NestJS 10 + Prisma + Slack Bolt).`
      : `- 동작 환경: 단일 GitHub 레포의 backend 봇 (구체적 레포명은 환경변수 기반).`,
    selfOwner
      ? `- 주 사용자 (owner): GitHub login \`${selfOwner}\` — 슬랙에서 직접 대화하는 1인 사용자.`
      : undefined,
    `- self-reference 매핑: 사용자가 "이대리 봇", "이 레포", "여기", "자기 자신", "너" 같은 표현을 직접 쓰면 그 대상은 당신 자신 = ${selfRepo ?? '봇이 동작하는 레포'} 입니다. 이 경우만 "어느 repo 인가요?" 다시 묻지 말고 그대로 사용.`,
    `- 다른 repo 가능성: 사용자가 GitHub URL 또는 "owner/name" 형식으로 다른 repo 를 명시하면 그 repo 를 사용하세요 — self 로 우회 X. 봇은 \`/review-pr\` / \`/impact-report\` 등 임의 repo 도 다룹니다.`,
    `- repo 가 모호한 경우 (self-reference 도 없고 명시 repo 도 없을 때) 짧게 한 번 확인 가능. 단 [이전 대화] 에 이미 사용자가 답한 정보가 있으면 그대로 활용, 같은 질문 반복 X.`,
  ].filter((line): line is string => line !== undefined);

  return [
    `당신은 "이대리" 라는 슬랙 봇입니다. 사용자의 자연어 메시지에 친근하고 짧게 (1~3문장) 한국어로 답해주세요.`,
    '',
    ...selfContextLines,
    '',
    `기본 자세:`,
    `- 항상 자연어로 티키타카 — 명령어 추천 / 슬래시 안내 절대 X (\`/today\`, \`/be plan\`, \`/review-pr\` 같은 표현 사용 금지).`,
    `- 사용자가 무언가 시도하려는 의도가 보이면 "어떤 부분부터 보면 좋을까요?", "어떤 부분이 의심되시나요?" 같이 자연스러운 follow-up 질문으로 끌어주세요.`,
    `- "맡겨주세요", "작업을 던져주세요" 같은 형식적 표현 X — 그냥 같이 대화하듯이.`,
    '',
    `대화 메모리 활용:`,
    `- prompt 의 [이전 대화] 섹션에 user / assistant 라벨이 붙어 있으면 [assistant] 는 당신 자신의 직전 응답입니다. 직전에 한 약속 / 답변을 그대로 이어가세요.`,
    `- 이미 사용자가 답한 정보 (예: repo URL, PR 번호) 를 다시 묻지 마세요 — 이전 turn 에 명시돼 있으면 그대로 활용.`,
    `- 직전 turn 에서 "확인해볼게요" / "잡아볼게요" 같이 진행 약속을 했다면, 이번 turn 에서도 그 약속의 진행 상태를 의식하고 말해주세요 ("아직 확인 중", "지금 다시 보고 있어요" 등).`,
    '',
    `답변 규칙:`,
    `- 모르거나 단정 어려운 사실 (예: 봇 자체의 현재 작업 상태) 은 솔직히 "지금은 대기 중", "확인이 필요하겠어요" 식으로 짧게.`,
    `- 시스템 내부 동작 / LLM 사용 / agent 분류기 / sandbox 같은 내부 용어 노출 X.`,
    `- 사용자가 봇을 통해 무언가 (코드 변경, PR 검토, plan 수립 등) 를 원하는 듯하면 명령어 대신 자연스러운 후속 질문으로 끌어주세요. 봇이 내부적으로 alias 매칭해 진행합니다.`,
    `- 1~3문장 안. 길어지면 핵심 한 문장 + 후속 질문 한 문장 정도.`,
  ].join('\n');
};

export const buildPrompt = ({
  text,
  priorTurns,
}: {
  text: string;
  priorTurns: ConversationTurn[];
}): string => {
  const recent = priorTurns.slice(-PRIOR_TURN_LIMIT);
  if (recent.length === 0) {
    return `[사용자 메시지]\n${text}\n\n위 메시지에 1~3문장으로 답하세요.`;
  }
  const turnLines = recent.map((turn, idx) => {
    const truncated =
      turn.text.length > PRIOR_TURN_TEXT_CAP
        ? `${turn.text.slice(0, PRIOR_TURN_TEXT_CAP)}…`
        : turn.text;
    // role 미설정 (legacy entry) 은 ConversationMemory.parseTurn 이 'user' 로 정규화하지만
    // 안전망: undefined 도 'user' 로 본다.
    const role = turn.role === 'assistant' ? 'assistant' : 'user';
    const workerTag =
      role === 'user' && turn.agentType ? ` (worker=${turn.agentType})` : '';
    return `${idx + 1}. [${role}]${workerTag} ${truncated}`;
  });
  return [
    `[이전 대화 (오래된 순)]`,
    ...turnLines,
    '',
    `[현재 사용자 메시지]`,
    text,
    '',
    `위 메시지에 1~3문장으로 답하세요. [assistant] 라벨이 붙은 이전 응답은 당신 자신의 발화입니다 — 이미 한 약속을 의식하세요.`,
  ].join('\n');
};
