// 출력 스키마(codex `--output-schema`) 점검 유틸.
//
// 스키마를 손으로 다시 기술해 비교하면 그 사본이 또 하나의 드리프트 원본이 된다.
// 여기서는 스키마 자체에서 값을 파생시켜, 필드 이름·구조가 바뀌면 점검도 함께 움직이게 한다.

type SchemaNode = Record<string, unknown>;

const isObjectNode = (schema: SchemaNode): boolean => {
  const type = schema.type;
  return Array.isArray(type) ? type.includes('object') : type === 'object';
};

const getProperties = (schema: SchemaNode): Record<string, SchemaNode> =>
  (schema.properties ?? {}) as Record<string, SchemaNode>;

/**
 * 스키마에 선언된 property 만으로 최소 객체를 만든다.
 *
 * nullable 필드는 "채워진 쪽" 을 만들어 하위 필드까지 점검 대상에 넣는다.
 */
export const buildMinimalObject = (schema: SchemaNode): SchemaNode => {
  const built: SchemaNode = {};
  for (const [key, definition] of Object.entries(getProperties(schema))) {
    built[key] = buildValue(definition);
  }
  return built;
};

const buildValue = (definition: SchemaNode): unknown => {
  const type = definition.type;
  const resolved = Array.isArray(type)
    ? (type as string[]).find((candidate) => candidate !== 'null')
    : type;
  if (resolved === 'object') {
    return buildMinimalObject(definition);
  }
  if (resolved === 'array') {
    return [buildValue((definition.items ?? { type: 'string' }) as SchemaNode)];
  }
  if (resolved === 'number' || resolved === 'integer') {
    // 0 은 파서의 "값이 없어 기본값으로 떨어졌다" 와 구분되지 않으므로 피한다.
    return 1;
  }
  if (resolved === 'boolean') {
    return true;
  }
  const enumValues = definition.enum as string[] | undefined;
  return enumValues === undefined ? 'x' : enumValues[0];
};

/**
 * strict 규칙(선언한 property 전부 required + additionalProperties:false)을 어긴 지점을 모은다.
 *
 * 최상위만 보면 중첩 객체에서 규칙을 빠뜨려도 점검을 통과하고, 실제 호출에서 codex 가
 * 모델 호출 전에 exit 1 로 끊어 그 워커가 통째로 실패한다. 위반이 없으면 빈 배열.
 */
export const findStrictSchemaViolations = (
  schema: SchemaNode,
  path = '$',
): string[] => {
  if (!isObjectNode(schema)) {
    return [];
  }
  const violations: string[] = [];
  const properties = getProperties(schema);
  if (schema.additionalProperties !== false) {
    violations.push(`${path}: additionalProperties 가 false 가 아님`);
  }
  const declared = Object.keys(properties);
  const required = (schema.required ?? []) as string[];
  const missing = declared.filter((key) => !required.includes(key));
  if (missing.length > 0) {
    violations.push(`${path}: required 누락 — ${missing.join(', ')}`);
  }
  for (const [key, definition] of Object.entries(properties)) {
    violations.push(
      ...findStrictSchemaViolations(definition, `${path}.${key}`),
      // 배열 원소가 객체면 그 안도 strict 여야 한다 — items 를 안 보면 배열 속 객체의
      // 위반이 통째로 빠져나가 "모든 객체를 본다" 는 이 함수의 설명이 거짓이 된다.
      ...findStrictSchemaViolations(
        (definition.items ?? {}) as SchemaNode,
        `${path}.${key}[]`,
      ),
    );
  }
  return violations;
};
