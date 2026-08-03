// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "IdaeriConsole",
    platforms: [.macOS(.v13)],
    targets: [
        .target(name: "ConsoleCore"),
        .executableTarget(
            name: "IdaeriConsole",
            dependencies: ["ConsoleCore"],
            // raw/ 는 생성 AI 원본 시트다. scripts/build-sprites.py 의 입력일 뿐 앱에는
            // 필요 없으므로 번들에서 뺀다(용량 3.4MB, 런타임 미사용).
            exclude: ["Resources/raw"],
            resources: [.copy("Resources/sprites")]
        ),
        // CLT 전용 환경(XCTest 부재)이라 표준 test 타깃 대신 실행형 러너로 검증한다.
        // `swift run ConsoleCoreTests` → exit 0 = green. 경량 하네스는 TestHarness.swift.
        .executableTarget(
            name: "ConsoleCoreTests",
            dependencies: ["ConsoleCore"]
        ),
    ]
)
