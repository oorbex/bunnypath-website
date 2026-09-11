import {flightState,flightArrivalScroll} from './opening-model.js';

export function initOpening({refreshIdeas}) {
 const demo=document.querySelector('.rescue-demo');
 const cards=document.querySelector('#daily-cards');
 const phone=document.querySelector('.app-preview');
 const button=document.querySelector('#surprise');
 const explainer=document.querySelector('#rescue-explainer');
 const dialog=document.querySelector('#detail-dialog');
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const mobile=matchMedia('(max-width: 620px)');
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
 let frame=0,busy=false,animations=[],timer=0,manualResults=false;
 function clearFlight(){
  journeys.forEach(({flight,source,target})=>{
   flight.hidden=true;source.classList.remove('journey-source-hidden');target?.classList.remove('journey-target-hidden');
  });
 }
 function settle() {
  clearTimeout(timer);timer=0;
  animations.forEach(a=>a.cancel());animations=[];
  demo.classList.remove('rescue-dealing');
  busy=false;button.disabled=false;button.removeAttribute('aria-busy');
 }
 function deal() {
  const duration=mobile.matches?380:560,stagger=65;
  const list=[...cards.querySelectorAll('.activity-mini')];
  list.forEach((card,i)=>{
   if(!card.animate)return;
   animations.push(card.animate([
    {opacity:0,transform:`perspective(700px) translate3d(${mobile.matches?16:38}px,${-12-i*8}px,0) rotateY(-18deg) rotateZ(${4-i}deg) scale(.88)`},
    {opacity:1,transform:'perspective(700px) translate3d(0,0,0) rotateY(0) rotateZ(0) scale(1)'}
   ],{duration,delay:i*stagger,easing:'cubic-bezier(.16,1,.3,1)',fill:'backwards'}));
  });
  return animations.length?duration+Math.max(0,list.length-1)*stagger:0;
 }
 function surprise() {
  if(busy)return;
  clearFlight();manualResults=true;
  // Fresh activities appear immediately; the phone never switches to a search screen.
  refreshIdeas();
  explainer.textContent='Four fresh ideas. Pick your next little adventure.';
  if(reduced.matches || document.hidden){settle();measure();return}
  busy=true;button.disabled=true;button.setAttribute('aria-busy','true');
  demo.classList.add('rescue-dealing');
  const duration=deal();
  if(!duration){settle();measure();return}
  demo.style.setProperty('--rescue-duration',`${duration}ms`);
  timer=setTimeout(()=>{settle();measure()},duration);
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
  journeys.forEach(j=>{
   const {source,flight,target,sourceBox,targetBox}=j;
   if(!sourceBox||!targetBox)return;
   const s=flightState(sourceBox,targetBox,scrollY,innerHeight,mobile.matches,j);
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
  // Landing restores the real cards without starting another screen or animation.
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
 return {surprise};
}
