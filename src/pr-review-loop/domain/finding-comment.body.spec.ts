import {
  buildDiffCoverageNote,
  buildFindingCommentBody,
  buildNoFindingsCommentBody,
  buildPartialReviewCommentBody,
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

  it('판단 보류면 "지적 사항 없음" 대신 판단 보류와 이유를 남긴다', () => {
    const body = buildNoFindingsCommentBody(
      '요약',
      '  diff 가\n잘려 핵심 변경을 못 봤다 ',
    );

    expect(body.startsWith(IDAERI_REVIEW_MARKER)).toBe(true);
    expect(body).toContain('판단 보류');
    expect(body).toContain('diff 가 잘려 핵심 변경을 못 봤다');
    expect(body).not.toContain('지적 사항 없음');
    expect(body).not.toContain('찾지 못했습니다');
  });

  it('요약이 비면 인용 줄을 붙이지 않는다', () => {
    expect(buildNoFindingsCommentBody('   ')).not.toContain('>');
  });

  it('잘린 diff 면 커버리지 안내를 끝에 붙이고, 없으면 붙이지 않는다', () => {
    expect(buildNoFindingsCommentBody('요약', undefined, '⚠️ 안내')).toMatch(
      /> 요약\n\n⚠️ 안내$/,
    );
    expect(buildNoFindingsCommentBody('요약', '이유', '⚠️ 안내')).toMatch(
      /\n\n⚠️ 안내$/,
    );
    expect(buildNoFindingsCommentBody('요약', undefined, null)).not.toContain(
      '⚠️',
    );
  });

  it('여러 줄 요약을 한 줄로 눌러 인용한다', () => {
    const body = buildNoFindingsCommentBody('  첫 줄\n\n  둘째 줄  ');

    expect(body).toContain('> 첫 줄 둘째 줄');
    // 인용 부호 뒤로 줄바꿈이 남으면 둘째 줄이 인용 밖으로 새어 나간다.
    expect(body.split('> ')[1]).not.toContain('\n');
  });
});

describe('buildDiffCoverageNote', () => {
  it('잘렸으면 본 바이트/전체 바이트를 적는다 — 한글은 UTF-8 바이트로 센다', () => {
    expect(buildDiffCoverageNote('한글', 120_000)).toContain(
      'diff 6/120,000 바이트만 검토',
    );
  });

  it('안 잘렸으면 null', () => {
    expect(buildDiffCoverageNote('한글', 6)).toBeNull();
  });
});

describe('buildPartialReviewCommentBody', () => {
  it('표식으로 시작하고 안내를 담는다', () => {
    const body = buildPartialReviewCommentBody('⚠️ 안내');

    expect(body.startsWith(IDAERI_REVIEW_MARKER)).toBe(true);
    expect(body).toContain('⚠️ 안내');
  });
});
