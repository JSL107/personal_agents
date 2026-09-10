import ConsoleCore
import SwiftUI

/// A compact, warm portrait scene for one dashboard card.
struct AgentPortraitView: View {
    let agent: ConsoleAgent

    private var appearance: CozyAgentAppearance {
        cozyAgentAppearance(agentType: agent.agentType, department: agent.resolvedDepartment)
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            CozyPalette.canvas
            HStack(alignment: .bottom, spacing: 0) {
                plant
                    .frame(width: 42, height: 86)
                Spacer(minLength: 0)
                CozyAgentAvatarView(
                    appearance: appearance,
                    mood: cozyAgentMood(for: agent.state),
                    department: agent.resolvedDepartment,
                    state: agent.state
                )
                .frame(height: 178)
                Spacer(minLength: 0)
                roleObject
                    .frame(width: 48, height: 78)
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.bottom, Spacing.sm)
            lamp
                .frame(width: 44, height: 72)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.leading, Spacing.xl)
                .padding(.top, Spacing.md)
            Rectangle()
                .fill(CozyPalette.outline.opacity(0.18))
                .frame(height: 1)
                .padding(.horizontal, Spacing.lg)
                .padding(.bottom, Spacing.sm)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 218)
        .clipShape(RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(agent.roleName)의 초상화, \(agent.state.label), \(agent.bubble)")
    }

    private var lamp: some View {
        VStack(spacing: 2) {
            Capsule()
                .fill(CozyPalette.outline)
                .frame(width: 2, height: 27)
            RoundedRectangle(cornerRadius: 6)
                .fill(CozyPalette.butter)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(CozyPalette.outline, lineWidth: 1))
                .frame(width: 34, height: 22)
            Capsule()
                .fill(CozyPalette.outline)
                .frame(width: 28, height: 3)
        }
    }

    private var plant: some View {
        VStack(spacing: 2) {
            HStack(spacing: 1) {
                leaf(rotation: -24)
                leaf(rotation: 24)
                leaf(rotation: -8)
            }
            RoundedRectangle(cornerRadius: 4)
                .fill(CozyPalette.cocoa)
                .overlay(RoundedRectangle(cornerRadius: 4).stroke(CozyPalette.outline, lineWidth: 1))
                .frame(width: 25, height: 23)
        }
    }

    private func leaf(rotation: Double) -> some View {
        Ellipse()
            .fill(CozyPalette.sage)
            .overlay(Ellipse().stroke(CozyPalette.outline, lineWidth: 1))
            .frame(width: 14, height: 30)
            .rotationEffect(.degrees(rotation))
    }

    @ViewBuilder
    private var roleObject: some View {
        VStack(spacing: Spacing.xs) {
            Image(systemName: agent.resolvedDepartment.iconSymbolName)
                .font(.system(size: 23, weight: .medium))
                .foregroundStyle(CozyPalette.department(agent.resolvedDepartment))
            RoundedRectangle(cornerRadius: 2)
                .fill(CozyPalette.surface)
                .overlay(RoundedRectangle(cornerRadius: 2).stroke(CozyPalette.outline, lineWidth: 1))
                .frame(width: 40, height: 3)
        }
        .accessibilityHidden(true)
    }
}
