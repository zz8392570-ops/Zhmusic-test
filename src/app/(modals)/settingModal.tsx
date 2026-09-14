// src/app/modals/settingModal.tsx
import appIcon from '@/assets/144.png'
import { ThemeColors } from '@/constants/tokens'
import { logError, logInfo } from '@/helpers/logger'
import myTrackPlayer, {
	autoCacheLocalStore,
	autoCacheWifiOnlyStore,
	isCachedIconVisibleStore,
	musicApiSelectedStore,
	musicApiStore,
	songsNumsToLoadStore,
	useCurrentQuality,
} from '@/helpers/trackPlayerIndex'
import { useThemeColors, useThemeMode } from '@/hooks/useAppTheme'
import { createMusicApiFromScript, fetchScriptFromUrl } from '@/helpers/userApi/importMusicSource'
import PersistStatus from '@/store/PersistStatus'
import {
	DEFAULT_HOME_BOARD_ID,
	DEFAULT_HOME_SOURCE,
	normalizeLeaderboardSource,
	setHomeLeaderboard,
} from '@/helpers/leaderboard'
import { getHomeBoardName, getHomeBoards } from '@/store/library'
import i18n, { changeLanguage, nowLanguage } from '@/utils/i18n'
import { GlobalState } from '@/utils/stateMapper'
import { showToast } from '@/utils/utils'
import MusicSourceHealthList from '@/components/MusicSourceHealthList'
import { MenuView } from '@react-native-menu/menu'
import Constants from 'expo-constants'
import * as DocumentPicker from 'expo-document-picker'
import { File } from 'expo-file-system'
import { useRouter } from 'expo-router'
import React, { useEffect, useMemo, useState } from 'react'
import {
	ActivityIndicator,
	Alert,
	Image,
	type ImageSourcePropType,
	Linking,
	Platform,
	ScrollView,
	StyleSheet,
	Switch,
	Text,
	TouchableOpacity,
	View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
const QUALITY_OPTIONS = ['128k', '320k', 'flac']
const CURRENT_VERSION = Constants.expoConfig?.version ?? '未知版本'

type SettingItemBase = {
	id: string
	title: string
	icon?: ImageSourcePropType
}

type SettingSwitchItem = {
	type: 'switch'
	value: boolean
	description: string
	onValueChange: (value: boolean) => void
}

type SettingActionItem = {
	type: 'link' | 'value' | 'custom' | 'sources'
	value?: string
}

type SettingItem = SettingItemBase & (SettingSwitchItem | SettingActionItem)

// 将GlobalState实例移到组件外部
const cooldownStore = new GlobalState<number>(0) // 冷却时间（秒）
const sourceStatusStore = new GlobalState<
	Record<string, { status: string; error?: string; url?: string }>
>({}) // 音源状态存储

// eslint-disable-next-line react/prop-types
const MusicQualityMenu = ({ currentQuality, onSelectQuality }) => {
	const colors = useThemeColors()
	const styles = useMemo(() => createStyles(colors), [colors])

	const handlePressAction = async (id: string) => {
		if (QUALITY_OPTIONS.includes(id)) {
			onSelectQuality(id)
		}
	}

	return (
		<MenuView
			onPressAction={({ nativeEvent: { event } }) => handlePressAction(event)}
			actions={QUALITY_OPTIONS.map((quality) => ({
				id: quality,
				title: quality,
				state: currentQuality === quality ? 'on' : 'off',
			}))}
		>
			<TouchableOpacity style={styles.menuTrigger}>
				<Text style={styles.menuTriggerText}>{currentQuality}</Text>
			</TouchableOpacity>
		</MenuView>
	)
}
// eslint-disable-next-line react/prop-types
const MusicSourceMenu = ({ isDelete, onSelectSource }) => {
	const colors = useThemeColors()
	const styles = useMemo(() => createStyles(colors), [colors])
	const [sources, setSources] = useState([])
	const [isLoading, setIsLoading] = useState(false) // 测试状态
	const cooldown = cooldownStore.useValue() // 使用useValue获取当前值
	const sourceStatus = sourceStatusStore.useValue() // 使用GlobalState获取音源状态
	const selectedApi = musicApiSelectedStore.useValue()
	const musicApis = musicApiStore.useValue()

	useEffect(() => {
		if (musicApis && Array.isArray(musicApis)) {
			setSources(
				musicApis.map((api) => ({
					id: api.id,
					title: api.name,
				})),
			)
		} else {
			setSources([]) // 如果 musicApis 不是有效数组，设置为空数组
		}
	}, [musicApis])
	useEffect(() => {
		cooldownStore.setValue(0)
	}, [])
	// 处理倒计时
	useEffect(() => {
		let timer
		if (cooldown > 0) {
			timer = setTimeout(() => {
				cooldownStore.setValue(cooldown - 1)
			}, 1000)
		}
		return () => clearTimeout(timer)
	}, [cooldown])

	// 测试单个音源是否可用
	const testMusicSource = async (musicApi) => {
		try {
			logInfo(`开始测试音源: ${musicApi.name}, ID: ${musicApi.id}`)

			// 检查musicApi.getMusicUrl是否存在且为函数
			if (typeof musicApi.getMusicUrl !== 'function') {
				logError(`音源 ${musicApi.name} 的 getMusicUrl 不是函数或不存在`, musicApi)
				return { status: '异常', error: 'getMusicUrl 方法不可用' }
			}

			// 设置超时
			const timeoutPromise = new Promise((_, reject) => {
				setTimeout(() => reject(new Error('请求超时')), 5000)
			})
			logInfo(
				`测试音源详情:`,
				JSON.stringify({
					name: musicApi.name,
					id: musicApi.id,
					author: musicApi.author,
					version: musicApi.version,
				}),
			)

			// 尝试获取测试歌曲URL
			// 这里使用了固定的测试歌曲信息，可以根据实际需求修改
			const testTitle = '稻香'
			const testArtist = '周杰伦'
			const testId = '004IArbh3ytHgR'

			logInfo(`测试歌曲信息: ${testTitle} - ${testArtist}, ID: ${testId}`)

			// 按音质降级尝试
			const qualityOrder = ['128k']

			for (const quality of qualityOrder) {
				try {
					logInfo(`尝试获取音源 ${musicApi.name} 的 ${quality} 音质`)

					// 记录函数调用前的参数
					logInfo(
						`调用 getMusicUrl 参数: title=${testTitle}, artist=${testArtist}, id=${testId}, quality=${quality}`,
					)

					const resp_url = await Promise.race([
						musicApi.getMusicUrl(testTitle, testArtist, testId, quality),
						timeoutPromise,
					])

					// 记录返回值
					logInfo(`音源 ${musicApi.name} 返回结果: ${resp_url}`)

					if (resp_url && resp_url !== '') {
						// 找到可用音源
						logInfo(`音源 ${musicApi.name} 测试成功，音质: ${quality}, URL: ${resp_url}`)
						return { status: '正常', url: resp_url }
					} else {
						logInfo(`音源 ${musicApi.name} 返回空URL，音质: ${quality}`)
					}
				} catch (err) {
					// 继续尝试下一个音质
					logError(`测试音源 ${musicApi.name} ${quality} 音质失败:`, err)
					logInfo(`错误详情: ${err.message || '未知错误'}`)
					// 尝试打印错误堆栈
					if (err.stack) {
						logInfo(`错误堆栈: ${err.stack}`)
					}
				}
			}

			// 所有音质都尝试失败
			logInfo(`音源 ${musicApi.name} 所有音质测试均失败`)
			return { status: '异常', error: '无法获取音乐URL' }
		} catch (error) {
			logError(`测试音源 ${musicApi?.name || '未知'} 时发生异常:`, error)
			if (error.stack) {
				logInfo(`异常错误堆栈: ${error.stack}`)
			}
			return {
				status: '异常',
				error: error.message === '请求超时' ? '请求超时' : error.message || '未知错误',
			}
		}
	}

	// 测试所有音源状态
	const testAllSources = async () => {
		if (!musicApis || !Array.isArray(musicApis) || musicApis.length === 0) {
			logInfo('没有可用的音源可测试')
			return
		}

		logInfo(`开始测试所有音源，共 ${musicApis.length} 个`)
		setIsLoading(true)
		const statusResults = { ...sourceStatus } // 复制当前状态作为基础

		for (const api of musicApis) {
			logInfo(`开始测试音源: ${api.name}`)
			statusResults[api.id] = { status: '测试中...' }
			sourceStatusStore.setValue({ ...statusResults }) // 更新到GlobalState
			const reloadedApi = await myTrackPlayer.reloadMusicApi(api, true)
			const result = await testMusicSource(reloadedApi)
			statusResults[api.id] = result
			sourceStatusStore.setValue({ ...statusResults }) // 更新到GlobalState
			logInfo(`音源 ${api.name} 测试结果: ${result.status}`)
		}

		logInfo('所有音源测试完成')
		// 设置60秒冷却时间
		cooldownStore.setValue(60)
		setIsLoading(false)
	}

	const handlePressAction = async (id: string) => {
		// 如果点击的是测试音源按钮，则不关闭菜单并触发测试
		if (id === 'test_sources') {
			// 如果在冷却中，不执行操作
			if (cooldown > 0) return
			testAllSources()
			return
		}
		// 否则执行正常的音源选择逻辑
		onSelectSource(id)
	}

	// 获取状态对应的图标/文本
	const getStatusIndicator = (sourceId) => {
		if (!sourceStatus[sourceId]) {
			return ''
		}

		switch (sourceStatus[sourceId].status) {
			case '正常':
				return ' ✅'
			case '异常':
				return ' ❌'
			case '测试中...':
				return ' 🔄'
			default:
				return ''
		}
	}

	// 格式化倒计时显示
	const formatCooldown = () => {
		const minutes = Math.floor(cooldown / 60)
		const seconds = cooldown % 60
		return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`
	}

	// 创建音源列表actions
	const sourceActions = sources.map((source) => ({
		id: source.id,
		title: isDelete
			? `${i18n.t('settings.actions.delete.delete')} ${source.title}`
			: `${source.title}${getStatusIndicator(source.id)}`,
		state: isDelete ? 'off' : selectedApi && selectedApi.id === source.id ? 'on' : 'off',
		attributes: isDelete ? { destructive: true, disabled: false } : undefined,
	}))

	// 添加测试音源的按钮（仅在非删除模式下）
	if (!isDelete) {
		sourceActions.push({
			id: 'test_sources',
			title: isLoading
				? '测试中...'
				: cooldown > 0
					? `请勿频繁测试 ${formatCooldown()} `
					: i18n.t('settings.items.testSources') || '测试所有音源',
			attributes: cooldown > 0 || isLoading ? { destructive: false, disabled: true } : undefined,
			state: 'off',
		})
	}

	return (
		<MenuView
			onPressAction={({ nativeEvent: { event } }) => handlePressAction(event)}
			actions={sourceActions as any}
		>
			<TouchableOpacity style={[styles.menuTrigger]}>
				<Text style={[styles.menuTriggerText]}>
					{isDelete
						? i18n.t('settings.actions.delete.selectDelete')
						: selectedApi
							? `${selectedApi.name}`
							: i18n.t('settings.items.selectSource')}
				</Text>
			</TouchableOpacity>
		</MenuView>
	)
}

const importMusicSourceFromUrl = async () => {
	Alert.prompt(
		'导入音源',
		'请输入音源 URL',
		[
			{
				text: '取消',
				onPress: () => logInfo('取消导入'),
				style: 'cancel',
			},
			{
				text: '确定',
				onPress: async (url) => {
					if (!url) {
						Alert.alert('错误', 'URL 不能为空')
						return
					}

					try {
						const sourceCode = await fetchScriptFromUrl(url)
						logInfo('获取到的源代码:', sourceCode)
						const musicApi = await createMusicApiFromScript(sourceCode)
						myTrackPlayer.addMusicApi(musicApi)
						return
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error)
						logError('导入音源失败:', errMsg)
						Alert.alert('错误', `导入音源失败: ${errMsg}`)
					}
				},
			},
		],
		'plain-text',
	)
}
const importMusicSourceFromFile = async () => {
	try {
		const result = await DocumentPicker.getDocumentAsync({
			type: 'text/javascript',
			copyToCacheDirectory: false,
		})

		if (result.canceled === true) {
			logInfo('User canceled document picker')
			return
		}

		// logInfo('File selected:', result.assets[0].uri)
		const fileContents = await new File(result.assets[0].uri).text()
		logInfo('File contents:', fileContents)
		const musicApi = await createMusicApiFromScript(fileContents)
		myTrackPlayer.addMusicApi(musicApi)
		return
	} catch (err) {
		const errMsg = err instanceof Error ? (err as Error).message : String(err)
		logError('Error importing music source:', errMsg)
		Alert.alert('导入失败', `无法导入音源: ${errMsg}`)
		logError('导入音源失败: ' + errMsg)
	}
}
const SettingModal = () => {
	const colors = useThemeColors()
	const { themeMode, setThemeMode } = useThemeMode()
	const styles = useMemo(() => createStyles(colors), [colors])
	const router = useRouter()
	const [currentQuality, setCurrentQuality] = useCurrentQuality()
	const [isLoading, setIsLoading] = useState(false)
	const language = nowLanguage.useValue()
	const autoCacheLocal = autoCacheLocalStore.useValue()
	const autoCacheWifiOnly = autoCacheWifiOnlyStore.useValue()
	const isCachedIconVisible = isCachedIconVisibleStore.useValue()
	const songsNumsToLoad = songsNumsToLoadStore.useValue()
	const homeBoardSource = normalizeLeaderboardSource(
		PersistStatus.useValue('music.homeBoardSource', DEFAULT_HOME_SOURCE) ?? DEFAULT_HOME_SOURCE,
	)
	const homeBoardId = String(
		PersistStatus.useValue('music.homeBoardId', DEFAULT_HOME_BOARD_ID) ?? DEFAULT_HOME_BOARD_ID,
	)
	const homeBoardName = getHomeBoardName(homeBoardId, homeBoardSource)
	const preciseSeeking = PersistStatus.useValue('music.preciseSeeking', false) === true
	const themeLabel = useMemo(() => {
		switch (themeMode) {
			case 'light':
				return i18n.t('settings.actions.theme.light')
			case 'dark':
				return i18n.t('settings.actions.theme.dark')
			default:
				return i18n.t('settings.actions.theme.system')
		}
	}, [themeMode])
	const settingsData: { title: string; data: SettingItem[] }[] = [
		{
			title: i18n.t('settings.sections.general'),
			data: [
				{
					id: '15',
					title: i18n.t('settings.items.changeLanguage'),
					type: 'value',
					value: '',
				},
				{ id: '18', title: i18n.t('settings.items.theme'), type: 'value', value: '' },
				{
					id: '19',
					title: i18n.t('settings.items.homePlaylist'),
					type: 'value',
					value: '',
				},
				{
					id: '17',
					title: i18n.t('settings.items.songsNumsToLoad'),
					type: 'value',
					value: '',
				},
			],
		},
		{
			title: i18n.t('settings.sections.playback'),
			data: [
				{ id: '10', title: i18n.t('settings.items.currentQuality'), type: 'value' },
				{ id: '6', title: i18n.t('settings.items.clearPlaylist'), type: 'link' },
				...(Platform.OS === 'ios'
					? [
							{
								id: 'preciseSeeking',
								title: i18n.t('settings.items.preciseSeeking'),
								description: i18n.t('settings.descriptions.preciseSeeking'),
								type: 'switch' as const,
								value: preciseSeeking,
								onValueChange: (value: boolean) => PersistStatus.set('music.preciseSeeking', value),
							},
						]
					: []),
			],
		},
		{
			title: i18n.t('settings.sections.downloadsCache'),
			data: [
				{ id: 'cache-manager', title: i18n.t('settings.items.manageCache'), type: 'link' },
				{
					id: '14',
					title: i18n.t('settings.items.autoCacheLocal'),
					description: i18n.t('settings.descriptions.autoCacheLocal'),
					type: 'switch',
					value: autoCacheLocal === true,
					onValueChange: myTrackPlayer.toggleAutoCacheLocal,
				},
				{
					id: 'auto-cache-wifi',
					title: i18n.t('settings.items.autoCacheWifiOnly'),
					description: i18n.t('settings.descriptions.autoCacheWifiOnly'),
					type: 'switch',
					value: autoCacheWifiOnly === true,
					onValueChange: myTrackPlayer.toggleAutoCacheWifiOnly,
				},
				{
					id: '16',
					title: i18n.t('settings.items.isCachedIconVisible'),
					description: i18n.t('settings.descriptions.isCachedIconVisible'),
					type: 'switch',
					value: isCachedIconVisible === true,
					onValueChange: myTrackPlayer.toggleIsCachedIconVisible,
				},
				{ id: '9', title: i18n.t('settings.items.clearCache'), type: 'value', value: '' },
			],
		},
		{
			title: i18n.t('settings.sections.sources'),
			data: [
				{ id: 'source-health', title: i18n.t('settings.items.sourceList'), type: 'sources' },
				{ id: '8', title: i18n.t('settings.items.importSource'), type: 'value' },
				{ id: '12', title: i18n.t('settings.items.deleteSource'), type: 'value', value: '' },
			],
		},
		{
			title: i18n.t('settings.sections.advanced'),
			data: [{ id: '13', title: i18n.t('settings.items.viewLogs'), type: 'link' }],
		},
		{
			title: i18n.t('settings.sections.about'),
			data: [
				{ id: '1', title: 'ZhMusic', type: 'link', icon: appIcon },
				{ id: '2', title: i18n.t('settings.items.version'), type: 'value', value: CURRENT_VERSION },
				{ id: '3', title: i18n.t('settings.items.checkUpdate'), type: 'value' },
				{ id: '5', title: i18n.t('settings.items.projectLink'), type: 'value', value: '' },
			],
		},
	]
	const importMusicSourceMenu = (
		<MenuView
			onPressAction={({ nativeEvent: { event } }) => {
				switch (event) {
					case 'file':
						importMusicSourceFromFile()
						break
					case 'url':
						importMusicSourceFromUrl()
						break
				}
			}}
			actions={[
				{ id: 'file', title: i18n.t('settings.actions.import.fromFile') },
				{ id: 'url', title: i18n.t('settings.actions.import.fromUrl') },
			]}
		>
			<TouchableOpacity style={styles.menuTrigger}>
				<Text style={styles.menuTriggerText}>{i18n.t('settings.actions.import.title')}</Text>
			</TouchableOpacity>
		</MenuView>
	)
	const toggleSongsNumsToLoadMenu = (
		<MenuView
			onPressAction={({ nativeEvent: { event } }) => {
				PersistStatus.set('music.songsNumsToLoad', parseInt(event))
				songsNumsToLoadStore.setValue(parseInt(event))
			}}
			actions={[
				{ id: '100', title: '100' },
				{ id: '200', title: '200' },
				{ id: '300', title: '300' },
			]}
		>
			<TouchableOpacity style={styles.menuTrigger}>
				<Text style={styles.menuTriggerText}>{songsNumsToLoad}</Text>
			</TouchableOpacity>
		</MenuView>
	)
	const toggleHomePlaylistMenu = (
		<MenuView
			onPressAction={({ nativeEvent: { event } }) => {
				if (!event) return
				setHomeLeaderboard(homeBoardSource, event)
			}}
			actions={getHomeBoards(homeBoardSource).map((board) => ({
				id: board.bangid,
				title: board.name,
				state: board.bangid === homeBoardId ? 'on' : 'off',
			}))}
		>
			<TouchableOpacity style={styles.menuTrigger}>
				<Text style={styles.menuTriggerText} numberOfLines={1}>
					{homeBoardName}
				</Text>
			</TouchableOpacity>
		</MenuView>
	)
	const DismissPlayerSymbol = () => {
		const { top } = useSafeAreaInsets()
		return (
			<View style={[styles.dismissSymbol, { top: top - 25 }]}>
				<View style={styles.dismissBar} />
			</View>
		)
	}
	const handleClearCache = async () => {
		try {
			await myTrackPlayer.clearCache()
			Alert.alert(
				i18n.t('settings.actions.cache.success'),
				i18n.t('settings.actions.cache.successMessage'),
			)
		} catch (error) {
			Alert.alert(
				i18n.t('settings.actions.cache.error'),
				i18n.t('settings.actions.cache.errorMessage'),
			)
			console.error(error)
		}
	}
	const confirmClearCache = () => {
		Alert.alert(i18n.t('settings.actions.cache.title'), i18n.t('settings.actions.cache.message'), [
			{ text: i18n.t('settings.actions.cache.cancel'), style: 'cancel' },
			{
				text: i18n.t('settings.actions.cache.confirm'),
				style: 'destructive',
				onPress: () => void handleClearCache(),
			},
		])
	}
	const handleSelectSource = (sourceId) => {
		myTrackPlayer.setMusicApiAsSelectedById(sourceId, { silent: true })
	}
	const handleTestAllSources = () => {
		void myTrackPlayer.testAllMusicApis()
	}
	const changeLanguageMenu = (
		<MenuView
			onPressAction={({ nativeEvent: { event } }) => {
				switch (event) {
					case 'zh':
						changeLanguage('zh')
						break
					case 'en':
						changeLanguage('en')
						break
				}
			}}
			actions={[
				{ id: 'zh', title: '中文' },
				{ id: 'en', title: 'English' },
			]}
		>
			<TouchableOpacity style={styles.menuTrigger}>
				<Text style={styles.menuTriggerText}>{language == 'zh' ? '中文' : 'English'}</Text>
			</TouchableOpacity>
		</MenuView>
	)
	const themeMenu = (
		<MenuView
			onPressAction={({ nativeEvent: { event } }) => {
				if (event === 'system' || event === 'light' || event === 'dark') {
					setThemeMode(event)
				}
			}}
			actions={[
				{
					id: 'system',
					title: i18n.t('settings.actions.theme.system'),
					state: themeMode === 'system' ? 'on' : 'off',
				},
				{
					id: 'light',
					title: i18n.t('settings.actions.theme.light'),
					state: themeMode === 'light' ? 'on' : 'off',
				},
				{
					id: 'dark',
					title: i18n.t('settings.actions.theme.dark'),
					state: themeMode === 'dark' ? 'on' : 'off',
				},
			]}
		>
			<TouchableOpacity style={styles.menuTrigger}>
				<Text style={styles.menuTriggerText}>{themeLabel}</Text>
			</TouchableOpacity>
		</MenuView>
	)

	const handleDeleteSource = (sourceId) => {
		myTrackPlayer.deleteMusicApiById(sourceId)
	}
	const checkForUpdates = async () => {
		setIsLoading(true)
		const timeoutPromise = new Promise((_, reject) =>
			setTimeout(() => reject(new Error('请求超时')), 10000),
		)
		try {
			const result = await Promise.race([
				fetch('https://api.github.com/repos/gyc-12/Cymusic/releases/latest'),
				timeoutPromise,
			])
			if (!(result instanceof Response)) {
				throw new Error('非预期的结果类型')
			}

			if (!result.ok) {
				throw new Error(`HTTP error! status: ${result.status}`)
			}
			const data = await result.json()
			const latestVersion = data.tag_name
			logInfo(CURRENT_VERSION + 'CURRENT_VERSIONCURRENT_VERSION' + latestVersion)

			if (latestVersion !== CURRENT_VERSION) {
				Alert.alert(
					i18n.t('settings.actions.checkUpdate.available'),
					`${i18n.t('settings.actions.checkUpdate.message')} ${latestVersion}`,
					[
						{
							text: i18n.t('settings.actions.checkUpdate.ok'),
							onPress: () => Linking.openURL(data.html_url),
						},
						{
							text: i18n.t('settings.actions.checkUpdate.cancel'),
							onPress: () => {},
							style: 'cancel',
						},
					],
				)
			} else {
				Alert.alert(
					i18n.t('settings.actions.checkUpdate.notAvailable'),
					i18n.t('settings.actions.checkUpdate.notAvailableMessage'),
				)
			}
		} catch (error) {
			logError(i18n.t('settings.actions.checkUpdate.error'), error)
			Alert.alert(
				i18n.t('settings.actions.checkUpdate.error'),
				i18n.t('settings.actions.checkUpdate.errorMessage'),
			)
		} finally {
			setIsLoading(false)
		}
	}

	const renderItem = (item: SettingItem, index: number, sectionData: SettingItem[]) => {
		const itemStyle = [
			styles.item,
			index === 0 && styles.firstItem,
			index === sectionData.length - 1 && styles.lastItem,
		]
		if (item.type === 'sources') {
			return (
				<View key={item.id}>
					<MusicSourceHealthList
						onSelectSource={handleSelectSource}
						onTestAll={handleTestAllSources}
					/>
					{index !== sectionData.length - 1 && <View style={styles.separator} />}
				</View>
			)
		}
		if (item.type === 'switch') {
			return (
				<View key={item.id}>
					<View style={[itemStyle, styles.switchItem]}>
						<View style={styles.switchHeader}>
							<Text style={[styles.itemText, styles.switchTitle]}>{item.title}</Text>
							<Switch
								testID={`settings.${item.id}`}
								value={item.value}
								onValueChange={item.onValueChange}
								accessibilityLabel={item.title}
								accessibilityHint={item.description}
							/>
						</View>
						<Text style={styles.itemDescription}>{item.description}</Text>
					</View>
					{index !== sectionData.length - 1 && <View style={styles.separator} />}
				</View>
			)
		}
		return (
			<View key={item.id}>
				<TouchableOpacity
					key={item.id}
					style={itemStyle}
					onPress={() => {
						if (item.id === 'cache-manager') {
							router.push('/(modals)/cacheManager')
						}
						if (item.id === '13') {
							router.push('/(modals)/logScreen')
						}
						if (item.id === '5') {
							Linking.openURL('https://github.com/gyc-12/Cymusic').catch((err) =>
								logError("Couldn't load page", err),
							)
						} else if (item.type === 'link') {
							if (item.id === '6') {
								Alert.alert(
									i18n.t('settings.actions.clearPlaylist.title'),
									i18n.t('settings.actions.clearPlaylist.message'),
									[
										{ text: i18n.t('settings.actions.clearPlaylist.cancel'), style: 'cancel' },
										{
											text: i18n.t('settings.actions.clearPlaylist.confirm'),
											onPress: () => myTrackPlayer.clearToBePlayed(),
										},
									],
								)
							} else if (item.id === '1') {
								showToast('ZhMusic', 'success')
							}
						} else if (item.id === '3') {
							checkForUpdates()
						} else if (item.id === '9') {
							confirmClearCache()
						}
					}}
				>
					{item.icon && <Image source={item.icon} style={styles.icon} />}
					<View style={styles.itemContent}>
						<Text style={styles.itemText}>{item.title}</Text>
						{item.type === 'value' && <Text style={styles.itemValue}>{item.value}</Text>}
						{item.id === '10' && (
							<MusicQualityMenu
								currentQuality={currentQuality}
								onSelectQuality={setCurrentQuality}
							/>
						)}
						{item.id === '12' && (
							<MusicSourceMenu isDelete={true} onSelectSource={handleDeleteSource} />
						)}
						{item.id === '8' && importMusicSourceMenu}
						{(item.type === 'link' || item.id === '5') && !item.icon && (
							<Text style={styles.arrowRight}>{'>'}</Text>
						)}
						{item.id === '15' && changeLanguageMenu}
						{item.id === '18' && themeMenu}
						{item.id === '17' && toggleSongsNumsToLoadMenu}
						{item.id === '19' && toggleHomePlaylistMenu}
					</View>
				</TouchableOpacity>
				{index !== sectionData.length - 1 && <View style={styles.separator} />}
			</View>
		)
	}
	const GlobalLoading = () => (
		<View style={styles.loadingOverlay}>
			<ActivityIndicator size="large" color={colors.loading} />
		</View>
	)
	return (
		<View style={styles.container}>
			<DismissPlayerSymbol />
			<Text style={styles.header}>{i18n.t('settings.title')}</Text>
			<ScrollView style={styles.scrollView}>
				{settingsData.map((section, index) => (
					<View key={index} style={styles.section}>
						<Text style={styles.sectionTitle}>{section.title}</Text>
						<View style={styles.sectionContent}>{section.data.map(renderItem)}</View>
					</View>
				))}
			</ScrollView>
			{isLoading && <GlobalLoading />}
		</View>
	)
}

const createStyles = (colors: ThemeColors) =>
	StyleSheet.create({
		container: {
			flex: 1,
			backgroundColor: colors.background,
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
			height: 8,
			borderRadius: 8,
			backgroundColor: colors.dismissBar,
			opacity: 0.7,
		},
		header: {
			fontSize: 34,
			fontWeight: 'bold',
			padding: 20,
			paddingTop: 50,
			color: colors.text,
		},
		scrollView: {
			flex: 1,
		},
		section: {
			marginBottom: 20,
		},
		sectionTitle: {
			fontSize: 18,
			fontWeight: '600',
			color: colors.text,
			marginLeft: 20,
			marginBottom: 5,
		},
		item: {
			flexDirection: 'row',
			alignItems: 'center',
			padding: 16,
			// 移除 borderBottomWidth 和 borderBottomColor
		},
		firstItem: {
			borderBottomWidth: 0,
		},
		lastItem: {
			borderBottomWidth: 0, // 确保最后一项没有底部边框
		},
		separator: {
			left: 16,
			right: 16,
			height: 1,
			backgroundColor: colors.maximumTrackTintColor,
		},
		sectionContent: {
			backgroundColor: colors.surfaceElevated,
			borderRadius: 10,
			marginHorizontal: 16,
			overflow: 'hidden', // 确保圆角不被分隔线覆盖
		},
		icon: {
			width: 30,
			height: 30,
			marginRight: 10,
			borderRadius: 6,
		},
		itemContent: {
			flex: 1,
			flexDirection: 'row',
			justifyContent: 'space-between',
			alignItems: 'center',
		},
		itemText: {
			fontSize: 16,
			color: colors.text,
		},
		switchItem: {
			flexDirection: 'column',
			alignItems: 'stretch',
		},
		switchHeader: {
			flexDirection: 'row',
			justifyContent: 'space-between',
			alignItems: 'center',
		},
		switchTitle: {
			flex: 1,
			marginRight: 12,
		},
		itemDescription: {
			marginTop: 8,
			fontSize: 13,
			lineHeight: 19,
			color: colors.textMuted,
		},
		itemValue: {
			fontSize: 16,
			color: colors.textMuted,
		},
		arrowRight: {
			fontSize: 18,
			color: colors.textMuted,
		},
		menuTrigger: {
			flexDirection: 'row',
			alignItems: 'center',
		},
		menuTriggerText: {
			fontSize: 16,
			color: colors.textMuted,
		},
		loadingOverlay: {
			position: 'absolute',
			left: 0,
			right: 0,
			top: 0,
			bottom: 0,
			alignItems: 'center',
			justifyContent: 'center',
			backgroundColor: colors.overlay,
		},
	})

export default SettingModal
