import { basename, dirname } from 'node:path';

import type { ConsumeDeps, EnqueueDeps } from './inject-queue';
import { consumeInject, enqueueInject } from './inject-queue';

function memoryFs() {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const enqueue: EnqueueDeps = {
    injectDir: '/q',
    now: () => 1000,
    seq: (() => {
      let n = 0;
      return () => String(n++);
    })(),
    mkdir: (dir) => {
      dirs.add(dir);
    },
    writeFile: (path, data) => {
      files.set(path, data);
    },
  };
  const consume: ConsumeDeps = {
    injectDir: '/q',
    // 구현이 node:path join 으로 경로를 만들므로 구분자는 플랫폼마다 다르다.
    // 문자열 prefix 대신 dirname/basename 으로 비교해야 Windows 에서도 맞는다.
    readdir: (dir) => {
      return [...files.keys()]
        .filter((filePath) => dirname(filePath) === dir)
        .map((filePath) => basename(filePath));
    },
    readFile: (path) => files.get(path) ?? null,
    removeFile: (path) => {
      files.delete(path);
    },
    rmdir: (dir) => {
      dirs.delete(dir);
    },
  };
  return { files, dirs, enqueue, consume };
}

describe('inject-queue', () => {
  it('enqueue 후 같은 sessionId 로 consume 하면 지시 반환', () => {
    const fs = memoryFs();
    expect(
      enqueueInject(
        4242,
        { instruction: '테스트 고쳐', sessionId: 's1', source: 'claude' },
        fs.enqueue,
      ),
    ).toBe(true);
    const result = consumeInject(4242, 's1', fs.consume);
    expect(result).toBe('테스트 고쳐');
  });

  it('consume 는 once — 두 번째 호출은 null', () => {
    const fs = memoryFs();
    enqueueInject(
      4242,
      { instruction: '한 번만', sessionId: 's1', source: 'claude' },
      fs.enqueue,
    );
    expect(consumeInject(4242, 's1', fs.consume)).toBe('한 번만');
    expect(consumeInject(4242, 's1', fs.consume)).toBeNull();
  });

  it('sessionId 불일치 항목은 전달 안 하고 정리', () => {
    const fs = memoryFs();
    enqueueInject(
      4242,
      { instruction: '남의 것', sessionId: 'other', source: 'claude' },
      fs.enqueue,
    );
    expect(consumeInject(4242, 's1', fs.consume)).toBeNull();
    expect(fs.files.size).toBe(0);
  });

  it('잘못된 pid/빈 instruction 은 조용히 무시', () => {
    const fs = memoryFs();
    expect(
      enqueueInject(
        0,
        { instruction: 'x', sessionId: 's1', source: 'claude' },
        fs.enqueue,
      ),
    ).toBe(false);
    expect(
      enqueueInject(
        4242,
        { instruction: '', sessionId: 's1', source: 'claude' },
        fs.enqueue,
      ),
    ).toBe(false);
    expect(fs.files.size).toBe(0);
  });

  it('오래된 항목부터 FIFO 로 consume', () => {
    const fs = memoryFs();
    enqueueInject(
      4242,
      { instruction: '먼저', sessionId: 's1', source: 'claude' },
      fs.enqueue,
    );
    enqueueInject(
      4242,
      { instruction: '나중', sessionId: 's1', source: 'claude' },
      fs.enqueue,
    );
    expect(consumeInject(4242, 's1', fs.consume)).toBe('먼저');
    expect(consumeInject(4242, 's1', fs.consume)).toBe('나중');
  });
});
