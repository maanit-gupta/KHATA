import { api } from './api'

/** GET /media/{voice|receipts}/{id}: a signed URL that lives 10 minutes (CLAUDE.md §9). */
export function mediaUrl(bucket: 'voice' | 'receipts', id: string) {
  return api<{ url: string }>(`/media/${bucket}/${id}`).then((r) => r.url)
}

export async function playRecording(voiceNoteId: string) {
  const url = await mediaUrl('voice', voiceNoteId)
  await new Audio(url).play()
}

/** Opens the bill photo in a new tab. The tab is opened synchronously (inside the tap) so pop-up
 * blockers allow it, then pointed at the signed URL. */
export async function openBill(receiptId: string) {
  const w = window.open('', '_blank')
  try {
    const url = await mediaUrl('receipts', receiptId)
    if (w) w.location.href = url
    else window.location.assign(url)
  } catch (e) {
    w?.close()
    throw e
  }
}
