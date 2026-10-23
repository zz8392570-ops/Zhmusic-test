import type { Track } from '@/player/types'
export type TrackLyricOffsets = Record<string, number>
export const MAX_TRACK_LYRIC_OFFSETS = 5000
const validOffset = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 15
export function getTrackLyricOffsetKey(track?: Track | null): string | null {
	if (!track || typeof track.platform !== 'string' || !track.platform) return null
	const id = track.platform === 'local' ? track.id : track.originalId || track.id
	return typeof id === 'string' && id ? JSON.stringify([track.platform, id]) : null
}
export function isValidTrackLyricOffsets(value: unknown): value is TrackLyricOffsets {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false
	const entries = Object.entries(value)
	return (
		entries.length <= MAX_TRACK_LYRIC_OFFSETS &&
		entries.every(([key, offset]) => {
			if (!validOffset(offset) || key.length > 2048) return false
			try {
				const identity: unknown = JSON.parse(key)
				return (
					Array.isArray(identity) &&
					identity.length === 2 &&
					identity.every(
						(part) => typeof part === 'string' && part.length > 0 && part.length <= 1024,
					) &&
					JSON.stringify(identity) === key
				)
			} catch {
				return false
			}
		})
	)
}
export function getTrackLyricDelay(
	track: Track | null | undefined,
	offsets: unknown,
	legacy: unknown = 0,
): number {
	const key = getTrackLyricOffsetKey(track)
	if (key && offsets && typeof offsets === 'object' && Object.hasOwn(offsets, key)) {
		const value = (offsets as TrackLyricOffsets)[key]
		if (validOffset(value)) return value
	}
	return validOffset(legacy) ? legacy : 0
}
/** Exact provider recording only: downloaded copies share originalId; other platforms keep independent timing. */
export function withTrackLyricDelay(
	track: Track,
	offsets: unknown,
	next: number,
): TrackLyricOffsets {
	const key = getTrackLyricOffsetKey(track)
	if (!key || key.length > 2048 || !Number.isFinite(next)) throw new Error('Invalid lyric offset')
	const current = isValidTrackLyricOffsets(offsets) ? offsets : {}
	if (!Object.hasOwn(current, key) && Object.keys(current).length >= MAX_TRACK_LYRIC_OFFSETS)
		throw new Error('Lyric offset limit reached')
	const updated = { ...current, [key]: Math.round(Math.max(-15, Math.min(15, next)) * 10) / 10 }
	if (!isValidTrackLyricOffsets(updated)) throw new Error('Invalid lyric identity')
	return updated
}
