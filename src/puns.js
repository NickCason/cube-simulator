// Names for saved cubes, punny where a pun fits: by flavour, by material, or
// one of the all-rounders. The Cubby suggests one; the die rolls another.

const BY_FLAVOR = {
  cherry: ['Cherry on Top', 'Cherry Cubed', 'Cherry Bomb', 'Life Is a Bowl of Cubes'],
  lime: ['Sub-lime', 'Lime Light', 'Key Lime Cube', 'Lime After Lime'],
  blue: ['Blue Cube Raspberry', 'Feeling Blue', 'Once in a Blue Cube', 'Blue Steel'],
  grape: ['Grape Escape', 'Grape Expectations', 'Heard It Through the Grapevine', 'Grape Job'],
  orange: ['Orange You Glad', 'Orange Crush', 'Orange Is the New Cube', 'Zest Friend'],
  lemon: ['Easy Peasy Lemon Cubey', 'Lemon Aid', 'When Life Gives You Cubes', 'Lemon Squeezy'],
  watermelon: ['One in a Melon', 'Melon Collie', 'Watermelon Sugar', 'Seedless Wonder'],
  cola: ['Cube-a Libre', 'Cube-a-Cola', 'Fizz Ed', 'Pop Art'],
  layers: ['Layer Cake', 'Stack Attack', 'Rainbow Connection', 'Strata-sphere', 'Layer It On', 'Many Moods'],
  custom: ['Custom Cube', 'One of a Kind', 'My Own Shade', 'Colour Me Cubed'],
};

const BY_MATERIAL = {
  jello: ['Jell-Oh Yeah', 'Wiggle Room', 'The Big Jiggle', 'Shake It Off'],
  gummy: ['Gummy Bear Hug', 'Chew-bacca', 'Gummy Gummy', 'Chewsday'],
  sour: ['Sour Power', 'Sourpuss', 'Pucker Up', 'Sweet & Sour'],
  crystal: ['Cubic Zirconia', 'Crystal Clear', 'Clear as Jelly', 'Glass Act'],
  creamy: ['Cubes & Cream', 'Cream of the Crop', 'Panna Cube-ta', 'Creamsicle'],
  slime: ['Slime Time', 'Slimer', 'Ooze Clues', 'Slime Lord'],
  water: ['Water Balloon Fight', 'Splash Cube', 'Making Waves', 'Hydro Cube'],
  syrup: ['Stuck on You', 'Sweet Tooth', 'Syrup-ticious', 'Slow Pour'],
  mochi: ['Mochi Mochi', 'Mochi Ado About Nothing', 'Mochi Business', 'Squish Me'],
  marshmallow: ['Marsh-mellow', "S'more Cube", 'Toast of the Town', 'Puffed Up'],
  rubber: ['Bounce Castle', 'Rubber Ducky', 'Boing Boing', 'Rubik’s Rubber'],
  glass: ['Glass Half Full', 'Pane Killer', 'Window Shopping', 'Clearly Cubed'],
  tofu: ['Firm Believer', 'Tofu Good to Be True', 'Bean There', 'Cube-d Tofu'],
  putty: ['Putty in My Hands', 'Silly Putty', 'Slump Day', 'Stay Put'],
  candy: ['Rock Candy', 'Hard Cube to Crack', 'Jawbreaker', 'Sweet Nothing'],
  sugar: ['Sugar Rush', 'Sugar Cube-d', 'Pour Some Sugar on Me', 'Sweet Cube-ns'],
  ice: ['Ice Ice Cubey', 'Ice to Meet You', 'Cool Cube', 'Chill Out'],
  prism: ['Prism Break', 'Light Show', 'Rainbow Road', 'Bend It Like Light'],
  holo: ['Holo-gramps', 'Holo There', 'Foil Me Once', 'Shiny Edition'],
  pearl: ['Pearly Whites', 'Pearl Jam', 'Mother of Pearl', 'Oyster Cube'],
  opal: ['Opal-ooza', 'Fire Opal', 'Opalescent', 'Galaxy Brain'],
  chrome: ['Chrome Dome', 'Liquid Metal', 'Heavy Metal', 'Shiny Happy Cube'],
};

const ANY = [
  'Cubism', 'Hip to Be Square', 'Out of the Box', 'Box Office Hit', 'Squarely Jelly', 'All Square',
  'Cube Root', 'Cube-tiful', 'Six Sides of Fun', 'Fair and Square', 'Cubicle Escape', 'Cubey Doo',
  'Blockbuster', 'Square Dance', 'Cubed Awakening', 'Jiggle Physics', 'Wobble Wobble', 'New Kid on the Block',
];

// the puns for this cube: its flavour's, its material's and the all-rounders
export function punsFor(c) {
  const flavorKey = c.flavor && String(c.flavor).startsWith('#') ? 'custom' : c.flavor;
  return [...(BY_FLAVOR[flavorKey] || []), ...(BY_MATERIAL[c.texture] || []), ...ANY];
}

// A pun name for this cube that isn't on the shelf yet. (rnd: 0..1; the
// Cubby's names come from namegen.js now - the puns are one kind of name)
export function cubeName(c, taken = [], rnd = Math.random) {
  const used = new Set(taken.map((n) => n.toLowerCase()));
  const pool = punsFor(c);
  const free = pool.filter((n) => !used.has(n.toLowerCase()));
  if (free.length) return free[Math.floor(rnd() * free.length)];
  // (every pun's on the shelf: a sequel)
  const base = pool[Math.floor(rnd() * pool.length)];
  for (let i = 2; ; i++) if (!used.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}
