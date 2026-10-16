import AppKit
import Combine
import ConsoleCore
import SwiftUI

/// 스토어의 사건을 짧은 말풍선으로 바꾸고, 상시 패널의 타이머를 소유한다.
@MainActor final class MascotController: ObservableObject {
    // 값이 같으면 다시 쓰지 않는다. `@Published` 는 같은 값을 써도 화면을 다시 그리게 하는데,
    // 스토어는 SSE·30초 재동기화마다 바뀌므로 상시 창이 그때마다 다시 그려진다.
    @Published private(set) var mood: MascotMood = .idle
    @Published private(set) var blinking = false
    @Published private(set) var bubble: MascotBubble?
    @Published private(set) var commandInputOpen = false
    /// 보낸 지시의 답을 기다리는 중. 화면은 작업 자세·통통 튀기·점 세 개로 "돌고 있다" 를 보인다.
    @Published private(set) var thinking = false
    /// 한 번 재생하는 몸짓 그림(`happy`·`poke`). 짧게 켜졌다 꺼진다.
    @Published private(set) var flourish: MascotPose?
    /// 지금 하는 일의 소품 그림. 없으면 nil.
    @Published private(set) var activity: MascotPose?
    /// 머리 위 배지 숫자 — 돌고 있는 이대리 실행 + 일하는 내 세션.
    @Published private(set) var busyCount = 0
    /// 클릭으로 연 진행 목록. 다시 누르거나 [닫기], 45초 뒤 닫힌다.
    private var statusOpen = false
    private var statusTimer: Timer?
    private var flourishTimer: Timer?
    private var thinkingSince: Date?
    private var thinkingDoneSince: Date?
    /// "생각 중" 말풍선 문구. 보낼 때 한 번 고른다.
    private var thinkingLine = ""
    private var fidgetTimer: Timer?
    /// 기다리는 동안만 5초마다 다시 본다 — 답 없이 끝나는 유예(20초)·상한(15분)은 시간이 지나야 판정된다.
    private var thinkingTimer: Timer?
    /// 화면이 한 번 재생할 몸짓. `id` 가 바뀔 때마다 재생한다(같은 몸짓을 연달아 줄 수 있게).
    @Published private(set) var motion = MascotMotion(kind: .hop, id: 0)
    /// 지시 입력창의 안내 문구. 열 때마다 한 번 고른다.
    @Published private(set) var commandPrompt = mascotSay(mascotQuip(.commandPrompt, random: 0))
    /// 마지막으로 말풍선을 띄운 시각. 혼잣말은 이때부터 오래 조용할 때만 꺼낸다.
    private var lastSpokeAt = Date()

    private func setMood(_ value: MascotMood) {
        if mood != value {
            mood = value
        }
    }

    private func setBubble(_ value: MascotBubble?) {
        if bubble != value {
            bubble = value
            if value != nil {
                lastSpokeAt = Date()
            }
        }
    }

    /// 그림 자세. 지시를 기다리는 동안은 쉬는 중이어도 작업 자세로 보인다(승인·실패가 우선).
    var displayMood: MascotMood {
        thinking && mood == .idle ? .working : mood
    }

    /// 답장 말풍선이 열려 있는가 — 열려 있는 동안 쪽지를 읽는 그림을 쓴다.
    var isReading: Bool {
        if case .reply = bubble {
            return true
        }
        return false
    }

    /// 기쁨 춤을 보이는 시간. 4장 반복 춤이라 1.2초면 한 바퀴도 못 돌고 끝나 눈에 안 띈다 — 두 바퀴 남짓.
    private let mascotHappySeconds: TimeInterval = 2

    /// 한 번 몸짓 그림을 잠깐 띄운다.
    func flourish(_ pose: MascotPose, seconds: TimeInterval) {
        flourish = pose
        flourishTimer?.invalidate()
        flourishTimer = Timer.scheduledTimer(withTimeInterval: seconds, repeats: false) { [weak self] _ in
            Task { @MainActor [weak self] in self?.flourish = nil }
        }
    }

    func play(_ kind: MascotMotion.Kind) {
        motion = MascotMotion(kind: kind, id: motion.id + 1)
    }

    /// 같은 내용에는 같은 소리를 고른다. 말풍선은 재동기화마다 다시 그려지는데, 그때마다 새로 뽑으면
    /// 보고 있는 문구가 깜빡이며 바뀐다. 프로세스 안에서만 같으면 되므로 `hashValue` 로 충분하다.
    private func steadyRandom(_ key: String) -> Double {
        Double(UInt(bitPattern: key.hashValue) % 1000) / 1000
    }

    let panel = MascotPanel()
    private let store: ConsoleStore
    private var subscriptions: Set<AnyCancellable> = []
    private var minuteTimer: Timer?
    private var graceTimer: Timer?
    private var blinkTimer: Timer?
    private var blinkEndTimer: Timer?
    private var briefingTimer: Timer?
    private var reactionTimer: Timer?
    private var replyTimer: Timer?
    private var refreshQueued = false
    private var dismissedApprovalIds: Set<String> = []
    private var submittedApprovalId: String?
    /// 지금 승인 말풍선에 띄운 카드와 처음 띄운 시각. [승인] 지연(`mascotApprovalArmed`)의 기준.
    private var approvalShown: (id: String, at: Date)?
    private var approvalArmTimer: Timer?
    private var briefingBubble: MascotBubble?
    private var reactionBubble: MascotBubble?
    private var replyBubble: MascotBubble?
    private var lastMascotCommand: (text: String, sentAt: Date)?
    /// 마스코트가 보낸 지시의 id. 답장(`command.answered`)을 이 id 로만 받는다.
    private var mascotCommandId: UUID?
    private var failedNoticeCommandId: UUID?
    private var dismissedFailureIds: Set<UUID> = []
    private var reactionLedger: MascotReactionLedger
    private let reactionFile: URL
    private let briefingSlotKey = "mascotLastBriefingSlot"

    init(store: ConsoleStore) {
        self.store = store
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("IdaeriConsole", isDirectory: true)
        reactionFile = support.appendingPathComponent("mascot-reactions.json")
        if let data = try? Data(contentsOf: reactionFile),
           let ledger = try? JSONDecoder().decode(MascotReactionLedger.self, from: data) {
            reactionLedger = ledger
        } else {
            reactionLedger = MascotReactionLedger()
        }
        panel.contentView = NSHostingView(rootView: MascotView(controller: self))
        store.objectWillChange.sink { [weak self] _ in
            // willChange 시점에는 값이 아직 이전 상태다. 다음 runloop 에서 한 번만 다시 읽는다.
            DispatchQueue.main.async { self?.queueRefresh() }
        }.store(in: &subscriptions)
        store.eventStream.sink { [weak self] event in
            DispatchQueue.main.async { self?.receive(event) }
        }.store(in: &subscriptions)
        NotificationCenter.default.publisher(for: .idaeriOpenMascotCommand).sink { [weak self] _ in
            DispatchQueue.main.async { self?.openCommandInput() }
        }.store(in: &subscriptions)
    }

    func show() {
        panel.orderFrontRegardless()
        refresh()
        minuteTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in self?.refresh() }
        }
        scheduleBlink()
        scheduleFidget()
    }

    /// 평소 몸짓. 가만히 눈만 깜빡이면 멈춘 그림처럼 보여, 15~35초마다 한 번 무언가 한다.
    /// 말풍선이 떠 있거나 승인·실패 자세일 때는 쉰다 — 읽는 중에 움직이면 방해가 된다.
    private func scheduleFidget() {
        fidgetTimer?.invalidate()
        fidgetTimer = Timer.scheduledTimer(
            withTimeInterval: mascotFidgetDelay(random: .random(in: 0..<1)), repeats: false
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                if self.bubble == nil, self.mood == .idle || self.mood == .working {
                    let kinds: [MascotMotion.Kind] = self.mood == .working
                        ? [.hop, .sway] : [.lookAround, .hop, .sway, .lookAround]
                    self.play(kinds.randomElement() ?? .sway)
                }
                self.scheduleFidget()
            }
        }
    }

    /// 캐릭터를 한 번 눌렀을 때 — 진행 목록을 펴고 접는다.
    func poke() {
        play(.squish)
        flourish(.poke, seconds: 0.8)
        statusOpen ? closeStatus() : openStatus()
    }

    func openStatus() {
        statusOpen = true
        statusTimer?.invalidate()
        statusTimer = Timer.scheduledTimer(withTimeInterval: 45, repeats: false) { [weak self] _ in
            Task { @MainActor [weak self] in self?.closeStatus() }
        }
        refreshBubble()
    }

    /// 할 일 줄의 버튼. 재시도는 대시보드 [재시도]와 같은 `AppRootView.retryRun` 경로를 탄다.
    func perform(_ action: MascotTodoRow.Action) {
        switch action {
        case .openDashboard:
            showDashboard()
        case let .retry(runId):
            NotificationCenter.default.post(name: .idaeriMascotRetry, object: nil, userInfo: ["runId": runId])
        case let .openURL(raw):
            if let url = URL(string: raw) {
                NSWorkspace.shared.open(url)
            }
        }
    }

    func closeStatus() {
        statusOpen = false
        statusTimer?.invalidate()
        refreshBubble()
    }

    func showBriefingNow() {
        guard let briefing = store.briefing else { return }
        showTransient(.briefing(voicedBriefingLines(briefing)), duration: 20)
    }

    /// 진행 목록 머리 — 브리핑(할 일 한 줄 + 연속 기록). 같은 내용엔 같은 소리.
    private func statusHeader() -> [String] {
        guard let briefing = store.briefing else {
            return []
        }
        var lines = mascotBriefingLines(briefing: briefing)
        if !lines.isEmpty {
            let key = lines[0]
            lines[0] = briefing.todos.isEmpty
                ? mascotSay(mascotQuip(.briefingClear, random: steadyRandom(key)))
                : mascotSay(mascotQuip(.briefingTodo, random: steadyRandom(key)), key)
        }
        return lines
    }

    /// 브리핑 첫 줄(할 일)에 우사기 소리를 입힌다. 연속 기록 줄은 그대로 둔다.
    private func voicedBriefingLines(_ briefing: ConsoleBriefing) -> [String] {
        var lines = mascotBriefingLines(briefing: briefing)
        guard !lines.isEmpty else {
            return lines
        }
        let random = Double.random(in: 0..<1)
        lines[0] = briefing.todos.isEmpty
            ? mascotSay(mascotQuip(.briefingClear, random: random))
            : mascotSay(mascotQuip(.briefingTodo, random: random), lines[0])
        return lines
    }

    func openCommandInput() {
        // 할 일 목록은 생각 중·답장보다 먼저 그려진다. 열린 채 지시를 보내면 진행 표시와 답이 목록에
        // 가려지므로, 지시 입력을 여는 순간 목록을 닫는다.
        if statusOpen {
            closeStatus()
        }
        commandPrompt = mascotSay(mascotQuip(.commandPrompt, random: .random(in: 0..<1)))
        play(.hop)
        commandInputOpen = true
        panel.setCommandInputActive(true)
        panel.makeKey()
        refreshBubble()
    }

    func sendCommand(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return
        }
        lastMascotCommand = (trimmed, Date())
        mascotCommandId = nil
        thinking = true
        thinkingSince = Date()
        thinkingDoneSince = nil
        thinkingLine = mascotSay(mascotQuip(.thinking, random: .random(in: 0..<1)))
        thinkingTimer?.invalidate()
        thinkingTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in self?.queueRefresh() }
        }
        replyBubble = nil
        replyTimer?.invalidate()
        failedNoticeCommandId = nil
        NotificationCenter.default.post(name: .idaeriMascotCommand, object: nil, userInfo: ["text": trimmed])
        bindMascotCommandId()
        closeCommandInput()
    }

    func closeCommandInput() {
        guard commandInputOpen else {
            return
        }
        commandInputOpen = false
        panel.setCommandInputActive(false)
        panel.resignKey()
        refreshBubble()
    }

    func closeReply() {
        replyBubble = nil
        replyTimer?.invalidate()
        refreshBubble()
    }

    func clearNotice() {
        if store.approvalNotice != nil {
            store.setApprovalNotice(nil)
        } else if let failedNoticeCommandId {
            dismissedFailureIds.insert(failedNoticeCommandId)
            self.failedNoticeCommandId = nil
        }
        queueRefresh()
    }

    func approve(id: String) {
        guard submittedApprovalId != id,
              store.approvals.contains(where: { $0.id == id }) else { return }
        submittedApprovalId = id
        setBubble(nil)
        NotificationCenter.default.post(name: .idaeriMascotApprove, object: nil, userInfo: ["id": id])
        // 승인 처리는 메인 창의 `AppRootView` 가 받는다. 그쪽이 통지를 놓치면 카드가 감춰지지도
        // 실패 안내가 뜨지도 않아 `submittedApprovalId` 가 풀리지 않고, 말풍선이 영영 빈 채로
        // 남는다 — 승인 버튼 무반응(`try?` 은폐) 사고와 같은 모양이다. 1초 안에 접수 흔적
        // (카드 감춤 또는 실패 안내)이 없으면 놓친 것으로 보고 이유를 말한다.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
            guard let self, self.submittedApprovalId == id, self.store.approvalNotice == nil,
                  self.store.approvals.contains(where: { $0.id == id })
            else {
                return
            }
            self.submittedApprovalId = nil
            self.store.setApprovalNotice("승인 요청이 접수되지 않았습니다. 콘솔 창에서 다시 시도하세요.")
            self.queueRefresh()
        }
        queueRefresh()
    }

    func showDashboard() {
        NotificationCenter.default.post(name: .idaeriShowDashboard, object: nil)
    }

    func dismissApproval(id: String) {
        dismissedApprovalIds.insert(id)
        refreshBubble()
    }

    private func queueRefresh() {
        guard !refreshQueued else { return }
        refreshQueued = true
        DispatchQueue.main.async { [weak self] in
            self?.refreshQueued = false
            self?.refresh()
        }
    }

    private func refresh() {
        let now = Date()
        let todos = store.briefing?.todos ?? []
        let previousMood = mood
        setMood(mascotMood(approvals: store.approvals, runs: store.runs, todos: todos, now: now))
        if mood == .failed, previousMood != .failed {
            play(.shake)
            showTransient(
                .reaction(mascotSay(mascotQuip(.trouble, random: .random(in: 0..<1)), "엎어진 일 있어")),
                duration: 8
            )
        }
        if mood != .idle && mood != .working && blinking {
            blinking = false
        }
        if let submittedApprovalId,
           !store.approvals.contains(where: { $0.id == submittedApprovalId }) || store.approvalNotice != nil {
            self.submittedApprovalId = nil
        }
        let nextActivity = mascotActivity(runs: store.runs, agents: store.agents, sessions: store.sessions, now: now)
        if activity != nextActivity {
            activity = nextActivity
        }
        let nextBusy = mascotBusyCount(runs: store.runs, sessions: store.sessions, now: now)
        if busyCount != nextBusy {
            busyCount = nextBusy
        }
        scheduleGraceRecheck(now: now)
        refreshCommandResult()
        maybeShowBriefing(now: now)
        maybeReactToWorkload(now: now)
        maybeChatter(now: now)
        refreshBubble()
    }

    /// 오래 조용하면 가끔 혼잣말을 한다. 하루 3번·확률 0.35 — 매분 확인하므로 확률을 낮게 둔다.
    private func maybeChatter(now: Date) {
        guard bubble == nil,
              mascotChatterDue(mood: mood, lastSpokeAt: lastSpokeAt, now: now, calendar: .current),
              reactionLedger.fireDaily(
                  prefix: "chatter", max: 3, chance: 0.35,
                  random: .random(in: 0..<1), now: now, calendar: .current
              )
        else {
            return
        }
        saveReactionLedger(now: now)
        showTransient(.reaction(mascotSay(mascotQuip(.chatter, random: .random(in: 0..<1)))), duration: 8)
        play(.hop)
    }

    /// 보낸 지시가 store 에 올라간 id 를 잡아 둔다. 통지는 `AppRootView` 가 받아 기록을 만들므로
    /// 보낸 직후에 못 찾으면 다음 갱신에서 다시 찾는다.
    private func bindMascotCommandId() {
        guard mascotCommandId == nil, let lastMascotCommand else {
            return
        }
        mascotCommandId = store.pendingCommands.last(where: {
            $0.text == lastMascotCommand.text && $0.sentAt >= lastMascotCommand.sentAt
        })?.id
    }

    /// 보낸 지시가 실패했는지를 그 지시 한 건의 기록(`pendingCommands`)에서 읽는다.
    ///
    /// 답장은 여기서 읽지 않는다 — worker 가 도는 지시는 `run.finished` 가 먼저 와 기록이 `.done`
    /// 이 되고, 뒤이은 `command.answered` 는 phase 를 바꾸지 않는다(`ConsoleStore.markCommand`).
    /// 게다가 `.done` 기록은 5초 정리 루프가 지운다. 그래서 답장은 이벤트로 받는다(`receive`).
    private func refreshCommandResult() {
        bindMascotCommandId()
        refreshThinking()
        guard let mascotCommandId,
              let command = store.pendingCommands.first(where: { $0.id == mascotCommandId }),
              command.phase == .failed
        else {
            return
        }
        replyBubble = nil
        replyTimer?.invalidate()
        if !dismissedFailureIds.contains(command.id) {
            failedNoticeCommandId = command.id
        }
    }

    /// "생각 중" 을 언제 내릴지. 답(`command.answered`)이 오면 `showReply` 가 내린다. 여기서는 답 없이
    /// 끝나는 길을 막는다 — 실패, 실행이 끝났는데 답이 안 오는 경우(20초 유예), 너무 오래 걸리는 경우.
    private func refreshThinking() {
        guard thinking else {
            return
        }
        let now = Date()
        let command = mascotCommandId.flatMap { id in store.pendingCommands.first(where: { $0.id == id }) }
        if command?.phase == .failed {
            endThinking()
            return
        }
        if command?.phase == .done || (mascotCommandId != nil && command == nil) {
            let since = thinkingDoneSince ?? now
            thinkingDoneSince = since
            if now.timeIntervalSince(since) >= 20 {
                endThinking()
            }
            return
        }
        if let thinkingSince, now.timeIntervalSince(thinkingSince) >= mascotThinkingTimeoutSeconds {
            endThinking()
            showTransient(.reaction(mascotSay(mascotQuip(.slow, random: 0))), duration: 12)
        }
    }

    private func endThinking() {
        thinkingTimer?.invalidate()
        thinkingTimer = nil
        thinking = false
        thinkingSince = nil
        thinkingDoneSince = nil
    }

    /// 마스코트가 보낸 지시의 답장만 띄운다. 대화 기록이 아니라 지시 id 로 짝을 맞춰야 앞 지시의
    /// 늦은 답이 새 지시의 답으로 보이지 않는다.
    private func showReply(commandId: String, message: String) {
        bindMascotCommandId()
        let reply = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let mascotCommandId, commandId == mascotCommandId.uuidString, !reply.isEmpty else {
            return
        }
        endThinking()
        // 답이 왔는데 할 일 목록이 열려 있으면 답이 가려진다 — 답을 먼저 보인다.
        if statusOpen {
            statusOpen = false
            statusTimer?.invalidate()
        }
        let parts = mascotSplitReply(reply)
        replyBubble = .reply(
            sound: mascotQuip(.reply, random: .random(in: 0..<1)).sound,
            body: parts.body,
            signature: parts.signature
        )
        // 깡충 한 번으로는 눈길이 닿기 전에 끝난다. 두 번 뛰고, 답장은 [닫기]를 누를 때까지 남긴다 —
        // 30초 뒤 사라지면 자리를 비운 사이 온 답을 놓친다.
        play(.hop)
        flourish(.happy, seconds: mascotHappySeconds)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in self?.play(.hop) }
        replyTimer?.invalidate()
    }

    /// 브리핑보다 우선하는 말풍선이 지금 떠야 하는가 — `refreshBubble` 의 우선순위와 같은 조건.
    private var hasPriorityBubble: Bool {
        store.approvalNotice != nil
            || failedNoticeCommandId != nil
            || commandInputOpen
            || submittedApprovalId != nil
            || store.approvals.contains { !dismissedApprovalIds.contains($0.id) }
            || replyBubble != nil
            || thinking
            || statusOpen
    }

    private func refreshBubble() {
        // 승인 말풍선이 아닌 것을 그리는 동안에는 등장 시각을 지운다. 안내의 [확인]을 누르면 같은
        // 자리에 승인 말풍선이 다시 뜨는데, 옛 시각이 남아 있으면 지연 없이 바로 눌린다.
        if store.approvalNotice != nil || failedNoticeCommandId != nil || commandInputOpen
            || submittedApprovalId != nil
        {
            approvalShown = nil
        }
        if let notice = store.approvalNotice {
            setBubble(.notice(mascotSay(mascotQuip(.trouble, random: steadyRandom(notice)), notice)))
            return
        }
        if let failedNoticeCommandId,
           let failedCommand = store.pendingCommands.first(where: { $0.id == failedNoticeCommandId }) {
            let reason = failedCommand.reason?.trimmingCharacters(in: .whitespacesAndNewlines)
            let detail = reason.flatMap { $0.isEmpty ? nil : $0 } ?? "연결 확인"
            setBubble(.notice(mascotSay(
                mascotQuip(.trouble, random: steadyRandom(detail)), "지시를 못 보냈어 — \(detail)"
            )))
            return
        }
        if commandInputOpen {
            setBubble(.commandInput)
            return
        }
        // 사용자가 직접 연 목록이라 승인 말풍선보다 먼저 보인다. 승인 대기도 목록 맨 위에 있다.
        if statusOpen {
            setBubble(.status(
                header: statusHeader(),
                todos: mascotTodoRows(
                    todos: store.briefing?.todos ?? [], approvals: store.approvals, agents: store.agents,
                    retryingRunIds: store.retryingRunIds, now: Date()
                ),
                busyCount: busyCount,
                notice: store.runRetryNotice
            ))
            return
        }
        // 승인 통지를 보낸 뒤 스토어가 카드를 숨기기 전까지 같은 버튼을 다시 그리지 않는다.
        if submittedApprovalId != nil {
            setBubble(nil)
            return
        }
        let approvals = store.approvals.filter { !dismissedApprovalIds.contains($0.id) }
        if let approval = approvals.first {
            let now = Date()
            if approvalShown?.id != approval.id {
                approvalShown = (approval.id, now)
                play(.hop)
            }
            let shownAt = approvalShown?.at ?? now
            let armed = mascotApprovalArmed(shownAt: shownAt, now: now)
            if !armed {
                scheduleApprovalArm(at: shownAt.addingTimeInterval(mascotApprovalArmDelaySeconds))
            }
            setBubble(.approval(
                id: approval.id,
                headline: mascotSay(
                    mascotQuip(.approval, random: steadyRandom(approval.id)),
                    mascotApprovalHeadline(approval: approval, agents: store.agents)
                ),
                title: approval.title,
                more: approvals.count - 1,
                submitted: submittedApprovalId == approval.id,
                armed: armed
            ))
            return
        }
        approvalShown = nil
        if thinking, replyBubble == nil {
            setBubble(.thinking(thinkingLine))
            return
        }
        setBubble(replyBubble ?? briefingBubble ?? reactionBubble)
    }

    /// [승인]이 눌리기 시작하는 시각에 말풍선을 한 번 다시 그린다.
    private func scheduleApprovalArm(at date: Date) {
        approvalArmTimer?.invalidate()
        approvalArmTimer = Timer.scheduledTimer(
            withTimeInterval: max(0.01, date.timeIntervalSinceNow), repeats: false
        ) { [weak self] _ in
            Task { @MainActor [weak self] in self?.refreshBubble() }
        }
    }

    private func scheduleGraceRecheck(now: Date) {
        graceTimer?.invalidate()
        guard let date = mascotGraceRecheck(runs: store.runs, now: now) else { return }
        graceTimer = Timer.scheduledTimer(withTimeInterval: max(0.01, date.timeIntervalSince(now)), repeats: false) {
            [weak self] _ in Task { @MainActor [weak self] in self?.refresh() }
        }
    }

    private func maybeShowBriefing(now: Date) {
        guard let slot = mascotBriefingSlot(now: now, calendar: .current),
              UserDefaults.standard.string(forKey: briefingSlotKey) != slot,
              let briefing = store.briefing else { return }
        // 더 급한 말풍선이 떠 있으면 브리핑은 가려진다. 그때 칸을 기록하면 한 번도 보이지 않은 채
        // 그 시각이 지나가므로, 보일 수 있을 때까지 기록을 미룬다(1분 타이머·스토어 갱신이 다시 부른다).
        guard !hasPriorityBubble else { return }
        UserDefaults.standard.set(slot, forKey: briefingSlotKey)
        showTransient(.briefing(voicedBriefingLines(briefing)), duration: 20)
        play(.hop)
    }

    private func receive(_ event: ConsoleEvent) {
        if case let .commandAnswered(commandId, message) = event {
            showReply(commandId: commandId, message: message)
        }
        if case let .runFinished(run) = event, run.status == "SUCCEEDED" {
            let now = Date()
            if reactionLedger.fireDaily(
                prefix: "cheer", max: 2, chance: 0.3,
                random: Double.random(in: 0..<1), now: now, calendar: .current
            ) {
                saveReactionLedger(now: now)
                showTransient(.reaction(mascotSay(mascotQuip(.cheer, random: .random(in: 0..<1)))), duration: 8)
                play(.hop)
                flourish(.happy, seconds: mascotHappySeconds)
            }
        }
        queueRefresh()
    }

    private func maybeReactToWorkload(now: Date) {
        let failedCount = store.briefing?.todos.filter { $0.kind == .failedRun }
            .reduce(0) { $0 + $1.targets.count } ?? 0
        if store.approvals.count + failedCount >= 3,
           reactionLedger.fireOnce(
                "lots:" + MascotReactionLedger.halfDayKey(now: now, calendar: .current), now: now
           ) {
            saveReactionLedger(now: now)
            showTransient(.reaction(mascotSay(mascotQuip(.lots, random: .random(in: 0..<1)))), duration: 8)
            play(.shake)
        }
        if let streak = store.briefing?.streak,
           streak.todayOpened > 0, streak.todayRemaining == 0 {
            let day = mascotBriefingSlot(now: now, calendar: .current).map { String($0.prefix(10)) }
                ?? Self.dayString(now: now)
            if reactionLedger.fireOnce("done:" + day, now: now) {
                saveReactionLedger(now: now)
                showTransient(.reaction(mascotSay(mascotQuip(.dayDone, random: .random(in: 0..<1)))), duration: 8)
                play(.hop)
            }
        }
    }

    private static func dayString(now: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: now)
    }

    private func saveReactionLedger(now: Date) {
        reactionLedger.prune(now: now)
        do {
            try FileManager.default.createDirectory(
                at: reactionFile.deletingLastPathComponent(), withIntermediateDirectories: true
            )
            try JSONEncoder().encode(reactionLedger).write(to: reactionFile, options: .atomic)
        } catch {
            NSLog("마스코트 반응 기록 저장 실패: %@", String(describing: error))
        }
    }

    private func showTransient(_ value: MascotBubble, duration: TimeInterval) {
        switch value {
        case .briefing:
            briefingBubble = value
            briefingTimer?.invalidate()
            briefingTimer = Timer.scheduledTimer(withTimeInterval: duration, repeats: false) { [weak self] _ in
                Task { @MainActor [weak self] in
                    self?.briefingBubble = nil
                    self?.refreshBubble()
                }
            }
        case .reaction:
            reactionBubble = value
            reactionTimer?.invalidate()
            reactionTimer = Timer.scheduledTimer(withTimeInterval: duration, repeats: false) { [weak self] _ in
                Task { @MainActor [weak self] in
                    self?.reactionBubble = nil
                    self?.refreshBubble()
                }
            }
        case .notice, .commandInput, .status, .approval, .thinking, .reply:
            break
        }
        refreshBubble()
    }

    private func scheduleBlink() {
        blinkTimer?.invalidate()
        blinkTimer = Timer.scheduledTimer(withTimeInterval: Double.random(in: 3.5...6), repeats: false) {
            [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                if self.mood == .idle || self.mood == .working {
                    self.blinking = true
                    self.blinkEndTimer = Timer.scheduledTimer(withTimeInterval: 0.15, repeats: false) {
                        [weak self] _ in
                        Task { @MainActor [weak self] in self?.blinking = false }
                    }
                }
                self.scheduleBlink()
            }
        }
    }
}

/// 화면이 재생할 짧은 몸짓.
struct MascotMotion: Equatable {
    enum Kind {
        /// 깡충 — 새 소식(승인·답장·브리핑·칭찬).
        case hop
        /// 부르르 — 실패·할 일 많음.
        case shake
        /// 말랑 눌림 — 클릭.
        case squish
        /// 좌우 둘러보기 — 평소 몸짓.
        case lookAround
        /// 몸 흔들기 — 평소 몸짓.
        case sway
    }

    let kind: Kind
    let id: Int
}
