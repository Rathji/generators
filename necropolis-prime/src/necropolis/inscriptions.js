function readList(root, name, fallback){
  try {
    const node = root && root[name];
    if (node){
      if (node.selectAll){
        const arr = node.selectAll.map(n => n.evaluateItem).filter(Boolean);
        if (arr.length) return arr;
      }
      const s = node.evaluateItem;
      if (typeof s === "string" && s) return [s];
    }
  } catch (e) {}
  return fallback;
}

function readBlock(root, listName, subName){
  try {
    const node = root[listName] && root[listName][subName];
    if (node && node.selectAll){
      return node.selectAll.map(n => n.evaluateItem).join("\n");
    }
  } catch (e) {}
  return "";
}

const CAUSES = {
  kings: ["the weight of a crown", "old age in a warm hall", "a war they won", "a poison at a feast"],
  ossuary: ["the long work of the stacks", "a fall", "the wasting", "a fever"],
  drowned: ["the rising water", "a ship that did not come", "the cold river", "drowning, twice"],
  furnace: ["the great fire", "the smoke", "the forge's kiss", "burning"],
  gardens: ["grief, slowly", "the winter", "a broken heart", "nothing at all"],
  choir: ["the last note", "silence", "a voice given out", "the long hymn"],
  silence: ["a secret kept too long", "the truth", "a word unsaid", "waiting"],
  sorrow: ["a broken heart", "the loss of a child", "a promise broken", "loneliness"],
  vaults: ["the dark", "the counting of coins", "a locked door", "the deep cold"],
  lantern: ["the long night", "tending the lamps", "the dark", "a light gone out"],
  colonnade: ["a fall from the high arches", "pride", "a duel", "the sun they could not see"],
  ruins: ["the collapse", "the quake", "the end of things", "being forgotten"],
};

export function makeInscriptionFactory(root, rng){
  const given = readList(root, "soulGiven", ["Aldous", "Mirren", "Vale", "Selene"]);
  const family = readList(root, "soulFamily", ["of Ashvale", "Corvayne", "Morn"]);
  const deed = readList(root, "epitaphDeed", ["who waited for a ship that never came"]);
  const closer = readList(root, "epitaphCloser", ["Rest now, and do not dream."]);

  const pick = (a) => a[Math.floor(rng.next() * a.length)];

  function name(){
    return pick(given) + " " + pick(family);
  }

  function lifespan(){
    const style = rng.next();
    if (style < 0.45){
      const b = 180 + Math.floor(rng.next() * 420);
      const d = b + 18 + Math.floor(rng.next() * 70);
      return "b. " + b + "  ·  d. " + d;
    } else if (style < 0.75){
      return (10 + Math.floor(rng.next() * 80)) + " winters";
    }
    return "the years are worn away";
  }

  function cause(themeKey){
    const list = CAUSES[themeKey] || CAUSES.sorrow;
    return pick(list);
  }

  function make(ward){
    const key = ward && ward.theme ? ward.theme.key : "sorrow";
    const lines = [];
    lines.push(name());
    lines.push(lifespan());
    lines.push(pick(deed));
    if (rng.next() < 0.7) lines.push("Taken by " + cause(key) + ".");
    lines.push(pick(closer));
    return {
      name: lines[0],
      text: lines.join("\n"),
      ward: ward ? ward.name : "",
      themeKey: key,
    };
  }

  return { make, name, cause };
}

export const WARD_BLURBS = {
  kings: "Here lie those who ruled, and those who wished they had.",
  ossuary: "The stacks go down further than anyone remembers building them.",
  drowned: "The canals are quiet. They are never quite empty.",
  furnace: "The fires never went out. Nobody agrees on who keeps them.",
  gardens: "Nothing grows here except the trees that died first.",
  choir: "You can hear them if you stop walking. Do not stop walking too long.",
  silence: "This is where the words went.",
  sorrow: "Everyone here is waiting for someone.",
  vaults: "Locked from the inside, every one of them.",
  lantern: "A field of lamps, each one for a name.",
  colonnade: "The arches were built to be walked beneath, and never were.",
  ruins: "Something stood here. The city does not say what.",
};

export function makeSpiritProfile(rng, ward, factories){
  const themeKey = ward && ward.theme ? ward.theme.key : "sorrow";
  return {
    name: factories.name(),
    ward: ward ? ward.name : "the outer wards",
    themeKey,
    cause: factories.cause(themeKey),
  };
}

export async function spiritSpeak(root, spirit, question, onChunk){
  const prefix = readBlock(root, "spiritPrompt", "context") ||
    "You are a spirit in Necropolis Prime, the city of the dead. Speak as a specific deceased soul in first person, short and melancholy. Never break character.";
  const identity =
    "The soul you are: " + spirit.name + ", at rest in " + spirit.ward + ".\n" +
    "Their death: " + spirit.cause + ".\n";
  const instruction = prefix + "\n\n" + identity +
    "\nA living wanderer, carrying a lantern, speaks to you:\n\"" + question + "\"\n" +
    "Answer as " + spirit.name + ".";
  return await root.generateText({
    instruction,
    onChunk: (d) => onChunk && onChunk(d.textChunk || ""),
  });
}
