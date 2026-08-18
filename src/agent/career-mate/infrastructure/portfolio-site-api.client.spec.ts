import { ConfigService } from '@nestjs/config';

import { PortfolioSiteApiClient } from './portfolio-site-api.client';

const ENV: Record<string, string> = {
  PORTFOLIO_SITE_URL: 'https://portfolio.example.com',
  PORTFOLIO_AUTOMATION_TOKEN: 'automation-token',
};

const createClient = (env: Record<string, string> = ENV) =>
  new PortfolioSiteApiClient({
    get: (key: string) => env[key],
  } as unknown as ConfigService);

const mockFetch = (impl: jest.Mock): jest.Mock => {
  global.fetch = impl as unknown as typeof fetch;
  return impl;
};

const jsonResponse = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

describe('PortfolioSiteApiClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('사이트 주소 하나로 /backend 프록시를 거쳐 호출하고 자동화 헤더를 싣는다', async () => {
    const fetchMock = mockFetch(
      jest.fn().mockResolvedValue(jsonResponse({ projects: [] })),
    );

    await createClient().listProjects();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://portfolio.example.com/backend/me/projects');
    expect(init.headers['x-automation-token']).toBe('automation-token');
  });

  it('정상 wrapper 응답을 프로젝트 목록으로 읽는다', async () => {
    mockFetch(
      jest.fn().mockResolvedValue(
        jsonResponse({
          projects: [
            {
              id: 'p1',
              slug: 'repo-pr-1',
              published: true,
              data: { title: 'A' },
            },
          ],
        }),
      ),
    );

    const projects = await createClient().listProjects();

    expect(projects).toEqual([
      { id: 'p1', slug: 'repo-pr-1', published: true, data: { title: 'A' } },
    ]);
  });

  it('배열이 아닌 응답을 빈 목록으로 삼키지 않고 끊는다', async () => {
    // 비정상 200 이나 계약 변경을 "기존 항목 없음" 으로 오판하면 이미 있는 항목을 다시 만든다.
    mockFetch(jest.fn().mockResolvedValue(jsonResponse({ ok: true })));

    await expect(createClient().listProjects()).rejects.toThrow(
      /projects 배열 없음/,
    );
  });

  it('스킬 그룹 목록도 같은 계약으로 끊는다 (유니크 제약이 없어 중복이 쌓인다)', async () => {
    mockFetch(jest.fn().mockResolvedValue(jsonResponse({ skillGroups: null })));

    await expect(createClient().listSkillGroups()).rejects.toThrow(
      /skillGroups 배열 없음/,
    );
  });

  it('목록 원소 중 형태가 어긋난 것은 버리고 나머지를 살린다', async () => {
    mockFetch(
      jest.fn().mockResolvedValue(
        jsonResponse({
          projects: [
            { id: 'p1', slug: 'ok-pr-1', data: {} },
            { slug: 'id-없음' },
            null,
          ],
        }),
      ),
    );

    const projects = await createClient().listProjects();

    expect(projects.map((project) => project.slug)).toEqual(['ok-pr-1']);
  });

  it('생성 응답에 id·slug 가 없으면 성공으로 읽지 않는다', async () => {
    mockFetch(jest.fn().mockResolvedValue(jsonResponse({ created: true })));

    await expect(createClient().createProject({ title: 'A' })).rejects.toThrow(
      /프로젝트 응답 형식/,
    );
  });

  it('HTTP 실패는 상태코드와 본문을 담아 끊는다', async () => {
    mockFetch(
      jest.fn().mockResolvedValue(jsonResponse({ message: 'conflict' }, 409)),
    );

    await expect(createClient().createProject({ title: 'A' })).rejects.toThrow(
      /HTTP 409/,
    );
  });

  it('자동화 토큰이 없으면 호출조차 하지 않는다', async () => {
    const fetchMock = mockFetch(jest.fn());

    await expect(
      createClient({
        PORTFOLIO_SITE_URL: ENV.PORTFOLIO_SITE_URL,
      }).listProjects(),
    ).rejects.toThrow(/PORTFOLIO_AUTOMATION_TOKEN/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('사이트 주소 끝 슬래시를 중복시키지 않는다', async () => {
    const fetchMock = mockFetch(
      jest.fn().mockResolvedValue(jsonResponse({ projects: [] })),
    );

    await createClient({
      ...ENV,
      PORTFOLIO_SITE_URL: 'https://portfolio.example.com/',
    }).listProjects();

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://portfolio.example.com/backend/me/projects',
    );
  });
});
