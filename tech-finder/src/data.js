window.TFDB = (function () {

  const OK = true;
  const SRC = {
    dell5420Support: { label: "Dell — Latitude 5420 support", url: "https://www.dell.com/support/home/en-us/product-support/product/latitude-5420-laptop/overview", ok: OK },
    dell5420Store: { label: "Dell — Latitude 5420 product & specs page", url: "https://www.dell.com/en-us/shop/laptops/latitude-14-5420-laptop/spd/latitude-5420-laptop", ok: OK },
    dell5420Manuals: { label: "Dell — Latitude 5420 manuals", url: "https://www.dell.com/support/product-details/en-us/product/latitude-5420-laptop/resources/manuals", ok: OK },
    dellE6420: { label: "Dell — Latitude E6420 support", url: "https://www.dell.com/support/home/en-us/product-support/product/latitude-e6420/overview", ok: OK },
    dellM4800: { label: "Dell — Precision M4800 support", url: "https://www.dell.com/support/home/en-us/product-support/product/precision-m4800-workstation/overview", ok: OK },
    appleAirM1: { label: "Apple — MacBook Air (M1, 2020) tech specs", url: "https://support.apple.com/en-us/111883", ok: OK },
    appleProM1: { label: "Apple — MacBook Pro 13\" (M1, 2020) tech specs", url: "https://support.apple.com/en-us/111893", ok: OK },
    lenovoT470: { label: "Lenovo — ThinkPad T470 support", url: "https://pcsupport.lenovo.com/us/en/products/laptops-and-netbooks/thinkpad-t-series-laptops/thinkpad-t470", ok: OK },
    lenovoT450: { label: "Lenovo — ThinkPad T450 support", url: "https://pcsupport.lenovo.com/us/en/products/laptops-and-netbooks/thinkpad-t-series-laptops/thinkpad-t450", ok: OK },
    hpProbook: { label: "HP — ProBook 450 G3 support (search)", url: "https://support.hp.com/us-en/search?q=HP+ProBook+450+G3", ok: null },
    hpEnvy: { label: "HP — Envy x360 13 (13-bf0xxx) support (search)", url: "https://support.hp.com/us-en/search?q=HP+Envy+x360+13-bf0xxx", ok: null },
    hpElite: { label: "HP — EliteBook 845 G8 support (search)", url: "https://support.hp.com/us-en/search?q=HP+EliteBook+845+G8", ok: null },
    meDrBattery: { label: "Memory Express — Dr.Battery ACUSBC65 65W USB-C adapter", url: "https://www.memoryexpress.com/Products/MX00115238", ok: OK },
    amzDell74: { label: "Amazon.ca — Billwisdom 65W AC adapter 7.4mm (3rd-party)", url: "https://www.amazon.ca/dp/B0F9VNPKFX", ok: OK },
    amzHpSmart: { label: "Amazon.ca — Easy Style HP Smart blue-tip 65W/45W (3rd-party)", url: "https://www.amazon.ca/dp/B07JKQCVR5", ok: OK },
    amzLenovoSlim: { label: "Amazon.ca — ThinkPad Yoga slim/square-tip 65W 20V (3rd-party)", url: "https://www.amazon.ca/dp/B0GX69LQ74", ok: OK }
  };

  const PROD = [
    {
      id: "dell-latitude-5420", brand: "Dell", line: "Latitude", model: "5420",
      name: "Dell Latitude 5420 (14\")", year: "2021",
      aliases: ["5420", "latitude 5420", "lat 5420", "dell 5420"],
      power: { conn: "usbc", watts: 65, note: "USB-C Power Delivery — Dell ships a 65W USB-C AC adapter" },
      specs: [
        { g: "Processor", l: "CPU", v: "11th Gen Intel Core (Tiger Lake-UP3) — up to Core i7-1185G7 · 4 cores / 8 threads · up to 4.8 GHz", vf: false },
        { g: "Power", l: "Charging", v: "Charges over USB-C (Thunderbolt 4 ports support USB Power Delivery)" },
        { g: "Power", l: "Included adapter", v: "65W USB-C AC adapter", vf: false },
        { g: "Display", l: "Panel", v: "14.0″ FHD+ (1920×1200) 16:10 WVA — touch / 2.2K configs offered", vf: false },
        { g: "Memory", l: "Type & slots", v: "DDR4-3200 · 2× SODIMM slots", s: 1, vf: true },
        { g: "Memory", l: "Max", v: "Up to 64 GB (2× 32 GB modules)", s: 1, vf: false },
        { g: "Storage", l: "Internal drive", v: "M.2 2230 / 2280 PCIe NVMe SSD (Gen 3/4)", s: 1, vf: true },
        { g: "Ports", l: "Connectivity", v: "2× Thunderbolt 4 (USB4 / PD / DisplayPort) · 1× USB-A 3.2 (1 w/ PowerShare) · RJ-45 · HDMI 2.0 · universal audio · microSD", s: 1, vf: true },
        { g: "Battery", l: "Options", v: "3-cell 42 Wh or 4-cell 63 Wh (ExpressCharge variants)", s: 1, vf: true },
        { g: "Physical", l: "Size", v: "H 19.3 mm · W 321.35 mm · D 212.1 mm", s: 1, vf: true },
        { g: "Physical", l: "Weight", v: "Starting ~3.08 lb (1.4 kg)", vf: false },
        { g: "Operating system", l: "Support", v: "Windows 10 / 11 Pro (Dell ships Win10 Pro; Ubuntu configs offered)", vf: false }
      ],
      sources: [SRC.dell5420Support, SRC.dell5420Store, SRC.dell5420Manuals],
      parts: {
        ram: { title: "Memory upgrade", detail: "2× DDR4-3200 SODIMM slots. Buy matched 3200 MT/s SODIMMs; up to 64 GB total.", term: "DDR4-3200 SODIMM 32GB laptop memory" },
        ssd: { title: "SSD upgrade", detail: "M.2 2280 or 2230 PCIe NVMe (Gen 3/4 compatible). Cloning + screw kit may be needed.", term: "M.2 NVMe SSD 1TB PCIe Gen4" },
        battery: { title: "Battery", detail: "Internal part — replace with the exact Dell service battery for the 5420 only.", term: "Dell Latitude 5420 battery", strict: true }
      }
    },
    {
      id: "dell-latitude-e6420", brand: "Dell", line: "Latitude", model: "E6420", modelCore: "6420",
      name: "Dell Latitude E6420 (14\")", year: "2011",
      aliases: ["e6420", "latitude e6420", "6420"],
      power: { conn: "dell74", watts: 65, volts: "19.5V", tip: "7.4 × 5.1 mm", note: "Dell barrel jack — Dell ships a 65W adapter with the large 7.4 mm tip" },
      specs: [
        { g: "Processor", l: "CPU", v: "2nd Gen Intel Core (Sandy Bridge) — up to Core i7-2720QM · 4 cores / 8 threads · 2.2–3.3 GHz", vf: false },
        { g: "Power", l: "Charging", v: "Barrel jack: Dell 7.4 mm plug, center-positive" },
        { g: "Power", l: "Included adapter", v: "65W (19.5V) Dell AC adapter", vf: false },
        { g: "Display", l: "Panel", v: "14.0″ HD (1366×768) or HD+ (1600×900) — config-dependent", vf: false },
        { g: "Memory", l: "Type & slots", v: "DDR3-1333/1600 · 2× SODIMM slots", vf: false },
        { g: "Memory", l: "Max", v: "8 GB per Dell; 16 GB is commonly used with 2nd-gen Core i7", vf: false },
        { g: "Storage", l: "Internal drive", v: "2.5″ SATA (HDD/SSD)", vf: false },
        { g: "Ports", l: "Connectivity", v: "USB 3.0 · USB 2.0 · eSATA · VGA · DisplayPort · Ethernet · 34mm ExpressCard · SD", vf: false },
        { g: "Battery", l: "Options", v: "External — 4/6/9-cell battery options", vf: false },
        { g: "Physical", l: "Weight", v: "≈ 4.4 lb (2.0 kg)", vf: false },
        { g: "Physical", l: "Dimensions", v: "≈ 338 × 236 × 31–38 mm", vf: false },
        { g: "Operating system", l: "Support", v: "Windows 7 / 8 / 10 (32/64-bit)", vf: false }
      ],
      sources: [SRC.dellE6420],
      parts: {
        ram: { title: "Memory upgrade", detail: "2× DDR3L SODIMM slots. 1600 MT/s works; watch for 1.35V low-voltage modules.", term: "DDR3L-1600 SODIMM 8GB laptop memory" },
        ssd: { title: "SSD upgrade", detail: "2.5″ SATA III — any 2.5″ SSD fits; a caddy/HDD bay exists in most configs.", term: "2.5 inch SATA SSD 1TB" },
        battery: { title: "Battery", detail: "External — match the Dell part number printed on your current battery exactly.", term: "Dell Latitude E6420 battery", strict: true }
      }
    },
    {
      id: "dell-precision-m4800", brand: "Dell", line: "Precision", model: "M4800", modelCore: "4800",
      name: "Dell Precision M4800 (15.6\")", year: "2013",
      aliases: ["m4800", "precision m4800", "4800"],
      power: { conn: "dell74", watts: 90, volts: "19.5V", tip: "7.4 × 5.1 mm", note: "Dell barrel jack — ships with the Dell 90W 7.4 mm adapter" },
      specs: [
        { g: "Processor", l: "CPU", v: "4th Gen Intel Core (Haswell) — up to Core i7-4940MX (or Xeon) · 4 cores / 8 threads · up to 4.0 GHz", vf: false },
        { g: "Power", l: "Charging", v: "Barrel jack: Dell 7.4 mm plug, center-positive" },
        { g: "Power", l: "Included adapter", v: "90W (19.5V) Dell AC adapter", vf: false },
        { g: "Display", l: "Panel", v: "15.6″ — HD / FHD / 4K IPS options", vf: false },
        { g: "Memory", l: "Type & slots", v: "DDR3L-1600 · 4× SODIMM slots", vf: false },
        { g: "Memory", l: "Max", v: "32 GB", vf: false },
        { g: "Storage", l: "Internal drive", v: "2.5″ SATA + optional mSATA", vf: false },
        { g: "Ports", l: "Connectivity", v: "USB 3.0 · VGA · HDMI · DisplayPort · Ethernet · ExpressCard · SD", vf: false },
        { g: "Battery", l: "Options", v: "Removable 6/9-cell", vf: false },
        { g: "Physical", l: "Weight", v: "≈ 6.4 lb (2.9 kg)", vf: false },
        { g: "Physical", l: "Dimensions", v: "≈ 382 × 262 × 34–40 mm", vf: false },
        { g: "Operating system", l: "Support", v: "Windows 7 / 8 / 10 · Linux", vf: false }
      ],
      sources: [SRC.dellM4800],
      parts: {
        ram: { title: "Memory upgrade", detail: "4× DDR3L SODIMM slots (4 DIMMs). 1600 MT/s, up to 32 GB.", term: "DDR3L-1600 SODIMM 8GB laptop memory" },
        ssd: { title: "SSD upgrade", detail: "2.5″ SATA III bay + optional mSATA. Any 2.5″ SSD fits.", term: "2.5 inch SATA SSD 1TB" },
        battery: { title: "Battery", detail: "Removable — match the Dell part number printed on the current battery.", term: "Dell Precision M4800 battery", strict: true }
      }
    },
    {
      id: "hp-probook-450-g3", brand: "HP", line: "ProBook", model: "450 G3", modelCore: "450g3",
      name: "HP ProBook 450 G3 (15.6\")", year: "2016",
      aliases: ["probook 450 g3", "probook 450", "450 g3", "hp 450"],
      power: { conn: "hpSmart", watts: 65, volts: "19.5V", tip: "4.5 × 3.0 mm", note: "HP Smart barrel (blue tip) — ships with the HP 65W Smart adapter" },
      specs: [
        { g: "Processor", l: "CPU", v: "6th Gen Intel Core (Skylake) — up to Core i7-6500U · 2 cores / 4 threads · 2.5–3.1 GHz", vf: false },
        { g: "Power", l: "Charging", v: "HP Smart barrel jack — 4.5×3.0 mm blue-tip plug, center-positive" },
        { g: "Power", l: "Included adapter", v: "65W (19.5V, 3.33A) HP Smart AC adapter", vf: false },
        { g: "Display", l: "Panel", v: "15.6″ HD (1366×768) TN or FHD IPS — config-dependent", vf: false },
        { g: "Memory", l: "Type & slots", v: "DDR4-2133 · 2× SODIMM slots", vf: false },
        { g: "Memory", l: "Max", v: "16 GB", vf: false },
        { g: "Storage", l: "Internal drive", v: "2.5″ SATA + M.2 SATA slot", vf: false },
        { g: "Ports", l: "Connectivity", v: "USB 3.0 · VGA · HDMI · DisplayPort · Ethernet · SD · DVD (opt.)", vf: false },
        { g: "Battery", l: "Options", v: "Removable 3-cell (40 Wh) / 6-cell", vf: false },
        { g: "Physical", l: "Weight", v: "≈ 4.5 lb (2.04 kg) starting", vf: false },
        { g: "Physical", l: "Dimensions", v: "≈ 384 × 257 × 24 mm", vf: false },
        { g: "Operating system", l: "Support", v: "Windows 7 / 10 (era-appropriate)", vf: false }
      ],
      sources: [SRC.hpProbook],
      parts: {
        ram: { title: "Memory upgrade", detail: "2× DDR4 SODIMM slots. 2133/2400 MT/s, up to 16 GB.", term: "DDR4-2400 SODIMM 8GB laptop memory" },
        ssd: { title: "SSD upgrade", detail: "2.5″ SATA bay (swap DVD caddy for extra drive) or M.2 SATA slot.", term: "2.5 inch SATA SSD 1TB" },
        battery: { title: "Battery", detail: "Removable — match the HP part number (starts with L\\d\\d\\d\\d\\d-\\d\\d\\d) on the battery.", term: "HP ProBook 450 G3 battery", strict: true }
      }
    },
    {
      id: "hp-envy-x360-13-bf0xxx", brand: "HP", line: "Envy x360", model: "13-bf0xxx",
      name: "HP Envy x360 13 (13-bf0xxx)", year: "2022",
      aliases: ["envy x360 13", "envy x360", "13-bf0", "13-bf0xxx", "envy 13"],
      power: { conn: "usbc", watts: 65, note: "USB-C Power Delivery — HP ships a 65W USB-C adapter" },
      specs: [
        { g: "Processor", l: "CPU", v: "AMD Ryzen 6000-series (Rembrandt) — e.g. Ryzen 5 6600U / Ryzen 7 6800U · 6–8 cores", vf: false },
        { g: "Power", l: "Charging", v: "USB-C (Power Delivery)", vf: false },
        { g: "Power", l: "Included adapter", v: "65W USB-C adapter", vf: false },
        { g: "Display", l: "Panel", v: "13.3″ 2-in-1 touch (FHD IPS / OLED options)", vf: false },
        { g: "Memory", l: "Type", v: "Soldered LPDDR4x — not upgradable", vf: false },
        { g: "Storage", l: "Internal drive", v: "M.2 2280 PCIe NVMe SSD", vf: false },
        { g: "Ports", l: "Connectivity", v: "2× USB-C (PD/DisplayPort) · USB-A · microSD · audio", vf: false },
        { g: "Battery", l: "Capacity", v: "Built-in, ~43 Wh class (varies by exact SKU)", vf: false },
        { g: "Physical", l: "Weight", v: "≈ 2.95 lb (1.34 kg)", vf: false },
        { g: "Physical", l: "Dimensions", v: "≈ 305 × 215 × 17 mm", vf: false },
        { g: "Operating system", l: "Support", v: "Windows 11", vf: false }
      ],
      sources: [SRC.hpEnvy],
      parts: {
        ram: { title: "Memory", detail: "Soldered — not upgradable. Choose the RAM config at purchase.", term: null },
        ssd: { title: "SSD upgrade", detail: "M.2 2280 PCIe NVMe — user-replaceable on most SKUs.", term: "M.2 NVMe SSD 1TB PCIe Gen4" },
        battery: { title: "Battery", detail: "Internal service part — HP part number required; service center recommended.", term: "HP Envy x360 13-bf0xxx battery", strict: true }
      }
    },
    {
      id: "hp-elitebook-845-g8", brand: "HP", line: "EliteBook", model: "845 G8", modelCore: "845g8",
      name: "HP EliteBook 845 G8 (14\")", year: "2021",
      aliases: ["elitebook 845 g8", "elitebook 845", "845 g8"],
      power: { conn: "usbc", watts: 65, note: "USB-C Power Delivery — HP ships a 65W USB-C adapter" },
      specs: [
        { g: "Processor", l: "CPU", v: "AMD Ryzen 5000 PRO-series — e.g. Ryzen 5 PRO 5650U / Ryzen 7 PRO 5850U · 6–8 cores", vf: false },
        { g: "Power", l: "Charging", v: "USB-C (Power Delivery)", vf: false },
        { g: "Power", l: "Included adapter", v: "65W USB-C adapter", vf: false },
        { g: "Display", l: "Panel", v: "14.0″ FHD (1920×1080) IPS — touch options", vf: false },
        { g: "Memory", l: "Type & slots", v: "DDR4-3200 · 2× SODIMM slots", vf: false },
        { g: "Memory", l: "Max", v: "64 GB", vf: false },
        { g: "Storage", l: "Internal drive", v: "M.2 2280 PCIe NVMe SSD", vf: false },
        { g: "Ports", l: "Connectivity", v: "2× USB-C (PD/DisplayPort) · 2× USB-A · HDMI 2.0 · RJ-45 · smart card (opt.)", vf: false },
        { g: "Physical", l: "Weight", v: "≈ 2.94 lb (1.33 kg) starting", vf: false },
        { g: "Physical", l: "Dimensions", v: "≈ 323 × 214 × 17 mm", vf: false },
        { g: "Operating system", l: "Support", v: "Windows 10 / 11 Pro · Linux", vf: false }
      ],
      sources: [SRC.hpElite],
      parts: {
        ram: { title: "Memory upgrade", detail: "2× DDR4 SODIMM slots. 3200 MT/s, up to 64 GB.", term: "DDR4-3200 SODIMM 32GB laptop memory" },
        ssd: { title: "SSD upgrade", detail: "M.2 2280 PCIe NVMe.", term: "M.2 NVMe SSD 1TB PCIe Gen4" },
        battery: { title: "Battery", detail: "Internal service part — HP part number required.", term: "HP EliteBook 845 G8 battery", strict: true }
      }
    },
    {
      id: "lenovo-thinkpad-t470", brand: "Lenovo", line: "ThinkPad", model: "T470", modelCore: "T470",
      name: "Lenovo ThinkPad T470 (14\")", year: "2017",
      aliases: ["thinkpad t470", "t470", "thinkpad"],
      power: { conn: "usbc", watts: 65, note: "USB-C Power Delivery — Lenovo ships a 65W USB-C adapter" },
      specs: [
        { g: "Processor", l: "CPU", v: "6th/7th Gen Intel Core (Skylake/Kaby Lake) — up to Core i7-7600U · 2 cores / 4 threads · 2.8–3.9 GHz", vf: false },
        { g: "Power", l: "Charging", v: "USB-C (Power Delivery)", vf: false },
        { g: "Power", l: "Included adapter", v: "65W USB-C AC adapter", vf: false },
        { g: "Display", l: "Panel", v: "14.0″ FHD (1920×1080) IPS — touch options", vf: false },
        { g: "Memory", l: "Type & slots", v: "DDR4-2133/2400 · 2× SODIMM slots", vf: false },
        { g: "Memory", l: "Max", v: "32 GB", vf: false },
        { g: "Storage", l: "Internal drive", v: "2.5″ SATA + M.2 2242 NVMe slot (or single M.2 configs)", vf: false },
        { g: "Ports", l: "Connectivity", v: "USB-C (PD) · 3× USB-A · HDMI · RJ-45 · SD · dock connector", vf: false },
        { g: "Battery", l: "Options", v: "Dual hot-swap batteries (internal + external 3/6-cell)", vf: false },
        { g: "Physical", l: "Weight", v: "≈ 3.6 lb (1.63 kg) starting", vf: false },
        { g: "Physical", l: "Dimensions", v: "≈ 336 × 232 × 20 mm", vf: false },
        { g: "Operating system", l: "Support", v: "Windows 7 / 8.1 / 10 · Linux", vf: false }
      ],
      sources: [SRC.lenovoT470],
      parts: {
        ram: { title: "Memory upgrade", detail: "2× DDR4 SODIMM slots. Up to 32 GB.", term: "DDR4-2400 SODIMM 16GB laptop memory" },
        ssd: { title: "SSD upgrade", detail: "2.5″ SATA bay and/or M.2 2242 NVMe — check your exact config.", term: "2.5 inch SATA SSD 1TB" },
        battery: { title: "Battery", detail: "Hot-swap — match the FRU part number on the battery label.", term: "Lenovo ThinkPad T470 battery", strict: true }
      }
    },
    {
      id: "lenovo-thinkpad-t450", brand: "Lenovo", line: "ThinkPad", model: "T450", modelCore: "T450",
      name: "Lenovo ThinkPad T450 (14\")", year: "2015",
      aliases: ["thinkpad t450", "t450"],
      power: { conn: "lenovoSlim", watts: 65, volts: "20V", tip: "Slim Tip (rectangular)", note: "Lenovo Slim Tip barrel — ships with a 65W 20V adapter" },
      specs: [
        { g: "Processor", l: "CPU", v: "5th Gen Intel Core (Broadwell) — up to Core i7-5600U · 2 cores / 4 threads · 2.6–3.2 GHz", vf: false },
        { g: "Power", l: "Charging", v: "Lenovo Slim Tip barrel (rectangular jack), center-positive", vf: false },
        { g: "Power", l: "Included adapter", v: "65W (20V) Lenovo Slim Tip adapter", vf: false },
        { g: "Display", l: "Panel", v: "14.0″ HD / FHD IPS", vf: false },
        { g: "Memory", l: "Type & slots", v: "DDR3L-1600 · 2× SODIMM slots", vf: false },
        { g: "Memory", l: "Max", v: "16 GB", vf: false },
        { g: "Storage", l: "Internal drive", v: "2.5″ SATA", vf: false },
        { g: "Ports", l: "Connectivity", v: "3× USB-A · VGA · miniDP · RJ-45 · SD · smart card (opt.)", vf: false },
        { g: "Battery", l: "Options", v: "Dual batteries (internal 3-cell + external 3/6-cell)", vf: false },
        { g: "Physical", l: "Weight", v: "≈ 3.7 lb (1.68 kg) starting", vf: false },
        { g: "Physical", l: "Dimensions", v: "≈ 339 × 232 × 21 mm", vf: false },
        { g: "Operating system", l: "Support", v: "Windows 7 / 8.1 / 10", vf: false }
      ],
      sources: [SRC.lenovoT450],
      parts: {
        ram: { title: "Memory upgrade", detail: "2× DDR3L SODIMM slots. 1600 MT/s, up to 16 GB.", term: "DDR3L-1600 SODIMM 8GB laptop memory" },
        ssd: { title: "SSD upgrade", detail: "2.5″ SATA III.", term: "2.5 inch SATA SSD 1TB" },
        battery: { title: "Battery", detail: "Dual-battery system — match FRU numbers on both batteries.", term: "Lenovo ThinkPad T450 battery", strict: true }
      }
    },
    {
      id: "apple-macbook-air-m1-a2337", brand: "Apple", line: "MacBook Air", model: "A2337", modelCore: "A2337",
      name: "Apple MacBook Air (M1, 2020) — A2337", year: "2020",
      aliases: ["macbook air m1", "macbook air 2020", "m1 macbook air", "a2337", "air m1"],
      power: { conn: "usbc", watts: 30, note: "USB-C Power Delivery — ships with Apple 30W USB-C Power Adapter" },
      specs: [
        { g: "Processor", l: "Chip", v: "Apple M1 — 8-core CPU (4 performance + 4 efficiency) · 7/8-core GPU · 16-core Neural Engine", s: 0, vf: true },
        { g: "Power", l: "Included adapter", v: "30W USB-C Power Adapter", s: 0, vf: true },
        { g: "Power", l: "Battery", v: "49.9 Wh built-in lithium-polymer", s: 0, vf: true },
        { g: "Power", l: "Charging", v: "USB-C / Thunderbolt 4 port (either port charges)", s: 0, vf: true },
        { g: "Display", l: "Panel", v: "13.3″ LED-backlit IPS 2560×1600 (227 ppi)", s: 0, vf: true },
        { g: "Memory", l: "Type & max", v: "8 GB unified memory (configurable to 16 GB) — not upgradable later", s: 0, vf: true },
        { g: "Storage", l: "Options", v: "256 GB – 2 TB SSD (config.)", s: 0, vf: true },
        { g: "Ports", l: "Connectivity", v: "2× Thunderbolt / USB 4 · 3.5 mm headphone", s: 0, vf: true },
        { g: "Physical", l: "Weight", v: "1.29 kg (2.8 lb)", s: 0, vf: true },
        { g: "Physical", l: "Dimensions", v: "H 0.41–1.61 cm · W 30.41 cm · D 21.24 cm", s: 0, vf: true },
        { g: "Operating system", l: "Support", v: "macOS (Big Sur 11.0 or later)", vf: false }
      ],
      sources: [SRC.appleAirM1],
      parts: {
        ram: { title: "Memory", detail: "Unified memory soldered to the M1 chip — not upgradable.", term: null },
        ssd: { title: "SSD", detail: "Soldered — not user-replaceable. Use external USB4/Thunderbolt storage.", term: "Thunderbolt 3 NVMe external SSD" },
        battery: { title: "Battery", detail: "Internal — Apple service only (top case assembly).", term: null, strict: true }
      }
    },
    {
      id: "apple-macbook-pro-13-m1-a2338", brand: "Apple", line: "MacBook Pro", model: "A2338", modelCore: "A2338",
      name: "Apple MacBook Pro 13\" (M1, 2020) — A2338", year: "2020",
      aliases: ["macbook pro 13 m1", "macbook pro m1", "a2338", "13 macbook pro m1", "mbp 13 m1"],
      power: { conn: "usbc", watts: 61, note: "USB-C Power Delivery — ships with Apple 61W USB-C Power Adapter" },
      specs: [
        { g: "Processor", l: "Chip", v: "Apple M1 — 8-core CPU (4 performance + 4 efficiency) · 8-core GPU · 16-core Neural Engine", s: 0, vf: true },
        { g: "Power", l: "Included adapter", v: "61W USB-C Power Adapter", s: 0, vf: true },
        { g: "Power", l: "Battery", v: "58.2 Wh built-in lithium-polymer", s: 0, vf: true },
        { g: "Power", l: "Charging", v: "USB-C / Thunderbolt port (either port charges)", s: 0, vf: true },
        { g: "Display", l: "Panel", v: "13.3″ LED-backlit IPS 2560×1600 (227 ppi)", s: 0, vf: true },
        { g: "Memory", l: "Type & max", v: "8 GB unified memory (configurable to 16 GB) — not upgradable later", s: 0, vf: true },
        { g: "Storage", l: "Options", v: "256 GB – 2 TB SSD (config.)", s: 0, vf: true },
        { g: "Ports", l: "Connectivity", v: "2× Thunderbolt / USB 4 · 3.5 mm headphone", s: 0, vf: true },
        { g: "Physical", l: "Weight", v: "1.4 kg (3.0 lb)", s: 0, vf: true },
        { g: "Physical", l: "Dimensions", v: "H 1.56 cm · W 30.41 cm · D 21.24 cm", s: 0, vf: true },
        { g: "Operating system", l: "Support", v: "macOS (Big Sur 11.0 or later)", vf: false }
      ],
      sources: [SRC.appleProM1],
      parts: {
        ram: { title: "Memory", detail: "Unified memory soldered to the M1 chip — not upgradable.", term: null },
        ssd: { title: "SSD", detail: "Soldered — not user-replaceable.", term: "Thunderbolt 3 NVMe external SSD" },
        battery: { title: "Battery", detail: "Internal — Apple service only.", term: null, strict: true }
      }
    }
  ];

  const CONN_KB = {
    usbc: {
      id: "usbc", label: "USB-C", sub: "USB Power Delivery",
      detail: "Modern standard: the adapter plugs into any USB-C port and negotiates voltage. Any good USB-C PD adapter at/above the laptop's rated wattage works (OEM recommended wattage gives full-speed charging).",
      badge: "usb-c pill socket", tip: null, volts: "PD negotiated",
      sources: [SRC.dell5420Store, SRC.appleAirM1],
      vf: true
    },
    dell74: {
      id: "dell74", label: "Dell barrel (large)", sub: "7.4 × 5.1 mm",
      detail: "Dell's large barrel plug (outer 7.4 mm, inner 5.1 mm), center-pin positive, 19.5V. Found on Latitude/Precision/Vostro before the USB-C switch (roughly 2009–2016). Same tip geometry is used from 65W up to 240W adapters.",
      badge: "barrel 7.4mm", tip: "7.4 × 5.1 mm", volts: "19.5V",
      sources: [SRC.dellE6420, SRC.dellM4800],
      vf: false
    },
    hpSmart: {
      id: "hpSmart", label: "HP Smart barrel", sub: "4.5 × 3.0 mm · blue tip",
      detail: "HP Smart plug — 4.5 mm outer, 3.0 mm inner, usually a blue tip, center-positive, 19.5V. Found on ProBook/EliteBook from roughly 2012–2018. (A second, narrower HP barrel — the 4.5mm 'round' tip used by newer Envy — is NOT the same.)",
      badge: "barrel 4.5mm blue", tip: "4.5 × 3.0 mm", volts: "19.5V",
      sources: [SRC.hpProbook],
      vf: false
    },
    lenovoSlim: {
      id: "lenovoSlim", label: "Lenovo Slim Tip", sub: "rectangular barrel · 20V",
      detail: "Lenovo's slim rectangular barrel (roughly 3.0 mm wide slot), center-positive, 20V. Found on ThinkPad T/X-series before the USB-C switch (T440–T460 era). The round 'classic' Lenovo tip of older models does not fit.",
      badge: "barrel slim tip", tip: "Slim Tip", volts: "20V",
      sources: [SRC.lenovoT450],
      vf: false
    }
  };

  const ADAPTERS = [
    {
      id: "dell-65-usbc", brand: "Dell", kind: "oem", watts: 65, volts: "PD (20V)", conn: "usbc",
      name: "Dell 65W USB-C AC Adapter", shortName: "Dell 65W USB-C",
      oemFor: ["dell-latitude-5420"],
      note: "The adapter Dell ships with the Latitude 5420 (and many other USB-C Latitudes). Part number printed on the label — buy from Dell or a reputable reseller.",
      term: "Dell 65W USB-C AC adapter", oemTerm: "Dell 65W USB-C adapter",
      sources: [SRC.dell5420Store, SRC.dell5420Support]
    },
    {
      id: "dell-65-74mm", brand: "Dell", kind: "oem", watts: 65, volts: "19.5V", conn: "dell74",
      name: "Dell 65W AC Adapter — 7.4mm barrel", shortName: "Dell 65W 7.4mm",
      oemFor: ["dell-latitude-e6420"],
      note: "Classic Dell 65W with the large 7.4 mm tip. Confirm your laptop's jack is 7.4×5.1 mm before buying.",
      term: "Dell 65W AC adapter 7.4mm", oemTerm: "Dell 65W AC adapter 7.4mm barrel",
      sources: [SRC.dellE6420]
    },
    {
      id: "dell-90-74mm", brand: "Dell", kind: "oem", watts: 90, volts: "19.5V", conn: "dell74",
      name: "Dell 90W AC Adapter — 7.4mm barrel", shortName: "Dell 90W 7.4mm",
      oemFor: ["dell-precision-m4800"],
      note: "Dell's 90W 7.4 mm adapter (ships with Precision M4800-class machines). Same tip as the 65W — can also run 65W-rated machines of the same era.",
      term: "Dell 90W AC adapter 7.4mm", oemTerm: "Dell 90W AC adapter 7.4mm barrel",
      sources: [SRC.dellM4800]
    },
    {
      id: "hp-65-smart", brand: "HP", kind: "oem", watts: 65, volts: "19.5V", conn: "hpSmart",
      name: "HP 65W Smart AC Adapter — 4.5×3.0mm blue tip", shortName: "HP 65W Smart",
      oemFor: ["hp-probook-450-g3"],
      note: "Standard HP Smart 65W (19.5V / 3.33A) with blue tip. Verify the blue tip matches your HP model — newer HP laptops use USB-C instead.",
      term: "HP 65W Smart AC adapter blue tip", oemTerm: "HP 65W Smart adapter 4.5mm",
      sources: [SRC.hpProbook]
    },
    {
      id: "hp-65-usbc", brand: "HP", kind: "oem", watts: 65, volts: "PD (20V)", conn: "usbc",
      name: "HP 65W USB-C AC Adapter", shortName: "HP 65W USB-C",
      oemFor: ["hp-envy-x360-13-bf0xxx", "hp-elitebook-845-g8"],
      note: "The USB-C adapter HP ships with Envy x360 / EliteBook-class machines (PD, 65W). Any HP or third-party USB-C PD adapter at ≥65W also works — the USB-C port negotiates.",
      term: "HP 65W USB-C AC adapter", oemTerm: "HP 65W USB-C adapter",
      sources: [SRC.hpEnvy, SRC.hpElite]
    },
    {
      id: "lenovo-65-usbc", brand: "Lenovo", kind: "oem", watts: 65, volts: "PD (20V)", conn: "usbc",
      name: "Lenovo 65W USB-C AC Adapter", shortName: "Lenovo 65W USB-C",
      oemFor: ["lenovo-thinkpad-t470"],
      note: "The USB-C adapter Lenovo ships with ThinkPad T470 / T480-class machines.",
      term: "Lenovo 65W USB-C AC adapter", oemTerm: "Lenovo 65W USB-C adapter",
      sources: [SRC.lenovoT470]
    },
    {
      id: "lenovo-65-slim", brand: "Lenovo", kind: "oem", watts: 65, volts: "20V", conn: "lenovoSlim",
      name: "Lenovo 65W Slim Tip AC Adapter (20V)", shortName: "Lenovo 65W Slim Tip",
      oemFor: ["lenovo-thinkpad-t450"],
      note: "Lenovo's slim rectangular-tip 65W (20V / 3.25A) adapter — ships with ThinkPad T450 / T460 class machines.",
      term: "Lenovo 65W Slim Tip AC adapter", oemTerm: "Lenovo 65W Slim tip adapter 20V",
      sources: [SRC.lenovoT450]
    },
    {
      id: "apple-30-usbc", brand: "Apple", kind: "oem", watts: 30, volts: "PD (20V/15V/9V/5V)", conn: "usbc",
      name: "Apple 30W USB-C Power Adapter", shortName: "Apple 30W USB-C",
      oemFor: ["apple-macbook-air-m1-a2337"],
      note: "Included with MacBook Air (M1, 2020). Apple part number printed on the adapter body.",
      term: "Apple 30W USB-C Power Adapter", oemTerm: "Apple 30W USB-C power adapter",
      sources: [SRC.appleAirM1]
    },
    {
      id: "apple-61-usbc", brand: "Apple", kind: "oem", watts: 61, volts: "PD (20V/15V/9V/5V)", conn: "usbc",
      name: "Apple 61W USB-C Power Adapter", shortName: "Apple 61W USB-C",
      oemFor: ["apple-macbook-pro-13-m1-a2338"],
      note: "Included with MacBook Pro 13\" (M1, 2020). Apple part number printed on the adapter body.",
      term: "Apple 61W USB-C Power Adapter", oemTerm: "Apple 61W USB-C power adapter",
      sources: [SRC.appleProM1]
    },
    {
      id: "drbattery-65-usbc", brand: "Dr.Battery", kind: "3p", watts: 65, volts: "PD (20V)", conn: "usbc",
      name: "Dr.Battery 65W USB-C AC Adapter (ACUSBC65)", shortName: "Dr.Battery 65W USB-C",
      oemFor: [],
      note: "Third-party 65W USB-C PD adapter (Canada). Third-party USB-C chargers work with any PD laptop if wattage is sufficient and the charger is a reputable brand.",
      term: "65W USB-C PD laptop charger", oemTerm: null,
      sources: [SRC.meDrBattery]
    },
    {
      id: "3p-dell-65-74mm", brand: "Billwisdom", kind: "3p", watts: 65, volts: "19.5V", conn: "dell74",
      name: "Billwisdom 65W AC Adapter — 7.4mm barrel (Amazon.ca)", shortName: "Billwisdom 65W 7.4mm",
      oemFor: [],
      note: "Third-party Dell-style 65W (19.5V) with the large 7.4mm tip, sold on Amazon.ca. Confirm your jack is 7.4×5.1 mm and match any OEM part number on the listing before ordering.",
      term: "Dell 65W AC adapter 7.4mm barrel", oemTerm: null,
      sources: [SRC.amzDell74]
    },
    {
      id: "3p-hp-65-smart", brand: "Easy Style", kind: "3p", watts: 65, volts: "19.5V", conn: "hpSmart",
      name: "Easy Style 65W HP Smart Adapter — 4.5×3.0mm blue tip (Amazon.ca)", shortName: "Easy Style 65W HP Smart",
      oemFor: [],
      note: "Third-party HP Smart 65W/45W (19.5V) with the 4.5×3.0 mm blue tip, sold on Amazon.ca. Verify the blue tip against your HP model before buying.",
      term: "HP 65W Smart AC adapter blue tip 4.5mm", oemTerm: null,
      sources: [SRC.amzHpSmart]
    },
    {
      id: "3p-lenovo-65-slim", brand: "3rd-party", kind: "3p", watts: 65, volts: "20V", conn: "lenovoSlim",
      name: "65W Lenovo Slim/Square-Tip Adapter — 20V (Amazon.ca)", shortName: "3rd-party 65W Slim Tip",
      oemFor: [],
      note: "Third-party 65W (20V / 3.25A) with Lenovo's slim rectangular tip, sold on Amazon.ca — compatible with T450/T460-era ThinkPads. Confirm the rectangular jack before ordering.",
      term: "Lenovo 65W Slim Tip AC adapter 20V", oemTerm: null,
      sources: [SRC.amzLenovoSlim]
    }
  ];

  return { PROD, ADAPTERS, CONN_KB, SRC };
})();
