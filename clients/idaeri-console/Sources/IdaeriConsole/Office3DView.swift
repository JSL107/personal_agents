import AppKit
import ConsoleCore
import SwiftUI
import WebKit

/// 오피스 화면을 무엇으로 그릴지(`"2d"` · `"3d"`). 앱이 처음 쓰는 UserDefaults 다 — 메뉴
/// 「보기 ▸ 3D 오피스」(MainMenu.swift)가 바꾸고 `OfficeView` 의 `@AppStorage` 가 받는다.
let officeRendererDefaultsKey = "officeRenderer"

/// 3D 오피스 — 웹 렌더러(`clients/office-web`, three.js)를 WKWebView 로 얹는다.
///
/// 윈도우 Electron 앱과 **같은 코드**를 쓰고, 데이터만 다른 길로 들어간다. 웹은 스스로 fetch·SSE 를
/// 열지만 여기서는 앱이 먹여 준다(`live.js` 의 `?hosted=1`).
/// - 평면도: 지금 받은 직원 명단으로 `makeOfficeLayoutExport` 를 그 자리에서 만들어 문서가 뜨기 전에
///   넣는다. 파일로 구운 `layout-*.json` 처럼 낡지 않는다.
/// - 상태: 앱의 기존 연결(`ConsoleStore`)을 같은 모양으로 다시 실어 민다(`Office3DController`).
/// - 클릭·방 확대·esc: 화면이 `webkit.messageHandlers.idaeri` 로 돌려보내고 `OfficeView` 가 처리한다.
///
/// 파일은 커스텀 스킴(`idaeri-office://app/…`)으로 준다. `file://` 로 열면 ES 모듈이 출처 제약에 막힌다.
struct Office3DCanvas: View {
    let agents: [ConsoleAgent]
    let controller: Office3DController

    var body: some View {
        if agents.isEmpty {
            // 명단이 비면 좌석도 0개다. 빈 평면도로 띄우면 "백엔드가 꺼졌다" 와 구별되지 않는다.
            placeholder("직원 명단을 받는 중…")
        } else if let root = officeWebRoot() {
            Office3DWebView(agents: agents, root: root, controller: controller)
                // 명단(사람·부서)이 바뀌면 좌석이 바뀐다 — 평면도를 다시 넣으려면 문서를 새로 연다.
                .id(officeLayoutKey(agents))
        } else {
            placeholder("3D 화면 파일(office-web)을 찾지 못했습니다 — 앱 번들을 다시 만드세요.")
        }
    }

    private func placeholder(_ text: String) -> some View {
        Text(text)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(CozyPalette.canvas)
    }
}

/// 좌석을 바꾸는 입력만 모은 키. 상태·말풍선이 바뀔 때마다 문서를 다시 열면 안 된다.
private func officeLayoutKey(_ agents: [ConsoleAgent]) -> String {
    agents.map { "\($0.agentType):\($0.resolvedDepartment.rawValue)" }.sorted().joined(separator: ",")
}

/// office-web 파일이 있는 곳. `.app` 이면 `Contents/Resources/office-web`(scripts/build-app.sh 가
/// 복사), `swift run` 이면 저장소의 `clients/office-web` 를 그대로 쓴다.
///
/// `Bundle.module`(SwiftPM 리소스)에 넣지 않은 이유: office-web 은 이 타깃 밖에 있고, 통째로 넣으면
/// `node_modules` 까지 딸려 온다.
private func officeWebRoot() -> URL? {
    let fileManager = FileManager.default
    if let bundled = Bundle.main.resourceURL?.appendingPathComponent("office-web"),
        fileManager.fileExists(atPath: bundled.appendingPathComponent("index.html").path)
    {
        return bundled
    }
    let source = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()  // IdaeriConsole
        .deletingLastPathComponent()  // Sources
        .deletingLastPathComponent()  // idaeri-console
        .deletingLastPathComponent()  // clients
        .appendingPathComponent("office-web")
    return fileManager.fileExists(atPath: source.appendingPathComponent("index.html").path) ? source : nil
}

/// 문서가 뜨기 전에 실행할 평면도 주입문. 3열·2열 둘 다 넣는다 — 창 비율에 따라 화면이 고른다.
private func officeLayoutsScript(agents: [ConsoleAgent]) -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    var entries: [String] = []
    for columns in [3, 2] {
        guard let data = try? encoder.encode(makeOfficeLayoutExport(agents: agents, zoneColumns: columns)),
            let json = String(data: data, encoding: .utf8)
        else {
            continue
        }
        entries.append("\"\(columns)\": \(json)")
    }
    // 하나라도 빠지면 화면이 "앱이 평면도를 넣어 주지 않았다" 로 끊는다(빈 사무실로 넘어가지 않게).
    return "window.idaeriLayouts = {\(entries.joined(separator: ","))};"
}

private struct Office3DWebView: NSViewRepresentable {
    let agents: [ConsoleAgent]
    let root: URL
    let controller: Office3DController

    /// 웹뷰는 여기서 만들지 않고 `controller` 에게 받는다 — 탭을 떠났다 돌아오면 이 뷰는 새로
    /// 만들어지지만 웹뷰는 같은 것이어야 걷던 사람이 그 자리에 있다.
    func makeNSView(context: Context) -> WKWebView {
        controller.webView(agents: agents, root: root)
    }

    func updateNSView(_ webView: WKWebView, context: Context) {}
}

/// `idaeri-office://app/<경로>` → office-web 파일. 경로 가두기는 `officeWebResourceURL`(ConsoleCore, 테스트됨).
private final class OfficeWebSchemeHandler: NSObject, WKURLSchemeHandler {
    let root: URL

    init(root: URL) {
        self.root = root
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url,
            let file = officeWebResourceURL(root: root, requestPath: url.path),
            let data = try? Data(contentsOf: file),
            let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": officeWebMimeType(for: file)]
            )
        else {
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}

/// 앱 ↔ 3D 화면 통로이자 웹뷰의 주인. `AppRootView` 가 소유한다 — 2D 씬(`officeScene`)과 같은
/// 자리다. `OfficeView` 는 탭을 떠나면 사라지므로, 거기에 두면 돌아올 때마다 문서가 새로 떠 걷던
/// 사람이 전부 제자리로 돌아간다.
///
/// **화면이 `ready` 를 보내기 전에는 아무것도 밀지 않는다.** 그 전에는 렌더러가 서지 않아
/// 선택·상태 변화가 조용히 버려진다(화면은 렌더러를 세운 뒤에 `ready` 를 보낸다). 대신 마지막 스냅샷·잠·선택을 들고 있다가 `ready` 에 한꺼번에 보낸다 —
/// 안 그러면 첫 화면이 다음 변화(길면 30초 재동기화)까지 빈 사무실로 남는다.
final class Office3DController: NSObject, ObservableObject, WKScriptMessageHandler {
    /// 화면이 보낸 사건(`office:agent-click` · `office:president-click` · `office:focus` · `escape`).
    var onMessage: (([String: Any]) -> Void)?

    private var webView: WKWebView?
    /// 지금 웹뷰가 어느 명단의 평면도로 떴는지(`officeLayoutKey`). 명단이 바뀌면 새로 띄운다.
    private var layoutKey: String?
    private var isReady = false
    private var latestSnapshot: String?
    private var latestPending: String?
    private var latestBriefing: String?
    private var pendingSnapshot: ConsoleSnapshot?
    private var snapshotScheduled = false
    private var sleeping = false
    private var selectedAgent: String?
    /// 화면이 마지막으로 알린 방 확대. 탭에 돌아온 `OfficeView` 가 머리줄을 여기에 맞춘다 —
    /// 웹뷰는 확대한 채 남아 있는데 머리줄만 "전체" 로 돌아가면 나가는 길 안내가 사라진다.
    private(set) var focusedDepartment: Department?

    /// 이 명단의 3D 화면. 같은 명단이면 앞서 띄운 웹뷰를 그대로 돌려준다(탭 복귀).
    func webView(agents: [ConsoleAgent], root: URL) -> WKWebView {
        let key = officeLayoutKey(agents)
        if let webView, layoutKey == key {
            return webView
        }
        releaseWebView()
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(OfficeWebSchemeHandler(root: root), forURLScheme: "idaeri-office")
        configuration.userContentController.addUserScript(
            WKUserScript(
                source: officeLayoutsScript(agents: agents),
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )
        configuration.userContentController.add(self, name: "idaeri")
        let webView = WKWebView(frame: .zero, configuration: configuration)
        self.webView = webView
        layoutKey = key
        if let url = URL(string: "idaeri-office://app/index.html?renderer=3d&hosted=1") {
            webView.load(URLRequest(url: url))
        }
        return webView
    }

    /// 웹뷰를 놓는다 — 명단이 바뀌어 새로 띄울 때와 2D 로 돌아갈 때(안 보는 화면의 프로세스를 남기지 않는다).
    func releaseWebView() {
        // 메시지 처리기는 웹뷰 설정이 **강하게** 붙든다. 떼지 않으면 옛 문서가 이 객체와 서로 붙들고 남는다.
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "idaeri")
        webView = nil
        layoutKey = nil
        isReady = false
        focusedDepartment = nil
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else {
            return
        }
        if type == "ready" {
            isReady = true
            if let latestSnapshot {
                send(latestSnapshot)
            }
            if let latestPending {
                send(latestPending)
            }
            if let latestBriefing {
                send(latestBriefing)
            }
            setSleeping(sleeping)
            setSelected(selectedAgent)
            return
        }
        if type == "office:focus" {
            focusedDepartment = (body["department"] as? String).flatMap(Department.init(rawValue:))
        }
        onMessage?(body)
    }

    /// 한 번의 재동기화에 `agents`·`runs`·`sessions`·`approvals` 가 한꺼번에 바뀌어 이 함수가 네 번
    /// 불린다. 매번 스냅샷 전체를 인코딩해 보내면 화면도 `applySnapshot` 을 네 번 돈다 — 같은 실행
    /// 루프 안의 요청은 마지막 것 하나로 묶는다.
    func pushSnapshot(_ snapshot: ConsoleSnapshot) {
        pendingSnapshot = snapshot
        guard !snapshotScheduled else {
            return
        }
        snapshotScheduled = true
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                return
            }
            self.snapshotScheduled = false
            guard let snapshot = self.pendingSnapshot,
                let message = officeHostedSnapshotMessage(snapshot)
            else {
                return
            }
            self.pendingSnapshot = nil
            self.latestSnapshot = message
            self.send(message)
        }
    }

    func pushEvent(_ event: ConsoleEvent) {
        if let message = officeHostedEventMessage(event) {
            send(message)
        }
    }

    /// 인계·회의·거절 연출. 나머지 지시는 `officeHostedIntentMessage` 가 걸러 보내지 않는다.
    func pushIntents(_ intents: [VisualIntent]) {
        for intent in intents {
            if let message = officeHostedIntentMessage(intent) {
                send(message)
            }
        }
    }

    /// 내가 보낸 지시의 단계. 화면이 서기 전에 온 값은 들고 있다가 `ready` 에 보낸다.
    func pushPending(_ pendingCommands: [PendingCommand]) {
        guard let message = officeHostedPendingMessage(pendingCommands) else {
            return
        }
        latestPending = message
        send(message)
    }

    /// 대표 브리핑(할 일 말풍선·연속 도장·정산 종이). 웹뷰 주소(`idaeri-office://`)는 파일만 주고 백엔드로 넘기지
    /// 않아 화면이 직접 조회할 수 없다 — 앱이 받은 값을 그대로 민다. 화면이 서기 전에 온 값은 `ready` 에 보낸다.
    func pushBriefing(_ briefing: ConsoleBriefing?) {
        let data = briefing.flatMap { try? JSONEncoder().encode($0) }
        let json = data.flatMap { String(data: $0, encoding: .utf8) } ?? "null"
        let message = #"{"type":"briefing","data":"# + json + "}"
        latestBriefing = message
        send(message)
    }

    func setSleeping(_ value: Bool) {
        sleeping = value
        send(#"{"type":"sleep","value":\#(value)}"#)
    }

    func setSelected(_ agentType: String?) {
        selectedAgent = agentType
        send(#"{"type":"select","value":\#(jsonString(agentType))}"#)
    }

    func setFocus(_ department: Department?) {
        send(#"{"type":"focus","value":\#(jsonString(department?.rawValue))}"#)
    }

    private func send(_ message: String) {
        guard isReady, let webView else {
            return
        }
        webView.evaluateJavaScript("window.idaeri.push(\(message))")
    }

    private func jsonString(_ value: String?) -> String {
        guard let value, let data = try? JSONEncoder().encode(value) else {
            return "null"
        }
        return String(data: data, encoding: .utf8) ?? "null"
    }
}
