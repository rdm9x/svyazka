// Связка.app — окно для Связки на Mac.
// Запускает (или находит) агент svyazka, берёт у него одноразовый адрес интерфейса и показывает его во встроенном WebKit.
// Команду svyazka (~/.local/bin/svyazka — обёртка с путём к Node) ставит установщик; само окно путей не знает,
// поэтому одна и та же сборка подходит всем (её собирает CI для релиза).

import Cocoa
import WebKit

// Язык меню — тот же, что у интерфейса: агент отдаёт адрес с ?lang=ru|en
var english = false
func L(_ ru: String, _ en: String) -> String { english ? en : ru }

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
  var window: NSWindow!
  var web: WKWebView!

  static let bg = NSColor(name: nil) { a in
    a.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
      ? NSColor(srgbRed: 0.027, green: 0.035, blue: 0.059, alpha: 1)
      : NSColor(srgbRed: 0.91, green: 0.925, blue: 0.96, alpha: 1)
  }

  func applicationDidFinishLaunching(_ n: Notification) {
    buildMenu()
    let cfg = WKWebViewConfiguration()
    cfg.websiteDataStore = .default()
    web = WKWebView(frame: .zero, configuration: cfg)
    web.navigationDelegate = self
    web.uiDelegate = self
    web.setValue(false, forKey: "drawsBackground")
    web.allowsMagnification = true

    window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 760),
                      styleMask: [.titled, .closable, .miniaturizable, .resizable],
                      backing: .buffered, defer: false)
    window.title = "Связка"
    window.titlebarAppearsTransparent = true
    window.backgroundColor = Self.bg
    window.minSize = NSSize(width: 380, height: 520)
    window.contentView = web
    window.center()
    window.setFrameAutosaveName("SvyazkaDesk")
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
    loadUI()
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ s: NSApplication) -> Bool { true }

  @objc func reloadUI() { loadUI() }

  func loadUI() {
    DispatchQueue.global(qos: .userInitiated).async {
      let res = Self.svyazka(["ui", "--print"])
      DispatchQueue.main.async {
        if let s = res.out, s.hasPrefix("http://127.0.0.1"), let u = URL(string: s) {
          let en = URLComponents(url: u, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "lang" }?.value == "en"
          if en != english { english = en; self.buildMenu() }
          self.window.title = L("Связка", "Svyazka")
          self.web.load(URLRequest(url: u))
        } else {
          let msg = (res.err ?? "").replacingOccurrences(of: "<", with: "&lt;")
          self.web.loadHTMLString("""
            <body style="font:15px -apple-system;padding:48px 32px;color:#888">
            <h2 style="color:#ccc;font-weight:600">\(L("Связка не запустилась", "Svyazka didn't start"))</h2>
            <p>\(msg)</p><p>\(L("Проверьте в Терминале", "Check in Terminal")): <code>svyazka status</code>. \(L("Обновить окно — ⌘R.", "Reload the window — ⌘R."))</p></body>
            """, baseURL: nil)
        }
      }
    }
  }

  static func svyazka(_ args: [String]) -> (out: String?, err: String?) {
    let p = Process()
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    p.executableURL = URL(fileURLWithPath: home + "/.local/bin/svyazka")
    p.arguments = args
    var env = ProcessInfo.processInfo.environment
    // запасной путь к node для старой установки ссылкой (#!/usr/bin/env node)
    env["PATH"] = (env["PATH"].map { $0 + ":" } ?? "") + "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin:" + home + "/.svyazka/node/bin"
    p.environment = env
    let out = Pipe(), err = Pipe()
    p.standardOutput = out
    p.standardError = err
    do { try p.run() } catch { return (nil, error.localizedDescription) }
    let o = out.fileHandleForReading.readDataToEndOfFile()
    let e = err.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    let trim = { (d: Data) in String(data: d, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) }
    return (p.terminationStatus == 0 ? trim(o) : nil, trim(e))
  }

  // ссылки наружу — в браузер; скачивание бэкапа — через окно сохранения
  func webView(_ w: WKWebView, decidePolicyFor a: WKNavigationAction, decisionHandler h: @escaping (WKNavigationActionPolicy) -> Void) {
    if a.shouldPerformDownload { return h(.download) }
    if let u = a.request.url, let host = u.host, host != "127.0.0.1", ["http", "https"].contains(u.scheme ?? "") {
      NSWorkspace.shared.open(u)
      return h(.cancel)
    }
    h(.allow)
  }
  func webView(_ w: WKWebView, decidePolicyFor r: WKNavigationResponse, decisionHandler h: @escaping (WKNavigationResponsePolicy) -> Void) {
    h(r.canShowMIMEType ? .allow : .download)
  }
  func webView(_ w: WKWebView, navigationAction a: WKNavigationAction, didBecome d: WKDownload) { d.delegate = self }
  func webView(_ w: WKWebView, navigationResponse r: WKNavigationResponse, didBecome d: WKDownload) { d.delegate = self }
  func download(_ d: WKDownload, decideDestinationUsing r: URLResponse, suggestedFilename name: String, completionHandler h: @escaping (URL?) -> Void) {
    let panel = NSSavePanel()
    panel.nameFieldStringValue = name
    panel.beginSheetModal(for: window) { h($0 == .OK ? panel.url : nil) }
  }

  // target=_blank
  func webView(_ w: WKWebView, createWebViewWith c: WKWebViewConfiguration, for a: WKNavigationAction, windowFeatures f: WKWindowFeatures) -> WKWebView? {
    if let u = a.request.url { NSWorkspace.shared.open(u) }
    return nil
  }
  // <input type=file> — импорт бэкапа
  func webView(_ w: WKWebView, runOpenPanelWith p: WKOpenPanelParameters, initiatedByFrame f: WKFrameInfo, completionHandler h: @escaping ([URL]?) -> Void) {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = p.allowsMultipleSelection
    panel.canChooseDirectories = false
    panel.beginSheetModal(for: window) { h($0 == .OK ? panel.urls : nil) }
  }
  func webViewWebContentProcessDidTerminate(_ w: WKWebView) { loadUI() }

  func buildMenu() {
    let main = NSMenu()
    let appItem = NSMenuItem()
    main.addItem(appItem)
    let appMenu = NSMenu()
    appMenu.addItem(withTitle: L("Обновить", "Reload"), action: #selector(reloadUI), keyEquivalent: "r")
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: L("Скрыть Связку", "Hide Svyazka"), action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
    appMenu.addItem(withTitle: L("Завершить Связку", "Quit Svyazka"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    appItem.submenu = appMenu

    let editItem = NSMenuItem()
    main.addItem(editItem)
    let edit = NSMenu(title: L("Правка", "Edit"))
    edit.addItem(withTitle: L("Отменить", "Undo"), action: Selector(("undo:")), keyEquivalent: "z")
    let redo = edit.addItem(withTitle: L("Повторить", "Redo"), action: Selector(("redo:")), keyEquivalent: "z")
    redo.keyEquivalentModifierMask = [.command, .shift]
    edit.addItem(.separator())
    edit.addItem(withTitle: L("Вырезать", "Cut"), action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    edit.addItem(withTitle: L("Скопировать", "Copy"), action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    edit.addItem(withTitle: L("Вставить", "Paste"), action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    edit.addItem(withTitle: L("Выбрать всё", "Select All"), action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    editItem.submenu = edit

    let winItem = NSMenuItem()
    main.addItem(winItem)
    let win = NSMenu(title: L("Окно", "Window"))
    win.addItem(withTitle: L("Свернуть", "Minimize"), action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
    win.addItem(withTitle: L("Закрыть", "Close"), action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
    winItem.submenu = win
    NSApp.mainMenu = main
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
