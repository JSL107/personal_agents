import { countOccurrences } from './text-occurrence.util';

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
