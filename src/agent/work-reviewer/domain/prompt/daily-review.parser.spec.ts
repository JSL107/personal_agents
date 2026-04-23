import { WorkReviewerException } from '../work-reviewer.exception';
import { DailyReview } from '../work-reviewer.type';
import { parseDailyReview } from './daily-review.parser';

describe('parseDailyReview', () => {
  const validReview: DailyReview = {
    summary: 'PM Agent 구현 마무리와 codex 어댑터 격리 작업',
    impact: {
      quantitative: ['unit test +8건', 'CLI 환경 격리 범위 +3항목'],
      qualitative: 'prompt-injection 리스크 제거로 운영 신뢰도 상승',
    },
    improvementBeforeAfter: {
      before: '자식 CLI 가 parent env/HOME 상속 → .env 노출 가능',
      after: 'throwaway HOME + env allowlist + stdin prompt 로 격리',
    },
    nextActions: ['Work Reviewer 유스케이스 구현', 'E2E 검증 문서화'],
    oneLineAchievement: 'codex 어댑터 격리로 Slack 입력 기반 secret 유출 차단',
  };

  it('순수 JSON 문자열을 DailyReview 로 파싱한다', () => {
    const result = parseDailyReview(JSON.stringify(validReview));
    expect(result).toEqual(validReview);
  });

  it('```json 코드 펜스 감싼 응답도 벗겨낸 뒤 파싱한다', () => {
    const wrapped = ['```json', JSON.stringify(validReview), '```'].join('\n');
    expect(parseDailyReview(wrapped)).toEqual(validReview);
  });

  it('improvementBeforeAfter 가 null 이어도 유효하다', () => {
    const r = { ...validReview, improvementBeforeAfter: null };
    expect(parseDailyReview(JSON.stringify(r))).toEqual(r);
  });

  it('impact.quantitative 가 비어있어도 유효하다 (정량 근거 부족 케이스)', () => {
    const r = {
      ...validReview,
      impact: {
        quantitative: [],
        qualitative: '정량 근거 부족으로 임팩트는 추정 수준',
      },
    };
    expect(parseDailyReview(JSON.stringify(r))).toEqual(r);
  });

  it('JSON 으로 파싱 불가하면 INVALID_MODEL_OUTPUT 예외', () => {
    expect(() => parseDailyReview('not json')).toThrow(WorkReviewerException);
  });

  it('summary 누락 시 예외', () => {
    const broken = { ...validReview } as Partial<typeof validReview>;
    delete broken.summary;
    expect(() => parseDailyReview(JSON.stringify(broken))).toThrow(
      WorkReviewerException,
    );
  });

  it('impact.quantitative 가 문자열 배열이 아닐 때 예외', () => {
    const broken = {
      ...validReview,
      impact: { quantitative: [1, 2], qualitative: 'x' },
    };
    expect(() => parseDailyReview(JSON.stringify(broken))).toThrow(
      WorkReviewerException,
    );
  });

  it('improvementBeforeAfter 가 null 도 객체도 아니면 예외', () => {
    const broken = { ...validReview, improvementBeforeAfter: 'wrong' };
    expect(() => parseDailyReview(JSON.stringify(broken))).toThrow(
      WorkReviewerException,
    );
  });
});
