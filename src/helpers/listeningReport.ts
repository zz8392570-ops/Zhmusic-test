import PersistStatus from '@/store/PersistStatus'

export type ListeningDay = {
	date: string
	tracks: { key: string; title: string; artist: string; plays: number; seconds: number }[]
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
			.slice(0, 90),
	)
}
export const buildListeningReport = (days: ListeningDay[], now = new Date(), previous = false) => {
	const dates = Array.from({ length: 7 }, (_, index) => {
		const date = new Date(now)
		date.setDate(date.getDate() - (previous ? 13 : 6) + index)
		return listeningDate(date)
	})
	const tracks = new Map<string, ListeningDay['tracks'][number]>()
	const bars = dates.map((date) => {
		const day = days.find((item) => item.date === date)
		for (const item of day?.tracks ?? []) {
			const old = tracks.get(item.key)
			tracks.set(item.key, {
				...item,
				plays: (old?.plays ?? 0) + item.plays,
				seconds: (old?.seconds ?? 0) + item.seconds,
			})
		}
		return { date, seconds: (day?.tracks ?? []).reduce((total, item) => total + item.seconds, 0) }
	})
	const ranked = [...tracks.values()].sort((a, b) => b.plays - a.plays || b.seconds - a.seconds)
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
		bars,
		tracks: ranked.slice(0, 20),
		artists: [...artists.values()].sort((a, b) => b.seconds - a.seconds).slice(0, 10),
		seconds: ranked.reduce((sum, item) => sum + item.seconds, 0),
		plays: ranked.reduce((sum, item) => sum + item.plays, 0),
		songCount: tracks.size,
		artistCount: artists.size,
	}
}
