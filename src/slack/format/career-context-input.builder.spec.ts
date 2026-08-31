import {
  CAREER_CONTEXT_MAX_LENGTH,
  normalizeImpactContext,
  parseCareerContextBlockId,
} from './career-context-input.builder';

describe('parseCareerContextBlockId', () => {
  it('입력칸 block_id 에서 previewId 와 묶음 index 를 복원한다', () => {
    expect(parseCareerContextBlockId('career-context:prv-1:2')).toEqual({
      previewId: 'prv-1',
      index: 2,
    });
  });

  it('다른 블록의 이벤트는 null (분배 드롭다운·승인 버튼 등)', () => {
    expect(parseCareerContextBlockId(null)).toBeNull();
    expect(parseCareerContextBlockId('assignment-worker:prv-1:0')).toBeNull();
    expect(parseCareerContextBlockId('preview-actions:prv-1')).toBeNull();
    expect(parseCareerContextBlockId('career-context:prv-1')).toBeNull();
    expect(parseCareerContextBlockId('career-context::0')).toBeNull();
    expect(parseCareerContextBlockId('career-context:prv-1:x')).toBeNull();
    expect(parseCareerContextBlockId('career-context:prv-1:-1')).toBeNull();
  });
});

describe('normalizeImpactContext — 프롬프트로 들어갈 문자열 정규화', () => {
  it('앞뒤 공백을 떼어낸다', () => {
    expect(normalizeImpactContext('  결제 실패율 3%→0.5%  ')).toBe(
      '결제 실패율 3%→0.5%',
    );
  });

  it('상한을 넘는 붙여넣기는 잘라낸다 (max_length 는 클라이언트 값일 뿐)', () => {
    const pasted = '가'.repeat(CAREER_CONTEXT_MAX_LENGTH + 500);
    expect(normalizeImpactContext(pasted)).toHaveLength(
      CAREER_CONTEXT_MAX_LENGTH,
    );
  });
});
