export const ageWorlds = [
 {key:'baby', name:'A little world of firsts.', description:'A baby bunny crawling across a soft play mat toward a fabric ball'},
 {key:'wonder', name:'Small hands. Big discoveries.', description:'A miniature world of soft blocks, stacking rings, and a curious bunny for sensory discovery'},
 {key:'outside', name:'Little feet. Big adventures.', description:'A toddler bunny playing with bubbles and a ball in a miniature flower garden'},
 {key:'build', name:'Make-believe makers', description:'A miniature cardboard castle, crayons, and a curious bunny for imaginative play'},
 {key:'discover', name:'A world of what-ifs', description:'A miniature discovery lab with colorful flasks, crystals, and a curious bunny'},
 {key:'adventure', name:'Adventure gets bigger', description:'A miniature woodland campsite with a telescope, a trail, and an exploring bunny'}
];
export function ageWorldState(value) {
 const age=Math.max(0,Math.min(12,Math.round(Number(value)||0)));
 const index=age<3?age:age<6?3:age<9?4:5;
 return {...ageWorlds[index],age,index,progress:age/12,turn:(age/12-.5)*8};
}
