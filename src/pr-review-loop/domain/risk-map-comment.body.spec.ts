import { RiskMap } from '../../agent/code-reviewer/domain/risk-map';
import { IDAERI_REVIEW_MARKER } from './finding-comment.body';
import {
  buildRiskMapCommentBody,
  RISK_MAP_COMMENT_TAG,
} from './risk-map-comment.body';

const baseMap: RiskMap = {
  level: 'quick',
  score: 31,
  levelReasons: ['위험 점수 31/100', 'DB 스키마·마이그레이션 변경'],
  startHere: [
    {
      path: 'prisma/schema.prisma',
      role: 'schema',
      points: 35,
      reasons: ['DB 스키마·마이그레이션 변경 — 데이터 유실·배포 순서 확인'],
      findingCount: 2,
      mustFixCount: 1,
    },
  ],
  skimCount: 3,
  notes: [],
};

describe('buildRiskMapCommentBody', () => {
  it('마커로 시작하고 숨은 표식으로 끝난다', () => {
    const body = buildRiskMapCommentBody(baseMap);

    expect(body.startsWith(`${IDAERI_REVIEW_MARKER} · 위험 지도`)).toBe(true);
    expect(body.endsWith(RISK_MAP_COMMENT_TAG)).toBe(true);
  });

  it('등급·점수·사유와 파일 표를 싣는다', () => {
    const body = buildRiskMapCommentBody(baseMap);

    expect(body).toContain('**👀 가볍게 확인** · 위험 점수 31/100');
    expect(body).toContain('- DB 스키마·마이그레이션 변경');
    expect(body).toContain(
      '| `prisma/schema.prisma` | 35 | DB 스키마·마이그레이션 변경 — 데이터 유실·배포 순서 확인 | 2건 (머지 전 필수 1) |',
    );
    expect(body).toContain(
      '나머지 3개 파일은 훑어봐도 됩니다(파일 점수 낮음).',
    );
  });

  it('표를 깨는 문자가 든 경로는 걷어낸다', () => {
    const body = buildRiskMapCommentBody({
      ...baseMap,
      startHere: [
        { ...baseMap.startHere[0], path: 'src/a|b`c.ts', findingCount: 0 },
      ],
    });

    expect(body).toContain('| `src/a b c.ts` | 35 |');
    expect(body).toContain('| - |');
  });

  it('목록이 비면 표를 빼고, 못 본 범위는 인용으로 적는다', () => {
    const body = buildRiskMapCommentBody({
      ...baseMap,
      startHere: [],
      skimCount: 0,
      notes: ['변경 파일 400개 중 300개만 분석했습니다.'],
    });

    expect(body).not.toContain('여기부터 보세요');
    expect(body).not.toContain('나머지');
    expect(body).toContain('> 변경 파일 400개 중 300개만 분석했습니다.');
  });
});
