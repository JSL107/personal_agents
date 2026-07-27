import { Controller, MessageEvent, Sse } from '@nestjs/common';
import { map, Observable } from 'rxjs';

import { RawResponse } from '../../common/decorator/raw-response.decorator';
import { ConsoleEventBus } from '../application/console-event-bus.service';

// 콘솔 관제 실시간 스트림 — 앱이 부팅 스냅샷 이후 구독하는 SSE 이벤트 소스.
@Controller('v1/console')
export class ConsoleStreamController {
  constructor(private readonly bus: ConsoleEventBus) {}

  // @RawResponse: ResponseInterceptor 의 {code,message,data} 래핑을 건너뛴다(SSE 포맷 보존).
  // 각 ConsoleEvent 를 MessageEvent.data 로 감싸면 NestJS 가 `data: <json>\n\n` 으로 직렬화한다.
  @Sse('stream')
  @RawResponse()
  stream(): Observable<MessageEvent> {
    return this.bus.stream().pipe(map((event) => ({ data: event })));
  }
}
