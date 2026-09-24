export type ReleaseNote = {
	version: string
	date: string
	sections: { type: 'new' | 'improved' | 'fixed'; items: string[] }[]
}

/** Add one entry for every shipped version; newest releases stay first. */
export const releaseNotes: ReleaseNote[] = [
	{
		version: '1.2.0',
		date: '2026-09-24',
		sections: [
			{
				type: 'new',
				items: [
					'Siri 快捷指令：播放、暂停、下一首和播放我喜欢',
					'智能歌单与本地听歌统计',
					'启动时恢复播放队列、歌曲和上次进度',
					'歌单文件夹、置顶、排序和批量整理',
					'失效歌曲扫描与高置信度自动修复',
				],
			},
			{
				type: 'improved',
				items: [
					'锁屏、控制中心和耳机切歌操作的状态同步',
					'音源健康评分、自动择优和音质降级',
					'下一首地址预取及过期刷新',
				],
			},
			{
				type: 'fixed',
				items: [
					'WebDAV 目录不存在和远程备份未上传的错误提示',
					'连续切歌时旧请求覆盖当前歌曲',
					'播放失败后无法自动换源恢复',
				],
			},
		],
	},
]
