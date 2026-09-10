import { library, ageCards, details } from './content.js';
export const getCategory = a => /creative|craft|music|building|storytelling/i.test(a.cat) ? 'create' : /problem|math|engineering/i.test(a.cat) ? 'solve' : /science|discovery|nature|stem/i.test(a.cat) ? 'discover' : 'play';
const noPrep = new Set([3,10,16,19,25,26]);
const quiet = new Set([3,6,7,8,9,11,17,18,19,22,23,24,25,27,28,29]);
const outdoor = new Set([3,4,14,25,28]);
const lowMess = new Set([2,3,5,6,10,11,12,14,16,18,19,20,21,23,25,26]);
export function filterActivities(query='',filters=[]){const q=query.trim().toLowerCase();return library.filter((a,i)=>{const text=[a.name,a.cat,a.age,...a.materials].join(' ').toLowerCase();return (!q||text.includes(q))&&filters.every(f=>f==='quick'?parseInt(a.time,10)<5:f==='noprep'?noPrep.has(i):f==='quiet'?quiet.has(i):f==='outdoor'?outdoor.has(i):f==='lowmess'?lowMess.has(i):true)})}
export function agePreview(age,offset=0){const key=Math.min(12,Math.max(0,Math.round(age)));const cards=ageCards[key];return Array.from({length:Math.min(4,cards.length)},(_,i)=>cards[(i+offset)%cards.length])}
export function ageStage(age){return age<=1?'Baby discoveries':age<=3?'Toddler play':age<=5?'Preschool play':age<=9?'School-age adventures':'Big-kid possibilities'}
export function normalizeActivity(name){if(details[name])return {name,...details[name]};const a=library.find(x=>x.name===name);if(a)return {name:a.name,emoji:a.emoji,badges:[a.age,a.time,a.cat],materials:a.materials,steps:a.steps,desc:''};const c=Object.values(ageCards).flat().find(x=>x.title===name);if(c)return{name,emoji:c.emoji,badges:c.meta.split(' · '),desc:'Play ideas matched to your child’s age. Explore the full activity, materials, and steps in Bunny Path.',materials:[],steps:[]};return null}
