import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Logger } from '@nestjs/common';

import {
  buildSlackSendRecord,
  recordSlackSendLength,
} from './slack-send-length.recorder';

describe('buildSlackSendRecord', () => {
  const at = new Date('2026-09-18T13:10:03.000Z');

  it('구분선으로 이어 붙인 cron 요약의 조각 수를 센다', () => {
    const merged = ['첫 task 요약', '둘째 task 요약', '셋째 task 요약'].join(
      '\n\n────────\n\n',
    );

    const record = buildSlackSendRecord({ text: merged, origin: 'push', at });

    expect(record.parts).toBe(3);
    expect(record.chars).toBe(merged.length);
  });

  it('구분선이 없는 메시지는 조각 1 로 센다', () => {
    const record = buildSlackSendRecord({
      text: '📊 채택률 이상 없음',
      origin: 'push',
      at,
    });

    expect(record.parts).toBe(1);
  });

  it('머리말은 개행을 공백으로 눕히고 60자에서 자른다', () => {
    const text = `🌙 어제 운영 장애 2건 수습\n\n삭제된 기수를 참조하던 데이터가 원인이었고 ${'긴꼬리'.repeat(20)}`;

    const record = buildSlackSendRecord({ text, origin: 'push-thread', at });

    expect(record.head).toHaveLength(60);
    expect(record.head).not.toContain('\n');
    expect(record.head.startsWith('🌙 어제 운영 장애 2건 수습 삭제된')).toBe(
      true,
    );
  });

  it('발송 경로와 block 수를 그대로 남기고, block 이 없으면 0 으로 센다', () => {
    const card = buildSlackSendRecord({
      text: 'PR #2808 을 코드 리뷰할까요?',
      origin: 'card',
      blocks: 3,
      at,
    });
    const plain = buildSlackSendRecord({
      text: '한 줄 보고',
      origin: 'reply',
      at,
    });

    expect(card).toMatchObject({ origin: 'card', blocks: 3 });
    expect(plain).toMatchObject({ origin: 'reply', blocks: 0 });
    expect(card.at).toBe('2026-09-18T13:10:03.000Z');
  });

  // 조각 수는 §4 재판단의 판단 축이라(하나가 긴가 vs 여럿 붙어 긴가) 부풀면 처방이 갈린다.
  // 줄 전체가 구분선인 경우만 세는지 경계에서 고정한다.
  it('줄 안에 섞인 구분선과 더 긴 가로줄은 조각으로 세지 않는다', () => {
    const inline = buildSlackSendRecord({
      text: '앞말 ──────── 뒷말',
      origin: 'push',
      at,
    });
    const longerRule = buildSlackSendRecord({
      text: '본문\n──────────\n이어지는 본문',
      origin: 'push',
      at,
    });

    expect(inline.parts).toBe(1);
    expect(longerRule.parts).toBe(1);
  });

  it('한 task 가 요약 안에 구분선을 쓰면 그 조각도 센다', () => {
    // weekly-summary.autopilot-task.ts:167 — 단독 발송인데도 요약 내부에 구분선이 있다.
    // parts 는 "task 수" 가 아니라 "붙여 보낸 조각 수" 라는 뜻을 여기서 고정한다.
    const singleTask = buildSlackSendRecord({
      text: '주간 워크로그\n\n회복 건강 한 줄\n\n────────\n\nCEO 요약',
      origin: 'push',
      at,
    });

    expect(singleTask.parts).toBe(2);
  });
});

describe('recordSlackSendLength', () => {
  let workingDirectory: string;
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    workingDirectory = mkdtempSync(join(tmpdir(), 'slack-send-length-'));
    jest.spyOn(process, 'cwd').mockReturnValue(workingDirectory);
    originalNodeEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    jest.restoreAllMocks();
  });

  it('테스트 환경에서는 한 줄도 남기지 않는다', () => {
    // 이 가드가 빠지면 spec 수천 건의 문자열이 실제 길이 분포에 섞인다.
    process.env.NODE_ENV = 'test';

    recordSlackSendLength({ text: '테스트 문자열', origin: 'push' });

    expect(() =>
      readFileSync(join(workingDirectory, 'logs/slack-send.jsonl')),
    ).toThrow();
  });

  it('테스트 밖에서는 발송 한 건당 JSON 한 줄을 남긴다', () => {
    process.env.NODE_ENV = 'production';

    recordSlackSendLength({
      text: '첫 조각\n\n────────\n\n둘째 조각',
      origin: 'push',
      blocks: 2,
    });

    const written = readFileSync(
      join(workingDirectory, 'logs/slack-send.jsonl'),
      'utf8',
    );
    expect(written.trimEnd().split('\n')).toHaveLength(1);
    expect(JSON.parse(written)).toMatchObject({
      origin: 'push',
      parts: 2,
      blocks: 2,
    });
  });

  // 경고 1회 제한은 모듈 수준 플래그라 파일 안에서 한 번만 소진된다 — 쓰기를 실패시키는
  // 케이스는 이 하나뿐이어야 한다. 실패 케이스를 더 넣으려면 플래그가 이미 서 있음을 감안할 것.
  it('기록에 실패해도 발송을 막지 않고 경고는 첫 1회만 남긴다', () => {
    // 완전히 조용하면 하루를 기다린 끝에 빈 파일을 보게 되고, 매번 경고하면 발송마다
    // 같은 줄이 쌓여 진짜 경고를 덮는다.
    process.env.NODE_ENV = 'production';
    writeFileSync(join(workingDirectory, 'logs'), '디렉토리 자리를 막는다');
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    expect(() => {
      recordSlackSendLength({ text: '첫 실패', origin: 'push' });
      recordSlackSendLength({ text: '둘째', origin: 'push' });
      recordSlackSendLength({ text: '셋째', origin: 'push' });
    }).not.toThrow();

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('디렉토리가 없으면 만들어 쓴다', () => {
    process.env.NODE_ENV = 'production';
    const nested = join(workingDirectory, 'nested');
    mkdirSync(nested);
    jest.spyOn(process, 'cwd').mockReturnValue(nested);

    recordSlackSendLength({ text: '한 줄', origin: 'reply' });

    expect(
      readFileSync(join(nested, 'logs/slack-send.jsonl'), 'utf8'),
    ).toContain('"origin":"reply"');
  });
});
