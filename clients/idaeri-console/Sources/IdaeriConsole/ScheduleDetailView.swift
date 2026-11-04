import AppKit
import ConsoleCore
import SwiftUI

/// 날짜 목록과 기한 없음 목록이 함께 쓰는 업무 상세 영역.
struct ScheduleDetailView: View {
    let item: ScheduleItem
    let client: ConsoleClient
    let onChanged: () async -> Void
    let onDueDateChanged: (String) async -> Void

    @State private var detail: ScheduleDetail?
    @State private var failure: String?
    @State private var startDate = Date()
    @State private var hasStartDate = false
    @State private var dueDate = Date()
    @State private var dueTime = ""
    @State private var remindAt = Date()
    @State private var hasReminder = false
    @State private var recipient = ""
    @State private var topic = ""
    @State private var trigger: FollowUpTrigger = .onDone
    @State private var triggerAt = Date()
    @State private var note = ""

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            if let failure {
                Text(failure).font(Typography.caption).foregroundStyle(.red)
            }
            if let detail {
                followUps(detail.followUps)
                linkedPullRequests(detail.linkedPullRequests)
                timeline(detail.events)
            } else if failure != nil {
                Button("다시 불러오기") { Task { await load() } }
            } else {
                ProgressView("상세를 불러오는 중입니다")
            }
            noteEditor
            Divider()
            scheduleEditor
            followUpEditor
        }
        .task(id: item.id) { await load() }
    }

    private func followUps(_ items: [ScheduleFollowUp]) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text("📣 연락할 일").font(Typography.captionEmphasis)
            if items.isEmpty {
                Text("등록된 연락할 일이 없습니다").font(Typography.caption).foregroundStyle(.secondary)
            }
            ForEach(items) { followUp in
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text("\(followUp.recipient) · \(followUp.topic)")
                        .font(Typography.caption)
                    Text(followUp.trigger == .onDone ? "완료할 때" : "정해진 시각")
                        .font(Typography.captionSmall).foregroundStyle(.secondary)
                    if let draft = followUp.draft, !draft.isEmpty {
                        DisclosureGroup("초안 보기") {
                            Text(draft).font(Typography.caption).textSelection(.enabled)
                            Button("복사") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(draft, forType: .string) }
                                .buttonStyle(.plain)
                        }
                    }
                    if followUp.sentAt == nil {
                        Button("보냄 표시") {
                            Task {
                                await perform {
                                    _ = try await client.markFollowUpSent(id: followUp.id)
                                }
                            }
                        }
                    } else {
                        Text("보냄").font(Typography.captionSmall).foregroundStyle(.secondary)
                    }
                }
                .padding(Spacing.xs)
            }
        }
    }

    private func linkedPullRequests(_ events: [ScheduleEvent]) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text("연결된 PR").font(Typography.captionEmphasis)
            if events.isEmpty {
                Text("연결된 PR이 없습니다").font(Typography.caption).foregroundStyle(.secondary)
            }
            ForEach(events) { event in
                if let rawURL = event.payload.url, let url = safeScheduleLinkURL(rawURL) {
                    Link(event.payload.title ?? rawURL, destination: url)
                        .font(Typography.caption)
                } else {
                    Text(event.payload.title ?? "PR 연결").font(Typography.caption)
                }
            }
        }
    }

    private func timeline(_ events: [ScheduleEvent]) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text("타임라인").font(Typography.captionEmphasis)
            if events.isEmpty {
                Text("기록이 없습니다").font(Typography.caption).foregroundStyle(.secondary)
            }
            ForEach(events) { event in
                HStack(alignment: .top, spacing: Spacing.xs) {
                    Text(String(event.occurredAt.prefix(10)))
                        .foregroundStyle(.secondary)
                    Text(eventLabel(event))
                }
                .font(Typography.captionSmall)
            }
        }
    }

    private func eventLabel(_ event: ScheduleEvent) -> String {
        switch event.kind {
        case "CREATED": return "업무 등록"
        case "STATUS_CHANGED": return "상태 변경 \(event.payload.from ?? "") → \(event.payload.to ?? "")"
        case "NOTE": return event.payload.text ?? "메모"
        case "PR_LINKED": return "PR 연결"
        case "PR_MERGED": return "PR 머지"
        case "REMINDED": return "알림"
        case "FOLLOW_UP_NOTIFIED": return "연락할 일 알림"
        default: return event.kind
        }
    }

    private var noteEditor: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text("메모 남기기").font(Typography.captionEmphasis)
            HStack {
                TextField("한 줄 메모", text: $note)
                    .textFieldStyle(.roundedBorder)
                Button("추가") {
                    Task {
                        await perform {
                            _ = try await client.addNote(scheduleId: item.id, text: note.trimmingCharacters(in: .whitespacesAndNewlines))
                            note = ""
                        }
                    }
                }
                .disabled(note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || scheduleFieldOverflow(note, limit: ScheduleFieldLimit.note) > 0)
            }
            overflowNotice(note, limit: ScheduleFieldLimit.note)
        }
    }

    private var scheduleEditor: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text("일정 편집").font(Typography.captionEmphasis)
            if item.dueDay == nil {
                DatePicker("마감일", selection: $dueDate, displayedComponents: .date)
                    .datePickerStyle(.stepperField)
                Button("마감일 지정") {
                    let dayKey = scheduleDateKey(dueDate)
                    Task {
                        do {
                            _ = try await client.patchSchedule(id: item.id, fields: ["dueDate": dayKey])
                            failure = nil
                            await onDueDateChanged(dayKey)
                        } catch {
                            failure = failureReason(error)
                        }
                    }
                }
            }
            Toggle("시작일", isOn: $hasStartDate)
            if hasStartDate {
                DatePicker("", selection: $startDate, displayedComponents: .date)
                    .labelsHidden().datePickerStyle(.stepperField)
            }
            Button("시작일 저장") {
                Task {
                    await perform { _ = try await client.patchSchedule(id: item.id, fields: ["startDate": hasStartDate ? scheduleDateKey(startDate) : nil]) }
                }
            }
            HStack {
                TextField("마감 시각 HH:mm", text: $dueTime)
                    .textFieldStyle(.roundedBorder)
                Button("시각 저장") {
                    Task { await perform { _ = try await client.patchSchedule(id: item.id, fields: ["dueTime": dueTime.isEmpty ? nil : dueTime]) } }
                }
                .disabled(!dueTime.isEmpty && !isValidTime(dueTime))
            }
            Toggle("알림 시각", isOn: $hasReminder)
            if hasReminder {
                DatePicker("", selection: $remindAt)
                    .labelsHidden().datePickerStyle(.stepperField)
            }
            Button("알림 저장") {
                Task {
                    await perform { _ = try await client.patchSchedule(id: item.id, fields: ["remindAt": hasReminder ? Self.offsetDate(remindAt) : nil]) }
                }
            }
        }
    }

    private var followUpEditor: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text("연락할 일 추가").font(Typography.captionEmphasis)
            TextField("받는 사람", text: $recipient).textFieldStyle(.roundedBorder)
            overflowNotice(recipient, limit: ScheduleFieldLimit.recipient)
            TextField("알릴 내용", text: $topic).textFieldStyle(.roundedBorder)
            overflowNotice(topic, limit: ScheduleFieldLimit.topic)
            Picker("언제", selection: $trigger) {
                Text("완료할 때").tag(FollowUpTrigger.onDone)
                Text("정해진 시각").tag(FollowUpTrigger.atTime)
            }
            if trigger == .atTime {
                DatePicker("알릴 시각", selection: $triggerAt).datePickerStyle(.stepperField)
            }
            Button("연락할 일 추가") {
                Task {
                    await perform {
                        _ = try await client.addFollowUp(scheduleId: item.id,
                            recipient: recipient.trimmingCharacters(in: .whitespacesAndNewlines),
                            topic: topic.trimmingCharacters(in: .whitespacesAndNewlines),
                            trigger: trigger,
                            triggerAt: trigger == .atTime ? Self.offsetDate(triggerAt) : nil)
                        recipient = ""
                        topic = ""
                    }
                }
            }
            .disabled(recipient.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                || topic.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                || scheduleFieldOverflow(recipient, limit: ScheduleFieldLimit.recipient) > 0
                || scheduleFieldOverflow(topic, limit: ScheduleFieldLimit.topic) > 0)
        }
    }

    @ViewBuilder
    private func overflowNotice(_ value: String, limit: Int) -> some View {
        let excess = scheduleFieldOverflow(value, limit: limit)
        if excess > 0 {
            Text("\(excess)자 줄여 주세요 (최대 \(limit)자)")
                .font(Typography.captionSmall).foregroundStyle(.red)
        }
    }

    private func load() async {
        do {
            let found = try await client.fetchDetail(id: item.id)
            detail = found
            failure = nil
            let current = found.item
            hasStartDate = current.startDay != nil
            if let startDay = current.startDay { startDate = scheduleDate(fromKey: startDay) ?? Date() }
            if let dueDay = current.dueDay { dueDate = scheduleDate(fromKey: dueDay) ?? Date() }
            dueTime = current.dueTime ?? ""
            hasReminder = current.remindAt != nil
            if let raw = current.remindAt {
                let formatter = ISO8601DateFormatter()
                formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                remindAt = formatter.date(from: raw) ?? ISO8601DateFormatter().date(from: raw) ?? Date()
            }
        } catch {
            failure = failureReason(error)
        }
    }

    private func perform(_ operation: () async throws -> Void) async {
        do {
            try await operation()
            failure = nil
            await load()
            await onChanged()
        } catch {
            failure = failureReason(error)
        }
    }

    private func failureReason(_ error: Error) -> String {
        if case let ConsoleClientError.badStatus(status) = error {
            if status == 404 { return "백엔드가 옛 버전인지 확인하세요." }
            return "저장하지 못했습니다 (HTTP \(status))."
        }
        return "백엔드에 연결하지 못했습니다."
    }

    private func isValidTime(_ value: String) -> Bool {
        let pieces = value.split(separator: ":", omittingEmptySubsequences: false)
        guard pieces.count == 2, pieces[0].count == 2, pieces[1].count == 2,
              let hour = Int(pieces[0]), let minute = Int(pieces[1]) else { return false }
        return (0...23).contains(hour) && (0...59).contains(minute)
    }

    private static func offsetDate(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        formatter.timeZone = .current
        return formatter.string(from: date)
    }
}
