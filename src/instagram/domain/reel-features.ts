import { isMatching, P } from 'ts-pattern';

import {
  FirstLineType,
  REEL_FEATURES_VERSION,
  ReelFeatures,
  TitleForm,
} from './instagram-insight.type';

// DB 의 features Json 을 읽을 때 쓰는 모양 검사. 다른 버전이거나 모양이 다르면 아직 없는 것으로 본다.
export const REEL_FEATURES_PATTERN = {
  version: REEL_FEATURES_VERSION,
  durationSec: P.number,
  segmentFields: P.array(P.string),
  headlines: P.array(P.string),
  titleForm: P.union(TitleForm.RESULT, TitleForm.QUESTION, TitleForm.STATEMENT),
  firstLine: {
    subtitle: P.string,
    speech: P.string,
    gesture: P.string,
    react: P.string,
  },
  firstLineType: P.union(
    FirstLineType.QUESTION,
    FirstLineType.NUMBER,
    FirstLineType.STATEMENT,
  ),
  lineCount: P.number,
  speechChars: P.number,
  pointCards: P.number,
  reacts: P.array(P.string),
  gestureCounts: P.record(P.string, P.number),
  engine: P.union(P.string, null),
};

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

// LINE_PATTERN 과 같은 모양. 어긋나면 toScript 의 isMatching 결과를 넣는 자리에서 컴파일 에러가 난다.
interface ScriptLine {
  subtitle: string;
  speech: string;
  gesture: string;
  react: string;
  point_kind: string;
}

interface ScriptSegment {
  field: string;
  headline: string;
  lines: ScriptLine[];
}

interface ParsedScript {
  durationSec: number;
  engine: string | null;
  segments: ScriptSegment[];
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
  const parsed = toScript({ script, folderField });
  const firstSegment = parsed?.segments[0];
  const firstLine = firstSegment?.lines[0];
  if (!parsed || !firstSegment || !firstLine) {
    return null;
  }
  const lines = parsed.segments.flatMap((segment) => segment.lines);
  const speechChars = lines.reduce((sum, line) => sum + line.speech.length, 0);
  const pointCardLines = lines.filter((line) => line.point_kind !== 'none');
  const reacts = lines
    .map((line) => line.react)
    .filter((react) => react !== 'none');
  const gestureCounts = countBy(lines.map((line) => line.gesture));
  const features: ReelFeatures = {
    version: REEL_FEATURES_VERSION,
    durationSec: parsed.durationSec,
    segmentFields: parsed.segments.map((segment) => segment.field),
    headlines: parsed.segments.map((segment) => segment.headline),
    titleForm: titleFormOf(firstSegment.headline),
    firstLine: {
      subtitle: firstLine.subtitle,
      speech: firstLine.speech,
      gesture: firstLine.gesture,
      react: firstLine.react,
    },
    firstLineType: firstLineTypeOf(firstLine.subtitle),
    lineCount: lines.length,
    speechChars,
    pointCards: pointCardLines.length,
    reacts,
    gestureCounts,
    engine: parsed.engine,
  };
  return features;
};

const toScript = ({
  script,
  folderField,
}: {
  script: unknown;
  folderField: string;
}): ParsedScript | null => {
  const engine = isMatching({ engine: P.string }, script)
    ? script.engine
    : null;
  if (isMatching(DAILY_SCRIPT_PATTERN, script)) {
    const segments: ScriptSegment[] = script.segments.map(
      ({ field, segment }) => ({ field, ...segment }),
    );
    return { durationSec: script.duration, engine, segments };
  }
  if (isMatching(LEGACY_SCRIPT_PATTERN, script)) {
    const segments: ScriptSegment[] = [
      { field: folderField, ...script.script },
    ];
    return { durationSec: script.duration, engine, segments };
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
