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
        // **선 그림만 받는다.** 카드에는 책상도 의자도 없어서, 앉은 그림이 뽑히면 사람이
        // 허공에 주저앉는다(사용자 보고). 예전에는 파일이 있는지만 보고 그 그림이 앉은
        // 자세인지 보지 않았는데, `typing` 은 18번을 빼면 전부 앉은 그림이라 코드 리뷰어·
        // 윤문가 카드가 그렇게 떴다. 자세 판정은 포즈 계약이 이미 갖고 있으므로 그것을 쓴다.
        return resolveCozyPose(
            requested: rolePose,
            assetIndex: appearance.assetIndex,
            hasAsset: { pose in
                SpriteLoader.cozyCharacterHasDedicatedPose(
                    assetIndex: appearance.assetIndex,
                    pose: pose
                )
            },
            posture: .standing
        ).pose
    }

    var body: some View {
        // 카드가 넓어질수록(전체화면 등) 캐릭터·소품이 사라지는 회귀가 있었다. 원인은
        // `scaledToFill` 방 이미지가 `.frame(maxWidth:.infinity, maxHeight:.infinity)` 로
        // "암묵적" 크기를 취하면, 그 이미지의 원본 가로세로 비율이 ZStack 자체의 "이상적
        // 크기" 계산에 새어 들어간다는 것 — 카드가 넓을수록 이 암묵적 높이가 218pt 를 크게
        // 웃돌아, `alignment: .bottom` 정렬 기준점(진짜 바닥)이 실제로 보이는 218pt 창보다
        // 훨씬 아래로 밀린다. 그 결과 캐릭터는 "바닥에서 위로 172pt" 가 아니라 "화면 밖 바닥
        // 후보에서 위로 172pt" 에 그려져, 실제로 보이는 건 캐릭터 머리 꼭대기 몇 pt 뿐이었다
        // (렌더 스크린샷에 디버그 테두리를 둘러 실측 확인, 2560pt 폭에서 172pt 박스 중 34pt만
        // 보이고 나머지는 clipShape 밖으로 잘려나갔다).
        //
        // 고치는 법은 이 View 안쪽에서 이미 쓰고 있는 패턴과 같다 — `CozyAgentAvatarView` 는
        // GeometryReader 로 크기를 명시적으로 받아 자식에게 그대로 내려주는데, 여긴 그렇게 안
        // 하고 있었다. GeometryReader 로 실측 크기를 먼저 확정해 모든 자식에게 명시적으로
        // 내려주면 "암묵적 이상 크기" 가 끼어들 자리가 없어진다.
        GeometryReader { proxy in
            ZStack(alignment: .bottom) {
                CozyPalette.canvas
                if let roomImage = SpriteLoader.cozyDepartmentRoomImage(agent.resolvedDepartment) {
                    Image(nsImage: roomImage)
                        .resizable()
                        .interpolation(.high)
                        .scaledToFill()
                        .frame(width: proxy.size.width, height: proxy.size.height)
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
                    .frame(width: proxy.size.width, height: proxy.size.height, alignment: .bottomTrailing)
                    // Pull the prop into the character's reachable floor area. At the card edge it
                    // reads as a UI badge; beside the coworker it becomes part of the portrait scene.
                    .padding(.trailing, Spacing.xxl + Spacing.lg)
                    .padding(.bottom, Spacing.sm)
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .frame(maxWidth: .infinity, minHeight: 218, maxHeight: 218)
        .clipShape(RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(agent.roleName)의 초상화, \(agent.state.label), \(agent.bubble)")
    }

}
