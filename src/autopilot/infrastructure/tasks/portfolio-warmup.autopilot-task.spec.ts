import { ConfigService } from '@nestjs/config';

import { PortfolioWarmupAutopilotTask } from './portfolio-warmup.autopilot-task';

const context = { ownerSlackUserId: 'U1', firedAtKst: '2026-08-18' };
const SITE_URL = 'https://portfolio.example.com';

// 기본 인자를 두지 않는다 — createFixture(undefined) 가 기본값(SITE_URL)으로 되돌아가면
// "미설정" 상황이 재현되지 않는다.
const createFixture = (siteUrl: string | undefined) => {
  const config = { get: jest.fn().mockReturnValue(siteUrl) };
  return {
    task: new PortfolioWarmupAutopilotTask(config as unknown as ConfigService),
  };
};

const mockFetch = (impl: jest.Mock): jest.Mock => {
  global.fetch = impl as unknown as typeof fetch;
  return impl;
};

describe('PortfolioWarmupAutopilotTask', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('PORTFOLIO_SITE_URL 이 없으면 호출하지 않고 skip한다', async () => {
    const { task } = createFixture(undefined);
    const fetchMock = mockFetch(jest.fn());

    await expect(task.run(context)).resolves.toEqual({ skip: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('health 가 200이면 알리지 않고 skip한다 (정상은 조용히)', async () => {
    const { task } = createFixture(SITE_URL);
    const fetchMock = mockFetch(jest.fn().mockResolvedValue({ ok: true }));

    await expect(task.run(context)).resolves.toEqual({ skip: true });
    expect(fetchMock).toHaveBeenCalledWith(
      `${SITE_URL}/backend/health`,
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('사이트 주소 끝 슬래시를 중복시키지 않는다', async () => {
    const { task } = createFixture(`${SITE_URL}/`);
    const fetchMock = mockFetch(jest.fn().mockResolvedValue({ ok: true }));

    await task.run(context);

    expect(fetchMock).toHaveBeenCalledWith(
      `${SITE_URL}/backend/health`,
      expect.anything(),
    );
  });

  it('1회 실패로는 알리지 않는다 (콜드스타트·재배포 흡수)', async () => {
    const { task } = createFixture(SITE_URL);
    mockFetch(jest.fn().mockResolvedValue({ ok: false, status: 502 }));

    await expect(task.run(context)).resolves.toEqual({ skip: true });
  });

  it('연속 2회 실패하면 사유를 담아 알린다', async () => {
    const { task } = createFixture(SITE_URL);
    mockFetch(jest.fn().mockResolvedValue({ ok: false, status: 502 }));

    await task.run(context);
    const result = await task.run(context);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('2회 연속 실패');
    expect(result.summaryText).toContain('HTTP 502');
    expect(result.summaryText).toContain(SITE_URL);
  });

  it('네트워크 예외도 사유로 옮겨 담는다', async () => {
    const { task } = createFixture(SITE_URL);
    mockFetch(
      jest.fn().mockRejectedValue(new Error('The operation timed out')),
    );

    await task.run(context);
    const result = await task.run(context);

    expect(result.summaryText).toContain('The operation timed out');
  });

  it('실패 뒤 성공하면 연속 카운터가 초기화된다', async () => {
    const { task } = createFixture(SITE_URL);
    const fetchMock = mockFetch(
      jest
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: false, status: 503 }),
    );

    await task.run(context);
    await task.run(context);
    // 카운터가 초기화됐으므로 이 실패는 다시 "1회째" — 알리지 않아야 한다.
    await expect(task.run(context)).resolves.toEqual({ skip: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
