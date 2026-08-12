import AppKit
import ConsoleCore
import SpriteKit

/// 창을 띄우지 않고 사무실 씬을 PNG 로 굽는다 — 화면 회귀 확인용.
///
/// 시각 변경(조명·배치·색)은 눈으로 봐야 판정된다. 그런데 확인 경로가 "앱을 띄우고 사람이
/// 본다" 하나뿐이면, 화면 기록 권한이 없는 환경이나 자동 점검에서는 **그려지긴 했는지조차**
/// 알 수 없다. 실제로 창을 하나 추가하고도 그것이 화면에 나왔는지 확인하지 못한 적이 있다.
///
///     swift run IdaeriConsole --render /tmp/office.png --hour 18
///
/// 시각을 넘기면 그 시간대로 고정해 굽는다 — 밤 화면을 보려고 밤까지 기다릴 수는 없다.
/// 백엔드가 떠 있으면 실제 스냅샷을 쓰고, 없으면 사람 없는 빈 사무실로 굽는다.
func renderOfficeScene(client: ConsoleClient, path: String, hour: Int?, size: CGSize) -> Bool {
    let scene = OfficeScene(size: size)
    scene.scaleMode = .resizeFill
    scene.hourOverride = hour
    scene.skipsChoreography = true
    let view = SKView(frame: CGRect(origin: .zero, size: size))
    view.presentScene(scene)

    let snapshot = fetchSnapshotSynchronously(client: client)
    scene.sync(agents: snapshot?.agents ?? [], approvals: snapshot?.approvals ?? [])
    // 세션도 함께 그린다 — 빠뜨리면 실제 앱에만 있는 사람들이 회귀 확인에서 통째로 빠진다
    // (세션 이름표가 서로 겹쳐 못 읽던 문제가 이 구멍으로 렌더 점검을 빠져나갔다).
    scene.syncSessions(snapshot?.sessions ?? [])
    scene.updateCompanySummary(snapshot?.agents ?? [])
    // 말풍선·경과·승인 배지는 오버레이라 sync 로는 그려지지 않는다. 빼면 이 화면으로
    // 확인할 수 있는 대상에서 "무슨 일 중" 문구가 통째로 빠진다.
    scene.refreshOverlays(
        agents: snapshot?.agents ?? [],
        runs: snapshot?.runs ?? [],
        pendingCommands: [],
        now: Date()
    )

    guard
        let texture = view.texture(from: scene),
        let image = texture.cgImage() as CGImage?
    else {
        FileHandle.standardError.write(Data("씬을 이미지로 만들지 못했다\n".utf8))
        return false
    }
    let bitmap = NSBitmapImageRep(cgImage: image)
    guard let data = bitmap.representation(using: .png, properties: [:]) else {
        return false
    }
    do {
        try data.write(to: URL(fileURLWithPath: path))
        return true
    } catch {
        FileHandle.standardError.write(Data("PNG 저장 실패: \(error)\n".utf8))
        return false
    }
}

/// 렌더는 한 장을 굽고 끝나는 일회성 실행이라, 스냅샷을 기다렸다가 그리는 편이 단순하다.
/// 실패해도 빈 사무실로 굽는다 — 백엔드가 꺼져 있다고 화면 확인까지 막힐 이유는 없다.
private func fetchSnapshotSynchronously(client: ConsoleClient) -> ConsoleSnapshot? {
    let semaphore = DispatchSemaphore(value: 0)
    var result: ConsoleSnapshot?
    Task {
        result = try? await client.fetchSnapshot()
        semaphore.signal()
    }
    // 렌더가 백엔드 응답에 매달려 멈추지 않게 상한을 둔다.
    //
    // **신호를 받았을 때만 결과를 읽는다.** 타임아웃으로 빠져나온 뒤 읽으면, 아직 살아 있는
    // 작업의 쓰기와 여기의 읽기가 같은 변수에서 겹쳐 데이터 경합이 된다. `signal()` 을 받은
    // 경우에는 쓰기가 그보다 먼저 끝난 것이 보장되므로 안전하다.
    guard semaphore.wait(timeout: .now() + 5) == .success else {
        return nil
    }
    return result
}
