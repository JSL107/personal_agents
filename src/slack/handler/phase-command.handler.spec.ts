import { PREVIEW_KIND } from '../../preview-gate/domain/preview-action.type';
import { PhaseCommandHandler } from './phase-command.handler';

describe('PhaseCommandHandler', () => {
  it('/po-eval 승인 카드에 요약과 저장할 이력서 기록을 함께 보여 준다', async () => {
    const output = {
      range: 'TODAY',
      sourceAgentRuns: {},
      qualitative: { summary: '평가 요약', wins: [], blockers: [] },
      careerLog: {
        schemaVersion: 1,
        period: '2026-11-04',
        achievements: { quantitative: ['PR 3건 머지'], qualitative: [] },
        technologies: ['NestJS'],
        impact: '시간 단축',
      },
    };
    const execute = jest
      .fn()
      .mockResolvedValue({ result: output, agentRunId: 1 });
    const createPreview = jest.fn().mockResolvedValue({ id: 'preview-1' });
    const humanize = jest.fn().mockImplementation(async (fields) => fields);
    const handler = new PhaseCommandHandler(
      { execute } as never,
      {} as never,
      { execute: createPreview } as never,
      { humanize } as never,
      { get: () => 'page-1' } as never,
    );
    const commands = new Map<string, (args: never) => Promise<void>>();
    handler.register({
      command: (name: string, callback: (args: never) => Promise<void>) => {
        commands.set(name, callback);
      },
    } as never);
    const respond = jest.fn();

    await commands.get('/po-eval')!({
      ack: jest.fn(),
      command: { text: 'today', user_id: 'U1' },
      respond,
    } as never);

    expect(createPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: PREVIEW_KIND.PO_EVAL_CAREERLOG,
        previewText: expect.stringContaining('PR 3건 머지'),
      }),
    );
    expect(respond.mock.calls[0][0].text).toContain('평가 요약');
    expect(respond.mock.calls[0][0].text).toContain('이력서 기록 초안');
    expect(respond.mock.calls[0][0].text).toContain('PR 3건 머지');
  });
});
