import { injectInstructionForPr } from './inject-instruction';

describe('injectInstructionForPr', () => {
  it('prRef 를 담은 리뷰 지시문 생성', () => {
    const text = injectInstructionForPr('octo/repo#42');

    expect(text).toContain('octo/repo#42');
    expect(text.length).toBeGreaterThan(0);
  });
});
