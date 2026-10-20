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
