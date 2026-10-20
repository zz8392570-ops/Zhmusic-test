import { useState } from 'react'
import { Alert, FlatList, Text, View } from 'react-native'
import { useThemeColors } from '@/hooks/useAppTheme'
import { LibraryToolButton as Button } from '@/components/LibraryToolButton'
import PersistStatus from '@/store/PersistStatus'
import {
	retainedSnapshots,
	compareSnapshotSongs,
	type LibrarySnapshot,
} from '@/helpers/librarySnapshots'
import {
	getMaintenanceTarget,
	restoreLibrarySnapshot,
	snapshotTargetFingerprint,
} from '@/helpers/libraryMaintenance'
import i18n from '@/utils/i18n'
export default function LibraryHistoryScreen() {
	const colors = useThemeColors(),
		entries = retainedSnapshots(PersistStatus.useValue('library.snapshots', []) ?? [])
	const [preview, setPreview] = useState<{
		entry: LibrarySnapshot
		fingerprint: string
		diff: ReturnType<typeof compareSnapshotSongs>
		details: string[]
	} | null>(null)
	const open = (entry: LibrarySnapshot) => {
		let current: IMusic.IMusicItem[] = []
		try {
			current = getMaintenanceTarget(entry.target).songs
		} catch {
			/* Deleted playlist. */
		}
		const key = (song: IMusic.IMusicItem) => JSON.stringify([song.platform, song.id])
		const currentByKey = new Map(current.map((song) => [key(song), song]))
		const restoredKeys = new Set(entry.songs.map(key))
		setPreview({
			entry,
			fingerprint: snapshotTargetFingerprint(entry),
			diff: compareSnapshotSongs(current, entry.songs),
			details: [
				...current
					.filter((song) => !restoredKeys.has(key(song)))
					.map((song) => `− ${song.title} · ${song.artist} (${song.platform})`),
				...entry.songs.flatMap((song) => {
					const live = currentByKey.get(key(song))
					return !live
						? [`+ ${song.title} · ${song.artist} (${song.platform})`]
						: JSON.stringify(live) !== JSON.stringify(song)
							? [`~ ${live.title} → ${song.title} (${song.platform})`]
							: []
				}),
			].slice(0, 30),
		})
	}
	const restore = () => {
		if (!preview) return
		Alert.alert(i18n.t('history.restore'), i18n.t('history.confirm'), [
			{ text: i18n.t('find.cancel'), style: 'cancel' },
			{
				text: i18n.t('common.confirm'),
				onPress: () => {
					try {
						const restored = restoreLibrarySnapshot(preview.entry.id, preview.fingerprint)
						setPreview(null)
						Alert.alert(i18n.t(restored ? 'history.restored' : 'history.conflict'))
					} catch {
						Alert.alert(i18n.t('history.failed'))
					}
				},
			},
		])
	}
	return (
		<FlatList
			style={{ backgroundColor: colors.background }}
			contentContainerStyle={{ padding: 20 }}
			data={entries}
			keyExtractor={(item) => item.id}
			ListHeaderComponent={
				<View style={{ gap: 10 }}>
					<Text style={{ color: colors.textMuted }}>{i18n.t('history.description')}</Text>
					{preview ? (
						<View style={{ padding: 14, backgroundColor: colors.surfaceMuted, borderRadius: 12 }}>
							<Text style={{ color: colors.text }}>
								{i18n.t('history.diff', preview.diff)}
								{preview.diff.reordered ? `\n${i18n.t('history.orderChanged')}` : ''}
							</Text>
							<Text style={{ color: colors.textMuted }}>{preview.details.join('\n')}</Text>
							<Text style={{ color: colors.textMuted }}>
								{preview.entry.songs
									.slice(0, 20)
									.map((item) => `${item.title} · ${item.artist} (${item.platform})`)
									.join('\n')}
							</Text>
							<Button title={i18n.t('history.restore')} onPress={restore} />
							<Button title={i18n.t('find.cancel')} onPress={() => setPreview(null)} />
						</View>
					) : null}
				</View>
			}
			ListEmptyComponent={
				<Text style={{ color: colors.textMuted }}>{i18n.t('history.empty')}</Text>
			}
			renderItem={({ item }) => (
				<Button
					title={`${item.target === 'favorites' ? i18n.t('appTab.favoritesSongs') : item.title} · ${new Date(item.createdAt).toLocaleString()} (${item.songs.length})`}
					onPress={() => open(item)}
				/>
			)}
		/>
	)
}
