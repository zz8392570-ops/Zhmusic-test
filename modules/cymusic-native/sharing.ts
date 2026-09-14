import { requireOptionalNativeModule } from 'expo'

type CyMusicFileSharing = {
	shareFiles(paths: string[]): Promise<boolean>
}

const nativeSharing = requireOptionalNativeModule<CyMusicFileSharing>('CyMusicFileSharing')

export async function shareLocalFiles(paths: string[]) {
	if (!nativeSharing) throw new Error('Native file sharing is unavailable on this platform')
	return nativeSharing.shareFiles(paths)
}
