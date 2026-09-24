import CyMusicSystemCommands, {
	type SystemPlaybackCommand,
} from '../../modules/cymusic-native/systemCommands'
import { useLibraryStore } from '@/store/library'
import myTrackPlayer from './trackPlayerIndex'
import { logError, logInfo } from './logger'

let started = false
let subscription: { remove(): void } | null = null
let handling = false
let queuedFallback: SystemPlaybackCommand | undefined

const playFavorites = async () => {
	const favorites = useLibraryStore.getState().favorites
	if (!favorites.length) return
	await myTrackPlayer.playWithReplacePlayList(favorites[0], favorites)
}

const execute = async (command: SystemPlaybackCommand) => {
	logInfo('执行系统播放指令', command)
	switch (command) {
		case 'pause':
			myTrackPlayer.pause()
			return
		case 'next':
			await myTrackPlayer.skipToNext()
			return
		case 'favorites':
			await playFavorites()
			return
		case 'play':
			if (myTrackPlayer.getCurrentMusic()) await myTrackPlayer.play()
			else await playFavorites()
	}
}

const takeNextCommand = () => {
	const pending = CyMusicSystemCommands?.takePendingCommand()
	const command = pending ?? queuedFallback
	if (!pending || pending === queuedFallback) queuedFallback = undefined
	return command
}

const drainPendingCommand = async (fallback?: SystemPlaybackCommand) => {
	if (fallback) queuedFallback = fallback
	if (handling) return
	handling = true
	try {
		let command = takeNextCommand()
		while (command) {
			await execute(command)
			command = takeNextCommand()
		}
	} catch (error) {
		logError('系统播放指令执行失败', error)
	} finally {
		handling = false
		if (queuedFallback) void drainPendingCommand(queuedFallback)
	}
}

export const startSystemPlaybackCommands = () => {
	if (started || !CyMusicSystemCommands) return
	started = true
	subscription = CyMusicSystemCommands.addListener('command', ({ command }) => {
		void drainPendingCommand(command)
	})
	void drainPendingCommand()
}

export const stopSystemPlaybackCommands = () => {
	subscription?.remove()
	subscription = null
	queuedFallback = undefined
	started = false
}
