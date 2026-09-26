/**
 * One audio player for the whole app (GOAL_2.0 P1.2c). Every spoken result gets a fresh object URL
 * built from its own bytes; starting anything new stops the old clip and revokes its URL, so an
 * old read-back can never be replayed in place of a new one, and two clips never talk over each
 * other.
 */
let current: { audio: HTMLAudioElement; url: string | null } | null = null

export function stopPlayback() {
  if (!current) return
  current.audio.pause()
  current.audio.removeAttribute('src')
  if (current.url) URL.revokeObjectURL(current.url)
  current = null
}

function start(src: string, objectUrl: string | null): Promise<void> {
  stopPlayback()
  const audio = new Audio(src)
  current = { audio, url: objectUrl }
  return audio.play()
}

/** Base64 audio from the API (MP3 from Bulbul). */
export function playB64(b64: string | null | undefined, mime = 'audio/mpeg') {
  if (!b64) return
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }))
  start(url, url).catch(() => undefined)
}

/** A signed Storage URL (an original recording). Not an object URL, so nothing to revoke. */
export function playUrl(url: string): Promise<void> {
  return start(url, null)
}
