import {flightState,flightArrivalScroll,searchPrompts} from './opening-model.js';

export function initOpening({refreshIdeas}) {
 const demo=document.querySelector('.rescue-demo');
 const cards=document.querySelector('#daily-cards');
 const phone=document.querySelector('.app-preview');
 const activityScreen=document.querySelector('.app-activity-screen');
 const button=document.querySelector('#surprise');
 const explainer=document.querySelector('#rescue-explainer');
 const dialog=document.querySelector('#detail-dialog');
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const mobile=matchMedia('(max-width: 620px)');
 const effects=document.createElement('div');effects.className='app-search-screen';effects.setAttribute('aria-hidden','true');effects.setAttribute('role','status');phone.append(effects);
 const journeys=[
  {selector:'.fc-create',targetIndex:0,icon:'🎨',intro:'A LITTLE CREATIVITY',title:'Big, colorful ideas.',arcSide:1,startRotate:-8},
  {selector:'.fc-discover',targetIndex:2,icon:'🔎',intro:'A LITTLE WONDER',title:'A whole world to discover.',arcSide:-1,startRotate:6}
 ].map(config=>{
  const source=document.querySelector(config.selector);
  const flight=document.createElement('div');flight.className='play-journey';flight.setAttribute('aria-hidden','true');flight.hidden=true;
  flight.dataset.kind=config.targetIndex===0?'create':'discover';
  flight.innerHTML=`<span class="journey-icon">${config.icon}</span><span class="journey-labels"><span class="journey-intro"><small>${config.intro}</small><b>${config.title}</b></span><span class="journey-activity"><b></b><small></small></span></span><span class="journey-arrow">↗</span>`;
  document.body.append(flight);
  return {...config,source,flight};
 }).filter(j=>j.source);
 let frame=0,previous=0,arrived=false,busy=false,animations=[],timer=0,pendingRefresh=false,manualResults=false,restoreFocus=false;
 function clearFlight(){
  journeys.forEach(({flight,source,target})=>{
   flight.hidden=true;source.classList.remove('journey-source-hidden');target?.classList.remove('journey-target-hidden');
  });
 }
 function settle() {
  clearTimeout(timer);timer=0;
  animations.forEach(a=>a.cancel());animations=[];effects.replaceChildren();
  demo.classList.remove('rescue-conjuring');
  activityScreen.inert=false;activityScreen.removeAttribute('aria-hidden');
  effects.setAttribute('aria-hidden','true');
  if(pendingRefresh){pendingRefresh=false;refreshIdeas()}
  if(busy || manualResults)explainer.textContent='Four ideas, ready to play. No searching needed.';
  busy=false;button.disabled=false;button.removeAttribute('aria-busy');
  if(restoreFocus && (document.activeElement===document.body || document.activeElement===button))button.focus({preventScroll:true});
  restoreFocus=false;
 }
 function deal() {
  if(reduced.matches)return;
  const list=[...cards.querySelectorAll('.activity-mini')];
  list.forEach((card,i)=>{
   if(!card.animate)return;
   const animation=card.animate([
    {opacity:0,transform:`perspective(700px) translate3d(${mobile.matches?16:38}px,${-12-i*8}px,0) rotateY(-18deg) rotateZ(${4-i}deg) scale(.88)`},
    {opacity:1,transform:'perspective(700px) translate3d(0,0,0) rotateY(0) rotateZ(0) scale(1)'}
   ],{duration:mobile.matches?380:560,delay:i*65,easing:'cubic-bezier(.16,1,.3,1)',fill:'backwards'});
   animation.finished?.then(measure,()=>{});
  });
 }
 function magic(refresh=false) {
  if(busy)return;
  clearFlight();pendingRefresh=refresh;
  if(refresh)manualResults=true;
  explainer.textContent='Skip the searching. Get four ideas in one tap.';
  if(reduced.matches || !effects.animate){settle();return}
  restoreFocus=document.activeElement===button;
  busy=true;button.disabled=true;button.setAttribute('aria-busy','true');
  activityScreen.inert=true;activityScreen.setAttribute('aria-hidden','true');
  effects.setAttribute('aria-hidden','false');demo.classList.add('rescue-conjuring');
  const count=mobile.matches?4:6,duration=mobile.matches?2100:2300,stagger=25;
  demo.style.setProperty('--rescue-duration',`${duration+(count-1)*stagger}ms`);
  const heading=document.createElement('div');heading.className='search-story-heading';
  heading.innerHTML='<small>LESS SEARCHING. MORE PLAYING.</small><strong>Web searches you can skip.</strong>';
  const list=document.createElement('div');list.className='phone-search-list';
  const remaining=document.createElement('p');remaining.className='search-remaining';
  remaining.textContent=`… and ${80-count} other searches you no longer have to waste time on.`;
  effects.append(heading,list,remaining);
  for(let i=0;i<count;i++){
   const tab=document.createElement('div');tab.className='search-whirl-tab';
   const bar=document.createElement('span');bar.className='search-tab-bar';bar.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><span>Search</span>';
   const text=document.createElement('b');text.textContent=searchPrompts[i];tab.append(bar,text);list.append(tab);
  }
  const rect=effects.getBoundingClientRect();
  [...list.children].forEach((tab,i)=>{
   const box=tab.getBoundingClientRect();
   const dx=rect.left+rect.width/2-box.left-box.width/2;
   const dy=rect.top+rect.height*.18-box.top-box.height/2;
   const resting='translate3d(0,0,0) rotate(0deg) scale(1)';
   animations.push(tab.animate([
    {opacity:0,transform:`translate3d(0,20px,0) rotate(${i%2?6:-6}deg) scale(.85)`},
    {opacity:1,transform:resting,offset:.14},
    {opacity:1,transform:resting,offset:.72},
    {opacity:.9,transform:`translate3d(${dx*.3+(i%2?20:-20)}px,${dy*.2}px,0) rotate(${i%2?12:-12}deg) scale(.94)`,offset:.84},
    {opacity:0,transform:`translate3d(${dx}px,${dy}px,0) rotate(${i%2?65:-65}deg) scale(.05)`}
   ],{duration,delay:i*stagger,easing:'linear',fill:'both'}));
  });
  timer=setTimeout(()=>{settle();deal();measure()},duration+(count-1)*stagger);
 }
 function measure() {
  clearFlight();
  const targets=[...cards.querySelectorAll('.activity-mini')];
  const phoneBox=phone.getBoundingClientRect(),buttonBox=button.getBoundingClientRect();
  const arrivalScroll=flightArrivalScroll(phoneBox.top+scrollY,buttonBox.top+scrollY,innerHeight,document.querySelector('.site-header')?.offsetHeight||80);
  journeys.forEach(j=>{
   j.arrivalScroll=arrivalScroll;
   j.target=targets[j.targetIndex];if(!j.target){j.targetBox=null;return}
   const box=j.source.getBoundingClientRect(),dest=j.target.getBoundingClientRect();
   j.sourceBox={left:box.left,top:box.top+scrollY,width:box.width,height:box.height};
   j.targetBox={left:dest.left,top:dest.top+scrollY,width:dest.width,height:dest.height};
  });
  schedule();
 }
 function render() {
  frame=0;clearFlight();
  if(reduced.matches||dialog.open||document.hidden||busy)return;
  if(manualResults){
   const backAtHero=journeys.every(j=>j.sourceBox&&j.targetBox&&flightState(j.sourceBox,j.targetBox,scrollY,innerHeight,mobile.matches,j).progress===0);
   if(!backAtHero)return;
   manualResults=false;
  }
  const progress=[];
  journeys.forEach(j=>{
   const {source,flight,target,sourceBox,targetBox}=j;
   if(!sourceBox||!targetBox)return;
   const s=flightState(sourceBox,targetBox,scrollY,innerHeight,mobile.matches,j);
   progress.push(s.progress);
   if(s.active && !source.matches(':focus-visible') && !cards.contains(document.activeElement)) {
    flight.querySelector('.journey-activity b').textContent=target.querySelector('b').textContent;
    flight.querySelector('.journey-activity small').textContent=target.querySelector('small').textContent;
    flight.querySelector('.journey-icon').textContent=s.label>.5?target.querySelector('.emoji').textContent:j.icon;
    flight.hidden=false;source.classList.add('journey-source-hidden');target.classList.add('journey-target-hidden');
    Object.assign(flight.style,{left:`${s.x}px`,top:`${s.y}px`,width:`${s.width}px`,height:`${s.height}px`,transform:`perspective(900px) rotateY(${s.turn}deg) rotateZ(${s.rotate}deg)`});
    flight.style.setProperty('--journey-label',s.label);
    flight.style.setProperty('--journey-lift',`${Math.sin(s.progress*Math.PI)*20+8}px`);
   }
  });
  // Both cards share the phone-based arrival point; the deeper row no longer delays the reveal.
  const completed=progress.length?Math.min(...progress):0;
  if(completed>=.995 && previous<.995 && previous>.1 && !arrived){arrived=true;magic(false)}
  previous=completed;
 }
 function schedule(){if(!frame)frame=requestAnimationFrame(render)}
 window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',measure,{passive:true});
 window.addEventListener('pageshow',measure);
 reduced.addEventListener('change',()=>{settle();clearFlight();schedule()});
 document.addEventListener('visibilitychange',()=>{if(document.hidden){settle();clearFlight()}else measure()});
 document.addEventListener('focusin',schedule);
 dialog.addEventListener('close',schedule);
 if('ResizeObserver' in window){const observer=new ResizeObserver(measure);observer.observe(document.querySelector('.hero'));observer.observe(demo)}
 document.fonts?.ready.then(measure);
 measure();
 return {surprise:()=>magic(true)};
}
