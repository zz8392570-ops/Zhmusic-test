import type { Track } from '@/player/types'
/** Unknown or invalid durations remain unknown rather than looking like a zero-length recording. */
export function formatVersionDuration(value: unknown): string | null {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
	const seconds = Math.floor(value)
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
export const getVersionTitle = (track: Track) =>
	[track.title, typeof track.alias === 'string' ? track.alias : ''].filter(Boolean).join(' · ')
