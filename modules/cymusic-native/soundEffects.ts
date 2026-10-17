import { NativeModule, requireOptionalNativeModule } from 'expo'
import { Platform } from 'react-native'

export type SoundEffectsStatus = {
	state: 'off' | 'idle' | 'waiting' | 'active' | 'unsupported' | 'error'
	reason?: 'platform' | 'stream' | 'format' | 'unavailable' | 'processing' | 'playback' | 'timeout'
}
export type NativeSoundEffectsStatus = SoundEffectsStatus & { revision: number }
type SoundEffectsEvents = {
	soundEffectsChanged: (event: NativeSoundEffectsStatus) => void
}
declare class CyMusicSoundEffects extends NativeModule<SoundEffectsEvents> {
	configure(settings: {
		enabled: boolean
		bands: number[]
		volumeBalance: boolean
		revision: number
	}): Promise<NativeSoundEffectsStatus>
}

export default Platform.OS === 'ios'
	? requireOptionalNativeModule<CyMusicSoundEffects>('CyMusicSoundEffects')
	: null
