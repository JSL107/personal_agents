/**
 * Router 스모크 replay CLI — 실 서비스 없이 자연어/슬래시 라우팅을 in-process 재생.
 *
 *   pnpm harness:replay -- --text "오늘 plan 짜줘"
 *   pnpm harness:replay -- --agent PM --text "plan"
 *
 * 분류기는 오프라인 keyword 휴리스틱(하네스 전용). 실 LLM 분류가 아니므로 "라우팅 배선"
 * 스모크 용도다. 상세 한계는 docs/superpowers/specs/2026-06-11-harness-engineering-design.md §3.
 */

import { AgentType } from '../src/model-router/domain/model-router.type';
import { RouterException } from '../src/router/domain/router.exception';
import { buildRouterHarness } from '../test/harness/router-harness';

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index !== -1 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const text = argValue('--text');
  const agentRaw = argValue('--agent');

  if (!text && !agentRaw) {
    console.error(
      '사용법: pnpm harness:replay -- --text "오늘 plan 짜줘" [--agent PM]',
    );
    process.exitCode = 1;
    return;
  }

  const harness = buildRouterHarness();

  let agentType: AgentType | undefined;
  if (agentRaw) {
    if (!(agentRaw in AgentType)) {
      console.error(
        `알 수 없는 --agent "${agentRaw}". 가능: ${Object.values(AgentType).join(', ')}`,
      );
      process.exitCode = 1;
      return;
    }
    agentType = AgentType[agentRaw as keyof typeof AgentType];
  }

  console.log('── Router 스모크 replay ──');
  console.log(`input.text   : ${text ?? '(없음)'}`);
  console.log(`input.agent  : ${agentType ?? '(자연어 분류)'}`);

  try {
    const result = agentType
      ? await harness.replayHint(agentType, text)
      : await harness.replayText(text as string);

    console.log('─────────────────────────');
    console.log(`routed worker: ${result.workerType}`);
    console.log(`model        : ${result.modelUsed}`);
    console.log(`agentRunId   : ${result.agentRunId}`);
    console.log(`formattedText: ${result.formattedText}`);
    if (result.handoffResults?.length) {
      console.log(
        `handoff      : ${result.handoffResults.map((r) => r.workerType).join(' → ')}`,
      );
    }
  } catch (error: unknown) {
    if (error instanceof RouterException) {
      console.error(`라우팅 실패 [${error.routerErrorCode}]: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

void main();
