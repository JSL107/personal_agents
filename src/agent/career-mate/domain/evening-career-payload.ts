// 저녁 경력 반영 카드(EVENING_CAREER_REFLECT)의 payload 를 읽고 쓰는 한 지점.
//
// 이 형태를 아는 곳이 셋이다 — 카드를 그리는 슬랙 빌더, 입력을 받아 저장하는 핸들러,
// 승인 시 회고를 도는 applier. 각자 `prGroups ?? [prRefs]` 를 따로 풀면 한 곳만 고쳤을 때
// 나머지가 조용히 빈 결과를 낸다(그룹이 0개면 입력칸이 사라지거나 맥락이 유실된다).
//
// 맥락은 묶음마다 따로 받는다. 묶음 하나가 회고 1회 = 성과 1건이라, 카드 전체에 한 줄만
// 받으면 회사 저장소의 수치가 개인 프로젝트 성과에도 붙는다 — 이 레포가 가장 경계하는
// 종류의 오염이다(group-pr-refs.ts 머리말 참고).

export interface EveningCareerPayload {
  // 저장소별로 나뉜 PR 묶음. 묶음 하나가 회고 1회 = 성과 1건이 된다.
  prGroups?: string[][];
  // 그룹 도입(2026-08-31) 이전에 만들어져 아직 승인되지 않은 카드가 쓰는 형태.
  prRefs?: string[];
  slackUserId: string;
  // 묶음 순서에 맞춘 "이 작업이 무엇에 영향을 갔는지". 안 적은 묶음은 null.
  // 전부 비면 키 자체가 사라져 도입 전 payload 와 같아진다.
  impactContexts?: (string | null)[];
}

// 카드가 실제로 회고할 묶음들. 신형(prGroups) 우선, 없으면 구형(prRefs)을 한 묶음으로.
export const resolveCareerPrGroups = (
  payload: EveningCareerPayload | null | undefined,
): string[][] => {
  const grouped = (payload?.prGroups ?? []).filter((refs) => refs.length > 0);
  if (grouped.length > 0) {
    return grouped;
  }
  const legacy = payload?.prRefs ?? [];
  return legacy.length > 0 ? [legacy] : [];
};

// 묶음 이름 — 카드 입력칸 라벨과 결과 문구에 쓴다. refs 는 `owner/repo#123` 형태.
export const careerGroupRepo = (refs: string[]): string =>
  refs[0]?.split('#')[0] ?? '(알 수 없음)';

// 묶음 하나에 적힌 맥락. 공백만 있으면 없는 것으로 본다 — 빈 문자열을 그대로 흘리면
// 회고 프롬프트가 빈 맥락 절을 달게 된다.
export const readImpactContext = (
  payload: EveningCareerPayload | null | undefined,
  index: number,
): string | undefined => {
  const value = payload?.impactContexts?.[index];
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
};

// 묶음 하나의 맥락을 갈아 끼운 새 payload. 원본은 건드리지 않는다.
//
// 배열은 항상 묶음 수만큼 채운다 — 구멍 뚫린 배열은 JSON 왕복에서 길이가 흔들리고,
// 인덱스로 맞추는 쪽이 뒤에서 어긋난다. 전부 비면 키를 지워 도입 전 payload 로 되돌린다.
export const withImpactContext = ({
  payload,
  index,
  impactContext,
}: {
  payload: unknown;
  index: number;
  impactContext: string;
}): EveningCareerPayload => {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('경력 반영 카드 payload 가 객체가 아닙니다.');
  }
  const candidate = payload as EveningCareerPayload;
  // 입력칸은 경력 반영 카드에만 붙지만, block_id 는 사용자가 보낸 값이다. 형태를 확인하지
  // 않으면 오래된 카드의 block_id 로 같은 사용자의 다른 preview payload 에 맥락이 심긴다.
  const groups = resolveCareerPrGroups(candidate);
  if (groups.length === 0) {
    throw new Error('경력 반영 카드가 아닙니다 — 카드가 오래됐을 수 있습니다.');
  }
  if (index < 0 || index >= groups.length) {
    throw new Error(
      `묶음 ${index + 1} 번이 카드에 없습니다 — 카드가 오래됐을 수 있습니다.`,
    );
  }

  const trimmed = impactContext.trim();
  const next = groups.map((_refs, position) =>
    position === index
      ? trimmed || null
      : (readImpactContext(candidate, position) ?? null),
  );
  const result = { ...candidate };
  if (next.some((value) => value !== null)) {
    result.impactContexts = next;
  } else {
    delete result.impactContexts;
  }
  return result;
};
