import { Alert } from 'react-native'
import * as DocumentPicker from 'expo-document-picker'
import { File } from 'expo-file-system'
import { logError, logInfo } from '@/helpers/logger'
import { GlobalState } from '@/utils/stateMapper'
import i18n from '@/utils/i18n'
import { fetchScriptFromUrl } from './importMusicSource'
import { restoreSelectedRuntime } from './musicApiControl'
import { importMusicSourceFiles } from './batchMusicSourceImport'

let isMusicSourceFilePickerOpen = false
export const sourceFileImportProgress = new GlobalState<{
	completed: number
	total: number
} | null>(null)

export const importMusicSourceFromUrl = async () => {
	if (isMusicSourceFilePickerOpen) {
		Alert.alert(i18n.t('common.notice'), i18n.t('sourceImport.pickerBusy'))
		return
	}
	Alert.prompt(
		i18n.t('sourceImport.title'),
		i18n.t('sourceImport.urlPrompt'),
		[
			{
				text: i18n.t('find.cancel'),
				onPress: () => logInfo('取消导入'),
				style: 'cancel',
			},
			{
				text: i18n.t('common.confirm'),
				onPress: async (url) => {
					if (!url) {
						Alert.alert(i18n.t('common.error'), i18n.t('sourceImport.urlEmpty'))
						return
					}
					if (isMusicSourceFilePickerOpen) return
					isMusicSourceFilePickerOpen = true
					sourceFileImportProgress.setValue({ completed: 0, total: 0 })
					try {
						const summary = await importMusicSourceFiles([
							{ name: url, read: () => fetchScriptFromUrl(url) },
						])
						if (summary.failures.length) throw new Error(summary.failures[0].error)
						Alert.alert(
							i18n.t('sourceImport.success'),
							i18n.t(
								summary.restoreFailed
									? 'sourceImport.batchRestoreFailed'
									: 'sourceImport.batchTestHint',
							),
						)
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error)
						logError('导入音源失败:', errMsg)
						Alert.alert(i18n.t('common.error'), i18n.t('sourceImport.failed'))
					} finally {
						isMusicSourceFilePickerOpen = false
						sourceFileImportProgress.setValue(null)
					}
				},
			},
		],
		'plain-text',
	)
}
export const importMusicSourceFromFile = async () => {
	if (isMusicSourceFilePickerOpen) {
		Alert.alert(i18n.t('common.notice'), i18n.t('sourceImport.pickerBusy'))
		return
	}
	isMusicSourceFilePickerOpen = true
	sourceFileImportProgress.setValue({ completed: 0, total: 0 })
	try {
		const result = await DocumentPicker.getDocumentAsync({
			type: ['text/javascript', 'application/javascript', 'text/plain'],
			copyToCacheDirectory: true,
			multiple: true,
		})

		if (result.canceled === true) {
			logInfo('User canceled document picker')
			return
		}

		sourceFileImportProgress.setValue({ completed: 0, total: result.assets.length })
		const summary = await importMusicSourceFiles(
			result.assets.map((asset) => ({ name: asset.name, read: () => new File(asset.uri).text() })),
			(completed, total) => sourceFileImportProgress.setValue({ completed, total }),
		)
		const message = [
			i18n.t('sourceImport.batchSummary', {
				imported: summary.imported,
				skipped: summary.skipped,
				failed: summary.failures.length,
			}),
			...(summary.failures.length
				? [
						i18n.t('sourceImport.batchFailedFiles', {
							names: summary.failures
								.slice(0, 5)
								.map((file) => file.name)
								.join('、'),
						}),
						i18n.t('sourceImport.batchFailureHint'),
					]
				: []),
			...(summary.restoreFailed ? [i18n.t('sourceImport.batchRestoreFailed')] : []),
			i18n.t('sourceImport.batchTestHint'),
		].join('\n\n')
		const retryRestore = async () => {
			try {
				const restored = await restoreSelectedRuntime()
				Alert.alert(
					i18n.t('common.success'),
					i18n.t(restored ? 'sourceImport.restoreSuccess' : 'sourceImport.noSource'),
				)
			} catch (error) {
				logError('重试恢复音源失败:', error)
				Alert.alert(i18n.t('common.error'), i18n.t('sourceImport.batchRestoreFailed'), [
					{ text: i18n.t('common.confirm') },
					{ text: i18n.t('sourceImport.retryRestore'), onPress: () => void retryRestore() },
				])
			}
		}
		Alert.alert(
			i18n.t('sourceImport.batchTitle'),
			message,
			summary.restoreFailed
				? [
						{ text: i18n.t('common.confirm') },
						{ text: i18n.t('sourceImport.retryRestore'), onPress: () => void retryRestore() },
					]
				: undefined,
		)
	} catch (err) {
		const errMsg = err instanceof Error ? (err as Error).message : String(err)
		logError('Error importing music source:', errMsg)
		Alert.alert(i18n.t('common.error'), i18n.t('sourceImport.failed'))
		logError('导入音源失败: ' + errMsg)
	} finally {
		isMusicSourceFilePickerOpen = false
		sourceFileImportProgress.setValue(null)
	}
}
