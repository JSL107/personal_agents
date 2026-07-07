# 문서 정합성 정리 Todo

## Plan

- [x] `README.md`의 구현 현황 숫자와 모델 라우팅 설명을 코드 기준으로 갱신한다.
- [x] `README.md`의 Autopilot, BE sandbox, 내부 agent 설명을 현재 구현 상태에 맞게 재분류한다.
- [x] `.env.example`의 Claude 라우팅 설명을 "보존/롤백용"으로 낮추고 현재 Codex 단일 라우팅 정책과 맞춘다.
- [x] `CODE_RULES.md`에서 TypeORM/DDD_BE/BaseEntity 이식 잔재를 제거하고 Prisma/NestJS 기준으로 정리한다.
- [x] `pnpm docs:check`, `pnpm check:env`, `pnpm lint:check`로 문서 변경 후 상태를 확인한다.

## Review

- `README.md`의 구현 현황을 코드 기준으로 갱신했다: 전체 AgentType 25종, 사용자-facing worker 17개, Prisma model 14개, Codex 단일 provider, Autopilot/BE sandbox 현황을 반영.
- `.env.example`의 Claude 설명을 롤백 대비용으로 낮추고 optional env 문서화를 보강해 `check:env` 경고를 0개로 줄였다.
- `CODE_RULES.md`의 `DDD_BE`, TypeORM, BaseEntity 이식 잔재를 제거하고 Prisma/NestJS 기준 규칙으로 정리했다.
- Verification: `pnpm docs:check` OK, `pnpm check:env` OK, `pnpm lint:check` exit 0. `lint:check`는 기존 spec 파일의 `no-explicit-any` warning 47개를 출력했다.

---

# 문서 정합성 패치 Push Todo

## Plan

- [x] 로컬 `main`과 `origin/main` 차이를 확인하고 원격 최신 커밋 위에 작업을 얹는다.
- [x] 이번 문서 정리 파일만 stage 한다: `README.md`, `CODE_RULES.md`, `.env.example`, `tasks/todo.md`.
- [x] 문서 검증 명령과 repo 기본 검증 명령을 다시 실행한다.
- [x] 커밋을 만들고 `origin/main`으로 push 한다.

## Review

- `origin/main` 최신 커밋 위로 rebase 완료.
- Stage/commit 대상은 `README.md`, `CODE_RULES.md`, `.env.example`, `tasks/todo.md`로 제한했다.
- Verification: `pnpm docs:check` OK, `pnpm check:env` OK, `pnpm lint:check` exit 0, `pnpm test` OK, `pnpm build` OK.
- `pnpm lint:check`는 기존 spec 파일의 `no-explicit-any` warning 47개를 출력했다.

---

# Lodash 취약점 제거 Todo

## Plan

- [x] 직접 `lodash` import/use 여부와 `pnpm why lodash` 경로를 확인한다.
- [x] `@nestjs/config`를 vulnerable `lodash@4.17.23`를 끌지 않는 최신 patch로 올린다.
- [x] lockfile에서 prod `lodash@4.17.23` 경로가 제거됐는지 확인한다.
- [x] `pnpm audit --prod`에서 lodash advisory가 사라졌는지 확인한다.
- [x] `pnpm lint:check`, `pnpm test`, `pnpm build`로 회귀를 확인한다.

## Review

- 앱 코드의 직접 `lodash` import/use 는 없었다. 따라서 `es-toolkit`으로 바꿀 코드 사용처도 없고, unused dependency 로 추가하지 않았다.
- prod `lodash` 경로는 `@nestjs/config@4.0.3 -> lodash@4.17.23` 하나였고, `@nestjs/config@4.0.4`로 올려 `lodash@4.18.1` 경로로 갱신했다.
- `pnpm audit --prod`에서 lodash advisory(`GHSA-r5fr-rjxr-66jc`)가 사라졌고, 전체 취약점 수는 22개에서 20개로 줄었다.
- 남은 audit 항목은 `basic-ftp`, `multer`, `undici`, `file-type`, `uuid`, `qs`, `js-yaml` 계열로 별도 작업 대상이다.
- Verification: direct lodash rg no match, `pnpm why lodash` shows `4.18.1` only, `pnpm lint:check` exit 0, `pnpm test` OK, `pnpm build` OK.
- `pnpm lint:check`는 기존 spec 파일의 `no-explicit-any` warning 47개를 계속 출력했다.
