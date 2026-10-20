import type { LibrarySnapshot } from '@/helpers/librarySnapshots'

type Store = {
	getString(key: string): string | undefined
	set(key: string, value: string): void
	remove(key: string): void
}
type Chunk = { key: string; length: number }
type Songs = { chunks: Chunk[] }
type Playlist = Omit<IMusic.PlayList, 'songs'> & { songs: Songs }
type Snapshot = Omit<LibrarySnapshot, 'songs' | 'playlist'> & {
	songs: Songs
	playlist?: Omit<IMusic.PlayList, 'songs'>
}
type Manifest = { libraryStorageVersion: 1; entries: Songs | Playlist[] | Snapshot[] }
const keys = ['music.favorites', 'music.playLists', 'library.snapshots'] as const
type LibraryKey = (typeof keys)[number]
const CHUNK_SIZE = 128
const MAX_HISTORY_SIZE = 8 * 1024 * 1024
const isManifest = (value: unknown): value is Manifest =>
	!!value &&
	typeof value === 'object' &&
	'libraryStorageVersion' in value &&
	value.libraryStorageVersion === 1
const manifest = (entries: Manifest['entries']): Manifest => ({ libraryStorageVersion: 1, entries })
const playlistMetadata = (playlist: IMusic.PlayList | Playlist) => {
	const metadata: Record<string, unknown> = { ...playlist }
	delete metadata.songs
	return metadata as Omit<IMusic.PlayList, 'songs'>
}
const parse = (raw: string | undefined): unknown => (raw === undefined ? null : JSON.parse(raw))
export const isLibraryStorageKey = (key: string): key is LibraryKey =>
	(keys as readonly string[]).includes(key)

function chunksOf(value: unknown): Chunk[] {
	if (!isManifest(value)) return []
	if (!Array.isArray(value.entries)) return value.entries.chunks
	return value.entries.flatMap((entry) => entry.songs.chunks)
}

/** Public persistence values stay compatible with backup, sync and recovery callers. */
export function readLibraryStorage(store: Store, key: LibraryKey): unknown {
	const value = parse(store.getString(key))
	if (!isManifest(value)) return value
	const decoded = new Map<string, IMusic.IMusicItem[]>()
	const songs = (entry: Songs) =>
		entry.chunks.flatMap((chunk) => {
			const cached = decoded.get(chunk.key)
			if (cached) return cached
			const raw = store.getString(chunk.key)
			if (raw === undefined) throw new Error(`Missing library data: ${chunk.key}`)
			const tracks = JSON.parse(raw) as IMusic.IMusicItem[]
			decoded.set(chunk.key, tracks)
			return tracks
		})
	if (key === 'music.favorites') return songs(value.entries as Songs)
	if (key === 'music.playLists')
		return (value.entries as Playlist[]).map((entry) => ({
			...entry,
			songs: songs(entry.songs),
		}))
	return (value.entries as Snapshot[]).map((entry) => {
		const tracks = songs(entry.songs)
		return {
			...entry,
			songs: tracks,
			...(entry.playlist ? { playlist: { ...entry.playlist, songs: tracks } } : {}),
		}
	})
}

/** Immutable chunks let current lists and recovery points share unchanged songs.
 * New chunks are durable before either manifest is published. Failed writes restore
 * both manifests; old chunks are removed only after the commit succeeds.
 */
export function writeLibraryStorage(store: Store, key: LibraryKey, value: unknown) {
	// Finish interrupted cleanup after an app exit. Published manifests always win.
	const interrupted = store.getString('library.pendingChunks')
	if (interrupted) {
		const referenced = new Set(
			keys.flatMap((name) => chunksOf(parse(store.getString(name)))).map((chunk) => chunk.key),
		)
		for (const chunkKey of JSON.parse(interrupted) as string[]) {
			if (!referenced.has(chunkKey)) store.remove(chunkKey)
		}
		store.remove('library.pendingChunks')
	}
	const rawBefore = new Map(keys.map((name) => [name, store.getString(name)]))
	const before = new Map(keys.map((name) => [name, parse(rawBefore.get(name))]))
	const staged = new Map<string, string>()
	const chunkSongs = (tracks: IMusic.IMusicItem[], previous?: Songs): Songs => ({
		chunks: Array.from({ length: Math.ceil(tracks.length / CHUNK_SIZE) }, (_, index) => {
			const raw = JSON.stringify(tracks.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE))
			const old = previous?.chunks[index]
			if (old && (staged.get(old.key) ?? store.getString(old.key)) === raw) return old
			let chunkKey: string
			do {
				chunkKey = `library.chunk.${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}`
			} while (staged.has(chunkKey) || store.getString(chunkKey) !== undefined)
			staged.set(chunkKey, raw)
			return { key: chunkKey, length: raw.length }
		}),
	})
	const packPlaylists = (lists: IMusic.PlayList[], previous: Playlist[] = []): Playlist[] => {
		const old = new Map(previous.map((entry) => [entry.id, entry]))
		return lists.map(({ songs, ...metadata }) => ({
			...metadata,
			songs: chunkSongs(songs, old.get(metadata.id)?.songs),
		}))
	}
	const packHistory = (entries: LibrarySnapshot[]): Snapshot[] =>
		entries.map(({ songs, playlist, ...metadata }) => {
			return {
				...metadata,
				songs: chunkSongs(songs),
				...(playlist ? { playlist: playlistMetadata(playlist) } : {}),
			}
		})
	const oldValue = before.get(key)
	let prior = oldValue
	// Migration is staged together with the user's first edit, never during reads.
	if (Array.isArray(oldValue) && key === 'music.favorites') prior = manifest(chunkSongs(oldValue))
	if (Array.isArray(oldValue) && key === 'music.playLists')
		prior = manifest(packPlaylists(oldValue))
	let next: unknown = null
	if (value !== undefined) {
		if (key === 'music.favorites')
			next = manifest(
				chunkSongs(
					value as IMusic.IMusicItem[],
					isManifest(prior) ? (prior.entries as Songs) : undefined,
				),
			)
		else if (key === 'music.playLists')
			next = manifest(
				packPlaylists(
					value as IMusic.PlayList[],
					isManifest(prior) ? (prior.entries as Playlist[]) : [],
				),
			)
		else next = manifest(packHistory(value as LibrarySnapshot[]))
	}
	if (JSON.stringify(prior) === JSON.stringify(next)) return
	const after = new Map(before)
	after.set(key, next)
	if (key !== 'library.snapshots' && isManifest(prior)) {
		const now = Date.now()
		const makeSnapshot = (
			target: string,
			title: string,
			songs: Songs,
			playlist?: Playlist,
		): Snapshot => {
			return {
				id: `snapshot-${now}-${Math.random().toString(36).slice(2)}`,
				createdAt: now,
				target,
				title,
				songs,
				...(playlist ? { playlist: playlistMetadata(playlist) } : {}),
			}
		}
		let additions: Snapshot[]
		if (key === 'music.favorites')
			additions = [makeSnapshot('favorites', '', prior.entries as Songs)]
		else {
			const updated = new Map(
				(isManifest(next) ? (next.entries as Playlist[]) : []).map((entry) => [entry.id, entry]),
			)
			additions = (prior.entries as Playlist[])
				.filter((entry) => JSON.stringify(entry) !== JSON.stringify(updated.get(entry.id)))
				.map((entry) => makeSnapshot(entry.id, entry.title || entry.name, entry.songs, entry))
		}
		if (additions.length) {
			const oldHistory = before.get('library.snapshots')
			const history = isManifest(oldHistory)
				? (oldHistory.entries as Snapshot[])
				: packHistory(Array.isArray(oldHistory) ? oldHistory : [])
			const retained = [...additions, ...history]
				.filter((entry) => entry.createdAt > now - 30 * 86400_000)
				.slice(0, 20)
			// Count shared chunks once; no history song arrays are parsed or serialized.
			const size = () =>
				[
					...new Map(
						retained
							.flatMap((entry) => entry.songs.chunks)
							.map((chunk) => [chunk.key, chunk.length]),
					).values(),
				].reduce((total, length) => total + length, JSON.stringify(retained).length)
			while (retained.length > 1 && size() > MAX_HISTORY_SIZE) retained.pop()
			after.set('library.snapshots', manifest(retained))
		}
	}
	const changed = keys.filter(
		(name) => JSON.stringify(before.get(name)) !== JSON.stringify(after.get(name)),
	)
	const written: string[] = []
	const retainedKeys = new Set([...after.values()].flatMap(chunksOf).map((chunk) => chunk.key))
	const obsolete = new Set(
		[...before.values()]
			.flatMap(chunksOf)
			.map((chunk) => chunk.key)
			.concat([...staged.keys()]),
	)
	const garbage = [...obsolete].filter((chunkKey) => !retainedKeys.has(chunkKey))
	store.set('library.pendingChunks', JSON.stringify([...new Set([...staged.keys(), ...garbage])]))
	try {
		for (const [chunkKey, raw] of staged) {
			store.set(chunkKey, raw)
			written.push(chunkKey)
		}
		// Publish recovery first, then the edited collection.
		for (const name of ['library.snapshots', 'music.favorites', 'music.playLists'] as const) {
			if (!changed.includes(name)) continue
			const data = after.get(name)
			if (data === null) store.remove(name)
			else store.set(name, JSON.stringify(data))
		}
	} catch (error) {
		for (const name of changed) {
			const raw = rawBefore.get(name)
			if (raw === undefined) store.remove(name)
			else store.set(name, raw)
		}
		for (const chunkKey of written) store.remove(chunkKey)
		store.remove('library.pendingChunks')
		throw error
	}
	try {
		for (const chunkKey of garbage) store.remove(chunkKey)
		store.remove('library.pendingChunks')
	} catch {
		// Retry cleanup on the next write without reporting a durable commit as failed.
	}
}
