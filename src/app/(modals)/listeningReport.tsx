import { buildListeningReport } from '@/helpers/listeningReport'
import PersistStatus from '@/store/PersistStatus'
import { useThemeColors } from '@/hooks/useAppTheme'
import i18n from '@/utils/i18n'
import { useMemo, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useFavorites } from '@/store/library'

export default function ListeningReportScreen() {
	const colors = useThemeColors(),
		days = PersistStatus.useValue('music.listeningDaily', [])
	const enabled = PersistStatus.useValue('music.listeningStatsEnabled', true)
	const since = PersistStatus.useValue('music.listeningDailySince')
	const [previous, setPrevious] = useState(false)
	const { favorites } = useFavorites()
	const report = useMemo(
		() => buildListeningReport(days ?? [], new Date(), previous, favorites),
		[days, previous, favorites],
	)
	const maximum = Math.max(1, ...report.bars.map((item) => item.seconds))
	return (
		<ScrollView
			style={{ flex: 1, backgroundColor: colors.background }}
			contentContainerStyle={{ padding: 20, gap: 20, paddingBottom: 48 }}
		>
			<Text style={{ color: colors.textMuted, lineHeight: 21 }}>
				{i18n.t('listeningReport.description')}
			</Text>
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
							{i18n.t(value ? 'listeningReport.previous' : 'listeningReport.current')}
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
				{report.bars.map((item) => (
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
