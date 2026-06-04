import { detectYesNoIntent } from './yes-no-detector';

describe('detectYesNoIntent', () => {
  describe('YES — 단일 키워드', () => {
    it.each([
      '응',
      '예',
      '네',
      '좋아',
      'ㄱㄱ',
      '진행',
      '해줘',
      'ok',
      'yes',
      'y',
    ])('"%s" → yes', (input) => {
      expect(detectYesNoIntent(input)).toBe('yes');
    });
  });

  describe('NO — 단일 키워드', () => {
    it.each(['아니', '싫어', '취소', 'ㄴㄴ', 'no', 'cancel', 'nope'])(
      '"%s" → no',
      (input) => {
        expect(detectYesNoIntent(input)).toBe('no');
      },
    );
  });

  describe('normalize — 문장부호 / 대소문자', () => {
    it('"YES!" / "yes." / "Yes" 모두 yes', () => {
      expect(detectYesNoIntent('YES!')).toBe('yes');
      expect(detectYesNoIntent('yes.')).toBe('yes');
      expect(detectYesNoIntent('Yes')).toBe('yes');
    });

    it('"아니!!" / "아니." → no', () => {
      expect(detectYesNoIntent('아니!!')).toBe('no');
      expect(detectYesNoIntent('아니.')).toBe('no');
    });
  });

  describe('다중 토큰 — 모두 같은 set 일 때만', () => {
    it('"응 ㄱㄱ" → yes', () => {
      expect(detectYesNoIntent('응 ㄱㄱ')).toBe('yes');
    });

    it('"아니 ㄴㄴ" → no', () => {
      expect(detectYesNoIntent('아니 ㄴㄴ')).toBe('no');
    });

    it('"응 그리고 더 해줘" → null (4토큰 + "그리고" 미인식)', () => {
      expect(detectYesNoIntent('응 그리고 더 해줘')).toBeNull();
    });
  });

  describe('ambiguous — null 반환 (일반 dispatch 진행)', () => {
    it('빈 입력 → null', () => {
      expect(detectYesNoIntent('')).toBeNull();
      expect(detectYesNoIntent('   ')).toBeNull();
    });

    it('너무 긴 입력 (15자 초과) → null', () => {
      expect(detectYesNoIntent('응 그건 좀 다르게 진행해 주실래요')).toBeNull();
    });

    it('Y/N 키워드와 무관한 입력 → null', () => {
      expect(detectYesNoIntent('오늘 plan 짜줘')).toBeNull();
      expect(detectYesNoIntent('PR #34 리뷰해줘')).toBeNull();
    });

    it('YES + NO 혼합 → null (모순)', () => {
      expect(detectYesNoIntent('응 아니')).toBeNull();
    });
  });
});
