import type { Track } from '@/player/types'

type TrackIdentity = Pick<Track, 'id' | 'platform'>
export const getLibraryTrackKey = (track: TrackIdentity) =>
	`${track.platform ?? 'unknown'}@${track.id}`

/** Legacy bare IDs are usable only when they identify exactly one library entry. */
export const resolveLibraryTrack = <T extends Track>(
	tracks: T[],
	target: TrackIdentity | string,
): T | undefined => {
	const matches = tracks.filter((track) =>
		typeof target === 'string'
			? getLibraryTrackKey(track) === target || track.id === target
			: getLibraryTrackKey(track) === getLibraryTrackKey(target),
	)
	return matches.length === 1 ? matches[0] : undefined
}

/** Capture persisted fields before work that can outlive a user's edits. */
export const copyLibraryTracks = <T extends Track>(tracks: T[]): T[] =>
	JSON.parse(JSON.stringify(tracks)) as T[]

const orderedRecord = (value: unknown): unknown => {
	if (Array.isArray(value)) return value.map(orderedRecord)
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value)
				.filter(([, entry]) => entry !== undefined)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, entry]) => [key, orderedRecord(entry)]),
		)
	}
	return value
}

export const isUneditedLibraryTrack = (current: Track, baseline: Track) =>
	JSON.stringify(orderedRecord(current)) === JSON.stringify(orderedRecord(baseline))

export type LibraryReplacement = {
	original: IMusic.IMusicItem
	replacement: IMusic.IMusicItem
}

/** Replace only unchanged entries that still exist; retain latest order and additions. */
export const mergeLibraryRepairs = (
	baseline: IMusic.IMusicItem[],
	current: IMusic.IMusicItem[],
	replacements: LibraryReplacement[],
) => {
	const initialByKey = new Map(baseline.map((track) => [getLibraryTrackKey(track), track]))
	const next = [...current]
	const applied: LibraryReplacement[] = []
	for (const { original, replacement } of replacements) {
		const originalKey = getLibraryTrackKey(original)
		const initial = initialByKey.get(originalKey)
		const index = next.findIndex((track) => getLibraryTrackKey(track) === originalKey)
		if (!initial || index < 0 || !isUneditedLibraryTrack(next[index], initial)) continue
		if (
			next.some(
				(track, trackIndex) =>
					trackIndex !== index && getLibraryTrackKey(track) === getLibraryTrackKey(replacement),
			)
		)
			continue
		next[index] = replacement
		applied.push({ original: initial, replacement })
	}
	return { tracks: next, replacements: applied, repaired: applied.length }
}

export const mergePlaylistRepairs = (
	playlist: IMusic.PlayList,
	baseline: IMusic.IMusicItem[],
	replacements: LibraryReplacement[],
) => {
	const merged = mergeLibraryRepairs(baseline, playlist.songs, replacements)
	const sourceOverrides = { ...(playlist.sourceOverrides ?? {}) } as Record<string, string>
	const snapshotKeys = new Set<string>(playlist.sourceSnapshotKeys ?? [])
	for (const { original, replacement } of merged.replacements) {
		const originalKey = getLibraryTrackKey(original)
		const sourceKey = snapshotKeys.has(originalKey)
			? originalKey
			: Object.entries(sourceOverrides).find(([, value]) => value === originalKey)?.[0]
		if (sourceKey) sourceOverrides[sourceKey] = getLibraryTrackKey(replacement)
	}
	return { songs: merged.tracks, sourceOverrides, repaired: merged.repaired }
}
