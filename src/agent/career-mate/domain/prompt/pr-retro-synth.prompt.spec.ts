import { CareerMateException } from '../career-mate.exception';
import {
  buildMultiPrRetroPrompt,
  buildPrRetroPrompt,
  MULTI_PR_RETRO_SYNTH_SYSTEM_PROMPT,
  parsePrRetroOutput,
  PR_RETRO_SYNTH_SYSTEM_PROMPT,
} from './pr-retro-synth.prompt';

const VALID = JSON.stringify({
  accomplishment: {
    title: '크롤 실패 대시보드 고도화',
    bullet: '원인 보존·board_id 폴백 도입으로 운영 관측성 향상',
    star: {
      situation: '크롤 실패 원인이 유실됐다',
      task: '원인 보존·폴백을 설계',
      action: 'board_id 폴백과 헬스띠를 구현',
      result: '실패 진단 시간을 단축',
    },
    techTags: ['NestJS', 'Notion API'],
    evidence: [
      {
        repo: 'schoolbell-e/sbe-workspace',
        pr: 1692,
        url: 'https://github.com/schoolbell-e/sbe-workspace/pull/1692',
        mergedAt: '2026-06-30',
      },
    ],
  },
  narrative: '이 작업에서 가장 큰 결정은 원인 보존 방식이었다...',
});

describe('pr-retro-synth', () => {
  it('buildPrRetroPrompt 는 PR 메타/본문/diff 를 담는다', () => {
    const prompt = buildPrRetroPrompt({
      detail: {
        number: 1692,
        title: 'T',
        body: 'B',
        repo: 'o/r',
        url: 'u',
        baseRef: 'main',
        headRef: 'feat',
        authorLogin: 'me',
        mergedAt: null,
        changedFiles: ['a.ts'],
        changedFilesTruncated: false,
        changedFilesTotalCount: 1,
        additions: 10,
        deletions: 2,
        headSha: 'sha',
      },
      diff: { diff: 'diff-body', truncated: false, bytes: 9 },
    });
    expect(prompt).toContain('#1692');
    expect(prompt).toContain('diff-body');
  });

  it('parsePrRetroOutput 는 정상 JSON 을 파싱한다 (코드펜스 허용)', () => {
    const parsed = parsePrRetroOutput('```json\n' + VALID + '\n```');
    expect(parsed.accomplishment.evidence[0].pr).toBe(1692);
    expect(parsed.narrative).toContain('가장 큰 결정');
  });

  it('accomplishment 누락 시 예외', () => {
    expect(() => parsePrRetroOutput('{"narrative":"x"}')).toThrow(
      CareerMateException,
    );
  });

  it('narrative 누락 시 예외', () => {
    const noNarr = JSON.stringify({
      accomplishment: JSON.parse(VALID).accomplishment,
    });
    expect(() => parsePrRetroOutput(noNarr)).toThrow(CareerMateException);
  });

  it('buildMultiPrRetroPrompt 는 모든 PR 블록과 통합 지침을 담는다', () => {
    const makeDetail = (number: number) => ({
      number,
      title: `T${number}`,
      body: `B${number}`,
      repo: 'o/r',
      url: `https://github.com/o/r/pull/${number}`,
      baseRef: 'main',
      headRef: `feat-${number}`,
      authorLogin: 'me',
      mergedAt: null,
      changedFiles: ['a.ts'],
      changedFilesTruncated: false,
      changedFilesTotalCount: 1,
      additions: 5,
      deletions: 1,
      headSha: 'sha',
    });
    const prompt = buildMultiPrRetroPrompt({
      items: [
        {
          detail: makeDetail(1),
          diff: { diff: 'diff-1', truncated: false, bytes: 6 },
        },
        {
          detail: makeDetail(2),
          diff: { diff: 'diff-2', truncated: false, bytes: 6 },
        },
      ],
    });
    expect(prompt).toContain('#1');
    expect(prompt).toContain('#2');
    expect(prompt).toContain('diff-1');
    expect(prompt).toContain('diff-2');
    expect(prompt).toContain('PR 1/2');
    expect(prompt).toContain('PR 2/2');
  });

  it('MULTI 시스템 프롬프트는 하나의 통합 성과 지침을 담는다', () => {
    expect(MULTI_PR_RETRO_SYNTH_SYSTEM_PROMPT).toContain('통합');
    expect(MULTI_PR_RETRO_SYNTH_SYSTEM_PROMPT).toContain('evidence');
  });
});

// 작업 맥락 — 사용자가 카드에 적은 한 줄이 회고 프롬프트에 실리는지.
// "없을 때 도입 전과 같다" 가 이 기능의 계약이라, 없는 경로를 문자열 동일성으로 못 박는다.
describe('pr-retro-synth — 작업 맥락', () => {
  const DETAIL = {
    number: 1692,
    title: 'T',
    body: 'B',
    repo: 'o/r',
    url: 'u',
    baseRef: 'main',
    headRef: 'feat',
    authorLogin: 'me',
    mergedAt: null,
    changedFiles: ['a.ts'],
    changedFilesTruncated: false,
    changedFilesTotalCount: 1,
    additions: 10,
    deletions: 2,
    headSha: 'sha',
  };
  const DIFF = { diff: 'diff-body', truncated: false, bytes: 9 };
  const CONTEXT = '결제 실패율 3%→0.5%, 월 2,000건 수동 재시도 제거';

  it('맥락이 있으면 PR 블록 앞에 [작업 맥락] 절이 붙는다', () => {
    const prompt = buildPrRetroPrompt({
      detail: DETAIL,
      diff: DIFF,
      impactContext: CONTEXT,
    });
    expect(prompt).toContain('[작업 맥락 — 사용자가 직접 적은 영향]');
    expect(prompt).toContain(CONTEXT);
    // diff 수천 줄 아래로 밀리면 모델이 사실상 보지 않는다 — 맨 앞이어야 한다.
    expect(prompt.indexOf('[작업 맥락')).toBeLessThan(
      prompt.indexOf('[PR 메타]'),
    );
  });

  it('맥락이 없으면 프롬프트가 도입 전과 문자열까지 같다', () => {
    const base = buildPrRetroPrompt({ detail: DETAIL, diff: DIFF });
    expect(base).not.toContain('[작업 맥락');
    expect(base.startsWith('[PR 메타]')).toBe(true);
    // undefined / 빈 문자열 / 공백만 — 셋 다 "없음" 과 같은 결과여야 한다.
    expect(
      buildPrRetroPrompt({ detail: DETAIL, diff: DIFF, impactContext: '' }),
    ).toBe(base);
    expect(
      buildPrRetroPrompt({ detail: DETAIL, diff: DIFF, impactContext: '   ' }),
    ).toBe(base);
  });

  it('다건 프롬프트도 맥락 유무로 갈린다', () => {
    const items = [
      { detail: DETAIL, diff: DIFF },
      { detail: { ...DETAIL, number: 1693 }, diff: DIFF },
    ];
    const withContext = buildMultiPrRetroPrompt({
      items,
      impactContext: CONTEXT,
    });
    expect(withContext).toContain(CONTEXT);
    expect(withContext.indexOf('[작업 맥락')).toBeLessThan(
      withContext.indexOf('[이어진 PR'),
    );

    const without = buildMultiPrRetroPrompt({ items });
    expect(without).not.toContain('[작업 맥락');
    expect(without.startsWith('[이어진 PR 2개')).toBe(true);
  });

  it('시스템 프롬프트의 충돌 규칙이 남아 있지 않다 (덧붙이기 금지)', () => {
    // 이 줄이 남아 있으면 "PR 에 없는 값은 쓰지 말라" 가 맥락 규칙을 이긴다.
    for (const prompt of [
      PR_RETRO_SYNTH_SYSTEM_PROMPT,
      MULTI_PR_RETRO_SYNTH_SYSTEM_PROMPT,
    ]) {
      expect(prompt).not.toContain(
        '지표는 PR 제목·본문·diff 에 문자로 적힌 값만',
      );
      expect(prompt).toContain(
        '지표는 PR 제목·본문·diff 또는 [작업 맥락] 에 문자로 적힌 값만',
      );
      // 맥락이 없는 회차가 대부분이다 — 그때 지어내지 말라는 지시가 반드시 있어야 한다.
      expect(prompt).toContain('[작업 맥락] 절이 없으면');
      expect(prompt).toContain('없는 수치를 지어내느니');
    }
  });
});
