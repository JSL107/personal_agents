import {
  buildFindingCommentBody,
  IDAERI_REVIEW_MARKER,
} from './finding-comment.body';

describe('buildFindingCommentBody', () => {
  it('카테고리·심각도 표식 뒤에 trim한 원문을 그대로 붙인다', () => {
    const body = buildFindingCommentBody({
      category: 'RELIABILITY',
      severity: 'MUST_FIX',
      body: '  첫 줄\n둘째 줄  ',
    });

    expect(body).toBe(
      `${IDAERI_REVIEW_MARKER} · RELIABILITY / MUST_FIX\n\n첫 줄\n둘째 줄`,
    );
  });
});
