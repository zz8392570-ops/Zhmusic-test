import type { Track } from './types'
import PersistStatus from '@/store/PersistStatus'

type Identity = Pick<Track, 'id' | 'platform'>
export type PlayLaterEntry = { id: string; track: IMusic.IMusicItem }
export type PlayLaterState = {
	pending: PlayLaterEntry[]
	active?: PlayLaterEntry
	/** `before` keeps the successor selected if the original anchor is removed. */
	anchor?: { track?: Identity; index: number; before?: boolean }
}
const identity = (track: Identity) => JSON.stringify([track.platform, track.id])
export const cleanQueueTrack = (track: Track): IMusic.IMusicItem => {
	const cleaned = { ...track }
	delete cleaned.playLaterEntryId
	delete cleaned.playbackQueueOrigin
	return cleaned as IMusic.IMusicItem
}
const validEntry = (entry: PlayLaterEntry) =>
	entry &&
	typeof entry.id === 'string' &&
	entry.track &&
	typeof entry.track.id === 'string' &&
	typeof entry.track.platform === 'string'
export const normalizePlayLaterState = (value?: PlayLaterState | null): PlayLaterState => ({
	pending: Array.isArray(value?.pending) ? value.pending.filter(validEntry).slice(0, 1000) : [],
	...(validEntry(value?.active) ? { active: value.active } : {}),
	...(value?.anchor && Number.isInteger(value.anchor.index) ? { anchor: value.anchor } : {}),
})
export const getPlayLaterState = () => normalizePlayLaterState(PersistStatus.get('music.playLater'))
export const setPlayLaterState = (state: PlayLaterState) =>
	PersistStatus.set('music.playLater', state)
export const projectPlayLaterEntry = (entry: PlayLaterEntry): IMusic.IMusicItem => ({
	...entry.track,
	playLaterEntryId: entry.id,
})
export const isPlayLaterTrack = (track?: Track | null, state = getPlayLaterState()) =>
	!!track?.playLaterEntryId && track.playLaterEntryId === state.active?.id
export function enqueuePlayLater(tracks: Track[]): number {
	const state = getPlayLaterState()
	const known = new Set(
		[...state.pending, ...(state.active ? [state.active] : [])].map((entry) =>
			identity(entry.track),
		),
	)
	const additions: PlayLaterEntry[] = []
	for (const track of tracks) {
		if (!track.id || !track.platform || known.has(identity(track))) continue
		if (state.pending.length + (state.active ? 1 : 0) + additions.length >= 1000)
			throw new Error('Play later queue is full')
		known.add(identity(track))
		additions.push({
			id: `later-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
			track: cleanQueueTrack(track),
		})
	}
	if (additions.length) setPlayLaterState({ ...state, pending: [...state.pending, ...additions] })
	return additions.length
}
export function activatePlayLater(id: string, current: Track | null, index: number) {
	const state = getPlayLaterState()
	const entry =
		state.pending.find((item) => item.id === id) ??
		(state.active?.id === id ? state.active : undefined)
	if (!entry) return null
	const anchor = state.active
		? state.anchor
		: {
				track: current
					? current.playbackQueueOrigin ?? { id: current.id, platform: current.platform }
					: undefined,
				index,
			}
	setPlayLaterState({
		pending: state.pending.filter((item) => item.id !== id),
		active: entry,
		anchor,
	})
	return projectPlayLaterEntry(entry)
}
export function finishPlayLater() {
	const state = getPlayLaterState()
	if (state.active || state.anchor) setPlayLaterState({ pending: state.pending })
}
export function clearPlayLater(includeActive = false) {
	const state = getPlayLaterState()
	setPlayLaterState(includeActive ? { pending: [] } : { ...state, pending: [] })
}
export function removePlayLater(id: string) {
	const state = getPlayLaterState()
	setPlayLaterState({ ...state, pending: state.pending.filter((entry) => entry.id !== id) })
}
export function movePlayLater(from: number, to: number) {
	const state = getPlayLaterState()
	if (
		!Number.isInteger(from) ||
		!Number.isInteger(to) ||
		from < 0 ||
		to < 0 ||
		from >= state.pending.length ||
		to >= state.pending.length ||
		from === to
	)
		return false
	const pending = [...state.pending]
	pending.splice(to, 0, pending.splice(from, 1)[0])
	setPlayLaterState({ ...state, pending })
	return true
}
export function getPlayLaterAnchorIndex(queue: Track[], state = getPlayLaterState()) {
	if (!state.anchor) return -1
	const found = state.anchor.track
		? queue.findIndex((track) => identity(track) === identity(state.anchor.track))
		: -1
	return found >= 0 ? found : state.anchor.index
}
export function rebasePlayLaterAnchor(previous: Track[], next: Track[]) {
	const state = getPlayLaterState()
	if (!state.active || !state.anchor || !previous.length) return
	const index = getPlayLaterAnchorIndex(previous, state)
	const retained =
		state.anchor.track &&
		next.findIndex((track) => identity(track) === identity(state.anchor.track))
	if (typeof retained === 'number' && retained >= 0) {
		if (retained !== state.anchor.index)
			setPlayLaterState({ ...state, anchor: { ...state.anchor, index: retained } })
		return
	}
	const nextKeys = new Map(next.map((track, position) => [identity(track), position]))
	const successor = Array.from(
		{ length: previous.length },
		(_, offset) =>
			previous[
				(((index + (state.anchor.before ? 0 : 1) + offset) % previous.length) + previous.length) %
					previous.length
			],
	).find((track) => nextKeys.has(identity(track)))
	const resumeIndex = successor
		? nextKeys.get(identity(successor))!
		: Math.min(Math.max(index, 0), Math.max(0, next.length - 1))
	setPlayLaterState({
		...state,
		anchor: {
			track: next[resumeIndex]
				? { id: next[resumeIndex].id, platform: next[resumeIndex].platform }
				: undefined,
			index: resumeIndex,
			before: true,
		},
	})
}
/** An interrupted temporary item is pending again when playback restoration is disabled. */
export function restorePlayLater(current: Track | null) {
	const state = getPlayLaterState()
	if (state.active && current?.playLaterEntryId !== state.active.id) {
		setPlayLaterState({
			pending: [state.active, ...state.pending.filter((entry) => entry.id !== state.active.id)],
		})
	}
}
