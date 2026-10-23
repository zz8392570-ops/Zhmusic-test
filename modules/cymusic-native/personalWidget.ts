import { requireOptionalNativeModule } from 'expo'
type PersonalWidget = { updateSnapshot(snapshot: string): boolean }
export default requireOptionalNativeModule<PersonalWidget>('CyMusicPersonalWidget')
