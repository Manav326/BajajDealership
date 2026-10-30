import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
type EditionBackdropProps = { children: ReactNode; style?: StyleProp<ViewStyle> };
// Standard Edition intentionally keeps its current unblurred presentation.
export function EditionBackdrop({children,style}:EditionBackdropProps){return <View style={[{flex:1},style]}>{children}</View>;}
export function GlassOverlay(_props:{intensity?:number}){return null;}
