import { deriveAffineFromTRS } from '@/domain/territorial-preparation/hasAlignment'
import { decodePng, encodePng, type GeographicBbox } from './parcelMapOverlay'
import type { CartographicTransform } from '@/application/parcel-context/cartographicViewTool'

export interface CartographicRaster { bytes: Uint8Array; bbox: GeographicBbox; width: number; height: number }
/** Render from the unmodified source in the immutable reference pixel frame.
 * Viewport/crop conversion is display only; it never changes the hypothesis. */
export function renderCartographicAlignment(source: CartographicRaster, reference: CartographicRaster, modern: CartographicRaster, transform: CartographicTransform, opacity: number) {
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new Error('Invalid opacity')
  const a = deriveAffineFromTRS(transform.sourcePixelPivot, transform.targetPixelPivot, transform.rotationDegrees, transform.scaleX, transform.scaleY)
  const determinant = a.a * a.e - a.b * a.d
  if (!Number.isFinite(determinant) || determinant <= 0) throw new Error('Numerically invalid raster transform')
  const historical = decodePng(source.bytes)
  const target = decodePng(modern.bytes)
  if (!historical || !target || historical.width !== source.width || historical.height !== source.height || target.width !== modern.width || target.height !== modern.height) throw new Error('Unsupported raster')
  for (let y = 0; y < target.height; y++) {
    const lat = modern.bbox.maxLat - y / (target.height - 1) * (modern.bbox.maxLat - modern.bbox.minLat)
    for (let x = 0; x < target.width; x++) {
      const lng = modern.bbox.minLng + x / (target.width - 1) * (modern.bbox.maxLng - modern.bbox.minLng)
      const rx = (lng - reference.bbox.minLng) / (reference.bbox.maxLng - reference.bbox.minLng) * (reference.width - 1) - a.tx
      const ry = (reference.bbox.maxLat - lat) / (reference.bbox.maxLat - reference.bbox.minLat) * (reference.height - 1) - a.ty
      const sx = Math.round((a.e * rx - a.b * ry) / determinant)
      const sy = Math.round((-a.d * rx + a.a * ry) / determinant)
      if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx < 0 || sy < 0 || sx >= historical.width || sy >= historical.height) continue
      const from = (sy * historical.width + sx) * 4
      const to = (y * target.width + x) * 4
      const alpha = historical.pixels[from + 3]! / 255 * opacity
      const backgroundAlpha = target.pixels[to + 3]! / 255
      const outputAlpha = alpha + backgroundAlpha * (1 - alpha)
      for (let c = 0; c < 3; c++) target.pixels[to + c] = outputAlpha ? Math.round((historical.pixels[from + c]! * alpha + target.pixels[to + c]! * backgroundAlpha * (1 - alpha)) / outputAlpha) : 0
      target.pixels[to + 3] = Math.round(outputAlpha * 255)
    }
  }
  return encodePng(target.width, target.height, target.pixels)
}
