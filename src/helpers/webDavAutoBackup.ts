import PersistStatus from '@/store/PersistStatus'
import { logError, logInfo } from '@/helpers/logger'
import { createMusicBackup, isBackupDataKey } from '@/helpers/musicBackup'
import { runDailyWebDavBackup } from '@/helpers/webDavBackup'
import { recordWebDavBackupFailure, recordWebDavBackupSuccess } from '@/helpers/webDavBackupStatus'
import Constants from 'expo-constants'
import { AppState, type AppStateStatus } from 'react-native'

let started = false
let appState: AppStateStatus = AppState.currentState
let changeTimer: ReturnType<typeof setTimeout> | undefined
let dirty = false
let backupPromise: Promise<void> | null = null

const requestDailyBackup = () => {
	if (backupPromise || appState !== 'active') return backupPromise
	dirty = false
	backupPromise = Promise.resolve()
		.then(() => runDailyWebDavBackup(createMusicBackup(Constants.expoConfig?.version ?? '')))
		.then((result) => {
			if (result === 'uploaded') {
				recordWebDavBackupSuccess()
				logInfo('WebDAV 每日备份已完成')
			}
		})
		.catch((error) => {
			recordWebDavBackupFailure(error)
			logError('WebDAV 每日备份失败:', error)
		})
		.finally(() => {
			backupPromise = null
			if (started && dirty) scheduleBackup()
		})
	return backupPromise
}

const scheduleBackup = () => {
	dirty = true
	if (changeTimer !== undefined) clearTimeout(changeTimer)
	if (appState !== 'active') return
	changeTimer = setTimeout(() => {
		changeTimer = undefined
		void requestDailyBackup()
	}, 15_000)
}
export const startWebDavAutoBackup = () => {
	if (started) return () => undefined
	started = true
	appState = AppState.currentState
	void requestDailyBackup()
	const unsubscribe = PersistStatus.subscribe((key) => {
		if (isBackupDataKey(key)) scheduleBackup()
	})
	const subscription = AppState.addEventListener('change', (nextState) => {
		const returnedToForeground = appState !== 'active' && nextState === 'active'
		appState = nextState
		if (returnedToForeground) void requestDailyBackup()
	})
	return () => {
		started = false
		subscription.remove()
		unsubscribe()
		if (changeTimer !== undefined) clearTimeout(changeTimer)
		changeTimer = undefined
	}
}
