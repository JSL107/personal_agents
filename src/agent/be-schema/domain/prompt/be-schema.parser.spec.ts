import { parseSchemaProposal } from './be-schema.parser';

describe('parseSchemaProposal', () => {
  const REQUEST = '주문 취소 내역 테이블 추가';

  it('raw JSON 응답을 그대로 파싱한다', () => {
    const text = JSON.stringify({
      proposedModel: 'model OrderCancellation { id Int @id }',
      affectedRelations: ['Order'],
      requiredIndexes: ['orderId'],
      conventionChecks: ['snake_case @@map'],
      risks: ['backfill 필요'],
      migrationStrategy: 'add-only',
      reasoning: '취소 내역을 별도 테이블로 분리.',
    });

    const result = parseSchemaProposal(REQUEST, text);

    expect(result.request).toBe(REQUEST);
    expect(result.proposedModel).toContain('OrderCancellation');
    expect(result.affectedRelations).toEqual(['Order']);
    expect(result.requiredIndexes).toEqual(['orderId']);
    expect(result.conventionChecks).toEqual(['snake_case @@map']);
    expect(result.risks).toEqual(['backfill 필요']);
    expect(result.migrationStrategy).toBe('add-only');
    expect(result.reasoning).toContain('취소');
  });

  it('```json 펜스로 감싸진 응답을 풀어서 파싱한다', () => {
    const text =
      '```json\n{"proposedModel":"model X {}","affectedRelations":[],"requiredIndexes":[],"conventionChecks":["a"],"risks":[],"migrationStrategy":"add-only","reasoning":"r"}\n```';

    const result = parseSchemaProposal(REQUEST, text);

    expect(result.proposedModel).toBe('model X {}');
    expect(result.conventionChecks).toEqual(['a']);
  });

  it('JSON 이 아닌 자유 텍스트면 원문을 proposedModel 로 보존하고 conventionChecks 에 파싱 실패 표시', () => {
    const text = 'Prisma 모델을 다음과 같이 제안합니다…';

    const result = parseSchemaProposal(REQUEST, text);

    expect(result.request).toBe(REQUEST);
    expect(result.proposedModel).toBe(text);
    expect(result.conventionChecks).toEqual([
      '(파싱 실패 — LLM 원문을 proposedModel 로 보존)',
    ]);
    expect(result.affectedRelations).toEqual([]);
    expect(result.risks).toEqual([]);
  });

  it('배열 필드에 string 외 값이 섞이면 string 만 남긴다', () => {
    const text = JSON.stringify({
      proposedModel: 'model A {}',
      affectedRelations: ['B', 42, null, 'C'],
      requiredIndexes: [],
      conventionChecks: ['x'],
      risks: [],
      migrationStrategy: 'add-only',
      reasoning: 'r',
    });

    const result = parseSchemaProposal(REQUEST, text);

    expect(result.affectedRelations).toEqual(['B', 'C']);
  });

  it('migrationStrategy / reasoning 누락 시 빈 문자열로 graceful', () => {
    const text = JSON.stringify({
      proposedModel: 'model A {}',
      affectedRelations: [],
      requiredIndexes: [],
      conventionChecks: ['x'],
      risks: [],
    });

    const result = parseSchemaProposal(REQUEST, text);

    expect(result.migrationStrategy).toBe('');
    expect(result.reasoning).toBe('');
  });

  it('LLM 이 affectedFiles 를 echo 해도 parser 는 항상 빈 배열로 reset (서버 주입)', () => {
    // V3 단계 5 — parser 는 LLM 이 어떻게 응답해도 affectedFiles 를 신뢰하지 않는다.
    // usecase 가 Code Graph query 결과로 덮어씀.
    const text = JSON.stringify({
      proposedModel: 'model A {}',
      affectedRelations: [],
      requiredIndexes: [],
      conventionChecks: ['x'],
      risks: [],
      migrationStrategy: 'add-only',
      reasoning: 'r',
      affectedFiles: ['malicious.ts', '../etc/passwd'],
    });

    const result = parseSchemaProposal(REQUEST, text);
    expect(result.affectedFiles).toEqual([]);
  });

  it('파싱 실패 시에도 affectedFiles 는 빈 배열', () => {
    const result = parseSchemaProposal(REQUEST, 'not-json text');
    expect(result.affectedFiles).toEqual([]);
  });
});
