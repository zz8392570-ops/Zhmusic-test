import { logError, logInfo } from '@/helpers/logger'
import { createMusicBackup } from '@/helpers/musicBackup'
import { runDailyWebDavBackup } from '@/helpers/webDavBackup'
import Constants from 'expo-constants'
import { AppState, type AppStateStatus } from 'react-native'

let started = false
let appState: AppStateStatus = AppState.currentState
let backupPromise: Promise<void> | null = null

const requestDailyBackup = () => {
	if (backupPromise || appState !== 'active') return backupPromise
	backupPromise = runDailyWebDavBackup(
		createMusicBackup(Constants.expoConfig?.version ?? ''),
	)
		.then((result) => {
			if (result === 'uploaded') logInfo('WebDAV 每日备份已完成')
		})
		.catch((error) => {
			logError('WebDAV 每日备份失败:', error)
		})
		.finally(() => {
			backupPromise = null
		})
	return backupPromise
}

export const startWebDavAutoBackup = () => {
	if (started) return () => undefined
	started = true
	appState = AppState.currentState
	void requestDailyBackup()
	const subscription = AppState.addEventListener('change', (nextState) => {
		const returnedToForeground = appState !== 'active' && nextState === 'active'
		appState = nextState
		if (returnedToForeground) void requestDailyBackup()
	})
	return () => {
		started = false
		subscription.remove()
	}
}
