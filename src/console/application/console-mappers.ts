import { PreviewAction } from '../../preview-gate/domain/preview-action.type';
import { ConsoleApproval } from '../domain/console.type';

// PreviewAction → 콘솔 승인 뷰. 스냅샷 조립(ConsoleReadService)과 승인 이벤트 emit(preview-gate)이 공유.
// v1: agentType 은 PreviewAction 에 없어 null (Phase 2 에서 kind→agentType 매핑 도입 시 채운다).
export function toConsoleApproval(preview: PreviewAction): ConsoleApproval {
  return {
    id: preview.id,
    agentType: null,
    title: preview.previewText,
    createdAt: preview.createdAt.toISOString(),
  };
}
