import { parseTopicSelection } from './topic-selection-detector';

describe('parseTopicSelection', () => {
  it('"2" → 2 (1-based, 범위 내)', () => {
    expect(parseTopicSelection('2', 3)).toBe(2);
  });
  it('"2번" / "2번으로" → 2', () => {
    expect(parseTopicSelection('2번', 3)).toBe(2);
    expect(parseTopicSelection('2번으로 써줘', 3)).toBe(2);
  });
  it('범위 밖(0, 4)이면 null', () => {
    expect(parseTopicSelection('0', 3)).toBeNull();
    expect(parseTopicSelection('4', 3)).toBeNull();
  });
  it('숫자 없으면 null', () => {
    expect(parseTopicSelection('아무거나', 3)).toBeNull();
  });
  it('너무 긴 문장이면 null (오탐 방지)', () => {
    expect(
      parseTopicSelection(
        '2번 주제도 좋은데 사실 전체적으로 다시 고민해보면 어떨까 싶어요 길게',
        3,
      ),
    ).toBeNull();
  });
});
