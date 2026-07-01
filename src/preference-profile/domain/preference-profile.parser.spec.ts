import { applyDiff, parseProfile } from './preference-profile.parser';
import { EMPTY_PROFILE, PreferenceProfile } from './preference-profile.type';

describe('parseProfile', () => {
  it('비객체/누락 필드는 EMPTY_PROFILE 로 안전 복구', () => {
    expect(parseProfile(null)).toEqual(EMPTY_PROFILE);
    expect(parseProfile({ tone: 'not-array' })).toEqual(EMPTY_PROFILE);
  });

  it('유효 필드만 통과시키고 잘못된 verbosity 값은 drop', () => {
    const parsed = parseProfile({
      tone: ['간결', 42],
      verbosity: { briefing: 'terse', plan: 'wrong' },
      doNot: ['이모지 남발 금지'],
    });
    expect(parsed.tone).toEqual(['간결']);
    expect(parsed.verbosity).toEqual({ briefing: 'terse' });
    expect(parsed.doNot).toEqual(['이모지 남발 금지']);
  });
});

describe('applyDiff', () => {
  it('add 는 중복 없이 추가, remove 는 제거', () => {
    const base: PreferenceProfile = {
      ...EMPTY_PROFILE,
      tone: ['간결'],
      doNot: ['이모지 남발 금지'],
    };
    const next = applyDiff(base, {
      tone: { add: ['간결', '단정적'] },
      doNot: { remove: ['이모지 남발 금지'] },
    });
    expect(next.tone).toEqual(['간결', '단정적']);
    expect(next.doNot).toEqual([]);
  });

  it('verbosity 는 덮어쓰기, routingHints 는 phrase 로 remove', () => {
    const base: PreferenceProfile = {
      ...EMPTY_PROFILE,
      verbosity: { briefing: 'detailed' },
      routingHints: [{ phrase: '그거', intent: 'ASSIGN' }],
    };
    const next = applyDiff(base, {
      verbosity: { briefing: 'terse' },
      routingHints: { remove: ['그거'] },
    });
    expect(next.verbosity.briefing).toBe('terse');
    expect(next.routingHints).toEqual([]);
  });
});
