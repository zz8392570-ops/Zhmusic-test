import PersistStatus from '@/store/PersistStatus'
import type { Track } from '@/player/types'
import { getListeningRecordingIndex, listeningTrackKey } from './listeningIdentity'

export type ListeningDay = {
	date: string
	tracks: {
		key: string
		title: string
		artist: string
		plays: number
		seconds: number
		recording?: Track
	}[]
}
export const listeningDate = (date: Date) =>
	`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
export const recordListeningDay = (
	track: IMusic.IMusicItem,
	seconds: number,
	plays: number,
	now = new Date(),
) => {
	if (seconds <= 0 && plays <= 0) return
	const date = listeningDate(now),
		key = JSON.stringify([track.platform, track.id])
	const days = PersistStatus.get('music.listeningDaily') ?? []
	const day = days.find((item) => item.date === date)
	const existing = day?.tracks.find((item) => item.key === key)
	const record = {
		key,
		recording: {
			id: track.id,
			platform: track.platform,
			title: track.title,
			artist: track.artist,
			duration: track.duration,
			album: track.album,
			alias: track.alias,
			favoriteKeepSeparate: track.favoriteKeepSeparate,
		},
		title: track.title,
		artist: track.artist,
		plays: (existing?.plays ?? 0) + Math.max(0, plays),
		seconds: (existing?.seconds ?? 0) + Math.max(0, seconds),
	}
	const nextDay = {
		date,
		tracks: [record, ...(day?.tracks ?? []).filter((item) => item.key !== key)].slice(0, 1000),
	}
	if (!PersistStatus.get('music.listeningDailySince'))
		PersistStatus.set('music.listeningDailySince', now.getTime())
	PersistStatus.set(
		'music.listeningDaily',
		[nextDay, ...days.filter((item) => item.date !== date)]
			.sort((a, b) => b.date.localeCompare(a.date))
			.slice(0, 400),
	)
}
export const buildListeningReport = (
	days: ListeningDay[],
	now = new Date(),
	previous = false,
	favorites: readonly Track[] = PersistStatus.get('music.favorites') ?? [],
	period: 'week' | 'month' | 'year' = 'week',
) => {
	const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12)
	let start = new Date(end)
	if (period === 'week') {
		if (previous) end.setDate(end.getDate() - 7)
		start = new Date(end)
		start.setDate(start.getDate() - 6)
	} else if (period === 'month') {
		if (previous) end.setDate(0)
		start = new Date(end.getFullYear(), end.getMonth(), 1, 12)
	} else {
		if (previous) {
			end.setFullYear(end.getFullYear() - 1)
			end.setMonth(11, 31)
		}
		start = new Date(end.getFullYear(), 0, 1, 12)
	}
	const dates: string[] = []
	for (const date = new Date(start); date <= end; date.setDate(date.getDate() + 1))
		dates.push(listeningDate(date))
	const recordings = new Map<string, Track>()
	for (const day of days) {
		if (!dates.includes(day.date)) continue
		for (const item of day.tracks) {
			if (recordings.has(item.key)) continue
			if (item.recording) {
				recordings.set(item.key, item.recording)
				continue
			}
			// Historical reports contain only the provider key and display metadata.
			try {
				const parsed = JSON.parse(item.key)
				if (Array.isArray(parsed) && parsed.length === 2 && typeof parsed[1] === 'string')
					recordings.set(item.key, {
						id: parsed[1],
						platform: parsed[0],
						title: item.title,
						artist: item.artist,
					})
			} catch {
				/* Preserve opaque legacy keys separately. */
			}
		}
	}
	const recordingIndex = getListeningRecordingIndex([...recordings.values()], favorites)
	const tracks = new Map<string, ListeningDay['tracks'][number]>()
	const bars = dates.map((date) => {
		const day = days.find((item) => item.date === date)
		for (const item of day?.tracks ?? []) {
			const owner = recordingIndex.find(recordings.get(item.key))
			const key = owner ? listeningTrackKey(owner) : item.key
			const old = tracks.get(key)
			tracks.set(key, {
				...item,
				key,
				title: owner?.title ?? item.title,
				artist: owner?.artist ?? item.artist,
				plays: (old?.plays ?? 0) + item.plays,
				seconds: (old?.seconds ?? 0) + item.seconds,
			})
		}
		return { date, seconds: (day?.tracks ?? []).reduce((total, item) => total + item.seconds, 0) }
	})
	const ranked = [...tracks.values()].sort((a, b) => b.plays - a.plays || b.seconds - a.seconds)
	const activeDates = new Set(
		days
			.filter((day) => day.tracks.some((item) => item.seconds > 0 || item.plays > 0))
			.map((day) => day.date),
	)
	let longestStreak = 0,
		streak = 0
	for (const date of dates) {
		streak = activeDates.has(date) ? streak + 1 : 0
		longestStreak = Math.max(longestStreak, streak)
	}
	let currentStreak = 0
	const cursor = new Date(end)
	if (!previous && !activeDates.has(listeningDate(cursor))) cursor.setDate(cursor.getDate() - 1)
	for (
		;
		cursor >= start && activeDates.has(listeningDate(cursor));
		cursor.setDate(cursor.getDate() - 1)
	)
		currentStreak++
	const artists = new Map<string, { name: string; plays: number; seconds: number }>()
	for (const track of ranked) {
		const old = artists.get(track.artist)
		artists.set(track.artist, {
			name: track.artist,
			plays: (old?.plays ?? 0) + track.plays,
			seconds: (old?.seconds ?? 0) + track.seconds,
		})
	}
	return {
		period,
		from: listeningDate(start),
		through: listeningDate(end),
		activeDays: dates.filter((date) => activeDates.has(date)).length,
		longestStreak,
		currentStreak,
		bars,
		tracks: ranked.slice(0, 20),
		artists: [...artists.values()].sort((a, b) => b.seconds - a.seconds).slice(0, 10),
		seconds: ranked.reduce((sum, item) => sum + item.seconds, 0),
		plays: ranked.reduce((sum, item) => sum + item.plays, 0),
		songCount: tracks.size,
		artistCount: artists.size,
	}
}

export const listeningChartBars = (bars: { date: string; seconds: number }[]) => {
	if (bars.length <= 7) return bars
	const result = new Map<string, { date: string; seconds: number }>()
	for (const [index, bar] of bars.entries()) {
		const key = bars.length > 31 ? bar.date.slice(0, 7) : bars[Math.floor(index / 7) * 7].date
		const old = result.get(key)
		result.set(key, { date: key, seconds: (old?.seconds ?? 0) + bar.seconds })
	}
	return [...result.values()]
}
