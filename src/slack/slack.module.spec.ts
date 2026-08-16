import * as fs from 'node:fs';
import * as path from 'node:path';

// SlackService 는 SLACK_HANDLER_PORT 배열에 담긴 handler 만 register(app) 한다.
// providers 에만 넣고 inject 배열에 빠뜨리면 그 handler 의 슬래시·액션이 통째로 죽는데,
// DI 는 성공하고 앱도 정상 부팅해서 런타임에 눌러보기 전까지 아무도 모른다
// (실제로 AssignmentActionHandler 가 이렇게 누락돼 분배 카드 드롭다운이 전부 무반응이었다).
//
// 모듈을 import 해서 메타데이터를 읽으면 의존 그래프 전체가 로드되고 @octokit/rest(ESM)에서
// jest 가 깨진다. 검사 대상이 "두 목록이 일치하는가" 뿐이라 소스를 정적으로 읽어 비교한다.
const readModuleSource = (): string =>
  fs.readFileSync(path.join(__dirname, 'slack.module.ts'), 'utf-8');

// `inject: [ ... ]` 안쪽 문자열. 대괄호 짝을 세어 잘라낸다.
const sliceInjectBlock = (source: string): string => {
  const start = source.indexOf('inject: [');
  if (start === -1) {
    return '';
  }
  const from = source.indexOf('[', start);
  let depth = 0;
  for (let index = from; index < source.length; index += 1) {
    if (source[index] === '[') {
      depth += 1;
    }
    if (source[index] === ']') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(from, index + 1);
      }
    }
  }
  return '';
};

// `SlackHandler` 는 handler 구현체가 아니라 포트 인터페이스 이름이라 세지 않는다
// (useFactory 시그니처에 타입으로 등장한다).
const PORT_INTERFACE_NAME = 'SlackHandler';

const collectHandlerNames = (block: string): string[] =>
  [...new Set(block.match(/\b\w+Handler\b/g) ?? [])].filter(
    (name) => name !== PORT_INTERFACE_NAME,
  );

describe('SlackModule 핸들러 등록', () => {
  const source = readModuleSource();
  const injectBlock = sliceInjectBlock(source);
  // providers 영역에서 inject 블록만 들어낸 나머지 — 두 목록을 섞지 않고 비교하기 위해.
  const providersBlock = source
    .slice(source.indexOf('providers: ['))
    .replace(injectBlock, '');

  it('inject 블록을 찾을 수 있어야 한다 (검사 자체의 전제)', () => {
    expect(injectBlock.length).toBeGreaterThan(0);
    expect(collectHandlerNames(injectBlock).length).toBeGreaterThan(0);
  });

  it('providers 의 모든 *Handler 가 inject 배열에도 있어야 한다', () => {
    const injected = collectHandlerNames(injectBlock);
    const missing = collectHandlerNames(providersBlock).filter(
      (handler) => !injected.includes(handler),
    );

    expect(missing).toEqual([]);
  });

  it('inject 배열에 providers 없는 handler 가 들어가지 않는다', () => {
    const provided = collectHandlerNames(providersBlock);
    const unknownEntries = collectHandlerNames(injectBlock).filter(
      (handler) => !provided.includes(handler),
    );

    expect(unknownEntries).toEqual([]);
  });
});
