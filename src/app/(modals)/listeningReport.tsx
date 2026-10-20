import { buildListeningReport, listeningChartBars } from '@/helpers/listeningReport'
import PersistStatus from '@/store/PersistStatus'
import { useThemeColors } from '@/hooks/useAppTheme'
import i18n from '@/utils/i18n'
import { useMemo, useState } from 'react'
import { Alert, Pressable, ScrollView, Text, View } from 'react-native'
import { useFavorites } from '@/store/library'
import { LibraryToolButton as Button } from '@/components/LibraryToolButton'
import { renderReportCard, shareLocalFiles } from '../../../modules/cymusic-native/sharing'
import * as FileSystem from 'expo-file-system/legacy'

export default function ListeningReportScreen() {
	const colors = useThemeColors(),
		days = PersistStatus.useValue('music.listeningDaily', [])
	const enabled = PersistStatus.useValue('music.listeningStatsEnabled', true)
	const since = PersistStatus.useValue('music.listeningDailySince')
	const [previous, setPrevious] = useState(false)
	const [period, setPeriod] = useState<'week' | 'month' | 'year'>('week')
	const [sharing, setSharing] = useState(false)
	const { favorites } = useFavorites()
	const report = useMemo(
		() => buildListeningReport(days ?? [], new Date(), previous, favorites, period),
		[days, previous, favorites, period],
	)
	const bars = listeningChartBars(report.bars)
	const maximum = Math.max(1, ...bars.map((item) => item.seconds))
	const share = async () => {
		if (sharing) return
		setSharing(true)
		let path: string | undefined
		try {
			path = await renderReportCard(i18n.t(`listeningReport.periods.${period}`), [
				i18n.t('listeningReport.summary', {
					minutes: Math.round(report.seconds / 60),
					plays: report.plays,
				}),
				`${report.from} — ${report.through}`,
				i18n.t('listeningReport.diversity', {
					songs: report.songCount,
					artists: report.artistCount,
				}),
				i18n.t('listeningReport.streaks', report),
				...report.tracks
					.slice(0, 3)
					.map((item, index) => `${index + 1}. ${item.title} · ${item.artist}`),
				i18n.t('listeningReport.coverage'),
			])
			await shareLocalFiles([path])
		} catch {
			Alert.alert(i18n.t('listeningReport.shareFailed'))
		} finally {
			if (path) await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {})
			setSharing(false)
		}
	}
	return (
		<ScrollView
			style={{ flex: 1, backgroundColor: colors.background }}
			contentContainerStyle={{ padding: 20, gap: 20, paddingBottom: 48 }}
		>
			<Text style={{ color: colors.textMuted, lineHeight: 21 }}>
				{i18n.t('listeningReport.description')}
			</Text>
			<View style={{ flexDirection: 'row', gap: 8 }}>
				{(['week', 'month', 'year'] as const).map((value) => (
					<Pressable
						key={value}
						accessibilityRole="button"
						accessibilityState={{ selected: period === value }}
						onPress={() => setPeriod(value)}
						style={{
							padding: 12,
							borderRadius: 10,
							backgroundColor: period === value ? colors.primary : colors.surfaceMuted,
						}}
					>
						<Text style={{ color: period === value ? '#fff' : colors.text }}>
							{i18n.t(`listeningReport.periods.${value}`)}
						</Text>
					</Pressable>
				))}
			</View>
			<Text style={{ color: colors.textMuted }}>
				{report.from} — {report.through}
				{'\n'}
				{i18n.t('listeningReport.coverage')}
			</Text>
			<Text style={{ color: colors.text }}>{i18n.t('listeningReport.streaks', report)}</Text>
			<Button
				title={i18n.t('listeningReport.shareCard')}
				onPress={() => void share()}
				disabled={sharing || !report.songCount}
			/>
			{enabled === false ? (
				<Text style={{ color: colors.textMuted }}>{i18n.t('listeningReport.disabled')}</Text>
			) : null}
			{since ? (
				<Text style={{ color: colors.textMuted }}>
					{i18n.t('listeningReport.since', { date: new Date(since).toLocaleDateString() })}
				</Text>
			) : null}
			<View style={{ flexDirection: 'row', gap: 12 }}>
				{[false, true].map((value) => (
					<Pressable
						key={String(value)}
						accessibilityRole="button"
						accessibilityState={{ selected: previous === value }}
						onPress={() => setPrevious(value)}
						style={{
							padding: 12,
							borderRadius: 10,
							backgroundColor: previous === value ? colors.primary : colors.surfaceElevated,
						}}
					>
						<Text style={{ color: previous === value ? '#fff' : colors.text }}>
							{i18n.t(value ? 'listeningReport.previousPeriod' : 'listeningReport.currentPeriod')}
						</Text>
					</Pressable>
				))}
			</View>
			<Text style={{ color: colors.text, fontSize: 26, fontWeight: '700' }}>
				{i18n.t('listeningReport.summary', {
					minutes: Math.round(report.seconds / 60),
					plays: report.plays,
				})}
			</Text>
			<Text style={{ color: colors.textMuted }}>
				{i18n.t('listeningReport.diversity', {
					songs: report.songCount,
					artists: report.artistCount,
				})}
			</Text>
			<View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end', height: 150 }}>
				{bars.map((item) => (
					<View key={item.date} style={{ flex: 1, alignItems: 'center', gap: 8 }}>
						<Text style={{ color: colors.textMuted, fontSize: 11 }}>
							{Math.round(item.seconds / 60)}
						</Text>
						<View
							style={{
								backgroundColor: colors.primary,
								width: '70%',
								borderRadius: 5,
								height: Math.max(3, (item.seconds / maximum) * 100),
							}}
						/>
						<Text style={{ color: colors.textMuted, fontSize: 11 }}>{item.date.slice(5)}</Text>
					</View>
				))}
			</View>
			{!report.songCount ? (
				<Text style={{ color: colors.textMuted }}>{i18n.t('listeningReport.empty')}</Text>
			) : null}
			<Text style={{ color: colors.text, fontSize: 20, fontWeight: '700' }}>
				{i18n.t('listeningReport.topSongs')}
			</Text>
			{report.tracks.map((item, index) => (
				<View key={item.key} style={{ gap: 5 }}>
					<Text style={{ color: colors.text }}>
						{index + 1}. {item.title}
					</Text>
					<Text style={{ color: colors.textMuted }}>
						{item.artist} ·{' '}
						{i18n.t('listeningReport.trackSummary', {
							plays: item.plays,
							minutes: Math.round(item.seconds / 60),
						})}
					</Text>
				</View>
			))}
			<Text style={{ color: colors.text, fontSize: 20, fontWeight: '700' }}>
				{i18n.t('listeningReport.topArtists')}
			</Text>
			{report.artists.map((item, index) => (
				<Text key={item.name} style={{ color: colors.text }}>
					{index + 1}. {item.name} ·{' '}
					{i18n.t('listeningReport.trackSummary', {
						plays: item.plays,
						minutes: Math.round(item.seconds / 60),
					})}
				</Text>
			))}
		</ScrollView>
	)
}
