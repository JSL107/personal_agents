import { createHash } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import {
  AgentType,
  ModelProviderName,
} from '../../model-router/domain/model-router.type';
import { ConversationTurn } from '../domain/conversation-memory.type';
import { AgentDispatcher } from '../domain/port/agent-dispatcher.port';
import { WORKER_CAPABILITIES } from '../domain/worker-capability';
import {
  buildPrompt,
  buildSystemPrompt,
  ConversationalReplyUsecase,
  formatWorkStatus,
} from './conversational-reply.usecase';

describe('ConversationalReply — buildSystemPrompt (self-context)', () => {
  it('repoLabel + ownerLogin 이 모두 있으면 self-identity 블록에 그대로 inject', () => {
    const prompt = buildSystemPrompt({
      repoLabel: 'JSL107/personal_agents',
      ownerLogin: 'JSL107',
    });
    expect(prompt).toContain('JSL107/personal_agents');
    expect(prompt).toContain('GitHub login `JSL107`');
    // self-reference 매핑 — 사용자가 "이대리 봇" / "이 레포" 라 할 때 봇이 다시 묻지 않게 명시
    expect(prompt).toMatch(/이대리 봇.*이 레포.*여기.*당신 자신/);
    // 단정은 self-reference 케이스에 한정 — "이 경우만" 표현이 들어가 다른 repo 시나리오는 열려 있음
    expect(prompt).toMatch(/이 경우만 "어느 repo 인가요\?" 다시 묻지 말고/);
  });

  it('다른 repo 시나리오 (review-pr / impact-report 등 임의 repo) 가 열려 있음을 명시', () => {
    const prompt = buildSystemPrompt({ repoLabel: 'JSL107/personal_agents' });
    // self 로 우회하지 않고 사용자가 명시한 다른 repo 를 그대로 사용해야 한다는 규칙
    expect(prompt).toMatch(/다른 repo 가능성/);
    expect(prompt).toMatch(/owner\/name.*self 로 우회 X/);
    // 모호한 케이스 — 짧게 확인 가능하되 이전 turn 의 정보는 재활용
    expect(prompt).toMatch(/repo 가 모호한 경우.*짧게 한 번 확인 가능/);
    expect(prompt).toMatch(/같은 질문 반복 X/);
  });

  it('repoLabel 만 있으면 ownerLogin 라인은 생략', () => {
    const prompt = buildSystemPrompt({
      repoLabel: 'JSL107/personal_agents',
    });
    expect(prompt).toContain('JSL107/personal_agents');
    expect(prompt).not.toMatch(/GitHub login `/);
  });

  it('repoLabel 미설정 시 generic 레포 안내로 fallback', () => {
    const prompt = buildSystemPrompt({});
    expect(prompt).toContain('코드가 있는 곳: 단일 GitHub 레포');
    // 빈 문자열은 미설정과 동일 — falsy 처리
    const prompt2 = buildSystemPrompt({ repoLabel: '', ownerLogin: '' });
    expect(prompt2).toContain('코드가 있는 곳: 단일 GitHub 레포');
  });

  it('자기소개에 기술 스택을 싣지 않는다 — 답에 "백엔드에 구현" 류로 묻어난다', () => {
    for (const prompt of [
      buildSystemPrompt({ repoLabel: 'JSL107/personal_agents' }),
      buildSystemPrompt({}),
    ]) {
      expect(prompt).not.toMatch(/NestJS|Prisma|Node 22|Slack Bolt|backend/);
    }
  });

  it('대화 메모리 활용 규칙이 prompt 에 포함된다 (직전 [assistant] 라벨 인식 + 이미 받은 정보 재질문 금지)', () => {
    const prompt = buildSystemPrompt({});
    expect(prompt).toMatch(/\[assistant\] 는 당신 자신의 직전 응답/);
    expect(prompt).toMatch(/이미 사용자가 답한 정보.*다시 묻지 마세요/);
  });

  it('명령어 / 슬래시 노출 금지 규칙 유지 (기존 PR #69 결정 보존)', () => {
    const prompt = buildSystemPrompt({ repoLabel: 'foo/bar' });
    expect(prompt).toMatch(/명령어 추천 \/ 슬래시 안내 절대 X/);
  });

  // 거짓 약속 차단 (2026-07-02) — fallback 은 순수 대화 경로라 실제 작업(worker dispatch)을
  // 전혀 실행하지 않는다. LLM 이 "정리해볼게요" 같은 실행 약속을 하면 사용자는 영영 오지 않을
  // 결과를 기다리게 된다 (원 버그: PR #220 요청이 UNKNOWN → fallback → "정리해볼게요"만 하고 끝).
  it('거짓 실행 약속 금지 — "해볼게요" 류 미래 실행 약속을 하지 말라는 지침이 포함된다', () => {
    const prompt = buildSystemPrompt({ repoLabel: 'foo/bar' });
    expect(prompt).toContain('실행 약속 금지');
    expect(prompt).toMatch(/어떤 작업도 실제로 실행하지 않/);
    // 금지 대상 예시("해볼게요")가 프롬프트에 명시돼 LLM 이 회피 대상을 알 수 있어야 한다.
    expect(prompt).toContain('해볼게요');
  });

  it('거짓 진행 보고 금지 — "아직 확인 중" 처럼 진행 중인 척하지 말라는 지침이 포함된다', () => {
    const prompt = buildSystemPrompt({});
    expect(prompt).toMatch(/진행 중인 것처럼/);
    expect(prompt).toContain('거짓이 됩니다');
  });

  it('거짓 자동실행 안내 제거 — 과거 "alias 매칭해 진행합니다" 문구가 더는 없다', () => {
    const prompt = buildSystemPrompt({ repoLabel: 'foo/bar' });
    expect(prompt).not.toContain('alias 매칭해 진행');
  });

  it.each([2, 3])(
    'conversational fallback streak=%i이면 되묻기 규칙을 제거하고 관측 가능한 방향 전환을 지시한다',
    (unresolvedStreak) => {
      const prompt = buildSystemPrompt({ unresolvedStreak });

      const removedQuestionLines = [
        'follow-up 질문으로 끌어주세요.',
        '무엇을 원하는지 한 문장으로 짚어달라고 자연스럽게 되물으세요.',
        '한 문장으로 또렷이 말해달라고 자연스럽게 되물어 주세요',
        '핵심 한 문장 + 후속 질문 한 문장 정도.',
      ];
      removedQuestionLines.forEach((line) => {
        expect(prompt).not.toContain(line);
      });

      expect(prompt).toContain('질문으로 끝나는 문장을 쓰지 마세요');
      expect(prompt).toContain('선택지를 제시하지 마세요');
      expect(prompt).toMatch(/실제로 실행할 수 없는 요청.*솔직히/);
      expect(prompt).toMatch(/할 수 있는 일.*1~2개.*제안/);
      expect(prompt).toContain('2~4문장');
      expect(prompt).not.toContain('친근하고 짧게 (1~3문장)');
      expect(prompt).toMatch(/명령어 추천 \/ 슬래시 안내 절대 X/);
      expect(prompt).toContain('실행 약속 금지');
      expect(prompt).toMatch(/worker.*분류기.*LLM.*노출하지 마세요/);
    },
  );

  it.each([0, 1])(
    'streak=%i이면 기존 no-streak system prompt 와 완전히 동일하다',
    (unresolvedStreak) => {
      const context = {
        repoLabel: 'JSL107/personal_agents',
        ownerLogin: 'JSL107',
      };
      const baselinePrompt = buildSystemPrompt(context);
      const prompt = buildSystemPrompt({ ...context, unresolvedStreak });

      expect(prompt).toBe(baselinePrompt);
      expect(createHash('sha256').update(prompt).digest('hex')).toBe(
        // 2026-10-07 기능 목록·개인 봇 사실·되묻기 규칙 교체, PR 소유 문구 정정(#744 리뷰), 링크 없는 게시 안내(4단계)로 갱신
        // 2026-10-08 PO_SHADOW 가 분기 제품 목표 선언·조회·닫기도 받는다(PO Shadow 단계 3)
        // 2026-10-14 자동·이모지·버튼 기능 목록 안내 규칙, 주제가 겹치지 않는 대안 금지(run 8787)
        // 2026-10-14 BLOG canDo 에 웹 검색 조사 경로와 "바로 검색해 답하지는 못한다" 를 명시(run 8605)
        // 2026-10-14 자기소개에서 기술 스택 제거 — 답에 "백엔드에 구현" 으로 묻어났다(run 8838)
        // 2026-10-14 대화만으로 할 수 있는 일(원문 요약·설명, 브레인스토밍, 의견, 잡담)은 직접 답하고(run 8837·8836), 길이는 요청 성격별로
        // 2026-10-14 원문이 없을 때 일반 지식으로 대신 요약하지 않는다(#817 리뷰)
        // 2026-10-14 기능 안내 문구를 일상어로(PO 입장·메타 회고·드리프트·익명화·plan 대신 풀어 씀)
        // 2026-10-14 CEO 예시 "이번 주 메타 평가해줘" 를 일상어로(#822 리뷰)
        // 2026-10-14 진행 여부는 [직전 작업 상태] 실제 기록으로 답한다 — "대기 중" 추측 예시 제거(run 8886)
        '57c4571477811e1e65623c35f4a59ac1b9af505b34a98ea9ecad8b6a1815c113',
      );
    },
  );
});

describe('ConversationalReply — 이대리가 할 수 있는 일', () => {
  it('등록된 워커의 할 수 있는 일과 자연어 예시를 싣는다', () => {
    const prompt = buildSystemPrompt({});
    expect(prompt).toContain('이대리가 할 수 있는 일');
    for (const { canDo } of WORKER_CAPABILITIES) {
      expect(prompt).toContain(canDo);
    }
  });

  it('받은 목록만 싣는다 — 등록되지 않은 워커를 할 수 있다고 하지 않는다', () => {
    const vacation = WORKER_CAPABILITIES.find(
      ({ agentType }) => agentType === AgentType.VACATION,
    )!;
    const paper = WORKER_CAPABILITIES.find(
      ({ agentType }) => agentType === AgentType.PAPER_TRADE,
    )!;
    const prompt = buildSystemPrompt({ capabilities: [vacation] });
    expect(prompt).toContain(vacation.canDo);
    expect(prompt).not.toContain(paper.canDo);
  });

  it('reply() 는 주입된 dispatcher 의 워커만 싣는다', async () => {
    const route = jest.fn().mockResolvedValue({ text: '네', modelUsed: 'm' });
    const usecase = new ConversationalReplyUsecase(
      { route } as unknown as ModelRouterUsecase,
      { get: () => undefined } as unknown as ConfigService,
      [{ agentType: AgentType.VACATION }] as unknown as AgentDispatcher[],
    );
    await usecase.reply({ text: '뭐 할 수 있어?', priorTurns: [] });
    const systemPrompt: string = route.mock.calls[0][0].request.systemPrompt;
    expect(systemPrompt).toContain('휴가·연차 잔여 조회');
    expect(systemPrompt).not.toContain('모의투자(가상) 계좌');
  });

  it('자동·이모지 기능은 받은 것만, 말로 시키는 일과 구분해 싣는다', () => {
    expect(buildSystemPrompt({})).not.toContain('버튼으로 할 수 있는 일 (');
    const prompt = buildSystemPrompt({
      passiveCapabilities: ['원화 공고 글에서 「관심 없음」을 누르면 뺀다.'],
    });
    expect(prompt).toContain(
      '이모지·버튼으로 할 수 있는 일 (말로 시키는 일이 아니라',
    );
    expect(prompt).toContain('- 원화 공고 글에서 「관심 없음」을 누르면 뺀다.');
    expect(prompt).toContain('말로 시키면 된다고 하지 마세요');
  });

  it('reply() 는 켜진 자동·이모지 기능만 싣는다 — env 가 비면 안내하지 않는다', async () => {
    const route = jest.fn().mockResolvedValue({ text: '네', modelUsed: 'm' });
    const env: Record<string, string> = { ART_JOB_FEED_TARGET: 'C1' };
    const usecase = new ConversationalReplyUsecase(
      { route } as unknown as ModelRouterUsecase,
      { get: (key: string) => env[key] } as unknown as ConfigService,
      [] as unknown as AgentDispatcher[],
    );
    await usecase.reply({ text: '공고 빼는 법?', priorTurns: [] });
    const systemPrompt: string = route.mock.calls[0][0].request.systemPrompt;
    expect(systemPrompt).toContain('게임잡의 원화 채용공고');
    // 받는 사람(ART_JOB_FEED_MENTION_USER_ID)이 없으면 누구의 클릭도 제외로 반영되지 않는다.
    expect(systemPrompt).not.toContain('「관심 없음」 버튼');
  });

  it('개인 비서라는 사실을 싣고, 고객사·타인을 상정하지 않게 한다', () => {
    const prompt = buildSystemPrompt({});
    expect(prompt).toMatch(/한 사람의 개인 비서.*고객사나 다른 사용자는 없/);
    // 리뷰를 맡긴 PR 은 회사·남의 레포일 수 있다 — 본인 소유로 묶지 않는다(#744 리뷰).
    expect(prompt).not.toMatch(/지원 기록·PR 은 모두/);
    expect(prompt).toContain('소유를 전제하지 마세요');
  });

  it('목록에 있는 일이면 되묻지 말라는 규칙으로 "follow-up 질문으로 끌어라" 를 대체했다', () => {
    const prompt = buildSystemPrompt({});
    expect(prompt).not.toContain('follow-up 질문으로 끌어주세요');
    expect(prompt).not.toContain('한 문장으로 또렷이 말해달라고');
    expect(prompt).toMatch(/할 수 있는 일」에 있으면 되묻지 말고/);
  });

  it('자기소개가 슬래시 명령을 예로 들지 않는다', () => {
    const prompt = buildSystemPrompt({ repoLabel: 'JSL107/personal_agents' });
    // 금지 목록 안의 예시("`/review-pr` 같은 표현 사용 금지")는 남고, 자기소개의 사용 예시만 빠진다.
    expect(prompt).not.toContain(
      '`/review-pr` / `/impact-report` 등 임의 repo',
    );
  });
});

describe('ConversationalReply — buildPrompt (role-tagged turn lines)', () => {
  const baseTurn = (
    overrides: Partial<ConversationTurn>,
  ): ConversationTurn => ({
    role: 'user',
    text: 'placeholder',
    agentType: null,
    agentRunId: null,
    timestampMs: 1_700_000_000_000,
    ...overrides,
  });

  it('prior turns 가 없으면 단순한 [사용자 메시지] 블록만 출력', () => {
    const prompt = buildPrompt({ text: '안녕', priorTurns: [] });
    expect(prompt).toContain('[사용자 메시지]');
    expect(prompt).toContain('안녕');
    expect(prompt).not.toContain('[이전 대화');
  });

  it('user / assistant role 이 각 turn 에 명확히 표시된다', () => {
    const prompt = buildPrompt({
      text: '진행 어떻게 됐어?',
      priorTurns: [
        baseTurn({ role: 'user', text: '이대리 봇 개선해줘' }),
        baseTurn({ role: 'assistant', text: '좋아요, 어느 부분부터?' }),
      ],
    });
    expect(prompt).toMatch(/1\. \[user\].*이대리 봇 개선해줘/);
    expect(prompt).toMatch(/2\. \[assistant\].*좋아요, 어느 부분부터\?/);
  });

  it('user turn 의 agentType 이 있으면 worker tag 노출 (지시대명사 해석 hint)', () => {
    const prompt = buildPrompt({
      text: '다시 해줘',
      priorTurns: [
        baseTurn({
          role: 'user',
          text: '오늘 plan 만들어줘',
          agentType: AgentType.PM,
        }),
      ],
    });
    expect(prompt).toMatch(/\[user\] \(worker=PM\) 오늘 plan/);
  });

  it('assistant turn 에는 worker tag 안 붙음 (라벨이 이미 [assistant] 라 중복 회피)', () => {
    const prompt = buildPrompt({
      text: '?',
      priorTurns: [
        baseTurn({
          role: 'assistant',
          text: '봇 응답',
          agentType: AgentType.PM,
        }),
      ],
    });
    expect(prompt).toMatch(/\[assistant\] 봇 응답/);
    expect(prompt).not.toMatch(/\[assistant\] \(worker=/);
  });

  it('role 미설정 (legacy entry) 은 user 로 안전 처리', () => {
    const legacyTurn = {
      text: '레거시 메시지',
      agentType: null,
      agentRunId: null,
      timestampMs: 1_700_000_000_000,
    } as ConversationTurn;
    const prompt = buildPrompt({ text: '?', priorTurns: [legacyTurn] });
    expect(prompt).toMatch(/\[user\].*레거시 메시지/);
    expect(prompt).not.toContain('[assistant] 레거시');
  });

  it('최근 5 turn 만 포함 (prompt 폭증 방지)', () => {
    const turns = Array.from({ length: 8 }, (_, idx) =>
      baseTurn({ text: `turn-${idx + 1}` }),
    );
    const prompt = buildPrompt({ text: '?', priorTurns: turns });
    expect(prompt).not.toContain('turn-1');
    expect(prompt).not.toContain('turn-2');
    expect(prompt).not.toContain('turn-3');
    expect(prompt).toContain('turn-4');
    expect(prompt).toContain('turn-8');
  });

  it('1500자 초과 turn 은 truncate (cost 통제)', () => {
    const longText = 'a'.repeat(1600);
    const prompt = buildPrompt({
      text: '?',
      priorTurns: [baseTurn({ text: longText })],
    });
    expect(prompt).toContain('a'.repeat(1500) + '…');
    expect(prompt).not.toContain('a'.repeat(1501));
  });

  it('스레드 원글처럼 긴 직전 글도 뒷부분까지 싣는다 — "이거 뭔데?" 가 가리키는 대상', () => {
    const digest = `원화 공고 피드\n${'공고 줄 '.repeat(100)}\n10. 마지막 공고`;
    const prompt = buildPrompt({
      text: '이거 뭔데?',
      priorTurns: [baseTurn({ text: digest })],
    });
    expect(prompt).toContain('10. 마지막 공고');
  });

  it('직전 [assistant] 발화를 자기 발화로 인식시키되 실행 약속 반복은 금지하는 instruction 이 마지막에 등장', () => {
    const prompt = buildPrompt({
      text: '?',
      priorTurns: [baseTurn({ role: 'assistant', text: '확인해볼게요' })],
    });
    expect(prompt).toMatch(
      /\[assistant\] 라벨이 붙은 이전 응답은 당신 자신의 발화입니다/,
    );
    // 거짓 약속 차단 (2026-07-02) — 마지막 지침은 "약속을 이어가라"가 아니라 "반복하지 마라"여야 한다.
    expect(prompt).toMatch(/실행 약속을 새로 하거나 반복하지 마세요/);
  });
});

// reply() 단위 테스트는 route() 호출 shape / trim / 에러 전파만 검증한다.
// codex→claude fallback 동작 자체의 커버리지는 model-router.usecase.spec.ts
// (primary(CHATGPT) 실패 → CLAUDE 재시도) 에 있다 — 여기서 mock route() 로 재검증하면 중복.
describe('ConversationalReply — reply() (route(PM) 경유 호출)', () => {
  const buildConfigService = (): ConfigService =>
    ({
      get: jest.fn().mockReturnValue('JSL107/personal_agents'),
    }) as unknown as ConfigService;

  it('라우터가 남긴 ROUTER run 이 있으면 답을 그 행에 붙이고, 없으면 붙이지 않는다', async () => {
    const route = jest.fn().mockResolvedValue({ text: ' 답 ', modelUsed: 'm' });
    const attachModelResponse = jest.fn().mockResolvedValue(undefined);
    const usecase = new ConversationalReplyUsecase(
      { route } as unknown as ModelRouterUsecase,
      buildConfigService(),
      [] as AgentDispatcher[],
      { attachModelResponse } as unknown as AgentRunService,
    );

    await usecase.reply({
      text: '안녕',
      priorTurns: [],
      routingMissRunId: 8787,
    });
    expect(attachModelResponse).toHaveBeenCalledWith({
      agentRunId: 8787,
      agentType: AgentType.ROUTER,
      modelResponse: '답',
    });

    attachModelResponse.mockClear();
    await usecase.reply({ text: '안녕', priorTurns: [] });
    expect(attachModelResponse).not.toHaveBeenCalled();
  });

  it('CHATGPT(PM) 으로 route() 를 거쳐 호출한다 — 직접 provider 호출이 아니라 fallback chain 을 탄다', async () => {
    const route = jest.fn().mockResolvedValue({
      text: '  안녕하세요, 무엇을 도와드릴까요?  ',
      modelUsed: 'gpt-x',
      provider: ModelProviderName.CHATGPT,
    });
    const modelRouter = { route } as unknown as ModelRouterUsecase;
    const usecase = new ConversationalReplyUsecase(
      modelRouter,
      buildConfigService(),
      [] as AgentDispatcher[],
    );

    await usecase.reply({ text: '안녕', priorTurns: [] });

    expect(route).toHaveBeenCalledTimes(1);
    const arg = route.mock.calls[0][0];
    // PM provider(CHATGPT) 를 1차로 — codex 쿼터 소진 시 route() 가 CLAUDE 로 자동 fallback.
    expect(arg.agentType).toBe(AgentType.PM);
    // 대화용 커스텀 systemPrompt + 사용자 메시지가 그대로 route 로 전달돼야 한다.
    expect(arg.request.systemPrompt).toContain('이대리');
    expect(arg.request.prompt).toContain('안녕');
  });

  it('unresolvedStreak=2이면 방향 전환 system prompt 로 route 한다', async () => {
    const route = jest.fn().mockResolvedValue({
      text: '실행 가능한 방향을 제안할게요.',
      modelUsed: 'gpt-x',
      provider: ModelProviderName.CHATGPT,
    });
    const usecase = new ConversationalReplyUsecase(
      { route } as unknown as ModelRouterUsecase,
      buildConfigService(),
      [] as AgentDispatcher[],
    );

    await usecase.reply({
      text: '그럼 뭘 할 수 있어?',
      priorTurns: [],
      unresolvedStreak: 2,
    });

    const systemPrompt = route.mock.calls[0][0].request.systemPrompt as string;
    expect(systemPrompt).toContain('방향 전환 (최우선)');
    expect(systemPrompt).toContain('질문으로 끝나는 문장을 쓰지 마세요');
    expect(systemPrompt).not.toContain('follow-up 질문으로 끌어주세요');
  });

  it('route() 응답 text 를 trim 해서 반환한다', async () => {
    const route = jest.fn().mockResolvedValue({
      text: '  답변입니다  ',
      modelUsed: 'gpt-x',
      provider: ModelProviderName.CHATGPT,
    });
    const modelRouter = { route } as unknown as ModelRouterUsecase;
    const usecase = new ConversationalReplyUsecase(
      modelRouter,
      buildConfigService(),
      [] as AgentDispatcher[],
    );

    const result = await usecase.reply({ text: '안녕', priorTurns: [] });

    expect(result).toBe('답변입니다');
  });

  it('route() 가 throw 하면 (양방향 fallback 까지 실패) 그대로 전파한다 — 에러를 삼키지 않음', async () => {
    const route = jest
      .fn()
      .mockRejectedValue(new Error('모델 호출 실패 (CHATGPT)'));
    const modelRouter = { route } as unknown as ModelRouterUsecase;
    const usecase = new ConversationalReplyUsecase(
      modelRouter,
      buildConfigService(),
      [] as AgentDispatcher[],
    );

    // RouterMessageHandler 가 이 throw 를 catch 해 사용자 안내로 처리하므로 전파가 보장돼야 한다.
    await expect(
      usecase.reply({ text: '안녕', priorTurns: [] }),
    ).rejects.toThrow('모델 호출 실패 (CHATGPT)');
  });
});

describe('ConversationalReply — 직전 작업 상태', () => {
  const workTurns: ConversationTurn[] = [
    {
      role: 'user',
      text: '대화 맥락 기억에 대해서 공부할래',
      agentType: AgentType.BLOG,
      agentRunId: 0,
      timestampMs: 1_700_000_000_000,
    },
    {
      role: 'assistant',
      text: '📝 블로그 초안 작성을 시작했어요.',
      agentType: AgentType.BLOG,
      agentRunId: 0,
      timestampMs: 1_700_000_000_000,
    },
  ];

  const syncWorkTurns: ConversationTurn[] = [
    {
      role: 'user',
      text: '이 PR 리뷰해줘',
      agentType: AgentType.CODE_REVIEWER,
      agentRunId: 4242,
      timestampMs: 1_700_000_000_000,
    },
    {
      role: 'assistant',
      text: '리뷰 결과 …',
      agentType: AgentType.CODE_REVIEWER,
      agentRunId: 4242,
      timestampMs: 1_700_000_000_000,
    },
  ];

  const buildUsecase = ({
    findRunStatus = jest.fn(),
    findLatestConversationRun = jest.fn(),
  }: {
    findRunStatus?: jest.Mock;
    findLatestConversationRun?: jest.Mock;
  }): { usecase: ConversationalReplyUsecase; route: jest.Mock } => {
    const route = jest.fn().mockResolvedValue({ text: '네', modelUsed: 'm' });
    const usecase = new ConversationalReplyUsecase(
      { route } as unknown as ModelRouterUsecase,
      { get: () => undefined } as unknown as ConfigService,
      [] as unknown as AgentDispatcher[],
      {
        findRunStatus,
        findLatestConversationRun,
      } as unknown as AgentRunService,
    );
    return { usecase, route };
  };

  it('비동기 작업은 이 대화에서 시작된 실행만 찾아 실패와 사유를 싣는다 (run 8886 재현)', async () => {
    const findLatestConversationRun = jest.fn().mockResolvedValue({
      status: 'FAILED',
      failureReason: '프로세스 종료로 중단됨',
    });
    const { usecase, route } = buildUsecase({ findLatestConversationRun });

    await usecase.reply({
      text: '너 작업하고 있어?',
      priorTurns: workTurns,
      conversationKey: 'U1:D1:111.1',
    });

    expect(findLatestConversationRun).toHaveBeenCalledWith({
      agentType: AgentType.BLOG,
      conversationKey: 'U1:D1:111.1',
      startedSince: new Date(1_700_000_000_000 - 5 * 60 * 1000),
    });
    const prompt: string = route.mock.calls[0][0].request.prompt;
    expect(prompt).toContain('[직전 작업 상태 (실제 실행 기록)]');
    expect(prompt).toContain('실패 — 프로세스 종료로 중단됨');
  });

  it('다른 키에서 옮겨 담은 작업 turn 은 그 turn 이 시작된 대화 키로 찾는다', async () => {
    const findLatestConversationRun = jest
      .fn()
      .mockResolvedValue({ status: 'IN_PROGRESS', failureReason: null });
    const { usecase } = buildUsecase({ findLatestConversationRun });

    await usecase.reply({
      text: '너 작업하고 있어?',
      priorTurns: workTurns.map((turn) => ({
        ...turn,
        conversationKey: 'U1:D1',
      })),
      conversationKey: 'U1:D1:111.1',
    });

    expect(findLatestConversationRun).toHaveBeenCalledWith(
      expect.objectContaining({ conversationKey: 'U1:D1' }),
    );
  });

  it('동기 작업은 turn 에 남은 실행 id 로 바로 조회한다 — 대화 키·사용자로 찾지 않는다 (#824 리뷰)', async () => {
    const findRunStatus = jest
      .fn()
      .mockResolvedValue({ status: 'SUCCEEDED', failureReason: null });
    const findLatestConversationRun = jest.fn();
    const { usecase, route } = buildUsecase({
      findRunStatus,
      findLatestConversationRun,
    });

    await usecase.reply({
      text: '아까 그거 끝났어?',
      priorTurns: syncWorkTurns,
      conversationKey: 'U1:C1:222.2',
    });

    expect(findRunStatus).toHaveBeenCalledWith(4242);
    expect(findLatestConversationRun).not.toHaveBeenCalled();
    expect(route.mock.calls[0][0].request.prompt).toContain(': 완료됨');
  });

  it('실행 id 없는 turn 인데 이 대화에서 시작된 실행이 없으면 상태 줄을 싣지 않는다 — 바로 답한 조회를 "기록 없음" 으로 읽히지 않게', async () => {
    const findLatestConversationRun = jest.fn().mockResolvedValue(null);
    const { usecase, route } = buildUsecase({ findLatestConversationRun });

    await usecase.reply({
      text: '너 작업하고 있어?',
      priorTurns: workTurns,
      conversationKey: 'U1:D1:111.1',
    });

    expect(findLatestConversationRun).toHaveBeenCalled();
    expect(route.mock.calls[0][0].request.prompt).not.toContain(
      '[직전 작업 상태',
    );
  });

  it('실행 없이 보류된 요청에 같은 대화의 직전 초안 상태를 붙이지 않는다 — 하한이 직전 답까지 올라간다 (#831 리뷰)', async () => {
    const draftStartedMs = 1_700_000_000_000;
    const draftAckMs = draftStartedMs + 2_000;
    const heldMs = draftStartedMs + 90_000;
    const turns: ConversationTurn[] = [
      {
        role: 'user',
        text: '대화 맥락 기억 블로그 써줘',
        agentType: AgentType.BLOG,
        agentRunId: 0,
        timestampMs: draftAckMs,
      },
      {
        role: 'assistant',
        text: '📝 블로그 초안 작성을 시작했어요.',
        agentType: AgentType.BLOG,
        agentRunId: 0,
        timestampMs: draftAckMs,
      },
      {
        role: 'user',
        text: '이거 3줄 요약할 수 있어?',
        agentType: AgentType.BLOG,
        agentRunId: 0,
        timestampMs: heldMs,
      },
      {
        role: 'assistant',
        text: '블로그 초안을 작성할까요?',
        agentType: AgentType.BLOG,
        agentRunId: 0,
        timestampMs: heldMs,
      },
    ];
    // 저장소처럼 startedSince 이후에 시작한 실행만 돌려준다 — 직전 초안은 90초 전에 실패했다.
    const findLatestConversationRun = jest.fn(
      async ({ startedSince }: { startedSince: Date }) =>
        startedSince.getTime() <= draftStartedMs
          ? { status: 'FAILED', failureReason: 'hermes 실패' }
          : null,
    );
    const { usecase, route } = buildUsecase({ findLatestConversationRun });

    await usecase.reply({
      text: '너 작업하고 있어?',
      priorTurns: turns,
      conversationKey: 'U1:D1',
    });

    expect(findLatestConversationRun).toHaveBeenCalledWith(
      expect.objectContaining({ startedSince: new Date(draftAckMs) }),
    );
    expect(route.mock.calls[0][0].request.prompt).not.toContain(
      '[직전 작업 상태',
    );
  });

  it('대화 키를 모르면 조회하지 않는다', async () => {
    const findRunStatus = jest.fn();
    const findLatestConversationRun = jest.fn();
    const { usecase, route } = buildUsecase({
      findRunStatus,
      findLatestConversationRun,
    });

    await usecase.reply({ text: '안녕', priorTurns: [] });
    await usecase.reply({ text: '너 작업하고 있어?', priorTurns: workTurns });

    expect(findRunStatus).not.toHaveBeenCalled();
    expect(findLatestConversationRun).not.toHaveBeenCalled();
    expect(route.mock.calls[1][0].request.prompt).not.toContain(
      '[직전 작업 상태',
    );
  });

  // 대화 기억은 키당 5 turn 이라 스레드 문답이 쌓이면 블로그 ack 가 먼저 밀려난다.
  it('작업 turn 이 기억 밖으로 밀려났으면 이 대화의 최근 30분 블로그 실행을 원장에서 찾는다', async () => {
    jest.useFakeTimers().setSystemTime(new Date(1_700_000_000_000));
    const findLatestConversationRun = jest
      .fn()
      .mockResolvedValue({ status: 'SUCCEEDED', failureReason: null });
    const { usecase, route } = buildUsecase({ findLatestConversationRun });

    try {
      await usecase.reply({
        text: '너 작업하고 있어?',
        priorTurns: [
          {
            role: 'user',
            text: '너 작업하고 있어?',
            agentType: null,
            agentRunId: null,
            timestampMs: 1_700_000_000_000,
          },
          {
            role: 'assistant',
            text: '아직 쓰고 있어요.',
            agentType: null,
            agentRunId: null,
            timestampMs: 1_700_000_000_000,
          },
        ],
        conversationKey: 'U1:D1:111.1',
      });
    } finally {
      jest.useRealTimers();
    }

    expect(findLatestConversationRun).toHaveBeenCalledWith({
      agentType: AgentType.BLOG,
      conversationKey: 'U1:D1:111.1',
      startedSince: new Date(1_700_000_000_000 - 30 * 60 * 1000),
    });
    expect(route.mock.calls[0][0].request.prompt).toContain('완료됨');
  });

  it('작업 turn 이 없고 이 대화의 실행도 없으면 상태 줄을 싣지 않는다', async () => {
    const findLatestConversationRun = jest.fn().mockResolvedValue(null);
    const { usecase, route } = buildUsecase({ findLatestConversationRun });

    await usecase.reply({
      text: '안녕',
      priorTurns: [],
      conversationKey: 'U1:D1',
    });

    expect(route.mock.calls[0][0].request.prompt).not.toContain(
      '[직전 작업 상태',
    );
  });

  it('조회가 실패해도 답은 나간다 — 상태 줄만 빠진다', async () => {
    const findRunStatus = jest.fn().mockRejectedValue(new Error('db down'));
    const { usecase, route } = buildUsecase({ findRunStatus });

    await expect(
      usecase.reply({
        text: '너 작업하고 있어?',
        priorTurns: syncWorkTurns,
      }),
    ).resolves.toBe('네');
    expect(route.mock.calls[0][0].request.prompt).not.toContain(
      '[직전 작업 상태',
    );
  });

  it('상태별 문구', () => {
    expect(formatWorkStatus('블로그', null)).toContain('실행 기록 없음');
    expect(
      formatWorkStatus('블로그', {
        status: 'IN_PROGRESS',
        failureReason: null,
      }),
    ).toBe('블로그: 지금 진행 중');
    expect(
      formatWorkStatus('블로그', { status: 'SUCCEEDED', failureReason: null }),
    ).toBe('블로그: 완료됨');
  });

  it('상태 줄이 있으면 그것만 근거로 답하라는 규칙이 있고, "대기 중" 을 예로 들지 않는다', () => {
    const prompt = buildSystemPrompt({});
    expect(prompt).toContain(
      '[직전 작업 상태] 가 있으면 그것이 실제 실행 기록',
    );
    expect(prompt).not.toContain('"지금은 대기 중"');
  });

  it('되묻기가 반복된 방향 전환에서도 [직전 작업 상태] 를 우선한다 (#824 리뷰)', () => {
    const prompt = buildSystemPrompt({ unresolvedStreak: 2 });
    expect(prompt).toContain(
      '[직전 작업 상태] 가 있고 사용자가 그 작업의 진행을 물으면, 실행할 수 없다고 하지 말고',
    );
    expect(prompt).toContain(
      '아무 작업도 시작되지 않았음을 솔직히 말하세요. [직전 작업 상태] 가 있으면 그 상태를 따르세요.',
    );
  });
});
