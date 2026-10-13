import { GamejobSource } from './gamejob.source';

describe('GamejobSource', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });
  it('posts the ordered duty list', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, text: async () => '<html></html>' });
    const result = await new GamejobSource().fetchLatest(2);
    expect(result.received).toBe(0);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://www.gamejob.co.kr/Recruit/_GI_Job_List/',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('page=2&direct=0&order=3&pagesize=40'),
      }),
    );
  });
});
