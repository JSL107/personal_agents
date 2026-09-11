import ConsoleCore
import SwiftUI

/// 담당자 한 명의 개인 사무실 카드. 방 장면·이름·직무·상태와 주 행동을 한 덩어리로 보여준다.
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

    private var primaryAction: AgentPrimaryAction {
        agentPrimaryAction(for: agent.agentType, roleName: agent.roleName)
    }

    private var departmentColor: Color {
        CozyPalette.department(agent.resolvedDepartment)
    }

    private var primaryActionForeground: Color {
        Color(
            red: agentPrimaryActionTextRGBA.red,
            green: agentPrimaryActionTextRGBA.green,
            blue: agentPrimaryActionTextRGBA.blue
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: Spacing.sm) {
                VStack(alignment: .leading, spacing: Spacing.tight) {
                    Text(agent.roleName)
                        .font(Typography.sectionTitle)
                        .lineLimit(1)
                    Text(agent.resolvedDepartment.label)
                        .font(Typography.captionSmall.weight(.medium))
                        .foregroundStyle(CozyPalette.ink)
                        .padding(.horizontal, Spacing.sm)
                        .padding(.vertical, Spacing.tight)
                        .background(departmentColor.opacity(0.22), in: Capsule())
                }
                Spacer(minLength: 0)
                statusBadge
            }
            .padding(Spacing.lg)

            AgentPortraitView(agent: agent)
                .padding(.horizontal, Spacing.lg)

            Text(agent.bubble)
                .font(Typography.caption)
                .foregroundStyle(CozyPalette.ink)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, Spacing.md)
                .padding(.vertical, Spacing.sm)
                .background(CozyPalette.surface, in: RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
                .padding(.horizontal, Spacing.lg)
                .padding(.top, Spacing.sm)

            VStack(alignment: .leading, spacing: Spacing.md) {
                HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                    VStack(alignment: .leading, spacing: Spacing.tight) {
                        Text(agent.job ?? agent.description)
                            .font(Typography.body)
                            .foregroundStyle(CozyPalette.ink.opacity(0.78))
                            .lineLimit(2)
                    }
                    Spacer(minLength: 0)
                    Text(agent.displayName)
                        .font(Typography.badgeMono)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                if !matchingPending.isEmpty {
                    pendingBadgeRow
                }

                if !agent.slashCommands.isEmpty {
                    Text(agent.slashCommands.joined(separator: "  "))
                        .font(Typography.metricMono)
                        .foregroundStyle(CozyPalette.ink.opacity(0.78))
                        .lineLimit(1)
                }

                // 배지 행·슬래시 커맨드 줄은 담당자마다 있거나 없다 — 그 차이를 여기서
                // 흡수해 버튼 행을 카드 바닥에 고정한다. 이게 없으면 짧은 카드는 버튼이
                // 중간에 뜨고, 카드 높이(아래 고정 height)만큼 자란 빈 공간이 어색하게 남는다.
                Spacer(minLength: 0)

                HStack(spacing: Spacing.sm) {
                    if agent.canReceiveCommand {
                        Button { showSheet = true } label: {
                            Text(primaryAction.label)
                                .foregroundStyle(primaryActionForeground)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(CozyPalette.apricot)
                    } else {
                        Label("자동 업무 전용", systemImage: "gearshape.2")
                            .font(Typography.caption)
                            .foregroundStyle(.secondary)
                    }
                    if canAcknowledge {
                        Button("확인", action: onAcknowledge)
                    }
                }
                .controlSize(.regular)
            }
            .padding(Spacing.lg)
        }
        .foregroundStyle(CozyPalette.ink)
        // minHeight 만으로는 안 된다 — 내용이 470 보다 짧은 카드만 그 높이로 늘어나고,
        // 배지 행·슬래시 줄이 다 붙은 카드는 자기 내용만큼 더 자라 같은 행에서 높이가 갈렸다.
        // height 를 고정해 모든 카드가 같은 높이를 보고하게 하고(값은 가장 내용이 많은
        // 카드 기준 실측), 위 Spacer 가 남는 공간을 흡수해 버튼 행을 바닥에 붙인다.
        //
        // 420 으로 처음 재봤을 때, pending 배지 행 + 슬래시 커맨드 줄이 함께 붙는 카드는
        // 버튼 행이 420 아래로 밀려 clipShape 에 그대로 잘려 나갔다(렌더 스크린샷으로 확인,
        // 지시 버튼 자체가 안 보임) — 그 조합을 담고도 버튼이 남을 값으로 다시 올렸다.
        .frame(maxWidth: .infinity, minHeight: 470, maxHeight: 470, alignment: .topLeading)
        .background(
            RoundedRectangle(cornerRadius: Radius.panel, style: .continuous)
                .fill(CozyPalette.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Radius.panel, style: .continuous)
                .strokeBorder(agent.state.accentColor.opacity(0.55), lineWidth: Stroke.emphasis)
        )
        .shadow(color: CozyPalette.outline.opacity(0.08), radius: 12, y: 6)
        .clipShape(RoundedRectangle(cornerRadius: Radius.panel, style: .continuous))
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
    /// 대체하므로, 닉네임과 화면에 캡션으로 보이는 백엔드 식별명을 함께 넣어야 스크린리더에서도
    /// 읽힌다 — 넣지 않으면 시각 UI 에만 있는 정보가 된다.
    private var accessibilityDescription: String {
        let name =
            agent.roleName == agent.displayName
            ? agent.roleName
            : "\(agent.roleName), \(agent.displayName)"
        let action = agent.canReceiveCommand ? "직접 업무를 맡길 수 있음" : "자동 업무 전용"
        return "\(name), \(agent.state.label), \(agent.bubble), \(action)"
    }

    private var statusBadge: some View {
        HStack(spacing: Spacing.xs) {
            Circle()
                .fill(agent.state.accentColor)
                .frame(width: Stroke.dot, height: Stroke.dot)
            Text(agent.state.label)
                .font(Typography.captionEmphasis)
                .foregroundStyle(CozyPalette.ink)
        }
        .padding(.horizontal, Spacing.sm)
        .padding(.vertical, Spacing.xs)
        .background(agent.state.tintColor, in: Capsule())
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
            Text(primaryAction.title)
                .font(Typography.sectionTitle)
            Text(agent.job ?? agent.description)
                .font(Typography.caption)
                .foregroundStyle(.secondary)
            TextField(primaryAction.placeholder, text: $inputText, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(3...6)
            HStack {
                Spacer()
                Button("취소") {
                    inputText = ""
                    showSheet = false
                }
                Button(primaryAction.label) {
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
