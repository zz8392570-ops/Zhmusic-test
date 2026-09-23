import { playbackService } from '@/constants/playbackService'
import { AppThemeProvider, useAppTheme } from '@/hooks/useAppTheme'
import LyricManager from '@/helpers/lyricManager'
import { startLxAutoSync } from '@/helpers/sync/lxAutoSync'
import { useLogTrackPlayerState } from '@/hooks/useLogTrackPlayerState'
import { useSetupTrackPlayer } from '@/hooks/useSetupTrackPlayer'
import i18n, { setI18nConfig } from '@/utils/i18n'
import {
	DarkTheme,
	DefaultTheme,
	router,
	SplashScreen,
	Stack,
	ThemeProvider,
	useRootNavigationState,
} from 'expo-router'
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import Toast, { BaseToast, ErrorToast } from 'react-native-toast-message'
import TrackPlayer from '@rntp/player'
SplashScreen.preventAutoHideAsync()

TrackPlayer.registerPlaybackSession(playbackService)
setI18nConfig()
const App = () => {
	const [playerStatus, setPlayerStatus] = useState<'loading' | 'ready' | 'error'>('loading')
	const [playerRetryKey, setPlayerRetryKey] = useState(0)
	const handleTrackPlayerLoaded = useCallback(() => {
		setPlayerStatus('ready')
		void SplashScreen.hideAsync()
	}, [])
	const handleTrackPlayerError = useCallback(() => {
		setPlayerStatus('error')
		void SplashScreen.hideAsync()
	}, [])
	const retryTrackPlayer = useCallback(() => {
		setPlayerStatus('loading')
		setPlayerRetryKey((value) => value + 1)
	}, [])

	useSetupTrackPlayer({
		onLoad: handleTrackPlayerLoaded, //播放器初始化后调用这个回调函数。这里先传过去。
		onError: handleTrackPlayerError,
		retryKey: playerRetryKey,
	})

	useLogTrackPlayerState()
	useEffect(() => {
		void LyricManager.setup()
	}, [])
	useEffect(() => startLxAutoSync(), [])
	return (
		<ShareIntentProvider
			options={{
				debug: true,
				resetOnBackground: false,
				onResetShareIntent: () =>
					// used when app going in background and when the reset button is pressed
					router.replace({
						pathname: '/',
					}),
			}}
		>
			<AppThemeProvider>
				<ThemedAppShell playerStatus={playerStatus} onRetryPlayer={retryTrackPlayer} />
			</AppThemeProvider>
		</ShareIntentProvider>
	)
}

const ThemedAppShell = ({
	playerStatus,
	onRetryPlayer,
}: {
	playerStatus: 'loading' | 'ready' | 'error'
	onRetryPlayer: () => void
}) => {
	const { colors, isDark, statusBarStyle } = useAppTheme()
	const { hasShareIntent } = useShareIntentContext()
	const navigationState = useRootNavigationState()

	useEffect(() => {
		if (navigationState?.key && hasShareIntent) {
			router.replace('/(modals)/zhmusic')
		}
	}, [hasShareIntent, navigationState?.key])

	const toastConfig = useMemo(
		() => ({
			success: (props) => (
				<BaseToast
					{...props}
					style={{
						borderLeftColor: colors.toastAccent,
						backgroundColor: colors.toastBackground,
					}}
					contentContainerStyle={{ paddingHorizontal: 15 }}
					text1Style={{
						fontSize: 15,
						fontWeight: '400',
						color: colors.toastAccent,
					}}
					text2Style={{
						fontSize: 15,
						fontWeight: '400',
						color: colors.toastAccent,
					}}
				/>
			),
			error: (props) => (
				<ErrorToast
					{...props}
					style={{
						borderLeftColor: colors.toastAccent,
						backgroundColor: colors.toastBackground,
					}}
					contentContainerStyle={{ paddingHorizontal: 15 }}
					text1Style={{
						fontSize: 15,
						fontWeight: '400',
						color: colors.toastAccent,
					}}
					text2Style={{
						fontSize: 15,
						fontWeight: '400',
						color: colors.toastAccent,
					}}
				/>
			),
		}),
		[colors],
	)

	return (
		<SafeAreaProvider>
			<GestureHandlerRootView style={{ flex: 1 }}>
				<ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
					{playerStatus === 'ready' ? (
						<RootNavigation />
					) : (
						<View style={[styles.startupContainer, { backgroundColor: colors.background }]}>
							{playerStatus === 'loading' ? (
								<>
									<ActivityIndicator color={colors.primary} size="large" />
									<Text style={[styles.startupMessage, { color: colors.textMuted }]}>
										{i18n.t('startup.preparing')}
									</Text>
								</>
							) : (
								<>
									<Text style={[styles.startupTitle, { color: colors.text }]}>
										{i18n.t('startup.failedTitle')}
									</Text>
									<Text style={[styles.startupMessage, { color: colors.textMuted }]}>
										{i18n.t('startup.failedMessage')}
									</Text>
									<Pressable
										accessibilityRole="button"
										onPress={onRetryPlayer}
										style={({ pressed }) => [
											styles.retryButton,
											{ backgroundColor: colors.primary, opacity: pressed ? 0.72 : 1 },
										]}
									>
										<Text style={styles.retryButtonText}>{i18n.t('startup.retry')}</Text>
									</Pressable>
								</>
							)}
						</View>
					)}
				</ThemeProvider>
				<StatusBar style={statusBarStyle} />
				<Toast config={toastConfig} />
			</GestureHandlerRootView>
		</SafeAreaProvider>
	)
}

const styles = StyleSheet.create({
	startupContainer: {
		alignItems: 'center',
		flex: 1,
		justifyContent: 'center',
		paddingHorizontal: 36,
	},
	startupTitle: {
		fontSize: 22,
		fontWeight: '700',
		marginBottom: 10,
		textAlign: 'center',
	},
	startupMessage: {
		fontSize: 15,
		lineHeight: 22,
		marginTop: 14,
		textAlign: 'center',
	},
	retryButton: {
		borderRadius: 12,
		marginTop: 24,
		paddingHorizontal: 28,
		paddingVertical: 12,
	},
	retryButtonText: {
		color: '#fff',
		fontSize: 16,
		fontWeight: '600',
	},
})

const RootNavigation = () => {
	const { colors } = useAppTheme()

	return (
		//每个 Stack.Screen 组件定义了一个可导航的屏幕
		<Stack>
			<Stack.Screen name="(tabs)" options={{ headerShown: false }} />
			<Stack.Screen
				name="player"
				options={{
					presentation: 'card',
					gestureEnabled: true,
					gestureDirection: 'vertical',
					animationDuration: 400,
					headerShown: false,
				}}
			/>
			<Stack.Screen
				name="(modals)/playList"
				options={{
					presentation: 'modal',
					gestureEnabled: true,
					gestureDirection: 'vertical',
					animationDuration: 400,
					headerShown: false,
				}}
			/>
			<Stack.Screen
				name="(modals)/addToPlaylist"
				options={{
					presentation: 'modal',
					headerStyle: {
						backgroundColor: colors.background,
					},
					headerTitle: i18n.t('addToPlaylist.title'),
					headerTitleStyle: {
						color: colors.text,
					},
				}}
			/>
			<Stack.Screen
				name="(modals)/settingModal"
				options={{
					presentation: 'modal',
					headerShown: false,
					gestureEnabled: true,
					gestureDirection: 'vertical',
				}}
			/>
			<Stack.Screen
				name="(modals)/cacheManager"
				options={{
					presentation: 'card',
					headerTitle: i18n.t('cacheCenter.title'),
					headerStyle: { backgroundColor: colors.background },
					headerTintColor: colors.text,
				}}
			/>
			<Stack.Screen
				name="(modals)/backupManager"
				options={{
					presentation: 'card',
					headerTitle: i18n.t('backup.title'),
					headerStyle: { backgroundColor: colors.background },
					headerTintColor: colors.text,
				}}
			/>
			<Stack.Screen
				name="(modals)/syncManager"
				options={{
					presentation: 'card',
					headerTitle: i18n.t('sync.title'),
					headerStyle: { backgroundColor: colors.background },
					headerTintColor: colors.text,
				}}
			/>
			<Stack.Screen
				name="(modals)/importPlayList"
				options={{
					presentation: 'modal',
					headerShown: false,
					gestureEnabled: true,
					gestureDirection: 'vertical',
				}}
			/>
			<Stack.Screen
				name="(modals)/[name]"
				options={{
					presentation: 'modal',
					headerShown: false,
					gestureEnabled: true,
					gestureDirection: 'vertical',
				}}
			/>
			<Stack.Screen
				name="(modals)/logScreen"
				options={{
					presentation: 'modal',
					headerShown: true,
					gestureEnabled: true,
					gestureDirection: 'vertical',
					headerTitle: '应用日志',
					headerStyle: {
						backgroundColor: colors.background,
					},
					headerTitleStyle: {
						color: colors.text,
					},
				}}
			/>
		</Stack>
	)
}

export default App
