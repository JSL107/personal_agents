import { ConfigService } from '@nestjs/config';

import * as transcriptReader from '../infrastructure/work-session-transcript.reader';
import {
  kstStartOfDay,
  previousWeekdayMorningKst,
  WorkSessionDigestService,
} from './work-session-digest.service';

describe('work session KST boundaries', () => {
  it.each([
    ['2026-10-12T01:00:00Z', '2026-10-09T00:00:00Z'],
    ['2026-10-13T01:00:00Z', '2026-10-12T00:00:00Z'],
    ['2026-10-10T01:00:00Z', '2026-10-09T00:00:00Z'],
    ['2026-10-11T01:00:00Z', '2026-10-09T00:00:00Z'],
  ])('previous weekday morning for %s', (now, expected) => {
    expect(previousWeekdayMorningKst(new Date(now)).getTime()).toBe(
      new Date(expected).getTime(),
    );
  });

  it('KST midnight changes at 15:00 UTC', () => {
    expect(kstStartOfDay(new Date('2026-10-14T14:59:59Z')).toISOString()).toBe(
      '2026-10-13T15:00:00.000Z',
    );
    expect(kstStartOfDay(new Date('2026-10-14T15:00:00Z')).toISOString()).toBe(
      '2026-10-14T15:00:00.000Z',
    );
  });
});

describe('WorkSessionDigestService owner gate', () => {
  const OWNER = 'U_OWNER';
  // 존재하지 않는 경로 — 소유자일 때도 빈 배열이지만 리더까지 내려갔는지는 spy 로 본다.
  const config = {
    claudeProjectsDir: '/nonexistent/claude',
    codexSessionsDir: '/nonexistent/codex',
  };
  const buildService = (owner: string | undefined) =>
    new WorkSessionDigestService(config, {
      get: jest.fn().mockReturnValue(owner),
    } as unknown as ConfigService);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('소유자가 부른 경우에만 세션 기록을 읽는다', () => {
    const readSpy = jest
      .spyOn(transcriptReader, 'readWorkSessionDigests')
      .mockReturnValue([]);
    const since = new Date('2026-10-14T00:00:00Z');

    buildService(OWNER).listSince({ since, slackUserId: OWNER });

    expect(readSpy).toHaveBeenCalledWith({ ...config, since });
  });

  // 세션 본문에는 회사 코드 대화까지 담긴다 — 다른 사람이 /today 를 부르면 그 사람 계획에 실리면 안 된다.
  it.each([
    ['다른 사용자', OWNER, 'U_OTHER'],
    ['소유자 미설정', undefined, OWNER],
    ['소유자 공백', '  ', OWNER],
  ])('%s 이면 읽지 않고 빈 배열', (_label, owner, caller) => {
    const readSpy = jest.spyOn(transcriptReader, 'readWorkSessionDigests');

    expect(
      buildService(owner).listSince({
        since: new Date('2026-10-14T00:00:00Z'),
        slackUserId: caller,
      }),
    ).toEqual([]);
    expect(readSpy).not.toHaveBeenCalled();
  });
});
