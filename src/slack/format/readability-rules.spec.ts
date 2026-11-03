import { findReadabilityViolations } from './readability-rules';

describe('findReadabilityViolations', () => {
  it('본문 줄표를 잡는다', () => {
    expect(findReadabilityViolations('PO 검토 — 계획')).toEqual(['—']);
  });
  it('코드 블록·인라인 코드·URL 안의 줄표는 넘긴다', () => {
    expect(findReadabilityViolations('```a — b```')).toEqual([]);
    expect(findReadabilityViolations('`a — b`')).toEqual([]);
    expect(findReadabilityViolations('https://x/a—b')).toEqual([]);
  });
  it('글자 없는 #번호를 잡는다', () => {
    expect(findReadabilityViolations('#4746·#1520 검증')).toEqual([
      '#4746',
      '#1520',
    ]);
    expect(findReadabilityViolations('<https://x/pull/1|#1520>')).toEqual([
      '#1520',
    ]);
  });
  it('이름 뒤 번호와 이름 링크는 허용한다', () => {
    expect(findReadabilityViolations('첨부 오류(#4746)')).toEqual([]);
    expect(
      findReadabilityViolations('<https://x/pull/1|첨부 오류 고치기>'),
    ).toEqual([]);
  });
  it('영어 라벨과 모델 푸터를 잡는다', () => {
    expect(findReadabilityViolations('Before: x After: y')).toEqual([
      'Before:',
      'After:',
    ]);
    expect(findReadabilityViolations('*Daily Eval* Wins 3')).toEqual([
      'Daily Eval',
      'Wins',
    ]);
    expect(
      findReadabilityViolations('_model: codex-cli · run #11198_'),
    ).toEqual(['run #11198', 'codex-cli']);
  });
});
