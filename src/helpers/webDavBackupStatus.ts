import PersistStatus from '@/store/PersistStatus'

export const recordWebDavBackupSuccess = () => {
	PersistStatus.set('backup.webdavStatus', { lastSuccessAt: Date.now(), failureCount: 0 })
}

export const recordWebDavBackupFailure = (error: unknown) => {
	const previous = PersistStatus.get('backup.webdavStatus') ?? {}
	const code = (error as { code?: string })?.code ?? 'request-failed'
	PersistStatus.set('backup.webdavStatus', {
		...previous,
		lastFailureAt: Date.now(),
		errorCode: code,
		failureCount: (previous.failureCount ?? 0) + 1,
	})
}
