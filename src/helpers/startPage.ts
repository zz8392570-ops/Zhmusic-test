export const startPages = ['charts', 'my', 'favorites', 'search'] as const
export function getStartPageRoute(value: unknown, pathname: string, sharing: boolean) {
	if (sharing || pathname !== '/') return null
	switch (value) {
		case 'my':
			return '/(tabs)/favorites' as const
		case 'favorites':
			return '/(tabs)/favorites/favoriteMusic' as const
		case 'search':
			return '/(tabs)/search' as const
		default:
			return null
	}
}
