import LeaderboardCover from '@/components/LeaderboardCover'
import chartBackgrounds from '@/assets/chart-backgrounds.png'
import { Image } from 'expo-image'
import type { Playlist } from '@/helpers/types'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { ActivityIndicator, Pressable, Text, View, useWindowDimensions } from 'react-native'

export default function ChartCard({
	board,
	selected,
	onPress,
	onPlay,
	playing = false,
}: {
	board: Playlist
	selected: boolean
	onPress: () => void
	onPlay: () => void
	playing?: boolean
}) {
	const { width } = useWindowDimensions()
	const cardWidth = Math.max(108, Math.min(180, (width - 36 - 24) / 3))
	const scene = /飙升|上升|趋势/.test(board.title) ? 1 : /新歌|新声|首发/.test(board.title) ? 2 : 0
	return (
		<Pressable
			onPress={onPress}
			accessibilityRole="button"
			accessibilityState={{ selected }}
			style={({ pressed }) => ({
				width: cardWidth,
				height: cardWidth * 0.78,
				borderRadius: 14,
				overflow: 'hidden',
				opacity: pressed ? 0.75 : 1,
			})}
		>
			<LeaderboardCover
				title={board.title}
				backgroundOnly
				platform={board.platform}
				boardId={board.id}
				style={{ width: '100%', height: '100%', borderRadius: 14 }}
			/>
			<Image
				source={chartBackgrounds}
				contentFit="fill"
				style={{
					position: 'absolute',
					width: cardWidth * 3,
					height: cardWidth,
					left: -scene * cardWidth,
					top: -cardWidth * 0.22,
				}}
			/>

			<LinearGradient
				colors={['rgba(0,0,0,0.12)', 'rgba(0,0,0,0.5)']}
				style={{
					position: 'absolute',
					width: '100%',
					height: '100%',
					padding: 10,
					justifyContent: 'center',
				}}
			>
				<Text
					numberOfLines={2}
					style={{ color: '#fff', fontSize: 18, lineHeight: 23, fontWeight: '800' }}
				>
					{board.title.replace(/^(QQ|网易云音乐|网易云|酷狗|酷我|咪咕)/, '')}
				</Text>
				<View
					style={{
						width: 28,
						height: 4,
						borderRadius: 2,
						backgroundColor: selected ? '#fff' : 'rgba(255,255,255,0.55)',
						marginTop: 10,
					}}
				/>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel={`播放${board.title}`}
					accessibilityState={{ busy: playing, disabled: playing }}
					disabled={playing}
					hitSlop={6}
					onPress={(event) => {
						event.stopPropagation()
						onPlay()
					}}
					style={{
						position: 'absolute',
						right: 10,
						bottom: 10,
						width: 28,
						height: 28,
						borderRadius: 14,
						backgroundColor: 'rgba(255,255,255,0.2)',
						alignItems: 'center',
						justifyContent: 'center',
					}}
				>
					{playing ? (
						<ActivityIndicator size="small" color="#fff" />
					) : (
						<Ionicons name="play" size={16} color="#fff" />
					)}
				</Pressable>
			</LinearGradient>
		</Pressable>
	)
}
