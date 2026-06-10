import { parsePlainDate, PlainDate } from './plain-date';

export type VacationCommand =
  | { action: 'BALANCE' }
  | { action: 'LIST' }
  | {
      action: 'REGISTER';
      startDate: PlainDate;
      endDate: PlainDate;
      memo?: string;
    }
  | { action: 'CANCEL'; usageId: number }
  | { action: 'INVALID' };

// 결정론 파서. 자연어 추론 없음 — 정해진 서브커맨드 + YYYY-MM-DD(~YYYY-MM-DD) 만 해석.
export const parseVacationCommand = (text: string): VacationCommand => {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed === '잔여') {
    return { action: 'BALANCE' };
  }
  if (trimmed === '내역') {
    return { action: 'LIST' };
  }

  const cancelMatch = /^취소\s+(\d+)$/.exec(trimmed);
  if (cancelMatch) {
    return { action: 'CANCEL', usageId: Number(cancelMatch[1]) };
  }

  const useMatch = /^사용\s+([^\s~]+)(?:\s*~\s*([^\s]+))?(?:\s+(.+))?$/.exec(
    trimmed,
  );
  if (useMatch) {
    const startDate = parsePlainDate(useMatch[1]);
    const endDate = useMatch[2] ? parsePlainDate(useMatch[2]) : startDate;
    if (!startDate || !endDate) {
      return { action: 'INVALID' };
    }
    return {
      action: 'REGISTER',
      startDate,
      endDate,
      memo: useMatch[3]?.trim() || undefined,
    };
  }

  return { action: 'INVALID' };
};
