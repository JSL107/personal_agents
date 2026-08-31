import {
  findKoreanStyleGapAxes,
  KOREAN_STYLE_TARGETS,
  measureKoreanStyle,
} from '../domain/korean-style-metrics';
import {
  HumanizeMarkdownResult,
  HumanizeSkipReasons,
  scanMarkdownBlocks,
} from '../domain/markdown-blocks';
import { HumanizeAudience, HumanizeService } from './humanize.service';

// 되먹임 진행 상황을 적을 곳. Nest Logger 와 console 이 모두 들어맞는 최소 모양이다.
export type BreathRetryLogger = {
  log: (message: string) => void;
};

// 마크다운 본문에서 **산문 문단만** 골라 윤문하고 제자리에 되끼운다.
//
// 왜 블록을 가려야 하는가 — 코드블록·표·헤딩까지 모델에 넘기면 코드가 윤문되어 깨진다.
// (같은 뿌리의 사고를 오늘 겪었다: 정규식이 JSON string 안 코드펜스를 응답 펜스로 오인해
//  BLOG_PUBLISH run#864 가 죽었다. 마크다운을 다룰 때 펜스 인식은 선택이 아니다.)
//
// 문단 텍스트만 humanize 에 넘기고 같은 자리에 되끼운다. 실패 시 원문 그대로(best-effort).
export const humanizeMarkdownProse = async (
  markdown: string,
  humanizer: HumanizeService,
  // 생략하면 `developer` — 지금까지의 발행 동작 그대로다. 대외용 글이 생기면 여기에 `general` 을 넘긴다.
  //
  // 왜 이 어댑터에만 뚫었는가 — 노션 초안 발행이 유일하게 "개발자가 아닌 사람이 읽을 수도 있는"
  // 경로다. 저녁 블로그(`humanize-evening-blog`)와 이력서(`humanize-career-profile`)는 독자가
  // 각각 본인·채용 담당이라 완화할 이유가 없다. 필요해지면 같은 방식으로 인자 하나만 통과시키면 된다.
  audience?: HumanizeAudience,
  // 직전 회차 실측 평균. 하한 미달일 때만 넘겨 그 수치를 지시에 싣는다(호흡 되먹임).
  measuredAverageLength?: number,
): Promise<HumanizeMarkdownResult> => {
  const { lines, blocks } = scanMarkdownBlocks(markdown);
  const proseBlocks = blocks.filter(
    (block) =>
      block.kind === 'prose' &&
      lines
        .slice(block.startLine, block.endLine + 1)
        .join('\n')
        .trim().length > 0,
  );

  if (proseBlocks.length === 0) {
    return {
      markdown,
      changedParagraphs: 0,
      proseParagraphs: 0,
      skippedParagraphs: { empty: 0, identical: 0 },
    };
  }

  const fields: Record<string, string> = {};
  proseBlocks.forEach((block, order) => {
    fields[String(order)] = lines
      .slice(block.startLine, block.endLine + 1)
      .join('\n');
  });

  // 블로그 본문은 분량이 곧 내용이라 길이 예산을 걸지 않는다(훑어 읽는 Slack 요약과 반대).
  const humanized = await humanizer.humanize(fields, {
    longForm: true,
    voice: 'personal-blog',
    audience,
    measuredAverageLength,
  });

  // 뒤에서부터 갈아끼운다 — 앞에서부터 바꾸면 줄 수가 달라져 뒤 블록의 줄 번호가 밀린다.
  const nextLines = [...lines];
  let changedParagraphs = 0;
  // 건너뛴 문단을 사유별로 센다. 세지 않으면 카드의 `42/43` 을 보고도 그 하나가 왜 빠졌는지
  // 알 수 없다 — 원인 규명이 막히는 자리가 정확히 여기였다.
  const skippedParagraphs: HumanizeSkipReasons = { empty: 0, identical: 0 };
  for (let order = proseBlocks.length - 1; order >= 0; order -= 1) {
    const block = proseBlocks[order];
    const original = fields[String(order)];
    const rewritten = humanized[String(order)];
    if (typeof rewritten !== 'string' || rewritten.trim().length === 0) {
      skippedParagraphs.empty += 1;
      continue;
    }
    if (rewritten === original) {
      skippedParagraphs.identical += 1;
      continue;
    }
    changedParagraphs += 1;
    nextLines.splice(
      block.startLine,
      block.endLine - block.startLine + 1,
      ...rewritten.split('\n'),
    );
  }

  return {
    markdown: nextLines.join('\n'),
    changedParagraphs,
    proseParagraphs: proseBlocks.length,
    skippedParagraphs,
  };
};

// 말투 단계를 돌리고, 호흡이 하한에 못 미치면 그 수치를 적어 한 번 더 들여보낸다.
//
// 왜 필요한가 — 프롬프트에 "기본은 40~60자" 를 넣고 돌린 발행본이 평균 32.6자였다. 규칙은
// 읽었지만 모델은 자기 글의 평균을 재지 못한다. 재는 것은 코드인데 그 결과가 카드에만 찍히고
// 모델에게 돌아가지 않아, 지켜졌는지 모르는 채로 끝났다.
//
// 재시도는 **한 번뿐**이다. 모델 호출이 그만큼 늘고, 두 번째에도 안 되면 세 번째라고 될
// 이유가 없다. 여전히 미달이면 그대로 두고 카드의 「목표 밖」 에 남겨 사람이 본다.
//
// 재시도본이 더 나쁘면 첫 판을 쓴다. 되먹임이 역효과를 낸 회차까지 받아들일 이유는 없다.
export const humanizeMarkdownProseWithBreathRetry = async (
  body: string,
  humanizer: HumanizeService,
  // 발행 경로는 Nest Logger 를, 스크립트는 console 을 넘긴다. 없으면 조용히 돈다.
  logger?: BreathRetryLogger,
  audience?: HumanizeAudience,
): Promise<HumanizeMarkdownResult> => {
  const first = await humanizeMarkdownProse(body, humanizer, audience);
  const metrics = measureKoreanStyle(first.markdown);
  if (
    !metrics.measurable ||
    metrics.averageLength >= KOREAN_STYLE_TARGETS.averageLengthMin
  ) {
    return first;
  }

  logger?.log(
    `호흡 되먹임 — 평균 ${metrics.averageLength}자 < ${KOREAN_STYLE_TARGETS.averageLengthMin}자, 한 번 더 윤문한다`,
  );
  const retried = await humanizeMarkdownProse(
    first.markdown,
    humanizer,
    audience,
    metrics.averageLength,
  );
  const retriedMetrics = measureKoreanStyle(retried.markdown);
  // 평균 하나로 판정하면 **되먹임이 제대로 작동한 결과가 곧 가드의 사각지대**가 된다.
  // 짧은 문장을 합치면 평균과 최장이 함께 오르고, 문장을 이어 붙이는 과정에서 종결체가 한쪽으로
  // 몰린다. 평균이 0.1자 올라가는 것만 보면 최장이 80자를 넘겨도, 종결체교대가 60%를 넘겨도
  // 통과한다 — 하필 종결체교대는 이 파일이 의존하는 지표 중 **출처 의심 표본과 무관한 유일한
  // 정량 기준**이다(`korean-style-metrics.ts` 의 `endingAlternationPercentMax` 주석).
  // 가장 믿는 축을 팔아 가장 근거가 약한 축을 사는 거래가 된다.
  //
  // 그래서 목표 밖 축의 **정체**를 본다. 개수만 비교하면 축이 맞바뀐 재시도본을 통과시킨다
  // (리뷰 지적): 첫 판의 유일한 갭이 `평균` 이고 재시도에서 평균은 하한을 넘었지만 `최장` 이
  // 새로 상한을 넘으면, 둘 다 1개라 **더 나빠진 판이 채택된다.**
  //
  // 재시도본의 표본 크기도 함께 본다. 문장을 합치는 것이 이 되먹임의 목적이라 문장 수가
  // 줄어드는데, 40문장 미만이 되면 `findKoreanStyleGaps` 가 문장 축을 아예 건너뛴다 —
  // 갭이 사라진 것처럼 보여 그대로 수락된다. 판정 대상이 아닌 결과를 판정하는 셈이다.
  const axesBefore = new Set(findKoreanStyleGapAxes(metrics));
  const newAxes = findKoreanStyleGapAxes(retriedMetrics).filter(
    (axis) => !axesBefore.has(axis),
  );
  const rejectReason = ((): string | null => {
    if (!retriedMetrics.measurable) {
      return `재시도본이 ${retriedMetrics.sentenceCount}문장으로 줄어 정량 판정 대상이 아니다`;
    }
    if (retriedMetrics.averageLength <= metrics.averageLength) {
      return `평균이 오르지 않았다(${metrics.averageLength}자 → ${retriedMetrics.averageLength}자)`;
    }
    if (newAxes.length > 0) {
      return `다른 축이 새로 목표를 벗어났다(${newAxes.join(', ')})`;
    }
    return null;
  })();
  if (rejectReason) {
    logger?.log(`호흡 되먹임 무효 — ${rejectReason}, 첫 판을 쓴다`);
    return first;
  }

  logger?.log(
    `호흡 되먹임 적용 — 평균 ${metrics.averageLength}자 → ${retriedMetrics.averageLength}자 · 새로 벗어난 축 없음`,
  );
  // 문단 계수는 첫 판 것을 쓴다. 재시도는 같은 문단을 한 번 더 다듬은 것이지 새로 고른 게
  // 아니라, 두 번째 계수를 카드에 적으면 "몇 문단이 윤문됐나" 가 실제보다 작게 읽힌다.
  return { ...first, markdown: retried.markdown };
};
