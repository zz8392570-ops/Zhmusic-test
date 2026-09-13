import { MaterialCommunityIcons } from '@expo/vector-icons'
import { MenuView } from '@react-native-menu/menu'
import { useMemo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { ThemeColors } from '@/constants/tokens'
import { useThemeColors } from '@/hooks/useAppTheme'
import PersistStatus from '@/store/PersistStatus'
import { DEFAULT_HOME_BOARD_ID, getHomeBoardName, getHomeBoards } from '@/store/library'
import i18n from '@/utils/i18n'

const HomeHeaderTitle = () => {
	const colors = useThemeColors()
	const styles = useMemo(() => createStyles(colors), [colors])
	const homeBoardId =
		PersistStatus.useValue('music.homeBoardId', DEFAULT_HOME_BOARD_ID) ?? DEFAULT_HOME_BOARD_ID
	const homeBoardName = getHomeBoardName(homeBoardId)
	const actions = useMemo(
		() =>
			getHomeBoards().map((board) => ({
				id: String(board.bangid),
				title: board.name,
				state: String(board.bangid) === String(homeBoardId) ? ('on' as const) : ('off' as const),
			})),
		[homeBoardId],
	)

	return (
		<View style={styles.container}>
			<Text style={styles.title}>{i18n.t('home.title')}</Text>
			<MenuView
				onPressAction={({ nativeEvent: { event } }) => {
					const nextBoardId = Number.parseInt(event, 10)
					if (Number.isNaN(nextBoardId) || nextBoardId === homeBoardId) return
					PersistStatus.set('music.homeBoardId', nextBoardId)
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
