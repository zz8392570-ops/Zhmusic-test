import { MaterialCommunityIcons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { memo, useMemo, type ComponentProps } from 'react'
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name']

type LeaderboardCoverProps = {
	title: string
	platform?: string
	boardId?: string
	compact?: boolean
	style?: StyleProp<ViewStyle>
}

type CoverVisual = {
	colors: readonly [string, string]
	icon: IconName
}

const PLATFORM_LABELS: Record<string, string> = {
	tx: 'QQ',
	kw: 'KUWO',
	kg: 'KUGOU',
	wy: 'NETEASE',
	mg: 'MIGU',
}

const COVER_RULES: { pattern: RegExp; visual: CoverVisual }[] = [
	{ pattern: /飙升|上升|趋势/, visual: { colors: ['#7C3AED', '#EC4899'], icon: 'trending-up' } },
	{ pattern: /热歌|热门|热播/, visual: { colors: ['#F43F5E', '#F97316'], icon: 'fire' } },
	{ pattern: /新歌|新声|首发/, visual: { colors: ['#2563EB', '#06B6D4'], icon: 'creation' } },
	{ pattern: /流行|指数/, visual: { colors: ['#4F46E5', '#8B5CF6'], icon: 'chart-line' } },
	{ pattern: /识曲|听歌/, visual: { colors: ['#059669', '#14B8A6'], icon: 'waveform' } },
	{ pattern: /MV|视频/, visual: { colors: ['#DB2777', '#9333EA'], icon: 'play-box-multiple' } },
	{
		pattern: /原创|音乐人/,
		visual: { colors: ['#EA580C', '#EAB308'], icon: 'lightbulb-on-outline' },
	},
	{ pattern: /电音|DJ|舞曲/, visual: { colors: ['#0891B2', '#3B82F6'], icon: 'equalizer' } },
]

const FALLBACK_VISUALS: CoverVisual[] = [
	{ colors: ['#0EA5E9', '#2563EB'], icon: 'music-note' },
	{ colors: ['#8B5CF6', '#D946EF'], icon: 'star-four-points' },
	{ colors: ['#10B981', '#0D9488'], icon: 'headphones' },
	{ colors: ['#F97316', '#EF4444'], icon: 'chart-bar' },
	{ colors: ['#6366F1', '#EC4899'], icon: 'album' },
]

const hashText = (value: string) => {
	let hash = 0
	for (let index = 0; index < value.length; index++) {
		hash = (hash * 31 + value.charCodeAt(index)) >>> 0
	}
	return hash
}

const getCoverVisual = (title: string, boardId: string) =>
	COVER_RULES.find(({ pattern }) => pattern.test(title))?.visual ??
	FALLBACK_VISUALS[hashText(`${boardId}:${title}`) % FALLBACK_VISUALS.length]

const LeaderboardCover = ({
	title,
	platform,
	boardId = '',
	compact = true,
	style,
}: LeaderboardCoverProps) => {
	const visual = useMemo(() => getCoverVisual(title, boardId), [boardId, title])
	const platformLabel = PLATFORM_LABELS[String(platform || '').toLowerCase()] ?? 'CY'

	return (
		<LinearGradient
			accessible={false}
			colors={visual.colors}
			end={{ x: 1, y: 1 }}
			start={{ x: 0, y: 0 }}
			style={[styles.cover, compact ? styles.compactCover : styles.largeCover, style]}
		>
			<View style={styles.largeOrb} />
			<View style={styles.smallOrb} />
			<View style={styles.topRow}>
				<Text style={[styles.platform, !compact && styles.largePlatform]}>{platformLabel}</Text>
				<MaterialCommunityIcons
					name={visual.icon}
					size={compact ? 18 : 34}
					color="rgba(255,255,255,0.92)"
				/>
			</View>
			<Text numberOfLines={2} style={[styles.title, !compact && styles.largeTitle]}>
				{title}
			</Text>
		</LinearGradient>
	)
}

const styles = StyleSheet.create({
	cover: {
		overflow: 'hidden',
		justifyContent: 'space-between',
		padding: 9,
		shadowColor: '#000000',
		shadowOffset: { width: 0, height: 3 },
		shadowOpacity: 0.16,
		shadowRadius: 7,
	},
	compactCover: {
		width: 70,
		height: 70,
		borderRadius: 10,
	},
	largeCover: {
		aspectRatio: 1,
		borderRadius: 16,
		padding: 18,
	},
	largeOrb: {
		position: 'absolute',
		top: -26,
		right: -18,
		width: 74,
		height: 74,
		borderRadius: 37,
		backgroundColor: 'rgba(255,255,255,0.15)',
	},
	smallOrb: {
		position: 'absolute',
		bottom: -16,
		left: -12,
		width: 48,
		height: 48,
		borderRadius: 24,
		backgroundColor: 'rgba(255,255,255,0.10)',
	},
	topRow: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
	},
	platform: {
		color: 'rgba(255,255,255,0.78)',
		fontSize: 7,
		fontWeight: '800',
		letterSpacing: 0.5,
	},
	largePlatform: {
		fontSize: 12,
		letterSpacing: 1,
	},
	title: {
		color: '#FFFFFF',
		fontSize: 12,
		fontWeight: '800',
		lineHeight: 15,
		textShadowColor: 'rgba(0,0,0,0.16)',
		textShadowOffset: { width: 0, height: 1 },
		textShadowRadius: 2,
	},
	largeTitle: {
		fontSize: 25,
		lineHeight: 31,
	},
})

export default memo(LeaderboardCover)
