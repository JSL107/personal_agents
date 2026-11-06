import { isMatching, P } from 'ts-pattern';

import {
  FirstLineType,
  REEL_FEATURES_VERSION,
  ReelFeatures,
  TitleForm,
} from './instagram-insight.type';

const LINE_PATTERN = {
  subtitle: P.string,
  speech: P.string,
  gesture: P.string,
  react: P.string,
  point_kind: P.string,
};
const SEGMENT_PATTERN = {
  headline: P.string,
  lines: P.array(LINE_PATTERN),
};
// 하루 1편(2026-11-06~): 꼭지 목록. hermes-skill-reels.py 가 쓰는 script.json.
const DAILY_SCRIPT_PATTERN = {
  duration: P.number,
  segments: P.array({ field: P.string, segment: SEGMENT_PATTERN }),
};
// 하루 2편 시절(2026-11-04·05) ai·dev 폴더: 최상위 script 하나.
const LEGACY_SCRIPT_PATTERN = {
  duration: P.number,
  script: SEGMENT_PATTERN,
};

type ScriptLine = P.infer<typeof LINE_PATTERN>;
interface ScriptSegment {
  field: string;
  headline: string;
  lines: ScriptLine[];
}

const QUESTION_ENDING = /\?\s*$/;
const HAS_DIGIT = /\d/;
// 결과형 제목 어미: "이제 ~할 수 있어요", "~해 줘요" (스펙 §3.3).
const RESULT_ENDING = /(할 수 있어요|줘요|돼요|됐어요)$/;

export const extractReelFeatures = ({
  script,
  folderField,
}: {
  script: unknown;
  folderField: string;
}): ReelFeatures | null => {
  const segments = toSegments({ script, folderField });
  if (!segments || segments.length === 0) {
    return null;
  }
  const lines = segments.flatMap((segment) => segment.lines);
  if (lines.length === 0 || segments[0].lines.length === 0) {
    return null;
  }
  const [first] = segments[0].lines;
  return {
    version: REEL_FEATURES_VERSION,
    durationSec: (script as { duration: number }).duration,
    segmentFields: segments.map((segment) => segment.field),
    headlines: segments.map((segment) => segment.headline),
    titleForm: titleFormOf(segments[0].headline),
    firstLine: {
      subtitle: first.subtitle,
      speech: first.speech,
      gesture: first.gesture,
      react: first.react,
    },
    firstLineType: firstLineTypeOf(first.subtitle),
    lineCount: lines.length,
    speechChars: lines.reduce((sum, line) => sum + line.speech.length, 0),
    pointCards: lines.filter((line) => line.point_kind !== 'none').length,
    reacts: lines.map((line) => line.react).filter((react) => react !== 'none'),
    gestureCounts: countBy(lines.map((line) => line.gesture)),
    engine: isMatching({ engine: P.string }, script) ? script.engine : null,
  };
};

const toSegments = ({
  script,
  folderField,
}: {
  script: unknown;
  folderField: string;
}): ScriptSegment[] | null => {
  if (isMatching(DAILY_SCRIPT_PATTERN, script)) {
    return script.segments.map(({ field, segment }) => ({
      field,
      ...segment,
    }));
  }
  if (isMatching(LEGACY_SCRIPT_PATTERN, script)) {
    return [{ field: folderField, ...script.script }];
  }
  return null;
};

// 질문이 숫자보다 먼저다. "2개 중 뭘 쓸까요?" 는 질문형이다.
const firstLineTypeOf = (subtitle: string): FirstLineType => {
  if (QUESTION_ENDING.test(subtitle)) {
    return FirstLineType.QUESTION;
  }
  if (HAS_DIGIT.test(subtitle)) {
    return FirstLineType.NUMBER;
  }
  return FirstLineType.STATEMENT;
};

const titleFormOf = (headline: string): TitleForm => {
  if (RESULT_ENDING.test(headline.trim())) {
    return TitleForm.RESULT;
  }
  if (headline.includes('?')) {
    return TitleForm.QUESTION;
  }
  return TitleForm.STATEMENT;
};

const countBy = (values: string[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
};
