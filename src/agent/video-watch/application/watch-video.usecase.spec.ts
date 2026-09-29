import { realpathSync } from 'node:fs';
import { access, stat } from 'node:fs/promises';

import { ConfigService } from '@nestjs/config';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { WatchRunnerPort } from '../domain/port/watch-runner.port';
import { VideoWatchErrorCode } from '../domain/video-watch-error-code.enum';
import { WatchVideoUsecase } from './watch-video.usecase';

jest.mock('node:fs/promises', () => ({
  ...jest.requireActual('node:fs/promises'),
  access: jest.fn(),
}));

const report = `# watch: video report\n- **Title:** Sample title\n- **Duration:** 00:19 (19.0s)\n- **Transcript:** 1 segments (via captions)\n\n## Frames\n- \`/tmp/frame.jpg\` (t=00:04)\n\n## Transcript\n\n\x60\x60\x60\nwords\n\x60\x60\x60`;

describe('WatchVideoUsecase', () => {
  const accessMock = access as jest.MockedFunction<typeof access>;
  let runAgent: jest.Mock;
  let route: jest.Mock;
  let runWatch: jest.Mock;
  let usecase: WatchVideoUsecase;

  beforeEach(() => {
    accessMock.mockResolvedValue(undefined);
    route = jest.fn().mockResolvedValue({
      text: JSON.stringify({ answer: '영상 답변', highlights: [] }),
      modelUsed: 'codex',
    });
    runWatch = jest.fn(({ outDir }: { outDir: string }) =>
      Promise.resolve(report.replace('/tmp/frame.jpg', `${outDir}/frame.jpg`)),
    );
    runAgent = jest.fn(async (input) => {
      const result = await input.run({
        agentRunId: 12,
        updateInputSnapshot: jest.fn(),
      });
      return { ...result, agentRunId: 12 };
    });
    const config = { get: jest.fn().mockReturnValue('/tool/watch.py') };
    usecase = new WatchVideoUsecase(
      config as unknown as ConfigService,
      { execute: runAgent } as unknown as AgentRunService,
      { route } as unknown as ModelRouterUsecase,
      { run: runWatch } as unknown as WatchRunnerPort,
    );
  });

  it('rejects missing URLs before creating a run', async () => {
    await expect(
      usecase.execute({ slackUserId: 'U1', text: '요약해줘' }),
    ).rejects.toMatchObject({
      errorCode: VideoWatchErrorCode.NO_YOUTUBE_URL,
    });
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('rejects an unconfigured script', async () => {
    usecase = new WatchVideoUsecase(
      { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService,
      { execute: runAgent } as unknown as AgentRunService,
      { route } as unknown as ModelRouterUsecase,
      { run: runWatch } as unknown as WatchRunnerPort,
    );
    await expect(
      usecase.execute({
        slackUserId: 'U1',
        text: 'https://youtu.be/jNQXAC9IVRw',
      }),
    ).rejects.toMatchObject({
      errorCode: VideoWatchErrorCode.WATCH_NOT_CONFIGURED,
    });
    expect(runAgent).not.toHaveBeenCalled();
  });

  // watch.py 는 --out-dir 을 Path.resolve() 로 심볼릭 링크까지 풀어 출력한다.
  // macOS tmpdir 은 /var → /private/var 링크라, 풀기 전 경로로 비교하면 프레임이 전부 버려진다(실측).
  it('keeps frames when watch prints the symlink-resolved out dir', async () => {
    runWatch.mockImplementation(({ outDir }: { outDir: string }) =>
      Promise.resolve(
        report.replace('/tmp/frame.jpg', `${realpathSync(outDir)}/frame.jpg`),
      ),
    );
    await usecase.execute({
      slackUserId: 'U1',
      text: 'https://youtu.be/jNQXAC9IVRw',
    });
    expect(route.mock.calls[0][0].request.imagePaths).toHaveLength(1);
  });

  it('passes extracted frame paths to the model and removes temp dirs on success', async () => {
    const outcome = await usecase.execute({
      slackUserId: 'U1',
      text: '요약해줘 https://youtu.be/jNQXAC9IVRw',
    });
    expect(route.mock.calls[0][0].request.imagePaths).toHaveLength(1);
    const { outDir, homeDir } = runWatch.mock.calls[0][0];
    await expect(stat(outDir)).rejects.toThrow();
    await expect(stat(homeDir)).rejects.toThrow();
    expect(outcome.report).toMatchObject({
      videoId: 'jNQXAC9IVRw',
      frameCount: 1,
    });
  });

  it('removes both temp dirs when the watch runner fails', async () => {
    runWatch.mockRejectedValue(new Error('runner failed'));
    await expect(
      usecase.execute({
        slackUserId: 'U1',
        text: 'https://youtu.be/jNQXAC9IVRw',
      }),
    ).rejects.toThrow('runner failed');
    const input = runWatch.mock.calls[0][0];
    await expect(stat(input.outDir)).rejects.toThrow();
    await expect(stat(input.homeDir)).rejects.toThrow();
  });
});
