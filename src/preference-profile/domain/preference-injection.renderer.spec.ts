import { renderInjectionBlock } from './preference-injection.renderer';
import { EMPTY_PROFILE, PreferenceProfile } from './preference-profile.type';

describe('renderInjectionBlock', () => {
  it('빈 프로필은 빈 문자열 (동작 변화 0)', () => {
    expect(renderInjectionBlock(EMPTY_PROFILE, 'briefing')).toBe('');
    expect(renderInjectionBlock(EMPTY_PROFILE, 'humanize')).toBe('');
    expect(renderInjectionBlock(EMPTY_PROFILE, 'plan')).toBe('');
    expect(renderInjectionBlock(EMPTY_PROFILE, 'routing')).toBe('');
  });

  it('plan 섹션은 우선순위(priorities)를 먼저, verbosity.plan 을 반영', () => {
    const profile: PreferenceProfile = {
      ...EMPTY_PROFILE,
      tone: ['단정적'],
      priorities: ['버그 우선', '리팩터링 후순위'],
      verbosity: { plan: 'terse', briefing: 'detailed' },
      doNot: ['장황한 설명 금지'],
    };
    const block = renderInjectionBlock(profile, 'plan');
    expect(block).toContain('버그 우선');
    expect(block).toContain('리팩터링 후순위');
    expect(block).toContain('단정적');
    expect(block).toContain('terse');
    expect(block).toContain('장황한 설명 금지');
    // plan 분량만 — briefing 분량(detailed)은 누출 안 됨
    expect(block).not.toContain('detailed');
  });

  it('plan 섹션은 priorities 만 있어도 렌더(문체 비어도)', () => {
    const profile: PreferenceProfile = {
      ...EMPTY_PROFILE,
      priorities: ['보안 최우선'],
    };
    const block = renderInjectionBlock(profile, 'plan');
    expect(block).toContain('보안 최우선');
  });

  it('briefing 섹션은 tone/verbosity.briefing/doNot 만 포함', () => {
    const profile: PreferenceProfile = {
      ...EMPTY_PROFILE,
      tone: ['간결', '단정적'],
      verbosity: { briefing: 'terse', humanize: 'detailed' },
      doNot: ['이모지 3개 이상 금지'],
    };
    const block = renderInjectionBlock(profile, 'briefing');
    expect(block).toContain('간결');
    expect(block).toContain('terse');
    expect(block).toContain('이모지 3개 이상 금지');
    expect(block).not.toContain('detailed'); // humanize 상세도는 briefing 에 누출 안 됨
  });

  it('routing 섹션은 routingHints 만 렌더', () => {
    const profile: PreferenceProfile = {
      ...EMPTY_PROFILE,
      routingHints: [{ phrase: '그거 분배', intent: 'CTO' }],
    };
    const block = renderInjectionBlock(profile, 'routing');
    expect(block).toContain('그거 분배');
    expect(block).toContain('CTO');
  });
});
