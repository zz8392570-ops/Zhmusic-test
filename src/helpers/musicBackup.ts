import PersistStatus, { IPersistConfig } from '@/store/PersistStatus'
import { Buffer } from 'buffer'

const settingValidators = {
	'music.quality': (value: unknown) =>
		typeof value === 'string' && ['128k', '320k', 'flac'].includes(value),
	'music.preciseSeeking': (value: unknown) => typeof value === 'boolean',
	'music.autoCacheLocal': (value: unknown) => typeof value === 'boolean',
	'music.autoCacheWifiOnly': (value: unknown) => typeof value === 'boolean',
	'music.isCachedIconVisible': (value: unknown) => typeof value === 'boolean',
	'music.songsNumsToLoad': (value: unknown) =>
		typeof value === 'number' && [100, 200, 300].includes(value),
	'music.cacheLimitMB': (value: unknown) =>
		typeof value === 'number' && [256, 512, 1024, 2048].includes(value),
	'music.homeBoardId': (value: unknown) =>
		typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)),
	'music.homeBoardSource': (value: unknown) =>
		typeof value === 'string' && ['tx', 'kw', 'kg', 'wy', 'mg'].includes(value),
	'music.radioBoardSource': (value: unknown) =>
		typeof value === 'string' && ['tx', 'kw', 'kg', 'wy', 'mg'].includes(value),
	'app.language': (value: unknown) => typeof value === 'string' && ['zh', 'en'].includes(value),
	'app.themeMode': (value: unknown) =>
		typeof value === 'string' && ['system', 'light', 'dark'].includes(value),
	'lyric.showTranslation': (value: unknown) => typeof value === 'boolean',
	'lyric.detailFontSize': (value: unknown) =>
		typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 3,
	'lyric.delaySeconds': (value: unknown) =>
		typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 15,
}
type BackupSettingKey = keyof typeof settingValidators
export type MusicBackup = {
	format: 'zhmusic-backup'
	version: 1
	createdAt: string
	appVersion: string
	library: {
		favorites: IMusic.IMusicItem[]
		playlists: IMusic.PlayList[]
		recentlyPlayed: IMusic.IMusicItem[]
	}
	settings: Partial<Pick<IPersistConfig, BackupSettingKey>>
}
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024
const isRecord = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === 'object' && !Array.isArray(value)
const validTrack = (value: unknown): value is IMusic.IMusicItem =>
	isRecord(value) &&
	typeof value.id === 'string' &&
	!!value.id &&
	typeof value.platform === 'string' &&
	typeof value.title === 'string' &&
	typeof value.artist === 'string' &&
	['url', 'album', 'artwork'].every(
		(key) => value[key] === undefined || value[key] === null || typeof value[key] === 'string',
	)
const parseTracks = (value: unknown): IMusic.IMusicItem[] => {
	if (!Array.isArray(value) || value.length > 50_000 || !value.every(validTrack))
		throw new Error('Invalid backup songs')
	return value
}

export function createMusicBackup(appVersion: string): MusicBackup {
	const settings: MusicBackup['settings'] = {}
	for (const key of Object.keys(settingValidators) as BackupSettingKey[]) {
		const value = PersistStatus.get(key)
		if (value !== null && settingValidators[key](value)) Object.assign(settings, { [key]: value })
	}
	return {
		format: 'zhmusic-backup',
		version: 1,
		createdAt: new Date().toISOString(),
		appVersion,
		library: {
			favorites: PersistStatus.get('music.favorites') ?? [],
			playlists: PersistStatus.get('music.playLists') ?? [],
			recentlyPlayed: PersistStatus.get('music.recentlyPlayed') ?? [],
		},
		settings,
	}
}

/** Validate every section before any writes; only known personal settings can be restored. */
export function parseMusicBackup(text: string): MusicBackup {
	if (Buffer.byteLength(text, 'utf8') > MAX_BACKUP_BYTES)
		throw new Error('Backup exceeds size limit')
	const value: unknown = JSON.parse(text)
	if (
		!isRecord(value) ||
		value.format !== 'zhmusic-backup' ||
		value.version !== 1 ||
		!isRecord(value.library) ||
		!isRecord(value.settings)
	)
		throw new Error('Unsupported backup')
	const favorites = parseTracks(value.library.favorites)
	const recentlyPlayed = parseTracks(value.library.recentlyPlayed).slice(0, 200)
	const playlists = value.library.playlists
	if (!Array.isArray(playlists) || playlists.length > 1000)
		throw new Error('Invalid backup playlists')
	const parsedPlaylists = playlists.map((playlist) => {
		if (
			!isRecord(playlist) ||
			typeof playlist.id !== 'string' ||
			!playlist.id ||
			['recent', 'favorites', 'local'].includes(playlist.id) ||
			typeof playlist.name !== 'string'
		)
			throw new Error('Invalid backup playlist')
		return { ...playlist, songs: parseTracks(playlist.songs) } as IMusic.PlayList
	})
	if (new Set(parsedPlaylists.map((playlist) => playlist.id)).size !== parsedPlaylists.length)
		throw new Error('Duplicate backup playlist IDs')
	const settings: MusicBackup['settings'] = {}
	for (const [key, setting] of Object.entries(value.settings)) {
		if (!Object.hasOwn(settingValidators, key)) continue
		if (!settingValidators[key as BackupSettingKey](setting))
			throw new Error('Invalid backup setting')
		Object.assign(settings, { [key]: setting })
	}
	return {
		format: 'zhmusic-backup',
		version: 1,
		createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
		appVersion: typeof value.appVersion === 'string' ? value.appVersion : '',
		library: { favorites, playlists: parsedPlaylists, recentlyPlayed },
		settings,
	}
}

const trackKey = (track: IMusic.IMusicItem) => JSON.stringify([track.platform, track.id])
const mergeTracks = (existing: IMusic.IMusicItem[], incoming: IMusic.IMusicItem[]) => {
	const tracks = new Map(existing.map((track) => [trackKey(track), track]))
	for (const track of incoming) if (!tracks.has(trackKey(track))) tracks.set(trackKey(track), track)
	return [...tracks.values()]
}

export function restoreMusicBackup(
	backup: MusicBackup,
	mode: 'merge' | 'replace',
	restoreSettings: boolean,
) {
	if (mode !== 'merge' && mode !== 'replace') throw new Error('Invalid restore mode')
	// Accept only the same validated shape even when called outside the import UI.
	backup = parseMusicBackup(JSON.stringify(backup))
	const existing = createMusicBackup('')
	const library =
		mode === 'replace'
			? backup.library
			: {
					favorites: mergeTracks(existing.library.favorites, backup.library.favorites),
					recentlyPlayed: mergeTracks(
						existing.library.recentlyPlayed,
						backup.library.recentlyPlayed,
					).slice(0, 200),
					playlists: [...existing.library.playlists],
				}
	if (mode === 'merge') {
		for (const playlist of backup.library.playlists) {
			const index = library.playlists.findIndex((item) => item.id === playlist.id)
			if (index < 0) library.playlists.push(playlist)
			else
				library.playlists[index] = {
					...library.playlists[index],
					songs: mergeTracks(library.playlists[index].songs ?? [], playlist.songs),
				}
		}
	}
	const values: Partial<IPersistConfig> = {
		'music.favorites': library.favorites,
		'music.playLists': library.playlists,
		'music.recentlyPlayed': library.recentlyPlayed,
		...(restoreSettings ? backup.settings : {}),
	}
	const keys = Object.keys(values) as (keyof IPersistConfig)[]
	const previous = keys.map((key) => [key, PersistStatus.get(key)] as const)
	try {
		for (const key of keys) PersistStatus.set(key, values[key])
	} catch (error) {
		for (const [key, value] of previous) {
			try {
				PersistStatus.set(key, value ?? undefined)
			} catch {
				/* Best effort if storage itself remains unavailable. */
			}
		}
		throw error
	}
	return library
}
