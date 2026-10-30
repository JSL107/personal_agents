import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConfigService } from '@nestjs/config';

import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { getRealHomeDir } from '../../model-router/infrastructure/cli-process.util';
import { SlackDeliveryRepositoryPort } from '../../slack/domain/port/slack-delivery.repository.port';
import { LocalRepoSnapshotService } from '../infrastructure/local-repo-snapshot.service';
import { ConversationLookupService } from './conversation-lookup.service';

describe('ConversationLookupService', () => {
  const get = jest.fn();
  const findActiveRuns = jest.fn();
  const findFinishedRunsSince = jest.fn();
  const findRecent = jest.fn();
  const acquire = jest.fn();
  const service = new ConversationLookupService(
    { get } as unknown as ConfigService,
    { findActiveRuns, findFinishedRunsSince } as unknown as AgentRunService,
    { findRecent } as unknown as SlackDeliveryRepositoryPort,
    { acquire } as unknown as LocalRepoSnapshotService,
  );

  beforeEach(() => {
    get
      .mockReset()
      .mockImplementation((key: string) =>
        key === 'AUTOPILOT_OWNER_SLACK_USER_ID' ? 'U_OWNER' : undefined,
      );
    findActiveRuns.mockReset().mockResolvedValue([]);
    findFinishedRunsSince.mockReset().mockResolvedValue([]);
    findRecent.mockReset().mockResolvedValue([]);
    acquire.mockReset().mockResolvedValue(null);
  });

  it('owner 가 아니면 원장·발송 기록·읽기 폴더를 모두 숨긴다', async () => {
    const result = await service.collect({ slackUserId: 'U_OTHER' });

    expect(result).toEqual({
      readableRoots: [],
      rootGuide: [],
      release: expect.any(Function),
    });
    expect(findActiveRuns).not.toHaveBeenCalled();
    expect(findRecent).not.toHaveBeenCalled();
    expect(acquire).not.toHaveBeenCalled();
  });

  it('owner env 가 없으면 조회를 끈다', async () => {
    get.mockReturnValue(undefined);

    const result = await service.collect({ slackUserId: 'U_OWNER' });

    expect(result.readableRoots).toEqual([]);
    expect(findActiveRuns).not.toHaveBeenCalled();
  });

  it('원장·발송 기록을 각각 외부 입력 경계로 감싼 한 블록 텍스트로 만든다', async () => {
    findActiveRuns.mockResolvedValue([
      {
        agentType: 'PM',
        status: 'IN_PROGRESS',
        startedAt: new Date('2026-10-30T00:00:00Z'),
      },
    ]);
    findFinishedRunsSince.mockResolvedValue([
      {
        agentType: 'BLOG',
        status: 'FAILED',
        summary: '실패 사유',
        endedAt: new Date('2026-10-30T00:01:00Z'),
      },
    ]);
    findRecent.mockResolvedValue([
      {
        kind: 'morning',
        status: 'SUPPRESSED',
        textPreview: '미리보기',
        createdAt: new Date('2026-10-30T00:02:00Z'),
      },
    ]);

    const result = await service.collect({ slackUserId: 'U_OWNER' });

    expect(result.ledgerText).toContain('PM · IN_PROGRESS');
    expect(result.ledgerText).toContain('BLOG · FAILED · 실패 사유');
    expect(result.deliveryText).toContain('morning · SUPPRESSED · 미리보기');
    expect(result.ledgerText).toContain('<untrusted-input>');
    expect(result.deliveryText).toContain('<untrusted-input>');
    expect(findFinishedRunsSince).toHaveBeenCalledWith({
      since: expect.any(Date),
      limit: 10,
    });
    expect(findRecent).toHaveBeenCalledWith({
      since: expect.any(Date),
      limit: 10,
    });
  });

  it('원장 조회가 실패해도 발송 기록과 레포 사본은 돌려준다', async () => {
    findActiveRuns.mockRejectedValue(new Error('DB unavailable'));
    findRecent.mockResolvedValue([
      {
        kind: 'morning',
        status: 'SENT',
        textPreview: '발송',
        createdAt: new Date('2026-10-30T00:02:00Z'),
      },
    ]);
    const release = jest.fn();
    acquire.mockResolvedValue({ root: '/tmp/repo-snapshot', release });

    const result = await service.collect({ slackUserId: 'U_OWNER' });

    expect(result.ledgerText).toBeUndefined();
    expect(result.deliveryText).toContain('발송');
    expect(result.readableRoots).toEqual(['/tmp/repo-snapshot']);
    result.release();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('Hermes 폴더는 절대경로 디렉터리의 realpath 만 허용한다', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hermes-lookup-'));
    const output = join(root, 'output');
    const alias = join(root, 'alias');
    await mkdir(output);
    await symlink(output, alias);
    get.mockImplementation((key: string) =>
      key === 'AUTOPILOT_OWNER_SLACK_USER_ID' ? 'U_OWNER' : alias,
    );
    try {
      const result = await service.collect({ slackUserId: 'U_OWNER' });
      expect(result.readableRoots).toEqual([await realpath(output)]);
      expect(result.rootGuide[0]).toContain('Hermes cron');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('Hermes 폴더 직속에 비밀 설정 파일이 있으면 열지 않는다', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hermes-lookup-'));
    await writeFile(join(root, 'auth.json'), '{}');
    get.mockImplementation((key: string) =>
      key === 'AUTOPILOT_OWNER_SLACK_USER_ID' ? 'U_OWNER' : root,
    );
    try {
      const result = await service.collect({ slackUserId: 'U_OWNER' });
      expect(result.readableRoots).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('HOME 와 ~/.hermes 및 HOME 상위 경로는 읽기 폴더로 열지 않는다', async () => {
    const home = await realpath(getRealHomeDir());
    for (const forbidden of [home, join(home, '.hermes'), join(home, '..')]) {
      get.mockImplementation((key: string) =>
        key === 'AUTOPILOT_OWNER_SLACK_USER_ID' ? 'U_OWNER' : forbidden,
      );
      const result = await service.collect({ slackUserId: 'U_OWNER' });
      expect(result.readableRoots).toEqual([]);
    }
  });

  it('Hermes 경로가 상대경로나 일반 파일이면 열지 않는다', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hermes-lookup-'));
    const file = join(root, 'output.md');
    await writeFile(file, '기록');
    try {
      for (const configured of ['relative/output', file]) {
        get.mockImplementation((key: string) =>
          key === 'AUTOPILOT_OWNER_SLACK_USER_ID' ? 'U_OWNER' : configured,
        );
        const result = await service.collect({ slackUserId: 'U_OWNER' });
        expect(result.readableRoots).toEqual([]);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
