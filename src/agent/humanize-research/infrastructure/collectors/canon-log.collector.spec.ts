import { ConfigService } from '@nestjs/config';

import type { GitResult } from '../../domain/humanize-research.type';
import {
  CollectionStatus,
  HumanizeResearchSource,
  Processed,
} from '../../domain/humanize-research.type';
import type { runGit } from './upstream-rule-diff.collector';

const git = jest.fn<ReturnType<typeof runGit>, Parameters<typeof runGit>>();
let CanonLogCollector: typeof import('./canon-log.collector').CanonLogCollector;
const head = 'b'.repeat(40);
const previousHead = 'a'.repeat(40);
const processed = {
  humanizerMaxRunId: null,
  blogPostIds: [],
  upstreamHead: null,
  arxivIds: [],
  canonHead: previousHead,
} as Processed;

const gitResult = (stdout: string, exitCode = 0): GitResult => ({
  exitCode,
  stdout,
  stderr: exitCode === 0 ? '' : 'git failure',
});

describe('CanonLogCollector', () => {
  const configService = {
    get: jest.fn().mockReturnValue('/tmp/humanize-canon-fixture'),
  } as unknown as ConfigService;

  beforeEach(async () => {
    jest.resetModules();
    jest.doMock('./upstream-rule-diff.collector', () => ({ runGit: git }));
    ({ CanonLogCollector } = await import('./canon-log.collector'));
    git.mockReset();
    git.mockImplementation(async ({ args }) => {
      if (args[0] === 'rev-parse') {
        return gitResult(head);
      }
      if (args[0] === 'merge-base') {
        return gitResult('');
      }
      return gitResult(
        `${head}\x1f규칙 수정\x1f자세한 근거\x1e\nreferences/corpus/example.json\n`,
      );
    });
  });

  it('canonHead 가 조상이면 <head>..HEAD 범위를 조회한다', async () => {
    const collector = new CanonLogCollector(configService);
    const result = await collector.collect(processed);

    expect(result.error).toBeUndefined();
    expect(git).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining([`${previousHead}..HEAD`]),
      }),
    );
    expect(result.items[0].id).toBe(`canon:${head}`);
  });

  it('canonHead 가 없거나 조상이 아니면 최근 30일을 조회한다', async () => {
    const collector = new CanonLogCollector(configService);
    git.mockImplementation(async ({ args }) => {
      if (args[0] === 'rev-parse') {
        return gitResult(head);
      }
      if (args[0] === 'merge-base') {
        return gitResult('', 1);
      }
      return gitResult('');
    });

    await collector.collect({ ...processed, canonHead: null });
    await collector.collect(processed);

    const logCalls = git.mock.calls.filter(
      ([input]) => input.args[0] === 'log',
    );
    expect(logCalls).toHaveLength(2);
    for (const [input] of logCalls) {
      expect(input.args).toContain('--since=30.days');
    }
  });

  it('커밋이 없으면 EMPTY를 반환한다', async () => {
    git.mockImplementation(async ({ args }) =>
      gitResult(args[0] === 'rev-parse' ? head : ''),
    );
    const collector = new CanonLogCollector(configService);

    const result = await collector.collect({ ...processed, canonHead: null });

    expect(result.status).toBe(CollectionStatus.EMPTY);
    expect(result.items).toEqual([]);
  });

  it('git 실패면 FAILED이고 throw 하지 않는다', async () => {
    git.mockResolvedValue(gitResult('', 128));
    const collector = new CanonLogCollector(configService);

    const result = await collector.collect(processed);

    expect(result.status).toBe(CollectionStatus.FAILED);
    expect(result.source).toBe(HumanizeResearchSource.CANON_LOG);
  });

  it('본문은 커밋당 500자, 항목 전체 8,000자 이하로 제한하고 corpus 파일명을 담는다', async () => {
    const body = '가'.repeat(700);
    const records = Array.from({ length: 20 }, (_, index) => {
      const commitHash = String(index).padStart(40, '0');
      return `${commitHash}\x1f제목\x1f${body}\x1e\nreferences/corpus/file-${index}.json\n`;
    }).join('');
    git.mockImplementation(async ({ args }) =>
      gitResult(args[0] === 'rev-parse' ? head : records),
    );
    const collector = new CanonLogCollector(configService);

    const result = await collector.collect({ ...processed, canonHead: null });

    expect(result.status).toBe(CollectionStatus.OK);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].text.length).toBeLessThanOrEqual(8_000);
    expect(result.items[0].text).toContain('references/corpus/file-0.json');
    expect(result.items[0].text).not.toContain('가'.repeat(501));
  });
});
