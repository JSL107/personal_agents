import {
  RiskMap,
  RiskMapFile,
  RiskMapLevel,
} from '../../agent/code-reviewer/domain/risk-map';
import { IDAERI_REVIEW_MARKER } from './finding-comment.body';

// 위험 지도 코멘트를 PR 당 하나로 유지하는 표식. 본문 끝에 숨겨 두고 이것으로 기존 코멘트를 찾는다.
export const RISK_MAP_COMMENT_TAG = '<!-- idaeri-risk-map -->';

// pass 를 "통과 가능" 으로 단정하지 않는다 — 경로·크기만 보는 점수라 인증 우회 수정 같은 의미상
// 위험은 못 본다(표본 sbe-api-v5#1237 이 18점). 의미 판단은 같은 회차의 인라인 리뷰가 맡는다.
const LEVEL_LABEL: Record<RiskMapLevel, string> = {
  pass: '✅ 위험 신호 적음',
  quick: '👀 가볍게 확인',
  careful: '⚠️ 꼼꼼히 확인',
};

// 경로는 PR 작성자가 정하는 값이다 — 표 칸과 코드 스팬을 깨는 문자, 경로를 뒤집어 보이게 하는
// 양방향 제어문자(U+202A–202E, U+2066–2069)를 걷어낸다.
const cell = (text: string): string =>
  text.replace(/[`|\r\n\u202A-\u202E\u2066-\u2069]/g, ' ');

const findingCell = (file: RiskMapFile): string => {
  if (file.findingCount === 0) {
    return '-';
  }
  const mustFix =
    file.mustFixCount > 0 ? ` (머지 전 필수 ${file.mustFixCount})` : '';
  return `${file.findingCount}건${mustFix}`;
};

// 위험 지도는 결정론 점수라 👍/👎 로 학습할 대상이 아니다. 수확기는 리뷰 스레드(인라인)만 읽어
// 일반 코멘트인 이 글을 보지 않고, 마커로 시작하니 스레드로 옮겨져도 자기 글 필터에 걸린다.
export const buildRiskMapCommentBody = (map: RiskMap): string => {
  const lines = [
    `${IDAERI_REVIEW_MARKER} · 위험 지도`,
    '',
    `**${LEVEL_LABEL[map.level]}** · 위험 점수 ${map.score}/100`,
    ...map.levelReasons.map((reason) => `- ${reason}`),
  ];

  if (map.startHere.length > 0) {
    lines.push(
      '',
      '**여기부터 보세요**',
      '',
      '| 파일 | 점수 | 이유 | 이대리 지적 |',
      '|---|---|---|---|',
      ...map.startHere.map(
        (file) =>
          `| \`${cell(file.path)}\` | ${file.points} | ${cell(file.reasons.join(' · '))} | ${findingCell(file)} |`,
      ),
    );
  }
  if (map.skimCount > 0) {
    lines.push(
      '',
      `나머지 ${map.skimCount}개 파일은 훑어봐도 됩니다(파일 점수 낮음).`,
    );
  }
  if (map.notes.length > 0) {
    lines.push('', ...map.notes.map((note) => `> ${note}`));
  }
  lines.push(
    '',
    '<sub>파일 경로·diff 만으로 계산한 점수라 같은 PR 이면 같은 점수가 나옵니다. 이 코드를 실행하는 화면·API(도달 범위)는 보지 않습니다. 점수 방식은 Farol(MIT)을 참고했습니다.</sub>',
    RISK_MAP_COMMENT_TAG,
  );
  return lines.join('\n');
};
