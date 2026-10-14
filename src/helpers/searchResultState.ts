export type SearchEmptyState =
	| 'searching'
	| 'checkingCache'
	| 'cacheError'
	| 'filteredEmpty'
	| 'searchError'
	| 'empty'

export const getSearchEmptyState = ({
	isLoading,
	hasError,
	isCacheLoading = false,
	hasCacheError = false,
	isFiltered = false,
	unfilteredCount = 0,
}: {
	isLoading: boolean
	hasError: boolean
	isCacheLoading?: boolean
	hasCacheError?: boolean
	isFiltered?: boolean
	unfilteredCount?: number
}): SearchEmptyState => {
	if (isCacheLoading && unfilteredCount > 0) return 'checkingCache'
	if (isLoading) return 'searching'
	if (hasError) return 'searchError'
	if (isFiltered && unfilteredCount > 0) return hasCacheError ? 'cacheError' : 'filteredEmpty'
	return 'empty'
}
