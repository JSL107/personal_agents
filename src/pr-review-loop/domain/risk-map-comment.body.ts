import { START_HERE_MAX } from '../../agent/code-reviewer/domain/risk-map';
import {
  RiskMap,
  RiskMapFile,
  RiskMapLevel,
} from '../../agent/code-reviewer/domain/risk-map.type';
import { IDAERI_REVIEW_MARKER } from './finding-comment.body';

// 위험 지도 코멘트를 PR 당 하나로 유지하는 표식. 본문 끝에 숨겨 두고 이것으로 기존 코멘트를 찾는다.
export const RISK_MAP_COMMENT_TAG = '<!-- idaeri-risk-map -->';

// 최하 등급을 "통과 가능" 으로 단정하지 않는다 — 경로·크기만 보는 점수라 의미상 위험(인증 우회 수정 등)은 못 본다.
const LEVEL_LABEL: Record<RiskMapLevel, string> = {
  [RiskMapLevel.PASS]: '✅ 위험 신호 적음',
  [RiskMapLevel.QUICK]: '👀 가볍게 확인',
  [RiskMapLevel.CAREFUL]: '⚠️ 꼼꼼히 확인',
};

// 경로는 PR 작성자가 정하는 값이라 표·코드 스팬을 깨는 문자와 양방향 제어문자를 걷어낸다.
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

// 마커로 시작해 수확기의 자기 글 필터에 걸린다 — 결정론 점수라 👍/👎 학습 대상이 아니다.
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
  if (map.overflowCount > 0) {
    lines.push(
      '',
      `점수 기준을 넘었지만 목록 상한(${START_HERE_MAX}개) 밖인 파일이 ${map.overflowCount}개 더 있습니다.`,
    );
  }
  if (map.lowCount > 0) {
    lines.push(
      '',
      `나머지 ${map.lowCount}개 파일은 점수가 낮아 훑어봐도 됩니다.`,
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
