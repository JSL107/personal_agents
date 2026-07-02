import { ConfigService } from '@nestjs/config';

import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import {
  AgentType,
  ModelProviderName,
} from '../../model-router/domain/model-router.type';
import { ConversationTurn } from '../domain/conversation-memory.type';
import {
  buildPrompt,
  buildSystemPrompt,
  ConversationalReplyUsecase,
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

  it('repoLabel 미설정 시 generic 동작 환경 안내로 fallback', () => {
    const prompt = buildSystemPrompt({});
    expect(prompt).toContain('단일 GitHub 레포의 backend 봇');
    // 빈 문자열은 미설정과 동일 — falsy 처리
    const prompt2 = buildSystemPrompt({ repoLabel: '', ownerLogin: '' });
    expect(prompt2).toContain('단일 GitHub 레포의 backend 봇');
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

  it('200자 초과 turn 은 truncate (cost 통제)', () => {
    const longText = 'a'.repeat(250);
    const prompt = buildPrompt({
      text: '?',
      priorTurns: [baseTurn({ text: longText })],
    });
    expect(prompt).toContain('a'.repeat(200) + '…');
    expect(prompt).not.toContain('a'.repeat(250));
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
    );

    // RouterMessageHandler 가 이 throw 를 catch 해 사용자 안내로 처리하므로 전파가 보장돼야 한다.
    await expect(
      usecase.reply({ text: '안녕', priorTurns: [] }),
    ).rejects.toThrow('모델 호출 실패 (CHATGPT)');
  });
});
