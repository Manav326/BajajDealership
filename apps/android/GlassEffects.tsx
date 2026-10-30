import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
type EditionBackdropProps={children:ReactNode;style?:StyleProp<ViewStyle>};
type GlassOverlayProps={intensity?:number;placement:'top'|'bottom'};
export function EditionBackdrop({children,style}:EditionBackdropProps){return <View style={[{flex:1},style]}>{children}</View>;}
export function EditionContentTarget({children,style}:EditionBackdropProps){return <View style={[{flex:1},style]}>{children}</View>;}
export function GlassOverlay(_props:GlassOverlayProps){return null;}
