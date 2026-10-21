import type { Track } from '@/player/types'
import { isLocalSongUrl } from './songSharing'

export const formatStorageBytes = (bytes: number) =>
	bytes >= 1024 ** 3
		? `${(bytes / 1024 ** 3).toFixed(2)} GB`
		: `${(bytes / 1024 ** 2).toFixed(1)} MB`
export const getDownloadCandidates = (tracks: readonly Track[]) => [
	...new Map(
		tracks
			.filter((track) => track.platform !== 'local' && !isLocalSongUrl(track.url))
			.map((track) => [JSON.stringify([track.platform, track.id]), { ...track }]),
	).values(),
]
const sizeBytes = (value: unknown): number | null => {
	if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null
	if (typeof value !== 'string') return null
	const match = /^\s*(\d+(?:\.\d+)?)\s*(B|K|KB|KIB|M|MB|MIB|G|GB|GIB)?\s*$/i.exec(value)
	if (!match) return null
	const multiplier = {
		B: 1,
		K: 1024,
		KB: 1024,
		KIB: 1024,
		M: 1024 ** 2,
		MB: 1024 ** 2,
		MIB: 1024 ** 2,
		G: 1024 ** 3,
		GB: 1024 ** 3,
		GIB: 1024 ** 3,
	}[match[2]?.toUpperCase() ?? 'B']
	const bytes = Number(match[1]) * multiplier
	return Number.isFinite(bytes) && bytes > 0 ? bytes : null
}
export function estimateDownloadSize(tracks: readonly Track[], quality: IMusic.IQualityKey) {
	let bytes = 0,
		unknown = 0
	for (const track of tracks) {
		const explicit =
			sizeBytes(track.source?.[quality]?.size) ?? sizeBytes(track.qualities?.[quality]?.size)
		if (explicit) bytes += explicit
		else if (
			(quality === '128k' || quality === '320k') &&
			Number.isFinite(track.duration) &&
			Number(track.duration) > 0
		)
			bytes += (Number(track.duration) * (quality === '128k' ? 128_000 : 320_000)) / 8
		else unknown++
	}
	return { bytes: Math.ceil(bytes), unknown }
}
