// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "IdaeriConsole",
    platforms: [.macOS(.v13)],
    targets: [
        .target(name: "ConsoleCore"),
        .executableTarget(
            name: "IdaeriConsole",
            dependencies: ["ConsoleCore"]
        ),
        // CLT 전용 환경(XCTest 부재)이라 표준 test 타깃 대신 실행형 러너로 검증한다.
        // `swift run ConsoleCoreTests` → exit 0 = green. 경량 하네스는 TestHarness.swift.
        .executableTarget(
            name: "ConsoleCoreTests",
            dependencies: ["ConsoleCore"]
        ),
    ]
)
