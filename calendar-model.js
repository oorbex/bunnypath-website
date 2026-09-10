export const TOTAL_DAYS = 21431;
const DAY_MS = 86400000;
const EPOCH = Date.UTC(2001, 0, 1); // Monday; an illustrative calendar, not a child's age.
const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
export const clampDay = value => Math.max(1, Math.min(TOTAL_DAYS, Math.round(Number(value) || 1)));
export function calendarDay(value) {
  const index = clampDay(value);
  const date = new Date(EPOCH + (index - 1) * DAY_MS);
  const y = date.getUTCFullYear(), m = date.getUTCMonth();
  return {index, day:date.getUTCDate(), month:months[m], monthKey:`${y}-${m}`, year:y-2000,
    start:Math.round((Date.UTC(y,m,1)-EPOCH)/DAY_MS)+1,
    length:new Date(Date.UTC(y,m+1,0)).getUTCDate(),
    offset:(new Date(Date.UTC(y,m,1)).getUTCDay()+6)%7};
}
export function adjacentMonth(value, direction) {
  const current = calendarDay(value);
  return clampDay(direction < 0 ? current.start - 1 : current.start + current.length);
}
export function scrollDay(top, height, viewport, sticky, inset, stageHeight) {
  const distance = sticky ? height - stageHeight : height + viewport * .3;
  const progress = sticky ? (inset-top)/Math.max(1,distance) : (viewport*.65-top)/Math.max(1,distance);
  return clampDay(1 + Math.max(0,Math.min(1,progress)) * (TOTAL_DAYS-1));
}

// The first idea lands before the calendar starts racing through the collection.
export function libraryJourney(top, originOffset, targetOffset, height, viewport, sticky, inset, stageHeight) {
  const flightDistance = Math.max(1, targetOffset - originOffset + viewport * .35);
  const arrival = Math.max(0, Math.min(1, (viewport * .85 - top - originOffset) / flightDistance));
  const dockTop = viewport * .5 - targetOffset;
  const distance = sticky ? Math.max(240, dockTop - inset + height - stageHeight) : Math.max(240, viewport * .48);
  const progress = Math.max(0, Math.min(1, (dockTop - top) / distance));
  return {arrival, day:clampDay(1 + progress * (TOTAL_DAYS - 1))};
}
