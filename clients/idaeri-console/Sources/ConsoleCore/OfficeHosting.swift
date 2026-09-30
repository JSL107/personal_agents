import Foundation

/// 3D 오피스(웹 렌더러 `clients/office-web`)를 앱 안 WKWebView 에 얹을 때 **앱 → 화면** 으로 보내는
/// 메시지와, 화면이 요청한 파일 경로를 앱 리소스로 옮기는 경계.
///
/// 화면(`live.js` 의 hosted 모드)은 데이터를 스스로 받지 않는다. 앱이 이미 붙잡고 있는 스냅샷·SSE 를
/// 같은 모양으로 다시 실어 `window.idaeri.push(...)` 로 밀어 준다 — 두 번째 연결도, 토큰도 없다.
/// 뷰(`Office3DView`) 밖에 두는 이유는 테스트다: 메시지 모양이 어긋나면 화면은 **오류 없이 빈
/// 사무실**로 남는다.

/// 스냅샷 메시지. 모양은 백엔드 `/v1/console/snapshot` 의 `data` 와 같다 — `ConsoleSnapshot` 이
/// 그 계약을 미러링하고, 날짜는 문자열 그대로라 화면의 `Date.parse` 가 똑같이 읽는다.
public func officeHostedSnapshotMessage(_ snapshot: ConsoleSnapshot) -> String? {
    guard let data = try? JSONEncoder().encode(snapshot),
        let json = String(data: data, encoding: .utf8)
    else {
        return nil
    }
    return #"{"type":"snapshot","data":"# + json + "}"
}

private struct HostedStateChange: Encodable {
    let agentType: String
    let state: String
    let bubble: String?
}

/// 실시간 변화 메시지. 화면이 이벤트에서 쓰는 것은 **한 사람의 상태·말풍선**뿐이라
/// `stateChanged` 만 옮긴다(`applyStreamPayload`). 나머지 이벤트는 nil — 그 결과는 `ConsoleStore` 가
/// 반영한 뒤 스냅샷 메시지로 다시 간다.
public func officeHostedEventMessage(_ event: ConsoleEvent) -> String? {
    guard case let .stateChanged(agentType, state, bubble) = event else {
        return nil
    }
    let change = HostedStateChange(agentType: agentType, state: state.rawValue, bubble: bubble)
    guard let data = try? JSONEncoder().encode(change),
        let json = String(data: data, encoding: .utf8)
    else {
        return nil
    }
    return #"{"type":"event","data":"# + json + "}"
}

/// 화면이 요청한 경로(`idaeri-office://app/<경로>`)를 루트 안의 파일로 옮긴다. 루트 밖이면 nil.
///
/// 웹뷰가 부르는 것은 우리 파일뿐이지만, 이 핸들러는 **앱 권한으로 디스크를 읽는 입구**다.
/// `..` 한 줄이 새면 홈 디렉터리 아무 파일이나 화면 문맥으로 흘러간다. 그래서 구성 요소에
/// `..` 가 있으면 바로 끊고, 심볼릭 링크까지 푼 실제 위치가 루트 아래인지 한 번 더 본다
/// (루트 안에 밖을 가리키는 링크가 섞여 들어와도 따라가지 않는다).
/// - Parameter requestPath: URL 의 `path` (퍼센트 인코딩이 풀린 값). 비면 `index.html`.
public func officeWebResourceURL(root: URL, requestPath: String) -> URL? {
    let trimmed = requestPath.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    let relative = trimmed.isEmpty ? "index.html" : trimmed
    let components = relative.split(separator: "/", omittingEmptySubsequences: true)
    guard !components.contains(where: { $0 == ".." || $0 == "." }) else {
        return nil
    }
    let base = root.standardizedFileURL.resolvingSymlinksInPath()
    let candidate = base.appendingPathComponent(relative).standardizedFileURL.resolvingSymlinksInPath()
    guard candidate.path.hasPrefix(base.path + "/") else {
        return nil
    }
    return candidate
}

/// 파일 확장자 → MIME. ES 모듈은 `text/javascript` 가 아니면 웹뷰가 실행을 거부한다.
public func officeWebMimeType(for url: URL) -> String {
    switch url.pathExtension.lowercased() {
    case "html":
        return "text/html"
    case "js", "mjs":
        return "text/javascript"
    case "json":
        return "application/json"
    case "css":
        return "text/css"
    case "png":
        return "image/png"
    default:
        return "application/octet-stream"
    }
}
