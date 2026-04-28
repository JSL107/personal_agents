export const SCHEMA_FILE_READER_PORT = Symbol('SCHEMA_FILE_READER_PORT');

// 현재 prisma/schema.prisma 본문을 그대로 읽어 LLM prompt 에 주입하기 위한 port.
// 별도 모듈로 분리한 이유 — prompt 빌더가 fs 직접 의존하지 않게 (테스트 시 mock 교체 가능).
export interface SchemaFileReaderPort {
  readSchema(): Promise<string>;
}
