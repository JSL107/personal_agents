import AppKit
import ConsoleCore
import SpriteKit

/// 회의 연출 게이트 — 회의 지시와 **그 뒤에 따라오는 주최자의 `.working`** 을 실제 씬에 흘린다.
///
///     swift run IdaeriConsole --meeting-check
///
/// 백엔드는 `run.started` 직후 같은 사람의 `state.changed(IN_PROGRESS)` 를 보내고, 그것이 `.working`
/// 연출이 된다(`visualIntents`). 그 `.working` 이 회의를 연 사람을 회의 시작과 동시에 책상으로 돌려보내던
/// 것을 막는다 — 지시 하나만 보면 둘 다 맞는 연출이라 순서를 함께 흘려야만 드러난다. 상태가 바뀌면 앱이
/// `sync` 도 다시 부르므로 그 재동기화까지 함께 흘린다.
///
/// 대조군도 함께 본다. 주최자가 아닌 참석자에게 일이 들어오면 회의를 떠나야 한다(관제 신호가 연출을
/// 이긴다). 주최자 보호가 지나쳐 모든 `.working` 을 삼키면 이쪽이 깨진다.
///
/// 머무는 시간은 **마지막 참석자가 도착한 뒤부터 다 같이** 센다. 각자 도착 순간부터 세면 가까운 사람이
/// 먼 사람이 오기 전에 떠난다(웹 실측: 전원 도착 5초 뒤 넷 중 둘이 귀가 중). 창 없는 씬이라 시간이
/// 흐르지 않으므로 도착은 `finishWalkForCheck` 로 일으키고, "떠날 시계가 걸렸는가" 만 본다.
struct OfficeMeetingProbe {
    let destination: TilePoint
    let onMeetingSeat: Bool
    let headingHome: Bool
    /// 회의·배회 추적에 남아 있는가. 빠졌으면 회의가 끝나도 `endMeeting` 이 아무것도 안 한다.
    let tracked: Bool
    /// 회의를 마치고 떠날 시계가 이미 돌고 있는가.
    let leaveTimerArmed: Bool
    /// 늦는 사람을 기다리는 상한(`officeMeetingGatherTimeoutSeconds`)이 걸려 있는가.
    let gatherTimerArmed: Bool
}

func runOfficeMeetingCheck() -> Bool {
    let size = CGSize(width: 1440, height: 860)
    let scene = OfficeScene(size: size)
    scene.scaleMode = .resizeFill
    // 근무 시간으로 고정한다 — 새벽이면 출근한 사람이 없어 모일 사람이 없다.
    scene.hourOverride = 14
    let view = SKView(frame: CGRect(origin: .zero, size: size))
    view.presentScene(scene)
    let agents = poseDemoAgents()
    scene.sync(agents: agents, approvals: [])
    let attendees = Array(agents.map(\.agentType).prefix(3))
    guard attendees.count == officeMeetingMinimumParticipants, let host = attendees.last,
        attendees.allSatisfy({ scene.meetingProbe($0) != nil })
    else {
        FileHandle.standardError.write(Data("--meeting-check: 참석자를 씬에 세우지 못했다\n".utf8))
        return false
    }
    let guest = attendees[0]
    let stayer = attendees[1]

    scene.perform([.meeting(agentTypes: attendees, thenWorking: host)])
    scene.perform([.working(agentType: host)])
    // 앱에서는 스토어가 상태를 바꾼 뒤 `onChange(of: store.agents)` 가 `sync` 를 다시 부른다. 그 재동기화가
    // 진행 중인 배회자를 끊는 경로(`strollersToStop`)도 주최자를 놓치면 안 된다.
    let syncedAgents = agents.map { agent in
        agent.agentType == host
            ? ConsoleAgent(
                agentType: agent.agentType, displayName: agent.displayName,
                slashCommands: agent.slashCommands, description: agent.description,
                state: .inProgress, bubble: agent.bubble, department: agent.department
            )
            : agent
    }
    scene.sync(agents: syncedAgents, approvals: [])
    let hostAfter = scene.meetingProbe(host)
    // 둘이 먼저 도착하고 한 명(guest)은 아직 걷는 중이다.
    let waitingCapped = scene.meetingProbe(guest)?.gatherTimerArmed == true
    scene.finishWalkForCheck(host)
    scene.finishWalkForCheck(stayer)
    let earlyArrivals = [scene.meetingProbe(host), scene.meetingProbe(stayer)]
    // 대조군 — 주최자가 아닌 사람에게 일이 들어온다.
    scene.perform([.working(agentType: guest)])
    let guestAfter = scene.meetingProbe(guest)
    let stayerAfter = scene.meetingProbe(stayer)
    let hostGathered = scene.meetingProbe(host)

    // 끝내 안 온 주최자 — 걸음 완료 신호가 오지 않은 채(상한이 대비하는 경우) 회의가 끝난다.
    // 끝난 뒤에도 회의 추적에 남으면 그 사람의 `.working` 이 영영 무시된다.
    // 주최자를 먼저 자기 자리에 앉혀, 이번 회의에서는 걸어오는 중이게 한다(회의석에 서 있으면 곧바로 도착한다).
    scene.perform([.returnHome(agentType: host)])
    scene.finishWalkForCheck(host)
    scene.perform([.meeting(agentTypes: attendees, thenWorking: host)])
    let hostWalking = scene.meetingProbe(host)?.onMeetingSeat == true && scene.meetingProbe(host)?.tracked == true
    scene.finishWalkForCheck(guest)
    scene.finishWalkForCheck(stayer)
    scene.finishMeetingsForCheck()
    let strandedHost = scene.meetingProbe(host)
    scene.perform([.working(agentType: host)])
    let strandedHostAfterWork = scene.meetingProbe(host)

    let checks: [(String, Bool)] = [
        ("주최자는 뒤따른 .working·재동기화 뒤에도 회의석으로 간다", hostAfter?.onMeetingSeat == true && hostAfter?.tracked == true),
        ("먼저 온 사람은 늦은 사람을 기다린다(떠날 시계가 아직 안 돈다)", earlyArrivals.allSatisfy { $0?.leaveTimerArmed == false }),
        ("끝내 안 오는 사람에 대비해 기다림 상한이 걸려 있다", waitingCapped),
        ("일이 들어온 참석자는 회의를 떠나 자리로 간다(대조군)", guestAfter?.headingHome == true && guestAfter?.tracked == false),
        ("나머지 참석자는 회의석에 남는다", stayerAfter?.onMeetingSeat == true && stayerAfter?.tracked == true),
        ("기다리던 사람이 빠지면 남은 전원의 시계가 함께 돈다", [stayerAfter, hostGathered].allSatisfy { $0?.leaveTimerArmed == true }),
        ("시계가 돌면 기다림 상한은 거둔다", stayerAfter?.gatherTimerArmed == false),
        ("끝내 안 온 주최자도 회의가 끝나면 추적에서 빠지고 자리로 간다", hostWalking && strandedHost?.tracked == false && strandedHost?.headingHome == true),
        ("그 주최자의 다음 .working 은 받는다", strandedHostAfterWork?.headingHome == true && strandedHostAfterWork?.tracked == false),
    ]
    for (name, passed) in checks {
        print("\(passed ? "✓" : "✗") \(name)")
    }
    for (label, probe) in [("주최", hostGathered), ("떠난 참석자", guestAfter), ("남은 참석자", stayerAfter)] {
        if let probe {
            print("  \(label): 목적지 (\(probe.destination.x),\(probe.destination.y)) 회의석=\(probe.onMeetingSeat) 자기자리=\(probe.headingHome) 추적=\(probe.tracked) 시계=\(probe.leaveTimerArmed)")
        }
    }
    return checks.allSatisfy(\.1)
}
