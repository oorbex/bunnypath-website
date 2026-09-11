import {momentState} from './moments-model.js';

export function initMoments(){
 const root=document.querySelector('.moments-experience');
 if(!root)return;
 const $=s=>root.querySelector(s);
 const tabs=[...root.querySelectorAll('.moments-settings button')];
 const arts=[...root.querySelectorAll('[data-moment-art]')];
 const scene=$('.moments-scene'), world=$('.moments-world');
 const hotspots=$('.moments-discoveries');
 const response=$('#moments-response');
 const motion=matchMedia('(prefers-reduced-motion: reduce)');
 let key='restaurant',found=new Set(),animations=[];
 function cancel(){animations.forEach(a=>a.cancel());animations=[]}
 function animate(el,frames,options){if(!motion.matches&&el.animate)animations.push(el.animate(frames,options))}
 function select(next){
  const old=momentState(key).index;
  const {setting,index}=momentState(next);
  key=setting.key;found.clear();cancel();
  root.dataset.setting=key;
  tabs.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.setting===key)));
  arts.forEach((art,i)=>art.classList.toggle('is-current',i===index));
  if(old!==index){
   animate(arts[old],[{opacity:1,transform:'translateX(0) rotateY(0)'},{opacity:0,transform:`translateX(${index>old?-12:12}%) rotateY(${index>old?-12:12}deg) scale(.9)`}],{duration:600,easing:'cubic-bezier(.2,.75,.25,1)'});
   animate(arts[index],[{opacity:0,transform:`translateX(${index>old?12:-12}%) rotateY(${index>old?12:-12}deg) scale(.9)`},{opacity:1,transform:'translateX(0) rotateY(0) scale(1)'}],{duration:800,easing:'cubic-bezier(.2,.75,.25,1)'});
  }
  scene.setAttribute('aria-label',setting.description);
  $('.moments-chapter').textContent=`0${index+1} / 03`;
  $('#moments-current-setting').textContent=`${setting.label}, scene ${index+1} of ${tabs.length}`;
  $('#moments-prev').setAttribute('aria-label',`Previous scene: ${momentState(tabs[(index+tabs.length-1)%tabs.length].dataset.setting).setting.label}`);
  $('#moments-next').setAttribute('aria-label',`Next scene: ${momentState(tabs[(index+1)%tabs.length].dataset.setting).setting.label}`);
  $('#moments-context').textContent=setting.context;
  $('#moments-scene-line').textContent=setting.line;
  showIdea(setting);
 }
 function showIdea(setting){
  const {idea}=momentState(key);
  $('#moments-idea-title').textContent=idea.title;
  $('#moments-idea-copy').textContent=idea.copy;
  $('#moments-adapt').textContent=idea.adapt;
  response.textContent='';
  hotspots.replaceChildren();hotspots.hidden=false;
  setting.spots.forEach((spot,i)=>{
   const button=document.createElement('button');
   button.type='button';button.className='moments-spot';
   button.style.setProperty('--spot-x',`${spot.x}%`);button.style.setProperty('--spot-y',`${spot.y}%`);
   button.style.setProperty('--spot-delay',`${i*150}ms`);
   button.setAttribute('aria-label',`Explore ${spot.label.toLowerCase()}`);
   button.setAttribute('aria-pressed','false');
   button.innerHTML=`<span aria-hidden="true">+</span><span class="moments-spot-label">${spot.label}</span>`;
   button.addEventListener('click',()=>{
    found.add(i);button.setAttribute('aria-pressed','true');button.firstElementChild.textContent='✓';
    response.textContent=spot.clue+(found.size===setting.spots.length?' Now look around you. What could you try together?':'');
   });
   hotspots.append(button);
  });
  animate($('.moments-idea'),[{opacity:0,transform:'translateY(14px)'},{opacity:1,transform:'translateY(0)'}],{duration:500,easing:'ease-out'});
 }
 tabs.forEach((button,i)=>{
  button.addEventListener('click',()=>select(button.dataset.setting));
  button.addEventListener('keydown',event=>{
   let target;
   if(event.key==='ArrowRight')target=(i+1)%tabs.length;
   if(event.key==='ArrowLeft')target=(i+tabs.length-1)%tabs.length;
   if(event.key==='Home')target=0;
   if(event.key==='End')target=tabs.length-1;
   if(target!==undefined){event.preventDefault();tabs[target].focus();select(tabs[target].dataset.setting)}
  });
 });
 $('#moments-prev').addEventListener('click',()=>select(tabs[(momentState(key).index+tabs.length-1)%tabs.length].dataset.setting));
 $('#moments-next').addEventListener('click',()=>select(tabs[(momentState(key).index+1)%tabs.length].dataset.setting));
 function recenter(){world.style.setProperty('--moment-x','0deg');world.style.setProperty('--moment-y','0deg')}
 world.addEventListener('pointermove',e=>{
  if(motion.matches||e.pointerType!=='mouse')return;
  const r=world.getBoundingClientRect();
  world.style.setProperty('--moment-y',`${((e.clientX-r.left)/r.width-.5)*4}deg`);
  world.style.setProperty('--moment-x',`${-((e.clientY-r.top)/r.height-.5)*3}deg`);
 });
 world.addEventListener('pointerleave',recenter);
 motion.addEventListener('change',()=>{cancel();recenter()});
 document.addEventListener('visibilitychange',()=>{if(document.hidden){cancel();recenter()}});
 select(key);
 return {select};
}
