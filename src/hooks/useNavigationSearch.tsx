import { useThemeColors } from '@/hooks/useAppTheme'
import { nowLanguage } from '@/utils/i18n'
import { useNavigation } from 'expo-router'
import { debounce } from 'lodash'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { SearchBarCommands, SearchBarProps } from 'react-native-screens'

type NavigationSearchOptions = {
	searchBarOptions?: SearchBarProps
	onFocus?: () => void
	onBlur?: () => void
	onCancel?: () => void
	onSubmit?: (text: string) => void
	debounceMs?: number
}

export const useNavigationSearchController = ({
	searchBarOptions,
	onFocus,
	onBlur,
	onCancel,
	onSubmit,
	debounceMs = 400,
}: NavigationSearchOptions) => {
	const [search, setSearch] = useState('')
	const navigation = useNavigation()
	const language = nowLanguage.useValue()
	const colors = useThemeColors()
	const internalSearchBarRef = useRef<SearchBarCommands>(null)
	const searchBarRef = searchBarOptions?.ref ?? internalSearchBarRef

	const defaultSearchOptions = useMemo<SearchBarProps>(
		() => ({
			tintColor: colors.primary,
			barTintColor: colors.background,
			backgroundColor: colors.surfaceMuted,
			textColor: colors.text,
			hintTextColor: colors.placeholder,
			hideWhenScrolling: false,
			placement: 'stacked',
		}),
		[colors],
	)

	const debouncedSetSearch = useMemo(
		() =>
			debounce((text: string) => {
				setSearch(text)
			}, debounceMs),
		[debounceMs],
	)

	useEffect(() => () => debouncedSetSearch.cancel(), [debouncedSetSearch])

	const handleOnChangeText = useCallback<NonNullable<SearchBarProps['onChangeText']>>(
		(e) => {
			const text = e.nativeEvent.text
			if (debounceMs === 0) {
				setSearch(text)
			} else {
				debouncedSetSearch(text)
			}
			searchBarOptions?.onChangeText?.(e)
		},
		[debounceMs, debouncedSetSearch, searchBarOptions],
	)

	const handleSearchButtonPress = useCallback<NonNullable<SearchBarProps['onSearchButtonPress']>>(
		(e) => {
			const text = e.nativeEvent.text
			debouncedSetSearch.cancel()
			setSearch(text)
			onSubmit?.(text.trim())
			searchBarOptions?.onSearchButtonPress?.(e)
		},
		[debouncedSetSearch, onSubmit, searchBarOptions],
	)

	const setSearchText = useCallback(
		(text: string) => {
			debouncedSetSearch.cancel()
			setSearch(text)
			searchBarRef.current?.setText(text)
		},
		[debouncedSetSearch, searchBarRef],
	)

	const clearSearch = useCallback(() => {
		debouncedSetSearch.cancel()
		setSearch('')
		searchBarRef.current?.clearText()
	}, [debouncedSetSearch, searchBarRef])

	const focus = useCallback(() => searchBarRef.current?.focus(), [searchBarRef])
	const blur = useCallback(() => searchBarRef.current?.blur(), [searchBarRef])

	useLayoutEffect(() => {
		navigation.setOptions({
			headerSearchBarOptions: {
				...defaultSearchOptions,
				...searchBarOptions,
				ref: searchBarRef,
				onChangeText: handleOnChangeText,
				onSearchButtonPress: handleSearchButtonPress,
				onFocus: (e) => {
					onFocus?.()
					searchBarOptions?.onFocus?.(e)
				},
				onBlur: (e) => {
					onBlur?.()
					searchBarOptions?.onBlur?.(e)
				},
				onCancelButtonPress: (e) => {
					debouncedSetSearch.cancel()
					setSearch('')
					onCancel?.()
					searchBarOptions?.onCancelButtonPress?.(e)
				},
			},
		})
	}, [
		debouncedSetSearch,
		defaultSearchOptions,
		handleOnChangeText,
		handleSearchButtonPress,
		language,
		navigation,
		onBlur,
		onCancel,
		onFocus,
		searchBarOptions,
		searchBarRef,
	])

	return { search, setSearchText, clearSearch, focus, blur }
}

export const useNavigationSearch = (options: NavigationSearchOptions) =>
	useNavigationSearchController(options).search
