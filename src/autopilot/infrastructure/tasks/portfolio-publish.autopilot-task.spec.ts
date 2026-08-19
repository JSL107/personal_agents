import { ConfigService } from '@nestjs/config';

import { AuditResumeUsecase } from '../../../agent/career-mate/application/audit-resume.usecase';
import {
  PublishPortfolioSiteResult,
  PublishPortfolioSiteUsecase,
} from '../../../agent/career-mate/application/publish-portfolio-site.usecase';
import { ResumeAuditResult } from '../../../agent/career-mate/domain/career-mate.type';
import { PortfolioPublishAutopilotTask } from './portfolio-publish.autopilot-task';

const context = { ownerSlackUserId: 'U1', firedAtKst: '2026-08-18' };

const RESULT: PublishPortfolioSiteResult = {
  createdProjects: [],
  updatedProjects: [],
  createdSkillGroups: [],
  updatedSkillGroups: [],
  skippedTitles: [],
  failures: [],
  missingAfterPublish: [],
  agentRunId: 1,
};

const AUDIT_RESULT: ResumeAuditResult = {
  verdict: '증거가 확인된다.',
  items: [],
  highlights: [],
  jdFindings: [],
  rejectionRisks: [],
  guard: {
    demotedTitles: [],
    droppedTitles: [],
    unjudgedTitles: [],
    forcedMissing: [],
    rewriteMissing: [],
    droppedHighlights: [],
  },
  jdSource: null,
};

const createFixture = (
  result: Partial<PublishPortfolioSiteResult> = {},
  env: Record<string, string | undefined> = {
    PORTFOLIO_SITE_URL: 'https://portfolio.example.com',
    PORTFOLIO_AUTOMATION_TOKEN: 'token',
  },
) => {
  const publish = {
    execute: jest.fn().mockResolvedValue({ ...RESULT, ...result }),
  };
  const audit = {
    execute: jest.fn().mockResolvedValue({
      result: AUDIT_RESULT,
      modelUsed: 'codex-cli',
      agentRunId: 2,
    }),
  };
  const config = { get: jest.fn((key: string) => env[key]) };
  return {
    task: new PortfolioPublishAutopilotTask(
      publish as unknown as PublishPortfolioSiteUsecase,
      audit as unknown as AuditResumeUsecase,
      config as unknown as ConfigService,
    ),
    publish,
    audit,
  };
};

describe('PortfolioPublishAutopilotTask', () => {
  it('자동화 토큰이 없으면 발행을 시도하지 않는다', async () => {
    const { task, publish, audit } = createFixture(
      {},
      {
        PORTFOLIO_SITE_URL: 'https://portfolio.example.com',
      },
    );

    await expect(task.run(context)).resolves.toEqual({ skip: true });
    expect(publish.execute).not.toHaveBeenCalled();
    expect(audit.execute).not.toHaveBeenCalled();
  });

  it('사이트 주소가 없으면 발행을 시도하지 않는다', async () => {
    const { task, publish, audit } = createFixture(
      {},
      {
        PORTFOLIO_AUTOMATION_TOKEN: 'token',
      },
    );

    await expect(task.run(context)).resolves.toEqual({ skip: true });
    expect(publish.execute).not.toHaveBeenCalled();
    expect(audit.execute).not.toHaveBeenCalled();
  });

  it('갱신만 있는 날은 보고하지 않는다 (같은 성과를 매일 다시 밀어 넣으므로)', async () => {
    const { task } = createFixture({ updatedProjects: ['a-pr-1', 'b-pr-2'] });

    await expect(task.run(context)).resolves.toEqual({ skip: true });
  });

  it('새 프로젝트가 생기면 비공개 초안임을 함께 알린다', async () => {
    const { task } = createFixture({ createdProjects: ['a-pr-1'] });

    const result = await task.run(context);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('새 프로젝트 1건');
    expect(result.summaryText).toContain('비공개 초안');
    expect(result.detailText).toContain('a-pr-1');
  });

  it('근거 PR 이 없어 건너뛴 성과도 사람에게 올린다', async () => {
    const { task } = createFixture({ skippedTitles: ['근거 없는 성과'] });

    const result = await task.run(context);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('건너뜀 1건');
    expect(result.detailText).toContain('근거 없는 성과');
  });

  it('개별 실패도 사유와 함께 올린다', async () => {
    const { task } = createFixture({
      failures: [{ target: 'project:a-pr-1', reason: 'HTTP 409' }],
    });

    const result = await task.run(context);

    expect(result.summaryText).toContain('실패 1건');
    expect(result.detailText).toContain('HTTP 409');
  });

  it('발행이 통째로 터지면 사유를 담아 알린다', async () => {
    const publish = {
      execute: jest
        .fn()
        .mockRejectedValue(new Error('PORTFOLIO_SITE_URL 미설정')),
    };
    const config = {
      get: jest.fn((key: string) =>
        key === 'PORTFOLIO_SITE_URL' ? 'https://x' : 'token',
      ),
    };
    const audit = { execute: jest.fn() };
    const task = new PortfolioPublishAutopilotTask(
      publish as unknown as PublishPortfolioSiteUsecase,
      audit as unknown as AuditResumeUsecase,
      config as unknown as ConfigService,
    );

    const result = await task.run(context);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('발행 실패');
    expect(result.summaryText).toContain('PORTFOLIO_SITE_URL 미설정');
    expect(audit.execute).not.toHaveBeenCalled();
  });

  it('성과가 모두 입증이어도 목표 공고 요건 미달은 보고한다', async () => {
    // 공고를 등록한 회차에는 이게 사용자가 가장 먼저 볼 결손인데, 발행 변화가 없고 성과가
    // 전부 PROVEN 이면 조건이 false 가 되어 감사 전체가 skip 됐다.
    const { task, audit } = createFixture();
    audit.execute.mockResolvedValueOnce({
      result: {
        ...AUDIT_RESULT,
        items: [
          {
            title: '배포 안정화',
            status: 'PROVEN',
            quote: '결과: 실패율 4%→0.5%',
            why: '정량 결과가 있다.',
            rewrite: null,
          },
        ],
        highlights: [],
        jdFindings: [
          {
            requirement: 'Kubernetes 운영 경험',
            priority: 'MUST',
            status: 'MISSING',
            quote: '',
            why: '이력서에 없다.',
          },
        ],
        jdSource: {
          company: '이대리',
          role: '백엔드',
          registeredAt: '2026-08-01T00:00:00.000Z',
        },
      },
      modelUsed: 'codex-cli',
      agentRunId: 3,
    });

    const result = await task.run(context);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('목표 공고 요건 미달 1건');
    expect(result.detailText).toContain('Kubernetes 운영 경험');
  });

  it('감사가 실패해도 기존 발행 요약과 상세를 그대로 보고한다', async () => {
    const { task, publish, audit } = createFixture({
      createdProjects: ['a-pr-1'],
    });
    audit.execute.mockRejectedValueOnce(new Error('audit timeout'));

    const result = await task.run(context);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('새 프로젝트 1건');
    expect(result.detailText).toContain('a-pr-1');
    expect(`${result.summaryText}\n${result.detailText}`).toContain(
      '감사 실패 — audit timeout',
    );
    expect(publish.execute.mock.invocationCallOrder[0]).toBeLessThan(
      audit.execute.mock.invocationCallOrder[0],
    );
  });

  it('발행 변화가 없어도 약한 성과가 있으면 감사 결과를 보고한다', async () => {
    const { task, audit } = createFixture();
    audit.execute.mockResolvedValueOnce({
      result: {
        ...AUDIT_RESULT,
        verdict: '정량 근거를 보강해야 한다.',
        items: [
          {
            title: '배포 안정화',
            status: 'WEAK',
            quote: '배포를 안정화했다.',
            why: '결과 수치와 영향 범위가 없다.',
            rewrite: {
              before: '배포를 안정화했다.',
              after:
                '배포를 안정화해 (수치 필요: 실패율과 배포 시간) 변화를 확인했다.',
              frame: 'STAR3',
            },
          },
        ],
      },
      modelUsed: 'codex-cli',
      agentRunId: 2,
    });

    const result = await task.run(context);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain(
      '이력서 감사 — 약함 1건 / 근거없음 0건 (총 1건)',
    );
    expect(result.detailText).toContain('배포 안정화');
    expect(result.detailText).toContain('결과 수치와 영향 범위가 없다.');
    expect(result.detailText).toContain('수치 필요');
  });

  it('발행 변화가 없고 감사 결과가 모두 PROVEN이면 보고하지 않는다', async () => {
    const { task, audit } = createFixture();
    audit.execute.mockResolvedValueOnce({
      result: {
        ...AUDIT_RESULT,
        items: [
          {
            title: '장애율 감소',
            status: 'PROVEN',
            quote: '장애율을 30% 줄였다.',
            why: '정량 결과가 있다.',
            rewrite: null,
          },
        ],
      },
      modelUsed: 'codex-cli',
      agentRunId: 2,
    });

    await expect(task.run(context)).resolves.toEqual({ skip: true });
  });

  it('발행 변화가 없어도 미판정·폐기 같은 guard 이상 징후를 보고한다', async () => {
    const { task, audit } = createFixture();
    audit.execute.mockResolvedValueOnce({
      result: {
        ...AUDIT_RESULT,
        items: [
          {
            title: '모델 누락 성과',
            status: 'UNJUDGED',
            quote: '',
            why: '모델이 이 성과를 판정하지 않았습니다.',
            rewrite: null,
          },
        ],
        guard: {
          ...AUDIT_RESULT.guard,
          droppedTitles: ['환각 성과'],
          unjudgedTitles: ['모델 누락 성과'],
        },
      },
      modelUsed: 'codex-cli',
      agentRunId: 2,
    });

    const result = await task.run(context);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('가드 경고');
    expect(result.detailText).toContain('미판정');
    expect(result.detailText).toContain('폐기 1 / 누락 1');
  });

  it('재조회에서 발행분이 확인되면 그 사실을 적는다', async () => {
    const { task } = createFixture({
      createdProjects: ['a-pr-1'],
      missingAfterPublish: [],
    });

    const result = await task.run(context);

    expect(result.detailText).toContain('재조회에서 발행분 전부 확인');
  });

  it('재조회에 없는 항목은 갱신만 있는 날에도 보고한다', async () => {
    // 갱신만 있으면 원래 조용히 넘기지만, 저장이 실제로 안 된 신호는 삼키지 않는다.
    const { task } = createFixture({
      updatedProjects: ['a-pr-1'],
      missingAfterPublish: ['a-pr-1'],
    });

    const result = await task.run(context);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('재조회에 없는 항목 1건');
    expect(result.detailText).toContain('실제로 안 됐을 수 있다');
  });
});
