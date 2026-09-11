export const clamp01 = n => Math.max(0,Math.min(1,n));
const mix = (a,b,p) => a+(b-a)*p;
// Land while the phone's greeting and primary action are still comfortably visible.
export function flightArrivalScroll(phoneTop, buttonTop, viewport, headerHeight=80) {
 const topClearance=Math.max(headerHeight+28,viewport*.22);
 return Math.max(0,Math.min(phoneTop-topClearance,buttonTop-viewport*.6));
}
export function flightState(source,target,scroll,viewport,mobile=false,{arcSide=1,startRotate=-8,arrivalScroll}={}) {
 const start=Math.max(0,source.top-viewport*.43);
 const end=Math.max(start+180,arrivalScroll??target.top-viewport*.43);
 const p=clamp01((scroll-start)/(end-start));
 const arc=Math.sin(p*Math.PI);
 return {progress:p,active:p>.005&&p<.995,
  x:mix(source.left,target.left,p)+arc*(mobile?18:65)*arcSide,
  y:mix(source.top,target.top,p)-scroll-arc*(mobile?24:80),
  width:mix(source.width,target.width,p),height:mix(source.height,target.height,p),
  rotate:mix(startRotate,0,p)+arc*(mobile?5:13)*arcSide,turn:arc*(mobile?-12:-32)*arcSide,
  label:clamp01((p-.25)/.45)};
}
