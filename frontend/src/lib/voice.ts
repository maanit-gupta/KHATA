import { api } from './api'
import type { VoiceResult } from './ledger'

function audioForm(blob: Blob, extra: Record<string, string> = {}) {
  const fd = new FormData()
  const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm'
  fd.append('audio', blob, `note.${ext}`) // sent as-is: WebM on Chrome, MP4 on Safari (CLAUDE.md §6.1)
  for (const [k, v] of Object.entries(extra)) fd.append(k, v)
  return fd
}

/** POST /voice/entry. `answerTo` = the voice_note_id of a clarify question (joined server-side). */
export function uploadVoiceEntry({ blob, answerTo }: { blob: Blob; answerTo?: string }) {
  return api<VoiceResult>('/voice/entry', { method: 'POST', body: audioForm(blob, answerTo ? { answer_to: answerTo } : {}) })
}

export function resolveVoiceEntry({ voiceNoteId, choice }: { voiceNoteId: string; choice: 'use_suggested' | 'create_new' }) {
  return api<VoiceResult>('/voice/entry/resolve', {
    method: 'POST', body: JSON.stringify({ voice_note_id: voiceNoteId, choice }),
  })
}

export type Answer = { text: string; audio_b64: string | null; question_en?: string }

export function uploadVoiceQuestion(blob: Blob) {
  return api<Answer>('/voice/ask', { method: 'POST', body: audioForm(blob) })
}
