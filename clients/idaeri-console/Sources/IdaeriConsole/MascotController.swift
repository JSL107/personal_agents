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

    private func setMood(_ value: MascotMood) {
        if mood != value {
            mood = value
        }
    }

    private func setBubble(_ value: MascotBubble?) {
        if bubble != value {
            bubble = value
        }
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
    private var briefingBubble: MascotBubble?
    private var reactionBubble: MascotBubble?
    private var replyBubble: MascotBubble?
    private var lastMascotCommand: (text: String, sentAt: Date)?
    private var observedConversationIds: Set<UUID> = []
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
    }

    func showBriefingNow() {
        guard let briefing = store.briefing else { return }
        showTransient(.briefing(mascotBriefingLines(briefing: briefing)), duration: 20)
    }

    func openCommandInput() {
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
        observedConversationIds = Set(store.conversation.map(\.id))
        replyBubble = nil
        replyTimer?.invalidate()
        failedNoticeCommandId = nil
        NotificationCenter.default.post(name: .idaeriMascotCommand, object: nil, userInfo: ["text": trimmed])
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
        setMood(mascotMood(approvals: store.approvals, runs: store.runs, todos: todos, now: now))
        if mood != .idle && mood != .working && blinking {
            blinking = false
        }
        if let submittedApprovalId,
           !store.approvals.contains(where: { $0.id == submittedApprovalId }) || store.approvalNotice != nil {
            self.submittedApprovalId = nil
        }
        scheduleGraceRecheck(now: now)
        maybeShowBriefing(now: now)
        maybeReactToWorkload(now: now)
        refreshCommandResult()
        refreshBubble()
    }

    private func refreshCommandResult() {
        guard let lastMascotCommand else {
            return
        }
        let failedCommand = store.pendingCommands.last {
            $0.text == lastMascotCommand.text && $0.sentAt >= lastMascotCommand.sentAt && $0.phase == .failed
        }
        if let failedCommand {
            replyBubble = nil
            replyTimer?.invalidate()
            if !dismissedFailureIds.contains(failedCommand.id) {
                failedNoticeCommandId = failedCommand.id
            }
        }
        let newTurns = store.conversation.filter { !observedConversationIds.contains($0.id) }
        observedConversationIds.formUnion(newTurns.map(\.id))
        guard failedCommand == nil,
              let reply = newTurns.last(where: { $0.role == .idaeri && $0.at >= lastMascotCommand.sentAt })
        else {
            return
        }
        replyBubble = .reply(reply.text)
        replyTimer?.invalidate()
        replyTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: false) { [weak self] _ in
            Task { @MainActor [weak self] in self?.closeReply() }
        }
    }

    private func refreshBubble() {
        if let notice = store.approvalNotice {
            setBubble(.notice(notice))
            return
        }
        if let failedNoticeCommandId,
           let failedCommand = store.pendingCommands.first(where: { $0.id == failedNoticeCommandId }) {
            let reason = failedCommand.reason?.trimmingCharacters(in: .whitespacesAndNewlines)
            let detail = reason.flatMap { $0.isEmpty ? nil : $0 } ?? "연결 확인"
            setBubble(.notice("지시를 보내지 못했습니다 — \(detail)"))
            return
        }
        if commandInputOpen {
            setBubble(.commandInput)
            return
        }
        // 승인 통지를 보낸 뒤 스토어가 카드를 숨기기 전까지 같은 버튼을 다시 그리지 않는다.
        if submittedApprovalId != nil {
            setBubble(nil)
            return
        }
        let approvals = store.approvals.filter { !dismissedApprovalIds.contains($0.id) }
        if let approval = approvals.first {
            setBubble(.approval(
                id: approval.id,
                headline: mascotApprovalHeadline(approval: approval, agents: store.agents),
                title: approval.title,
                more: approvals.count - 1,
                submitted: submittedApprovalId == approval.id
            ))
            return
        }
        setBubble(replyBubble ?? briefingBubble ?? reactionBubble)
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
        UserDefaults.standard.set(slot, forKey: briefingSlotKey)
        showTransient(.briefing(mascotBriefingLines(briefing: briefing)), duration: 20)
    }

    private func receive(_ event: ConsoleEvent) {
        if case let .runFinished(run) = event, run.status == "SUCCEEDED" {
            let now = Date()
            if reactionLedger.fireDaily(
                prefix: "cheer", max: 2, chance: 0.3,
                random: Double.random(in: 0..<1), now: now, calendar: .current
            ) {
                saveReactionLedger(now: now)
                showTransient(.reaction("잘했어요! 오늘도 한 건 끝냈네요."), duration: 8)
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
            showTransient(.reaction("할 일이 많네요. 하나씩 같이 해봐요."), duration: 8)
        }
        if let streak = store.briefing?.streak,
           streak.todayOpened > 0, streak.todayRemaining == 0 {
            let day = mascotBriefingSlot(now: now, calendar: .current).map { String($0.prefix(10)) }
                ?? Self.dayString(now: now)
            if reactionLedger.fireOnce("done:" + day, now: now) {
                saveReactionLedger(now: now)
                showTransient(.reaction("오늘 할 일을 모두 마쳤어요!"), duration: 8)
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
        case .notice, .commandInput, .approval, .reply:
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
