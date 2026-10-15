import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  WORK_SESSION_FILE_TAIL_BYTES,
  WORK_SESSION_MAX_FILES,
} from '../domain/work-session-digest';
import { readWorkSessionDigests } from './work-session-transcript.reader';

describe('readWorkSessionDigests', () => {
  const since = new Date('2026-10-14T00:00:00.000Z');
  const sessionId = '11111111-1111-4111-8111-111111111111';
  let root: string;
  let claudeProjectsDir: string;
  let codexSessionsDir: string;

  const read = () =>
    readWorkSessionDigests({ claudeProjectsDir, codexSessionsDir, since });

  const claudeLine = (prompt: string) =>
    JSON.stringify({
      type: 'user',
      timestamp: '2026-10-14T10:00:00.000Z',
      origin: { kind: 'human' },
      message: { role: 'user', content: prompt },
      cwd: '/repo/personal_agents',
    });

  const codexLines = (prompt: string) =>
    [
      JSON.stringify({
        type: 'session_meta',
        payload: {
          id: sessionId,
          cwd: '/repo/personal_agents',
          source: 'cli',
        },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-10-14T10:00:00.000Z',
        payload: {
          type: 'item_completed',
          item: {
            type: 'UserMessage',
            content: [{ type: 'text', text: prompt }],
          },
        },
      }),
    ].join('\n');

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'work-session-reader-'));
    claudeProjectsDir = join(root, 'claude');
    codexSessionsDir = join(root, 'codex');
    mkdirSync(claudeProjectsDir);
    mkdirSync(codexSessionsDir);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('Claude UUID 파일만 읽고 subagents 및 심볼릭 링크는 건너뛴다', () => {
    const projectDirectory = join(claudeProjectsDir, 'project');
    const subagentDirectory = join(projectDirectory, 'subagents');
    mkdirSync(projectDirectory);
    mkdirSync(subagentDirectory);
    writeFileSync(
      join(projectDirectory, `${sessionId}.jsonl`),
      claudeLine('정상 요청'),
    );
    writeFileSync(
      join(projectDirectory, 'not-a-uuid.jsonl'),
      claudeLine('잘못된 파일명'),
    );
    writeFileSync(
      join(subagentDirectory, `${sessionId}.jsonl`),
      claudeLine('하위 작업'),
    );
    symlinkSync(
      join(projectDirectory, `${sessionId}.jsonl`),
      join(projectDirectory, '22222222-2222-4222-8222-222222222222.jsonl'),
    );

    expect(read().map((session) => session.firstPrompt)).toEqual(['정상 요청']);
  });

  it('오래된 mtime 파일은 Claude·Codex 모두 읽지 않는다', () => {
    const projectDirectory = join(claudeProjectsDir, 'project');
    mkdirSync(projectDirectory);
    const oldTranscript = join(projectDirectory, `${sessionId}.jsonl`);
    writeFileSync(oldTranscript, claudeLine('오래된 파일'));
    const oldTime = new Date('2026-10-13T23:00:00.000Z');
    utimesSync(oldTranscript, oldTime, oldTime);
    const oldCodexDirectory = join(codexSessionsDir, '2026', '10', '12');
    mkdirSync(oldCodexDirectory, { recursive: true });
    const oldRollout = join(oldCodexDirectory, 'rollout-old.jsonl');
    writeFileSync(oldRollout, codexLines('오래된 폴더'));
    utimesSync(oldRollout, oldTime, oldTime);

    expect(read()).toEqual([]);
  });

  // Codex 는 세션을 시작한 날짜 폴더에 계속 기록한다 — 2주 전에 연 Desktop 세션이 오늘까지 쓰인다.
  it('시작 날짜 폴더가 오래돼도 최근까지 기록된 Codex 세션은 읽는다', () => {
    const oldCodexDirectory = join(codexSessionsDir, '2026', '09', '29');
    mkdirSync(oldCodexDirectory, { recursive: true });
    writeFileSync(
      join(oldCodexDirectory, 'rollout-long.jsonl'),
      codexLines('오래 열어 둔 세션'),
    );

    expect(read()).toMatchObject([
      { source: 'codex', firstPrompt: '오래 열어 둔 세션' },
    ]);
  });

  it('Codex 꼬리 읽기에서도 처음의 session_meta를 보존하고 깨진 JSON 줄을 건너뛴다', () => {
    const codexDirectory = join(codexSessionsDir, '2026', '10', '14');
    mkdirSync(codexDirectory, { recursive: true });
    const lines = codexLines('꼬리의 요청').split('\n');
    const transcript = [
      lines[0],
      'x'.repeat(WORK_SESSION_FILE_TAIL_BYTES),
      '{broken',
      lines[1],
    ].join('\n');
    writeFileSync(join(codexDirectory, 'rollout-large.jsonl'), transcript);

    expect(read()).toMatchObject([
      { source: 'codex', sessionId, firstPrompt: '꼬리의 요청' },
    ]);
  });

  // 읽는 양의 상한 — 세션이 쌓여도 동기 읽기 시간이 파일 수에 비례해 늘지 않게 한다.
  it('최근 수정된 파일부터 WORK_SESSION_MAX_FILES 개까지만 읽는다', () => {
    const projectDirectory = join(claudeProjectsDir, 'project');
    mkdirSync(projectDirectory);
    const total = WORK_SESSION_MAX_FILES + 3;
    for (let index = 0; index < total; index += 1) {
      const id = `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`;
      const path = join(projectDirectory, `${id}.jsonl`);
      writeFileSync(path, claudeLine(`요청 ${index}`));
      const modifiedAt = new Date(Date.UTC(2026, 9, 14, 1, index));
      utimesSync(path, modifiedAt, modifiedAt);
    }

    const prompts = read().map((session) => session.firstPrompt);

    expect(prompts).toHaveLength(WORK_SESSION_MAX_FILES);
    expect(prompts).not.toContain('요청 0');
    expect(prompts).toContain(`요청 ${total - 1}`);
  });

  it('없는 디렉터리와 잘못된 항목에서도 throw 하지 않는다', () => {
    symlinkSync(join(root, 'missing'), join(claudeProjectsDir, 'link-project'));
    writeFileSync(join(claudeProjectsDir, 'plain-file'), '');
    expect(read()).toEqual([]);
    expect(
      readWorkSessionDigests({
        claudeProjectsDir: join(root, 'missing-claude'),
        codexSessionsDir: join(root, 'missing-codex'),
        since,
      }),
    ).toEqual([]);
  });
});
