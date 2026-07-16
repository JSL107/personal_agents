import {
  CompletionRequest,
  CompletionResponse,
  ModelProviderName,
} from '../model-router.type';

// DI 토큰: 각 ModelProviderName 에 1:1 매핑되는 Symbol.
// ModelRouterUsecase 는 이 토큰들로 Provider 구현체를 주입받는다.
export const MODEL_PROVIDER_TOKENS: Record<ModelProviderName, symbol> = {
  [ModelProviderName.CHATGPT]: Symbol('MODEL_PROVIDER_CHATGPT'),
  [ModelProviderName.CLAUDE]: Symbol('MODEL_PROVIDER_CLAUDE'),
};

export interface ModelProviderPort {
  readonly name: ModelProviderName;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  // 백엔드가 지금 호출을 받을 수 있는지 경량 확인(절전 직후 실행 게이트용). 구현은 선택 —
  // 미구현 provider 는 "항상 준비됨"으로 간주한다. CodexCliProvider 만 실제 probe 를 제공한다.
  probeReadiness?(): Promise<boolean>;
}
