import {filterActivities,agePreview,ageStage,normalizeActivity} from './activity-model.js';
import {details,library,ageCards,frameworks} from './content.js';
import {initAgeWorld} from './age-world.js';
import {initOpening} from './opening.js';
import {initMoments} from './moments.js';
initMoments();
const dialog=document.querySelector('#detail-dialog');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function openDialog(markup){document.querySelector('#dialog-body').innerHTML=markup;dialog.showModal();document.body.style.overflow='hidden'}
function showDetail(name){const a=normalizeActivity(name);if(!a)return;openDialog(`<div class="dialog-icon" aria-hidden="true">${a.emoji}</div><h2 id="dialog-title">${esc(name)}</h2><div class="chips-inline">${a.badges.map(x=>`<span>${esc(x)}</span>`).join('')}</div>${a.desc?`<p>${esc(a.desc)}</p>`:''}${a.materials.length?`<h3>What you need</h3><ul>${a.materials.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}${a.steps.length?`<h3>The steps</h3><ol>${a.steps.map(x=>`<li>${esc(x)}</li>`).join('')}</ol>`:''}<a class="button" href="https://app.bunnypath.com">Explore more play ideas <span aria-hidden="true">↗</span></a>`)}
document.addEventListener('click',e=>{const b=e.target.closest('[data-detail]');if(b)showDetail(b.dataset.detail)});
document.querySelector('.dialog-close').onclick=()=>dialog.close();dialog.addEventListener('close',()=>document.body.style.overflow='');dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close()}});
const menu=document.querySelector('.menu-toggle');menu.onclick=()=>{const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',open);menu.setAttribute('aria-label',open?'Close navigation':'Open navigation');document.querySelector('.nav-links').classList.toggle('open',open)};document.querySelectorAll('.nav-links a').forEach(a=>a.onclick=()=>{menu.setAttribute('aria-expanded','false');document.querySelector('.nav-links').classList.remove('open')});
// Real, finite previews of the existing collection. Counts reflect these examples.
let dailyRound=0;
const dailySets=[['Rainbow Sponge Stamps','Animal Freeze Dance','Backyard Bug Hunt','Spot-the-Difference Zoo'],['Cardboard Castle Quest','Finger Paint Rainbow Swirl','Exploding Volcano Fizz','Super Tape Maze Mission'],['Wild Sock Puppet Showtime','Leaf Rubbings Nature Gallery','Teddy Bear Tea Party','Bean Treasure Hunt']];
function animateRefresh(el){el.classList.remove('refreshing');void el.offsetWidth;el.classList.add('refreshing')}
function renderDaily(){const el=document.querySelector('#daily-cards');el.innerHTML=dailySets[dailyRound%dailySets.length].map(n=>{const a=normalizeActivity(n);return `<button class="activity-mini" data-detail="${esc(n)}"><span class="emoji" aria-hidden="true">${a.emoji}</span><span><b>${esc(n)}</b><small>${esc(a.badges.slice(0,2).join(' · '))}</small></span><span class="mini-arrow" aria-hidden="true">↗</span></button>`}).join('');animateRefresh(el)}
renderDaily();
const opening=initOpening({refreshIdeas:()=>{dailyRound++;renderDaily()}});
document.querySelector('#surprise').onclick=()=>opening.surprise();
const ageLabels={active:'Play',creative:'Create',discovery:'Discover',brain:'Solve'};
let ageOffset=0;const slider=document.querySelector('#age-slider');
const ageWorld=initAgeWorld();
function renderAge(){const age=Number(slider.value);ageWorld.setAge(age);const label=age===0?'Under 1 year':age===1?'1 year old':`${age} years old`;document.querySelector('#age-readout').textContent=label;slider.setAttribute('aria-valuetext',label);slider.style.background=`linear-gradient(to right,var(--coral) ${age/12*100}%,#d9dfc9 ${age/12*100}%)`;document.querySelector('#age-stage').textContent=ageStage(age);document.querySelector('#age-badge').textContent=age===0?'UNDER 1':`AGE ${age}`;const el=document.querySelector('#age-cards');el.innerHTML=agePreview(age,ageOffset).map(a=>`<button class="age-card" data-kind="${esc(a.type)}" data-detail="${esc(a.title)}"><span class="emoji" aria-hidden="true">${a.emoji}</span><span><small>${ageLabels[a.type]}</small><h3>${esc(a.title)}</h3><p>${esc(a.meta)}</p></span><span aria-hidden="true">↗</span></button>`).join('');animateRefresh(el)}
slider.addEventListener('input',()=>{ageOffset=0;renderAge()});document.querySelector('#age-surprise').textContent='Shuffle these ideas ↻';document.querySelector('#age-surprise').onclick=()=>{ageOffset++;renderAge()};renderAge();
document.querySelector('#universe-fallback').innerHTML=library.slice(0,12).map(a=>`<button data-detail="${esc(a.name)}"><span aria-hidden="true">${a.emoji}</span><b>${esc(a.name)}</b></button>`).join('');window.addEventListener('show-activity',e=>showDetail(e.detail));
let filterLimit=6;const filterState=new Set();const search=document.querySelector('#activity-search');
function renderFilters(){const list=filterActivities(search.value,[...filterState]);document.querySelector('#filter-more').hidden=list.length<=filterLimit;document.querySelector('#filter-count').textContent=`Showing ${Math.min(filterLimit,list.length)} of ${list.length} examples`;document.querySelector('#filter-grid').innerHTML=list.length?list.slice(0,filterLimit).map(a=>`<button class="filter-card" data-detail="${esc(a.name)}"><span class="emoji" aria-hidden="true">${a.emoji}</span><span class="card-arrow" aria-hidden="true">↗</span><h3>${esc(a.name)}</h3><p>${esc(a.age)} · ${esc(a.time)}</p></button>`).join(''):'<div class="empty-results"><b>A little more room to play?</b><p>Try a different search or fewer filters.</p><button class="text-button" data-reset>Clear filters and search ↺</button></div>'}
function resetFilters(){filterLimit=6;filterState.clear();search.value='';document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed','false'));renderFilters()}
document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filterLimit=6;filterState.has(b.dataset.filter)?filterState.delete(b.dataset.filter):filterState.add(b.dataset.filter);b.setAttribute('aria-pressed',String(filterState.has(b.dataset.filter)));renderFilters()});search.addEventListener('input',()=>{filterLimit=6;renderFilters()});document.querySelector('#filter-more').onclick=()=>{filterLimit+=6;renderFilters()};document.querySelector('#reset-filters').onclick=resetFilters;document.addEventListener('click',e=>{if(e.target.closest('[data-reset]'))resetFilters()});renderFilters();
const featuredFrameworks=[
 ['Head Start Early Learning Outcomes Framework','Early learning, from birth to five'],
 ["Scarborough's Reading Rope",'The building blocks of skilled reading'],
 ['CASEL social-emotional competencies','Feelings, relationships and decisions'],
 ['Next-generation science practices','Curiosity, questions and discovery'],
 ['National Core Arts Standards','Creating, expressing and connecting'],
 ['Communication milestones (ASHA)','From first sounds to conversation']
];
const frameworkCard=(name,label,index)=>`<button class="framework-card" data-framework="${esc(name)}"><span class="framework-card-top"><span class="framework-index" aria-hidden="true">${String(index+1).padStart(2,'0')}</span><span class="framework-open" aria-hidden="true">↗</span></span><b>${esc(name)}</b>${label?`<span class="framework-card-label">${esc(label)}</span>`:''}<span class="framework-card-action">See how it shapes play</span></button>`;
const otherFrameworks=Object.keys(frameworks).filter(name=>!featuredFrameworks.some(([featured])=>featured===name));
document.querySelector('#framework-links').innerHTML=featuredFrameworks.map(([name,label],i)=>frameworkCard(name,label,i)).join('')+`<details class="framework-more"><summary><span>Explore all ${Object.keys(frameworks).length} frameworks &amp; research foundations</span><span aria-hidden="true">+</span></summary><div class="framework-more-grid">${otherFrameworks.map((name,i)=>frameworkCard(name,'',i+featuredFrameworks.length)).join('')}</div></details>`;
document.querySelector('#framework-links').addEventListener('click',e=>{const b=e.target.closest('[data-framework]');if(!b)return;const n=b.dataset.framework;const a=frameworks[n];openDialog(`<div class="dialog-icon" aria-hidden="true">✧</div><h2 id="dialog-title">${esc(n)}</h2><p>${esc(a.sum)}</p><h3>The skills it supports</h3><ul>${a.benefits.map(x=>`<li>${esc(x)}</li>`).join('')}</ul><h3>How it shows up in Bunny Path</h3><p>${esc(a.use)}</p>`)});
document.querySelector('#year').textContent=new Date().getFullYear();
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
if(!reducedMotion.matches&&'IntersectionObserver' in window){document.body.classList.add('motion-ready');const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');observer.unobserve(e.target)}}),{threshold:.08,rootMargin:'0px 0px 30px 0px'});document.querySelectorAll('.reveal').forEach(el=>observer.observe(el))}
// Decorative WebGL is isolated from the site's controls and content.
import('./world.js').then(m=>m.initWorlds()).catch(()=>{document.querySelector('#universe-hint').textContent='Tap an activity to explore.'});

document.addEventListener('keydown',e=>{if(e.key==='Escape'){menu.setAttribute('aria-expanded','false');document.querySelector('.nav-links').classList.remove('open')}});

import('./calendar.js').then(m=>m.initCalendar());
