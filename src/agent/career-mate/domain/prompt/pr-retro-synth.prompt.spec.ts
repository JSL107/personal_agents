import { CareerMateException } from '../career-mate.exception';
import {
  buildPrRetroPrompt,
  parsePrRetroOutput,
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
        changedFiles: ['a.ts'],
        changedFilesTruncated: false,
        changedFilesTotalCount: 1,
        additions: 10,
        deletions: 2,
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
});
