import { MaterialCommunityIcons } from '@expo/vector-icons'
import { MenuView } from '@react-native-menu/menu'
import { useMemo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { ThemeColors } from '@/constants/tokens'
import {
	DEFAULT_HOME_BOARD_ID,
	DEFAULT_HOME_SOURCE,
	normalizeLeaderboardSource,
	setHomeLeaderboard,
} from '@/helpers/leaderboard'
import { useThemeColors } from '@/hooks/useAppTheme'
import PersistStatus from '@/store/PersistStatus'
import { getHomeBoardName, getHomeBoards } from '@/store/library'
import i18n from '@/utils/i18n'

const HomeHeaderTitle = () => {
	const colors = useThemeColors()
	const styles = useMemo(() => createStyles(colors), [colors])
	const homeBoardSource = normalizeLeaderboardSource(
		PersistStatus.useValue('music.homeBoardSource', DEFAULT_HOME_SOURCE) ?? DEFAULT_HOME_SOURCE,
	)
	const homeBoardId =
		String(
			PersistStatus.useValue('music.homeBoardId', DEFAULT_HOME_BOARD_ID) ?? DEFAULT_HOME_BOARD_ID,
		)
	const homeBoardName = getHomeBoardName(homeBoardId, homeBoardSource)
	const actions = useMemo(
		() =>
			getHomeBoards(homeBoardSource).map((board) => ({
				id: board.bangid,
				title: board.name,
				state: board.bangid === homeBoardId ? ('on' as const) : ('off' as const),
			})),
		[homeBoardId, homeBoardSource],
	)

	return (
		<View style={styles.container}>
			<Text style={styles.title}>{i18n.t('home.title')}</Text>
			<MenuView
				onPressAction={({ nativeEvent: { event } }) => {
					if (!event || event === homeBoardId) return
					setHomeLeaderboard(homeBoardSource, event)
				}}
				actions={actions}
			>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel={`${i18n.t('home.selectBoard')}: ${homeBoardName}`}
					hitSlop={8}
					style={({ pressed }) => [styles.boardButton, pressed && styles.boardButtonPressed]}
				>
					<Text style={styles.boardName} numberOfLines={1}>
						{homeBoardName}
					</Text>
					<MaterialCommunityIcons name="chevron-down" size={17} color={colors.primary} />
				</Pressable>
			</MenuView>
		</View>
	)
}

const createStyles = (colors: ThemeColors) =>
	StyleSheet.create({
		container: {
			flexDirection: 'row',
			alignItems: 'center',
			flexShrink: 1,
			gap: 8,
			maxWidth: 280,
		},
		title: {
			color: colors.text,
			fontSize: 17,
			fontWeight: '700',
		},
		boardButton: {
			minHeight: 32,
			maxWidth: 174,
			flexShrink: 1,
			flexDirection: 'row',
			alignItems: 'center',
			paddingLeft: 10,
			paddingRight: 7,
			borderRadius: 10,
			backgroundColor: colors.surfaceMuted,
		},
		boardButtonPressed: {
			opacity: 0.65,
		},
		boardName: {
			flexShrink: 1,
			color: colors.primary,
			fontSize: 14,
			fontWeight: '600',
		},
	})

export default HomeHeaderTitle
