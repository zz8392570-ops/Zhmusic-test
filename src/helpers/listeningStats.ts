import type { Track } from '@/player/types'
import PersistStatus from '@/store/PersistStatus'
import { isSameMediaItem } from '@/utils/mediaItem'

export type ListeningStatsRecord = {
	key: string
	track: IMusic.IMusicItem
	playCount: number
	completedCount: number
	skippedCount: number
	totalSeconds: number
	firstPlayedAt: number
	lastPlayedAt: number
}

export type SmartPlaylistKind = 'frequent' | 'mostPlayed' | 'recentlyAdded' | 'forgotten'

type ListeningSession = {
	track: IMusic.IMusicItem
	listenedSeconds: number
	lastPosition: number | null
	duration: number
	counted: boolean
	completed: boolean
	unflushedSeconds: number
}

const MAX_STATS_RECORDS = 1000
const FLUSH_INTERVAL_SECONDS = 15
let session: ListeningSession | null = null

export const isListeningStatsEnabled = () =>
	PersistStatus.get('music.listeningStatsEnabled') !== false

export const setListeningStatsEnabled = (enabled: boolean) => {
	PersistStatus.set('music.listeningStatsEnabled', enabled)
	if (!enabled) finishListeningSession('disabled')
}

export const getListeningStats = () => PersistStatus.get('music.listeningStats') ?? []

const trackKey = (track: IMusic.IMusicItem) =>
	JSON.stringify([String(track.platform ?? ''), String(track.id)])

const updateRecord = (
	track: IMusic.IMusicItem,
	update: (record: ListeningStatsRecord) => ListeningStatsRecord,
) => {
	const now = Date.now()
	const key = trackKey(track)
	const records = getListeningStats()
	const index = records.findIndex((item) => item.key === key)
	const current =
		index >= 0
			? records[index]
			: {
					key,
					track: { ...track },
					playCount: 0,
					completedCount: 0,
					skippedCount: 0,
					totalSeconds: 0,
					firstPlayedAt: now,
					lastPlayedAt: now,
				}
	const next = update({ ...current, track: { ...track }, lastPlayedAt: now })
	const result = [next, ...records.filter((_, itemIndex) => itemIndex !== index)]
		.sort((left, right) => right.lastPlayedAt - left.lastPlayedAt)
		.slice(0, MAX_STATS_RECORDS)
	PersistStatus.set('music.listeningStats', result)
}

const flushSessionSeconds = () => {
	if (!session || session.unflushedSeconds <= 0) return
	const seconds = Math.round(session.unflushedSeconds)
	if (!seconds) return
	updateRecord(session.track, (record) => ({
		...record,
		totalSeconds: record.totalSeconds + seconds,
	}))
	session.unflushedSeconds = 0
}

export const beginListeningSession = (track: IMusic.IMusicItem) => {
	if (!isListeningStatsEnabled()) return
	if (session && isSameMediaItem(session.track, track)) {
		session.track = track
		session.lastPosition = null
		return
	}
	finishListeningSession('changed')
	session = {
		track,
		listenedSeconds: 0,
		lastPosition: null,
		duration: Number(track.duration) || 0,
		counted: false,
		completed: false,
		unflushedSeconds: 0,
	}
}

export const updateListeningProgress = (position: number, duration: number) => {
	if (!session || !isListeningStatsEnabled() || !Number.isFinite(position)) return
	if (Number.isFinite(duration) && duration > 0) session.duration = duration
	if (session.lastPosition !== null) {
		const delta = position - session.lastPosition
		// Ignore seeks and duplicate callbacks; only real forward playback contributes.
		if (delta > 0 && delta <= 3) {
			session.listenedSeconds += delta
			session.unflushedSeconds += delta
		}
	}
	session.lastPosition = position
	const effectiveThreshold = session.duration > 0 ? Math.min(30, session.duration * 0.5) : 30
	if (!session.counted && session.listenedSeconds >= effectiveThreshold) {
		session.counted = true
		updateRecord(session.track, (record) => ({ ...record, playCount: record.playCount + 1 }))
	}
	const completed =
		session.duration > 0 &&
		position >= Math.max(0, session.duration - 5) &&
		session.listenedSeconds >= effectiveThreshold
	if (completed && !session.completed) {
		const wasCounted = session.counted
		session.completed = true
		if (!session.counted) session.counted = true
		updateRecord(session.track, (record) => ({
			...record,
			playCount: record.playCount + (wasCounted ? 0 : 1),
			completedCount: record.completedCount + 1,
		}))
	}
	if (session.unflushedSeconds >= FLUSH_INTERVAL_SECONDS) flushSessionSeconds()
}

export const finishListeningSession = (reason: 'changed' | 'stopped' | 'disabled') => {
	if (!session) return
	flushSessionSeconds()
	if (reason === 'changed' && !session.completed && session.listenedSeconds >= 10) {
		updateRecord(session.track, (record) => ({ ...record, skippedCount: record.skippedCount + 1 }))
	}
	session = null
}

export const clearListeningStats = () => {
	session = null
	PersistStatus.set('music.listeningStats', [])
}

export const getSmartPlaylistTracks = (
	kind: SmartPlaylistKind,
	records = getListeningStats(),
): Track[] => {
	const now = Date.now()
	const scored = records.filter((record) => record.playCount > 0)
	switch (kind) {
		case 'mostPlayed':
			return [...scored]
				.sort((a, b) => b.playCount - a.playCount || b.totalSeconds - a.totalSeconds)
				.slice(0, 100)
				.map((item) => item.track as Track)
		case 'recentlyAdded':
			return [...scored]
				.sort((a, b) => b.firstPlayedAt - a.firstPlayedAt)
				.slice(0, 100)
				.map((item) => item.track as Track)
		case 'forgotten':
			return scored
				.filter((item) => now - item.lastPlayedAt >= 30 * 24 * 60 * 60 * 1000)
				.sort((a, b) => a.lastPlayedAt - b.lastPlayedAt)
				.slice(0, 100)
				.map((item) => item.track as Track)
		default:
			return [...scored]
				.filter((item) => now - item.lastPlayedAt <= 30 * 24 * 60 * 60 * 1000)
				.sort((a, b) => {
					const aAgeDays = (now - a.lastPlayedAt) / (24 * 60 * 60 * 1000)
					const bAgeDays = (now - b.lastPlayedAt) / (24 * 60 * 60 * 1000)
					const aScore =
						(a.playCount * 3 + a.completedCount * 2 - a.skippedCount) / (1 + aAgeDays / 7)
					const bScore =
						(b.playCount * 3 + b.completedCount * 2 - b.skippedCount) / (1 + bAgeDays / 7)
					return bScore - aScore || b.lastPlayedAt - a.lastPlayedAt
				})
				.slice(0, 100)
				.map((item) => item.track as Track)
	}
}
