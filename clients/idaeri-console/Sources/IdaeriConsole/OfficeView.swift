import ConsoleCore
import SpriteKit
import SwiftUI

/// 오피스 탭. store.agents 변화를 OfficeScene 에 반영한다.
struct OfficeView: View {
    @ObservedObject var store: ConsoleStore

    @State private var scene: OfficeScene = {
        let scene = OfficeScene(size: CGSize(width: 900, height: 600))
        scene.scaleMode = .resizeFill
        return scene
    }()

    var body: some View {
        SpriteView(scene: scene)
            .frame(minWidth: 640, minHeight: 480)
            .onAppear {
                scene.sync(agents: store.agents)
            }
            .onChange(of: store.agents) { newAgents in
                scene.sync(agents: newAgents)
            }
    }
}
