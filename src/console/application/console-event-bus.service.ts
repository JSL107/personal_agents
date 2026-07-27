import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

import { ConsoleEvent } from '../domain/console.type';

/**
 * 콘솔 SSE 스트림을 위한 in-process 이벤트 버스.
 *
 * 신규 의존성(@nestjs/event-emitter) 없이 RxJS `Subject` 로 발행/구독을 처리한다.
 * agent-run 라이프사이클·PreviewGate 승인 지점에서 `publish` 하고, `@Sse()` 컨트롤러가
 * `stream()` 을 구독해 클라이언트로 relay 한다. 구독 이전 이벤트는 재전달하지 않는다
 * (연결 직후 상태는 `/snapshot` 으로 별도 동기화).
 */
@Injectable()
export class ConsoleEventBus {
  private readonly subject = new Subject<ConsoleEvent>();

  publish(event: ConsoleEvent): void {
    this.subject.next(event);
  }

  stream(): Observable<ConsoleEvent> {
    return this.subject.asObservable();
  }
}
