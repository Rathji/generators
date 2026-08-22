// Task #145: Gear Durability/Break data — high-tier gear gains a wear bar
// and a chance to lose a point of durability after each battle. When a
// piece's durability hits zero it is BROKEN: it stays equipped but grants
// no stat bonuses until repaired. Only the realm's strongest pieces are
// tracked (cheap everyday gear never wears).

export const GEAR_DURABILITY = {
  // Weapons
  runeSabre: { max: 24, breakChance: 0.06 },
  wyrmEdge: { max: 28, breakChance: 0.05 },
  voidBrand: { max: 28, breakChance: 0.05 },
  windBlade: { max: 25, breakChance: 0.05 },
  frozenBlade: { max: 26, breakChance: 0.05 },
  infernoBrand: { max: 26, breakChance: 0.05 },
  luminary: { max: 30, breakChance: 0.04 },
  eternalBlade: { max: 34, breakChance: 0.04 },
  timeweaver: { max: 40, breakChance: 0.03 },
  masamune: { max: 40, breakChance: 0.03 },
  shatteredBlade: { max: 44, breakChance: 0.03 },
  // Armor
  runeCuirass: { max: 24, breakChance: 0.06 },
  tideMail: { max: 28, breakChance: 0.05 },
  runePlate: { max: 26, breakChance: 0.05 },
  rimeMail: { max: 26, breakChance: 0.05 },
  chronoMail: { max: 34, breakChance: 0.04 },
};
