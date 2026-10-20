import { useMemo, useState } from 'react'
import { Alert, Clipboard, FlatList, Share, Text, TextInput, View } from 'react-native'
import PersistStatus from '@/store/PersistStatus'
import { formatSourceDiagnostics } from '@/helpers/userApi/sourceDiagnostics'
import { formatLogArgs } from '@/helpers/logger'
import { useThemeColors } from '@/hooks/useAppTheme'
import { LibraryToolButton as Button } from '@/components/LibraryToolButton'
import i18n from '@/utils/i18n'
export default function SourceDiagnosticsScreen() {
	const colors = useThemeColors(),
		events = PersistStatus.useValue('music.sourceDiagnostics', [])
	const [failuresOnly, setFailuresOnly] = useState(true),
		[query, setQuery] = useState('')
	const filtered = useMemo(
		() =>
			[...(events ?? [])]
				.reverse()
				.filter(
					(item) =>
						(!failuresOnly || item.result === 'failure') &&
						`${item.track.title} ${item.track.artist} ${item.track.platform} ${item.sourceName} ${item.category}`
							.toLowerCase()
							.includes(query.trim().toLowerCase()),
				),
		[events, failuresOnly, query],
	)
	const text = () => formatLogArgs([formatSourceDiagnostics()])
	return (
		<FlatList
			style={{ backgroundColor: colors.background }}
			contentContainerStyle={{ padding: 20 }}
			data={filtered}
			keyExtractor={(item) => item.id}
			ListHeaderComponent={
				<View style={{ gap: 8 }}>
					<Text style={{ color: colors.textMuted }}>{i18n.t('diagnostics.description')}</Text>
					<TextInput
						accessibilityLabel={i18n.t('diagnostics.search')}
						placeholder={i18n.t('diagnostics.search')}
						placeholderTextColor={colors.textMuted}
						value={query}
						onChangeText={setQuery}
						style={{ color: colors.text, padding: 12, backgroundColor: colors.surfaceMuted }}
					/>
					<Button
						title={i18n.t(failuresOnly ? 'diagnostics.showAll' : 'diagnostics.showFailures')}
						onPress={() => setFailuresOnly(!failuresOnly)}
					/>
					<Button
						title={i18n.t('diagnostics.copy')}
						onPress={() => {
							Clipboard.setString(text())
							Alert.alert(i18n.t('logScreen.diagnosticsCopied'))
						}}
					/>
					<Button
						title={i18n.t('diagnostics.share')}
						onPress={() =>
							void Share.share({ message: text() }).catch(() => Alert.alert(i18n.t('common.error')))
						}
					/>
					<Button
						title={i18n.t('diagnostics.clear')}
						danger
						onPress={() =>
							Alert.alert(i18n.t('diagnostics.clear'), i18n.t('diagnostics.confirmClear'), [
								{ text: i18n.t('find.cancel'), style: 'cancel' },
								{
									text: i18n.t('common.confirm'),
									style: 'destructive',
									onPress: () => PersistStatus.set('music.sourceDiagnostics', []),
								},
							])
						}
					/>
				</View>
			}
			ListEmptyComponent={
				<Text style={{ color: colors.textMuted }}>{i18n.t('logScreen.empty')}</Text>
			}
			renderItem={({ item }) => (
				<View
					style={{
						paddingVertical: 16,
						gap: 5,
						borderBottomWidth: 1,
						borderBottomColor: colors.surfaceMuted,
					}}
				>
					<Text style={{ color: colors.text }}>
						{item.track.title} · {item.track.artist}
					</Text>
					<Text style={{ color: colors.textMuted }}>
						{new Date(item.timestamp).toLocaleString()} · {item.track.platform?.toUpperCase()} ·{' '}
						{item.sourceName ?? '-'} · {item.result}
					</Text>
					<Text style={{ color: colors.textMuted }}>
						{item.requestKey} · {item.requestType} · {item.step} · {item.requestedQuality ?? '-'} →{' '}
						{item.actualQuality ?? '-'} · {item.durationMs ?? '-'} ms
					</Text>
					<Text style={{ color: colors.textMuted }}>
						{item.category ? i18n.t(`sourceErrors.${item.category}`) : ''}{' '}
						{formatLogArgs([item.message ?? ''])}
					</Text>
				</View>
			)}
		/>
	)
}
