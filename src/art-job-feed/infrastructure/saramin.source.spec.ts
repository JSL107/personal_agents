import { ConfigService } from '@nestjs/config';

import { SaraminSource } from './saramin.source';

describe('SaraminSource', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('skips the network when the key is blank', async () => {
    global.fetch = jest.fn();
    const configService = {
      get: jest.fn().mockReturnValue('   '),
    } as unknown as ConfigService;
    expect(await new SaraminSource(configService).fetchLatest(1)).toEqual({
      received: 0,
      listings: [],
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('requests the documented search parameters', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ jobs: { job: [] } }),
    });
    const configService = {
      get: jest.fn().mockReturnValue(' secret '),
    } as unknown as ConfigService;
    await new SaraminSource(configService).fetchLatest(2);
    const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBeInstanceOf(URL);
    expect(url.searchParams.get('access-key')).toBe('secret');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      job_mid_cd: '15',
      job_cd: '1562+1477',
      sort: 'pd',
      count: '40',
      start: '1',
    });
    expect(options).toMatchObject({
      redirect: 'manual',
      headers: { Accept: 'application/json' },
    });
  });

  it('rejects redirects without exposing the key', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 307 });
    const configService = {
      get: jest.fn().mockReturnValue('private-key'),
    } as unknown as ConfigService;
    await expect(
      new SaraminSource(configService).fetchLatest(1),
    ).rejects.toThrow('사람인 인증 실패(리다이렉트)');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('redacts fetch errors that contain the request URL', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('access-key=private-key'));
    const configService = {
      get: jest.fn().mockReturnValue('private-key'),
    } as unknown as ConfigService;
    await expect(
      new SaraminSource(configService).fetchLatest(1),
    ).rejects.toThrow('사람인 요청 실패');
  });
});
