// Webuntu OS — System emoji picker (Task 68)
// A GNOME-style emoji picker for the whole OS. Super+. (or the 🙂 toolbar
// buttons in Text Editor / Notes) opens a searchable, category-browsable
// palette; clicking an emoji inserts it at the caret of the field that was
// focused when the picker opened (or the field handed to openFor). With no
// editable target it falls back to copying the emoji to the real OS clipboard
// and showing a toast. Recents persist in webuntu.emoji.recent (in-session
// fields, reload-safe). Closes on Esc, outside-click or window resize.

(function () {
  "use strict";

  const RECENT_KEY = "webuntu.emoji.recent";
  const RECENT_MAX = 24;

  // [emoji, "search keywords"]
  const CATS = [
    {
      id: "smileys", label: "Smileys & People", icon: "😀",
      emojis: [
        ["😀", "grinning happy smile"], ["😃", "grin happy"], ["😄", "happy laugh"], ["😁", "beaming grin"],
        ["😆", "laughing squint"], ["😅", "sweat smile nervous"], ["😂", "joy tears laugh"], ["🤣", "rolling laughing"],
        ["😊", "smile blush"], ["😇", "angel innocent"], ["🙂", "slight smile"], ["🙃", "upside down"],
        ["😉", "wink"], ["😍", "heart eyes love"], ["🥰", "smiling hearts"], ["😘", "kiss blowing"],
        ["😋", "yum tasty"], ["😜", "winking tongue"], ["🤪", "crazy zany"], ["🤗", "hug"],
        ["🤩", "star struck"], ["😎", "cool sunglasses"], ["🤓", "nerd glasses"], ["🧐", "monocle inspect"],
        ["😏", "smirk"], ["😒", "unamused"], ["😞", "disappointed"], ["😔", "sad"],
        ["😟", "worried"], ["😕", "confused"], ["🥺", "pleading puppy"], ["😢", "crying"],
        ["😭", "sobbing"], ["😤", "steam nose"], ["😠", "angry"], ["😡", "rage red"],
        ["🤯", "mind blown"], ["😳", "flushed embarrassed"], ["🥵", "hot heat"], ["🥶", "cold freezing"],
        ["😱", "scream scared"], ["😨", "fearful"], ["😰", "anxious sweat"], ["😥", "sad relieved"],
        ["🤒", "sick thermometer"], ["🤕", "hurt bandage"], ["🤢", "nauseated"], ["🤮", "vomiting"],
        ["🤧", "sneeze"], ["😷", "mask sick"], ["🤠", "cowboy hat"], ["😈", "devil horns"],
        ["👿", "angry devil"], ["👻", "ghost"], ["💀", "skull"], ["👽", "alien"],
        ["🤖", "robot"], ["💩", "poop"],
      ],
    },
    {
      id: "gestures", label: "Gestures & Hands", icon: "👋",
      emojis: [
        ["👋", "wave hello bye"], ["🤚", "raised hand back"], ["🖐️", "raised hand palm"], ["✋", "high five stop"],
        ["🖖", "vulcan salute"], ["👌", "ok perfect"], ["🤏", "pinching tiny"], ["✌️", "peace victory"],
        ["🤞", "crossed fingers luck"], ["🤟", "i love you"], ["🤘", "rock on horns"], ["🤙", "call me"],
        ["👈", "point left"], ["👉", "point right"], ["👆", "point up"], ["👇", "point down"],
        ["☝️", "index up"], ["👍", "thumbs up yes"], ["👎", "thumbs down no"], ["✊", "raised fist"],
        ["👊", "oncoming fist"], ["🤛", "left fist"], ["🤜", "right fist"], ["👏", "clap applause"],
        ["🙌", "raising hands celebrate"], ["👐", "open hands"], ["🤲", "palms together offer"], ["🙏", "pray please thanks"],
        ["✍️", "writing"], ["💅", "nail polish"], ["🤳", "selfie"],
      ],
    },
    {
      id: "hearts", label: "Hearts & Love", icon: "❤️",
      emojis: [
        ["❤️", "red heart love"], ["🧡", "orange heart"], ["💛", "yellow heart"], ["💚", "green heart"],
        ["💙", "blue heart"], ["💜", "purple heart"], ["🖤", "black heart"], ["🤍", "white heart"],
        ["🤎", "brown heart"], ["💔", "broken heart"], ["❣️", "heart exclamation"], ["💕", "two hearts"],
        ["💞", "revolving hearts"], ["💓", "beating heart"], ["💗", "growing heart"], ["💖", "sparkling heart"],
        ["💘", "cupid arrow"], ["💝", "gift heart"], ["💟", "heart decoration"], ["♥️", "heart suit"],
        ["💌", "love letter"], ["💋", "kiss mark"], ["😻", "heart eyes cat"],
      ],
    },
    {
      id: "animals", label: "Animals & Nature", icon: "🐶",
      emojis: [
        ["🐶", "dog puppy"], ["🐱", "cat kitty"], ["🐭", "mouse"], ["🐹", "hamster"],
        ["🐰", "rabbit bunny"], ["🦊", "fox"], ["🐻", "bear"], ["🐼", "panda"],
        ["🐨", "koala"], ["🐯", "tiger"], ["🦁", "lion"], ["🐮", "cow"],
        ["🐷", "pig"], ["🐸", "frog"], ["🐵", "monkey face"], ["🐔", "chicken"],
        ["🐧", "penguin"], ["🐦", "bird"], ["🐤", "chick"], ["🦆", "duck"],
        ["🦅", "eagle"], ["🦉", "owl"], ["🦇", "bat"], ["🐺", "wolf"],
        ["🐴", "horse"], ["🦄", "unicorn"], ["🐝", "bee honey"], ["🦋", "butterfly"],
        ["🐌", "snail"], ["🐞", "ladybug"], ["🐢", "turtle"], ["🐍", "snake"],
        ["🦖", "t-rex dinosaur"], ["🦕", "sauropod"], ["🐙", "octopus"], ["🦑", "squid"],
        ["🦀", "crab"], ["🐡", "pufferfish"], ["🐠", "tropical fish"], ["🐬", "dolphin"],
        ["🐳", "whale spout"], ["🦈", "shark"], ["🐘", "elephant"], ["🦒", "giraffe"],
        ["🐪", "camel"], ["🦥", "sloth"], ["🦦", "otter"], ["🦨", "skunk"],
      ],
    },
    {
      id: "food", label: "Food & Drink", icon: "🍕",
      emojis: [
        ["🍏", "green apple"], ["🍎", "red apple"], ["🍐", "pear"], ["🍊", "orange tangerine"],
        ["🍋", "lemon"], ["🍌", "banana"], ["🍉", "watermelon"], ["🍇", "grapes"],
        ["🍓", "strawberry"], ["🫐", "blueberry"], ["🍒", "cherries"], ["🍑", "peach"],
        ["🥭", "mango"], ["🍍", "pineapple"], ["🥥", "coconut"], ["🥝", "kiwi"],
        ["🍅", "tomato"], ["🥑", "avocado"], ["🥦", "broccoli"], ["🌽", "corn"],
        ["🥕", "carrot"], ["🧄", "garlic"], ["🥔", "potato"], ["🥐", "croissant"],
        ["🍞", "bread"], ["🧀", "cheese"], ["🥚", "egg"], ["🍳", "cooking frying"],
        ["🥓", "bacon"], ["🍗", "chicken leg"], ["🍔", "burger"], ["🍟", "fries"],
        ["🍕", "pizza"], ["🌭", "hot dog"], ["🥪", "sandwich"], ["🌮", "taco"],
        ["🌯", "burrito"], ["🥗", "salad"], ["🍜", "noodles ramen"], ["🍝", "spaghetti pasta"],
        ["🍣", "sushi"], ["🍤", "shrimp tempura"], ["🍙", "rice ball"], ["🍰", "cake slice"],
        ["🎂", "birthday cake"], ["🧁", "cupcake"], ["🍩", "donut"], ["🍪", "cookie"],
        ["🍫", "chocolate"], ["🍬", "candy"], ["🍭", "lollipop"], ["🍿", "popcorn"],
        ["☕", "coffee"], ["🍵", "tea"], ["🧃", "juice"], ["🍺", "beer"],
        ["🍻", "cheers"], ["🍷", "wine"], ["🥂", "toast clink"], ["🍸", "cocktail"],
      ],
    },
    {
      id: "travel", label: "Travel & Places", icon: "🚗",
      emojis: [
        ["🚗", "car"], ["🚕", "taxi"], ["🚙", "suv"], ["🚌", "bus"],
        ["🚎", "trolleybus"], ["🏎️", "race car"], ["🚓", "police car"], ["🚑", "ambulance"],
        ["🚒", "fire truck"], ["🚐", "van"], ["🚚", "truck"], ["🚛", "lorry"],
        ["🚜", "tractor"], ["🛴", "scooter"], ["🚲", "bicycle bike"], ["🛵", "motor scooter"],
        ["🏍️", "motorcycle"], ["🚨", "siren light"], ["✈️", "airplane"], ["🚀", "rocket"],
        ["🛸", "ufo flying saucer"], ["🚁", "helicopter"], ["🛶", "canoe"], ["⛵", "sailboat"],
        ["🚤", "speedboat"], ["🛳️", "cruise ship"], ["🚢", "ship"], ["🗿", "moai statue"],
        ["🏰", "castle"], ["🏯", "japanese castle"], ["🏠", "house"], ["🏡", "house garden"],
        ["🏢", "office building"], ["🏫", "school"], ["🏦", "bank"], ["🏥", "hospital"],
        ["⛪", "church"], ["🕌", "mosque"], ["🗼", "tokyo tower"], ["🌉", "bridge night"],
        ["🌋", "volcano"], ["🏝️", "desert island"], ["🌄", "sunrise mountain"], ["🌅", "sunrise"],
        ["🌃", "night city"], ["🌆", "city dusk"],
      ],
    },
    {
      id: "activity", label: "Activities", icon: "⚽",
      emojis: [
        ["⚽", "soccer football"], ["🏀", "basketball"], ["🏈", "american football"], ["⚾", "baseball"],
        ["🎾", "tennis"], ["🏐", "volleyball"], ["🏉", "rugby"], ["🥏", "frisbee"],
        ["🎱", "billiards 8 ball"], ["🏓", "ping pong table tennis"], ["🏸", "badminton"], ["🏒", "hockey"],
        ["🏑", "field hockey"], ["🥍", "lacrosse"], ["⛳", "golf flag"], ["🏹", "archery bow arrow"],
        ["🎣", "fishing"], ["🥊", "boxing glove"], ["🥋", "martial arts"], ["🎽", "running shirt"],
        ["🛹", "skateboard"], ["🎿", "ski"], ["🏂", "snowboard"], ["🪂", "parachute"],
        ["🏋️", "weightlifting"], ["🤸", "cartwheel gymnastics"], ["⛹️", "basketball player"], ["🤺", "fencing"],
        ["🤾", "handball"], ["🏌️", "golf"], ["🏇", "horse racing"], ["🧘", "yoga meditate"],
        ["🏄", "surfing"], ["🏊", "swimming"], ["🤽", "water polo"], ["🚣", "rowing"],
        ["🧗", "climbing"], ["🚴", "cycling bike"], ["🚵", "mountain biking"], ["🎮", "video game"],
        ["🕹️", "joystick"], ["🎲", "dice"], ["♟️", "chess pawn"], ["🎯", "dart target"],
        ["🎳", "bowling"], ["🎪", "circus tent"], ["🎭", "theater drama"], ["🎨", "art palette"],
        ["🎬", "movie clapper"], ["🎤", "microphone sing"], ["🎧", "headphones music"], ["🎼", "sheet music"],
        ["🎹", "piano keyboard"], ["🥁", "drum"], ["🎷", "saxophone"], ["🎺", "trumpet"],
        ["🎸", "guitar"], ["🎻", "violin"],
      ],
    },
    {
      id: "objects", label: "Objects", icon: "💡",
      emojis: [
        ["💡", "lightbulb idea"], ["🔦", "flashlight"], ["🕯️", "candle"], ["🗑️", "trash wastebasket"],
        ["🛒", "shopping cart"], ["🛍️", "shopping bags"], ["💼", "briefcase"], ["🎒", "backpack"],
        ["🧳", "luggage"], ["👓", "glasses"], ["🕶️", "sunglasses"], ["👔", "tie"],
        ["👕", "t-shirt"], ["👖", "jeans"], ["👗", "dress"], ["👘", "kimono"],
        ["👙", "bikini"], ["👛", "purse"], ["👜", "handbag"], ["💎", "gem diamond"],
        ["💰", "money bag"], ["💵", "dollar cash"], ["💳", "credit card"], ["⚖️", "scale justice"],
        ["🔧", "wrench"], ["🔨", "hammer"], ["🛠️", "tools"], ["⚙️", "gear"],
        ["🧰", "toolbox"], ["🧲", "magnet"], ["💣", "bomb"], ["🧨", "firecracker"],
        ["🔪", "knife"], ["🛡️", "shield"], ["🔑", "key"], ["🗝️", "old key"],
        ["🔒", "lock closed"], ["🔓", "lock open unlocked"], ["🔏", "locked pen"], ["📱", "smartphone"],
        ["💻", "laptop computer"], ["⌨️", "keyboard"], ["🖱️", "mouse"], ["🖨️", "printer"],
        ["📷", "camera"], ["🎥", "video camera"], ["📺", "tv television"], ["📻", "radio"],
        ["🔋", "battery"], ["🔌", "plug power"], ["🕰️", "mantelpiece clock"], ["⏰", "alarm clock"],
        ["📚", "books"], ["📖", "open book"], ["📝", "memo note"], ["✏️", "pencil"],
        ["🖊️", "pen"], ["📌", "pushpin"], ["📎", "paperclip"], ["✂️", "scissors"],
        ["🎁", "gift present"], ["🎈", "balloon"], ["🎀", "ribbon bow"], ["🏆", "trophy"],
        ["🥇", "gold medal"], ["🥈", "silver medal"], ["🥉", "bronze medal"], ["🎖️", "military medal"],
      ],
    },
    {
      id: "symbols", label: "Symbols", icon: "🔣",
      emojis: [
        ["✅", "check green"], ["❌", "cross no"], ["❎", "cross square"], ["➕", "plus"],
        ["➖", "minus"], ["➗", "divide"], ["✖️", "multiply"], ["❗", "exclamation"],
        ["❕", "exclamation white"], ["❓", "question"], ["❔", "question white"], ["‼️", "double exclamation"],
        ["💯", "hundred points"], ["🔅", "dim low brightness"], ["🔆", "bright high brightness"], ["🔇", "mute no sound"],
        ["🔈", "speaker low"], ["🔉", "speaker medium"], ["🔊", "speaker loud"], ["🔔", "bell notify"],
        ["🔕", "bell muted"], ["📢", "loudspeaker announce"], ["📣", "megaphone"], ["♻️", "recycle"],
        ["⚜️", "fleur de lis"], ["🔱", "trident"], ["🔰", "beginner japanese"], ["⚠️", "warning"],
        ["🚸", "children crossing"], ["⛔", "no entry"], ["🚫", "prohibited ban"], ["🚭", "no smoking"],
        ["🔞", "18 no underage"], ["⚡", "high voltage electricity"], ["🔥", "fire hot"], ["✨", "sparkles"],
        ["⭐", "star"], ["🌟", "glowing star"], ["💫", "dizzy star"], ["💥", "collision boom"],
        ["💢", "anger symbol"], ["💬", "speech bubble"], ["💭", "thought bubble"], ["💤", "zzz sleeping"],
        ["💦", "sweat droplets"], ["💨", "dash wind"], ["👀", "eyes"], ["🧠", "brain"],
        ["💪", "muscle flex"], ["🫶", "heart hands"], ["👤", "silhouette person"], ["👥", "two silhouettes"],
      ],
    },
    {
      id: "flags", label: "Flags", icon: "🏁",
      emojis: [
        ["🏁", "checkered flag"], ["🚩", "red flag"], ["🏳️", "white flag"], ["🏴", "black flag"],
        ["🏳️‍🌈", "rainbow flag pride"], ["🏳️‍⚧️", "transgender flag"], ["🇺🇸", "united states america"], ["🇬🇧", "uk britain england"],
        ["🇨🇦", "canada"], ["🇲🇽", "mexico"], ["🇧🇷", "brazil"], ["🇦🇷", "argentina"],
        ["🇪🇸", "spain"], ["🇫🇷", "france"], ["🇩🇪", "germany"], ["🇮🇹", "italy"],
        ["🇳🇱", "netherlands"], ["🇧🇪", "belgium"], ["🇨🇭", "switzerland"], ["🇸🇪", "sweden"],
        ["🇳🇴", "norway"], ["🇩🇰", "denmark"], ["🇫🇮", "finland"], ["🇵🇱", "poland"],
        ["🇨🇿", "czech republic"], ["🇬🇷", "greece"], ["🇹🇷", "turkey"], ["🇷🇺", "russia"],
        ["🇺🇦", "ukraine"], ["🇮🇱", "israel"], ["🇸🇦", "saudi arabia"], ["🇮🇳", "india"],
        ["🇨🇳", "china"], ["🇯🇵", "japan"], ["🇰🇷", "south korea"], ["🇻🇳", "vietnam"],
        ["🇹🇭", "thailand"], ["🇵🇭", "philippines"], ["🇦🇺", "australia"], ["🇳🇿", "new zealand"],
        ["🇿🇦", "south africa"], ["🇳🇬", "nigeria"], ["🇪🇬", "egypt"], ["🇲🇦", "morocco"],
        ["🇦🇪", "united arab emirates"], ["🇸🇬", "singapore"], ["🇮🇩", "indonesia"], ["🇵🇰", "pakistan"],
      ],
    },
  ];

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  // ---------- DOM ----------
  const pickerEl = el("div", "");
  pickerEl.id = "emojiPicker";
  pickerEl.hidden = true;

  const head = el("div", "ep-head");
  const search = el("input", "ep-search");
  search.type = "text";
  search.placeholder = "Search emoji…";
  search.spellcheck = false;
  const closeBtn = el("button", "ep-close", "✕");
  closeBtn.type = "button";
  closeBtn.title = "Close (Esc)";
  head.append(search, closeBtn);

  const recentWrap = el("div", "ep-recent");
  recentWrap.hidden = true;
  recentWrap.append(el("div", "ep-label", "Recent"));
  const recentGrid = el("div", "ep-grid");
  recentWrap.appendChild(recentGrid);

  const catRow = el("div", "ep-cats");
  const grid = el("div", "ep-grid");

  pickerEl.append(head, recentWrap, catRow, grid);
  document.body.appendChild(pickerEl);

  const state = { open: false, cat: 0, query: "" };

  // ---------- recents ----------
  function getRecents() {
    try {
      const v = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
    } catch (e) { return []; }
  }
  function addRecent(emoji) {
    const r = getRecents().filter((x) => x !== emoji);
    r.unshift(emoji);
    while (r.length > RECENT_MAX) r.pop();
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(r)); } catch (e) {}
  }

  // ---------- data helpers ----------
  function searchResults(q) {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    const out = [];
    for (const c of CATS) {
      const cl = c.label.toLowerCase();
      for (const [emoji, kw] of c.emojis) {
        if (emoji === t || kw.toLowerCase().indexOf(t) !== -1 || cl.indexOf(t) !== -1) out.push([emoji, kw]);
      }
    }
    return out;
  }

  function editableTarget() {
    const a = document.activeElement;
    if (!a || !a.isConnected || a.disabled || a.readOnly) return null;
    if (a.tagName === "TEXTAREA") return a;
    if (a.tagName === "INPUT") {
      const t = (a.type || "text").toLowerCase();
      if (["text", "search", "url", "email", "tel", "password", "number", ""].includes(t)) return a;
      return null;
    }
    return a.isContentEditable ? a : null;
  }
  function isEditable(a) {
    if (!a || !a.isConnected || a.disabled || a.readOnly) return false;
    if (a.tagName === "TEXTAREA") return true;
    if (a.tagName === "INPUT") {
      const t = (a.type || "text").toLowerCase();
      return ["text", "search", "url", "email", "tel", "password", "number", ""].includes(t);
    }
    return !!a.isContentEditable;
  }

  // ---------- insertion ----------
  function insertInto(t, emoji) {
    const isField = t.tagName === "INPUT" || t.tagName === "TEXTAREA";
    const before = isField ? t.value : null;
    let s = 0, e = 0;
    if (isField) {
      s = t.selectionStart == null ? t.value.length : t.selectionStart;
      e = t.selectionEnd == null ? s : t.selectionEnd;
    }
    t.focus();
    if (isField) { try { t.setSelectionRange(s, e); } catch (err) {} }
    let ok = false;
    try { ok = document.execCommand("insertText", false, emoji); } catch (err) {}
    // Chrome sometimes reports execCommand success without inserting anything
    // (focus state not yet flushed); verify the value changed, else fall back.
    if (isField && ok && t.value === before) ok = false;
    if (ok) return;
    if (isField) {
      t.value = t.value.slice(0, s) + emoji + t.value.slice(e);
      const pos = s + emoji.length;
      try { t.setSelectionRange(pos, pos); } catch (err) {}
      t.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && sel.getRangeAt(0)) {
        const r = sel.getRangeAt(0);
        r.deleteContents();
        const node = document.createTextNode(emoji);
        r.insertNode(node);
        r.setStartAfter(node);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
      } else t.textContent += emoji;
    }
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
    } else legacyCopy(text);
  }
  function legacyCopy(text) {
    const ta = el("textarea", "");
    ta.value = text;
    ta.style.position = "fixed"; ta.style.opacity = "0"; ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    ta.remove();
  }

  function insert(emoji) {
    const t = pickerEl._target;
    close();
    addRecent(emoji);
    if (isEditable(t)) {
      insertInto(t, emoji);
      if (window.Sounds) window.Sounds.play("ok");
    } else {
      copyText(emoji);
      if (window.Notify) window.Notify.toast("Emoji copied", emoji + "  (no text field was focused)", { icon: emoji, app: "Emoji Picker" });
    }
  }

  // ---------- rendering ----------
  function cell(e, kw) {
    const b = el("button", "ep-cell", e);
    b.type = "button";
    b.title = (kw || e) + " — " + e;
    // Don't let clicking a cell steal focus from the target field (keeps the
    // caret/selection intact for execCommand insertion).
    b.addEventListener("mousedown", (ev) => ev.preventDefault());
    b.addEventListener("click", () => insert(e));
    return b;
  }

  function renderGrid(list) {
    grid.textContent = "";
    if (!list.length) {
      grid.appendChild(el("div", "ep-empty", "No emoji found"));
      return;
    }
    for (const [e, kw] of list) grid.appendChild(cell(e, kw));
  }

  function renderRecents() {
    const r = getRecents();
    recentWrap.hidden = r.length === 0 || !!state.query;
    if (!recentWrap.hidden) {
      recentGrid.textContent = "";
      for (const e of r) recentGrid.appendChild(cell(e, "recent"));
    }
  }

  function renderCats() {
    catRow.hidden = !!state.query;
    if (catRow.hidden) return;
    catRow.textContent = "";
    CATS.forEach((c, i) => {
      const b = el("button", "ep-cat" + (i === state.cat ? " active" : ""), c.icon);
      b.type = "button";
      b.title = c.label;
      b.addEventListener("mousedown", (ev) => ev.preventDefault());
      b.addEventListener("click", () => { state.cat = i; render(); });
      catRow.appendChild(b);
    });
  }

  function render() {
    renderGrid(state.query ? searchResults(state.query) : CATS[state.cat].emojis);
    renderCats();
    renderRecents();
  }

  function firstEmoji() {
    if (state.query) {
      const r = searchResults(state.query);
      return r.length ? r[0][0] : null;
    }
    const rec = getRecents();
    if (rec.length) return rec[0];
    return CATS[state.cat].emojis[0][0];
  }

  // ---------- positioning ----------
  function position(x, y) {
    const w = pickerEl.offsetWidth || 360;
    const h = pickerEl.offsetHeight || 380;
    let left = x == null ? (innerWidth - w) / 2 : x - w / 2;
    let top = y == null ? innerHeight - h - 64 : y + 12;
    left = Math.max(8, Math.min(left, innerWidth - w - 8));
    top = Math.max(8, Math.min(top, innerHeight - h - 8));
    pickerEl.style.left = left + "px";
    pickerEl.style.top = top + "px";
  }

  // ---------- open / close ----------
  function open(opts) {
    opts = opts || {};
    if (window.StartMenu) window.StartMenu.close();
    if (window.SystemBar) window.SystemBar.closePopups();
    if (window.Shortcuts) window.Shortcuts.closeHelp();
    if (window.ContextMenu && window.ContextMenu.isOpen()) window.ContextMenu.hide();
    if (window.ClipboardHistory && window.ClipboardHistory.isOpen) window.ClipboardHistory.close();
    pickerEl._target = opts.target !== undefined ? opts.target : editableTarget();
    state.query = "";
    state.cat = 0;
    search.value = "";
    pickerEl.hidden = false;
    render();
    if (opts.x != null || opts.y != null) position(opts.x, opts.y);
    else position(innerWidth / 2, innerHeight - 70);
    state.open = true;
    setTimeout(() => { search.focus(); search.select(); }, 30);
  }
  function close() {
    if (!state.open) return;
    state.open = false;
    pickerEl._target = null;
    pickerEl.hidden = true;
  }
  function toggle(x, y) {
    if (state.open) close();
    else open({ x, y });
  }

  // ---------- events ----------
  search.addEventListener("input", () => { state.query = search.value; render(); });
  search.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      const first = firstEmoji();
      if (first) insert(first);
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      close();
    }
  });
  closeBtn.addEventListener("click", close);
  document.addEventListener("mousedown", (ev) => {
    if (state.open && !pickerEl.contains(ev.target)) close();
  });
  document.addEventListener("keydown", (ev) => {
    if (state.open && ev.key === "Escape") { ev.preventDefault(); close(); }
  });
  window.addEventListener("resize", () => { if (state.open) close(); });

  // ---------- API ----------
  window.EmojiPicker = {
    open(opts) { open(opts); },
    openAt(x, y) { open({ x, y }); },
    openFor(anchor, target) {
      const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
      if (r && r.width) open({ x: r.left + r.width / 2, y: r.top, target: target || null });
      else open({ target: target || null });
    },
    toggle(x, y) { toggle(x, y); },
    close,
    get isOpen() { return state.open; },
  };
})();
