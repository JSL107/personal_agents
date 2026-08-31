import { ConfigService } from '@nestjs/config';

import { GenerateStudyDiagramUsecase } from './generate-study-diagram.usecase';

const drawing =
  '<html><body><svg><text font-size="20">가</text></svg></body></html>';
const fencedDrawing = '```html\n' + drawing + '\n```';
const png = Buffer.from('png-bytes');

const buildConfigService = (
  values: Record<string, string | undefined> = {
    STUDY_DIAGRAM_ENABLED: 'true',
  },
): ConfigService =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

const buildUsecase = ({
  runner,
  renderer,
  configService = buildConfigService(),
}: {
  runner: { run: jest.Mock };
  renderer: { render: jest.Mock };
  configService?: ConfigService;
}): GenerateStudyDiagramUsecase =>
  new GenerateStudyDiagramUsecase(
    runner as never,
    renderer as never,
    configService,
  );

const input = {
  topic: 'durable execution',
  kind: 'CONCEPT' as const,
  reportMd: '본문',
};

describe('GenerateStudyDiagramUsecase', () => {
  it('한 번에 통과하면 png 를 돌려주고 재작업하지 않는다', async () => {
    const runner = {
      run: jest.fn().mockResolvedValue({ stdout: fencedDrawing }),
    };
    const renderer = {
      render: jest.fn().mockResolvedValue({ png, violations: [] }),
    };

    const result = await buildUsecase({ runner, renderer }).execute(input);

    expect(result).toEqual({ png, html: drawing, violations: [] });
    expect(runner.run).toHaveBeenCalledTimes(1);
  });

  it('위반이 있으면 사유를 넣어 한 번 더 그리게 한다', async () => {
    const runner = {
      run: jest.fn().mockResolvedValue({ stdout: fencedDrawing }),
    };
    const renderer = {
      render: jest
        .fn()
        .mockResolvedValueOnce({
          png,
          violations: [
            {
              rule: 'FONT_TOO_SMALL',
              detail: '글자 하한 14px 미만: text(9px)',
            },
          ],
        })
        .mockResolvedValueOnce({ png, violations: [] }),
    };

    const result = await buildUsecase({ runner, renderer }).execute(input);

    expect(result).toEqual({ png, html: drawing, violations: [] });
    expect(runner.run).toHaveBeenCalledTimes(2);
    expect(runner.run.mock.calls[1][0]).toContain('text(9px)');
  });

  it('두 번째도 위반이면 null 을 돌려주고 세 번째는 시도하지 않는다', async () => {
    const violations = [{ rule: 'OVERFLOW_X', detail: '내용 폭 812px' }];
    const runner = {
      run: jest.fn().mockResolvedValue({ stdout: fencedDrawing }),
    };
    const renderer = {
      render: jest.fn().mockResolvedValue({ png, violations }),
    };

    const result = await buildUsecase({ runner, renderer }).execute(input);

    expect(result).toBeNull();
    expect(runner.run).toHaveBeenCalledTimes(2);
  });

  it('keepRejected 면 거부된 그림도 위반과 함께 돌려준다', async () => {
    const violations = [{ rule: 'OVERFLOW_X', detail: '내용 폭 812px' }];
    const runner = {
      run: jest.fn().mockResolvedValue({ stdout: fencedDrawing }),
    };
    const renderer = {
      render: jest.fn().mockResolvedValue({ png, violations }),
    };

    const result = await buildUsecase({ runner, renderer }).execute(input, {
      keepRejected: true,
    });

    expect(result).toEqual({ png, html: drawing, violations });
  });

  it('keepRejected 라도 호출·파싱 실패는 null 이다 — 보여줄 그림 자체가 없다', async () => {
    const runner = {
      run: jest.fn().mockResolvedValue({ stdout: '못 그렸습니다' }),
    };
    const renderer = { render: jest.fn() };

    const result = await buildUsecase({ runner, renderer }).execute(input, {
      keepRejected: true,
    });

    expect(result).toBeNull();
  });

  it('codex 호출이 실패하면 재시도 없이 null 이다', async () => {
    const runner = {
      run: jest.fn().mockRejectedValue(new Error('quota exhausted')),
    };
    const renderer = { render: jest.fn() };

    const result = await buildUsecase({ runner, renderer }).execute(input);

    expect(result).toBeNull();
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(renderer.render).not.toHaveBeenCalled();
  });

  it('HTML 파싱에 실패하면 재작업 없이 null 이다', async () => {
    const runner = {
      run: jest.fn().mockResolvedValue({ stdout: '그리지 못했습니다' }),
    };
    const renderer = { render: jest.fn() };

    const result = await buildUsecase({ runner, renderer }).execute(input);

    expect(result).toBeNull();
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(renderer.render).not.toHaveBeenCalled();
  });

  it('렌더가 예외를 던지면 null 이다', async () => {
    const runner = {
      run: jest.fn().mockResolvedValue({ stdout: fencedDrawing }),
    };
    const renderer = {
      render: jest.fn().mockRejectedValue(new Error('browser crashed')),
    };

    const result = await buildUsecase({ runner, renderer }).execute(input);

    expect(result).toBeNull();
  });

  it('STUDY_DIAGRAM_ENABLED 가 꺼져 있으면 codex 를 부르지 않는다', async () => {
    const runner = { run: jest.fn() };
    const renderer = { render: jest.fn() };

    const result = await buildUsecase({
      runner,
      renderer,
      configService: buildConfigService({ STUDY_DIAGRAM_ENABLED: 'false' }),
    }).execute(input);

    expect(result).toBeNull();
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('STUDY_DIAGRAM_ENABLED 가 아예 없으면 꺼진 것으로 본다', async () => {
    const runner = { run: jest.fn() };
    const renderer = { render: jest.fn() };

    const result = await buildUsecase({
      runner,
      renderer,
      configService: buildConfigService({}),
    }).execute(input);

    expect(result).toBeNull();
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('설정한 한계값을 렌더러에 그대로 넘긴다', async () => {
    const runner = {
      run: jest.fn().mockResolvedValue({ stdout: fencedDrawing }),
    };
    const renderer = {
      render: jest.fn().mockResolvedValue({ png, violations: [] }),
    };

    await buildUsecase({
      runner,
      renderer,
      configService: buildConfigService({
        STUDY_DIAGRAM_ENABLED: 'true',
        STUDY_DIAGRAM_WIDTH_PX: '640',
        STUDY_DIAGRAM_MIN_FONT_PX: '16',
        STUDY_DIAGRAM_MAX_HEIGHT_PX: '1200',
      }),
    }).execute(input);

    expect(renderer.render).toHaveBeenCalledWith({
      html: drawing,
      limits: { widthPx: 640, minFontPx: 16, maxHeightPx: 1200 },
    });
  });
});
