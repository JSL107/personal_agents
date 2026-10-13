import { fetchTextWithRetry } from './fetch-text-with-retry';

describe('fetchTextWithRetry', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });
  it('retries 429 then returns text', async () => {
    jest.useFakeTimers();
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({ ok: true, text: async () => 'ok' });
    const result = fetchTextWithRetry({
      url: 'https://example.com',
      timeoutMs: 10,
      headers: {},
      label: 'test',
    });
    await jest.runAllTimersAsync();
    expect(await result).toBe('ok');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
  it('does not retry permanent 4xx', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });
    await expect(
      fetchTextWithRetry({
        url: 'https://example.com',
        timeoutMs: 10,
        headers: {},
        label: 'test',
      }),
    ).rejects.toThrow('404');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
