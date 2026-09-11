import {library} from './content.js';
import {TOTAL_DAYS,calendarDay,adjacentMonth,scrollDay,libraryJourney} from './calendar-model.js';

export function initCalendar() {
  const section = document.querySelector('#years');
  if (!section) return;
  const $ = selector => section.querySelector(selector);
  const stage = $('.years-stage'), sheet = $('.calendar-sheet');
  const grid = $('#calendar-days'), slider = $('#calendar-progress');
  const feature = $('#calendar-activity');
  const seed = $('.calendar-seed-card'), origin = $('.calendar-seed-origin');
  let seedGeometry, manuallyExploring = false;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let current = 1, monthKey = '', frame = 0, animation, inset = 112;
  let sticky = false;
  function render(value, animate = true) {
    const date = calendarDay(value), previous = current;
    current = date.index;
    if (date.monthKey !== monthKey) {
      monthKey = date.monthKey;
      $('#calendar-month').textContent = date.month;
      $('#calendar-year').textContent = `YEAR ${date.year}`;
      grid.replaceChildren();
      for (let i=0; i<42; i++) {
        const day = i - date.offset + 1;
        if (day < 1 || day > date.length) {
          const blank = document.createElement('span');
          blank.setAttribute('aria-hidden','true');grid.append(blank);continue;
        }
        const index = date.start + day - 1;
        const activity = library[(index-1)%library.length];
        const button = document.createElement('button');
        button.type = 'button';button.dataset.day = index;
        button.disabled = index > TOTAL_DAYS;
        button.setAttribute('aria-label',`${date.month} ${day}, year ${date.year}: ${activity.name}`);
        const number = document.createElement('span');number.textContent = day;
        const emoji = document.createElement('span');emoji.textContent = activity.emoji;emoji.setAttribute('aria-hidden','true');
        button.append(number,emoji);grid.append(button);
      }
      animation?.cancel();
      if (animate && !motion.matches && sheet.animate) {
        const direction = current >= previous ? 1 : -1;
        animation = sheet.animate([
          {transform:`perspective(1000px) rotateX(${direction*16}deg) translateY(${direction*6}px)`,filter:'brightness(.93)'},
          {transform:'perspective(1000px) rotateX(0deg) translateY(0)',filter:'brightness(1)'}
        ],{duration:350,easing:'cubic-bezier(.2,.7,.2,1)'});
      }
    }
    grid.querySelectorAll('button').forEach(button=>{
      const day = Number(button.dataset.day);
      button.setAttribute('aria-pressed',String(day === current));
      button.classList.toggle('is-past',day < current);
    });
    const activity = library[(current-1)%library.length];
    feature.dataset.detail = activity.name;
    $('.calendar-emoji').textContent = activity.emoji;
    $('#calendar-activity-name').textContent = activity.name;
    $('#calendar-activity-meta').textContent = `${activity.age} · ${activity.time}`;
    $('#calendar-day-count').textContent = current.toLocaleString('en-US');
    slider.value = current;
    slider.setAttribute('aria-valuetext',`Day ${current.toLocaleString('en-US')} of 21,431; ${date.month} ${date.day}, year ${date.year}`);
    slider.style.setProperty('--journey',`${(current-1)/(TOTAL_DAYS-1)*100}%`);
    $('#calendar-prev').disabled = current === 1;
    $('#calendar-next').disabled = date.start + date.length > TOTAL_DAYS;
  }
  function onScroll() {
    frame = 0;
    if (motion.matches || document.querySelector('#detail-dialog')?.open) return;
    const rect = section.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > innerHeight) return;
    if (seed && seedGeometry) {
      const {arrival,day} = libraryJourney(rect.top,seedGeometry.originOffset,seedGeometry.targetOffset,rect.height,innerHeight,sticky,inset,stage.offsetHeight);
      if (arrival === 0) manuallyExploring = false;
      const eased = arrival * arrival * (3 - 2 * arrival);
      seed.style.setProperty('--seed-x',`${seedGeometry.x * eased}px`);
      seed.style.setProperty('--seed-y',`${seedGeometry.y * eased}px`);
      seed.style.setProperty('--seed-scale',String(1 - (1 - seedGeometry.scale) * eased));
      seed.style.setProperty('--seed-turn',`${-5 * (1 - eased)}deg`);
      seed.style.setProperty('--seed-opacity',String(manuallyExploring ? 0 : Math.min(1,(1-arrival)*8)));
      seed.style.setProperty('--seed-copy-opacity',String(Math.max(0,1-arrival*1.6)));
      render(day);
    } else render(scrollDay(rect.top,rect.height,innerHeight,sticky,inset,stage.offsetHeight));
  }
  function schedule() {if(!frame) frame = requestAnimationFrame(onScroll)}
  function measure() {
    inset = (document.querySelector('.site-header')?.offsetHeight || 80) + 24;
    section.style.setProperty('--calendar-inset',`${inset}px`);
    sticky = !motion.matches && stage.offsetHeight + inset + 24 <= innerHeight;
    section.classList.toggle('calendar-sticky',sticky);
    section.style.setProperty('--calendar-stage-height',`${stage.offsetHeight}px`);
    if (seed && origin && grid.firstElementChild) {
      const source = origin.getBoundingClientRect(), target = grid.firstElementChild.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      seedGeometry = {originOffset:source.top-stageRect.top,targetOffset:target.top-stageRect.top,
        x:target.left+target.width/2-source.left-source.width/2,
        y:target.top+target.height/2-source.top-source.height/2,
        scale:Math.min(target.width/source.width,target.height/source.height)};
      if (motion.matches) {
        for (const [key,value] of Object.entries({'x':'0px','y':'0px','scale':'1','turn':'0deg','opacity':'1','copy-opacity':'1'})) seed.style.setProperty(`--seed-${key}`,value);
      }
    }
    if(motion.matches) animation?.cancel();
    schedule();
  }
  function explore(value) {
    manuallyExploring = true;
    if (seed && !motion.matches) seed.style.setProperty('--seed-opacity','0');
    render(value);
  }
  slider.addEventListener('input',()=>explore(slider.value));
  grid.addEventListener('click',event=>{const b=event.target.closest('[data-day]');if(b)explore(b.dataset.day)});
  $('#calendar-prev').addEventListener('click',()=>explore(adjacentMonth(current,-1)));
  $('#calendar-next').addEventListener('click',()=>explore(adjacentMonth(current,1)));
  window.addEventListener('scroll',schedule,{passive:true});
  window.addEventListener('resize',measure,{passive:true});
  window.addEventListener('pageshow',measure);
  motion.addEventListener('change',measure);
  render(1,false);measure();
  if('ResizeObserver' in window) new ResizeObserver(measure).observe(stage);
  document.fonts?.ready.then(measure);
}
