import * as THREE from './vendor/three.module.min.js';
import {library} from './content.js';
import {getCategory} from './activity-model.js';
export function initWorlds(){
 const preference=matchMedia('(prefers-reduced-motion: reduce)');let reduced=preference.matches,paused=false,visible=true,frame=0,disposed=false;
 const toggle=document.querySelector('#motion-toggle');toggle.setAttribute('aria-pressed',String(reduced));toggle.innerHTML=reduced?'Play motion <span aria-hidden="true">▷</span>':'Pause motion <span aria-hidden="true">Ⅱ</span>';
 const heroHost=document.querySelector('#hero-canvas'),worldHost=document.querySelector('#library-canvas'),universe=document.querySelector('#universe');
 let heroRenderer,worldRenderer;
 try{worldRenderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});heroRenderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'})}catch{worldRenderer?.dispose();toggle.hidden=true;document.querySelector('#universe-hint').textContent='Choose a category and tap an activity to explore.';return}
 for(const r of [heroRenderer,worldRenderer]){r.setPixelRatio(Math.min(devicePixelRatio,1.6));r.setClearColor(0,0);r.outputColorSpace=THREE.SRGBColorSpace}
 heroHost.append(heroRenderer.domElement);worldHost.append(worldRenderer.domElement);universe.classList.add('webgl-ready');
 const heroScene=new THREE.Scene(),scene=new THREE.Scene();const heroCamera=new THREE.PerspectiveCamera(35,1,.1,100),camera=new THREE.PerspectiveCamera(35,1,.1,100);heroCamera.position.z=12;camera.position.z=12;
 heroScene.add(new THREE.AmbientLight(0xffffff,2.1));const key=new THREE.DirectionalLight(0xffeee0,3);key.position.set(-3,5,5);heroScene.add(key);const rim=new THREE.DirectionalLight(0xe2f3c1,2);rim.position.set(3,-2,3);heroScene.add(rim);
 const heroGroup=new THREE.Group();heroScene.add(heroGroup);const colors=[0xe5ae69,0x91a775,0xe69c78,0xf1d580];
 const shapes=[new THREE.TorusGeometry(.17,.065,12,32),new THREE.SphereGeometry(.13,40,32),new THREE.SphereGeometry(.18,40,32)];
 for(let i=0;i<11;i++){const a=i/11*Math.PI*2;const mesh=new THREE.Mesh(shapes[i%3],new THREE.MeshStandardMaterial({color:colors[i%4],roughness:.33,metalness:.08}));mesh.position.set(Math.cos(a)*2.55,Math.sin(a)*2.72,.5+Math.sin(a*3)*.6);mesh.rotation.set(i*.4,i*.6,i*.7);mesh.userData={baseY:mesh.position.y,index:i};heroGroup.add(mesh)}
 // Activity cards form a continuous gallery, never an orbit or tag cloud.
 const group=new THREE.Group();scene.add(group);scene.fog=new THREE.Fog(0x243e35,15,54);
 const cards=[],textures=library.map((a,i)=>texture(a,i));
  function texture(a,i){const c=document.createElement('canvas');c.width=384;c.height=288;const ctx=c.getContext('2d');const palette=['#e6eacb','#f1d8c0','#e2e9e7','#efcebc','#e4dccc'];ctx.fillStyle=palette[i%palette.length];ctx.beginPath();ctx.roundRect(4,4,376,280,22);ctx.fill();ctx.strokeStyle='#ffffff88';ctx.lineWidth=2;ctx.stroke();ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillStyle='#52654b';ctx.font='600 13px sans-serif';ctx.fillText(getCategory(a).toUpperCase()+' / BUNNY PATH',27,32);ctx.font='68px Apple Color Emoji, Segoe UI Emoji, sans-serif';ctx.fillText(a.emoji,25,100);ctx.font='600 22px sans-serif';ctx.fillStyle='#243e35';const words=a.name.split(' ');let lines=[''];for(const w of words){const line=lines.length-1;const candidate=lines[line]+w+' ';if(ctx.measureText(candidate).width>330&&lines[line])lines.push(w+' ');else lines[line]=candidate}lines.slice(0,3).forEach((line,j)=>ctx.fillText(line.trim(),27,164+j*27));ctx.font='15px sans-serif';ctx.fillStyle='#65715e';ctx.fillText(a.time+'  ·  '+a.age,27,260);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t}
 const count=126,cardGeometry=new THREE.PlaneGeometry(2.16,1.62);
 for(let i=0;i<count;i++){const a=library[i%library.length];const mesh=new THREE.Mesh(cardGeometry,new THREE.MeshBasicMaterial({map:textures[i%library.length],transparent:true,side:THREE.DoubleSide,alphaTest:.08}));mesh.userData={activity:a,index:i};group.add(mesh);cards.push(mesh)}
 let columns=7,travel=0,targetTravel=0,reveal=0,revealStarted=false;
 const ease=t=>1-Math.pow(1-THREE.MathUtils.clamp(t,0,1),3);
 function arrange(){
  const rows=Math.ceil(cards.length/columns),length=rows*2.55;
  const opening=reduced||paused?1:ease(reveal);
  group.userData.travel=travel;
  for(const [i,c] of cards.entries()){
   const row=Math.floor(i/columns),col=i%columns;
   const z=5-((row*2.55-travel)%length+length)%length;
   const x=(col-(columns-1)/2)*2.46;
   c.position.set(x*opening,Math.sin(col*.8)*.045,z);
   c.rotation.set(-.79,0,(1-opening)*(col-(columns-1)/2)*.035);
   const edge=Math.min(1,Math.max(0,(5-z)/1.4));
   c.material.opacity=edge*THREE.MathUtils.clamp((z+length-5)/2,0,1);
   const scale=c===hovered?1.06:1;c.scale.setScalar(scale);
  }
  camera.position.set(pointerX*(reduced?0:.65),5.5+opening*.5,6.2+opening*2.4);
  camera.lookAt(0,-.6,-5-opening*5);
 }
 let inHero=true,inWorld=false;const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.target===heroHost)inHero=e.isIntersecting;else {inWorld=e.isIntersecting;if(inWorld)revealStarted=true}render()}),{rootMargin:'100px'});observer.observe(heroHost);observer.observe(worldHost);
 function resize(){for(const [host,r,c,isWorld] of [[heroHost,heroRenderer,heroCamera,false],[worldHost,worldRenderer,camera,true]]){const w=host.clientWidth,h=host.clientHeight;if(!w||!h)continue;r.setPixelRatio(Math.min(devicePixelRatio,1.6));r.setSize(w,h);c.aspect=w/h;if(isWorld){columns=w<620?5:7;c.fov=48}else c.position.z=Math.max(11.3,3.3/(Math.tan(THREE.MathUtils.degToRad(17.5))*c.aspect));c.updateProjectionMatrix()}render()}
 const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(heroHost);resizeObserver.observe(worldHost);
 let pointerX=0,pointerY=0,dragging=false,down=null,moved=false,selectedCategory='all',hovered=null;
 const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
 function hit(e){const rect=worldRenderer.domElement.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);return raycaster.intersectObjects(cards.filter(c=>c.visible&&c.material.opacity>.45))[0]?.object}
 const canvas=worldRenderer.domElement;canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;dragging=true;moved=false;down={x:e.clientX,y:e.clientY,travel:targetTravel};try{canvas.setPointerCapture(e.pointerId)}catch{cancelDrag()}});
 canvas.addEventListener('pointermove',e=>{if(dragging&&down){const dx=e.clientX-down.x,dy=e.clientY-down.y;if(Math.abs(dx)+Math.abs(dy)>7)moved=true;targetTravel=down.travel-dx*.022;if(reduced||paused)render()}else{hovered=hit(e);canvas.style.cursor=hovered?'pointer':'grab';if(reduced||paused)render()}});
 function cancelDrag(){dragging=false;down=null;hovered=null}
 function release(e){const shouldOpen=dragging&&!moved;cancelDrag();if(shouldOpen){const card=hit(e);if(card)window.dispatchEvent(new CustomEvent('show-activity',{detail:card.userData.activity.name}))}}
 canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',cancelDrag);canvas.addEventListener('lostpointercapture',cancelDrag);window.addEventListener('pointerup',()=>{cancelDrag()});window.addEventListener('blur',cancelDrag);canvas.addEventListener('pointerleave',()=>{hovered=null;if(reduced||paused)render()});
 document.querySelector('.hero-world').addEventListener('pointermove',e=>{const rect=heroHost.getBoundingClientRect();pointerX=(e.clientX-rect.left)/rect.width-.5;pointerY=(e.clientY-rect.top)/rect.height-.5});document.querySelector('.hero-world').addEventListener('pointerleave',()=>{pointerX=0;pointerY=0});
 window.addEventListener('library-category',e=>{selectedCategory=e.detail;const options=library.map((a,i)=>({a,i})).filter(({a})=>selectedCategory==='all'||getCategory(a)===selectedCategory);if(!options.length)return;cards.forEach((c,i)=>{const entry=options[i%options.length];c.userData.activity=entry.a;c.material.map=textures[entry.i];c.material.needsUpdate=true});render()});
 const next=document.querySelector('#gallery-next'),replay=document.querySelector('#gallery-replay');
 if(next)next.onclick=()=>{targetTravel+=7.65;if(reduced||paused)travel=targetTravel;render()};
 if(replay)replay.onclick=()=>{if(reduced||paused){targetTravel=0;travel=0;reveal=1}else{reveal=0;revealStarted=true}render()};
 toggle.onclick=()=>{paused=!(paused||reduced);reduced=false;toggle.setAttribute('aria-pressed',String(paused));toggle.innerHTML=paused?'Play motion <span aria-hidden="true">▷</span>':'Pause motion <span aria-hidden="true">Ⅱ</span>';render()};
 preference.addEventListener('change',e=>{reduced=e.matches;toggle.setAttribute('aria-pressed',String(reduced||paused));toggle.innerHTML=reduced||paused?'Play motion <span aria-hidden="true">▷</span>':'Pause motion <span aria-hidden="true">Ⅱ</span>';render()});
 function render(t=0){if(disposed||lostContexts.size)return;if(reduced||paused)travel=targetTravel;else travel+=(targetTravel-travel)*.085;arrange();scene.updateMatrixWorld(true);if(inWorld)worldRenderer.render(scene,camera);if(inHero){if(!reduced){heroGroup.rotation.y+=(pointerX*.25-heroGroup.rotation.y)*.04;heroGroup.rotation.x+=(-pointerY*.15-heroGroup.rotation.x)*.04;}heroRenderer.render(heroScene,heroCamera)}}
 let last=0;function tick(time){frame=0;if(disposed||lostContexts.size)return;frame=requestAnimationFrame(tick);if(!visible||reduced||paused||time-last<30)return;const dt=Math.min((time-last)/1000,.05);last=time;if(!reduced&&!paused){if(inWorld&&revealStarted){reveal=Math.min(1,reveal+dt*.44);if(!dragging)targetTravel+=dt*.52;}if(inHero)heroGroup.children.forEach(m=>{m.position.y=m.userData.baseY+Math.sin(time*.0007+m.userData.index)*.075;m.rotation.x+=dt*.12;m.rotation.z+=dt*.08})}if(inWorld||inHero)render(time)}
 document.addEventListener('visibilitychange',()=>{visible=!document.hidden;cancelDrag();last=0;if(visible&&!disposed){resize();startFrames()}});
 // Keep the scene alive across tab changes, history navigation and recoverable context loss.
 const lostContexts=new Set();
 function startFrames(){if(disposed||lostContexts.size||frame)return;frame=requestAnimationFrame(tick)}
 function stopFrames(){if(frame)cancelAnimationFrame(frame);frame=0}
 function showFallback(){universe.classList.remove('webgl-ready');toggle.hidden=true;document.querySelector('#universe-hint').textContent='Choose a category and tap an activity to explore.';heroRenderer.domElement.style.visibility='hidden';worldRenderer.domElement.style.visibility='hidden'}
 for(const r of [heroRenderer,worldRenderer]){
  r.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();lostContexts.add(r);stopFrames();cancelDrag();showFallback()});
  r.domElement.addEventListener('webglcontextrestored',()=>{lostContexts.delete(r);if(lostContexts.size||disposed)return;universe.classList.add('webgl-ready');toggle.hidden=false;document.querySelector('#universe-hint').textContent='Drag sideways to travel. Tap a card to explore.';heroRenderer.domElement.style.visibility='';worldRenderer.domElement.style.visibility='';last=0;resize();startFrames()});
 }
 resize();startFrames();
 window.addEventListener('pagehide',e=>{
  stopFrames();cancelDrag();
  if(e.persisted)return;
  disposed=true;observer.disconnect();resizeObserver.disconnect();
  for(const c of cards)c.material.dispose();for(const t of textures)t.dispose();
  cardGeometry.dispose();for(const s of shapes)s.dispose();
  heroGroup.children.forEach(m=>m.material.dispose());heroRenderer.dispose();worldRenderer.dispose();
 });
 window.addEventListener('pageshow',e=>{if(!e.persisted||disposed||lostContexts.size)return;visible=!document.hidden;last=0;resize();startFrames()});
}
