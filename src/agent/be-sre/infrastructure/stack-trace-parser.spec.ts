import { parseStackTrace } from './stack-trace-parser';

describe('parseStackTrace', () => {
  it('일반적인 Node.js stack trace 에서 ts frame 을 추출한다', () => {
    const raw = `Error: something went wrong
    at FooService.doWork (/repo/src/foo/foo.service.ts:42:15)
    at BarController.handle (/repo/src/bar/bar.controller.ts:10:5)`;

    const frames = parseStackTrace(raw);

    expect(frames).toHaveLength(2);
    expect(frames[0].function).toBe('FooService.doWork');
    expect(frames[0].filePath).toBe('/repo/src/foo/foo.service.ts');
    expect(frames[0].line).toBe(42);
    expect(frames[0].column).toBe(15);
  });

  it('node_modules 경로 frame 은 제외한다', () => {
    const raw = `Error: crash
    at FooService.doWork (/repo/src/foo/foo.service.ts:10:3)
    at Object.<anonymous> (/repo/node_modules/express/lib/router.js:100:5)`;

    const frames = parseStackTrace(raw);

    expect(frames).toHaveLength(1);
    expect(frames[0].filePath).toBe('/repo/src/foo/foo.service.ts');
  });

  it('익명 함수 frame 은 function 이 undefined 이지만 filePath 는 추출된다', () => {
    const raw = `Error: oops
    at /repo/src/bootstrap.ts:5:10`;

    const frames = parseStackTrace(raw);

    expect(frames).toHaveLength(1);
    expect(frames[0].function).toBeUndefined();
    expect(frames[0].filePath).toBe('/repo/src/bootstrap.ts');
  });

  it('빈 입력이면 빈 배열을 반환한다', () => {
    expect(parseStackTrace('')).toEqual([]);
    expect(parseStackTrace('   ')).toEqual([]);
  });
});
