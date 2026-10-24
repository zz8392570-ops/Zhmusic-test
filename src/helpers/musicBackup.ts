import {
	isValidScenes,
	isValidTrackTags,
	normalizeTags,
	isValidTagCollections,
} from '@/helpers/personalFeatures'
import { isValidTrackLyricOffsets } from '@/helpers/trackLyricOffset'
import { normalizeFavoriteGroups } from '@/helpers/favoriteGroups'
import PersistStatus, { IPersistConfig } from '@/store/PersistStatus'
import { Buffer } from 'buffer'
import { isValidDownloadTemplate } from '@/helpers/downloadFilename'
import { isValidDislikeRules } from '@/helpers/dislikeRules'

const settingValidators = {
	'music.tagCollections': isValidTagCollections,
	'music.offlinePlayback': (value: unknown) => typeof value === 'boolean',
	'music.smartShuffle': (value: unknown) => typeof value === 'boolean',
	'music.listeningScenes': isValidScenes,
	'music.trackTags': isValidTrackTags,
	'widget.collectionId': (value: unknown) =>
		typeof value === 'string' && value.length > 0 && value.length <= 1024,
	'lyric.trackOffsets': isValidTrackLyricOffsets,
	'app.startPage': (value: unknown) =>
		typeof value === 'string' && ['charts', 'my', 'favorites', 'search'].includes(value),
	'music.favoriteAutoSave': (value: unknown) => typeof value === 'boolean',
	'music.favoriteOfflineQuality': (value: unknown) =>
		typeof value === 'string' && ['128k', '320k', 'flac'].includes(value),
	'music.dislikeRules': isValidDislikeRules,
	'music.downloadWifiOnly': (value: unknown) => typeof value === 'boolean',
	'music.allowDuplicateDownloads': (value: unknown) => typeof value === 'boolean',
	'library.autoRefresh': (value: unknown) => typeof value === 'number' && [0, 1, 7].includes(value),
	'music.downloadFilenameTemplate': isValidDownloadTemplate,
	'music.quality': (value: unknown) =>
		typeof value === 'string' && ['128k', '320k', 'flac'].includes(value),
	'music.preciseSeeking': (value: unknown) => typeof value === 'boolean',
	'music.restorePlaybackOnStartup': (value: unknown) => typeof value === 'boolean',
	'music.autoCacheLocal': (value: unknown) => typeof value === 'boolean',
	'music.autoCacheWifiOnly': (value: unknown) => typeof value === 'boolean',
	'music.isCachedIconVisible': (value: unknown) => typeof value === 'boolean',
	'music.songsNumsToLoad': (value: unknown) =>
		typeof value === 'number' && [100, 200, 300].includes(value),
	'music.cacheLimitMB': (value: unknown) =>
		typeof value === 'number' && [256, 512, 1024, 2048, 4096, 8192].includes(value),
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
export const isBackupDataKey = (key: string) =>
	['music.favorites', 'music.playLists', 'music.recentlyPlayed'].includes(key) ||
	Object.hasOwn(settingValidators, key)
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

/** Merge personal collections by identity; ordinary preferences retain explicit restore semantics. */
export function mergeBackupSettings(
	current: MusicBackup['settings'],
	incoming: MusicBackup['settings'],
) {
	const result = { ...current, ...incoming }
	for (const key of ['music.trackTags', 'lyric.trackOffsets'] as const) {
		if (incoming[key]) Object.assign(result, { [key]: { ...incoming[key], ...current[key] } })
	}
	if (incoming['music.trackTags']) {
		const tags = { ...result['music.trackTags'] }
		for (const [key, labels] of Object.entries(incoming['music.trackTags']))
			tags[key] = normalizeTags([...(current['music.trackTags']?.[key] ?? []), ...labels])
		result['music.trackTags'] = tags
	}
	for (const key of [
		'music.listeningScenes',
		'music.tagCollections',
		'music.dislikeRules',
	] as const) {
		if (!incoming[key]) continue
		const entries = new Map<string, unknown>(
			(current[key] ?? []).map((item) => [item.id, item] as const),
		)
		for (const item of incoming[key]!) if (!entries.has(item.id)) entries.set(item.id, item)
		Object.assign(result, { [key]: [...entries.values()] })
	}
	for (const [key, value] of Object.entries(result))
		if (!settingValidators[key as BackupSettingKey](value))
			throw Error('Merged settings exceed limits')
	return result
}

export function backupSettingConflicts(backup: MusicBackup) {
	const current = createMusicBackup('').settings
	return Object.keys(backup.settings).filter((key) => {
		const name = key as BackupSettingKey
		return (
			current[name] !== undefined &&
			JSON.stringify(current[name]) !== JSON.stringify(backup.settings[name])
		)
	})
}

export function backupPersonalConflicts(backup: MusicBackup) {
	const current = createMusicBackup('').settings
	return [
		'music.trackTags',
		'music.listeningScenes',
		'music.tagCollections',
		'lyric.trackOffsets',
	].map((key) => {
		const name = key as BackupSettingKey
		const before = current[name],
			after = backup.settings[name]
		const index = (value: unknown): Record<string, unknown> =>
			Array.isArray(value)
				? Object.fromEntries(value.map((item) => [item.id, item]))
				: ((value ?? {}) as Record<string, unknown>)
		const oldEntries = index(before),
			newEntries = index(after)
		return {
			key,
			count: Object.keys(newEntries).filter(
				(id) =>
					Object.hasOwn(oldEntries, id) &&
					JSON.stringify(oldEntries[id]) !== JSON.stringify(newEntries[id]),
			).length,
		}
	})
}

type BackupValues = Partial<{ [K in keyof IPersistConfig]: IPersistConfig[K] | null }>
export type BackupRestorePoint = { createdAt: string; values: BackupValues }
function applyBackupValues(values: BackupValues) {
	const keys = Object.keys(values) as (keyof IPersistConfig)[]
	const previous = Object.fromEntries(
		keys.map((key) => [key, PersistStatus.get(key)]),
	) as BackupValues
	const checkpoint: BackupRestorePoint = { createdAt: new Date().toISOString(), values: previous }
	if (Buffer.byteLength(JSON.stringify(checkpoint), 'utf8') > MAX_BACKUP_BYTES)
		throw Error('Recovery point exceeds size limit')
	// Failure to save a recovery point must stop the import before it changes any data.
	PersistStatus.set('backup.restorePoint', checkpoint)
	try {
		for (const key of keys) PersistStatus.set(key, values[key] ?? undefined)
	} catch (error) {
		for (const key of keys) {
			try {
				PersistStatus.set(key, previous[key] ?? undefined)
			} catch {
				/* Storage unavailable. */
			}
		}
		throw error
	}
}

export function restoreBackupCheckpoint() {
	const point = PersistStatus.get('backup.restorePoint')
	if (!point || !Object.keys(point.values).every(isBackupDataKey))
		throw Error('Invalid recovery point')
	const current = createMusicBackup('')
	const values = point.values
	parseMusicBackup(
		JSON.stringify({
			...current,
			library: {
				favorites: values['music.favorites'] ?? [],
				playlists: values['music.playLists'] ?? [],
				recentlyPlayed: values['music.recentlyPlayed'] ?? [],
			},
			settings: Object.fromEntries(
				Object.entries(values).filter(
					([key, value]) => Object.hasOwn(settingValidators, key) && value !== null,
				),
			),
		}),
	)
	applyBackupValues(values)
	return createMusicBackup('')
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
					favorites: normalizeFavoriteGroups([
						...existing.library.favorites,
						...backup.library.favorites,
					]) as IMusic.IMusicItem[],
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
	library.favorites = normalizeFavoriteGroups(library.favorites) as IMusic.IMusicItem[]
	const values: Partial<IPersistConfig> = {
		'music.favorites': library.favorites,
		'music.playLists': library.playlists,
		'music.recentlyPlayed': library.recentlyPlayed,
		...(restoreSettings
			? mode === 'merge'
				? mergeBackupSettings(existing.settings, backup.settings)
				: backup.settings
			: {}),
	}
	// The combined library must remain exportable, even when two valid backups exceed a limit together.
	parseMusicBackup(
		JSON.stringify({
			...backup,
			library,
			settings: Object.fromEntries(
				Object.entries(values).filter(([key]) => Object.hasOwn(settingValidators, key)),
			),
		}),
	)
	applyBackupValues(values)
	return library
}
