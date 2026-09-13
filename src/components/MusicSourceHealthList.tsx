import { ThemeColors } from '@/constants/tokens'
import {
	musicApiSelectedStore,
	musicApiStore,
	musicApiTestingStore,
} from '@/helpers/trackPlayerIndex'
import { getHealthPercent } from '@/helpers/userApi/musicSourceHealth'
import { useThemeColors } from '@/hooks/useAppTheme'
import i18n from '@/utils/i18n'
import React, { useMemo } from 'react'
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { hapticSelection } from '@/utils/haptics'

type MusicSourceHealthListProps = {
	onSelectSource: (sourceId: string) => void
	onTestAll: () => void
}

const statusLabel = (status?: IMusic.MusicApiHealthStatus) => {
	switch (status) {
		case 'normal':
			return i18n.t('settings.sourceHealth.normal')
		case 'partial':
			return i18n.t('settings.sourceHealth.partial')
		case 'dead':
			return i18n.t('settings.sourceHealth.dead')
		case 'testing':
			return i18n.t('settings.sourceHealth.testing')
		default:
			return '-'
	}
}

const MusicSourceHealthList = ({ onSelectSource, onTestAll }: MusicSourceHealthListProps) => {
	const colors = useThemeColors()
	const styles = useMemo(() => createStyles(colors), [colors])
	const musicApis = musicApiStore.useValue() || []
	const selectedApi = musicApiSelectedStore.useValue()
	const testing = musicApiTestingStore.useValue()

	const statusColor = (status?: IMusic.MusicApiHealthStatus) => {
		if (status === 'normal') return colors.success
		if (status === 'partial') return '#ff9500'
		if (status === 'dead') return colors.error
		return colors.textMuted
	}

	return (
		<View>
			{musicApis.length === 0 ? (
				<View style={styles.emptyRow}>
					<Text style={styles.emptyText}>{i18n.t('settings.sourceHealth.empty')}</Text>
				</View>
			) : (
				musicApis.map((api, index) => {
					const selected = selectedApi?.id === api.id
					const percent = getHealthPercent(api.health)
					const latency =
						api.health?.status === 'testing' || api.health?.latencyMs == null
							? '-'
							: `${api.health.latencyMs}ms`
					const ratio =
						api.health?.totalCount && api.health.status !== 'idle'
							? `${api.health.successCount}/${api.health.totalCount}`
							: '-'
					return (
						<View key={api.id}>
							{index > 0 && <View style={styles.separator} />}
							<TouchableOpacity
								style={[styles.row, selected && styles.selectedRow]}
								onPress={() => {
									hapticSelection()
									onSelectSource(api.id)
								}}
								disabled={testing}
								accessibilityRole="button"
								accessibilityLabel={`${api.name}, ${statusLabel(api.health?.status)}`}
								accessibilityState={{ selected, disabled: testing }}
							>
								<View style={styles.titleRow}>
									<Text style={styles.name} numberOfLines={1}>
										{api.name}
									</Text>
									{selected ? (
										<Text style={styles.current}>{i18n.t('settings.sourceHealth.current')}</Text>
									) : null}
								</View>
								<View style={styles.metaRow}>
									<Text style={styles.meta}>{percent == null ? '-' : `${percent}%`}</Text>
									<Text style={styles.meta}>{latency}</Text>
									<Text style={styles.meta}>{ratio}</Text>
									<Text style={[styles.status, { color: statusColor(api.health?.status) }]}>
										{statusLabel(api.health?.status)}
									</Text>
								</View>
							</TouchableOpacity>
						</View>
					)
				})
			)}
			<View style={styles.separator} />
			<TouchableOpacity
				style={styles.testRow}
				onPress={() => {
					hapticSelection()
					onTestAll()
				}}
				disabled={testing}
				accessibilityRole="button"
				accessibilityLabel={i18n.t('settings.items.testSources')}
				accessibilityState={{ disabled: testing, busy: testing }}
			>
				{testing ? <ActivityIndicator size="small" color={colors.loading} /> : null}
				<Text style={[styles.testText, testing && styles.testDisabled]}>
					{testing
						? i18n.t('settings.sourceHealth.testingAll')
						: i18n.t('settings.items.testSources')}
				</Text>
			</TouchableOpacity>
		</View>
	)
}

const createStyles = (colors: ThemeColors) =>
	StyleSheet.create({
		row: {
			paddingHorizontal: 16,
			paddingVertical: 12,
		},
		selectedRow: {
			backgroundColor: colors.surfaceMuted,
		},
		titleRow: {
			flexDirection: 'row',
			alignItems: 'center',
			justifyContent: 'space-between',
			gap: 8,
		},
		name: {
			flex: 1,
			fontSize: 16,
			color: colors.text,
		},
		current: {
			fontSize: 13,
			color: colors.primary,
		},
		metaRow: {
			marginTop: 6,
			flexDirection: 'row',
			alignItems: 'center',
			gap: 12,
		},
		meta: {
			fontSize: 13,
			color: colors.textMuted,
			minWidth: 52,
		},
		status: {
			marginLeft: 'auto',
			fontSize: 13,
			fontWeight: '600',
		},
		separator: {
			height: 1,
			backgroundColor: colors.maximumTrackTintColor,
			marginLeft: 16,
		},
		testRow: {
			minHeight: 44,
			paddingHorizontal: 16,
			flexDirection: 'row',
			alignItems: 'center',
			gap: 8,
		},
		testText: {
			fontSize: 16,
			color: colors.primary,
		},
		testDisabled: {
			color: colors.textMuted,
		},
		emptyRow: {
			paddingHorizontal: 16,
			paddingVertical: 14,
		},
		emptyText: {
			fontSize: 14,
			color: colors.textMuted,
		},
	})

export default MusicSourceHealthList
