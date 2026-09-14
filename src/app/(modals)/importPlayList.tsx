import SearchPlatformSelector from '@/components/search/SearchPlatformSelector'
import { unknownTrackImageUri } from '@/constants/images'
import { ThemeColors, screenPadding } from '@/constants/tokens'
import type { MusicPlatform } from '@/helpers/crossPlatformSearch'
import { importPlaylistByLink, parsePlaylistInput } from '@/helpers/importPlaylist'
import { logError } from '@/helpers/logger'
import myTrackPlayer from '@/helpers/trackPlayerIndex'
import { useThemeColors } from '@/hooks/useAppTheme'
import { useDefaultStyles } from '@/styles'
import i18n from '@/utils/i18n'
import { Ionicons } from '@expo/vector-icons'
import { useHeaderHeight } from 'expo-router/react-navigation'
import * as ImagePicker from 'expo-image-picker'
import { router } from 'expo-router'
import React, { useMemo, useRef, useState } from 'react'
import {
	ActivityIndicator,
	Image,
	KeyboardAvoidingView,
	Platform,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	TouchableOpacity,
	View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

const ImportPlayList = () => {
	const colors = useThemeColors()
	const defaultStyles = useDefaultStyles()
	const styles = useMemo(() => createStyles(colors, defaultStyles), [colors, defaultStyles])
	const [playlistUrl, setPlaylistUrl] = useState('')
	const [playlistData, setPlaylistData] = useState(null)
	const [isLoading, setIsLoading] = useState(false)
	const [error, setError] = useState(null)
	const [customName, setCustomName] = useState('')
	const [coverImage, setCoverImage] = useState(null)
	const [importSource, setImportSource] = useState<MusicPlatform>('tx')
	const [mode, setMode] = useState<'create' | 'import'>('create')

	const nameInputRef = useRef(null)
	const urlInputRef = useRef(null)

	const headerHeight = useHeaderHeight()
	const { top } = useSafeAreaInsets()

	const pickImage = async () => {
		const result = await ImagePicker.launchImageLibraryAsync({
			mediaTypes: ImagePicker.MediaTypeOptions.Images,
			allowsEditing: true,
			aspect: [1, 1],
			quality: 1,
		})

		if (!result.canceled) {
			setCoverImage(result.assets[0].uri)
		}
	}

	const handleCreatePlaylist = async () => {
		if (!customName.trim()) {
			setError(i18n.t('playlistManager.nameRequired'))
			return
		}
		setIsLoading(true)
		setError(null)
		console.log('coverImage', coverImage)
		try {
			const newPlaylist = {
				id: Date.now().toString(),
				platform: 'QQ',
				artist: '未知歌手',
				name: customName.trim(),
				title: customName.trim(),
				songs: [],
				artwork: coverImage || unknownTrackImageUri,
				tracks: [],
			}
			const result = await myTrackPlayer.addPlayLists(newPlaylist as IMusic.PlayList)
			if (result !== 'success') throw new Error(result)
			router.dismiss()
		} catch (err) {
			setError(i18n.t('playlistManager.createFailed'))
			logError('创建错误:', err)
		} finally {
			setIsLoading(false)
		}
	}

	const handlePlaylistUrlChange = (value: string) => {
		setPlaylistUrl(value)
		const parsed = parsePlaylistInput(value)
		if (parsed) setImportSource(parsed.source)
	}

	const handleImport = async () => {
		setIsLoading(true)
		setError(null)
		try {
			if (!playlistUrl.trim()) throw new Error('empty')
			const playlist = await importPlaylistByLink(playlistUrl, importSource)
			if (!playlist?.songs?.length) throw new Error('empty playlist')
			setPlaylistData(playlist)
			const result = myTrackPlayer.addPlayLists(playlist)
			if (result === 'duplicate') throw new Error('duplicate playlist')
			if (result !== 'success') throw new Error('save playlist failed')
			router.dismiss()
		} catch (err) {
			const message = err instanceof Error ? err.message : ''
			setError(
				message === 'unrecognized playlist link'
					? i18n.t('addToPlaylist.invalidLink')
					: i18n.t('addToPlaylist.failed'),
			)
			logError('导入错误:', err)
		} finally {
			setIsLoading(false)
		}
	}

	const DismissPlayerSymbol = () => (
		<View style={[styles.dismissSymbol, { top: top - 25 }]}>
			<View style={styles.dismissBar} />
		</View>
	)

	return (
		<SafeAreaView style={[styles.modalContainer, { paddingTop: headerHeight }]}>
			<DismissPlayerSymbol />
			<KeyboardAvoidingView
				behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
				style={{ flex: 1 }}
			>
				<ScrollView
					showsVerticalScrollIndicator={false}
					contentContainerStyle={{ flexGrow: 1 }}
					keyboardShouldPersistTaps="handled"
				>
					<Text style={styles.header}>{i18n.t('playlistManager.title')}</Text>
					<View style={styles.modeTabs}>
						{(['create', 'import'] as const).map((item) => (
							<TouchableOpacity
								key={item}
								accessibilityRole="tab"
								accessibilityState={{ selected: mode === item }}
								onPress={() => {
									setMode(item)
									setError(null)
								}}
								style={[styles.modeTab, mode === item && styles.modeTabActive]}
							>
								<Text style={[styles.modeTabText, mode === item && styles.modeTabTextActive]}>
									{i18n.t(`playlistManager.${item}`)}
								</Text>
							</TouchableOpacity>
						))}
					</View>

					{mode === 'create' ? (
						<View style={styles.section}>
							<Text style={styles.sectionTitle}>{i18n.t('playlistManager.createTitle')}</Text>
							<View style={styles.createPlaylistCard}>
								<View style={styles.createPlaylistContainer}>
									<View style={styles.coverContainer}>
										<TouchableOpacity onPress={pickImage} style={styles.coverPicker}>
											{coverImage ? (
												<Image source={{ uri: coverImage }} style={styles.coverImage} />
											) : (
												<View style={styles.coverPlaceholder}>
													<Ionicons name="image-outline" size={24} color={colors.primary} />
													<Text style={styles.coverText}>
														{i18n.t('playlistManager.chooseCover')}
													</Text>
												</View>
											)}
										</TouchableOpacity>
									</View>

									<View style={styles.playlistInfoContainer}>
										<View style={[styles.inputContainer, { marginBottom: 0 }]}>
											<TextInput
												ref={nameInputRef}
												style={styles.input}
												value={customName}
												onChangeText={setCustomName}
												placeholder={i18n.t('playlistManager.namePlaceholder')}
												placeholderTextColor={colors.placeholder}
												autoCapitalize="none"
												autoCorrect={false}
												keyboardType="default"
												returnKeyType="done"
												blurOnSubmit={true}
												onSubmitEditing={() => nameInputRef.current?.blur()}
												enablesReturnKeyAutomatically={true}
												clearButtonMode="while-editing"
											/>
										</View>
									</View>
								</View>

								<TouchableOpacity
									onPress={handleCreatePlaylist}
									activeOpacity={0.8}
									style={styles.button}
									disabled={isLoading}
								>
									{isLoading ? (
										<ActivityIndicator color={colors.loading} />
									) : (
										<>
											<Ionicons name="add-circle-outline" size={24} color={colors.primary} />
											<Text style={styles.buttonText}>
												{i18n.t('playlistManager.createButton')}
											</Text>
										</>
									)}
								</TouchableOpacity>
							</View>
						</View>
					) : (
						<View style={styles.section}>
							<Text style={styles.sectionTitle}>{i18n.t('playlistManager.importTitle')}</Text>
							<Text style={styles.hint}>{i18n.t('addToPlaylist.hint')}</Text>
							<View style={styles.platformSelector}>
								<SearchPlatformSelector
									includeAll={false}
									inset={0}
									value={importSource}
									onChange={(platform) => setImportSource(platform as MusicPlatform)}
								/>
							</View>
							<View style={styles.createPlaylistCard}>
								<View style={styles.importContainer}>
									<TextInput
										ref={urlInputRef}
										style={styles.input}
										value={playlistUrl}
										onChangeText={handlePlaylistUrlChange}
										placeholder={i18n.t('addToPlaylist.placeholder')}
										placeholderTextColor={colors.placeholder}
										autoCapitalize="none"
										autoCorrect={false}
										keyboardType="url"
										returnKeyType="done"
										blurOnSubmit={true}
										onSubmitEditing={() => urlInputRef.current?.blur()}
										enablesReturnKeyAutomatically={true}
										clearButtonMode="while-editing"
									/>
								</View>

								<TouchableOpacity
									onPress={handleImport}
									activeOpacity={0.8}
									style={styles.button}
									disabled={isLoading}
								>
									{isLoading ? (
										<ActivityIndicator color={colors.loading} />
									) : (
										<>
											<Ionicons name="cloud-download-outline" size={24} color={colors.primary} />
											<Text style={styles.buttonText}>
												{i18n.t('playlistManager.importButton')}
											</Text>
										</>
									)}
								</TouchableOpacity>
							</View>
						</View>
					)}

					{error && <Text style={styles.error}>{error}</Text>}
					{playlistData && (
						<Text style={styles.successText}>
							{i18n.t('playlistManager.imported', { name: playlistData.name })}
						</Text>
					)}
				</ScrollView>
			</KeyboardAvoidingView>
		</SafeAreaView>
	)
}

const createStyles = (colors: ThemeColors, defaultStyles: ReturnType<typeof useDefaultStyles>) =>
	StyleSheet.create({
		modalContainer: {
			...defaultStyles.container,
			paddingHorizontal: screenPadding.horizontal,
		},
		section: {
			marginBottom: 24,
		},
		modeTabs: {
			backgroundColor: colors.surfaceMuted,
			borderRadius: 12,
			flexDirection: 'row',
			marginBottom: 24,
			padding: 3,
		},
		modeTab: {
			alignItems: 'center',
			borderRadius: 9,
			flex: 1,
			paddingVertical: 9,
		},
		modeTabActive: {
			backgroundColor: colors.surfaceElevated,
		},
		modeTabText: {
			color: colors.textMuted,
			fontSize: 15,
			fontWeight: '600',
		},
		modeTabTextActive: {
			color: colors.text,
		},
		sectionTitle: {
			fontSize: 20,
			fontWeight: '600',
			color: colors.text,
			marginBottom: 16,
		},
		hint: {
			fontSize: 13,
			color: colors.textMuted,
			marginTop: -8,
			marginBottom: 12,
		},
		platformSelector: {
			marginBottom: 12,
		},
		divider: {
			height: 1,
			backgroundColor: colors.separator,
			marginVertical: 24,
		},
		buttonContainer: {
			marginTop: 0,
		},
		dismissSymbol: {
			position: 'absolute',
			left: 0,
			right: 0,
			flexDirection: 'row',
			justifyContent: 'center',
			zIndex: 1,
		},
		dismissBar: {
			width: 50,
			height: 5,
			borderRadius: 2.5,
			backgroundColor: colors.dismissBar,
		},
		inputContainer: {
			width: '100%',
		},
		inputLabel: {
			fontSize: 16,
			fontWeight: '600',
			color: colors.text,
			marginBottom: 8,
		},
		header: {
			fontSize: 31,
			fontWeight: 'bold',
			padding: 0,
			paddingTop: 5,
			marginBottom: 24,
			color: colors.text,
		},
		input: {
			height: 44,
			backgroundColor: colors.surfaceMuted,
			borderRadius: 8,
			paddingHorizontal: 16,
			fontSize: 16,
			color: colors.text,
			width: '100%',
		},
		coverContainer: {
			width: 100,
		},
		coverPicker: {
			width: 100,
			height: 100,
			borderRadius: 8,
			overflow: 'hidden',
			backgroundColor: colors.surfaceMuted,
			justifyContent: 'center',
			alignItems: 'center',
		},
		coverImage: {
			width: '100%',
			height: '100%',
			resizeMode: 'cover',
		},
		coverPlaceholder: {
			width: '100%',
			height: '100%',
			justifyContent: 'center',
			alignItems: 'center',
		},
		coverText: {
			color: colors.primary,
			marginTop: 8,
			fontSize: 14,
		},
		error: {
			color: colors.error,
			marginTop: 10,
		},
		successText: {
			color: colors.success,
			marginTop: 10,
		},
		button: {
			padding: 12,
			backgroundColor: colors.surfaceMuted,
			borderRadius: 8,
			flexDirection: 'row',
			justifyContent: 'center',
			alignItems: 'center',
			columnGap: 8,
			width: '100%',
		},
		buttonText: {
			...defaultStyles.text,
			color: colors.primary,
			fontWeight: '600',
			fontSize: 18,
			textAlign: 'center',
		},
		createPlaylistCard: {
			backgroundColor: colors.surface,
			borderRadius: 12,
			padding: 16,
			gap: 16,
		},
		createPlaylistContainer: {
			flexDirection: 'row',
			alignItems: 'center',
			columnGap: 16,
		},
		playlistInfoContainer: {
			flex: 1,
			height: 100,
			justifyContent: 'center',
		},
		importContainer: {
			width: '100%',
		},
	})

export default ImportPlayList
