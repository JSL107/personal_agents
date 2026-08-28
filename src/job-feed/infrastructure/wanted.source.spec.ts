import { WantedSource } from './wanted.source';

const createJsonResponse = (body: unknown, status = 200): Response => {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
};

describe('WantedSource', () => {
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('목록 요청 URL 에 tag_type_ids=872 를 담아 개발 직군으로 좁힌다', async () => {
    fetchMock.mockResolvedValue(createJsonResponse({ data: [] }));
    const source = new WantedSource();

    await source.fetchList(1);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestedUrl] = fetchMock.mock.calls[0];
    const url = new URL(String(requestedUrl));
    expect(url.searchParams.get('tag_type_ids')).toBe('872');
  });

  it('category_tags 파라미터는 쓰지 않는다 — 전 직군이 섞여 들어온다(실측)', async () => {
    fetchMock.mockResolvedValue(createJsonResponse({ data: [] }));
    const source = new WantedSource();

    await source.fetchList(1);

    const [requestedUrl] = fetchMock.mock.calls[0];
    const url = new URL(String(requestedUrl));
    expect(url.searchParams.has('category_tags')).toBe(false);
  });

  it('페이지 번호를 offset 으로 환산해 넘긴다', async () => {
    fetchMock.mockResolvedValue(createJsonResponse({ data: [] }));
    const source = new WantedSource();

    await source.fetchList(3);

    const [requestedUrl] = fetchMock.mock.calls[0];
    const url = new URL(String(requestedUrl));
    expect(url.searchParams.get('offset')).toBe('80');
    expect(url.searchParams.get('limit')).toBe('40');
  });
});
