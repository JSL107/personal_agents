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
  [ModelProviderName.GEMINI]: Symbol('MODEL_PROVIDER_GEMINI'),
};

export interface ModelProviderPort {
  readonly name: ModelProviderName;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
}
