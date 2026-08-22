// Task #211: Command Menu configuration — the root menu layout, the status
// detail rows, and the keyboard legend. The CommandMenuSystem builds its
// screens from this; the demo UI renders it.

export const COMMAND_MENU = {
  title: "Command",

  // Root menu order + labels. `disabled` rules are computed at runtime from
  // live party/inventory state (e.g. Magic with no casters).
  root: [
    { id: "items", label: "Items" },
    { id: "magic", label: "Magic" },
    { id: "equip", label: "Equip" },
    { id: "status", label: "Status" },
    { id: "formation", label: "Formation" },
  ],

  // Rows shown on a member's Status detail screen, in order.
  statusRows: [
    { id: "level", label: "Level" },
    { id: "xp", label: "XP" },
    { id: "hp", label: "HP" },
    { id: "mp", label: "MP" },
    { id: "str", label: "Strength" },
    { id: "atk", label: "Attack" },
    { id: "def", label: "Defense" },
    { id: "int", label: "Intellect" },
    { id: "agi", label: "Agility" },
    { id: "mdef", label: "Magic Defense" },
    { id: "status", label: "Status" },
    { id: "equipment", label: "Equipment" },
  ],

  // Stat keys shown as +/- deltas when previewing equipment.
  deltaKeys: ["atk", "def", "int", "agi", "mdef", "str", "maxHp", "maxMp"],

  // Keyboard legend for the UI hint line.
  keys: {
    open: "M",
    navigate: "\u2191\u2193",
    confirm: "Enter",
    cancel: "Esc",
  },

  // Slot display names for the Equip screen.
  slots: {
    weapon: "Weapon",
    armor: "Armor",
    accessory: "Accessory",
  },
};
