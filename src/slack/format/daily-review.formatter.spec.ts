import { DailyReview } from '../../agent/work-reviewer/domain/work-reviewer.type';
import { formatDailyReview } from './daily-review.formatter';

const base: DailyReview = {
  summary: '오늘의 작업 요약',
  impact: {
    quantitative: ['PR 2건 머지', '버그 1건 수정'],
    qualitative: '코드 품질 개선',
  },
  improvementBeforeAfter: { before: '수동 배포', after: '자동 배포' },
  nextActions: ['리뷰 요청', '문서 업데이트'],
  oneLineAchievement: '배포 자동화 완료',
};

describe('formatDailyReview', () => {
  it('summary 에 오늘 한 일 헤더·review.summary·한 줄 성과가 담긴다', () => {
    const { summary } = formatDailyReview(base);
    expect(summary).toContain('*오늘 한 일*');
    expect(summary).toContain('오늘의 작업 요약');
    expect(summary).toContain('배포 자동화 완료');
  });

  it('detail 에 정량 근거·질적 영향·개선 전후·다음 액션 전체가 담긴다', () => {
    const { detail } = formatDailyReview(base);
    expect(detail).toContain('PR 2건 머지');
    expect(detail).toContain('버그 1건 수정');
    expect(detail).toContain('코드 품질 개선');
    expect(detail).toContain('수동 배포');
    expect(detail).toContain('자동 배포');
    expect(detail).toContain('리뷰 요청');
    expect(detail).toContain('문서 업데이트');
  });
});
