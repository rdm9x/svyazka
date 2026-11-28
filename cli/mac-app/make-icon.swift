// make-icon.swift <out.png> <размер> [full] — иконка Связки: классический ключ по диагонали на тёмно-синем скруглённом квадрате.
//   без full — в формате macOS (поля 100/1024 и тень: для AppIcon.icns),
//   full     — квадрат во весь размер, без полей (Windows .ico, веб, icon-512.png).
// Рисунок утверждён 28.11.2026 (вариант «1 — классический ключ»).
import AppKit

let args = CommandLine.arguments
guard args.count >= 3, let size = Int(args[2]) else { fatalError("usage: make-icon out.png size [full]") }
let full = args.count > 3 && args[3] == "full"

let space = CGColorSpace(name: CGColorSpace.sRGB)!
func rgb(_ hex: UInt32, _ a: CGFloat = 1) -> CGColor {
  CGColor(srgbRed: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255, blue: CGFloat(hex & 255) / 255, alpha: a)
}
func grad(_ cs: [CGColor], _ l: [CGFloat]? = nil) -> CGGradient { CGGradient(colorsSpace: space, colors: cs as CFArray, locations: l)! }

// Скруглённый квадрат: тёмно-синий градиент, сиреневый блик слева сверху, бирюзовый справа снизу
func base(_ c: CGContext, _ S: CGFloat) -> CGRect {
  let ins = full ? 0 : S * 100 / 1024
  let r = CGRect(x: ins, y: full ? 0 : ins - S * 8 / 1024, width: S - 2 * ins, height: S - 2 * ins)
  let path = CGPath(roundedRect: r, cornerWidth: r.width * 0.225, cornerHeight: r.width * 0.225, transform: nil)
  c.saveGState()
  if !full { c.setShadow(offset: CGSize(width: 0, height: S * 0.02), blur: S * 0.04, color: rgb(0, 0.45)) }
  c.addPath(path); c.setFillColor(rgb(0x0b0c18)); c.fillPath(); c.restoreGState()
  c.saveGState(); c.addPath(path); c.clip()
  c.drawLinearGradient(grad([rgb(0x1a1d3d), rgb(0x0e1024), rgb(0x0a1420)], [0, 0.55, 1]), start: CGPoint(x: r.minX, y: r.minY), end: CGPoint(x: r.maxX, y: r.maxY), options: [])
  for (x, y, rr, col, a) in [(0.2, 0.15, 0.7, 0x5b63e6, 0.45), (0.9, 0.95, 0.6, 0x1fb6c8, 0.28)] as [(CGFloat, CGFloat, CGFloat, UInt32, CGFloat)] {
    let p = CGPoint(x: r.minX + r.width * x, y: r.minY + r.height * y)
    c.drawRadialGradient(grad([rgb(col, a), rgb(col, 0)]), startCenter: p, startRadius: 0, endCenter: p, endRadius: r.width * rr, options: [])
  }
  c.drawLinearGradient(grad([CGColor(gray: 1, alpha: 0.10), CGColor(gray: 1, alpha: 0)]), start: CGPoint(x: r.midX, y: r.minY), end: CGPoint(x: r.midX, y: r.minY + r.height * 0.4), options: [])
  c.restoreGState()
  if !full { c.addPath(path); c.setStrokeColor(CGColor(gray: 1, alpha: 0.12)); c.setLineWidth(S * 0.004); c.strokePath() }
  return r
}

// «Стекло»: градиент #b3b8ff → #3fc8e8, блик сверху, тонкая светлая кромка, мягкое свечение
func glassInk(_ c: CGContext, _ S: CGFloat, _ p: CGPath, _ c1: UInt32, _ c2: UInt32, alpha: CGFloat = 0.9, glow: CGFloat = 0.5) {
  let b = p.boundingBox
  if glow > 0 { c.saveGState(); c.setShadow(offset: .zero, blur: S * 0.06, color: rgb(c2, glow)); c.addPath(p); c.setFillColor(rgb(c1, 0.35)); c.fillPath(); c.restoreGState() }
  c.saveGState(); c.addPath(p); c.clip()
  c.drawLinearGradient(grad([rgb(c1, alpha), rgb(c2, alpha)]), start: CGPoint(x: b.minX, y: b.minY), end: CGPoint(x: b.maxX, y: b.maxY), options: [])
  c.drawLinearGradient(grad([CGColor(gray: 1, alpha: 0.32), CGColor(gray: 1, alpha: 0)]), start: CGPoint(x: b.minX, y: b.minY), end: CGPoint(x: b.midX, y: b.midY), options: [])
  c.restoreGState()
  c.addPath(p); c.setStrokeColor(CGColor(gray: 1, alpha: 0.28)); c.setLineWidth(S * 0.003); c.strokePath()
}

// Ключ вдоль оси +x, начало координат — центр головки: круглая головка с отверстием, стержень, бородка из двух зубцов
func keyShape(_ u: CGFloat) -> CGPath {
  let p = CGMutablePath(), hole = CGMutablePath()
  p.addEllipse(in: CGRect(x: -125 * u, y: -125 * u, width: 250 * u, height: 250 * u))
  p.addRoundedRect(in: CGRect(x: 90 * u, y: -26 * u, width: 400 * u, height: 52 * u), cornerWidth: 26 * u, cornerHeight: 26 * u)
  p.addRoundedRect(in: CGRect(x: 380 * u, y: 6 * u, width: 50 * u, height: 92 * u), cornerWidth: 12 * u, cornerHeight: 12 * u)
  p.addRoundedRect(in: CGRect(x: 445 * u, y: 6 * u, width: 45 * u, height: 66 * u), cornerWidth: 12 * u, cornerHeight: 12 * u)
  hole.addEllipse(in: CGRect(x: -58 * u, y: -58 * u, width: 116 * u, height: 116 * u))
  return CGPath(rect: .null, transform: nil).union(p).subtracting(hole)
}

let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
ctx.translateBy(x: 0, y: CGFloat(size)); ctx.scaleBy(x: 1, y: -1)
let S = CGFloat(size)
let r = base(ctx, S)
let k = keyShape(r.width / 824 * 0.82)
// по диагонали, головкой вниз-влево; центр габарита — в центр квадрата
let b0 = k.boundingBox
var tr = CGAffineTransform(translationX: r.midX, y: r.midY).rotated(by: -0.785).translatedBy(x: -b0.midX, y: -b0.midY)
glassInk(ctx, S, k.copy(using: &tr)!, 0xb3b8ff, 0x3fc8e8, alpha: 0.9, glow: 0.5)
try! NSBitmapImageRep(cgImage: ctx.makeImage()!).representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[1]))
