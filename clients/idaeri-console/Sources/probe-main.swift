import ConsoleCore
let plan = officeFloorPlan(agents: [])
print("격자: \(plan.columns)열 × \(plan.rows)행")
for (w, h) in [(900.0, 890.0), (1200.0, 1000.0), (1400.0, 1000.0), (1800.0, 1800.0), (960.0, 1050.0)] {
    let m = officeViewMetrics(viewWidth: w, viewHeight: h, columns: plan.columns, rows: plan.rows, backingScale: 2)
    let usedW = Double(plan.columns) * m.tileSize, usedH = Double(plan.rows) * m.tileSize
    print(String(format: "  창 %.0f×%.0f → 타일 %.0f  도면 %.0f×%.0f  화면 채움 %.0f%% × %.0f%%",
                 w, h, m.tileSize, usedW, usedH, usedW/w*100, usedH/h*100))
}
