// make-icon.swift <icon-512.png> <out-1024.png> — иконка в стиле macOS: скруглённый квадрат с полями и тенью.
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count == 3,
      let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: args[1]) as CFURL, nil),
      let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { fatalError("usage: make-icon in.png out.png") }

let S = 1024, inset: CGFloat = 100, radius: CGFloat = 185
let ctx = CGContext(data: nil, width: S, height: S, bitsPerComponent: 8, bytesPerRow: 0,
                    space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
let rect = CGRect(x: inset, y: inset + 10, width: CGFloat(S) - 2 * inset, height: CGFloat(S) - 2 * inset)
let path = CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil)

ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -12), blur: 28, color: CGColor(gray: 0, alpha: 0.35))
ctx.addPath(path); ctx.setFillColor(CGColor(gray: 0.05, alpha: 1)); ctx.fillPath()
ctx.restoreGState()

ctx.saveGState()
ctx.addPath(path); ctx.clip()
ctx.interpolationQuality = .high
ctx.draw(img, in: rect)
ctx.restoreGState()

ctx.addPath(path)
ctx.setStrokeColor(CGColor(gray: 1, alpha: 0.12)); ctx.setLineWidth(3); ctx.strokePath()

let out = CGImageDestinationCreateWithURL(URL(fileURLWithPath: args[2]) as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(out, ctx.makeImage()!, nil)
CGImageDestinationFinalize(out)
