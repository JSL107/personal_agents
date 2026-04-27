# 이대리 PM Agent 고도화 최종 설계 및 구현 계획

사용자 피드백을 수용하여 작성된 최종 디벨롭(Develop) 기획안입니다. 기존의 '할 일 나열 및 조언자(Advisor)' 역할에서 벗어나 **WBS 세분화 및 타 플랫폼 양방향 동기화(Write)**, **업무 트래킹(Tracking)**, **에이전트 주도적 우선순위 판단** 기능을 포함한 완성형 PM 에이전트로 진화합니다.

## 1. 딥 리서치 기반 핵심 변경 방향 (PM Mental Models)

1.  **Work Breakdown Structure (WBS) & 양방향 동기화 (Write-back)**
    *   에이전트가 덩어리 태스크를 세부 단위로 쪼갭니다.
    *   *[피처 반영]* 쪼개진 WBS 서브 태스크들을 단지 텍스트로 보여주는 데 그치지 않고, 원본 소스(GitHub Issue, Notion)에 **체크리스트 또는 코멘트 형태로 직접 Write-back(동기화)** 합니다.
2.  **Variance Analysis (업무 트래킹) & 에이전트 재량의 이월(Rollover) 처리**
    *   과거 계획과 실제 완수 로그를 비교하여 이월(Rollover) 업무를 식별합니다.
    *   *[피처 반영]* 이월된 업무라고 해서 무조건 최우선순위로 끌어올리지 않습니다. **Eisenhower 매트릭스**를 바탕으로 에이전트가 상황을 종합 판단하여 버리거나, 오후로 미루거나, 최우선순위로 재배정하는 등 자율적 판단(재량권)을 부여합니다.
3.  **데이터 하위 호환성 (Migration/Fallback)**
    *   *[피처 반영]* `DailyPlan`의 타입이 고도화된 객체 배열(`TaskItem[]`)로 변경됨에 따라, 과거 AgentRun 테이블에 저장된 구버전 포맷(`string[]`)을 읽어올 때 에러가 나지 않도록 `coerceToDailyPlan`에 파싱/호환성 어댑터 로직을 필수로 추가합니다.

---

## 2. Proposed Changes (변경 상세)

### [MODIFY] `src/github/github.module.ts` (빌드 에러 선조치)
현재 `ReviewPullRequestUsecase` DI 에러로 인해 `pnpm dev` 가 동작하지 않는 이슈를 먼저 해결합니다.
*   `exports` 배열에 `GITHUB_CLIENT_PORT` 추가.

### [MODIFY] `src/agent/pm/domain/pm-agent.type.ts`
태스크를 객체화하고, WBS(`subtasks`)와 병목 여부(`isCriticalPath`), 이월 분석 내역(`varianceAnalysis`)을 스키마에 추가합니다.
```typescript
export interface SubTask {
  title: string;
  estimatedMinutes: number;
}

export interface TaskItem {
  id: string;              // Github issue #, Notion ID 혹은 자동 생성 ID
  title: string;
  source: 'GITHUB' | 'NOTION' | 'SLACK' | 'USER_INPUT' | 'ROLLOVER';
  subtasks: SubTask[];     // WBS 적용: 에이전트가 알아서 쪼갠 하위 태스크
  isCriticalPath: boolean; // 병목 이론 적용: 이 태스크가 막히면 전체가 막히는가?
}

export interface DailyPlan {
  topPriority: TaskItem;
  varianceAnalysis: {      // 업무 트래킹
    rolledOverTasks: string[];
    analysisReasoning: string;
  };
  morning: TaskItem[];
  afternoon: TaskItem[];
  blocker: string | null;
  totalEstimatedHours: number;
  reasoning: string;
}
```

### [MODIFY] `src/agent/pm/domain/prompt/previous-plan-formatter.ts` (하위 호환성 로직 추가)
*   `coerceToDailyPlan` 함수 내부에 어댑터 패턴 적용.
*   파싱된 객체의 `morning` 필드가 `string[]` 타입인지 `TaskItem[]` 타입인지 검사하여, 구버전일 경우 임시 ID와 래핑된 형태의 `TaskItem[]`로 변환(Migration)하여 반환합니다.

### [MODIFY] `src/agent/pm/domain/prompt/pm-system.prompt.ts`
시스템 프롬프트 개편:
*   **WBS:** "단일 태스크가 2시간 이상 걸릴 것 같으면 2~3개의 하위 서브 태스크로 분할하라."
*   **Rollover 자율권:** "어제 워크로그와 비교해 완료되지 못한 이월 업무(Rollover)를 추출하라. 단, 무조건 우선순위로 두지 말고 현재의 맥락과 중요도를 판단하여 알아서 적절한 시간대에 배치하거나 드랍(명분 작성)하라."
*   **병목 식별:** "흐름을 막고 있는 작업을 찾아 `isCriticalPath: true`로 마킹하라."

### [NEW] `src/agent/pm/application/sync-daily-plan.usecase.ts` (양방향 동기화)
*   `DailyPlan` 객체를 받아 순회하며 `subtasks`가 존재하는 항목들을 원본 소스에 반영하는 유스케이스 작성.
*   `source === 'GITHUB'` 이면 해당 Issue 코멘트에 Markdown 체크리스트로 서브 태스크 추가.
*   `source === 'NOTION'` 이면 해당 페이지에 To-Do 블록으로 서브 태스크 추가.
*   `GenerateDailyPlanUsecase` 마지막 단계에서 비동기적(혹은 동기적)으로 호출.

### [MODIFY] `src/github/domain/port/github-client.port.ts` & `src/notion/domain/port/notion-client.port.ts`
*   동기화 로직 수행을 위한 Write 관련 Port 메서드 추가 (`addIssueComment`, `appendTodoBlocks` 등) 및 인프라 어댑터(`octokit-github.client.ts`, `notion-api.client.ts`) 구현.

---

## 3. Verification Plan

### Automated Tests
1.  `previous-plan-formatter.spec.ts`: 구버전 `string[]` 기반 JSON이 주어졌을 때 `TaskItem[]` 포맷으로 정상 변환(호환성 유지)되는지 테스트 추가.
2.  `daily-plan.parser.spec.ts`: 새로운 복합 JSON 스키마를 던져 정상 파싱되는지 검증.
3.  `sync-daily-plan.usecase.spec.ts`: GitHub / Notion 클라이언트 모킹 후, 각각의 플랫폼별로 정확하게 Write API가 호출되는지 검증.

### Manual Verification
1.  **빌드 및 기동 확인:** `pnpm lint:check`, `pnpm test`, `pnpm build` 수행 및 `pnpm dev` 가 `CodeReviewerModule` 에러 없이 켜지는지 확인.
2.  **슬랙 연동 테스트:** `/today [큰 단위의 모호한 작업]` 입력.
3.  **결과물 검증:** 에이전트가 작업을 WBS 형태로 쪼개어 응답하는지, 어제 다 못한 일이 재량껏 배치되는지, 그리고 **실제 GitHub Issue 혹은 Notion 페이지에 해당 서브 태스크가 코멘트/투두로 추가**되었는지 직접 확인.
