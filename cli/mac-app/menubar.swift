// Значок Связки в строке меню: классический ключ. Мигает, когда ИИ-агент (Claude, Codex, MCP-клиент) берёт ключ —
// запускает команду с секретами, подключается по SSH, показывает или копирует значение (сиреневым) — или сохраняет
// и меняет запись (зелёным). Источник — журнал ~/.svyazka/audit.log: в нём только названия записей, без значений.

import Cocoa

final class MenuBar: NSObject, NSMenuDelegate {
  struct Event { let date: Date; let who: String; let op: String; let what: String; var put: Bool { op == "add" || op == "set" } }

  private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
  // SVYAZKA_HOME — как у svyazka (для проверки на временной папке)
  private let logURL = (ProcessInfo.processInfo.environment["SVYAZKA_HOME"].map { URL(fileURLWithPath: $0) }
    ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".svyazka")).appendingPathComponent("audit.log")
  private var offset: UInt64 = 0
  private var events: [Event] = []
  private var blink: Timer?
  private let open: () -> Void, lock: () -> Void

  private static let take: Set<String> = ["run", "ssh", "get", "copy"], put: Set<String> = ["add", "set"]

  init(open: @escaping () -> Void, lock: @escaping () -> Void) {
    self.open = open; self.lock = lock
    super.init()
    item.button?.image = Self.keyImage(color: nil)
    item.button?.toolTip = L("Связка", "Svyazka")
    let menu = NSMenu()
    menu.delegate = self
    item.menu = menu
    readTail()
    Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.poll() }
  }

  // ── журнал ──

  private func size() -> UInt64 { (try? FileManager.default.attributesOfItem(atPath: logURL.path)[.size] as? UInt64) ?? 0 }

  // при запуске — последние действия агентов из хвоста журнала, без мигания
  private func readTail() {
    let s = size()
    offset = s
    guard let h = try? FileHandle(forReadingFrom: logURL) else { return }
    defer { try? h.close() }
    try? h.seek(toOffset: s > 65536 ? s - 65536 : 0)
    let text = String(decoding: h.readDataToEndOfFile(), as: UTF8.self)
    events = Array(text.split(separator: "\n").compactMap { Self.parse(String($0)) }.suffix(8))
  }

  private func poll() {
    let s = size()
    if s < offset { offset = 0 } // журнал начат заново
    guard s > offset, let h = try? FileHandle(forReadingFrom: logURL) else { return }
    defer { try? h.close() }
    try? h.seek(toOffset: offset)
    let data = h.readDataToEndOfFile()
    guard let nl = data.lastIndex(of: 0x0a) else { return } // строка ещё дописывается
    offset += UInt64(nl + 1)
    let fresh = String(decoding: data[..<nl], as: UTF8.self).split(separator: "\n").compactMap { Self.parse(String($0)) }
    guard let last = fresh.last else { return }
    events = Array((events + fresh).suffix(8))
    item.button?.toolTip = Self.describe(last)
    flash(put: last.put)
  }

  // «2026-11-28 15:38 | Claude | run | Hetzner/root@vps | команда: ssh» → событие агента или nil
  static func parse(_ line: String) -> Event? {
    let p = line.components(separatedBy: " | ")
    guard p.count >= 3 else { return nil }
    let who = p[1], op = p[2]
    guard who == "Claude" || who == "Codex" || who.hasPrefix("MCP: "), take.contains(op) || put.contains(op) else { return nil }
    let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd HH:mm"
    return Event(date: f.date(from: p[0]) ?? Date(), who: who.hasPrefix("MCP: ") ? String(who.dropFirst(5)) : who, op: op, what: p.count > 3 ? p[3] : "")
  }

  static func describe(_ e: Event) -> String {
    let verb: String
    switch e.op {
    case "run": verb = L("взял для команды", "used in a command")
    case "ssh": verb = L("подключился по SSH", "connected over SSH")
    case "get": verb = L("показал", "revealed")
    case "copy": verb = L("скопировал", "copied")
    case "add": verb = L("сохранил", "saved")
    default: verb = L("изменил", "changed")
    }
    return "\(e.who) \(verb) «\(e.what)»"
  }

  // ── мигание: несколько вспышек цветом, потом обычный значок ──

  private func flash(put: Bool) {
    blink?.invalidate()
    let color = put ? NSColor(srgbRed: 0.37, green: 0.88, blue: 0.66, alpha: 1) : NSColor(srgbRed: 0.55, green: 0.62, blue: 1, alpha: 1)
    var n = 0
    blink = Timer.scheduledTimer(withTimeInterval: 0.28, repeats: true) { [weak self] t in
      guard let self else { return }
      n += 1
      self.item.button?.image = Self.keyImage(color: n % 2 == 1 ? color : nil)
      if n >= 10 { t.invalidate(); self.item.button?.image = Self.keyImage(color: nil) }
    }
  }

  // Ключ по диагонали (геометрия — как в make-icon.swift): головка с отверстием, стержень, бородка из двух зубцов.
  // color == nil — шаблон: macOS сама красит в цвет строки меню.
  static func keyImage(color: NSColor?) -> NSImage {
    let img = NSImage(size: NSSize(width: 18, height: 18), flipped: true) { _ in
      let u: CGFloat = 0.0335
      let t = NSAffineTransform()
      t.translateX(by: 9, yBy: 9); t.rotate(byDegrees: -45); t.translateX(by: -182.5 * u, yBy: 0)
      t.concat()
      (color ?? .black).setFill()
      let ring = NSBezierPath(ovalIn: NSRect(x: -125 * u, y: -125 * u, width: 250 * u, height: 250 * u))
      ring.append(NSBezierPath(ovalIn: NSRect(x: -58 * u, y: -58 * u, width: 116 * u, height: 116 * u)))
      ring.windingRule = .evenOdd
      ring.fill()
      NSBezierPath(roundedRect: NSRect(x: 118 * u, y: -26 * u, width: 372 * u, height: 52 * u), xRadius: 26 * u, yRadius: 26 * u).fill()
      NSBezierPath(roundedRect: NSRect(x: 380 * u, y: 6 * u, width: 50 * u, height: 92 * u), xRadius: 12 * u, yRadius: 12 * u).fill()
      NSBezierPath(roundedRect: NSRect(x: 445 * u, y: 6 * u, width: 45 * u, height: 66 * u), xRadius: 12 * u, yRadius: 12 * u).fill()
      return true
    }
    img.isTemplate = color == nil
    img.accessibilityDescription = L("Связка", "Svyazka")
    return img
  }

  // ── меню по клику ──

  func menuNeedsUpdate(_ menu: NSMenu) {
    menu.removeAllItems()
    let head = menu.addItem(withTitle: L("Агенты и ключи", "Agents and keys"), action: nil, keyEquivalent: "")
    head.isEnabled = false
    if events.isEmpty {
      menu.addItem(withTitle: L("Пока ничего не брали", "Nothing used yet"), action: nil, keyEquivalent: "").isEnabled = false
    } else {
      let f = DateFormatter(); f.dateFormat = Calendar.current.isDateInToday(events.last!.date) ? "HH:mm" : "d MMM, HH:mm"
      for e in events.reversed() {
        let mi = NSMenuItem(title: "\(f.string(from: e.date))  \(Self.describe(e))", action: nil, keyEquivalent: "")
        mi.image = Self.keyImage(color: e.put ? NSColor(srgbRed: 0.37, green: 0.88, blue: 0.66, alpha: 1) : NSColor(srgbRed: 0.55, green: 0.62, blue: 1, alpha: 1))
        menu.addItem(mi)
      }
    }
    menu.addItem(.separator())
    menu.addItem(withTitle: L("Открыть Связку", "Open Svyazka"), action: #selector(doOpen), keyEquivalent: "o").target = self
    menu.addItem(withTitle: L("Журнал полностью…", "Full log…"), action: #selector(doLog), keyEquivalent: "").target = self
    menu.addItem(withTitle: L("Заблокировать", "Lock"), action: #selector(doLock), keyEquivalent: "l").target = self
    menu.addItem(.separator())
    let login = menu.addItem(withTitle: L("Запускать при входе", "Open at Login"), action: #selector(toggleLogin), keyEquivalent: "")
    login.target = self
    login.state = LoginItem.enabled ? .on : .off
    menu.addItem(withTitle: L("Выйти из Связки", "Quit Svyazka"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
  }

  @objc private func doOpen() { open() }
  @objc private func doLock() { lock() }
  @objc private func doLog() { NSWorkspace.shared.open(logURL) }
  @objc private func toggleLogin() { LoginItem.enabled ? LoginItem.disable() : LoginItem.enable() }
}

// Запуск при входе: LaunchAgent в ~/Library/LaunchAgents — открывает Связку без окна (только значок в строке меню)
enum LoginItem {
  static let plist = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/LaunchAgents/local.svyazka.menubar.plist")
  static var enabled: Bool { FileManager.default.fileExists(atPath: plist.path) }
  static func enable() {
    let app = Bundle.main.bundlePath
    let dict: [String: Any] = ["Label": "local.svyazka.menubar", "RunAtLoad": true,
                               "ProgramArguments": ["/usr/bin/open", "-g", "-a", app, "--args", "--background"]]
    try? FileManager.default.createDirectory(at: plist.deletingLastPathComponent(), withIntermediateDirectories: true)
    (dict as NSDictionary).write(to: plist, atomically: true)
  }
  static func disable() { try? FileManager.default.removeItem(at: plist) }
}
