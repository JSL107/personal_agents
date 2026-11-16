# 윤문 규칙 연구 루프 개선 설계

작성일 2026-11-16 · 상태: grilling 반영 완료 · 승인 대기 · 선행 설계: [2026-10-23 윤문 규칙 연구 워커 설계](./2026-10-23-humanize-research-worker-design.md)

## 1. 왜 고치는가

`HUMANIZE_RESEARCH` 는 2026-10-26부터 세 번 돌았고, 형태 검사를 통과한 제안은 첫 회차의 2건뿐이다. 두 건 모두 근거는 원작자 저장소 변경(`upstream:b37e0206…`) 하나였다. 그 뒤 두 회차는 제안이 0건이다.

원인은 세 가지로 확인했다.

- **재료가 규칙과 연결되지 않는다.** 블로그 수정 diff 는 11-02 회차에 14건, 11-09 회차에 4건 들어갔다. 하지만 삭제된 줄의 대부분이 연결어미 뒤 쉼표였고, 이 규칙은 이미 TS 프롬프트(`humanize-system.prompt.ts:180`)에 있었다. 실제로 고친 것은 결정적 후처리 `stripConnectiveCommas`(#939)다. diff 는 쉼표 한 글자 차이를 문단 두 벌로 실어 예산만 먹었다. 줄 멀티셋 비교라 짝이 없다(`revision-rate.ts:33-92`). HUMANIZER 요약은 30일 253회 중 202회가 블로그와 무관한 `report` 윤문이다.
- **제안이 블로그에 닿지 않는다.** 워커는 `quick-rules.md` 만 보고 거기만 고치려 한다. 블로그 발행은 TS 프롬프트를 쓴다. 첫 회차 제안의 대상 3건(A-11·H-1·G-3)은 연결표(`humanize-rule-links.ts`)에 없어서, 반영돼도 블로그 결과는 변하지 않는다.
- **반영 경로가 없다.** 설계 §6~§8(3단계)은 미구현이다.

재료 쪽 버그도 두 가지 있다.

- **예산 탈락분 유실:** 예산 때문에 탈락한 블로그 항목은 다음 회차에 28일 창을 벗어나 사라진다(`2026-10-11-three-layer-crawler-detection`, 11-02 탈락 → 11-09 창 밖).
- **후속 수정 누락:** 한 번 처리된 글은 나중에 다시 고쳐도 같은 id(`path:publishedAt`)라 재수집되지 않는다.

성공 지표는 선행 설계 §1 과 같다. 사용자가 블로그 발행본을 손보는 양(`BLOG_REVISION` 주간 수정률)이 줄어드는가로 본다.

## 2. 확정된 결정 (2026-11-16)

| 항목 | 결정 |
|---|---|
| 목표 산출물 | 정본(`humanize-korean`)과 블로그 TS 프롬프트를 **동등한 제안 대상**으로 둔다. 단 근거 출처별로 방향을 가른다(§4) |
| 순서 | 재료 보강과 반영 경로를 한 설계에 담고 PR 을 나눠 순차 구현한다(§9) |
| 반영 | 코드 게이트 → Preview Gate 승인 카드 → 정본·이 레포 **각각 PR**. 머지는 사람이 한다. 선행 설계의 자동 커밋·push 와 A/B 는 이번 범위에서 뺀다 |
| 삭제 제안 | `quick-rules.md` 표의 규칙 한 행 단위만 허용한다. 나머지 삭제는 `DELETE_NOT_ALLOWED` |

**선행 설계에서 바뀌는 것**
- §6 의 0단계(`LIVE_DIRTY`·`LIVE_DIVERGED`)와 9단계(로컬 커밋·push)는 PR 경로로 대체한다. 정본도 GitHub 저장소(`JSL107/humanize-korean`)라 `pushBranchAndOpenPr` 를 그대로 쓴다.
- §7 A/B 는 보류한다. 첫 회차 실제 제안 3건이 모두 `AB_NO_TARGET` 대상이었다. 승인·거절 기록이 쌓이면 다시 판단한다(§10).
- §8 의 "정본 변경에 TS 짝을 필수로 붙인다"는 폐기한다. 정본 C-11 은 2026-10-30 에 "기술 블로그 비대상"이 됐지만 사용자는 기술 블로그에서 쉼표를 계속 지운다. 두 쪽은 의도적으로 갈라져 있고, 자동 짝 전파는 블로그를 사용자 취향 반대로 몰 수 있다.

## 3. 역할 계약 (바뀐 칸만)

| 칸 | 내용 |
|---|---|
| 받는 것 | §5 의 재료 + 정본 `quick-rules.md` + **TS 편집 가능 면**(§4) |
| 내놓는 것 | `proposals[]`: `{ target: 'canon' \| 'blog', file, oldString, newString, targetMetric, rationale, evidence[] }`. `outputSchema` 로 강제하고 코드가 다시 검사한다 |
| 책임 아닌 것 | 기존 그대로(실제 윤문 HUMANIZER, 편집 관례 추출 BLOG_REVISION, 문체 임계값). 추가로 **결정적 후처리 코드 작성은 책임이 아니다** — "규칙은 있는데 집행되지 않는다"는 판단은 제안 대신 `enforcementGaps[]`(규칙 id + 근거 id)로 적는다. Slack 요약에만 싣고 반영하지 않는다 |
| 허용 도구 | 모델은 읽기만 한다. 파일 편집·검사 실행·PR 은 코드가 한다 |

## 4. 제안 대상과 방향

- **`target: 'canon'`**: 대상은 `references/quick-rules.md` 하나다. 근거는 UPSTREAM·CANON_LOG(§5)·ARXIV 중 하나 이상이어야 한다. 블로그 diff 만을 근거로 정본을 고치지 않는다 — 개인 문체 신호이기 때문이다.
- **`target: 'blog'`**: 대상은 `src/humanize/domain/humanize-system.prompt.ts` 하나다. 근거는 BLOG·HUMANIZER 중 하나 이상이어야 한다.
  - **편집 가능 면**은 연결표 `HUMANIZE_RULE_LINKS` 의 `local.text` 들로 한정한다. 프롬프트 파일 전체는 48KB 라 예산(6만 자)에 못 싣는다. 연결표는 이미 정본 규칙과 대응이 정리된 줄들이다.
  - `oldString` 은 그중 하나 안에 정확히 포함돼야 한다.
  - 반영할 때 연결표 해당 항목의 `local.text` 도 같은 치환으로 함께 고친다. 그러지 않으면 연결표 단위 테스트가 CI 를 끊는다.
- **연결 충돌 표시**: canon 제안이 연결표에 이어진 규칙 행을 고치면, 승인 카드에 이어진 TS 문구를 함께 보여주고 "블로그 쪽 미반영"을 명시한다. 짝을 자동 생성하지 않는다.

## 5. 재료 보강

| 출처 | 바뀌는 것 |
|---|---|
| BLOG | ① 삭제·추가 줄을 유사도로 짝짓고 편집 종류별로 집계한다: `구두점만`·`어휘 치환`·`문장 재작성`·`순수 삭제`·`순수 추가`. 종류별로 건수와 예시 최대 3쌍만 싣는다. 항목당 상한은 4,000자다. ② id 에 diff 내용 해시를 붙여 `blog:<path>:<publishedAt>:<hash8>` 로 만든다. 후속 수정이 생기면 새 항목이 된다. ③ 예산 탈락분이 유실되지 않게 수집 창을 28일 → 56일로 늘리고, 이미 처리한 항목은 `processed.blogPostIds` 로 거른다. `measure-blog-revision.usecase.ts` 의 `LOOKBACK_DAYS` 와 수집기의 `INTERNAL_LOOKBACK_DAYS` 를 함께 바꾼다. 측정 유스케이스는 주간 수정률 보고(`BLOG_REVISION`)도 쓰므로, 창을 호출 인자로 받게 하고 수정률 보고의 기본값 28일은 유지한다 |
| HUMANIZER | `input_snapshot.voice === 'personal-blog'` 인 실행만 집계한다 |
| CANON_LOG (신규) | 정본 저장소의 직전 회차 이후 `git log` 제목·본문(+ `references/corpus/*.json` 변경 파일명)이다. id 는 `canon:<hash>`. 사람(또는 사람이 지시한 세션)의 측정 결정이 가장 직접적인 규칙 신호다 |
| SAMPLE | **폐지한다.** 네 회차 동안 근거로 인용된 적이 없고, 매주 CLI 6회를 선별 전에 호출했다(11-02 는 6건 전부 예산 탈락). `ModelSampleCollector` 와 `HumanizeResearchSource.SAMPLE` 을 지운다 |
| UPSTREAM·ARXIV | 변경 없음 |

선별 우선순위는 BLOG → HUMANIZER → CANON_LOG → UPSTREAM → ARXIV 다.

## 6. 코드 게이트

제안마다 순서대로 검사한다. 실패하면 `output.skipped[]` 에 사유 코드를 남긴다.

| 순서 | 검사 | 사유 코드 |
|---|---|---|
| 1 | 형태·근거 id(기존) + target 별 근거 출처 조건(§4) | `INVALID_SHAPE` / `NO_EVIDENCE` / `EVIDENCE_SOURCE_MISMATCH` |
| 2 | 대상 파일이 target 에 맞는가 | `FILE_NOT_ALLOWED` |
| 3 | `oldString` 이 정확히 한 번 나오는가. blog 는 편집 가능 면 안인가 | `MATCH_NOT_UNIQUE` / `OUTSIDE_EDITABLE_SURFACE` |
| 4 | 삭제(`newString === ''`)라면 `oldString` 이 `quick-rules.md` 의 `\| X-n \|` 표 한 행 전체인가 | `DELETE_NOT_ALLOWED` |
| 5 | canon: 보호 자산(MAINTENANCE.md 표의 quick-rules 항목 — 「근거 등급과 강도」·「보존 신호」 단락, 자체검증 8번, 등급 기준 8항, B-1·B-2 독자별 강도)을 건드리는가 | `PROTECTED_ASSET` |
| 6 | canon: 줄 수가 현재 + 20 이내인가 | `RULEBOOK_TOO_LONG` |
| 7 | canon: 정본 `origin/main` 의 임시 worktree 에 적용한 뒤 `metrics_v2.py --selfcheck`, `scripts/check_severity_sync.py`, golden 4케이스(기대 `0 2 0 1`) | `SELFCHECK_FAILED` / `SEVERITY_SYNC_FAILED` / `GOLDEN_FAILED` |

통과한 제안만 승인 카드를 만든다. 회차당 상한은 기존 3개를 유지한다.

## 7. 승인 카드와 반영

- 새 Preview kind 는 `HUMANIZE_RULE_PR` 이다. 제안 하나당 카드 하나.
- payload 에 담는 것: target, 대상 저장소·파일, `oldString`·`newString` 전문, **게이트 통과 시점의 기준 SHA**(canon 은 정본 `origin/main`, blog 는 이 레포 `origin/main`), 근거 항목 원문 발췌, 연결 충돌 표시(§4).
- 카드 본문에는 전후 문구 전문과 근거 발췌를 보여준다. 120자에서 자르지 않는다. Slack 블록 상한을 넘는 부분만 자른다.
- **승인 시 재검증**: 대상 저장소의 현재 `origin/main` 에서 `oldString` 을 다시 찾는다. 기준 SHA 이후 파일이 바뀌어 매칭이 깨지면 PR 을 열지 않고 실패로 마감한다(`STALE_PROPOSAL`). canon 이면 게이트 7을 다시 돌린다.
- 반영: `pushBranchAndOpenPr` 1회. 브랜치는 `humanize-rule/<previewId>`, 담당자는 JSL107. blog 는 프롬프트 파일과 연결표 두 파일을 한 커밋으로 묶는다.
- 단발 외부 호출이므로 `resumable` 은 생략한다(= false). 중단되면 부팅 훅이 실패로 마감하고 사람에게 넘긴다(`preview-applier.port.ts:34-44` 의 기존 방침).
- 카드 만료는 기존 Preview 만료 정책을 따른다. 오래된 제안은 재검증에서 걸러진다.
- 정본 PR 이 머지되면 사용자가 로컬 `~/.claude/skills/humanize-korean` 을 `git pull --ff-only` 한다. 자동 pull 은 하지 않는다.

## 8. 장애 가정 점검

| 칸 | 내용 |
|---|---|
| 유실 지점 | 게이트 통과 후 카드 생성 전에 죽으면 → 제안은 `agent_run.output` 에만 남고 카드가 없다. `processed` 는 이미 전진했으므로 같은 재료는 다시 오지 않는다. 대신 output 의 `proposals` 에 남으니 사람이 원장에서 볼 수 있다. 재처리 경로는 `/retry-run`(기존 재실행)이다 |
| 실제 전달 보장 | 카드 → PR 은 at-most-once 다(`resumable` false, 재개 안 함). 중복 PR 보다 누락을 택한다 |
| 재처리 경로 | 실패 카드는 사람이 재승인하거나 다음 회차 재제안을 기다린다. 다음 회차는 같은 근거 id 를 다시 받지 않으므로, 근거가 사라진 제안은 재제안되지 않을 수 있다 — 허용한다 |
| 멱등성을 깨는 입력 | 같은 카드를 두 번 승인 → 기존 apply 의 상태 전이(PENDING→APPLYING)가 막는다. 같은 규칙에 대한 카드 두 장(두 회차) → 먼저 머지된 쪽 때문에 두 번째는 `STALE_PROPOSAL` 로 마감된다 |
| 트랜잭션 경계 | PR 생성(외부)과 카드 상태 갱신(DB) 사이에 틈이 있다. PR 은 열렸는데 카드가 실패로 남을 수 있다 → 같은 브랜치명 재사용 시 GitHub 오류로 드러난다. 사람이 확인한다 |
| 폭주 시 포화 | 회차는 주 1회이고 제안 상한은 3이다. 게이트 7의 Python 검사는 제안당 6회 미만이다. 포화 지점은 없다 |

## 9. 구현 단위 (순차 PR)

1. **재료 보강**: BLOG 짝짓기·집계·해시 id·창 확장, HUMANIZER voice 필터, CANON_LOG 수집기, SAMPLE 폐지, 우선순위. 인수 기준: 11-02 회차 입력을 재현했을 때 블로그 14건이 예산의 절반 이하를 쓰고, 예산 탈락은 0건이다. 같은 PR 에서 연결표 경보도 정리한다. 2026-11-16 현재 `pnpm humanize:check-links` 는 exit 1 이다(A-7 S1→S2 "3회+", C-11 S1→S2 "기술 블로그 비대상"). TS 문구는 바꾸지 않는다. C-11 은 사용자가 기술 블로그에서도 쉼표를 지워 #939 후처리까지 넣은 의도적 차이고, A-7 은 블로그 최종 검수가 사람이라 엄격한 쪽을 유지한다. 두 항목의 `note` 에 이 이유를 적고 `--accept` 로 `humanize-rule-links.snapshot.json` 을 갱신한다. 인수 기준: `check-links` exit 0. 단위 테스트로 짝짓기 종류별 분류를 확인한다.
2. **제안 대상 확장**: `target` 필드, TS 편집 가능 면 주입, 프롬프트 문구(근거 출처별 방향, `enforcementGaps`), 게이트 1~6. 쓰기는 없다(dry-run Slack 유지).
3. **승인과 반영**: 게이트 7(임시 worktree), `HUMANIZE_RULE_PR` kind·applier·결과 검증(`getPullRequest` 재확인 — DOCS_AUDIT_PR 과 같은 방식), 승인 시 재검증, `HUMANIZE_RULE_PR_ENABLED`(기본 false) env.

각 PR 은 `pnpm verify` green 이 필수다. env·`AgentType`·agent-registry 를 바꾸면 `pnpm docs:sync` + `pnpm docs:check` 를 함께 돌린다(AGENTS.md §1).

## 10. 남은 판단과 위험

- **A/B 재도입 조건**: 승인 카드 10건이 쌓였을 때 거절 사유를 보고 판단한다. 재도입하면 제안당 최대 32회 호출이다(선행 §10 의 96회는 제안 3건 기준 최대치).
- **편집 가능 면이 좁다**: 연결표에 없는 TS 문구는 제안할 수 없다. 넓히려면 연결표에 항목을 더한다(사람 작업).
- **블로그 수정률이 이미 0%**(11-16 회차): 이 루프의 효과를 수정률로 재기 어려울 수 있다. 10-26 회차도 0%였으므로 0%가 원인 해소인지 편집 공백인지는 미확인이다.
