import { NativeModule, requireOptionalNativeModule } from 'expo'

export type SystemPlaybackCommand = 'play' | 'pause' | 'next' | 'favorites'
export type SystemCommandEvent = { command: SystemPlaybackCommand }

type SystemCommandEvents = {
	command: (event: SystemCommandEvent) => void
}

declare class CyMusicSystemCommands extends NativeModule<SystemCommandEvents> {
	takePendingCommand(): SystemPlaybackCommand | null
}

export default requireOptionalNativeModule<CyMusicSystemCommands>('CyMusicSystemCommands')
