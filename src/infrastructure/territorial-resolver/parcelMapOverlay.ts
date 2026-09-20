import { deflateSync, inflateSync } from 'node:zlib'
import type { ParcelGeometry } from '@/domain/territorial-resolver/types'

export interface GeographicBbox {
  minLat: number
  minLng: number
  maxLat: number
  maxLng: number
}

export interface PixelPoint {
  x: number
  y: number
}

function project(point: [number, number], bbox: GeographicBbox, width: number, height: number): PixelPoint {
  const [lng, lat] = point
  const x = ((lng - bbox.minLng) / (bbox.maxLng - bbox.minLng)) * (width - 1)
  const y = ((bbox.maxLat - lat) / (bbox.maxLat - bbox.minLat)) * (height - 1)
  return { x, y }
}

export function projectParcelGeometryToPixels(
  geometry: ParcelGeometry,
  bbox: GeographicBbox,
  width: number,
  height: number,
): PixelPoint[][][] {
  return geometry.coordinates.map((polygon) => polygon.map((ring) => ring.map((point) => project(point as [number, number], bbox, width, height))))
}

function crc32(data: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array) {
  const bytes = new Uint8Array(12 + data.length)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, data.length)
  bytes.set(new TextEncoder().encode(type), 4)
  bytes.set(data, 8)
  view.setUint32(8 + data.length, crc32(bytes.slice(4, 8 + data.length)))
  return bytes
}

export function decodePng(input: Uint8Array) {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength)
  if (input.length < 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => input[index] === value)) return undefined
  let offset = 8
  let width = 0
  let height = 0
  let colorType = 0
  const idat: Uint8Array[] = []
  while (offset + 12 <= input.length) {
    const length = view.getUint32(offset)
    const type = new TextDecoder().decode(input.slice(offset + 4, offset + 8))
    if (length > input.length - offset - 12) return undefined
    const data = input.slice(offset + 8, offset + 8 + length)
    offset += 12 + length
    if (type === 'IHDR') {
      if (length !== 13) return undefined
      width = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0)
      height = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(4)
      if (data[8] !== 8 || ![2, 6].includes(data[9] ?? -1) || data[12] !== 0) return undefined
      colorType = data[9]!
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
  }
  if (!width || !height || width > 4096 || height > 4096 || width * height > 1600 * 1600 || !idat.length) return undefined
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1
  const rowBytes = width * channels
  const expectedLength = height * (rowBytes + 1)
  const raw = inflateSync(Buffer.concat(idat.map((part) => Buffer.from(part))), { maxOutputLength: expectedLength })
  if (raw.length !== expectedLength) return undefined
  const pixels = new Uint8Array(width * height * 4)
  let sourceOffset = 0
  let previous = new Uint8Array(rowBytes)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[sourceOffset++]!
    const row = new Uint8Array(raw.slice(sourceOffset, sourceOffset + rowBytes))
    sourceOffset += rowBytes
    for (let i = 0; i < row.length; i += 1) {
      const left = i >= channels ? row[i - channels]! : 0
      const up = previous[i] ?? 0
      const upperLeft = i >= channels ? previous[i - channels]! : 0
      if (filter === 1) row[i] = (row[i]! + left) & 255
      else if (filter === 2) row[i] = (row[i]! + up) & 255
      else if (filter === 3) row[i] = (row[i]! + Math.floor((left + up) / 2)) & 255
      else if (filter === 4) {
        const p = left + up - upperLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - upperLeft)
        row[i] = (row[i]! + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upperLeft)) & 255
      } else if (filter !== 0) return undefined
    }
    for (let x = 0; x < width; x += 1) {
      const source = x * channels
      const target = (y * width + x) * 4
      if (colorType === 6 || colorType === 2) {
        pixels[target] = row[source]!
        pixels[target + 1] = row[source + 1]!
        pixels[target + 2] = row[source + 2]!
        pixels[target + 3] = colorType === 6 ? row[source + 3]! : 255
      } else {
        pixels[target] = row[source]!
        pixels[target + 1] = row[source]!
        pixels[target + 2] = row[source]!
        pixels[target + 3] = colorType === 4 ? row[source + 1]! : 255
      }
    }
    previous = row
  }
  return { width, height, pixels }
}

export function encodePng(width: number, height: number, pixels: Uint8Array) {
  const rows = new Uint8Array(height * (width * 4 + 1))
  for (let y = 0; y < height; y += 1) {
    rows[y * (width * 4 + 1)] = 0
    rows.set(pixels.slice(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1)
  }
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header[8] = 8
  header[9] = 6
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([Buffer.from(signature), Buffer.from(chunk('IHDR', header)), Buffer.from(chunk('IDAT', deflateSync(rows))), Buffer.from(chunk('IEND', new Uint8Array()))])
}

function blend(pixels: Uint8Array, width: number, x: number, y: number, color: [number, number, number], alpha: number) {
  if (x < 0 || y < 0 || x >= width) return
  const offset = (y * width + x) * 4
  const inverse = 1 - alpha
  pixels[offset] = Math.round(pixels[offset]! * inverse + color[0] * alpha)
  pixels[offset + 1] = Math.round(pixels[offset + 1]! * inverse + color[1] * alpha)
  pixels[offset + 2] = Math.round(pixels[offset + 2]! * inverse + color[2] * alpha)
  pixels[offset + 3] = 255
}

function line(pixels: Uint8Array, width: number, height: number, a: PixelPoint, b: PixelPoint) {
  const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), 1)
  for (let index = 0; index <= steps; index += 1) {
    const ratio = index / steps
    const x = Math.round(a.x + (b.x - a.x) * ratio)
    const y = Math.round(a.y + (b.y - a.y) * ratio)
    if (y >= 0 && y < height) blend(pixels, width, x, y, [255, 0, 255], 0.95)
  }
}

export function overlayParcelOnPng(input: Uint8Array, geometry: ParcelGeometry, bbox: GeographicBbox) {
  const decoded = decodePng(input)
  if (!decoded) return undefined
  const rings = projectParcelGeometryToPixels(geometry, bbox, decoded.width, decoded.height)
  for (const polygon of rings) {
    for (const ring of polygon) {
      for (let index = 0; index < ring.length; index += 1) {
        const a = ring[index]!
        const b = ring[(index + 1) % ring.length]!
        line(decoded.pixels, decoded.width, decoded.height, a, b)
      }
    }
  }
  const center = geometry.coordinates[0]?.[0]?.[0]
  if (center) {
    const point = project(center as [number, number], bbox, decoded.width, decoded.height)
    for (let dx = -4; dx <= 4; dx += 1) for (let dy = -4; dy <= 4; dy += 1) {
      if (Math.abs(dx) === 4 || Math.abs(dy) === 4) blend(decoded.pixels, decoded.width, Math.round(point.x + dx), Math.round(point.y + dy), [255, 255, 0], 0.95)
    }
  }
  return encodePng(decoded.width, decoded.height, decoded.pixels)
}
