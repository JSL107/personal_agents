import {
  CompletionRequest,
  CompletionResponse,
  ModelProviderName,
} from '../domain/model-router.type';
import { ModelProviderPort } from '../domain/port/model-provider.port';

// 실제 LLM SDK 어댑터가 붙기 전까지 사용할 Mock Provider.
// 동일한 클래스가 ChatGPT/Claude/Gemini 역할을 모두 대신한다 — DI 주입 시 name 을 factory 로 구분해 바인딩한다.
export class MockModelProvider implements ModelProviderPort {
  constructor(readonly name: ModelProviderName) {}

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    return {
      text: `[MOCK ${this.name}] ${request.prompt}`,
      modelUsed: `mock-${this.name.toLowerCase()}`,
      provider: this.name,
    };
  }
}
