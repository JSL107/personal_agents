import {
  DailyReview,
  NO_DECISIONS_TEXT,
  NO_RISKS_TEXT,
} from '../../agent/work-reviewer/domain/work-reviewer.type';
import { formatDailyReview } from './daily-review.formatter';

const base: DailyReview = {
  summary: '오늘의 작업 요약',
  impact: {
    quantitative: ['PR 2건 머지', '버그 1건 수정'],
    qualitative: '코드 품질 개선',
  },
  improvementBeforeAfter: { before: '수동 배포', after: '자동 배포' },
  decisions: [],
  risks: [],
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

  it('결정사항·위험이 있으면 각각 별도 섹션으로 나온다', () => {
    const { detail } = formatDailyReview({
      ...base,
      decisions: ['캐시 도입 vs 쿼리 정리 중 착수 대상 선택'],
      risks: ['머지 3건 중 1건이 실 환경 미검증'],
    });
    expect(detail).toContain('*대표 결정사항*');
    expect(detail).toContain('• 캐시 도입 vs 쿼리 정리 중 착수 대상 선택');
    expect(detail).toContain('*위험*');
    expect(detail).toContain('• 머지 3건 중 1건이 실 환경 미검증');
  });

  it('결정사항·위험이 비면 섹션을 지우지 않고 명시적 부정으로 채운다', () => {
    const { detail } = formatDailyReview(base);
    expect(detail).toContain(`*대표 결정사항*\n${NO_DECISIONS_TEXT}`);
    expect(detail).toContain(`*위험*\n${NO_RISKS_TEXT}`);
  });

  it('미검토(두 필드 도입 전 회고)면 섹션 자체를 내지 않는다', () => {
    const legacy: DailyReview = { ...base };
    delete legacy.decisions;
    delete legacy.risks;
    const { detail } = formatDailyReview(legacy);
    expect(detail).not.toContain('대표 결정사항');
    expect(detail).not.toContain('위험');
  });
});
