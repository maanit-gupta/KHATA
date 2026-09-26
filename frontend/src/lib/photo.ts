/**
 * Getting a bill photo ready to send (GOAL_2.0 P2.1–P2.2): JPG/PNG as they are, HEIC converted to
 * JPEG when this browser can decode it (Safari can; Chrome can't, and then says so plainly), a PDF
 * passed through untouched (Document AI reads PDFs). Photos are measured so the preview can warn
 * when they are too dark or too small, and can be turned 90°.
 */
export type Prepared = {
  blob: Blob
  name: string
  kind: 'image' | 'pdf'
  /** Object URL for the preview (images only). Revoke with releasePhoto(). */
  url: string | null
  width: number
  height: number
  dark: boolean
  small: boolean
}

export class PhotoError extends Error {
  code: 'type' | 'heic' | 'size' | 'decode'
  constructor(code: PhotoError['code']) {
    super(code)
    this.code = code
  }
}

const MAX_BYTES = 10 * 1024 * 1024
const MIN_SHORT_EDGE = 600
const DARK_LUMA = 60 // mean of 0–255 on a 48×48 thumbnail

const isHeic = (f: File) => /image\/hei[cf]/.test(f.type) || /\.hei[cf]$/i.test(f.name)
const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
const isJpgPng = (f: File) => ['image/jpeg', 'image/png'].includes(f.type) || /\.(jpe?g|png)$/i.test(f.name)

async function decode(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob)
  } catch {
    throw new PhotoError('decode')
  }
}

function measure(bmp: ImageBitmap): { dark: boolean; small: boolean } {
  const c = document.createElement('canvas')
  c.width = 48
  c.height = 48
  const g = c.getContext('2d', { willReadFrequently: true })
  if (!g) return { dark: false, small: Math.min(bmp.width, bmp.height) < MIN_SHORT_EDGE }
  g.drawImage(bmp, 0, 0, 48, 48)
  const px = g.getImageData(0, 0, 48, 48).data
  let sum = 0
  for (let i = 0; i < px.length; i += 4) sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]
  return { dark: sum / (px.length / 4) < DARK_LUMA, small: Math.min(bmp.width, bmp.height) < MIN_SHORT_EDGE }
}

function toJpeg(bmp: ImageBitmap, rotate = false): Promise<Blob> {
  const c = document.createElement('canvas')
  c.width = rotate ? bmp.height : bmp.width
  c.height = rotate ? bmp.width : bmp.height
  const g = c.getContext('2d')!
  if (rotate) {
    g.translate(c.width, 0)
    g.rotate(Math.PI / 2) // a quarter turn clockwise
  }
  g.drawImage(bmp, 0, 0)
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new PhotoError('decode'))), 'image/jpeg', 0.9))
}

async function fromBlob(blob: Blob, name: string): Promise<Prepared> {
  const bmp = await decode(blob)
  const { dark, small } = measure(bmp)
  const out = { blob, name, kind: 'image' as const, url: URL.createObjectURL(blob), width: bmp.width, height: bmp.height, dark, small }
  bmp.close()
  return out
}

export async function preparePhoto(file: File): Promise<Prepared> {
  if (file.size > MAX_BYTES) throw new PhotoError('size')
  if (isPdf(file)) {
    return { blob: file, name: file.name || 'bill.pdf', kind: 'pdf', url: null, width: 0, height: 0, dark: false, small: false }
  }
  if (isHeic(file)) {
    let bmp: ImageBitmap
    try {
      bmp = await createImageBitmap(file)
    } catch {
      throw new PhotoError('heic') // this browser can't open HEIC: say so, don't guess
    }
    const jpeg = await toJpeg(bmp)
    bmp.close()
    return fromBlob(jpeg, file.name.replace(/\.hei[cf]$/i, '.jpg'))
  }
  if (!isJpgPng(file)) throw new PhotoError('type')
  return fromBlob(file, file.name || 'bill.jpg')
}

/** A quarter turn clockwise (receipts are often photographed sideways). */
export async function rotatePhoto(p: Prepared): Promise<Prepared> {
  if (p.kind !== 'image') return p
  const bmp = await decode(p.blob)
  const jpeg = await toJpeg(bmp, true)
  bmp.close()
  releasePhoto(p)
  return fromBlob(jpeg, p.name.replace(/\.(png|jpe?g)$/i, '') + '.jpg')
}

export function releasePhoto(p: Prepared | null) {
  if (p?.url) URL.revokeObjectURL(p.url)
}
