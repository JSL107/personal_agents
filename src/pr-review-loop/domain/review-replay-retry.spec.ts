import { retryReplayTrial } from './review-replay-retry';

describe('retryReplayTrial', () => {
  const sleep = jest.fn(() => Promise.resolve());

  beforeEach(() => sleep.mockClear());

  it('재시도할 수 있는 실패는 지정한 간격만큼 쉬고 다시 시도해 성공값을 돌려준다', async () => {
    const run = jest
      .fn()
      .mockRejectedValueOnce(new Error('capacity'))
      .mockResolvedValueOnce('ok');

    await expect(
      retryReplayTrial(run, { isRetryable: () => true, sleep }, [10, 20]),
    ).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(10);
  });

  it('간격을 다 쓰면 마지막 실패를 그대로 던진다', async () => {
    const run = jest.fn().mockRejectedValue(new Error('capacity'));

    await expect(
      retryReplayTrial(run, { isRetryable: () => true, sleep }, [10, 20]),
    ).rejects.toThrow('capacity');
    expect(run).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[10], [20]]);
  });

  it('재시도 대상이 아닌 실패(JSON 파싱 등)는 바로 던진다', async () => {
    const run = jest.fn().mockRejectedValue(new Error('parse'));

    await expect(
      retryReplayTrial(run, { isRetryable: () => false, sleep }, [10]),
    ).rejects.toThrow('parse');
    expect(run).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
