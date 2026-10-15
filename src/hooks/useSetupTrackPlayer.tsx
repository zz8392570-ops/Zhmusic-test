import myTrackPlayer from '@/helpers/trackPlayerIndex'
import { useEffect } from 'react'
import TrackPlayer, { PlayerCommand, RepeatMode } from '@rntp/player'
import { initializeSoundEffects } from '@/helpers/soundEffects'

let nativeConfigured = false

const setupPlayer = () => {
	if (nativeConfigured) return
	TrackPlayer.setupPlayer({
		progressSync: { intervalSeconds: 1 },
		autoUpdateMetadataFromStream: false,
	})
	TrackPlayer.setCommands({
		capabilities: [
			PlayerCommand.PlayPause,
			PlayerCommand.Next,
			PlayerCommand.Previous,
			PlayerCommand.Stop,
			PlayerCommand.Seek,
		],
		handling: 'hybrid',
		perCommandHandling: {
			[PlayerCommand.Next]: 'js',
			[PlayerCommand.Previous]: 'js',
		},
	})

	TrackPlayer.setVolume(1)
	TrackPlayer.setRepeatMode(RepeatMode.Off)
	TrackPlayer.setShuffleEnabled(false)
	// Optional DSP must never hold up transport initialization or restored playback.
	void initializeSoundEffects().catch((error) => console.error('Sound effects setup failed', error))
	nativeConfigured = true
}

let initialization: Promise<void> | undefined

const initializePlayer = () => {
	if (!initialization) {
		initialization = Promise.resolve()
			.then(setupPlayer)
			.then(() => myTrackPlayer.setupTrackPlayer())
			.catch((error) => {
				initialization = undefined
				throw error
			})
	}
	return initialization
}

export const useSetupTrackPlayer = ({
	onLoad,
	onError,
	retryKey = 0,
}: {
	onLoad?: () => void
	onError?: (error: unknown) => void
	retryKey?: number
}) => {
	useEffect(() => {
		let mounted = true

		initializePlayer()
			.then(() => {
				if (mounted) onLoad?.()
			})
			.catch((error) => {
				console.error(error)
				if (mounted) onError?.(error)
			})

		return () => {
			mounted = false
		}
	}, [onError, onLoad, retryKey])
}
