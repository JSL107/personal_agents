import {
  buildPrompt,
  buildSystemPrompt,
} from './conversational-reply.usecase';
import { AgentType } from '../../model-router/domain/model-router.type';
import { ConversationTurn } from '../domain/conversation-memory.type';

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
    expect(prompt).toMatch(/다시 "어느 repo 인가요\?" 처럼 묻지 마세요/);
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
        baseTurn({ role: 'user', text: '오늘 plan 만들어줘', agentType: AgentType.PM }),
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

  it('직전 [assistant] 발화가 약속이라는 사실을 강조하는 instruction 이 마지막에 등장', () => {
    const prompt = buildPrompt({
      text: '?',
      priorTurns: [baseTurn({ role: 'assistant', text: '확인해볼게요' })],
    });
    expect(prompt).toMatch(
      /\[assistant\] 라벨이 붙은 이전 응답은 당신 자신의 발화입니다/,
    );
  });
});
