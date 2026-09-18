import type { MenuAction } from '@react-native-menu/menu'
import {
	Children,
	cloneElement,
	isValidElement,
	useState,
	type ReactElement,
	type ReactNode,
} from 'react'
import { Modal, Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useThemeColors } from '@/hooks/useAppTheme'
import i18n from '@/utils/i18n'

type Props = {
	children: ReactNode
	title?: string
	actions: MenuAction[]
	onPressAction: (event: { nativeEvent: { event: string } }) => void
}

// Give the trigger its own press handler so nested touchables cannot swallow menu taps.
export const MenuView = ({ children, title, actions, onPressAction }: Props) => {
	const colors = useThemeColors()
	const { bottom } = useSafeAreaInsets()
	const [visible, setVisible] = useState(false)
	const [submenu, setSubmenu] = useState<MenuAction | null>(null)
	const close = () => {
		setVisible(false)
		setSubmenu(null)
	}
	const child = Children.only(children)
	const trigger = isValidElement(child)
		? cloneElement(child as ReactElement<{ onPress?: () => void }>, {
				onPress: () => {
					setSubmenu(null)
					setVisible(true)
				},
			})
		: child
	return (
		<>
			{trigger}
			<Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
				<View style={{ flex: 1, justifyContent: 'flex-end' }}>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel={i18n.t('find.cancel')}
						onPress={close}
						style={{
							position: 'absolute',
							top: 0,
							bottom: 0,
							left: 0,
							right: 0,
							backgroundColor: '#00000088',
						}}
					/>
					<View
						accessibilityViewIsModal
						style={{
							backgroundColor: colors.background,
							borderTopLeftRadius: 24,
							borderTopRightRadius: 24,
							padding: 20,
							paddingBottom: Math.max(bottom, 16),
							maxHeight: '75%',
						}}
					>
						{submenu || title ? (
							<Text
								style={{ color: colors.text, fontSize: 18, fontWeight: '700', marginBottom: 12 }}
							>
								{submenu?.title || title}
							</Text>
						) : null}
						<ScrollView>
							{(submenu?.subactions ?? actions)
								.filter((action) => !action.attributes?.hidden)
								.map((action) => (
									<Pressable
										key={action.id}
										disabled={action.attributes?.disabled}
										accessibilityRole="button"
										accessibilityState={{
											disabled: action.attributes?.disabled,
											selected: action.state === 'on',
										}}
										onPress={() => {
											if (action.subactions?.length) {
												setSubmenu(action)
												return
											}
											close()
											onPressAction({ nativeEvent: { event: action.id } })
										}}
										style={({ pressed }) => ({
											minHeight: 50,
											justifyContent: 'center',
											borderRadius: 10,
											paddingHorizontal: 12,
											backgroundColor: pressed ? colors.surfaceMuted : 'transparent',
											opacity: action.attributes?.disabled ? 0.4 : 1,
										})}
									>
										<Text
											style={{
												color: action.attributes?.destructive
													? '#ef4444'
													: typeof action.titleColor === 'string'
														? action.titleColor
														: colors.text,
												fontSize: 16,
											}}
										>
											{action.title}
											{action.state === 'on' ? ' ✓' : ''}
											{action.subactions?.length ? ' ›' : ''}
										</Text>
									</Pressable>
								))}
						</ScrollView>
						{submenu ? (
							<Pressable onPress={() => setSubmenu(null)} style={{ padding: 14 }}>
								<Text style={{ color: colors.primary, textAlign: 'center' }}>
									‹ {title || i18n.t('player.songOptions')}
								</Text>
							</Pressable>
						) : null}
						<Pressable accessibilityRole="button" onPress={close} style={{ padding: 14 }}>
							<Text style={{ color: colors.textMuted, textAlign: 'center' }}>
								{i18n.t('find.cancel')}
							</Text>
						</Pressable>
					</View>
				</View>
			</Modal>
		</>
	)
}
