import { claimRoutingContext, runWithRoutingContext } from './routing-context';

describe('runWithRoutingContext — onUnclaimed', () => {
  const context = {
    text: '이거 왜 늦어',
    routedTo: 'DELAY_REPORT',
    routedVia: 'classifier' as const,
  };

  it('아무도 근거를 집어 가지 않으면 결과와 함께 onUnclaimed 를 부른다', async () => {
    const onUnclaimed = jest.fn();

    const result = await runWithRoutingContext(
      context,
      async () => 'done',
      onUnclaimed,
    );

    expect(result).toBe('done');
    expect(onUnclaimed).toHaveBeenCalledWith('done');
  });

  it('근거를 집어 갔으면 onUnclaimed 를 부르지 않는다', async () => {
    const onUnclaimed = jest.fn();

    await runWithRoutingContext(
      context,
      async () => {
        claimRoutingContext();
        return 'done';
      },
      onUnclaimed,
    );

    expect(onUnclaimed).not.toHaveBeenCalled();
  });

  it('run 이 던지면 onUnclaimed 를 부르지 않고 예외를 그대로 올린다', async () => {
    const onUnclaimed = jest.fn();
    const bomb = new Error('dispatch 실패');

    await expect(
      runWithRoutingContext(
        context,
        async () => {
          throw bomb;
        },
        onUnclaimed,
      ),
    ).rejects.toBe(bomb);
    expect(onUnclaimed).not.toHaveBeenCalled();
  });

  it('onUnclaimed 가 던져도 성공한 결과를 그대로 돌려준다', async () => {
    const result = await runWithRoutingContext(
      context,
      async () => 'done',
      () => {
        throw new Error('기록 실패');
      },
    );

    expect(result).toBe('done');
  });
});
