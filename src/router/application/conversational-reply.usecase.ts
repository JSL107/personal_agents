import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { toTaskLabel } from '../../agent-registry/agent-registry';
import { AgentRunService } from '../../agent-run/application/agent-run.service';
import {
  AgentRunStatus,
  describeFailureReason,
} from '../../agent-run/domain/agent-run.type';
import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import { AgentType } from '../../model-router/domain/model-router.type';
import { SELF_REPO } from '../../pr-review-loop/domain/learning-repo';
import { ConversationTurn } from '../domain/conversation-memory.type';
import { describeEnabledPassiveCapabilities } from '../domain/passive-capability';
import {
  AGENT_DISPATCHER_PORT,
  AgentDispatcher,
} from '../domain/port/agent-dispatcher.port';
import {
  WORKER_CAPABILITIES,
  WorkerCapability,
} from '../domain/worker-capability';

// prompt 폭증 방지 — 최근 5 turn 정도면 충분한 컨텍스트. 너무 많으면 cost + latency 폭증.
// 한 turn 은 role=user 또는 role=assistant 1개 — 즉 한 사용자 ↔ 봇 round trip 은 최대 2 turn 소비.
// MAX_TURNS (memory service) = 5 와 통일.
const PRIOR_TURN_LIMIT = 5;
// 사용자 발화는 짧지만, 스레드 원글(공고 피드·알림)과 이대리 자신의 직전 답은 길다. 200자로 자르면
// "이거 뭔데?" 가 가리키는 글의 앞부분만 보고 답한다(2026-10-08 run 7585, 10-13 run 8292).
const PRIOR_TURN_TEXT_CAP = 1500;
// 실행 id 가 없는 작업 turn(비동기 BLOG ack)은 같은 대화에서 turn 시각보다 이만큼 앞서 시작된
// 실행까지 그 작업으로 본다. 비동기 실행은 ack 를 남기기 직전에 시작하므로 짧게 잡는다 — 길면
// 같은 대화의 더 이전 실행(보류된 요청 앞의 초안 등)이 잡힌다. 몇 분 뒤 남는 완료 답장 turn 은
// 이 창을 벗어날 수 있지만, 그 turn 자체가 결과(링크·실패 사유)를 담고 있어 상태 줄이 없어도 된다.
const ASYNC_WORK_STATUS_LOOKBACK_MS = 5 * 60 * 1000;

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

  // 실제로 라우팅 가능한 워커의 기능만 답에 싣는다 — 등록되지 않은 워커를 "할 수 있다" 고 하면
  // 사용자가 그대로 말해도 실행되지 않는다.
  private readonly capabilities: readonly WorkerCapability[];
  // 켜져 있는 자동 발송·이모지·버튼 기능. env 는 실행 중에 바뀌지 않으므로 생성 시 한 번 정한다.
  private readonly passiveCapabilities: readonly string[];

  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly configService: ConfigService,
    // 필수 — 빠지면 조용히 전체 목록을 안내하는 대신 부팅이 실패해야 "등록된 워커만" 이 지켜진다.
    @Inject(AGENT_DISPATCHER_PORT)
    dispatchers: AgentDispatcher[],
    // 답을 담당 못 고른 회차의 원장 행에 붙인다. 없으면 기록만 건너뛴다.
    @Optional()
    private readonly agentRunService?: AgentRunService,
  ) {
    const registered = dispatchers.map((dispatcher) => dispatcher.agentType);
    this.capabilities = WORKER_CAPABILITIES.filter(({ agentType }) =>
      registered.includes(agentType),
    );
    this.passiveCapabilities = describeEnabledPassiveCapabilities((key) =>
      this.configService.get<string>(key),
    );
  }

  async reply({
    text,
    priorTurns,
    unresolvedStreak,
    routingMissRunId,
    conversationKey,
  }: {
    text: string;
    priorTurns: ConversationTurn[];
    unresolvedStreak?: number;
    // priorTurns 를 읽어 온 대화 기억 키. 실행 id 가 없는 작업 turn(비동기 BLOG)은 이 대화에서
    // 시작된 실행만 찾는다 — 없으면 그런 turn 의 상태는 싣지 않는다.
    conversationKey?: string;
    // 라우터가 이 회차를 남긴 ROUTER run. 있으면 답을 그 행의 모델 응답 원문으로 남긴다 —
    // 없으면 원장에는 "못 골랐다" 만 있고 이대리가 뭐라고 답했는지는 사라진다.
    routingMissRunId?: number;
  }): Promise<string> {
    const systemPrompt = buildSystemPrompt({
      // 이대리 자신의 레포. 대화 응답이 "우리 레포" 를 지칭할 때 쓰는 이름이라 상수로 족하다.
      repoLabel: SELF_REPO,
      ownerLogin: this.configService
        .get<string>('IMPACT_REPORT_GITHUB_AUTHOR')
        ?.trim(),
      unresolvedStreak,
      capabilities: this.capabilities,
      passiveCapabilities: this.passiveCapabilities,
    });
    const workStatus = await this.describeLatestWorkStatus({
      priorTurns,
      conversationKey,
    });
    const prompt = buildPrompt({ text, priorTurns, workStatus });
    try {
      const completion = await this.modelRouter.route({
        agentType: AgentType.PM,
        request: { prompt, systemPrompt },
        // PM provider 를 빌려 쓸 뿐 실제 PM 업무가 아니다. 계약 머리말의 산출물 규격이
        // 붙으면 이 usecase 가 요구하는 1~3문장 대화 응답과 충돌한다.
        noContractPreamble: true,
      });
      const reply = completion.text.trim();
      if (routingMissRunId !== undefined) {
        await this.agentRunService?.attachModelResponse({
          agentRunId: routingMissRunId,
          agentType: AgentType.ROUTER,
          modelResponse: reply,
        });
      }
      return reply;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Conversational fallback 실패: ${message}`);
      throw error;
    }
  }

  // 대화의 마지막 작업 turn(worker 가 답한 assistant turn)이 맡긴 일의 실제 상태 한 줄.
  // 블로그처럼 "시작했어요" 만 답하고 뒤에서 도는 일은 turn 에 결과가 없어, 이게 없으면 모델이
  // 진행 여부를 지어낸다(2026-10-14 run 8886 — 재시작으로 끊겼는데 "시작된 적 없다" 고 답함).
  // 실행은 이 대화의 것만 본다 — 같은 사용자가 다른 스레드에서 돌린 실행을 싣지 않는다(#824 리뷰).
  // 조회 실패는 답을 막지 않는다 — 상태 줄 없이 예전처럼 답한다.
  private async describeLatestWorkStatus({
    priorTurns,
    conversationKey,
  }: {
    priorTurns: ConversationTurn[];
    conversationKey?: string;
  }): Promise<string | undefined> {
    const workTurn = [...priorTurns]
      .reverse()
      .find((turn) => turn.role === 'assistant' && turn.agentType);
    if (!workTurn?.agentType || !this.agentRunService) {
      return undefined;
    }
    const label = toTaskLabel(workTurn.agentType);
    try {
      // 동기 worker 는 turn 에 실제 실행 id 가 남는다.
      if (workTurn.agentRunId !== null && workTurn.agentRunId > 0) {
        const run = await this.agentRunService.findRunStatus(
          workTurn.agentRunId,
        );
        return formatWorkStatus(label, run);
      }
      // id 가 0·null 인 turn 은 비동기 BLOG ack 이거나, 실행 기록 없이 바로 답한 조회(시세·일정 등)다.
      // 이 대화에서 시작된 실행이 없으면 후자로 보고 상태를 싣지 않는다 — "실행 기록 없음" 은
      // 이미 답이 나간 조회를 시작조차 안 된 일로 읽히게 한다.
      if (!conversationKey) {
        return undefined;
      }
      const run = await this.agentRunService.findLatestConversationRun({
        agentType: workTurn.agentType,
        conversationKey,
        startedSince: new Date(
          workTurn.timestampMs - ASYNC_WORK_STATUS_LOOKBACK_MS,
        ),
      });
      return run === null ? undefined : formatWorkStatus(label, run);
    } catch (error: unknown) {
      this.logger.warn(
        `직전 작업 상태 조회 실패 — 상태 없이 답한다: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }
}

export const formatWorkStatus = (
  label: string,
  run: { status: string; failureReason: string | null } | null,
): string => {
  if (run === null) {
    return `${label}: 실행 기록 없음 (시작되지 않았거나 기록되기 전에 끊김)`;
  }
  if (run.status === AgentRunStatus.IN_PROGRESS) {
    return `${label}: 지금 진행 중`;
  }
  if (run.status === AgentRunStatus.SUCCEEDED) {
    return `${label}: 완료됨`;
  }
  return `${label}: 실패 — ${describeFailureReason(run.failureReason ?? '이유 미기록')}`;
};

export const buildSystemPrompt = ({
  repoLabel,
  ownerLogin,
  unresolvedStreak,
  capabilities = WORKER_CAPABILITIES,
  passiveCapabilities = [],
}: {
  repoLabel?: string;
  ownerLogin?: string;
  unresolvedStreak?: number;
  capabilities?: readonly WorkerCapability[];
  passiveCapabilities?: readonly string[];
}): string => {
  const selfRepo = repoLabel && repoLabel.length > 0 ? repoLabel : undefined;
  const selfOwner =
    ownerLogin && ownerLogin.length > 0 ? ownerLogin : undefined;
  const shouldChangeDirection = (unresolvedStreak ?? 0) >= 2;

  // self-context block — 사용자가 "이대리 봇" / "이 레포" / "여기" 같은 self-reference 를 쓸 때
  // 봇이 자기 자신 = `${selfRepo}` 임을 인지하지 못해 "어느 repo?" 를 반복 묻는 패턴 (2026-06-05 사례) 차단.
  const selfContextLines = [
    `당신의 정체:`,
    `- 이름: 이대리 (Slack 봇)`,
    // 기술 스택을 적어 두면 "이대리 백엔드에 구현해야 해요" 처럼 답에 그대로 묻어난다(2026-10-14 run 8838).
    // 레포 이름은 아래 self-reference 매핑이 쓰므로 남긴다.
    selfRepo
      ? `- 코드가 있는 곳: ${selfRepo} 레포.`
      : `- 코드가 있는 곳: 단일 GitHub 레포 (구체적 레포명은 환경변수 기반).`,
    selfOwner
      ? `- 주 사용자 (owner): GitHub login \`${selfOwner}\` — 슬랙에서 직접 대화하는 1인 사용자.`
      : undefined,
    // 2026-08-13·19 DM 에서 개인 봇이 "어느 고객사의 가상계좌", "타인의 비공개 금융정보" 를 말했다 —
    // 자기가 누구의 비서인지 모르면 범용 챗봇처럼 답한다.
    `- 이 봇은 한 사람의 개인 비서입니다. 고객사나 다른 사용자는 없고, 대화에 나오는 계좌(모의투자)·휴가·일정·지원 기록은 모두 이 사용자 본인 것입니다. 리뷰를 맡긴 PR 은 회사나 다른 사람의 레포일 수 있으니 소유를 전제하지 마세요.`,
    `- self-reference 매핑: 사용자가 "이대리 봇", "이 레포", "여기", "자기 자신", "너" 같은 표현을 직접 쓰면 그 대상은 당신 자신 = ${selfRepo ?? '봇이 동작하는 레포'} 입니다. 이 경우만 "어느 repo 인가요?" 다시 묻지 말고 그대로 사용.`,
    `- 다른 repo 가능성: 사용자가 GitHub URL 또는 "owner/name" 형식으로 다른 repo 를 명시하면 그 repo 를 사용하세요 — self 로 우회 X. 봇은 임의 repo 의 PR 도 리뷰·영향 분석합니다.`,
    shouldChangeDirection
      ? `- repo 가 모호하더라도 추가 확인 질문을 하지 마세요. [이전 대화] 에 있는 정보만 활용하고, 정보가 부족하면 그 한계를 진술하세요.`
      : `- repo 가 모호한 경우 (self-reference 도 없고 명시 repo 도 없을 때) 짧게 한 번 확인 가능. 단 [이전 대화] 에 이미 사용자가 답한 정보가 있으면 그대로 활용, 같은 질문 반복 X.`,
  ].filter((line): line is string => line !== undefined);

  // 담당을 못 고른 질문이 이 답변으로 온다. 이대리가 무엇을 하는지 모르면 "무엇을 원하시는지" 만
  // 되묻게 된다(2026-08-10 "프롬프트 Rag" 3턴, 08-19 모의투자 6턴).
  const capabilityLines = [
    '',
    `이대리가 할 수 있는 일 (사용자가 아래 예시처럼 말하면 실제로 실행됩니다):`,
    ...capabilities.map(({ canDo }) => `- ${canDo}`),
    ...(passiveCapabilities.length > 0
      ? [
          '',
          `이대리가 자동으로 하는 일과 이모지·버튼으로 할 수 있는 일 (말로 시키는 일이 아니라, 아래처럼 동작합니다):`,
          ...passiveCapabilities.map((line) => `- ${line}`),
        ]
      : []),
  ];

  const directionChangeLines = shouldChangeDirection
    ? [
        '',
        `방향 전환 (최우선):`,
        `- 이 블록은 아래 일반 규칙보다 우선합니다. 단 prompt 에 [직전 작업 상태] 가 있고 사용자가 그 작업의 진행을 물으면, 실행할 수 없다고 하지 말고 그 상태대로 답하세요.`,
        `- 추가 질문 금지: 응답에 물음표를 쓰지 말고, 질문으로 끝나는 문장을 쓰지 마세요.`,
        `- 선택지를 제시하지 마세요. "먼저 A를 볼까요, B를 볼까요"처럼 사용자가 고르게 하는 표현도 쓰지 마세요.`,
        `- 이 요청은 현재 대화 응답만으로 실제로 실행할 수 없는 요청임을 솔직히 말하세요.`,
        `- 대신 위 「이대리가 할 수 있는 일」 중 가장 가까운 1~2개를 자연어로 제안하고, 각각 무엇을 얻을 수 있는지 진술형 문장으로 설명하세요. 특정 기술 주제는 조사해 정리 글로 남기는 방향을 포함할 수 있습니다.`,
        `- 제안만 하고 실행을 확정하지 마세요. 명령어·슬래시를 안내하지 말고, "해드릴게요" 같은 실행 약속도 하지 마세요.`,
        `- worker, 분류기, LLM 같은 시스템 내부 용어를 응답에 노출하지 마세요.`,
      ]
    : [];

  const basicFollowUpLine = shouldChangeDirection
    ? undefined
    : `- 사용자가 묻거나 원하는 일이 「이대리가 할 수 있는 일」에 있으면 되묻지 말고, 할 수 있다고 답한 뒤 그렇게 말하면 바로 처리된다는 자연어 예시를 보여주세요. 「이대리가 자동으로 하는 일과 이모지·버튼으로 할 수 있는 일」에 있으면 그 방법(언제 오는지, 어디에 어떤 이모지를 달거나 어떤 버튼을 누르는지)을 그대로 알려주세요 — 말로 시키면 된다고 하지 마세요. 대화만으로 할 수 있는 일 — [이전 대화]·스레드 원문의 요약·설명, 브레인스토밍, 의견, 잡담 — 은 목록과 무관하게 지금 이 답에서 직접 하세요("지원하지 않는다" 고 하지 마세요). 요약·설명은 원문에 없는 사실을 보태지 말고, 요약할 원문이 [이전 대화]에 없으면 일반 지식으로 대신 요약하지 말고 무엇을 가리키는지 짧게 물으세요. 조회·기록·발행처럼 실제로 실행해야 하는 일이 두 목록 어디에도 없을 때만 지금은 못 한다고 솔직히 말하고 가장 가까운 일을 알려주세요. 가장 가까운 일도 반드시 목록 안에서 고르고, 목록에 없는 방법("파일·자막을 보내 주면 분석할게요" 같은)을 지어내지 마세요. 질문과 주제가 겹치지 않는 일(공고 제외를 물었는데 이력서 정리)은 대안으로 붙이지 말고, 그럴 바엔 못 한다고만 답하세요.`;
  const memoryRecoveryLine = shouldChangeDirection
    ? `- 직전 [assistant] 응답에서 "확인해볼게요" / "정리해볼게요" 같은 진행 약속을 했더라도, 그 약속이 진행 중인 것처럼 "아직 확인 중", "지금 보고 있어요" 라고 말하지 마세요 — 이 대화 응답만으로는 아무 작업도 시작되지 않았음을 솔직히 말하세요. [직전 작업 상태] 가 있으면 그 상태를 따르세요.`
    : `- 직전 [assistant] 응답에서 "확인해볼게요" / "정리해볼게요" 같은 진행 약속을 했더라도, 그 약속이 진행 중인 것처럼 "아직 확인 중", "지금 보고 있어요" 라고 말하지 마세요 — 이 대화 응답만으로는 아무 작업도 시작되지 않으므로 거짓이 됩니다. 사용자가 진행을 재촉하면, prompt 에 [직전 작업 상태] 가 있으면 그 상태를 그대로 전하고, 없으면 작업이 아직 시작되지 않았음을 전제로 무엇을 원하는지 한 문장으로 짚어달라고 자연스럽게 되물으세요.`;
  const workRequestLine = shouldChangeDirection
    ? undefined
    : `- 되묻기는 원하는 일은 분명한데 꼭 필요한 대상(PR 링크, 날짜 등)이 빠졌을 때만, 빠진 것 하나만 짧게 물으세요. [이전 대화]에 이미 있는 정보는 묻지 마세요. 명령어/슬래시는 안내하지 마세요.`;
  const answerLengthLine = shouldChangeDirection
    ? `- 2~4문장 안에서 실행 불가 이유와 가능한 일 1~2개를 충분히 설명하세요.`
    : `- 기능 안내·짧은 질문은 1~3문장으로 짧게. 무엇을 할 수 있는지 묻는 질문에는 관련 있는 일을 3~5개까지 짧게 나열해도 됩니다. 요약·브레인스토밍·의견처럼 내용 자체가 답인 요청은 필요한 만큼 쓰되(사용자가 줄 수를 정했으면 그대로) 군더더기는 빼세요.`;

  return [
    shouldChangeDirection
      ? `당신은 "이대리" 라는 슬랙 봇입니다. 사용자의 자연어 메시지에 친근하고 분명하게 한국어로 답해주세요.`
      : `당신은 "이대리" 라는 슬랙 봇입니다. 사용자의 자연어 메시지에 친근하게 한국어로 답해주세요. 길이는 아래 「답변 규칙」을 따릅니다.`,
    '',
    ...selfContextLines,
    ...capabilityLines,
    ...directionChangeLines,
    '',
    `기본 자세:`,
    `- 항상 자연어로 티키타카 — 명령어 추천 / 슬래시 안내 절대 X (\`/today\`, \`/be plan\`, \`/review-pr\` 같은 표현 사용 금지).`,
    basicFollowUpLine,
    `- "맡겨주세요", "작업을 던져주세요" 같은 형식적 표현 X — 그냥 같이 대화하듯이.`,
    '',
    `대화 메모리 활용:`,
    `- prompt 의 [이전 대화] 섹션에 user / assistant 라벨이 붙어 있으면 [assistant] 는 당신 자신의 직전 응답입니다. 직전에 나눈 화제와 맥락은 자연스럽게 이어가되, 실행 약속만은 반복하지 마세요.`,
    `- 이미 사용자가 답한 정보 (예: repo URL, PR 번호) 를 다시 묻지 마세요 — 이전 turn 에 명시돼 있으면 그대로 활용.`,
    memoryRecoveryLine,
    `- prompt 에 [직전 작업 상태] 가 있으면 그것이 실제 실행 기록입니다. 작업 진행을 물으면 이 상태만 근거로 답하고(진행 중·완료·실패와 그 사유), 반대로 말하지 마세요. 실패했으면 같은 요청을 다시 보내면 된다고 알려주세요.`,
    '',
    `답변 규칙:`,
    `- 모르거나 단정 어려운 사실 (예: 봇 자체의 현재 작업 상태) 은 솔직히 "확인이 필요하겠어요" 식으로 짧게. 단 [직전 작업 상태] 가 있으면 추측하지 말고 그 상태를 따르세요.`,
    `- 시스템 내부 동작 / LLM 사용 / agent 분류기 / sandbox 같은 내부 용어 노출 X.`,
    `- 실행 약속 금지: 이 대화 응답은 어떤 작업도 실제로 실행하지 않습니다 (PR 리뷰·회고·이력서/포트폴리오 정리·코드 변경·plan 수립 등 무엇도). 따라서 "~해볼게요", "정리해드릴게요", "처리하겠습니다", "가져올게요" 처럼 당신이 그 작업을 진행/완료하겠다는 미래 약속을 하지 마세요 — 지킬 수 없는 약속이 됩니다.`,
    workRequestLine,
    answerLengthLine,
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n');
};

export const buildPrompt = ({
  text,
  priorTurns,
  workStatus,
}: {
  text: string;
  priorTurns: ConversationTurn[];
  workStatus?: string;
}): string => {
  const recent = priorTurns.slice(-PRIOR_TURN_LIMIT);
  const workStatusLines = workStatus
    ? ['', `[직전 작업 상태 (실제 실행 기록)]`, workStatus]
    : [];
  if (recent.length === 0) {
    return `[사용자 메시지]\n${text}\n\n위 메시지에 답하세요.`;
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
    ...workStatusLines,
    '',
    `[현재 사용자 메시지]`,
    text,
    '',
    `위 메시지에 답하세요. [assistant] 라벨이 붙은 이전 응답은 당신 자신의 발화입니다 — 단, 이 응답만으로는 작업이 실행되지 않으니 "해볼게요" 같은 실행 약속을 새로 하거나 반복하지 마세요.`,
  ].join('\n');
};
