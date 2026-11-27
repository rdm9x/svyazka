// swift docs/shoot.swift <url> <password> <hash> <dark|light> <out.png>
// Снимок интерфейса Связки для README: открывает страницу во WebKit, входит, переходит на экран, сохраняет PNG.
import Cocoa
import WebKit

let a = CommandLine.arguments
guard a.count == 6 else { print("usage: shoot url password hash theme out.png"); exit(1) }
let (url, pw, route, theme, out) = (a[1], a[2], a[3], a[4], a[5])

final class Shooter: NSObject, WKNavigationDelegate {
  let web: WKWebView
  let win: NSWindow
  init(size: NSSize) {
    web = WKWebView(frame: NSRect(origin: .zero, size: size))
    win = NSWindow(contentRect: NSRect(origin: NSPoint(x: -4000, y: -4000), size: size), styleMask: [.borderless], backing: .buffered, defer: false)
    super.init()
    win.contentView = web
    win.appearance = NSAppearance(named: theme == "dark" ? .darkAqua : .aqua)
    win.orderBack(nil)
    web.navigationDelegate = self
  }
  func js(_ s: String, then: @escaping () -> Void) {
    web.evaluateJavaScript(s) { _, e in if let e = e { print("js:", e) }; then() }
  }
  func later(_ t: Double, _ f: @escaping () -> Void) { DispatchQueue.main.asyncAfter(deadline: .now() + t, execute: f) }
  func webView(_ w: WKWebView, didFinish n: WKNavigation!) {
    js("localStorage.setItem('svyazka.theme','\(theme)'); document.documentElement.dataset.theme='\(theme)'; 1") {
      self.later(0.5) {
        self.js("const f=document.querySelector('#f-lock'); f.pw.value='\(pw)'; f.requestSubmit(); 1") {
          self.later(3) {
            self.js("location.hash='\(route)'; 1") {
              self.later(1.2) {
                let cfg = WKSnapshotConfiguration()
                self.web.takeSnapshot(with: cfg) { img, err in
                  guard let img = img, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
                        let png = rep.representation(using: .png, properties: [:]) else { print("snapshot failed", err as Any); exit(1) }
                  try! png.write(to: URL(fileURLWithPath: out))
                  print("saved", out)
                  exit(0)
                }
              }
            }
          }
        }
      }
    }
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let s = Shooter(size: NSSize(width: 1200, height: 720))
s.web.load(URLRequest(url: URL(string: url)!))
DispatchQueue.main.asyncAfter(deadline: .now() + 30) { print("timeout"); exit(1) }
app.run()
