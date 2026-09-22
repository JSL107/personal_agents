import { countKstDaysBetween } from '../../../../common/util/kst-date.util';
import {
  EveningRetroReflection,
  normalizeReflectionColumn,
  REFLECTION_COLUMNS,
} from '../../../blog/domain/prompt/evening-retro.prompt';

// 회고 한 칸의 상한. 저녁 프롬프트가 "60자 안에서 끝내라" 고 지시하지만 그것은 모델이 지킨
// 회차에만 지켜진다. 상한이 없으면 폭주한 한 칸이 — 특히 TRIM_ORDER 맨 끝이라 마지막까지
// 살아남는 carryOver 가 — 앞의 섹션을 전부 밀어낸 뒤 프롬프트 꼬리까지 자른다.
const RETRO_COLUMN_MAX_CHARS = 300;

// malformed 회차 원문의 상한. 이 값은 회고 네 칸이 아니라 모델 응답 전체(후보 글·PR 메모 포함)
// 라 훨씬 크다. 칸보다 넉넉히 주되 같은 이유로 상한은 반드시 건다.
const RETRO_RAW_TEXT_MAX_CHARS = 600;

const TRUNCATED_SUFFIX = ' …(생략)';

const capColumn = (text: string, maxChars: number): string =>
  text.length <= maxChars
    ? text
    : `${text.slice(0, maxChars)}${TRUNCATED_SUFFIX}`;

/**
 * `agent_run.output` 에 적재된 저녁 회고에서 회고 네 칸만 꺼낸다.
 *
 * 원장에는 `EveningRetroResult`(회고 + 블로그 후보 + PR 메모)가 통째로 들어 있는데 아침이
 * 쓰는 것은 회고뿐이다. 형태가 다르면 `null` — 모양을 확인하지 못한 값을 "빈 회고" 로
 * 넘기면 호출부가 "어제 회고가 비어 있었다" 와 "읽지 못했다" 를 구분할 수 없다.
 */
export const coerceToEveningRetroReflection = (
  output: unknown,
): EveningRetroReflection | null => {
  if (typeof output !== 'object' || output === null || Array.isArray(output)) {
    return null;
  }
  const retrospective = (output as Record<string, unknown>).retrospective;
  if (
    typeof retrospective !== 'object' ||
    retrospective === null ||
    Array.isArray(retrospective)
  ) {
    return null;
  }

  const source = retrospective as Record<string, unknown>;
  const reflection: EveningRetroReflection = {};
  for (const { key } of REFLECTION_COLUMNS) {
    const column = normalizeReflectionColumn(source[key]);
    if (column !== undefined) {
      reflection[key] = column;
    }
  }
  if (source.malformed === true) {
    reflection.malformed = true;
  }
  const rawText = normalizeReflectionColumn(source.rawText);
  if (rawText !== undefined) {
    reflection.rawText = rawText;
  }
  return reflection;
};

// "어제" / "3일 전" — PM 시스템 프롬프트에 오늘 날짜가 없어서, 회고 날짜만 싣면 모델은 그것이
// 오늘 일정에 얼마나 가까운 재료인지 판단할 근거가 없다. 경과일을 같이 적는다.
const formatElapsedLabel = (endedAt: Date, now: Date): string => {
  const elapsedDays = countKstDaysBetween(endedAt, now);
  if (elapsedDays <= 0) {
    return '오늘';
  }
  if (elapsedDays === 1) {
    return '어제';
  }
  return `${elapsedDays}일 전`;
};

const formatOrigin = (endedAt: Date, now: Date): string =>
  `${endedAt.toISOString().slice(0, 10)}, ${formatElapsedLabel(endedAt, now)}`;

/**
 * 「못 끝낸 것」 — 오늘 일정의 직접 재료다.
 *
 * malformed 회차의 `rawText` 는 여기로 오지 않는다. 원문 전체에서 무엇이 미완인지는 코드가
 * 가려낼 수 없는데, 이 섹션은 TRIM_ORDER 맨 끝이라 가장 늦게 잘린다 — 가려내지 못한 덩어리에
 * 그 자리를 줄 근거가 없다. 원문은 아래 참고 섹션이 받는다.
 */
export const formatRetroCarryOverSection = ({
  reflection,
  endedAt,
  now,
}: {
  reflection: EveningRetroReflection;
  endedAt: Date;
  now: Date;
}): string | null => {
  const carryOver = reflection.carryOver;
  if (!carryOver) {
    return null;
  }
  return [
    `[저녁 회고 — 못 끝낸 것과 그 이유 (${formatOrigin(endedAt, now)})]`,
    capColumn(carryOver, RETRO_COLUMN_MAX_CHARS),
    '※ 오늘 일정의 1차 재료다. 위 항목이 오늘 입력(GitHub / Notion / 사용자 입력)에도 남아 있으면 우선 배치하고, 이미 끝난 정황이 있으면 넣지 않는다. 여기 없는 작업을 이 섹션을 근거로 만들어내지 않는다.',
  ].join('\n');
};

/**
 * 「다음엔 이렇게」 + malformed 원문 — 둘 다 참고용이라 한 섹션에 둔다.
 *
 * 이 둘을 carryOver 와 한 칸에 묶지 않는 것이 요점이다. 묶으면 절삭이 참고 내용을 버리려다
 * 오늘 일정의 재료까지 함께 버린다.
 */
export const formatRetroTryNextSection = ({
  reflection,
  endedAt,
  now,
}: {
  reflection: EveningRetroReflection;
  endedAt: Date;
  now: Date;
}): string | null => {
  const origin = formatOrigin(endedAt, now);

  if (reflection.tryNext) {
    return [
      `[저녁 회고 — 다음엔 이렇게 (${origin})]`,
      capColumn(reflection.tryNext, RETRO_COLUMN_MAX_CHARS),
      '※ 일하는 방식에 대한 참고다. 이 문장 자체를 오늘 할 일로 만들지 않는다.',
    ].join('\n');
  }

  // 형식을 어긴 회차 — 네 칸이 비고 원문만 남는다. 형식이 틀린 것과 내용이 없는 것은 다르므로
  // 읽을 수 있는 원문이 있으면 참고 자격으로 싣는다.
  if (reflection.malformed === true && reflection.rawText) {
    return [
      `[저녁 회고 — 형식을 어긴 회차, 모델 원문 그대로 (${origin})]`,
      capColumn(reflection.rawText, RETRO_RAW_TEXT_MAX_CHARS),
      '※ 회고 네 칸으로 파싱되지 않은 원문이다. 미완·개선이 읽히면 참고하되, 읽히지 않으면 무시하고 지어내지 않는다.',
    ].join('\n');
  }

  return null;
};
