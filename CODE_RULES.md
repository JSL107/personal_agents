# CODE RULES

이 문서는 `DDD_BE` 프로젝트의 코드 작성 기준이다.
목표는 "가독성", "책임 분리", "일관성"을 최우선으로 유지하는 것이다.

---

## 1) 핵심 원칙 (MUST)

1. `return` 문에는 복잡한 연산(삼항 중첩, 메서드 체이닝 2단계 이상, 복합 조건식)을 넣지 않는다. 단순 참조나 단일 표현식은 허용한다.
2. 기본은 `const` 기반 화살표 함수를 사용한다.
3. 단, `function` 선언이 더 읽기 쉽거나(재귀, 호이스팅, 명확한 의도 표현) 구조상 유리하면 `function`을 사용한다.
4. `if` 분기가 복잡해지면 `ts-pattern`의 `match`를 우선 검토한다.
5. 함수/모듈은 고수준 로직에서 저수준 구현 순서로 작성한다(Top-Down).
6. DDD + Layered Architecture를 사용하고 계층 간 책임을 명확히 분리한다.
7. 계층 의존 방향은 항상 바깥(Interface) -> 안쪽(Domain)으로만 향한다.
8. 외부 API는 하나의 독립된 도메인으로 취급하고, DDD Layered Architecture 규칙을 동일하게 적용한다.
9. `enum`은 도메인 용어를 최우선으로 하고, 영어가 오히려 의미 전달을 해치면 한국어를 허용한다.
10. 불필요한 주석은 작성하지 않는다. 필요한 설명, 미해결 이슈, 의사결정 배경만 주석으로 남긴다.
11. 공통 Response 형태를 유지한다.
12. 기존 컨벤션(네이밍, 포맷, 린트, 폴더 구조)을 우선 준수한다.
13. API/서버 코드는 NestJS의 관용적 방식(Nest스럽게)과 RESTful 설계를 지향한다.

---

## 2) 아키텍처/레이어 규칙 (MUST)

1. Domain Layer는 프레임워크/외부 라이브러리에 의존하지 않는다.
2. Application Layer는 유스케이스를 조합하며 트랜잭션 경계를 가진다.
   트랜잭션의 시작/커밋/롤백은 Application Layer에서 선언하고, 실제 구현은 Infrastructure Layer(Unit of Work 등)에 위임한다.
3. Infrastructure Layer는 DB, 외부 API, 메시징 등 구현 세부사항을 담당한다.
4. Controller(Interface Layer)에는 비즈니스 로직을 넣지 않는다.
5. Repository는 영속성 책임만 가지며, 도메인 정책 판단을 하지 않는다.
6. Repository는 서로 참조하지 않는다. 복합 도메인 간 협력이 필요한 경우 Aggregate를 통해 처리한다.
7. 큐(Queue) 처리가 필요한 경우 메시지를 발행하는 Provider와 메시지를 처리하는 Consumer를 명확히 분리한다. 각각 별도 클래스/모듈로 구성하고, Consumer는 Infrastructure Layer에 위치한다.

---

## 3) TypeScript/NestJS 규칙 (SHOULD)

1. `any` 사용은 금지에 가깝게 관리하고, 불가피할 때만 범위를 최소화한다.
2. DTO/Request 입력 검증은 명시적으로 수행한다(형식, 범위, 필수값).
3. 예외는 도메인/애플리케이션 의미를 담은 커스텀 예외로 던지고, 응답 변환은 전역 레벨에서 일괄 처리한다.
4. `Promise` 반환 함수는 `async/await` 스타일을 일관되게 유지한다.
5. 의존성 생성은 DI 컨테이너를 사용하고 `new` 직접 생성은 최소화한다.
6. Import 순서는 자동 정렬 규칙(`simple-import-sort`)을 따른다.
7. 반환 타입은 인라인 객체(`{ data: string }`) 대신 `type`/`interface`로 명시해 재사용 가능하게 관리한다.
8. `Pick`/`Omit`/중첩 유틸리티 타입 등 복잡한 타입 조합은 지양하고, 의도가 드러나는 명시 타입을 우선한다.
9. `if` 문은 단일 라인이더라도 항상 중괄호(`{}`)를 사용한다. (❌ `if (x) return;` → ✅ `if (x) { return; }`)
10. `try-catch` 블록 밖에서는 `return await`를 생략한다. `try-catch` 블록 안에서는 rejection이 catch에서 잡히도록 반드시 `return await`를 사용한다.

    ```ts
    // ❌ try-catch 안에서 await 생략 — rejection이 catch에서 잡히지 않음
    async function bad() {
      try {
        return someAsyncFn();
      } catch (e) { ... }
    }

    // ✅ try-catch 안에서 return await 사용
    async function good() {
      try {
        return await someAsyncFn();
      } catch (e) { ... }
    }
    ```

11. 함수 파라미터는 읽기 쉽고 확장이 용이하도록 **객체 구조 분해 할당(`{}`) 방식**을 권장한다.

    단, Passport의 `validate` 메서드처럼 라이브러리에서 인자 순서(Positional Arguments)를 강제하는 경우는 예외로 한다.

12. 함수/메서드가 값을 반환한다면 원칙적으로 반환 타입을 명시해 인터페이스(계약)를 명확히 한다.
    - **명시 대상**: `Promise<RegisterResult>`, `Promise<ApiResponse<T>>`, `Promise<DTO>` 등 **사용자 정의 복합 타입(Custom Type)** 반환.
    - **생략 허용**: `void`/`Promise<void>`, `boolean`/`number`/`string` 등 **원시 타입(Primitive Type)** 반환.
    - **생략 허용**: `Promise<User>`, `Promise<Cohort>`, `Promise<User | null>`처럼 도메인 **엔티티(Entity)**를 그대로 반환하는 Repository/Service 메서드(추론이 자명한 경우).
    - **생략 허용**: `Controller` (Interface Layer) 엔드포인트 라우터 핸들러 메서드(추론 및 Swagger 데코레이터 명세 우선).

13. NestJS 기본값과 동일한 `@HttpCode()` 데코레이터는 중복 선언하지 않는다.
    - 기본 상태 코드는 메서드 단위로만 정해진다. `@Post()` 는 201, `@Get()/@Put()/@Delete()/@Patch()` 등 그 외는 200 이다.
    - 핸들러가 `void`/`undefined` 를 반환하더라도 NestJS 가 자동으로 204 로 바꾸지 않는다. 본문 없이 204 가 필요하면 반드시 `@HttpCode(HttpStatus.NO_CONTENT)` 를 명시한다.
    - 기본값과 다른 상태 코드를 의도적으로 쓸 때만 `@HttpCode()` 를 붙인다. (예: `POST` 인데 200 으로 응답하는 검색/검증 API, `DELETE` 후 204 명시)
    - 의미 변화 없는 데코레이터 중복은 코드 리뷰에서 제거 대상이다.

14. TypeORM `@Column()`의 `type` 옵션은 생략을 기본으로 한다. TypeScript 필드 타입(`Date`, `string`, `number` 등)으로 자동 추론되며, PostgreSQL 전용 타입이 필요한 경우에만 명시한다.

    ```ts
    // ✅ 타입 생략 (TypeScript 타입으로 추론)
    @Column()
    recruitStartAt: Date;

    // ✅ PostgreSQL 전용 타입이 필요한 경우에만 명시
    @Column({ type: 'jsonb' })
    metadata: Record<string, unknown>;

    // ❌ 불필요하게 장황한 타입 명시
    @Column({ type: 'timestamp with time zone' })
    recruitStartAt: Date;
    ```

---

## 4) 네이밍/파일 구조 규칙 (MUST)

### 네이밍 컨벤션

| 대상                        | 규칙                                    | 예시                                     |
| --------------------------- | --------------------------------------- | ---------------------------------------- |
| 클래스/인터페이스/타입/Enum | PascalCase                              | `UserService`, `OrderStatus`             |
| 변수/함수/메서드            | camelCase                               | `findUserById`, `isActive`               |
| 상수 (모듈 스코프)          | UPPER_SNAKE_CASE                        | `MAX_RETRY_COUNT`                        |
| 파일명                      | kebab-case                              | `user.repository.ts`                     |
| NestJS 파일                 | `{name}.{role}.ts`                      | `user.service.ts`, `order.controller.ts` |
| 테스트 파일                 | `{name}.spec.ts` / `{name}.e2e-spec.ts` | `user.service.spec.ts`                   |

#### Repository 계층 네이밍 규칙

- **Domain Repository**: 도메인 이름을 포함하여 작성한다.
  - **파일명**: `[도메인명].repository.ts` (예: `user.repository.ts`)
  - **클래스명**: `[도메인명]Repository` (예: `UserRepository`)
- **Write Repository (인프라)**: 도메인 이름 접두사를 생략한다.
  - **파일명**: `write.repository.ts`
  - **클래스명**: `WriteRepository`

#### Repository 계층별 역할 규칙

- **Write Repository (인프라)**: 실제 DB 접근만 담당한다.
  - 함수명에 비즈니스 의미를 담지 않는다. (`save`, `findOne`, `delete` 등)
  - 파라미터는 구조분해 할당으로 받아, TypeORM 타입(`FindOneOptions` 등)이 외부로 노출되지 않게 한다.
  - `where` 조건 조합은 Write Repository 내부에서 처리한다.
  ```ts
  // ✅
  async findOne({ email }: { email: string }): Promise<User | null> {
    return this.repository.findOne({ where: { email } });
  }
  ```
- **Domain Repository**: 비즈니스 의미가 드러나는 함수명을 사용한다. (`findByEmail`, `register` 등)
  - 파라미터는 구조분해 할당으로 받는다. `where` 객체를 직접 조립하지 않고, 분해된 필드를 그대로 넘긴다.

  ```ts
  // ✅
  async findByEmail({ email }: { email: string }): Promise<User | null> {
    return this.writeRepository.findOne({ email });
  }

  async register({ email, name, picture }: Pick<User, 'email' | 'name' | 'picture'>): Promise<User> {
    return this.writeRepository.create({ email, name, picture });
  }
  ```

### 변수 네이밍 주의사항

1. 변수명에 진행형(-ing)을 사용하지 않는다. 조회된 엔티티/값은 명사형을 사용한다. (❌ `existing` → ✅ `found`, `record`, `target`)
2. 변수명에 줄임말을 사용하지 않는다. (❌ `repo`, `req`, `res`, `err` → ✅ `repository`, `request`, `response`, `error`)
3. 도메인 용어의 경우 영문 풀네임이 오히려 의미 전달을 해친다면 한글 명칭을 사용하는 것도 고려한다.

### 폴더 구조

```
src/
  {domain}/               # 도메인 단위로 분리 (외부 API도 독립 도메인으로 동일하게 취급)
    domain/               # Entity, Value Object, Repository Interface, Domain Service, Aggregate
    application/          # UseCase, Command, Query, DTO
    infrastructure/       # Repository 구현체, Queue Consumer
    interface/            # Controller, Resolver, DTO(Request/Response), Queue Provider
    {domain}.module.ts
  common/                 # 공통 응답, 필터, 인터셉터, 데코레이터, 유틸
  config/                 # 환경 설정
```

### BaseEntity 사용 기준

프로젝트에는 목적이 다른 두 가지 BaseEntity가 존재한다. 새 도메인 엔티티를 추가할 때 아래 기준으로 선택한다.

| 클래스              | 위치                           | 포함 필드                                                         | 사용 기준                                                           |
| ------------------- | ------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| `BaseEntity`        | `common/entity/base.entity.ts` | `createdAt`, `updatedAt`, `deletedAt`                             | `id`를 도메인 엔티티에서 직접 선언하는 경우                         |
| `BaseEntity` (확장) | `common/core/base.entity.ts`   | `id`, `uuid`, `createdAt`, `updatedAt`, `deletedAt` + 복합 인덱스 | `id`/`uuid`를 공통으로 관리하고 커서 기반 조회 인덱스가 필요한 경우 |

> 하나의 프로젝트에서 두 BaseEntity가 혼재하면 테이블 컬럼 구성과 소프트 삭제 정책이 도메인마다 달라진다.
> 새 도메인은 `common/core/base.entity.ts`를 기본으로 사용하고, 기존 도메인(`user`, `user-role`)은 현행 유지한다.

---

## 5) 테스트/품질 규칙 (SHOULD)

### 테스트 대상

테스트는 아래 세 가지에 집중한다. 그 외 영역은 테스트를 강제하지 않는다.

| 대상         | 예시                                      |
| ------------ | ----------------------------------------- |
| Util 함수    | 날짜 변환, 문자열 처리, 계산 유틸 등      |
| Parsing 로직 | 외부 API 응답 파싱, DTO 변환, 데이터 매핑 |
| UseCase      | Application Layer의 유스케이스 단위       |

### 작성 기준

1. 테스트는 `Given-When-Then` 구조로 작성한다.
2. UseCase 테스트에서 외부 의존성(Repository, 외부 도메인 서비스)은 Mock/Stub으로 처리한다.
3. 회귀 버그는 재발 방지 테스트를 우선 추가한다.

---

## 6) 공통 응답 규칙

성공/실패 판단은 HTTP Status Code를 기준으로 한다.
공통 응답은 아래 형태를 기본으로 한다.

`code`는 비즈니스 결과 코드로 HTTP Status Code와 별개로 세부 결과를 표현한다.
성공 시 `"SUCCESS"`, 실패 시 도메인 의미를 담은 `UPPER_SNAKE_CASE`를 사용한다. (예: `"USER_NOT_FOUND"`, `"ORDER_ALREADY_CANCELLED"`)

```ts
type ApiResponse<T> = {
  code: string;
  message: string;
  data: T | null;
  meta?: {
    requestId?: string;
  };
};
```

### 에러 응답 예시

```ts
// 400 Bad Request
{
  "code": "INVALID_INPUT",
  "message": "이메일 형식이 올바르지 않습니다.",
  "data": null
}

// 404 Not Found
{
  "code": "USER_NOT_FOUND",
  "message": "사용자를 찾을 수 없습니다.",
  "data": null
}
```

---

## 7) API 설계 규칙 (SHOULD)

### URI / HTTP Method

1. URI는 리소스 중심 명사로 설계하고, 동작은 HTTP Method로 표현한다.
2. URI는 소문자 kebab-case를 사용한다. (`/user-profiles`, `/order-items`)
3. HTTP Status Code는 의미에 맞게 사용한다.
4. 엔드포인트/DTO 네이밍은 일관된 REST 규칙을 따른다.

| 상황                       | Status Code |
| -------------------------- | ----------- |
| 조회 성공                  | 200         |
| 생성 성공                  | 201         |
| 삭제/업데이트 후 반환 없음 | 204         |
| 잘못된 입력                | 400         |
| 인증 실패                  | 401         |
| 권한 없음                  | 403         |
| 리소스 없음                | 404         |
| 서버 오류                  | 500         |

### 버저닝

1. URI 경로에 버전을 포함한다. (`/v1/users`, `/v2/orders`)
2. 하위 호환이 불가능한 변경은 버전을 올린다. 필드 추가 등 하위 호환 변경은 동일 버전에서 허용한다.

### 페이지네이션

1. 목록 조회 기본 방식은 커서 기반 페이지네이션을 사용한다.
2. 관리자 페이지 등 페이지 번호가 명시적으로 필요한 경우에 한해 offset 기반을 허용한다.

```ts
// 커서 기반 요청 파라미터
type CursorPaginationQuery = {
  cursor?: string; // 마지막으로 받은 아이템의 커서값
  limit?: number; // 기본값: 20, 최대: 100
};

// 커서 기반 응답 meta
type PaginationMeta = {
  nextCursor: string | null;
  hasNext: boolean;
};
```

## 8) Git 커밋 규칙 (MUST)

커밋 메시지는 아래 형식을 따른다.

```
<type>(<scope>): <subject>

[body - 선택]
[footer - 선택]
```

### Type

| type       | 용도                                  |
| ---------- | ------------------------------------- |
| `feat`     | 새로운 기능 추가                      |
| `fix`      | 버그 수정                             |
| `refactor` | 동작 변경 없는 코드 개선              |
| `test`     | 테스트 추가/수정                      |
| `docs`     | 문서 변경                             |
| `chore`    | 빌드, 설정, 의존성 변경               |
| `style`    | 포맷, 세미콜론 등 코드 의미 없는 변경 |

### 규칙

1. subject는 명령형 현재 시제로 작성한다. (`사용자 추가`, `인증 버그 수정`)
2. subject는 50자 이내로 작성한다.
3. Prettier/ESLint를 통과하지 못하는 코드는 커밋하지 않는다(pre-commit hook으로 강제).

---

## 9) 환경변수 규칙 (MUST)

1. 시크릿, DB 접속 정보, 외부 API 키 등 모든 환경 의존 값은 환경변수로 관리한다. 코드에 하드코딩하지 않는다.
2. 환경변수는 NestJS `ConfigModule`을 통해 접근하고, 직접 `process.env`를 참조하지 않는다. 단, TypeORM CLI 등 NestJS DI 컨텍스트 밖에서 실행되는 경우(`data-source.ts`)는 `dotenv` + `process.env` 직접 접근을 허용한다.
3. 환경변수는 `config/` 에서 스키마(`class-validator` 기반)로 검증한다. 앱 구동 시 필수 환경변수가 없으면 즉시 실패한다.
4. `.env` 파일은 git에 커밋하지 않는다. 필요한 키 목록은 문서에 명시해 관리한다.
5. 환경변수 이름은 `UPPER_SNAKE_CASE`를 사용한다.

---

## 10) 로깅 규칙 (SHOULD)

1. NestJS 기본 `Logger`를 사용하고, 운영 환경에서는 JSON 구조화 로그로 출력한다.
2. 로그 레벨 기준:

| 레벨      | 용도                                           |
| --------- | ---------------------------------------------- |
| `error`   | 처리되지 않은 예외, 시스템 장애                |
| `warn`    | 비정상이지만 복구 가능한 상황                  |
| `log`     | 주요 비즈니스 이벤트 (주문 생성, 결제 완료 등) |
| `debug`   | 개발 시 흐름 추적용 (운영 환경에서는 비활성화) |
| `verbose` | 상세 디버깅 (로컬 전용)                        |

3. 로그는 Application Layer 이하(UseCase, Repository)에서 출력한다. Controller에서는 요청/응답 로그를 인터셉터로 처리한다.
4. 로그에 개인정보(비밀번호, 토큰, 주민번호 등)를 포함하지 않는다.
5. 에러 로그에는 stack trace를 포함한다.

---

## 11) 보안 규칙 (MUST)

1. 모든 외부 입력(Request Body, Query, Param)은 `class-validator`로 검증한다. 타입만으로 신뢰하지 않는다.
2. 인증(Authentication)은 Guard로, 인가(Authorization)는 Policy/Guard + Decorator 조합으로 처리한다.
3. SQL 쿼리는 ORM의 파라미터 바인딩을 사용한다. Raw query에 사용자 입력을 직접 삽입하지 않는다(SQL Injection 방지).
4. 응답에서 민감 정보(비밀번호 해시, 내부 ID 체계, 스택 트레이스 등)를 노출하지 않는다.
5. 시크릿/API 키는 코드와 로그에서 마스킹한다.
6. 패키지 취약점은 주기적으로 `npm audit`으로 점검한다.

---

## 12) 크롤링 & 스크래핑 특화 규칙 (MUST)

1. **인프라 종속성 분리**: 외부 HTML 문서 구조(DOM 제어, Cheerio 쿼리 등) 및 Puppeteer/Axios 등의 라이브러리에 의존하는 네트워크 코드는 **반드시 Infrastructure Layer**에만 위치해야 한다. 도메인 레이어는 크롤링 수단이 무엇인지 몰라야 한다.
2. **리소스 관리 (메모리 릭 방지)**: Puppeteer 사용 시 브라우저나 페이지 인스턴스는 사용 시 무조건 `try-finally` 구문을 활용하여 `close()`를 명시적으로 호출해 메모리 누수를 방지한다.
3. **차단 우회 및 재시도 (Rate Limit/Retry)**: 타겟 서버의 차단을 피하기 위해 BullMQ의 `backoff` 설정(지수 백오프)과 재시도(retries)를 활용한다. 429(Too Many Requests)나 일시적 500 에러는 재시도 처리하고, 404/수정블가 에러 등은 즉시 실패 처리한다.
4. **스레드/워커 동시성 관리**: 스크래핑 워커(Consumer)는 대상 서버에 무리를 주지 않도록 `@Processor`의 동시 처리 수(concurrency)를 서비스 제약에 맞게 조절한다.
5. **데이터 정합성 보장(Idempotency)**: 동일한 URL에 대한 크롤링 작업은 여러번 큐에서 실행되어도 DB에서 중복 저장되지 않도록 멱등성(Idempotency)을 보장하는 방식(예: UPSERT)으로 작성해야 한다.

---

## 13) 충돌 시 우선순위

1. 가독성
2. 도메인 정확성
3. 아키텍처 일관성
4. 성능 최적화

성능 최적화는 측정/프로파일링 근거 없이 가독성을 해치지 않는다.
