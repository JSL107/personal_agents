import {
  findMatchedTerms,
  findStyleTags,
  normalizeKeywordTerm,
  validateKeywordTerm,
} from './art-job-keyword';

describe('art job keywords', () => {
  it('normalizes whitespace and rejects unsafe terms', () => {
    expect(normalizeKeywordTerm('  북미풍   캐주얼  ')).toBe('북미풍 캐주얼');
    expect(validateKeywordTerm('  원화 ')).toBeNull();
    expect(validateKeywordTerm('  ')).not.toBeNull();
    expect(validateKeywordTerm('a'.repeat(21))).not.toBeNull();
    expect(validateKeywordTerm('원화\n개발')).not.toBeNull();
    expect(validateKeywordTerm('<@U123>')).not.toBeNull();
  });

  it('matches ASCII words at letter boundaries and other terms as substrings', () => {
    expect(
      findMatchedTerms(['UI', 'GUI', 'UX'], 'Game GUI 디자이너, UI/UX'),
    ).toEqual(['UI', 'GUI', 'UX']);
    expect(findMatchedTerms(['UI'], 'GUI')).toEqual([]);
    expect(findMatchedTerms(['3D'], '3D모델러')).toEqual(['3D']);
    expect(findMatchedTerms(['아트'], '픽셀아트워크')).toEqual(['아트']);
    expect(findMatchedTerms(['a+b', 'A+B'], 'A+B')).toEqual(['a+b']);
  });
});

describe('findStyleTags', () => {
  it('영문 장르 표기(Casual)도 등록한 표기로 태그한다', () => {
    expect(
      findStyleTags(['북미풍', '캐주얼'], '게임분야: 모바일게임 RPG, Casual'),
    ).toEqual(['캐주얼']);
  });

  it('서브컬처·서브컬쳐 표기를 같은 말로 본다', () => {
    expect(findStyleTags(['서브컬처'], '서브컬쳐 스타일 배경 원화')).toEqual([
      '서브컬처',
    ]);
  });

  it.each([
    ['Casual', '2D 캐주얼 게임 그래픽'],
    ['casual', '게임분야: RPG, Casual'],
    ['Subculture', '서브컬처 스타일 원화'],
    ['서브컬쳐', '장르: Subculture'],
  ])(
    '%s 로 등록해도 다른 표기(%s)를 잡고 등록한 표기로 태그한다',
    (term, text) => {
      expect(findStyleTags([term], text)).toEqual([term]);
    },
  );

  it('영문 표기는 단어 경계로만 맞춘다', () => {
    expect(findStyleTags(['캐주얼'], 'Casualty Studio')).toEqual([]);
  });
});
