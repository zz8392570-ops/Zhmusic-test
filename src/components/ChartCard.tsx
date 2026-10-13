import LeaderboardCover from '@/components/LeaderboardCover'
import type { Playlist } from '@/helpers/types'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { Pressable, Text, View, useWindowDimensions } from 'react-native'

export default function ChartCard({
	board,
	selected,
	onPress,
}: {
	board: Playlist
	selected: boolean
	onPress: () => void
}) {
	const { width } = useWindowDimensions()
	const cardWidth = Math.max(108, Math.min(180, (width - 48 - 24) / 3))
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
				<View
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
					<Ionicons name="play" size={16} color="#fff" />
				</View>
			</LinearGradient>
		</Pressable>
	)
}
