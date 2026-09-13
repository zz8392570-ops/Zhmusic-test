export const SEARCH_HISTORY_LIMIT = 15

export const addSearchHistory = (history: string[], value: string) => {
	const keyword = value.trim()
	if (!keyword) return history

	return [
		keyword,
		...history.filter((item) => item.trim().toLocaleLowerCase() !== keyword.toLocaleLowerCase()),
	].slice(0, SEARCH_HISTORY_LIMIT)
}

export const removeSearchHistory = (history: string[], value: string) =>
	history.filter((item) => item !== value)
