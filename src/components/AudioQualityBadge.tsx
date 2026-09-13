import { ThemeColors } from '@/constants/tokens'
import { formatAudioQuality, type AudioQuality } from '@/helpers/audioQuality'
import { useThemeColors } from '@/hooks/useAppTheme'
import i18n from '@/utils/i18n'
import { memo, useMemo } from 'react'
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native'

type AudioQualityBadgeProps = {
	quality: AudioQuality | string | null | undefined
	cached?: boolean
	compact?: boolean
	style?: StyleProp<ViewStyle>
}

const AudioQualityBadge = ({
	quality,
	cached = false,
	compact = false,
	style,
}: AudioQualityBadgeProps) => {
	const colors = useThemeColors()
	const styles = useMemo(() => createStyles(colors), [colors])
	const qualityLabel = formatAudioQuality(quality)
	if (!qualityLabel) return null

	return (
		<View style={[styles.badge, compact && styles.compactBadge, style]}>
			<Text style={[styles.label, compact && styles.compactLabel]}>
				{cached ? `${qualityLabel} · ${i18n.t('player.cached')}` : qualityLabel}
			</Text>
		</View>
	)
}

const createStyles = (colors: ThemeColors) =>
	StyleSheet.create({
		badge: {
			alignSelf: 'flex-start',
			minHeight: 24,
			justifyContent: 'center',
			paddingHorizontal: 9,
			borderRadius: 7,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: colors.border,
			backgroundColor: colors.overlaySoft,
		},
		compactBadge: {
			minHeight: 18,
			paddingHorizontal: 6,
			borderRadius: 5,
		},
		label: {
			color: colors.text,
			fontSize: 11,
			fontWeight: '700',
			letterSpacing: 0.2,
		},
		compactLabel: {
			fontSize: 10,
		},
	})

export default memo(AudioQualityBadge)
