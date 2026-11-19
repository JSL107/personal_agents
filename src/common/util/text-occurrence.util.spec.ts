import { countOccurrences, replaceFirstLiteral } from './text-occurrence.util';

describe('countOccurrences', () => {
  it('문자열의 겹치지 않는 출현 횟수를 센다', () => {
    expect(countOccurrences({ source: 'abc abc ab', text: 'abc' })).toBe(2);
    expect(countOccurrences({ source: 'aaaa', text: 'aa' })).toBe(2);
  });

  it('빈 검색어는 0회로 센다', () => {
    expect(countOccurrences({ source: 'abc', text: '' })).toBe(0);
    expect(countOccurrences({ source: '', text: 'a' })).toBe(0);
  });
});

describe('replaceFirstLiteral', () => {
  it('첫 등장 하나만 바꾼다', () => {
    expect(
      replaceFirstLiteral({ source: 'a-a', text: 'a', replacement: 'b' }),
    ).toBe('b-a');
  });

  it('$& 같은 치환 표기를 글자 그대로 넣는다', () => {
    expect(
      replaceFirstLiteral({
        source: 'x OLD y',
        text: 'OLD',
        replacement: "$& $' $$",
      }),
    ).toBe("x $& $' $$ y");
  });

  it('없으면 원문 그대로', () => {
    expect(
      replaceFirstLiteral({ source: 'abc', text: 'z', replacement: 'y' }),
    ).toBe('abc');
  });
});
