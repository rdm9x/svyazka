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
  private var update: String?      // доступная новая версия
  private var updating = false
  private let open: () -> Void, lock: () -> Void

  private static let take: Set<String> = ["run", "ssh", "get", "copy"], put: Set<String> = ["add", "set"]

  init(open: @escaping () -> Void, lock: @escaping () -> Void) {
    self.open = open; self.lock = lock
    super.init()
    item.button?.image = Self.keyImage(color: nil, dot: false)
    item.button?.toolTip = L("Связка", "Keyhandoff")
    let menu = NSMenu()
    menu.delegate = self
    item.menu = menu
    readTail()
    Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.poll() }
    // обновления: через минуту после запуска, дальше — раз в сутки
    DispatchQueue.main.asyncAfter(deadline: .now() + 60) { [weak self] in self?.checkUpdate() }
    Timer.scheduledTimer(withTimeInterval: 3600, repeats: true) { [weak self] _ in self?.checkUpdate() }
  }

  // ── обновления: только сообщаем; ставится по клику ──

  private func checkUpdate() {
    let last = UserDefaults.standard.double(forKey: "updateChecked")
    guard Date().timeIntervalSince1970 - last > 23 * 3600 else { return }
    DispatchQueue.global(qos: .utility).async {
      let r = AppDelegate.svyazka(["update", "--check", "--auto", "--json"])
      guard let out = r.out, let d = out.data(using: .utf8),
            let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return }
      DispatchQueue.main.async {
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: "updateChecked")
        self.update = (j["available"] as? Bool) == true ? j["latest"] as? String : nil
        self.item.button?.image = self.icon(nil)
      }
    }
  }

  @objc private func doUpdate() {
    guard !updating else { return }
    updating = true
    self.item.button?.image = self.icon(nil)
    // вывод — в файл, не в канал: установщик перезапустит Связку, а команда должна дожить до конца
    let log = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".svyazka/update.log")
    FileManager.default.createFile(atPath: log.path, contents: nil)
    let p = Process()
    p.executableURL = URL(fileURLWithPath: FileManager.default.homeDirectoryForCurrentUser.path + "/.local/bin/svyazka")
    p.arguments = ["update"]
    if let h = try? FileHandle(forWritingTo: log) { p.standardOutput = h; p.standardError = h }
    p.terminationHandler = { pr in
      DispatchQueue.main.async {
        self.updating = false
        guard pr.terminationStatus != 0 else { self.update = nil; self.item.button?.image = self.icon(nil); return }
        let text = (try? String(contentsOf: log, encoding: .utf8)) ?? ""
        let a = NSAlert()
        a.messageText = L("Не удалось обновить Связку", "Couldn't update Keyhandoff")
        a.informativeText = String(text.suffix(600))
        a.runModal()
      }
    }
    do { try p.run() } catch { updating = false }
  }

  private func icon(_ color: NSColor?) -> NSImage { Self.keyImage(color: color, dot: update != nil && !updating) }

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
    case "run": verb = L("использовал в команде", "used in a command")
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
      self.item.button?.image = self.icon(n % 2 == 1 ? color : nil)
      if n >= 10 { t.invalidate(); self.item.button?.image = self.icon(nil) }
    }
  }

  // Ключ по диагонали (геометрия — как в make-icon.swift): головка с отверстием, стержень, бородка из двух зубцов.
  // color == nil — шаблон: macOS сама красит в цвет строки меню.
  // dot — точка «есть обновление» в правом верхнем углу
  static func keyImage(color: NSColor?, dot: Bool = false) -> NSImage {
    let img = NSImage(size: NSSize(width: 18, height: 18), flipped: true) { _ in
      if dot {
        (color ?? .black).setFill()
        NSBezierPath(ovalIn: NSRect(x: 13, y: 1, width: 4.5, height: 4.5)).fill()
      }
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
    img.accessibilityDescription = L("Связка", "Keyhandoff")
    return img
  }

  // ── меню по клику ──

  func menuNeedsUpdate(_ menu: NSMenu) {
    menu.removeAllItems()
    if let v = update {
      let u = menu.addItem(withTitle: updating ? L("Обновляется…", "Updating…") : L("Обновить Связку до \(v)", "Update Keyhandoff to \(v)"), action: updating ? nil : #selector(doUpdate), keyEquivalent: "")
      u.target = self
      u.isEnabled = !updating
      menu.addItem(.separator())
    }
    let head = menu.addItem(withTitle: L("Агенты и ключи", "Agents and keys"), action: nil, keyEquivalent: "")
    head.isEnabled = false
    if events.isEmpty {
      menu.addItem(withTitle: L("Агенты ещё ничего не использовали", "No agent activity yet"), action: nil, keyEquivalent: "").isEnabled = false
    } else {
      let f = DateFormatter(); f.dateFormat = Calendar.current.isDateInToday(events.last!.date) ? "HH:mm" : "d MMM, HH:mm"
      for e in events.reversed() {
        let mi = NSMenuItem(title: "\(f.string(from: e.date))  \(Self.describe(e))", action: nil, keyEquivalent: "")
        mi.image = Self.keyImage(color: e.put ? NSColor(srgbRed: 0.37, green: 0.88, blue: 0.66, alpha: 1) : NSColor(srgbRed: 0.55, green: 0.62, blue: 1, alpha: 1))
        menu.addItem(mi)
      }
    }
    menu.addItem(.separator())
    menu.addItem(withTitle: L("Открыть Связку", "Open Keyhandoff"), action: #selector(doOpen), keyEquivalent: "o").target = self
    menu.addItem(withTitle: L("Журнал полностью…", "Full log…"), action: #selector(doLog), keyEquivalent: "").target = self
    menu.addItem(withTitle: L("Заблокировать", "Lock"), action: #selector(doLock), keyEquivalent: "l").target = self
    menu.addItem(.separator())
    let login = menu.addItem(withTitle: L("Запускать при входе", "Open at Login"), action: #selector(toggleLogin), keyEquivalent: "")
    login.target = self
    login.state = LoginItem.enabled ? .on : .off
    menu.addItem(withTitle: L("Выйти из Связки", "Quit Keyhandoff"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    let ver = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
    menu.addItem(withTitle: L("Связка", "Keyhandoff") + " " + ver, action: nil, keyEquivalent: "").isEnabled = false
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
