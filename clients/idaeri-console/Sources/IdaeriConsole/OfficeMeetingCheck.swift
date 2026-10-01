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
struct OfficeMeetingProbe {
    let destination: TilePoint
    let onMeetingSeat: Bool
    let headingHome: Bool
    /// 회의·배회 추적에 남아 있는가. 빠졌으면 회의가 끝나도 `endMeeting` 이 아무것도 안 한다.
    let tracked: Bool
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
    // 대조군 — 주최자가 아닌 사람에게 일이 들어온다.
    scene.perform([.working(agentType: guest)])
    let guestAfter = scene.meetingProbe(guest)
    let stayerAfter = scene.meetingProbe(stayer)

    let checks: [(String, Bool)] = [
        ("주최자는 뒤따른 .working·재동기화 뒤에도 회의석으로 간다", hostAfter?.onMeetingSeat == true && hostAfter?.tracked == true),
        ("일이 들어온 참석자는 회의를 떠나 자리로 간다(대조군)", guestAfter?.headingHome == true && guestAfter?.tracked == false),
        ("나머지 참석자는 회의석에 남는다", stayerAfter?.onMeetingSeat == true && stayerAfter?.tracked == true),
    ]
    for (name, passed) in checks {
        print("\(passed ? "✓" : "✗") \(name)")
    }
    for (label, probe) in [("주최", hostAfter), ("떠난 참석자", guestAfter), ("남은 참석자", stayerAfter)] {
        if let probe {
            print("  \(label): 목적지 (\(probe.destination.x),\(probe.destination.y)) 회의석=\(probe.onMeetingSeat) 자기자리=\(probe.headingHome) 추적=\(probe.tracked)")
        }
    }
    return checks.allSatisfy(\.1)
}
