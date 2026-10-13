import DiscoveryHeading from '@/components/DiscoveryHeading'
import { MenuView } from '@/components/ActionMenu'
import { importPlaylistByLink } from '@/helpers/importPlaylist'
import myTrackPlayer from '@/helpers/trackPlayerIndex'
import SearchPlatformSelector from '@/components/search/SearchPlatformSelector'
import { screenPadding } from '@/constants/tokens'
import type { MusicPlatform } from '@/helpers/crossPlatformSearch'
import { DEFAULT_HOME_SOURCE, normalizeLeaderboardSource } from '@/helpers/leaderboard'
import {
	getPublicPlaylistCategories,
	getPublicPlaylists,
	type PublicPlaylist,
	type PublicPlaylistCategory,
} from '@/helpers/publicPlaylists'
import { useThemeColors } from '@/hooks/useAppTheme'
import PersistStatus from '@/store/PersistStatus'
import { useDefaultStyles } from '@/styles'
import i18n from '@/utils/i18n'
import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
	ActivityIndicator,
	Alert,
	FlatList,
	Pressable,
	RefreshControl,
	ScrollView,
	Text,
	View,
} from 'react-native'

const PublicPlaylistCard = ({ item, onPress }: { item: PublicPlaylist; onPress: () => void }) => {
	const colors = useThemeColors()
	const platformColor = {
		tx: '#31c27c',
		wy: '#fc3c44',
		kg: '#2999ef',
		kw: '#e7b83b',
		mg: '#ec398a',
	}[item.source]
	const save = async () => {
		try {
			const playlist = await importPlaylistByLink(item.id, item.source)
			const result = myTrackPlayer.addPlayLists(playlist)
			Alert.alert(
				i18n.t(
					result === 'success'
						? 'publicPlaylists.importedTitle'
						: result === 'duplicate'
							? 'publicPlaylists.alreadyImportedTitle'
							: 'publicPlaylists.importFailedTitle',
				),
			)
		} catch {
			Alert.alert(i18n.t('publicPlaylists.importFailedTitle'))
		}
	}
	return (
		<View style={{ flex: 1, minWidth: 0 }}>
			<Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}>
				<Image
					source={{ uri: item.artwork }}
					contentFit="cover"
					transition={180}
					style={{
						width: '100%',
						aspectRatio: 1.1,
						borderRadius: 14,
						backgroundColor: colors.surface,
					}}
				/>
				{item.playCount ? (
					<View
						style={{
							position: 'absolute',
							bottom: 9,
							left: 9,
							flexDirection: 'row',
							alignItems: 'center',
							gap: 4,
							paddingHorizontal: 9,
							paddingVertical: 4,
							borderRadius: 12,
							backgroundColor: colors.overlay,
						}}
					>
						<Ionicons name="play" size={12} color="#fff" />
						<Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>{item.playCount}</Text>
					</View>
				) : null}
			</Pressable>
			<View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 }}>
				<Pressable onPress={onPress} style={{ flex: 1, minWidth: 0 }}>
					<Text
						numberOfLines={2}
						style={{ color: colors.text, fontSize: 15, lineHeight: 21, fontWeight: '700' }}
					>
						{item.name}
					</Text>
					<View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 }}>
						<View
							style={{
								width: 18,
								height: 18,
								borderRadius: 9,
								backgroundColor: platformColor,
								alignItems: 'center',
								justifyContent: 'center',
							}}
						>
							<Ionicons name="musical-note" size={11} color="#fff" />
						</View>
						<Text numberOfLines={1} style={{ color: colors.textMuted, fontSize: 12, flex: 1 }}>
							{i18n.t(`publicPlaylists.platformNames.${item.source}`)}
						</Text>
					</View>
				</Pressable>
				<MenuView
					title={item.name}
					actions={[
						{ id: 'open', title: i18n.t('library.openPlaylist') },
						{ id: 'save', title: i18n.t('publicPlaylists.savePlaylist') },
					]}
					onPressAction={({ nativeEvent: { event } }) =>
						event === 'open' ? onPress() : void save()
					}
				>
					<Pressable
						accessibilityLabel={i18n.t('playlistTools.title')}
						style={{ width: 24, minHeight: 40, alignItems: 'center', justifyContent: 'center' }}
					>
						<Ionicons name="ellipsis-vertical" size={19} color={colors.textMuted} />
					</Pressable>
				</MenuView>
			</View>
		</View>
	)
}

const RadiolistsScreen = () => {
	const defaultStyles = useDefaultStyles()
	const colors = useThemeColors()
	const router = useRouter()
	const source = normalizeLeaderboardSource(
		PersistStatus.useValue('music.radioBoardSource', DEFAULT_HOME_SOURCE) ?? DEFAULT_HOME_SOURCE,
	)
	const categorySelections = PersistStatus.useValue('music.publicPlaylistCategories', {}) ?? {}
	const categoryId = categorySelections[source] ?? ''
	const [categories, setCategories] = useState<PublicPlaylistCategory[]>([])
	const [playlists, setPlaylists] = useState<PublicPlaylist[]>([])
	const [loading, setLoading] = useState(true)
	const [loadingMore, setLoadingMore] = useState(false)
	const [failed, setFailed] = useState(false)
	const [hasMore, setHasMore] = useState(false)
	const [page, setPage] = useState(1)
	const requestRef = useRef(0)

	useEffect(() => {
		let active = true
		setCategories([])
		void getPublicPlaylistCategories(source).then((items) => {
			if (!active) return
			setCategories(items)
			const stored = PersistStatus.get('music.publicPlaylistCategories') ?? {}
			if (stored[source] && !items.some((item) => item.id === stored[source])) {
				PersistStatus.set('music.publicPlaylistCategories', { ...stored, [source]: '' })
			}
		})
		return () => {
			active = false
		}
	}, [source])

	const loadFirstPage = useCallback(async () => {
		const requestId = ++requestRef.current
		setLoading(true)
		setFailed(false)
		try {
			const result = await getPublicPlaylists(source, categoryId, 1)
			if (requestId !== requestRef.current) return
			setPlaylists(result.list)
			setPage(1)
			setHasMore(result.hasMore)
			setFailed(result.list.length === 0)
		} catch (error) {
			console.error('Failed to fetch public playlists:', error)
			if (requestId === requestRef.current) {
				setPlaylists([])
				setFailed(true)
			}
		} finally {
			if (requestId === requestRef.current) setLoading(false)
		}
	}, [categoryId, source])

	useEffect(() => {
		setPlaylists([])
		setLoadingMore(false)
		void loadFirstPage()
		return () => {
			requestRef.current += 1
		}
	}, [loadFirstPage])

	const loadMore = useCallback(async () => {
		if (loading || loadingMore || !hasMore) return
		const requestId = requestRef.current
		setLoadingMore(true)
		try {
			const nextPage = page + 1
			const result = await getPublicPlaylists(source, categoryId, nextPage)
			if (requestId !== requestRef.current) return
			setPlaylists((current) => {
				const existing = new Set(current.map((item) => item.id))
				return [...current, ...result.list.filter((item) => !existing.has(item.id))]
			})
			setPage(nextPage)
			setHasMore(result.hasMore)
		} catch (error) {
			console.error('Failed to load more public playlists:', error)
		} finally {
			if (requestId === requestRef.current) setLoadingMore(false)
		}
	}, [categoryId, hasMore, loading, loadingMore, page, source])

	const changeBatch = async () => {
		if (loading || loadingMore) return
		const requestId = ++requestRef.current
		setLoading(true)
		try {
			const next = hasMore ? page + 1 : 1
			const result = await getPublicPlaylists(source, categoryId, next)
			if (requestId !== requestRef.current) return
			setPlaylists(result.list)
			setPage(next)
			setHasMore(result.hasMore)
		} catch (error) {
			console.error('Failed to change playlist batch:', error)
		} finally {
			if (requestId === requestRef.current) setLoading(false)
		}
	}

	const selectCategory = (nextCategory: string) => {
		PersistStatus.set('music.publicPlaylistCategories', {
			...categorySelections,
			[source]: nextCategory,
		})
	}

	const openPlaylist = (playlist: PublicPlaylist) => {
		router.push({
			pathname: '/(tabs)/radio/[name]',
			params: {
				name: playlist.id,
				source: playlist.source,
				title: playlist.name,
				artwork: playlist.artwork,
				author: playlist.author,
				playCount: playlist.playCount,
				description: playlist.description || '',
			},
		})
	}

	return (
		<View style={[defaultStyles.container, { backgroundColor: colors.background }]}>
			<DiscoveryHeading
				large
				title={i18n.t('appTab.radio')}
				action={
					<Pressable
						onPress={() =>
							Alert.alert(i18n.t('publicPlaylists.categories'), undefined, [
								...categories.map((category) => ({
									text: category.name,
									onPress: () => selectCategory(category.id),
								})),
								{ text: i18n.t('find.cancel'), style: 'cancel' },
							])
						}
						accessibilityLabel={i18n.t('publicPlaylists.categories')}
						style={{ padding: 8 }}
					>
						<Ionicons name="funnel-outline" size={26} color={colors.textMuted} />
					</Pressable>
				}
			/>
			<SearchPlatformSelector
				includeAll={false}
				inset={screenPadding.horizontal}
				value={source}
				onChange={(platform) => {
					PersistStatus.set('music.radioBoardSource', platform as MusicPlatform)
				}}
			/>
			<ScrollView
				horizontal
				showsHorizontalScrollIndicator={false}
				contentContainerStyle={{
					paddingHorizontal: screenPadding.horizontal,
					paddingTop: 2,
					paddingBottom: 4,
					gap: 8,
				}}
				style={{ flexGrow: 0, flexShrink: 0, height: 46 }}
			>
				{categories.map((category) => {
					const selected = category.id === categoryId
					return (
						<Pressable
							key={category.id || 'recommended'}
							onPress={() => selectCategory(category.id)}
							style={{
								paddingHorizontal: 15,
								paddingVertical: 6,
								minHeight: 34,
								justifyContent: 'center',
								borderRadius: 18,
								backgroundColor: selected ? colors.primary : colors.surfaceMuted,
							}}
						>
							<Text
								style={{
									color: selected ? '#fff' : colors.textMuted,
									fontSize: 14,
									lineHeight: 20,
									fontWeight: '600',
								}}
							>
								{category.name}
							</Text>
						</Pressable>
					)
				})}
			</ScrollView>

			{failed && !playlists.length ? (
				<View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
					<Text style={{ color: colors.textMuted, fontSize: 16 }}>
						{i18n.t('publicPlaylists.loadFailed')}
					</Text>
					<Pressable
						onPress={() => void loadFirstPage()}
						style={{ paddingHorizontal: 20, paddingVertical: 12 }}
					>
						<Text style={{ color: colors.primary, fontSize: 15, fontWeight: '600' }}>
							{i18n.t('home.retry')}
						</Text>
					</Pressable>
				</View>
			) : (
				<FlatList
					ListHeaderComponent={
						<View
							style={{
								flexDirection: 'row',
								alignItems: 'center',
								justifyContent: 'space-between',
								paddingBottom: 6,
							}}
						>
							<Text style={{ color: colors.text, fontSize: 23, fontWeight: '800' }}>
								{i18n.t('publicPlaylists.hot')}
							</Text>
							<Pressable
								onPress={() => void changeBatch()}
								disabled={loading || loadingMore}
								style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 8 }}
							>
								<Ionicons name="refresh-outline" size={17} color={colors.textMuted} />
								<Text style={{ color: colors.textMuted, fontSize: 14 }}>
									{i18n.t('find.changeBatch')}
								</Text>
							</Pressable>
						</View>
					}
					data={playlists}
					numColumns={2}
					keyExtractor={(item) => `${item.source}_${item.id}`}
					renderItem={({ item }) => (
						<PublicPlaylistCard item={item} onPress={() => openPlaylist(item)} />
					)}
					columnWrapperStyle={{ gap: 14, marginBottom: 18 }}
					contentContainerStyle={{
						paddingHorizontal: screenPadding.horizontal,
						paddingTop: 4,
						paddingBottom: 150,
					}}
					refreshControl={
						<RefreshControl
							refreshing={loading}
							onRefresh={loadFirstPage}
							tintColor={colors.primary}
						/>
					}
					onEndReached={() => void loadMore()}
					onEndReachedThreshold={0.45}
					ListEmptyComponent={
						loading ? (
							<View style={{ paddingVertical: 100 }}>
								<ActivityIndicator size="large" color={colors.loading} />
							</View>
						) : null
					}
					ListFooterComponent={
						loadingMore ? (
							<ActivityIndicator color={colors.loading} style={{ marginVertical: 22 }} />
						) : null
					}
				/>
			)}
		</View>
	)
}

export default RadiolistsScreen
