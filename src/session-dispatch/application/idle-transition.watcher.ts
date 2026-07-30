import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';

import { ConsoleEventBus } from '../../console/application/console-event-bus.service';
import {
  ConsoleEvent,
  ConsoleSession,
} from '../../console/domain/console.type';
import { SessionDispatchService } from './session-dispatch.service';

@Injectable()
export class IdleTransitionWatcher implements OnApplicationBootstrap {
  private readonly logger = new Logger(IdleTransitionWatcher.name);
  private readonly previousStates = new Map<string, ConsoleSession['state']>();

  constructor(
    private readonly bus: ConsoleEventBus,
    private readonly dispatch: SessionDispatchService,
  ) {}

  onApplicationBootstrap(): void {
    this.bus.stream().subscribe((event) => {
      this.handleEvent(event);
    });
  }

  private handleEvent(event: ConsoleEvent): void {
    if (event.type === 'session.closed') {
      this.previousStates.delete(event.sessionId);
      return;
    }

    if (event.type !== 'session.opened' && event.type !== 'session.updated') {
      return;
    }

    const previousState = this.previousStates.get(event.session.sessionId);
    this.previousStates.set(event.session.sessionId, event.session.state);
    if (!this.isActiveToIdle(previousState, event.session.state)) {
      return;
    }

    void this.dispatch
      .onSessionBecameIdle(event.session)
      .catch((error: unknown) => {
        this.logger.error(
          `Idle 세션 dispatch 실패 (sessionId=${event.session.sessionId}): ${String(error)}`,
        );
      });
  }

  private isActiveToIdle(
    previousState: ConsoleSession['state'] | undefined,
    nextState: ConsoleSession['state'],
  ): boolean {
    return previousState === 'active' && nextState === 'idle';
  }
}
