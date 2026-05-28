import * as path from 'node:path';

import { Assignment } from '../../agent/cto/domain/cto.type';
import { AgentType } from '../../model-router/domain/model-router.type';
import { buildChainTrail, fileExistsRelativeToCwd } from './auto-flow.handler';

const buildAssignment = (
  beAssignment: Assignment['beAssignment'],
  taskId = 't1',
): Assignment => ({
  taskId,
  taskTitle: `task ${taskId}`,
  beAssignment,
  priority: 2,
  reasoning: '',
  confidence: 0.9,
});

// BE_TEST 분배 시 CTO 가 추론한 path 의 실제 존재 검증. LLM hallucination 차단.
describe('fileExistsRelativeToCwd', () => {
  it('repo 에 실제 존재하는 파일 (package.json) 은 true', async () => {
    await expect(fileExistsRelativeToCwd('package.json')).resolves.toBe(true);
  });

  it('repo 안 하위 경로 (자기 자신 파일) 도 true', async () => {
    const selfPath = path.relative(
      process.cwd(),
      path.join(process.cwd(), 'src/slack/handler/auto-flow.handler.spec.ts'),
    );
    await expect(fileExistsRelativeToCwd(selfPath)).resolves.toBe(true);
  });

  it('repo 에 없는 path 는 false (hallucination 케이스)', async () => {
    await expect(
      fileExistsRelativeToCwd('src/does/not/exist.service.ts'),
    ).resolves.toBe(false);
  });

  it('빈 문자열은 false', async () => {
    await expect(fileExistsRelativeToCwd('')).resolves.toBe(false);
  });

  it('absolute path 는 무조건 false (cwd 밖 접근 차단)', async () => {
    // /etc/passwd 는 macOS/linux 에 존재 가능 — 그래도 absolute 라 차단.
    await expect(fileExistsRelativeToCwd('/etc/passwd')).resolves.toBe(false);
    await expect(fileExistsRelativeToCwd('/tmp')).resolves.toBe(false);
  });

  it('path traversal (../) 로 cwd 벗어나면 false', async () => {
    // resolve 후 cwd prefix 검사로 차단. ../ 깊이가 충분히 깊으면 (/ 까지) cwd 밖.
    await expect(
      fileExistsRelativeToCwd('../../../../../etc/passwd'),
    ).resolves.toBe(false);
  });
});

describe('buildChainTrail — V3 phase loop chain audit 가시화', () => {
  it('전 step OK — PM → CTO → BE worker 들의 run id 를 → 로 연결', () => {
    const trail = buildChainTrail({
      pmAgentRunId: 99,
      ctoAgentRunId: 100,
      beOutcomes: [
        {
          assignment: buildAssignment(AgentType.BE, 'a1'),
          status: 'OK',
          agentRunId: 101,
          message: 'BE plan #101 생성 완료.',
        },
        {
          assignment: buildAssignment(AgentType.BE_SCHEMA, 'a2'),
          status: 'OK',
          agentRunId: 102,
          message: 'BE_SCHEMA #102 생성 완료.',
        },
      ],
    });

    expect(trail).toBe('PM #99 → CTO #100 → BE #101 → BE_SCHEMA #102');
  });

  it('SKIPPED step 은 (SKIPPED) 라벨 + agentRunId 미존재 시 #—', () => {
    const trail = buildChainTrail({
      pmAgentRunId: 1,
      ctoAgentRunId: 2,
      beOutcomes: [
        {
          assignment: buildAssignment(AgentType.BE_TEST, 'a1'),
          status: 'SKIPPED',
          message: 'BE_TEST filePath 미식별 — SKIPPED.',
        },
      ],
    });

    expect(trail).toBe('PM #1 → CTO #2 → BE_TEST #— (SKIPPED)');
  });

  it('FAILED step 도 (FAILED) 라벨 + agentRunId 가 있으면 #N 보존', () => {
    const trail = buildChainTrail({
      pmAgentRunId: 1,
      ctoAgentRunId: 2,
      beOutcomes: [
        {
          assignment: buildAssignment(AgentType.BE, 'a1'),
          status: 'FAILED',
          agentRunId: 50,
          message: 'BE 실패 — codex capacity',
        },
      ],
    });

    expect(trail).toBe('PM #1 → CTO #2 → BE #50 (FAILED)');
  });

  it('beOutcomes 가 비어 있어도 PM + CTO 만 출력', () => {
    const trail = buildChainTrail({
      pmAgentRunId: 7,
      ctoAgentRunId: 8,
      beOutcomes: [],
    });

    expect(trail).toBe('PM #7 → CTO #8');
  });
});
