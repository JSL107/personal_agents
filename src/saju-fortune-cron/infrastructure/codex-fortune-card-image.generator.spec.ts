import { extractThreadId } from './codex-fortune-card-image.generator';

describe('extractThreadId', () => {
  it('thread.started 이벤트의 thread id 를 읽는다', () => {
    const output = [
      'warning: something',
      '{"type":"thread.started","thread_id":"01a199b3-edb3-74d1-9755-2504f9974f70"}',
      '{"type":"turn.started"}',
    ].join('\n');

    expect(extractThreadId(output)).toBe(
      '01a199b3-edb3-74d1-9755-2504f9974f70',
    );
  });

  it('경로 조각으로 위험한 값은 받지 않는다', () => {
    expect(
      extractThreadId('{"type":"thread.started","thread_id":"../../etc"}'),
    ).toBeUndefined();
  });

  it('이벤트가 없으면 undefined', () => {
    expect(
      extractThreadId('{"type":"turn.started"}\nnot json'),
    ).toBeUndefined();
  });
});
