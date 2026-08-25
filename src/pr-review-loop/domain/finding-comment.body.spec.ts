import {
  buildFindingCommentBody,
  buildNoFindingsCommentBody,
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

describe('buildNoFindingsCommentBody', () => {
  it('표식으로 시작한다 — 수확기가 답글 필터에서 자기 글로 걸러내는 조건이다', () => {
    expect(buildNoFindingsCommentBody('요약')).toContain(IDAERI_REVIEW_MARKER);
    expect(
      buildNoFindingsCommentBody('요약').startsWith(IDAERI_REVIEW_MARKER),
    ).toBe(true);
  });

  it('요약이 비면 인용 줄을 붙이지 않는다', () => {
    expect(buildNoFindingsCommentBody('   ')).not.toContain('>');
  });

  it('여러 줄 요약을 한 줄로 눌러 인용한다', () => {
    const body = buildNoFindingsCommentBody('  첫 줄\n\n  둘째 줄  ');

    expect(body).toContain('> 첫 줄 둘째 줄');
    // 인용 부호 뒤로 줄바꿈이 남으면 둘째 줄이 인용 밖으로 새어 나간다.
    expect(body.split('> ')[1]).not.toContain('\n');
  });
});
