// Small, self-contained play prompts for this website experience.
// These are not represented as entries from the app's activity collection.
export const settings = [
 {key:'restaurant', label:'Restaurant', description:'A miniature restaurant with a bunny parent and child at a table', context:'The food is on its way. Eventually.', line:'Same table. A whole new possibility.', intro:'A napkin. A cup. A curious little mind. You already have more to play with than you think.', spots:[
  {x:44,y:67,label:'Napkin',clue:'A napkin can be a tiny blanket for an imaginary guest.'},
  {x:40,y:50,label:'Cup',clue:'A cup has a circle hiding at the top. What else is round?'},
  {x:58,y:54,label:'Plant',clue:'How many different greens can you spot in those leaves?'}
 ], ideas:[
  {title:'A tiny table treasure hunt',copy:'Choose a color together. Take turns spotting three things in that color around your table. Then let your child choose the next color.',adapt:'For little ones, point and name. For bigger kids, add a shape to the challenge.'},
  {title:'Dinner for an imaginary guest',copy:'Who’s joining you: a mouse, a dragon, or a very hungry astronaut? Take turns imagining what they would order and how they would eat it.',adapt:'Start with a funny voice. Let your child decide what happens next.'}
 ]},
 {key:'waiting', label:'Waiting room', description:'A miniature waiting room with a bunny family, a clock, a plant and colorful blocks', context:'Your appointment is running a little late.', line:'Same waiting room. A little more wonder.', intro:'There are clues hiding in plain sight. All you need is a quiet voice and a little curiosity.', spots:[
  {x:77,y:20,label:'Clock',clue:'I’m round. I have hands. I help you tell the time. What am I?'},
  {x:16,y:44,label:'Plant',clue:'I’m green. I have leaves. I grow toward the light. What am I?'},
  {x:20,y:72,label:'Blocks',clue:'I have flat sides. You can stack me. I might be yellow. What am I?'}
 ], ideas:[
  {title:'Three clues. One little mystery.',copy:'Secretly choose something you can see. Give three clues without saying its name. Once they guess, swap roles and let them be the mystery maker.',adapt:'Offer two choices for younger children. Ask older children to make their clues trickier.'},
  {title:'The quiet shape safari',copy:'Can you find a circle, a square, and something taller than you? Take turns pointing out shapes without leaving your seat.',adapt:'Try tracing each shape in the air with one finger. Keep it quiet and close by.'}
 ]},
 {key:'journey', label:'On a journey', description:'A miniature train carriage with a bunny family, a travel bag and a sunny countryside window', context:'“Are we there yet?” One more time.', line:'Same journey. An entirely new story.', intro:'A passing cloud. A mysterious bag. A story that only the two of you could make up.', spots:[
  {x:27,y:73,label:'Travel bag',clue:'Inside the little bag was something nobody expected…'},
  {x:75,y:19,label:'Cloud',clue:'The cloud decided it was tired of floating, so…'},
  {x:80,y:38,label:'Hills',clue:'Behind the green hill, a very tiny door opened…'}
 ], ideas:[
  {title:'A story with no wrong turns',copy:'Start with “On this journey, we found a mysterious little bag…” Add one sentence each. Follow every silly twist wherever it takes you.',adapt:'You can narrate while little ones add a sound or a character. Older kids can invent the ending.'},
  {title:'What could that cloud become?',copy:'Choose a cloud, a hill, or something through the window. Take turns imagining what else it could be. A sleeping dragon? A giant scoop of ice cream?',adapt:'If the view changes too quickly, keep imagining the last thing you saw.'}
 ]}
];
export function momentState(key,round=0){
 const index=Math.max(0,settings.findIndex(s=>s.key===key));
 const setting=settings[index];
 const safeRound=Number.isFinite(round)?Math.max(0,Math.floor(round)):0;
 return {setting,index,idea:setting.ideas[safeRound%setting.ideas.length]};
}
