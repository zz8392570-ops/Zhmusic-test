import { requireOptionalNativeModule } from 'expo'

type CyMusicFileSharing = {
	shareFiles(paths: string[]): Promise<boolean>
	renderReportCard(title: string, lines: string[]): Promise<string>
}

export async function renderReportCard(title: string, lines: string[]) {
	if (!nativeSharing?.renderReportCard) throw new Error('Native report cards are unavailable')
	return nativeSharing.renderReportCard(title, lines)
}

const nativeSharing = requireOptionalNativeModule<CyMusicFileSharing>('CyMusicFileSharing')

export async function shareLocalFiles(paths: string[]) {
	if (!nativeSharing) throw new Error('Native file sharing is unavailable on this platform')
	return nativeSharing.shareFiles(paths)
}
