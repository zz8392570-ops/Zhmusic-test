import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import { ActivityIndicator, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import type { FlatList as NativeFlatList, FlatListProps } from 'react-native'

import { ThemeColors } from '@/constants/tokens'
import LyricManager from '@/helpers/lyricManager'
import myTrackPlayer from '@/helpers/trackPlayerIndex'
import { useThemeColors } from '@/hooks/useAppTheme'
import useDelayFalsy from '@/hooks/useDelayFalsy'
import PersistStatus from '@/store/PersistStatus'
import { createLyricLayout } from '@/helpers/lyricLayout'
import { musicIsPaused } from '@/utils/trackUtils'
import { useIsPlaying } from '@rntp/player'
import { FlatList } from 'react-native-gesture-handler'
import rpx from '../../utils/rpx'
import LyricItemComponent from './lyricItem'
import i18n from '@/utils/i18n'
const LyricFlatList = FlatList as React.ForwardRefExoticComponent<
	FlatListProps<ILyric.IParsedLrcItem> & React.RefAttributes<NativeFlatList<ILyric.IParsedLrcItem>>
>
const ITEM_HEIGHT = rpx(92)
const AUTO_SCROLL_THROTTLE_MS = 900
const AUTO_SCROLL_MIN_INDEX_DELTA = 2

let nextLayoutKey = 0

interface IProps {
	onTurnPageClick?: () => void
}

const fontSizeMap = {
	0: rpx(24),
	1: rpx(30),
	2: rpx(36),
	3: rpx(42),
} as Record<number, number>

export default function Lyric(_props: IProps) {
	void _props
	const colors = useThemeColors()
	const styles = useMemo(() => createStyles(colors), [colors])
	const { loading, meta, lyrics } = LyricManager.useLyricState()
	const currentLrcItem = LyricManager.useCurrentLyric()
	const fontSizeKey = PersistStatus.useValue('lyric.detailFontSize', 1)
	const fontSizeStyle = useMemo(
		() => ({
			fontSize: fontSizeMap[fontSizeKey ?? 1] ?? fontSizeMap[1],
		}),
		[fontSizeKey],
	)

	const [draggingIndex, setDraggingIndex, resetDraggingIndex] = useDelayFalsy<number | undefined>(
		undefined,
		2000,
	)
	const playing = useIsPlaying()

	const listRef = useRef<NativeFlatList<ILyric.IParsedLrcItem> | null>(null)

	// 是否展示拖拽
	const dragShownRef = useRef(false)

	const { width, fontScale } = useWindowDimensions()
	const layoutScope = useMemo(
		() => ({
			key: `${++nextLayoutKey}:${fontSizeKey}:${width}:${fontScale}`,
			layout: createLyricLayout(lyrics.length, ITEM_HEIGHT),
		}),
		[lyrics, fontSizeKey, width, fontScale],
	)
	const { layout } = layoutScope
	const lastAutoScrollAtRef = useRef(0)
	const lastAutoScrollIndexRef = useRef(-1)
	const retryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

	useEffect(() => {
		dragShownRef.current = false
		resetDraggingIndex(undefined)
		lastAutoScrollAtRef.current = 0
		lastAutoScrollIndexRef.current = -1
		return () => clearTimeout(retryTimerRef.current)
	}, [layout, resetDraggingIndex])

	const blankComponent = useMemo(() => <View style={styles.empty} />, [styles.empty])
	const handleLyricItemLayout = useCallback(
		(index: number, height: number) => {
			layout.setHeight(index, height)
		},
		[layout],
	)

	const clampLyricIndex = useCallback((index: number, listLength: number) => {
		if (listLength <= 0) {
			return 0
		}
		return Math.min(Math.max(index, 0), listLength - 1)
	}, [])

	const scrollToLyricIndex = useCallback(
		(index: number, listLength: number, force = false) => {
			if (!listRef.current || listLength <= 0) {
				return
			}
			const targetIndex = clampLyricIndex(index, listLength)
			const now = Date.now()
			const indexDelta = Math.abs(targetIndex - lastAutoScrollIndexRef.current)
			const shouldSkip =
				!force &&
				now - lastAutoScrollAtRef.current < AUTO_SCROLL_THROTTLE_MS &&
				indexDelta < AUTO_SCROLL_MIN_INDEX_DELTA
			if (shouldSkip) {
				return
			}

			listRef.current.scrollToIndex({
				index: targetIndex,
				viewPosition: 0.5,
			})
			lastAutoScrollAtRef.current = now
			lastAutoScrollIndexRef.current = targetIndex
		},
		[clampLyricIndex],
	)

	// 滚到当前item
	const scrollToCurrentLrcItem = useCallback(() => {
		const lyricState = LyricManager.getLyricState()
		const lyricItems = lyricState.lyrics
		if (lyricItems.length === 0) {
			return
		}
		const currentLrcItem = LyricManager.getCurrentLyric()
		const targetIndex =
			currentLrcItem?.index === -1 || !currentLrcItem ? 0 : currentLrcItem.index ?? 0
		scrollToLyricIndex(targetIndex, lyricItems.length, true)
	}, [scrollToLyricIndex])

	const currentLyricIndex = currentLrcItem?.index
	const lastLyricTime = lyrics[lyrics.length - 1]?.time ?? 0
	useEffect(() => {
		// 暂停且拖拽才返回
		if (
			lyrics.length === 0 ||
			draggingIndex !== undefined ||
			(draggingIndex === undefined && musicIsPaused(playing)) ||
			lastLyricTime < 1
		) {
			return
		}
		const targetIndex =
			currentLyricIndex === -1 || currentLyricIndex == null ? 0 : currentLyricIndex
		scrollToLyricIndex(targetIndex, lyrics.length)
	}, [currentLyricIndex, draggingIndex, lastLyricTime, lyrics.length, playing, scrollToLyricIndex])

	useEffect(() => {
		scrollToCurrentLrcItem()
	}, [layout, scrollToCurrentLrcItem])

	const onScrollBeginDrag = useCallback(() => {
		dragShownRef.current = true
	}, [])

	const onScrollEndDrag = useCallback(async () => {
		if (draggingIndex !== undefined) {
			setDraggingIndex(undefined)
		}
		dragShownRef.current = false
	}, [draggingIndex, setDraggingIndex])

	const onScroll = useCallback(
		(e: any) => {
			if (dragShownRef.current) {
				const offset = e.nativeEvent.contentOffset.y + e.nativeEvent.layoutMeasurement.height / 2

				setDraggingIndex(layout.indexAt(offset))
			}
		},
		[layout, setDraggingIndex],
	)

	const handleLyricItemPress = useCallback(
		async (index: number) => {
			if (index >= 0 && index < lyrics.length) {
				const time = lyrics[index].time + +(meta?.offset ?? 0)
				if (time !== undefined && !isNaN(time)) {
					myTrackPlayer.seekTo(time)
					await myTrackPlayer.play()
				}
			}
		},
		[lyrics, meta?.offset],
	)

	const listHeader = useMemo(
		() => (
			<>
				<View onLayout={(event) => layout.setHeaderHeight(event.nativeEvent.layout.height)}>
					{blankComponent}
					<View style={styles.lyricMeta} />
				</View>
			</>
		),
		[blankComponent, layout, styles.lyricMeta],
	)

	const renderLyricItem = useCallback(
		({ item, index }: { item: ILyric.IParsedLrcItem; index: number }) => {
			return (
				<LyricItemComponent
					index={index}
					text={item.lrc}
					fontSize={fontSizeStyle.fontSize}
					onLayout={handleLyricItemLayout}
					light={draggingIndex === index}
					highlight={currentLrcItem?.index === index}
					onPress={() => handleLyricItemPress(index)}
				/>
			)
		},
		[
			fontSizeStyle.fontSize,
			handleLyricItemLayout,
			draggingIndex,
			currentLrcItem?.index,
			handleLyricItemPress,
		],
	)

	return (
		<>
			<View style={styles.fwflex1}>
				{loading ? (
					<View style={styles.fwflex1}>
						<ActivityIndicator size="large" color={colors.loading} />
					</View>
				) : lyrics?.length ? (
					<LyricFlatList
						key={layoutScope.key}
						ref={(_) => {
							listRef.current = _
						}}
						viewabilityConfig={{
							itemVisiblePercentThreshold: 100,
						}}
						onScrollToIndexFailed={({ index }) => {
							clearTimeout(retryTimerRef.current)
							retryTimerRef.current = setTimeout(() => {
								scrollToLyricIndex(index ?? 0, lyrics.length, true)
							}, 120)
						}}
						fadingEdgeLength={120}
						ListHeaderComponent={listHeader}
						ListFooterComponent={blankComponent}
						onScrollBeginDrag={onScrollBeginDrag}
						onScrollEndDrag={onScrollEndDrag}
						onMomentumScrollEnd={onScrollEndDrag}
						onScroll={onScroll}
						scrollEventThrottle={32}
						style={styles.wrapper}
						data={lyrics}
						initialNumToRender={30}
						overScrollMode="never"
						extraData={currentLrcItem?.index ?? -1}
						getItemLayout={layout.getItemLayout}
						renderItem={renderLyricItem}
					/>
				) : (
					<View style={styles.fullCenter}>
						<Text style={[styles.white, fontSizeStyle]}>{i18n.t('player.noLyrics')}</Text>
					</View>
				)}
			</View>
		</>
	)
}

const createStyles = (colors: ThemeColors) =>
	StyleSheet.create({
		wrapper: {
			width: '100%',
			marginVertical: rpx(48),
			flex: 1,
		},
		fwflex1: {
			width: '100%',
			flex: 1,
		},
		empty: {
			paddingTop: '70%',
		},
		white: {
			color: colors.text,
		},
		lyricMeta: {
			position: 'absolute',
			width: '100%',
			flexDirection: 'row',
			justifyContent: 'center',
			alignItems: 'center',
			left: 0,
			paddingHorizontal: rpx(48),
			bottom: rpx(48),
		},
		lyricMetaText: {
			color: colors.text,
			opacity: 0.8,
			maxWidth: '80%',
		},
		linkText: {
			color: colors.primary,
			textDecorationLine: 'underline',
		},
		fullCenter: {
			width: '100%',
			flex: 1,
			justifyContent: 'center',
			alignItems: 'center',
		},

		singleLine: {
			width: '67%',
			height: 1,
			backgroundColor: colors.separator,
			opacity: 0.4,
		},
		playIcon: {
			width: rpx(90),
			textAlign: 'right',
			color: colors.text,
		},
		searchLyric: {
			width: rpx(180),
			marginTop: rpx(14),
			paddingVertical: rpx(10),
			textAlign: 'center',
			alignSelf: 'center',
			color: colors.primary,
			textDecorationLine: 'underline',
		},
	})
