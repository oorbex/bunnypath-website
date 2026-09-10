import {ageWorldState,ageWorlds} from './age-world-model.js';

// Six illustrated scenes share one camera. Input cancels in-flight transitions,
// so rapid scrubbing always lands on the same age as the activity cards.
export function initAgeWorld() {
 const root=document.querySelector('#ages');
 if(!root) return {setAge(){}};
 const viewport=root.querySelector('#age-world-viewport');
 const camera=root.querySelector('.age-world-camera');
 const scenes=[...root.querySelectorAll('[data-scene]')];
 const dots=[...root.querySelectorAll('.age-world-dots i')];
 const preference=matchMedia('(prefers-reduced-motion: reduce)');
 let state=null, animations=[], active=false;
 const cancel=()=>{animations.forEach(a=>a.cancel());animations=[]};
 function setAge(value) {
  const next=ageWorldState(value);
  if(state?.age===next.age) return;
  const before=state;state=next;
  root.dataset.world=next.key;
  root.style.setProperty('--age-turn',`${next.turn}deg`);
  viewport.setAttribute('aria-label',next.description);
  root.querySelector('#age-world-name').textContent=next.name;
  root.querySelector('#age-world-chapter').textContent=`${String(next.index+1).padStart(2,'0')} / ${String(ageWorlds.length).padStart(2,'0')}`;
  dots.forEach((dot,i)=>dot.classList.toggle('is-current',i===next.index));
  if(before?.index===next.index) return;
  cancel();
  scenes.forEach((scene,i)=>scene.classList.toggle('is-current',i===next.index));
  if(!before || preference.matches || !active || !scenes[0].animate) return;
  const direction=next.index>before.index?1:-1;
  animations.push(scenes[before.index].animate([
   {opacity:1,transform:'translate3d(0,0,0) rotateY(0deg) scale(1)',filter:'blur(0)'},
   {opacity:0,transform:`translate3d(${-direction*32}px,10px,-65px) rotateY(${-direction*14}deg) scale(.86)`,filter:'blur(6px)'}
  ],{duration:420,easing:'cubic-bezier(.4,0,1,1)'}));
  animations.push(scenes[next.index].animate([
   {opacity:0,transform:`translate3d(${direction*40}px,24px,-70px) rotateY(${direction*18}deg) scale(.83)`,filter:'blur(7px)'},
   {opacity:1,transform:'translate3d(0,-5px,0) rotateY(0deg) scale(1.025)',filter:'blur(0)',offset:.75},
   {opacity:1,transform:'translate3d(0,0,0) rotateY(0deg) scale(1)',filter:'blur(0)'}
  ],{duration:720,easing:'cubic-bezier(.16,1,.3,1)'}));
  root.classList.remove('world-changing');void viewport.offsetWidth;root.classList.add('world-changing');
 }
 const resetPointer=()=>{camera.style.setProperty('--look-x','0deg');camera.style.setProperty('--look-y','0deg')};
 viewport.addEventListener('pointermove',event=>{
  if(preference.matches || event.pointerType==='touch') return;
  const box=viewport.getBoundingClientRect();
  camera.style.setProperty('--look-y',`${((event.clientX-box.left)/box.width-.5)*7}deg`);
  camera.style.setProperty('--look-x',`${-((event.clientY-box.top)/box.height-.5)*5}deg`);
 });
 viewport.addEventListener('pointerleave',resetPointer);
 preference.addEventListener('change',()=>{cancel();resetPointer();root.classList.remove('world-changing')});
 if('IntersectionObserver' in window){
  const observer=new IntersectionObserver(entries=>{
   active=entries[0].isIntersecting;root.classList.toggle('world-in-view',active);
   if(!active) cancel();
  },{threshold:.08});observer.observe(viewport);
 }else{active=true;root.classList.add('world-in-view')}
 document.addEventListener('visibilitychange',()=>{
  root.classList.toggle('world-in-view',active&&!document.hidden);
  if(document.hidden)cancel();
 });
 return {setAge};
}
