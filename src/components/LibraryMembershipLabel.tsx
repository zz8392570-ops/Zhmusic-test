import { Text } from 'react-native'
import { playListsStore } from '@/player/PlayerStore'
import type { Track } from '@/player/types'
import { getTrackLibraryMembership } from '@/helpers/trackLibraryMembership'
import { useThemeColors } from '@/hooks/useAppTheme'
import i18n from '@/utils/i18n'
export default function LibraryMembershipLabel({
	track,
	favorites,
}: {
	track: Track
	favorites: readonly Track[]
}) {
	const playlists = playListsStore.useValue()
	const colors = useThemeColors()
	const status = getTrackLibraryMembership(track, favorites, playlists ?? [])
	const labels: string[] = []
	if (status.favorite) labels.push(i18n.t('libraryMembership.favorited'))
	else if (status.otherFavorite) labels.push(i18n.t('libraryMembership.otherFavorite'))
	if (status.collections.length)
		labels.push(
			i18n.t(
				status.collections.length > 1 ? 'libraryMembership.inMany' : 'libraryMembership.inOne',
				{ title: status.collections[0].title, count: status.collections.length },
			),
		)
	if (!labels.length) return null
	return (
		<Text
			numberOfLines={2}
			accessibilityLiveRegion="polite"
			style={{ color: colors.textMuted, fontSize: 11, marginTop: 3 }}
		>
			{labels.join(' · ')}
		</Text>
	)
}
