import ConsoleCore
import SwiftUI

/// A compact, warm portrait scene for one dashboard card.
struct AgentPortraitView: View {
    let agent: ConsoleAgent

    private var appearance: CozyAgentAppearance {
        cozyAgentAppearance(agentType: agent.agentType, department: agent.resolvedDepartment)
    }

    private var portraitPose: String {
        let rolePose: String
        switch agent.agentType {
        case "PM":
            rolePose = "writing"
        case "CODE_REVIEWER", "HUMANIZER", "PAPER_TRADE":
            rolePose = "typing"
        case "WORK_REVIEWER", "CAREER_MATE":
            rolePose = "reading"
        case "VACATION":
            rolePose = "drinking"
        default:
            rolePose = agent.state == .inProgress ? "typing" : "idle"
        }
        return SpriteLoader.cozyCharacterHasDedicatedPose(
            assetIndex: appearance.assetIndex,
            pose: rolePose
        ) ? rolePose : "idle"
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            CozyPalette.canvas
            if let roomImage = SpriteLoader.cozyDepartmentRoomImage(agent.resolvedDepartment) {
                Image(nsImage: roomImage)
                    .resizable()
                    .interpolation(.high)
                    .scaledToFill()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .clipped()
                    .opacity(0.86)
                LinearGradient(
                    colors: [CozyPalette.canvas.opacity(0.06), CozyPalette.canvas.opacity(0.25)],
                    startPoint: .top,
                    endPoint: .bottom
                )
            }
            CozyAgentAvatarView(
                appearance: appearance,
                mood: cozyAgentMood(for: agent.state),
                department: agent.resolvedDepartment,
                state: agent.state,
                pose: portraitPose
            )
            .frame(width: 172, height: 172)
            .padding(.bottom, Spacing.sm)
            if let accentImage = SpriteLoader.cozyDashboardAccentImage(
                agentType: agent.agentType,
                department: agent.resolvedDepartment
            ) {
                ZStack(alignment: .center) {
                    // A soft contact shadow anchors the transparent PNG to the room floor.
                    // Keep it separate from the asset so the generated art retains its alpha edge.
                    Ellipse()
                        .fill(Color.black.opacity(0.14))
                        .frame(width: 38, height: 9)
                        .blur(radius: 4)
                        .offset(y: 21)
                    Image(nsImage: accentImage)
                        .resizable()
                        .interpolation(.high)
                        .antialiased(true)
                        .scaledToFit()
                        .shadow(color: .black.opacity(0.10), radius: 3, x: 0, y: 2)
                }
                .frame(width: 56, height: 56)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                // Pull the prop into the character's reachable floor area. At the card edge it
                // reads as a UI badge; beside the coworker it becomes part of the portrait scene.
                .padding(.trailing, Spacing.xxl + Spacing.lg)
                .padding(.bottom, Spacing.sm)
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: 218)
        .clipShape(RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(agent.roleName)의 초상화, \(agent.state.label), \(agent.bubble)")
    }

}
