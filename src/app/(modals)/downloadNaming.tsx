import React, { useState } from 'react'
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { useThemeColors } from '@/hooks/useAppTheme'
import PersistStatus from '@/store/PersistStatus'
import i18n from '@/utils/i18n'
import {
	DEFAULT_DOWNLOAD_TEMPLATE,
	formatDownloadFilename,
	isValidDownloadTemplate,
} from '@/helpers/downloadFilename'

export default function DownloadNamingScreen() {
	const colors = useThemeColors()
	const [template, setTemplate] = useState(
		PersistStatus.get('music.downloadFilenameTemplate') ?? DEFAULT_DOWNLOAD_TEMPLATE,
	)
	const valid = isValidDownloadTemplate(template)
	const preview = formatDownloadFilename(
		{
			title: i18n.t('downloadNaming.exampleTitle'),
			artist: i18n.t('downloadNaming.exampleArtist'),
			album: i18n.t('downloadNaming.exampleAlbum'),
			id: '001',
			platform: 'tx',
		},
		'320k',
		template,
	)
	const button = (label: string, onPress: () => void) => (
		<Pressable
			accessibilityRole="button"
			onPress={onPress}
			style={{ padding: 14, borderRadius: 10, backgroundColor: colors.surfaceElevated }}
		>
			<Text style={{ color: colors.primary }}>{label}</Text>
		</Pressable>
	)
	return (
		<ScrollView
			style={{ backgroundColor: colors.background }}
			contentContainerStyle={{ padding: 20, gap: 16 }}
			keyboardShouldPersistTaps="handled"
		>
			<Text style={{ color: colors.text, fontSize: 24, fontWeight: '700' }}>
				{i18n.t('downloadNaming.title')}
			</Text>
			<Text style={{ color: colors.textMuted }}>{i18n.t('downloadNaming.description')}</Text>
			<TextInput
				accessibilityLabel={i18n.t('downloadNaming.title')}
				value={template}
				onChangeText={setTemplate}
				maxLength={160}
				autoCapitalize="none"
				autoCorrect={false}
				style={{
					padding: 14,
					borderRadius: 10,
					backgroundColor: colors.surfaceElevated,
					color: colors.text,
				}}
			/>
			<Text style={{ color: colors.textMuted }}>{i18n.t('downloadNaming.tokens')}</Text>
			{!valid && <Text style={{ color: colors.error }}>{i18n.t('downloadNaming.invalid')}</Text>}
			<View accessibilityLiveRegion="polite">
				<Text style={{ color: colors.text }}>{i18n.t('downloadNaming.preview')}</Text>
				<Text style={{ color: colors.primary }}>{valid ? preview : '—'}</Text>
			</View>
			{[
				'{title} - {artist}',
				'{artist} - {title}',
				'{title} - {artist} [{quality}]',
				'{platform}_{id}',
			].map((rule) => (
				<View key={rule}>{button(rule, () => setTemplate(rule))}</View>
			))}
			{button(i18n.t('downloadNaming.save'), () => {
				if (!valid) return Alert.alert(i18n.t('common.error'), i18n.t('downloadNaming.invalid'))
				PersistStatus.set('music.downloadFilenameTemplate', template.trim())
				Alert.alert(i18n.t('common.success'), i18n.t('downloadNaming.saved'))
			})}
		</ScrollView>
	)
}
