import { Pressable, Text } from 'react-native'
import { router } from 'expo-router'
import PersistStatus from '@/store/PersistStatus'
import { useThemeColors } from '@/hooks/useAppTheme'
import i18n from '@/utils/i18n'

export default function BackupReminder() {
	const status = PersistStatus.useValue('backup.webdavStatus')
	const colors = useThemeColors()
	if (!status?.errorCode || (status.failureCount ?? 0) < 2) return null
	return (
		<Pressable
			accessibilityRole="button"
			onPress={() => router.push('/(modals)/backupManager')}
			style={{ padding: 12, minHeight: 44, backgroundColor: colors.surfaceElevated }}
		>
			<Text style={{ color: colors.error }}>{i18n.t('backup.failureReminder')}</Text>
		</Pressable>
	)
}
