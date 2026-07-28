import ConsoleCore
import Foundation

func runSessionStoreTests(_ runner: TestRunner) {
    runner.suite("SessionStore")

    let session = ConsoleSession(
        sessionId: "s1", pid: 42, source: "claude", name: "repo-1",
        cwd: "/repo", state: "active",
        startedAt: "2026-07-27T00:00:00.000Z", lastActivityAt: nil
    )

    // 스냅샷 적용
    let store = ConsoleStore()
    store.apply(snapshot: ConsoleSnapshot(
        agents: [], runs: [], approvals: [], sessions: [session],
        serverTime: "2026-07-27T00:00:00.000Z"
    ))
    runner.expectEqual(store.sessions.count, 1, "스냅샷 세션 적재")

    // opened upsert (중복 id 는 교체)
    store.apply(event: .sessionOpened(session))
    runner.expectEqual(store.sessions.count, 1, "opened 는 id 로 upsert")

    // updated 상태 반영
    let updated = ConsoleSession(
        sessionId: "s1", pid: 42, source: "claude", name: "repo-1",
        cwd: "/repo", state: "idle",
        startedAt: "2026-07-27T00:00:00.000Z", lastActivityAt: nil
    )
    store.apply(event: .sessionUpdated(updated))
    runner.expectEqual(store.sessions.first?.state, "idle", "updated 상태 반영")

    // closed 제거
    store.apply(event: .sessionClosed(sessionId: "s1"))
    runner.expectEqual(store.sessions.count, 0, "closed 는 제거")
}
