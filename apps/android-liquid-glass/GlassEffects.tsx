import { createContext, useContext, useRef, type ReactNode, type RefObject } from 'react';
import { BlurView, BlurTargetView } from 'expo-blur';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
type EditionBackdropProps={children:ReactNode;style?:StyleProp<ViewStyle>};
const BlurTargetContext=createContext<RefObject<View|null>|null>(null);
export function EditionBackdrop({children,style}:EditionBackdropProps){
 const targetRef=useRef<View|null>(null);
 return <View style={[styles.backdrop,style]}>
  <View pointerEvents="none" style={styles.warmGlow}/><View pointerEvents="none" style={styles.coolGlow}/>
  <BlurTargetContext.Provider value={targetRef}>{children}</BlurTargetContext.Provider>
 </View>;
}
export function EditionContentTarget({children,style}:EditionBackdropProps){
 const targetRef=useContext(BlurTargetContext);
 if(!targetRef)return <View style={[{flex:1},style]}>{children}</View>;
 return <BlurTargetView ref={targetRef} style={style}>{children}</BlurTargetView>;
}
export function GlassOverlay({intensity=52}:{intensity?:number}){
 const targetRef=useContext(BlurTargetContext); if(!targetRef)return null;
 return <BlurView pointerEvents="none" blurTarget={targetRef} intensity={intensity} tint="light" blurMethod="dimezisBlurViewSdk31Plus" style={StyleSheet.absoluteFill}/>;
}
const styles=StyleSheet.create({
 backdrop:{flex:1,backgroundColor:'#EAF0FA',overflow:'hidden'},
 warmGlow:{position:'absolute',top:-118,right:-86,width:300,height:300,borderRadius:150,backgroundColor:'rgba(244,145,103,0.18)'},
 coolGlow:{position:'absolute',left:-128,bottom:74,width:330,height:330,borderRadius:165,backgroundColor:'rgba(112,157,214,0.16)'}
});
