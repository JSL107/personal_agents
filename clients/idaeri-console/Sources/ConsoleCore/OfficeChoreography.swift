import Foundation

/// 씬이 실행할 연출 의도. 어떤 이벤트가 어떤 연출인지는 이 값으로 확정되고,
/// SpriteKit(SKAction) 실행은 OfficeScene 이 맡는다(코어는 SpriteKit 비의존).
public enum VisualIntent: Equatable, Sendable {
    case recolor(agentType: String, state: ConsoleAgentState)
    case working(agentType: String)
    case handoff(from: String, to: String)
    /// 일이 여럿에 걸쳐 이어지면 회의실에 모인다.
    ///
    /// `thenWorking` 은 회의가 끝난 뒤 자기 자리로 가서 일을 시작할 사람이다. 회의와
    /// `working` 을 따로 보내면 뒤따르는 `working` 이 회의를 시작하자마자 취소한다 —
    /// 둘 다 같은 사람을 걷게 하는 지시라서 나중 것이 이긴다.
    case meeting(agentTypes: [String], thenWorking: String)
    case summonToBand(agentType: String)
    case returnHome(agentType: String)
    case reject(agentType: String)
    case bubble(agentType: String, text: String)
    /// 출근 — 복도 진입점에서 자기 좌석까지 걸어온다.
    case arrive(agentType: String)
    /// 퇴근 — 좌석에서 복도 진입점까지 걸어간 뒤 화면에서 빠진다.
    case leave(agentType: String)
}

/// 실제 이벤트가 자율 배회를 즉시 끊을 대상을 연출 종류와 같은 순수 경계에서 확정한다.
public func affectedAgentTypes(of intent: VisualIntent) -> [String] {
    switch intent {
    case let .handoff(from, to):
        return [from, to]
    case let .meeting(agentTypes, thenWorking):
        return agentTypes.contains(thenWorking) ? agentTypes : agentTypes + [thenWorking]
    case let .recolor(agentType, _),
         let .working(agentType),
         let .summonToBand(agentType),
         let .returnHome(agentType),
         let .reject(agentType),
         let .bubble(agentType, _),
         let .arrive(agentType),
         let .leave(agentType):
        return [agentType]
    }
}

// MARK: - 포즈 계약 (요청 포즈 → 실제 에셋)
//
// 캐릭터 원화는 **정면 한 벌**뿐이다 — 측면·후면·걸음 프레임이 한 장도 없고, 사람마다
// 가진 포즈도 다르다(전원 `sit`, 절반쯤 `typing`, 넷 이하의 `reading`·`writing`·`drinking`).
// 도트 시절에는 `down`/`up`/`side` + `-walk1`·`-walk2` 로 파일을 찾았는데, 그 이름은 이제
// 어느 것도 실재하지 않아 요청이 전부 "없으면 정면 정지 그림" 한 갈래로 뭉개졌다.
//
// 여기서 요청 이름을 실재하는 에셋으로 옮기는 **단일 변환 지점**을 둔다. 렌더러가 아니라
// 코어에 두는 이유는 대체 선택이 캐릭터마다 다르기 때문이다 — 어느 그림이 어느 그림을
// 대신할 수 있는지는 그림을 그리는 규칙이 아니라 계약이고, 계약은 테스트가 닿아야 한다.

/// 캐릭터 원화가 앉은 그림인지 선 그림인지.
///
/// 앉은 그림을 서 있는 자리에 놓으면 공중에 주저앉은 사람이 되고, 선 그림을 책상 좌석에
/// 놓으면 책상 위에 올라선 사람이 된다. 좌석 하강값(`officeDedicatedSeatedSpriteDrop`)도
/// 이 구분을 보고 갈린다.
public enum CozyPosePosture: String, Sendable, Equatable {
    case standing
    case seated
}

/// 요청 포즈를 실제 에셋으로 옮긴 결과.
public struct ResolvedCozyPose: Sendable, Equatable {
    /// 실제로 파일이 있는 포즈 이름(`agent-{index}-{pose}.png`). `idle` 은 접미사 없는 원본.
    public let pose: String
    public let posture: CozyPosePosture

    public init(pose: String, posture: CozyPosePosture) {
        self.pose = pose
        self.posture = posture
    }
}

/// 접미사 없는 기본 그림(`agent-{index}.png`). 스무 명 전원이 가지고 있어 최후의 대체가 된다.
public let cozyIdlePose = "idle"

/// 요청 이름을 에셋 어휘로 접는다.
///
/// **방향 이름과 걸음 프레임이 전부 `idle` 로 접히는 것이 이 함수의 요점이다.** `down`·`up`·
/// `side`·`down-walk1` 같은 도트 시절 이름은 실물이 없는데, 그것을 그대로 파일명으로 조립하면
/// 로더가 매번 없는 파일을 찾아 헛돈다(정상 실행에서 폴백 로그가 수십 줄 쏟아지던 원인).
/// 방향은 이제 그림이 아니라 몸짓(`officeWalkLean`)이 표현한다.
public func normalizedCozyPose(_ requested: String) -> String {
    switch requested.lowercased().replacingOccurrences(of: "_", with: "-") {
    case "sit", "sitting":
        return "sit"
    case "typing":
        return "typing"
    case "reading":
        return "reading"
    case "writing":
        return "writing"
    case "drinking":
        return "drinking"
    case "carryingpapers", "carrying-papers":
        return "carryingpapers"
    case "tending":
        return "tending"
    case "stowing":
        return "stowing"
    case "walk":
        return "walk"
    default:
        return cozyIdlePose
    }
}

/// 그림 **안에** 가구가 이미 그려져 있는가(원화 전수 확인).
///
/// 한때 셋이 걸려 있었다 — 6번 원형 테이블, 7번 사무용 의자, 8번 사이드 테이블. 사람만
/// 오려낸 그림이 아니라 가구까지 한 덩어리라, 씬의 책상·소파 앞에 세우면 가구가 이중으로
/// 보여 "물건을 쓰는" 게 아니라 "물건이 겹친" 그림이 됐다. **셋 다 가구 없는 그림으로
/// 다시 그려 받아 배제가 필요 없어졌다**(교체본을 직접 열어 확인). 규칙 자체는 남긴다 —
/// 다음에 같은 방식으로 그려진 원화가 들어오면 여기에 한 줄 추가하는 것으로 막을 수 있고,
/// 그 자리가 없으면 화면에서 겹친 뒤에야 알게 된다.
public func cozyPoseDrawsOwnFurniture(assetIndex: Int, pose: String) -> Bool {
    switch (assetIndex, pose) {
    default:
        return false
    }
}

/// 그 포즈 그림이 앉은 그림인지(원화 전수 확인).
///
/// 같은 포즈라도 사람마다 자세가 다르다 — `typing` 은 18번만 태블릿을 들고 서 있고 나머지는
/// 앉아 있다. `reading`·`writing` 은 반대로 앉은 쪽이 예외다(7·6번). 이 예외를 모르면
/// 18번만 자기 책상 앞에 선 채로 일하고, 7번만 복도에서 의자째 책을 읽는다.
public func cozyPosePosture(assetIndex: Int, pose: String) -> CozyPosePosture {
    switch pose {
    case "sit":
        return .seated
    case "typing":
        return assetIndex == 18 ? .standing : .seated
    // 6번 `writing`·7번 `reading` 은 예전에 앉은 그림이었다(각각 테이블·의자가 함께 그려져
    // 있었다). 가구 없는 **서 있는** 그림으로 교체돼 이제 예외가 아니다.
    default:
        return .standing
    }
}

/// 요청 포즈를 대신할 수 있는 에셋 포즈를 우선순위대로 준다(`idle` 은 제외 — 늘 마지막 보루).
///
/// 지금까지는 대체가 "없으면 정면 정지 그림" 하나뿐이라 의미가 다 뭉개졌다. 손에 든 물건이
/// 뜻을 가장 많이 나르므로, 서류를 든 자세(`carryingPapers`)는 쓰는 그림, 물건을 넣고 빼는
/// 자세(`stowing`)는 책을 든 그림으로 내려간다. 화분 손질(`tending`)은 닮은 그림이 없어
/// 그냥 서 있는 편이 낫다 — 엉뚱한 소품을 들리면 무엇을 하는지가 오히려 틀리게 읽힌다.
public func cozyPoseCandidates(_ normalized: String) -> [String] {
    switch normalized {
    case "sit":
        return ["sit"]
    // 타이핑 그림이 없으면 **앉은 그림**으로 내려간다. `idle`(서 있는 그림)로 내려가면
    // 책상 좌석에서 그 사람만 책상 위에 올라선 것처럼 보인다.
    case "typing":
        return ["typing", "sit"]
    case "reading":
        return ["reading"]
    case "writing":
        return ["writing", "reading"]
    case "drinking":
        return ["drinking"]
    case "carryingpapers":
        return ["writing", "reading"]
    case "stowing":
        return ["reading"]
    // 걸음 그림은 대신할 것이 없다 — 없으면 정지 그림으로 내려가고, 그때는 몸 기울기
    // (`officeWalkLean`)만 남아 걷는 티가 옅어진다. 스무 명 중 일곱만 가지고 있다.
    case "walk":
        return ["walk"]
    default:
        return []
    }
}

/// 요청 포즈 → 실제 에셋. **모든 캐릭터 그림 선택이 지나는 단 하나의 지점.**
///
/// `hasAsset` 은 "이 포즈 파일이 실제로 있는가" 를 묻는 창구다. 파일 목록을 코어가 따로
/// 베껴 두지 않으므로(베끼면 에셋을 갈아끼울 때 조용히 어긋난다) 존재 판정은 번들을 보는
/// 렌더러가 넘기고, 여기서는 **순서와 배제 규칙**만 갖는다.
public func resolveCozyPose(
    requested: String,
    assetIndex: Int,
    hasAsset: (String) -> Bool,
    posture requiredPosture: CozyPosePosture? = nil
) -> ResolvedCozyPose {
    let normalized = normalizedCozyPose(requested)
    // 앉아야 하는 요청인지는 보통 요청 이름이 정한다 — 책상에서 오는 요청은 `sit`·`typing`
    // 둘뿐이고 나머지(가구 앞 자세·걷기·기본)는 전부 서 있는 맥락이다.
    //
    // **앉을 자리가 없는 화면은 그것을 덮어쓸 수 있어야 한다.** 대시보드 카드에는 책상도
    // 의자도 없는데 `typing` 을 요청하면 앉은 그림이 뽑혀 사람이 공중에 주저앉는다
    // (사용자 보고). 그런 호출자는 `posture: .standing` 을 넘겨 선 그림만 받는다.
    let wanted: CozyPosePosture = requiredPosture
        ?? ((normalized == "sit" || normalized == "typing") ? .seated : .standing)
    for candidate in cozyPoseCandidates(normalized) {
        guard !cozyPoseDrawsOwnFurniture(assetIndex: assetIndex, pose: candidate) else {
            continue
        }
        guard cozyPosePosture(assetIndex: assetIndex, pose: candidate) == wanted else {
            continue
        }
        guard hasAsset(candidate) else {
            continue
        }
        return ResolvedCozyPose(pose: candidate, posture: wanted)
    }
    return ResolvedCozyPose(pose: cozyIdlePose, posture: .standing)
}

// MARK: - 걸음 몸짓

/// 한 칸(한 걸음)에 걸리는 시간(초). 씬의 이동 시간(`OfficeScene.walk` 의 `stepDuration`)과
/// 같아야 몸 기울기가 발과 어긋나지 않는다.
public let officeWalkStepSeconds: Double = 0.20

/// 진행 방향으로 몸이 기우는 각도(라디안 ≈ 3.4도).
public let officeWalkLeanRadians: Double = 0.06

/// 걸음마다 좌우로 번갈아 흔들리는 각도(라디안 ≈ 2도).
public let officeWalkSwayRadians: Double = 0.035

/// `step` 번째 걸음에서 몸을 얼마나 기울일지(라디안, 양수 = 반시계 = 화면 왼쪽으로 기움).
///
/// **걸음 그림이 없으므로 몸짓이 그 자리를 대신한다.** 예전에는 `-walk1`·`-walk2` 를 번갈아
/// 걸었는데 그 파일이 실재하지 않아 매 걸음 같은 정면 그림으로 되돌아왔다 — 다리는 가만히
/// 있고 몸만 위아래로 떨려 "걷는다" 가 아니라 "제자리에서 통통 튄다" 로 읽힌 원인이다.
///
/// 발(스프라이트 anchor)을 축으로 기울이면 디딘 발 위로 무게중심이 넘어가는 것이 보인다.
/// 진행 방향 기울기는 어디로 가는지를, 좌우 번갈이는 몇 걸음째인지를 나른다. 위·아래로 가는
/// 걸음에는 화면상 진행 방향이 없어 번갈이만 남긴다.
public func officeWalkLean(facing: Facing, step: Int) -> Double {
    let sway = step.isMultiple(of: 2) ? officeWalkSwayRadians : -officeWalkSwayRadians
    switch facing {
    case .left:
        return officeWalkLeanRadians + sway
    case .right:
        return -officeWalkLeanRadians + sway
    case .up, .down:
        return sway
    }
}

/// 이벤트 번역에 필요한 주변 상태(부모 run·pending 조회용). 스냅샷 파생, 부작용 없음.
public struct ChoreographyContext: Sendable {
    public let agents: [ConsoleAgent]
    public let runs: [ConsoleRun]
    public let pendingCommands: [PendingCommand]

    public init(agents: [ConsoleAgent], runs: [ConsoleRun], pendingCommands: [PendingCommand]) {
        self.agents = agents
        self.runs = runs
        self.pendingCommands = pendingCommands
    }
}

/// SSE 이벤트 하나를 연출 의도 배열로 번역한다(순수).
/// 미지의 agentType 이거나 오피스와 무관한 이벤트(session·command.info·approvalResolved 의 미상 등)는 빈 배열.
public func visualIntents(for event: ConsoleEvent, context: ChoreographyContext) -> [VisualIntent] {
    func knows(_ agentType: String) -> Bool {
        context.agents.contains { $0.agentType == agentType }
    }
    func agent(_ agentType: String) -> ConsoleAgent? {
        context.agents.first { $0.agentType == agentType }
    }
    /// 이 사람이 지금 결재를 기다리는가 — **스토어가 적용한 결과**를 본다.
    ///
    /// 열린 승인이 있으면 스토어가 상태를 `AWAITING_APPROVAL` 로 맞추고 그 뒤 오는 상태
    /// 변경을 얹지 않는다(`ConsoleStore.markAwaitingApproval` · `hasOpenApproval`).
    /// 여기서 이벤트가 실은 상태를 따로 판단하면 **두 계층이 다른 답을 낸다** — 실제로
    /// 그랬다: 스토어는 억제했는데 연출은 사람을 책상으로 걷게 했다.
    ///
    /// 스토어는 `apply(event:)` 안에서 상태를 먼저 바꾸고 **마지막에** 이벤트를 흘려보내므로
    /// (`eventStream.send`), 이 시점의 `context.agents` 는 이미 적용 결과다.
    func isAwaitingApproval(_ agentType: String) -> Bool {
        agent(agentType)?.state == .awaitingApproval
    }

    switch event {
    case let .runStarted(run):
        guard knows(run.agentType) else {
            return []
        }
        // 결재를 기다리며 줄에 선 사람은 새 런이 시작돼도 자리로 보내지 않는다.
        // **`run.started` 가 `state.changed` 보다 먼저 발행되므로**(`AgentRunService.execute`)
        // 아래 `stateChanged` 분기만 막으면 이 이벤트가 이미 사람을 걷게 한다.
        guard !isAwaitingApproval(run.agentType) else {
            return []
        }
        // 체인에 여럿이 얽혔으면 회의실로 모은다. 화면에서 자리를 뜨는 사람이 여럿이라
        // "지금 이 일에 누가 관여하는지" 가 한눈에 보인다 — 1:1 전달로는 두 사람만 보인다.
        let participants = officeChainParticipants(run: run, runs: context.runs).filter(knows)
        if participants.count >= officeMeetingMinimumParticipants {
            return [.meeting(agentTypes: participants, thenWorking: run.agentType)]
        }
        if let parentId = run.parentId,
           let parent = context.runs.first(where: { $0.id == parentId }),
           knows(parent.agentType) {
            return [.handoff(from: parent.agentType, to: run.agentType), .working(agentType: run.agentType)]
        }
        return [.working(agentType: run.agentType)]

    case let .runFinished(run):
        guard let found = agent(run.agentType) else {
            return []
        }
        return [.recolor(agentType: found.agentType, state: found.state), .bubble(agentType: found.agentType, text: found.bubble)]

    case let .approvalOpened(approval):
        guard let agentType = approval.agentType, knows(agentType) else {
            return []
        }
        // 색을 여기서 함께 확정한다. 뒤따라올 state.changed(AWAITING_APPROVAL) 에 기대면
        // 그 이벤트가 누락된 경우 줄에 선 사람만 대기색으로 남는다.
        var intents: [VisualIntent] = [
            .summonToBand(agentType: agentType),
            .recolor(agentType: agentType, state: .awaitingApproval),
        ]
        if let found = agent(agentType) {
            intents.append(.bubble(agentType: agentType, text: found.bubble))
        }
        return intents

    case let .approvalResolved(approval):
        guard let agentType = approval.agentType, knows(agentType) else {
            return []
        }
        return [.returnHome(agentType: agentType)]

    case let .stateChanged(agentType, state, _):
        guard knows(agentType) else {
            return []
        }
        switch state {
        case .inProgress:
            guard !isAwaitingApproval(agentType) else {
                return []
            }
            return [.working(agentType: agentType)]
        case .awaitingApproval:
            return [.summonToBand(agentType: agentType), .recolor(agentType: agentType, state: state)]
        default:
            return [.recolor(agentType: agentType, state: state)]
        }

    case let .commandRejected(commandId, _):
        guard
            let id = UUID(uuidString: commandId),
            let pending = context.pendingCommands.first(where: { $0.id == id }),
            let agentType = pending.effectiveAgentType,
            knows(agentType)
        else {
            return []
        }
        return [.reject(agentType: agentType)]

    case .sessionOpened, .sessionUpdated, .sessionClosed, .commandInfo, .commandAnswered:
        return []
    }
}
