import type { Track } from '@/player/types'

export type LibrarySnapshot = {
	id: string
	createdAt: number
	target: string
	title: string
	songs: IMusic.IMusicItem[]
	playlist?: IMusic.PlayList
}
const keyOf = (track: Track) => JSON.stringify([track.platform, track.id])
export const retainedSnapshots = (entries: LibrarySnapshot[], now = Date.now()) =>
	entries.filter((item) => item.createdAt > now - 30 * 86400_000).slice(0, 20)

/** Pure storage-boundary hook: covers sync, refresh, repair, organization and restoration. */
export const captureLibrarySnapshots = (
	key: string,
	before: unknown,
	next: unknown,
	entries: LibrarySnapshot[],
	now = Date.now(),
): LibrarySnapshot[] => {
	if (!Array.isArray(before) || JSON.stringify(before) === JSON.stringify(next)) return entries
	const changes: Omit<LibrarySnapshot, 'id' | 'createdAt'>[] = []
	if (key === 'music.favorites') {
		changes.push({
			target: 'favorites',
			title: '',
			songs: before,
		})
	} else if (key === 'music.playLists') {
		const after = new Map((Array.isArray(next) ? next : []).map((item) => [item.id, item]))
		for (const playlist of before as IMusic.PlayList[]) {
			if (JSON.stringify(playlist) !== JSON.stringify(after.get(playlist.id)))
				changes.push({
					target: playlist.id,
					title: playlist.title || playlist.name,
					songs: playlist.songs,
					playlist,
				})
		}
	}
	if (!changes.length) return entries
	const additions = changes.map((item) => ({
		...item,
		createdAt: now,
		id: `snapshot-${now}-${Math.random().toString(36).slice(2)}`,
	}))
	const retained = retainedSnapshots([...additions, ...entries], now)
	// Bound retained history while keeping at least the latest recovery point.
	while (retained.length > 1 && JSON.stringify(retained).length > 8 * 1024 * 1024) retained.pop()
	return retained
}

export const compareSnapshotSongs = (current: Track[], restored: Track[]) => {
	const before = new Map(current.map((item) => [keyOf(item), item]))
	const after = new Map(restored.map((item) => [keyOf(item), item]))
	return {
		added: restored.filter((item) => !before.has(keyOf(item))).length,
		removed: current.filter((item) => !after.has(keyOf(item))).length,
		changed: restored.filter(
			(item) =>
				before.has(keyOf(item)) && JSON.stringify(before.get(keyOf(item))) !== JSON.stringify(item),
		).length,
		reordered: JSON.stringify(current.map(keyOf)) !== JSON.stringify(restored.map(keyOf)),
	}
}
