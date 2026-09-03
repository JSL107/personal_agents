import ConsoleCore
import SwiftUI

/// 부서 그리드의 카드 하나. 에이전트 이름·상태 색·말풍선·담당 슬래시를 보여준다.
struct AgentCardView: View {
    let agent: ConsoleAgent
    /// 전체 pending 목록 — 카드는 자신의 agentType 에 매칭되는 항목만 걸러 배지로 보여준다.
    let pendingCommands: [PendingCommand]
    let onSend: (String, String?) -> Void
    /// 완료를 눈으로 확인했다는 표시. 서버 창이 만료되기를 기다리지 않고 카드를 대기로 내린다.
    let onAcknowledge: () -> Void

    @State private var showSheet = false
    @State private var showAnswerSheet = false
    @State private var selectedAnswer = ""
    @State private var inputText = ""

    private var matchingPending: [PendingCommand] {
        pendingCommands.filter { $0.effectiveAgentType == agent.agentType }
    }

    /// 확인 버튼 노출 조건 — 완료 상태이고, 어떤 런의 완료인지 식별할 id 가 있을 때만.
    /// id 가 없으면 확인해도 다음 스냅샷에서 되살아나므로 버튼을 숨긴다.
    private var canAcknowledge: Bool {
        agent.state == .completed && agent.lastFinishedRunId != nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            VStack(alignment: .leading, spacing: Spacing.tight) {
                HStack(spacing: Spacing.sm) {
                    Text(agent.roleName)
                        .font(Typography.sectionTitle)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    statusBadge
                }
                // 직책으로 바꿔 부르는 대신 백엔드 식별명을 캡션으로 남긴다. 슬래시가 없는
                // 내부 에이전트는 이 줄이 유일한 식별 단서다(로그·슬랙과 이름을 맞출 때 필요).
                if agent.roleName != agent.displayName {
                    Text(agent.displayName)
                        .font(Typography.captionSmall)
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                }
            }

            // 말풍선 — 백엔드가 소유한 상태 문구
            Text(agent.bubble)
                .font(Typography.body)
                .foregroundStyle(.primary)
                .padding(.horizontal, Spacing.sm)
                .padding(.vertical, Spacing.sm)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: Radius.control, style: .continuous)
                        .fill(Color.primary.opacity(0.05))
                )

            if !matchingPending.isEmpty {
                pendingBadgeRow
            }

            if !agent.slashCommands.isEmpty {
                Text(agent.slashCommands.joined(separator: "  "))
                    .font(Typography.metricMono)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            HStack(spacing: Spacing.sm) {
                Button("지시") { showSheet = true }
                // 완료는 최근 종료 창(60분) 동안 유지되므로, 다 본 결과를 손으로 내려둘 수 있게 한다.
                if canAcknowledge {
                    Button("확인", action: onAcknowledge)
                }
            }
            .font(Typography.caption)
        }
        .padding(Spacing.lg)
        .frame(maxWidth: .infinity, minHeight: 118, alignment: .topLeading)
        .background(
            RoundedRectangle(cornerRadius: Radius.panel, style: .continuous)
                .fill(agent.state.tintColor)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Radius.panel, style: .continuous)
                .strokeBorder(agent.state.accentColor.opacity(0.55), lineWidth: Stroke.emphasis)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityDescription)
        .sheet(isPresented: $showSheet) {
            commandSheet
        }
        .sheet(isPresented: $showAnswerSheet) {
            ScrollView {
                Text(selectedAnswer)
                    .font(Typography.body)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(Spacing.xl)
            }
            .frame(minWidth: Layout.sheetMinWidth, minHeight: 260)
        }
    }

    /// VoiceOver 라벨. `accessibilityElement(children: .combine)` 이 자식 라벨을 이 문자열로
    /// 대체하므로, 화면에 캡션으로 보이는 백엔드 식별명을 여기에 직접 넣어야 스크린리더에서도
    /// 읽힌다 — 넣지 않으면 시각 UI 에만 있는 정보가 된다.
    private var accessibilityDescription: String {
        let name =
            agent.roleName == agent.displayName
            ? agent.roleName
            : "\(agent.roleName), \(agent.displayName)"
        return "\(name), \(agent.state.label), \(agent.bubble)"
    }

    private var statusBadge: some View {
        HStack(spacing: Spacing.xs) {
            Circle()
                .fill(agent.state.accentColor)
                .frame(width: Stroke.dot, height: Stroke.dot)
            Text(agent.state.label)
                .font(Typography.captionEmphasis)
                .foregroundStyle(.secondary)
        }
    }

    private var pendingBadgeRow: some View {
        HStack(spacing: Spacing.sm) {
            ForEach(matchingPending) { command in
                VStack(alignment: .leading, spacing: Spacing.tight) {
                    Text("\(command.phase.badgeIcon) \(command.phase.badgeLabel)")
                        .font(Typography.captionSmall)
                        .foregroundStyle(.secondary)
                    if let reason = command.reason {
                        Button {
                            selectedAnswer = reason
                            showAnswerSheet = true
                        } label: {
                            Text(reason)
                                .font(Typography.captionSmall)
                                .foregroundStyle(command.phase == .failed ? Color.red : Color.secondary)
                                .lineLimit(command.phase == .answered ? 12 : 2)
                                .multilineTextAlignment(.leading)
                        }
                        .buttonStyle(.plain)
                        .disabled(command.phase != .answered)
                    }
                }
            }
        }
    }

    /// "지시" 버튼으로 여는 텍스트 입력 시트 — 이 카드의 agentType 을 힌트로 고정해 전송한다.
    private var commandSheet: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text("\(agent.roleName)에 지시")
                .font(Typography.sectionTitle)
            TextField("지시 내용…", text: $inputText, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(3...6)
            HStack {
                Spacer()
                Button("취소") {
                    inputText = ""
                    showSheet = false
                }
                Button("전송") {
                    onSend(inputText, agent.agentType)
                    inputText = ""
                    showSheet = false
                }
                .keyboardShortcut(.defaultAction)
                .disabled(inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(Spacing.xl)
        .frame(minWidth: Layout.sheetMinWidth)
    }
}
