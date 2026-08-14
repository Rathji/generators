(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // wsf:src/openciv-src/shims/ws
  var EventEmitter = class {
    constructor() {
      __publicField(this, "handlers", /* @__PURE__ */ new Map());
    }
    on(event, cb) {
      const list = this.handlers.get(event) || [];
      list.push(cb);
      this.handlers.set(event, list);
    }
    addEventListener(event, cb) {
      this.on(event, cb);
    }
    emit(event, ...args) {
      const list = this.handlers.get(event);
      if (list) for (const cb of [...list]) cb(...args);
    }
  };
  var ServerSocket = class extends EventEmitter {
    constructor() {
      super(...arguments);
      __publicField(this, "readyState", 0);
      __publicField(this, "client");
    }
    send(data) {
      if (this.client) queueMicrotask(() => this.client.emit("message", { data }));
    }
    close(code, reason) {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.emit("close", code ?? 1e3);
      if (this.client) this.client.close();
    }
    ping() {
    }
    terminate() {
      this.close();
    }
  };
  __publicField(ServerSocket, "CONNECTING", 0);
  __publicField(ServerSocket, "OPEN", 1);
  __publicField(ServerSocket, "CLOSED", 3);
  var LocalWebSocket = class extends EventEmitter {
    constructor(url) {
      super();
      __publicField(this, "readyState", 0);
      __publicField(this, "onerror", null);
      __publicField(this, "serverSocket");
      const { serverSocket } = LocalServerHub.connect(url);
      this.serverSocket = serverSocket;
      serverSocket.client = this;
      serverSocket.on("close", (code) => {
        this.readyState = 3;
        this.emit("close", { code });
      });
      queueMicrotask(() => {
        this.readyState = 1;
        this.emit("open", {});
      });
    }
    send(data) {
      this.serverSocket.emit("message", data);
    }
    close(code, reason) {
      if (this.readyState === 3) return;
      this.serverSocket.close(code, reason);
      this.readyState = 3;
    }
  };
  __publicField(LocalWebSocket, "CONNECTING", 0);
  __publicField(LocalWebSocket, "OPEN", 1);
  __publicField(LocalWebSocket, "CLOSED", 3);
  var WebSocketServer = class extends EventEmitter {
    constructor(_options) {
      super();
      LocalServerHub.register(this);
    }
    close() {
    }
  };
  var _LocalServerHub = class _LocalServerHub {
    static register(server) {
      _LocalServerHub.servers.push(server);
    }
    static connect(_url) {
      const server = _LocalServerHub.servers[_LocalServerHub.servers.length - 1];
      const serverSocket = new ServerSocket();
      const request = { socket: { remoteAddress: "127.0.0.1" } };
      queueMicrotask(() => {
        try {
          server.emit("connection", serverSocket, request);
        } catch (e) {
          console.error("LocalServerHub connection handler threw:", e);
        }
      });
      return { serverSocket, request };
    }
  };
  __publicField(_LocalServerHub, "servers", []);
  var LocalServerHub = _LocalServerHub;

  // wsf:src/openciv-src/shims/global-setup
  globalThis.WebSocket = LocalWebSocket;
  globalThis.process = globalThis.process || {
    env: {},
    argv: [],
    exit: (code) => console.log("[openciv] process.exit(" + code + ")")
  };

  // wsf:src/openciv-src/server/src/Events
  var CallbackData = class {
    // Not associated with the current scene.
    constructor(parentObject, callbackFunctions, globalEvent) {
      __publicField(this, "parentObject");
      __publicField(this, "callbackFunction");
      __publicField(this, "globalEvent");
      this.parentObject = parentObject;
      this.callbackFunction = callbackFunctions;
      this.globalEvent = globalEvent;
    }
  };
  var ServerEvents = class {
    constructor() {
    }
    static call(eventName, data, websocket) {
      if (this.storedEvents.has(eventName)) {
        const callbackDataList = this.storedEvents.get(eventName);
        for (let callbackData of callbackDataList) {
          callbackData.callbackFunction(data, websocket);
        }
      }
    }
    /**
     * Register a callback function to be called when a network event is received.
     *
     * @param {OnNetworkEventOptions} options - Options for the event listener.
     * @param {string} options.eventName - The name of the event to listen for.
     * @param {(data: Record<string, any>) => void} options.callback - The callback function to be called when the event is received.
     * @param {boolean} [options.globalEvent=false] - Determine if we don't remove the event when the state changes.
     */
    static on(options) {
      if (!this.storedEvents) {
        this.storedEvents = /* @__PURE__ */ new Map();
      }
      this.addCallbackEvent(
        this.storedEvents,
        options.eventName,
        options.parentObject,
        options.callback,
        options.globalEvent
      );
    }
    /**
     * Removes all associated callback functions that isn't a globalEvent
     */
    static clear() {
      const globalEventCallbacks = this.getGlobalEventCallbacks();
      this.storedEvents = globalEventCallbacks;
    }
    static removeCallbacksByParentObject(parentObj) {
      this.storedEvents.forEach((callbackDataList, eventName) => {
        const filteredDataList = callbackDataList.filter((callbackData) => callbackData.parentObject !== parentObj);
        if (filteredDataList.length === 0) {
          this.storedEvents.delete(eventName);
        } else {
          this.storedEvents.set(eventName, filteredDataList);
        }
      });
    }
    static getGlobalEventCallbacks() {
      const globalEventCallbacks = /* @__PURE__ */ new Map();
      this.storedEvents.forEach((callbackDataList, eventName) => {
        for (const callbackData of callbackDataList) {
          if (callbackData.globalEvent) {
            this.addCallbackEvent(
              globalEventCallbacks,
              eventName,
              callbackData.parentObject,
              callbackData.callbackFunction,
              true
            );
          }
        }
      });
      return globalEventCallbacks;
    }
    static addCallbackEvent(storedEvents, eventName, parentObject, callback, globalEvent = false) {
      let callbackDataList = storedEvents.get(eventName) ?? [];
      callbackDataList.push(new CallbackData(parentObject, callback, globalEvent));
      storedEvents.set(eventName, callbackDataList);
    }
  };
  __publicField(ServerEvents, "storedEvents");

  // wsf:src/openciv-src/server/src/Game
  var _Game = class _Game {
    constructor() {
      __publicField(this, "currentState");
      __publicField(this, "states");
      __publicField(this, "players");
      this.states = /* @__PURE__ */ new Map();
      ServerEvents.on({
        eventName: "setState",
        parentObject: this,
        callback: (data) => {
          this.setState(data["state"]);
        },
        globalEvent: true
      });
      ServerEvents.on({
        eventName: "connectedPlayers",
        parentObject: this,
        callback: (data, websocket) => {
          const requestingPlayerName = this.getPlayerFromWebsocket(websocket)?.getName();
          websocket.send(
            JSON.stringify({
              event: "connectedPlayers",
              players: this.getPlayerJSONS(),
              requestingName: requestingPlayerName
            })
          );
        },
        globalEvent: true
      });
      ServerEvents.on({
        eventName: "playerQuit",
        parentObject: this,
        callback: (data) => {
          if (this.players.size <= 1) {
            this.setState("lobby");
          }
        },
        globalEvent: true
      });
    }
    static getInstance() {
      return this.gameInstance;
    }
    /**
     * Initializes the game by setting up server event listeners for various events.
     */
    static init() {
      this.gameInstance = new _Game();
    }
    /**
     * Adds a state to the states map.
     * @param stateName - The name of the state.
     * @param state - The state object to add.
     */
    addState(stateName, state) {
      this.states.set(stateName, state);
    }
    /**
     * Sets the current state of the game.
     * @param stateName - The name of the state to set.
     */
    setState(stateName) {
      const newState = this.states.get(stateName);
      if (this.currentState != null) {
        this.currentState.onDestroyed();
      }
      this.currentState = newState;
      this.currentState.onInitialize();
    }
    /**
     * Returns the map containing all the players in the game.
     * Creates a new map if it doesn't exist.
     */
    getPlayers() {
      if (!this.players) {
        this.players = /* @__PURE__ */ new Map();
      }
      return this.players;
    }
    /**
     * Returns the player object associated with a websocket.
     * @param websocket - The websocket to check.
     * @returns - The player object associated with the websocket or undefined if not found.
     */
    getPlayerFromWebsocket(websocket) {
      for (const player of this.players.values()) {
        if (player.getWebsocket() === websocket) {
          return player;
        }
      }
      return void 0;
    }
    getCurrentStateAs() {
      return this.currentState;
    }
    getPlayerJSONS() {
      const playerJSONS = [];
      for (const player of this.players.values()) {
        playerJSONS.push(player.toJSON());
      }
      return playerJSONS;
    }
  };
  __publicField(_Game, "gameInstance");
  var Game = _Game;

  // wsf:src/openciv-src/server/src/state/State
  var _State = class _State {
    onInitialize() {
    }
    onDestroyed() {
      ServerEvents.clear();
      return _State.ExitReceipt;
    }
  };
  //We use ExitReceipt to used the parent onDestroyed() function is always called for child states.
  __publicField(_State, "ExitReceipt", new class {
  }());
  var State = _State;

  // wsf:src/openciv-src/shims/random
  var random = {
    int(min, max) {
      return Math.floor(Math.random() * (max - min + 1)) + min;
    },
    float(min = 0, max = 1) {
      return Math.random() * (max - min) + min;
    },
    bool() {
      return Math.random() < 0.5;
    }
  };
  var random_default = random;

  // wsf:src/openciv-src/server/src/map/TileIndexer
  var TileIndexer = class {
    static addTileType(tileType, tile) {
      if (!this.tileIndex.has(tileType)) {
        this.tileIndex.set(tileType, [tile]);
        return;
      }
      this.tileIndex.get(tileType).push(tile);
    }
    static removeTileType(tileType, tile) {
      const tiles = this.tileIndex.get(tileType);
      if (!tiles) return;
      const indexTile = tiles[tiles.indexOf(tile)];
      if (!indexTile) return;
      if (tile.getX() != indexTile.getX() || tile.getY() != indexTile.getY()) {
        console.log("Mismatch");
        throw new Error();
      }
      tiles.splice(tiles.indexOf(tile), 1);
    }
    static clearTileTypes(tile) {
      for (const [tileType, tiles] of this.tileIndex.entries()) {
        if (tiles.includes(tile)) {
          this.removeTileType(tileType, tile);
        }
      }
    }
    static getTilesByTileType(tileType) {
      if (!this.tileIndex.has(tileType)) {
        console.log("WARNING: Couldn't find any tiles w/ tile-type: " + tileType);
        return [];
      }
      return this.tileIndex.get(tileType);
    }
  };
  __publicField(TileIndexer, "tileIndex", /* @__PURE__ */ new Map());

  // wsf:src/openciv-src/shims/config-data
  var CONFIG_FILES = {
    "civilizations.yml": `{"civilizations":[{"name":"Rome","icon_name":"ROME_ICON","inside_border_color":"rgba(70,0,118,0.20 )","outside_border_color":"rgb(240,199,0)","start_bias":"none","start_bias_desc":"No start bias","unique_unit_descs":["Balista (Replaces Catapult)","Legion (Replaces Swordsman)"],"ability_descs":["+25% production towards any buildings that already exist in the capital."],"cities":["Rome","Antium","Cumae","Neapolis","Ravenna","Arretium","Mediolanum","Arpinum","Circei","Setia"]},{"name":"Mongolia","icon_name":"MONGOLIA_ICON","inside_border_color":"rgba(81,0,9,0.25)","outside_border_color":"rgb(255,120,0)","start_bias":"plains","start_bias_desc":"Start bias for: Plains","unique_unit_descs":["Keshik (Replaces Knight)","Kahn (Replaces Great General)"],"ability_descs":["+30% Combat Strength when fighting City-States.","All cavalry units have +1 movement."],"cities":["Karakorum","Beshbalik","Turfan","Hsia","Old Sarai","New Sarai","Tabriz","Tiflis","Otrar","Sanchu"]},{"name":"Mamluks","icon_name":"MAMLUKS_ICON","inside_border_color":"rgba(255,252,3,0.25)","outside_border_color":"rgb(255,255,255)","start_bias":"desert","start_bias_desc":"Start bias for: Desert","unique_unit_descs":["Salihi (Replaces Knight)"],"unique_building_descs":["Madrasah (Replaces University)"],"ability_descs":["Forts provide +1 production, an additional +1 gold during war.","Receive free mounted units whenever a Great Prophet is born."],"cities":["Cairo","Damascus","Aleppo","Hama","Alexandria","Gaza","Tripoli","Jerusalem","Aswan","Mosul"]},{"name":"America","icon_name":"AMERICA_ICON","inside_border_color":"rgba(31,51,120,0.35)","outside_border_color":"rgb(255,255,255)","start_bias":"none","start_bias_desc":"No start bias","unique_unit_descs":["B17 Bomber (Replaces Bomber)","Minuteman (Replaces Musketman)"],"ability_descs":["All land military units have +1 sight.","+50% Discount when purchasing tiles."],"cities":["Washington","New York","Boston","Philadelphia","Atlanta","Chicago","Seattle","San Francisco","Los Angeles","Houston"]},{"name":"Germany","icon_name":"GERMANY_ICON","inside_border_color":"rgba(179,178,184,0.35)","outside_border_color":"rgb(37,43,33)","start_bias":"none","start_bias_desc":"No start bias","unique_unit_descs":["Landsknecht (Replaces Pikeman)","Panzer (Replaces Tank)"],"unique_building_descs":["Hanse (Replaces Bank)"],"ability_descs":["Ability to convert barbarian camps to German units.","+25% Less unit maintenance costs."],"cities":["Berlin","Hamburg","Munich","Cologne","Frankfurt","Essen","Dortmund","Stuttgart","D\xFCsseldorf","Bremen"]},{"name":"England","inside_border_color":"rgba(109,2,0,0.30)","outside_border_color":"rgb(255,255,255)","icon_name":"ENGLAND_ICON","start_bias":"shallow_ocean","start_bias_desc":"Start bias for: Shallow Ocean","unique_unit_descs":["Longbowman (Replaces Crossbowman)","Ship of the Line (Replaces Frigate)"],"ability_descs":["+2 Movement for all naval units.","+1 Extra spy."],"cities":["London","York","Nottingham","Hastings","Canterbury","Coventry","Warwick","Newcastle","Oxford","Liverpool"]},{"name":"Cuba","icon_name":"CUBA_ICON","inside_border_color":"rgba(31,51,120,0.35)","outside_border_color":"blue","start_bias":"shallow_ocean","start_bias_desc":"Start bias for: Shallow Ocean","unique_unit_descs":["Guerrillero (Replaces Great War Infrantry)"],"unique_building_descs":["Dance Hall (Replaces Opera House)"],"ability_descs":["+20% Combat strength for land units adjacent to shallow ocean tiles."],"cities":["Havana","Santiago de Cuba","Camag\xFCey","Holgu\xEDn","Santa Clara","Guantanamo","Bayamo","Cienfuegos","Pinar del R\xEDo","Matanzas"]},{"name":"Canada","icon_name":"CANADA_ICON","inside_border_color":"rgba(255,255,255,0.25)","outside_border_color":"red","start_bias":"tundra","start_bias_desc":"Start bias for: Tundra","unique_unit_descs":["Mountie (Replaces Light Cavalry)","Great Voyageur (Replaces Great Merchant)"],"unique_building_descs":["Hudson's Bay Company (Replaces Bank)"],"ability_descs":["Cannot declare war on city-states.","Can build farms on tundra tiles."],"cities":["Toronto","Montr\xE9al","Quebec City","Hamilton","Winnipeg","Halifax","Saint John","Vancouver","Victoria","Kingston"]}]}`,
    "buildings.yml": '{"buildings":[{"name":"Palace","asset_name":"BUILDING_PALACE","stats":[{"science":3},{"production":3},{"gold":2},{"defense":2},{"culture":1}]}]}',
    "tiles.yml": '{"tiles":{"GRASS":{"name":"Grass","stats":[{"food":2}]},"PLAINS":{"name":"Plains","stats":[{"food":1},{"production":1}]},"TUNDRA":{"name":"Tundra","stats":[{"food":1}]},"DESERT":{"name":"Desert","stats":[]},"FLOODPLAINS":{"name":"Floodplains","stats":[{"food":2}]},"SNOW":{"name":"Snow","stats":[]},"FRESHWATER":{"name":"Freshwater","stats":[{"food":2}]},"SHALLOW_OCEAN":{"name":"Shallow Ocean","stats":[{"food":1}]},"OCEAN":{"name":"Ocean","stats":[{"food":1}]},"GRASS_HILL":{"name":"Grass Hill","stats":[{"production":2}]},"PLAINS_HILL":{"name":"Plains Hill","stats":[{"production":2}]},"DESERT_HILL":{"name":"Desert Hill","stats":[{"production":2}]},"TUNDRA_HILL":{"name":"Tundra Hill","stats":[{"production":2}]},"SNOW_HILL":{"name":"Snow Hill","stats":[{"production":2}]},"HORSES":{"name":"Horses","stats":[{"production":1}]},"IMPROVED_HORSES":{"name":"Improved Horses","stats":[{"production":2}]},"CATTLE":{"name":"Cattle","stats":[{"production":1}]},"IMPROVED_CATTLE":{"name":"Improved Cattle","stats":[{"production":2}]},"SHEEP":{"name":"Sheep","stats":[{"production":1}]},"IMPROVED_SHEEP":{"name":"Improved Sheep","stats":[{"production":2}]},"COPPER":{"name":"Copper","stats":[{"gold":2}]},"COPPER_MINE":{"name":"Copper Mine","stats":[{"gold":2},{"production":1}]},"GOLD":{"name":"Gold","stats":[{"gold":2}]},"IRON":{"name":"Iron","stats":[{"production":1}]},"IRON_MINE":{"name":"Iron Mine","stats":[{"production":2}]},"STONE":{"name":"Stone","stats":[{"production":1}]},"STONE_QUARRY":{"name":"Stone Quarry","stats":[{"production":2}]},"FISH":{"name":"Fish","stats":[{"food":1}]},"IMPROVED_FISH":{"name":"Improved Fish","stats":[{"food":2}]},"CRAB":{"name":"Crab","stats":[{"food":1}]},"IMPROVED_CRAB":{"name":"Improved Crab","stats":[{"food":2}]},"WHALES":{"name":"Whales","stats":[{"food":1},{"gold":1}]},"IMPROVED_WHALES":{"name":"Improved Whales","stats":[{"food":2},{"gold":1}]},"TURTLES":{"name":"Turtles","stats":[{"food":1},{"gold":1}]},"IMPROVED_TURTLES":{"name":"Improved Turtles","stats":[{"food":2},{"gold":1}]},"CITRUS":{"name":"Citrus","stats":[{"food":1},{"gold":1}]},"CITRUS_PLANTATION":{"name":"Citrus Plantation","stats":[{"food":1},{"gold":2}]},"COTTON":{"name":"Cotton","stats":[{"gold":2}]},"COTTON_PLANTATION":{"name":"Cotton Plantation","stats":[{"gold":3}]},"OLIVES":{"name":"Olives","stats":[{"gold":1},{"production":1}]},"OLIVE_PLANTATION":{"name":"Olive Plantation","stats":[{"gold":2},{"production":1}]}}}',
    "map_resources.yml": '{"bonus_resources":[{"name":"cattle","spawn_tiles":["grass"],"path_length":1,"min_tiles_set":1,"max_tiles_set":3,"set_chance":0.05,"min_temp":32,"max_temp":90},{"name":"sheep","spawn_tiles":["grass","grass_hill","plains","plains_hill"],"path_length":1,"min_tiles_set":1,"max_tiles_set":3,"set_chance":0.05,"min_temp":0,"max_temp":90},{"name":"fish","spawn_tiles":["freshwater","shallow_ocean"],"path_length":1,"min_tiles_set":1,"max_tiles_set":4,"set_chance":0.1,"min_temp":0,"max_temp":100},{"name":"stone","spawn_tiles":["grass","grass_hill","plains","plains_hill","tundra","tundra_hill","desert","desert_hill","snow","snow_hill"],"path_length":1,"min_tiles_set":1,"max_tiles_set":2,"set_chance":0.1,"min_temp":0,"max_temp":100}],"strategic_resources":[{"name":"horses","spawn_tiles":["grass","grass_hill","plains","plains_hill","tundra","tundra_hill"],"path_length":1,"min_tiles_set":1,"max_tiles_set":2,"set_chance":0.1,"min_temp":0,"max_temp":90},{"name":"iron","spawn_tiles":["grass","grass_hill","plains","plains_hill","tundra","tundra_hill","desert","desert_hill","snow","snow_hill"],"path_length":1,"min_tiles_set":1,"max_tiles_set":3,"set_chance":0.05,"min_temp":0,"max_temp":100,"spawn_on_additional_tile_types":true}],"luxury_resources":[{"name":"citrus","spawn_tiles":["jungle","forest","grass"],"path_length":1,"min_tiles_set":1,"max_tiles_set":1,"set_chance":0.1,"min_temp":60,"max_temp":100,"spawn_on_additional_tile_types":true},{"name":"cotton","spawn_tiles":["grass","grass_hill","plains","plains_hill","desert"],"path_length":1,"min_tiles_set":1,"max_tiles_set":1,"set_chance":0.1,"min_temp":70,"max_temp":100},{"name":"copper","spawn_tiles":["grass","grass_hill","plains","plains_hill","tundra","tundra_hill","desert","desert_hill","snow","snow_hill"],"path_length":1,"min_tiles_set":1,"max_tiles_set":2,"set_chance":0.1,"min_temp":0,"max_temp":100,"spawn_on_additional_tile_types":true},{"name":"gold","spawn_tiles":["grass","grass_hill","plains","plains_hill","tundra","tundra_hill","desert","desert_hill","snow","snow_hill"],"path_length":1,"min_tiles_set":1,"max_tiles_set":2,"set_chance":0.1,"min_temp":0,"max_temp":100,"spawn_on_additional_tile_types":true},{"name":"crab","spawn_tiles":["freshwater","shallow_ocean"],"path_length":1,"min_tiles_set":1,"max_tiles_set":2,"set_chance":0.05,"min_temp":0,"max_temp":100},{"name":"whales","spawn_tiles":["shallow_ocean"],"path_length":1,"min_tiles_set":1,"max_tiles_set":2,"set_chance":0.05,"min_temp":0,"max_temp":100},{"name":"turtles","spawn_tiles":["freshwater","shallow_ocean"],"path_length":1,"min_tiles_set":1,"max_tiles_set":2,"set_chance":0.05,"min_temp":0,"max_temp":100},{"name":"olives","spawn_tiles":["grass"],"path_length":1,"min_tiles_set":1,"max_tiles_set":2,"set_chance":0.05,"min_temp":60,"max_temp":90}]}'
  };

  // wsf:src/openciv-src/shims/fs
  var fs_default = {
    readFileSync(path) {
      const key = String(path).split("/").pop();
      if (key && CONFIG_FILES[key]) return CONFIG_FILES[key];
      throw new Error("fs shim: unknown file: " + path);
    }
  };

  // wsf:src/openciv-src/shims/yaml
  var yaml_default = {
    parse(str) {
      return JSON.parse(str);
    }
  };

  // wsf:src/openciv-src/server/src/map/Tile
  var _Tile = class _Tile {
    constructor(tileType, x, y) {
      //== Generation Values ==
      __publicField(this, "generationHeight");
      __publicField(this, "generationTemp");
      //== Generation Values ==
      __publicField(this, "tileTypes");
      __publicField(this, "adjacentTiles");
      __publicField(this, "riverSides");
      __publicField(this, "units");
      __publicField(this, "x");
      __publicField(this, "y");
      __publicField(this, "city");
      this.generationHeight = 0;
      this.generationTemp = 0;
      this.tileTypes = [];
      this.adjacentTiles = [];
      this.riverSides = new Array(6).fill(false);
      this.units = [];
      this.x = x;
      this.y = y;
      this.addTileType(tileType);
    }
    static getAllTileStats() {
      if (!_Tile.allTileStats) {
        const tileYAMLData = yaml_default.parse(fs_default.readFileSync("./config/tiles.yml", "utf-8"));
        _Tile.allTileStats = JSON.parse(JSON.stringify(tileYAMLData.tiles));
      }
      return _Tile.allTileStats;
    }
    setCity(city) {
      this.addTileType("city");
      this.city = city;
    }
    getCity() {
      return this.city;
    }
    addUnit(unit) {
      this.units.push(unit);
    }
    removeUnit(unit) {
      this.units = this.units.filter((existingUnit) => existingUnit !== unit);
    }
    getRiverSides() {
      return this.riverSides;
    }
    setRiverSide(side, value, cacheEntry = true) {
      const tilesEffected = /* @__PURE__ */ new Map();
      this.riverSides[side] = value;
      if (this.containsTileType("snow")) {
      }
      tilesEffected.set(this, side);
      const oppositeSides = [3, 4, 5, 0, 1, 2];
      const oppositeTile = this.adjacentTiles[side];
      const oppositeTileSide = oppositeSides[side];
      if (oppositeTile && oppositeTile.getRiverSides()[oppositeTileSide] !== value) {
        oppositeTile.getRiverSides()[oppositeTileSide] = value;
        tilesEffected.set(oppositeTile, oppositeTileSide);
      }
      if (cacheEntry) GameMap.getInstance().storeSetRiverSideEntry(tilesEffected);
      return tilesEffected;
    }
    getTileJSON() {
      return {
        tileTypes: this.tileTypes,
        riverSides: this.riverSides,
        units: this.getUnitsJSON(),
        x: this.x,
        y: this.y,
        movementCost: this.getMovementCost(),
        city: this.city ? this.city.getJSON() : null,
        yields: this.getStats()
      };
    }
    getUnitsJSON() {
      const unitJSON = [];
      for (const unit of this.units) {
        unitJSON.push(unit.asJSON());
      }
      return unitJSON;
    }
    getMovementCost() {
      const tileTypesWithIncreasedCost = ["hill", "forest", "jungle"];
      const tileTypesWithInfiniteCost = ["mountain"];
      let cost = 1;
      for (const tileType of this.tileTypes) {
        if (tileTypesWithIncreasedCost.some((type) => tileType.includes(type))) {
          cost = 2;
        }
        if (tileTypesWithInfiniteCost.some((type) => tileType.includes(type))) {
          cost = 9999;
          break;
        }
      }
      return cost;
    }
    addTileType(tileType, index) {
      if (tileType === void 0) {
        throw new Error();
      }
      if (this.tileTypes.includes(tileType)) {
        console.log("Warning: Tried to add existing tile type for: " + tileType);
        console.log(this.getTileJSON());
        return;
      }
      if (index !== void 0) {
        this.tileTypes.splice(index, 0, tileType);
      } else {
        this.tileTypes.push(tileType);
      }
      TileIndexer.addTileType(tileType, this);
    }
    removeTileType(removeType) {
      this.tileTypes = this.tileTypes.filter((type) => type != removeType);
      TileIndexer.removeTileType(removeType, this);
    }
    setAdjacentTile(index, tile) {
      this.adjacentTiles[index] = tile;
    }
    replaceTileType(oldTileType, newTileType) {
      this.tileTypes = this.tileTypes.map((type) => type === oldTileType ? newTileType : type);
      TileIndexer.removeTileType(oldTileType, this);
      TileIndexer.addTileType(newTileType, this);
    }
    clearTileTypes() {
      this.tileTypes = [];
      TileIndexer.clearTileTypes(this);
    }
    containsTileType(tileType) {
      return this.tileTypes.includes(tileType);
    }
    applyRiverSide(options) {
      const nextTile = options.nextTile;
      const previousTile = options.previousTile;
      let currentRiverSide = void 0;
      if (options.originTile) {
        this.setRiverSide(this.getIndexOfAdjTile(nextTile), true);
        return;
      }
      if (nextTile) {
        for (const riverSide of this.getRiverSideIndexes({ value: true })) {
          if (this.riverConnectsToTile(riverSide, nextTile)) {
            return;
          }
        }
      }
      let connectedToPreviousTile = this.riverConnects(previousTile);
      if (!connectedToPreviousTile) {
        const validRiverConnections = this.getValidRiverConnections(previousTile);
        const potentialRiverPaths = /* @__PURE__ */ new Map();
        for (const validRiverConnection of validRiverConnections) {
          const tilesSet = /* @__PURE__ */ new Map();
          const adjTileOfRiverConnection = this.getAdjacentTiles()[validRiverConnection];
          if (!adjTileOfRiverConnection) continue;
          GameMap.getInstance().cacheSetRiverSides();
          if (!adjTileOfRiverConnection.isWater()) {
            this.setRiverSide(validRiverConnection, true);
            if (tilesSet.has(this)) {
              tilesSet.get(this).push(validRiverConnection);
            } else {
              tilesSet.set(this, [validRiverConnection]);
            }
          }
          currentRiverSide = validRiverConnection;
          const smallestRiverPathToNextTile = this.flowRiverToNextTile(currentRiverSide, nextTile);
          if (!smallestRiverPathToNextTile) {
            GameMap.getInstance().restoreCachedRiverSides();
            continue;
          }
          for (const riverSide of smallestRiverPathToNextTile) {
            if (!adjTileOfRiverConnection.isWater()) {
              this.setRiverSide(riverSide, true);
              if (tilesSet.has(this)) {
                tilesSet.get(this).push(riverSide);
              } else {
                tilesSet.set(this, [riverSide]);
              }
            }
          }
          potentialRiverPaths.set(validRiverConnection, tilesSet);
          GameMap.getInstance().restoreCachedRiverSides();
        }
        if (potentialRiverPaths.size > 0) {
          let smallestRiverConnectionIndex = 0;
          let smallestRiverSidesSet = Infinity;
          for (const [validRiverConnection, tilesSet] of potentialRiverPaths.entries()) {
            let totalRiverSidesSet = 0;
            for (const riverSideSet of tilesSet.values()) {
              totalRiverSidesSet += riverSideSet.length;
            }
            if (totalRiverSidesSet < smallestRiverSidesSet) {
              smallestRiverConnectionIndex = validRiverConnection;
              smallestRiverSidesSet = totalRiverSidesSet;
            }
          }
          for (const [tile, riverSides] of potentialRiverPaths.get(smallestRiverConnectionIndex).entries()) {
            for (const riverSide of riverSides) {
              if (!tile.getAdjacentTiles()[riverSide].isWater()) {
                tile.setRiverSide(riverSide, true);
              }
            }
          }
        }
      }
      if (connectedToPreviousTile) {
        const smallestRiverPathToNextTile = this.flowRiverToNextTile(currentRiverSide, nextTile);
        if (!smallestRiverPathToNextTile) return;
        for (const riverSide of smallestRiverPathToNextTile) {
          if (!this.getAdjacentTiles()[riverSide].isWater()) {
            this.setRiverSide(riverSide, true);
          }
        }
      }
    }
    flowRiverToNextTile(startingRiverSide, nextTile) {
      const orientations = /* @__PURE__ */ new Map();
      for (let orientation of ["left", "right"]) {
        const orientationRiverSidesSet = [];
        let prevRiverSide = startingRiverSide;
        GameMap.getInstance().cacheSetRiverSides();
        while (nextTile && !this.riverConnectsToTile(startingRiverSide, nextTile)) {
          const potentialRiverConnections = this.getConnectedRiverSides({
            emptySidesOnly: true,
            ofRiverSide: startingRiverSide
          });
          const validRiverConnections = [];
          for (const potentialConnectionIndex of potentialRiverConnections) {
            if (this.getAdjacentTiles()[potentialConnectionIndex]) {
              validRiverConnections.push(potentialConnectionIndex);
            }
          }
          if (validRiverConnections.length < 1) {
            GameMap.getInstance().removeTopRiverSideCache();
            return [];
          }
          const side = orientation === "left" ? Math.min(...validRiverConnections) : Math.max(...validRiverConnections);
          orientationRiverSidesSet.push(side);
          this.setRiverSide(side, true);
          startingRiverSide = side;
        }
        orientations.set(orientation, orientationRiverSidesSet);
        startingRiverSide = prevRiverSide;
        GameMap.getInstance().restoreCachedRiverSides();
      }
      let smallestRiverPath = void 0;
      for (const value of orientations.values()) {
        if (!smallestRiverPath || value.length < smallestRiverPath.length) {
          smallestRiverPath = value;
        }
      }
      return smallestRiverPath;
    }
    /**
     * Returns a list of river-sides connecting to this tile, from the perspective of the tile argument.
     * @param tile
     * @returns
     */
    getRiverSidesConnecting(tile) {
      const connectingRiverSides = [];
      for (const riverSide of tile.getRiverSideIndexes({ value: true })) {
        if (tile.getTilesAdjacentToRiver(riverSide).includes(this)) {
          connectingRiverSides.push(riverSide);
        }
      }
      return connectingRiverSides;
    }
    /**
     * Given an adjacent tile, get available connections we can branch out from, in the from of river-side indexes.
     * @param tile
     * @returns
     */
    getValidRiverConnections(tile) {
      const connectingRiverSides = this.getRiverSidesConnecting(tile);
      let validConnections = [];
      for (const riverSide of connectingRiverSides) {
        validConnections = validConnections.concat(tile.getAllConnectedRiverSides(riverSide).get(this));
      }
      return validConnections;
    }
    /**
     * Given an adjacent tile, determine if rivers on either tile connect properly.
     *
     * This function return false if both rivers reside in the same spot visually, this is to ensure our generation code properly connects to the next river-tile.
     * @param tile
     * @returns
     */
    riverConnects(tile) {
      const connections = [];
      const riverSidesOfTile = tile.getRiverSideIndexes({ value: true });
      for (const riverSide of this.getRiverSideIndexes({ value: true })) {
        if (!this.getAllConnectedRiverSides(riverSide).get(tile)) return false;
        for (const validConnectionSide of this.getAllConnectedRiverSides(riverSide).get(tile)) {
          if (riverSidesOfTile.includes(validConnectionSide)) return true;
        }
      }
      return false;
    }
    /**
     * Returns a list of numbers representing indexes of riverSides[]. This list is based off the value provided (true/false).
     * @param options
     * @returns
     */
    getRiverSideIndexes(options) {
      const riverSideIndexes = [];
      for (let i = 0; i < this.riverSides.length; i++) {
        const side = this.riverSides[i];
        if (side == options.value) {
          riverSideIndexes.push(i);
        }
      }
      return riverSideIndexes;
    }
    /**
     * Fetches all connected river sides, regardless if used or not, from all tiles including the ones adjacent to the river.
     * @param riverSide
     * @returns
     */
    getAllConnectedRiverSides(riverSide) {
      const allConnRiverSides = /* @__PURE__ */ new Map();
      let connectedSides = [];
      switch (riverSide) {
        case 0:
          connectedSides = [[
            2,
            /*3,*/
            4
          ], [4, 5], [], [], [], [1, 2]];
          break;
        case 1:
          connectedSides = [[2, 3], [
            3,
            /*4,*/
            5
          ], [0, 5], [], [], []];
          break;
        case 2:
          connectedSides = [[], [3, 4], [
            0,
            /*4,*/
            5
          ], [0, 1], [], []];
          break;
        case 3:
          connectedSides = [[], [], [4, 5], [
            0,
            /*1,*/
            5
          ], [1, 2], []];
          break;
        case 4:
          connectedSides = [[], [], [], [0, 5], [
            0,
            /*1,*/
            2
          ], [2, 3]];
          break;
        case 5:
          connectedSides = [[3, 4], [], [], [], [0, 1], [
            1,
            /*2,*/
            3
          ]];
          break;
      }
      for (const adjTile of this.getTilesAdjacentToRiver(riverSide)) {
        let relativeAdjIndex = this.getIndexOfAdjTile(adjTile);
        allConnRiverSides.set(adjTile, connectedSides[relativeAdjIndex]);
      }
      allConnRiverSides.set(
        this,
        this.getConnectedRiverSides({
          ofRiverSide: riverSide,
          emptySidesOnly: false
        })
      );
      return allConnRiverSides;
    }
    /**
     * Gets a list of adjacent river-side indexes that connect with existing river-sides of this tile, or a specified river side.
     * @returns
     */
    //FIXME: This doesn't work sometimes?
    getConnectedRiverSides(options) {
      if (!this.hasRiver()) {
        return [];
      }
      const sides = [
        [5, 0, 1],
        [0, 1, 2],
        [1, 2, 3],
        [2, 3, 4],
        [3, 4, 5],
        [4, 5, 0]
      ];
      const adjacentSides = [];
      let riverSidesToCheck = [];
      if (options.ofRiverSide !== void 0) {
        riverSidesToCheck.push(options.ofRiverSide);
      } else {
        riverSidesToCheck = this.getRiverSideIndexes({ value: true });
      }
      for (const riverSide of riverSidesToCheck) {
        const adjacentSidesIndexes = sides[riverSide];
        for (const adjacentIndex of adjacentSidesIndexes) {
          if (options.emptySidesOnly) {
            if (this.riverSides[adjacentIndex] === false) {
              adjacentSides.push(adjacentIndex);
            }
          } else {
            adjacentSides.push(adjacentIndex);
          }
        }
      }
      return adjacentSides;
    }
    hasRiver() {
      return this.riverSides.some((side) => side);
    }
    /**
     * Determine if the river of this tile is flowing onto the specified connected tiles.
     *
     * This doesn't mean rivers of the tiles are connecting.
     * @param riverSide
     * @param connectedTiles
     * @returns
     */
    //FIXME: Check if this is correct for riverSide = 5, connected tile is adj tile w /index =4.
    riverConnectsToTile(riverSide, connectedTile) {
      const adjRiverTiles = this.getTilesAdjacentToRiver(riverSide);
      return adjRiverTiles.includes(connectedTile);
    }
    /**
     * Returns a list of tiles that the river touches, relative to this tile.
     * @param riverSide
     * @returns
     */
    getTilesAdjacentToRiver(riverSide) {
      const adjTilesToRiver = [];
      const sides = [
        [5, 0, 1],
        [0, 1, 2],
        [1, 2, 3],
        [2, 3, 4],
        [3, 4, 5],
        [4, 5, 0]
      ];
      const adjIndexes = sides[riverSide];
      if (!adjIndexes) return [];
      for (const index of adjIndexes) {
        const adjTile = this.getAdjacentTiles()[index];
        if (adjTile) {
          adjTilesToRiver.push(adjTile);
        }
      }
      return adjTilesToRiver;
    }
    getIndexOfAdjTile(tile) {
      for (let i = 0; i < this.adjacentTiles.length; i++) {
        if (tile === this.adjacentTiles[i]) return i;
      }
      return -1;
    }
    /**
     * Will apply a random river side that isn't being already used.
     * @returns River side we applied
     */
    applyRandomRiverSide() {
      const unusedSides = [];
      for (let i = 0; i < this.riverSides.length; i++) {
        if (!this.riverSides[i]) unusedSides.push(i);
      }
      if (unusedSides.length < 1) {
        console.log("Warning: Tried to apply random river side to all occupied sides...");
        return;
      }
      const randomUnusedSide = unusedSides[random_default.int(0, unusedSides.length - 1)];
      this.setRiverSide(randomUnusedSide, true);
      return randomUnusedSide;
    }
    /**
     *
     * @param tileTypes
     * @returns True if at least ONE provided tileType is inside this tile.
     */
    containsTileTypes(tileTypes) {
      for (let i = 0; i < this.tileTypes.length; i++) {
        if (tileTypes.includes(this.tileTypes[i])) return true;
      }
      return false;
    }
    containsAllTileTypes(tileTypes) {
      return tileTypes.every((tileType) => this.tileTypes.includes(tileType));
    }
    getAdjacentTiles() {
      return this.adjacentTiles;
    }
    setGenerationHeight(generationHeight) {
      this.generationHeight = generationHeight;
    }
    setGenerationTemp(generationTemp) {
      this.generationTemp = generationTemp;
    }
    getGenerationTemp() {
      return this.generationTemp;
    }
    getGenerationHeight() {
      return this.generationHeight;
    }
    getTileTypes() {
      return this.tileTypes;
    }
    getX() {
      return this.x;
    }
    getY() {
      return this.y;
    }
    isWater() {
      return this.containsTileTypes(["ocean", "shallow_ocean", "freshwater"]);
    }
    getDistanceFrom(tile) {
      const dx = this.x + 0.5 - (tile.x + 0.5);
      const dy = this.y + 0.5 - (tile.y + 0.5);
      return Math.sqrt(dx ** 2 + dy ** 2);
    }
    toString() {
      return this.tileTypes.toString();
    }
    static riverCrosses(tile1, tile2) {
      let tile1RiverSide = -1;
      for (let i = 0; i < tile1.getAdjacentTiles().length; i++) {
        if (tile2 === tile1.getAdjacentTiles()[i]) {
          tile1RiverSide = i;
        }
      }
      if (tile1.getRiverSides()[tile1RiverSide]) {
        return true;
      }
      return false;
    }
    //TODO: Function works but naming is confusing, we don't use grid variables in server.
    static gridDistance(tile1, tile2) {
      return Math.sqrt(Math.pow(tile2.getX() - tile1.getX(), 2) + Math.pow(tile2.getY() - tile1.getY(), 2));
    }
    static getWeight(tile1, tile2) {
      if (_Tile.riverCrosses(tile1, tile2)) {
        return Math.max(2, tile2.getMovementCost());
      }
      return tile2.getMovementCost();
    }
    getStats() {
      const tileStats = [
        { science: 0 },
        { gold: 0 },
        { production: 0 },
        { faith: 0 },
        { culture: 0 },
        { food: 0 },
        { morale: 0 }
      ];
      for (const tileType of this.tileTypes) {
        const tileTypeData = _Tile.getAllTileStats()[tileType.toUpperCase()];
        if (!tileTypeData || !tileTypeData.stats) continue;
        for (const statData of tileTypeData.stats) {
          const statName = Object.keys(statData)[0];
          const statValue = statData[statName];
          for (const stat of tileStats) {
            if (Object.keys(stat)[0] === statName) {
              stat[statName] += statValue;
            }
          }
        }
      }
      if (this.city) {
        for (const stat of tileStats) {
          if (stat["food"] !== void 0 && stat["food"] < 2) {
            stat["food"] = 2;
          }
        }
      }
      return tileStats;
    }
    getTotalStatValue(stats) {
      return 0;
    }
  };
  __publicField(_Tile, "allTileStats");
  var Tile = _Tile;

  // wsf:src/openciv-src/server/src/map/MapResources
  var MapResource = class {
    constructor(resourceData) {
      __publicField(this, "name");
      __publicField(this, "spawnTiles");
      __publicField(this, "pathLength");
      __publicField(this, "minTilesSet");
      __publicField(this, "maxTilesSet");
      __publicField(this, "setChance");
      __publicField(this, "minTemp");
      __publicField(this, "maxTemp");
      __publicField(this, "onAdditionalTileTypes");
      this.name = resourceData.name;
      this.spawnTiles = resourceData.spawn_tiles;
      this.pathLength = resourceData.path_length;
      this.minTilesSet = resourceData.min_tiles_set;
      this.maxTilesSet = resourceData.max_tiles_set;
      this.setChance = resourceData.set_chance;
      this.minTemp = resourceData.min_temp;
      this.maxTemp = resourceData.max_temp;
      this.onAdditionalTileTypes = resourceData.spawn_on_additional_tile_types ?? false;
    }
    getName() {
      return this.name;
    }
    getSpawnTiles() {
      return this.spawnTiles;
    }
    getPathLength() {
      return this.pathLength;
    }
    getMinTilesSet() {
      return this.minTilesSet;
    }
    getMaxTilesSet() {
      return this.maxTilesSet;
    }
    getSetChance() {
      return this.setChance;
    }
    getMinTemp() {
      return this.minTemp;
    }
    getMaxTemp() {
      return this.maxTemp;
    }
    spawnOnAdditionalTileTypes() {
      return this.onAdditionalTileTypes;
    }
  };
  var MapResources = class {
    static async loadConfigurationFile() {
      const file = fs_default.readFileSync("./config/map_resources.yml", "utf-8");
      this.resourcesData = yaml_default.parse(file);
    }
    static getRandomMapResource(options) {
      if (!this.resourcesData) this.loadConfigurationFile();
      let resourceData = void 0;
      switch (options.mapResourceType) {
        case "bonus":
          resourceData = this.resourcesData.bonus_resources[random_default.int(0, this.resourcesData.bonus_resources.length - 1)];
          break;
        case "strategic":
          resourceData = this.resourcesData.strategic_resources[random_default.int(0, this.resourcesData.strategic_resources.length - 1)];
          break;
        case "luxury":
          resourceData = this.resourcesData.luxury_resources[random_default.int(0, this.resourcesData.luxury_resources.length - 1)];
          break;
      }
      return new MapResource(resourceData);
    }
    /**
     * Determine if the tile is a resource or a natural wonder
     * @param tile
     * @returns
     */
    static isResourceTile(tile) {
      if (!this.resourcesData) this.loadConfigurationFile();
      const resourceTileTypes = [
        ...this.resourcesData.bonus_resources.map((resource) => resource.name),
        ...this.resourcesData.strategic_resources.map((resource) => resource.name),
        ...this.resourcesData.luxury_resources.map((resource) => resource.name)
      ];
      return tile.containsTileTypes(resourceTileTypes);
    }
  };
  __publicField(MapResources, "resourcesData");

  // wsf:src/openciv-src/shims/ts-priority-queue
  var BinaryHeapStrategy = class {
    constructor(options) {
      __publicField(this, "comparator");
      __publicField(this, "data");
      this.comparator = options.comparator;
      this.data = options.initialValues ? options.initialValues.slice(0) : [];
      this._heapify();
    }
    _heapify() {
      if (this.data.length > 0) {
        for (let i = 0; i < this.data.length; i++) {
          this._bubbleUp(i);
        }
      }
    }
    queue(value) {
      this.data.push(value);
      this._bubbleUp(this.data.length - 1);
    }
    dequeue() {
      const ret = this.data[0];
      const last = this.data.pop();
      if (this.data.length > 0 && last !== void 0) {
        this.data[0] = last;
        this._bubbleDown(0);
      }
      return ret;
    }
    peek() {
      return this.data[0];
    }
    clear() {
      this.data.length = 0;
    }
    _bubbleUp(pos) {
      while (pos > 0) {
        const parent = pos - 1 >>> 1;
        if (this.comparator(this.data[pos], this.data[parent]) < 0) {
          const x = this.data[parent];
          this.data[parent] = this.data[pos];
          this.data[pos] = x;
          pos = parent;
        } else {
          break;
        }
      }
    }
    _bubbleDown(pos) {
      let last = this.data.length - 1;
      while (true) {
        const left = (pos << 1) + 1;
        const right = left + 1;
        let minIndex = pos;
        if (left <= last && this.comparator(this.data[left], this.data[minIndex]) < 0) {
          minIndex = left;
        }
        if (right <= last && this.comparator(this.data[right], this.data[minIndex]) < 0) {
          minIndex = right;
        }
        if (minIndex !== pos) {
          const x = this.data[minIndex];
          this.data[minIndex] = this.data[pos];
          this.data[pos] = x;
          pos = minIndex;
        } else {
          break;
        }
      }
    }
  };
  var PriorityQueue = class {
    constructor(options) {
      __publicField(this, "_length", 0);
      __publicField(this, "strategy");
      this._length = options.initialValues ? options.initialValues.length : 0;
      this.strategy = new BinaryHeapStrategy(options);
    }
    get length() {
      return this._length;
    }
    queue(value) {
      this._length++;
      this.strategy.queue(value);
    }
    dequeue() {
      if (!this._length) throw new Error("Empty queue");
      this._length--;
      return this.strategy.dequeue();
    }
    peek() {
      if (!this._length) throw new Error("Empty queue");
      return this.strategy.peek();
    }
    clear() {
      this._length = 0;
      this.strategy.clear();
    }
  };

  // wsf:src/openciv-src/shims/crypto
  function randomBytes(size) {
    const b = new Uint8Array(size);
    for (let i = 0; i < size; i++) b[i] = Math.floor(Math.random() * 256);
    b.readUInt32BE = function(offset = 0) {
      return (this[offset] << 24 | this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3]) >>> 0;
    };
    return b;
  }
  var crypto_default = { randomBytes };

  // wsf:src/openciv-src/server/src/util/Numbers
  var Numbers = class {
    static safeRandom() {
      const buffer = crypto_default.randomBytes(4);
      const randomNum = buffer.readUInt32BE(0) / (4294967295 + 1);
      return randomNum;
    }
  };

  // wsf:src/openciv-src/server/src/map/GameMap
  var _GameMap = class _GameMap {
    constructor() {
      __publicField(this, "tiles");
      __publicField(this, "mapWidth");
      __publicField(this, "mapHeight");
      __publicField(this, "mapArea");
      __publicField(this, "riverSideHistory");
    }
    static getInstance() {
      return this.instance;
    }
    /**
     * Initializes the GameMap singleton object, starts a map request to the server.
     */
    static init() {
      _GameMap.instance = new _GameMap();
      _GameMap.instance.startGeneration();
    }
    static destroyInstance() {
      _GameMap.instance = void 0;
    }
    startGeneration() {
      const mapDimensions = this.getDimensionValues("48x32" /* DUEL */);
      this.mapWidth = mapDimensions[0];
      this.mapHeight = mapDimensions[1];
      this.mapArea = this.mapWidth * this.mapHeight;
      this.riverSideHistory = [];
      this.tiles = [];
      for (let x = 0; x < this.mapWidth; x++) {
        this.tiles[x] = [];
        for (let y = 0; y < this.mapHeight; y++) {
          this.tiles[x][y] = new Tile("ocean", x, y);
        }
      }
      this.initAdjacentTiles();
      this.generateTerrain();
    }
    getTiles() {
      return this.tiles;
    }
    generateTerrain() {
      const LAND_MASS_PARAM = 6;
      const landMassSize = this.mapWidth * this.mapHeight / 12.5 * (LAND_MASS_PARAM + 2);
      const maxPathLength = 140;
      const maxLandmassIterations = 1e4;
      let landmassIterations = 0;
      while (this.getTotalGeographyLandMass() < landMassSize) {
        landmassIterations++;
        let rndX = random_default.int(10, this.mapWidth - 11);
        let rndY = random_default.int(10, this.mapHeight - 11);
        const currentPathLength = random_default.int(40, maxPathLength);
        this.generateTilePath({
          tile: this.tiles[rndX][rndY],
          pathLength: currentPathLength,
          setTileType: "grass",
          followTileTypes: ["ocean"],
          setTileChance: 0.5,
          overrideWater: true
        });
        if (landmassIterations >= maxLandmassIterations) break;
      }
      for (let x = 0; x < this.mapWidth; x++) {
        for (let y = 0; y < this.mapHeight; y++) {
          const tile = this.tiles[x][y];
          if (tile.containsTileType("ocean")) {
            let surroundedByLand = true;
            for (const adjTile of tile.getAdjacentTiles()) {
              if (!adjTile) continue;
              if (adjTile.containsTileType("ocean")) {
                surroundedByLand = false;
              }
            }
            if (surroundedByLand) {
              tile.replaceTileType("ocean", "grass");
            }
          }
        }
      }
      const tallestTiles = [];
      console.log("Generating tallest tiles...");
      for (let x = 0; x < this.mapWidth; x++) {
        for (let y = 0; y < this.mapHeight; y++) {
          const currentTile = this.tiles[x][y];
          if (currentTile.containsTileType("ocean")) continue;
          let low = 0;
          let high = tallestTiles.length;
          while (low < high) {
            var mid = low + high >>> 1;
            if (tallestTiles[mid].getGenerationHeight() > currentTile.getGenerationHeight()) low = mid + 1;
            else high = mid;
          }
          const insertionIndex = low;
          tallestTiles.splice(insertionIndex, 0, currentTile);
        }
      }
      console.log("Done generating tallest tiles - " + tallestTiles.length);
      const totalHills = tallestTiles.length * 0.1;
      for (let i = 0; i < totalHills; i++) {
        if (Numbers.safeRandom() < 0.5) tallestTiles[i].replaceTileType("grass", "grass_hill");
      }
      for (let i = 0; i < tallestTiles.length; i++) {
        if (Numbers.safeRandom() < 0.13) tallestTiles[i].replaceTileType("grass", "grass_hill");
      }
      const totalMountains = tallestTiles.length * 0.05;
      for (let i = 0; i < totalMountains; i++) {
        tallestTiles[i].replaceTileType("grass", "mountain");
      }
      console.log("Setting tile temperatures...");
      for (let y = 0; y < this.mapHeight; y++) {
        const yPercent = y / this.mapHeight;
        for (let x = 0; x < this.mapWidth; x++) {
          const tile = this.tiles[x][y];
          if (tile.containsTileType("ocean")) continue;
          if (yPercent <= 0.1 || yPercent >= 0.9) {
            tile.setGenerationTemp(random_default.int(0, 31));
          } else if (yPercent > 0.1 && yPercent < 0.3 || yPercent > 0.7 && yPercent < 0.9) {
            tile.setGenerationTemp(random_default.int(32, 60));
          } else {
            tile.setGenerationTemp(random_default.int(60, 100));
          }
        }
      }
      console.log("Done setting tile temperatures!");
      console.log("Generating snow & tundra tiles...");
      for (let x = 0; x < this.mapWidth; x++) {
        for (let y = 0; y < this.mapHeight; y++) {
          const yPercent = y / this.mapHeight;
          const currentTile = this.tiles[x][y];
          if (currentTile.containsTileType("ocean")) continue;
          if (yPercent <= 0.1 || yPercent >= 0.9) {
            this.setTileBiome({ tile: currentTile, tileType: "snow" });
          } else if (yPercent > 0.1 && yPercent < 0.15 || yPercent > 0.85 && yPercent < 0.9) {
            if (Numbers.safeRandom() > 0.25) {
              for (const adjTile of currentTile.getAdjacentTiles()) {
                if (!adjTile) continue;
                this.setTilesBiome(adjTile.getAdjacentTiles(), "tundra", 0.1);
              }
            }
            this.setTileBiome({ tile: currentTile, tileType: "tundra" });
          } else {
          }
        }
      }
      console.log("Done generating snow & tundra tiles!");
      const numberOfPlainsBiomes = Math.ceil(this.mapArea * 2403846e-9);
      console.log("Generating plains biomes... - " + numberOfPlainsBiomes);
      for (let i = 0; i < numberOfPlainsBiomes; i++) {
        const originTile = this.getRandomTileWith({
          tileTypes: ["grass"],
          tempRange: [60, 80]
        });
        if (!originTile) continue;
        this.generateTilePath({
          tile: originTile,
          pathLength: 15,
          setTileType: "plains",
          followTileTypes: ["grass"],
          setTileChance: 0.95,
          overrideWater: false
        });
      }
      console.log("Done generating plains biomes!");
      const numberOfDesertBiomes = Math.ceil(this.mapArea * 721154e-9);
      console.log("Generating desert biomes... - " + numberOfDesertBiomes);
      for (let i = 0; i < numberOfDesertBiomes; i++) {
        const originTile = this.getRandomTileWith({
          tileTypes: ["grass"],
          tempRange: [95, 100]
        });
        if (!originTile) continue;
        this.generateTilePath({
          tile: originTile,
          pathLength: 15,
          setTileType: "desert",
          followTileTypes: ["grass", "grass_hill"],
          setTileChance: 0.95,
          overrideWater: false
        });
      }
      console.log("Done generating desert biomes!");
      const numberOfJungleBiomes = Math.ceil(this.mapArea * 721154e-9);
      console.log("Generating jungle biomes... - " + numberOfJungleBiomes);
      for (let i = 0; i < numberOfJungleBiomes; i++) {
        const originTile = this.getRandomTileWith({
          tileTypes: ["grass"],
          tempRange: [60, 75]
        });
        if (!originTile) continue;
        this.generateTilePath({
          tile: originTile,
          pathLength: 15,
          setTileType: "jungle",
          followTileTypes: ["grass", "grass_hill"],
          setTileChance: 0.5,
          overrideWater: false,
          setFollowTileTypeOnly: true,
          clearExistingTileTypes: false
        });
      }
      console.log("Done generating jungle tiles!");
      const numberOfForestBiomes = Math.ceil(this.mapArea * 0.024038462);
      console.log("Generating forest biomes... - " + numberOfForestBiomes);
      for (let i = 0; i < numberOfForestBiomes; i++) {
        const originTile = this.getRandomTileWith({
          tileTypes: ["grass"],
          tempRange: [32, 90]
        });
        if (!originTile) continue;
        this.generateTilePath({
          tile: originTile,
          pathLength: 5,
          setTileType: "forest",
          followTileTypes: ["grass", "grass_hill", "plains", "plains_hill", "tundra", "tundra_hill"],
          setTileChance: 0.1,
          overrideWater: false,
          setFollowTileTypeOnly: true,
          clearExistingTileTypes: false
        });
      }
      console.log("Done generating forest tiles!");
      console.log("Generating freshwater tiles...");
      for (const tile of [...TileIndexer.getTilesByTileType("ocean")]) {
        let freshwater = true;
        let traverseQueue = [];
        let traversedTiles = [];
        traverseQueue.push(tile);
        while (traverseQueue.length > 0) {
          let currentTile = traverseQueue.shift();
          traversedTiles.push(currentTile);
          for (const adjTile of currentTile.getAdjacentTiles()) {
            if (!adjTile) {
              freshwater = false;
            } else if (adjTile.containsTileType("ocean")) {
              if (!traversedTiles.includes(adjTile) && !traverseQueue.includes(adjTile)) {
                traverseQueue.push(adjTile);
              }
            }
          }
        }
        if (freshwater) {
          for (let tile2 of traversedTiles) {
            tile2.replaceTileType("ocean", "freshwater");
          }
        }
      }
      console.log("Done generating freshwater tiles!");
      console.log("Generating shallow ocean tiles...");
      for (const tile of [...TileIndexer.getTilesByTileType("ocean")]) {
        for (const adjTile of tile.getAdjacentTiles()) {
          if (!adjTile) continue;
          if (!adjTile.containsTileTypes(["ocean", "shallow_ocean"])) {
            tile.replaceTileType("ocean", "shallow_ocean");
          }
        }
      }
      for (const tile of [...TileIndexer.getTilesByTileType("ocean")]) {
        for (const adjTile of tile.getAdjacentTiles()) {
          if (!adjTile) continue;
          if (adjTile.containsTileType("shallow_ocean") && Numbers.safeRandom() > 0.75) {
            tile.replaceTileType("ocean", "shallow_ocean");
          }
        }
      }
      console.log("Done generating shallow ocean tiles!");
      console.log("Generating resources...");
      const numberOfResources = Math.ceil(this.mapArea * 0.04);
      for (let i = 0; i < numberOfResources * 3; i++) {
        let mapResourceType = "N/A";
        if (i < numberOfResources) {
          mapResourceType = "bonus";
        } else if (i > numberOfResources && i < numberOfResources * 1.5) {
          mapResourceType = "strategic";
        } else {
          mapResourceType = "luxury";
        }
        const mapResource = MapResources.getRandomMapResource({
          mapResourceType
        });
        const originTile = this.getRandomTileWith({
          tileTypes: mapResource.getSpawnTiles(),
          onAdditionalTileTypes: mapResource.spawnOnAdditionalTileTypes(),
          avoidResourceTiles: true,
          tempRange: [mapResource.getMinTemp(), mapResource.getMaxTemp()]
        });
        if (!originTile) {
          console.log("no origin tile found");
          continue;
        }
        console.log("Generate resource: " + mapResource.name);
        this.generateTilePath({
          tile: originTile,
          pathLength: mapResource.pathLength,
          setTileType: mapResource.name,
          followTileTypes: mapResource.getSpawnTiles(),
          setTileChance: mapResource.getSetChance(),
          minTilesSet: mapResource.getMinTilesSet(),
          maxTilesSet: mapResource.getMaxTilesSet(),
          overrideWater: mapResource.getSpawnTiles().includes("ocean") ? true : false,
          setFollowTileTypeOnly: true,
          clearExistingTileTypes: false,
          insertIndex: 1,
          // Puts the resource behind trees, jungle
          onAdditionalTileTypes: mapResource.onAdditionalTileTypes,
          avoidResourceTiles: true
        });
      }
      console.log("Done generating resources!");
      console.log("Generating rivers...");
      const riverAmount = this.mapArea * 0.015;
      let riverGenAttempts = 0;
      rivenGenLoop: for (let riverIndex = 0; riverIndex < riverAmount; riverIndex++) {
        if (++riverGenAttempts > this.mapArea * 3) {
          console.log("Bailing out of river generation after too many attempts");
          break rivenGenLoop;
        }
        let originTile = void 0;
        findRiverOriginLoop: while (!originTile) {
          originTile = this.getRandomTileWith({
            tileTypes: ["grass_hill", "plains_hill", "desert_hill", "tundra_hill", "snow_hill", "mountain"]
          });
          if (!originTile) break findRiverOriginLoop;
          for (const adjTile of originTile.getAdjacentTiles()) {
            if (!adjTile) continue;
            if (adjTile.containsTileType("river_candidate") || adjTile.isWater()) {
              originTile = void 0;
              continue findRiverOriginLoop;
            }
          }
          if (originTile.hasRiver()) {
            originTile = void 0;
            continue;
          }
        }
        originTile.addTileType("river_candidate");
        const currentRiverTiles = [originTile];
        let currentTile = originTile;
        let lastTraversedTile = void 0;
        let riverLength = 1;
        riverPathLoop: while (true) {
          const nextTileCandidates = this.getNextPotentialRiverTiles(currentTile, lastTraversedTile, originTile);
          lastTraversedTile = currentTile;
          if (nextTileCandidates.length < 1) {
            currentTile = void 0;
            break riverPathLoop;
          }
          currentTile = nextTileCandidates[random_default.int(0, nextTileCandidates.length - 1)];
          if (!currentTile) {
            riverIndex--;
            break riverPathLoop;
          }
          currentTile.addTileType("river_candidate");
          currentRiverTiles.push(currentTile);
          riverLength++;
          if (currentTile.hasRiver()) break riverPathLoop;
          if (currentTile.isWater()) break riverPathLoop;
          if (riverLength >= 50) break riverPathLoop;
        }
        for (let i = 0; i < currentRiverTiles.length; i++) {
          const tile = currentRiverTiles[i];
          tile.removeTileType("river_candidate");
        }
        if (currentRiverTiles.length < 10) {
          riverIndex--;
          continue;
        }
        this.cacheSetRiverSides();
        let appliedRiverSides = 0;
        for (let i = 0; i < currentRiverTiles.length; i++) {
          const tile = currentRiverTiles[i];
          let prevTile = void 0;
          let nextTile = void 0;
          if (i < currentRiverTiles.length - 1) nextTile = currentRiverTiles[i + 1];
          if (i > 0) prevTile = currentRiverTiles[i - 1];
          if (!tile.containsTileType("debug3")) {
          }
          tile.applyRiverSide({
            originTile: i == 0,
            previousTile: prevTile,
            nextTile
          });
          appliedRiverSides++;
        }
        let tooManyRiverSides = false;
        for (let i = 0; i < currentRiverTiles.length; i++) {
          const tile = currentRiverTiles[i];
          if (tile.getRiverSideIndexes({ value: true }).length > 3) tooManyRiverSides = true;
        }
        if (tooManyRiverSides || appliedRiverSides < 3) {
          for (let i = 0; i < currentRiverTiles.length; i++) {
            const tile = currentRiverTiles[i];
            tile.removeTileType("debug3");
            tile.removeTileType("debug2");
          }
        }
        if (tooManyRiverSides || appliedRiverSides < 3) {
          riverIndex--;
          this.restoreCachedRiverSides();
        }
        this.removeTopRiverSideCache();
      }
      console.log("Done generating rivers!");
      console.log("Generating floodplains...");
      const desertTiles = TileIndexer.getTilesByTileType("desert");
      for (const tile of desertTiles) {
        if (tile.hasRiver()) {
          tile.replaceTileType("desert", "floodplains");
        }
      }
      console.log("Done generating floodplains!");
    }
    getNextPotentialRiverTiles(currentTile, lastTraversedTile, originTile) {
      const nextTileCandidates = [];
      adjCandidateTilesLoop: for (const adjacentCandidateTile of currentTile.getAdjacentTiles()) {
        let deleteCandidate = false;
        if (!adjacentCandidateTile) {
          continue adjCandidateTilesLoop;
        }
        if (adjacentCandidateTile.isWater()) {
          continue adjCandidateTilesLoop;
        }
        if (adjacentCandidateTile.containsTileTypes(["river_candidate"])) {
          continue adjCandidateTilesLoop;
        }
        if (lastTraversedTile) {
          if (originTile.getDistanceFrom(adjacentCandidateTile) <= originTile.getDistanceFrom(lastTraversedTile)) {
            continue adjCandidateTilesLoop;
          }
        }
        for (const adjTile of adjacentCandidateTile.getAdjacentTiles()) {
          if (!adjTile) {
            continue adjCandidateTilesLoop;
          }
        }
        let adjRiverCandidateAmount = 0;
        for (const adjTile of adjacentCandidateTile.getAdjacentTiles()) {
          if (adjTile && adjTile.containsTileType("river_candidate")) {
            adjRiverCandidateAmount++;
          }
        }
        if (adjRiverCandidateAmount > 2) {
          continue adjCandidateTilesLoop;
        }
        nextTileCandidates.push(adjacentCandidateTile);
      }
      return nextTileCandidates;
    }
    getDimensionValues(mapSize) {
      const values = [
        parseInt(mapSize.substring(0, mapSize.indexOf("x"))),
        parseInt(mapSize.substring(mapSize.indexOf("x") + 1))
      ];
      return values;
    }
    sendTileYieldsToPlayer(player) {
      player.sendNetworkEvent({
        event: "tileYields",
        yields: Tile.getAllTileStats()
      });
    }
    sendMapChunksToPlayer(player) {
      player.sendNetworkEvent({
        event: "mapSize",
        width: this.mapWidth,
        height: this.mapHeight
      });
      player.sendNetworkEvent({
        event: "tileStats",
        tiles: Tile.getAllTileStats()
      });
      for (let x = 0; x < this.mapWidth; x += 4) {
        for (let y = 0; y < this.mapHeight; y += 4) {
          const chunkTiles = [];
          const chunkCities = [];
          for (let chunkX = 0; chunkX < 4; chunkX++) {
            for (let chunkY = 0; chunkY < 4; chunkY++) {
              const tile = this.tiles[x + chunkX][y + chunkY];
              if (tile.getCity()) {
                chunkCities.push(tile.getCity());
              }
              chunkTiles.push(tile.getTileJSON());
            }
          }
          let lastChunk = false;
          if (x === this.mapWidth - 4 && y === this.mapHeight - 4) {
            lastChunk = true;
          }
          player.sendNetworkEvent({
            event: "mapChunk",
            chunkX: x,
            chunkY: y,
            tiles: chunkTiles,
            lastChunk
          });
        }
      }
    }
    getTotalGeographyLandMass() {
      let total = 0;
      for (let x = 0; x < this.mapWidth; x++) {
        for (let y = 0; y < this.mapHeight; y++) {
          if (this.tiles[x][y].getGenerationHeight() != 0) total++;
        }
      }
      return total;
    }
    /**
     * Iterate through every tile & assign it's adjacent neighboring tiles through: setAdjacentTile()
     */
    initAdjacentTiles() {
      for (let x = 0; x < this.mapWidth; x++) {
        for (let y = 0; y < this.mapHeight; y++) {
          let edgeAxis;
          if (y % 2 == 0) edgeAxis = _GameMap.evenEdgeAxis;
          else edgeAxis = _GameMap.oddEdgeAxis;
          for (let i = 0; i < edgeAxis.length; i++) {
            let edgeX = x + edgeAxis[i][0];
            let edgeY = y + edgeAxis[i][1];
            if (edgeX == -1 || edgeY == -1 || edgeX > this.mapWidth - 1 || edgeY > this.mapHeight - 1) {
              this.tiles[x][y].setAdjacentTile(i, null);
              continue;
            }
            this.tiles[x][y].setAdjacentTile(i, this.tiles[x + edgeAxis[i][0]][y + edgeAxis[i][1]]);
          }
        }
      }
    }
    setTilesBiome(tiles, tileType, setChance) {
      for (const tile of tiles) {
        if (!tile || Numbers.safeRandom() > setChance) continue;
        this.setTileBiome({ tile, tileType });
      }
    }
    setTileBiome(options) {
      const clearTileTypes = options.clearTileTypes ?? true;
      let newTileType = void 0;
      if (options.tile.containsTileType("grass_hill")) {
        switch (options.tileType) {
          case "snow":
            newTileType = "snow_hill";
            break;
          case "tundra":
            newTileType = "tundra_hill";
            break;
          case "plains":
            newTileType = "plains_hill";
            break;
          case "desert":
            newTileType = "desert_hill";
            break;
          default:
            newTileType = options.tileType;
            break;
        }
      } else {
        newTileType = options.tileType;
      }
      if (clearTileTypes) {
        options.tile.clearTileTypes();
      }
      if (options.insertIndex !== void 0) {
        options.tile.addTileType(newTileType, options.insertIndex);
      } else {
        options.tile.addTileType(newTileType);
      }
    }
    //TODO: Implement min-tiles & max-tiles per path iteration ontop of setTileChance.
    generateTilePath(options) {
      const {
        setFollowTileTypeOnly = false,
        onAdditionalTileTypes = false,
        avoidResourceTiles = false,
        minTilesSet = 0,
        maxTilesSet = 99999
      } = options;
      let tile = options.tile;
      let tilesSet = 0;
      const skippedValidGenerationTiles = [];
      for (let i = 0; i < options.pathLength; i++) {
        let generationTiles = [];
        let nextPathTile = void 0;
        generationTiles.push(tile);
        generationTiles = generationTiles.concat(tile.getAdjacentTiles());
        const adjacentFollowTiles = [];
        for (const tile2 of generationTiles) {
          if (!tile2) continue;
          if (tilesSet >= maxTilesSet) continue;
          if (tile2.containsTileType("ocean") && !options.overrideWater) continue;
          if (!tile2.containsTileTypes(options.followTileTypes) && setFollowTileTypeOnly) continue;
          if (!onAdditionalTileTypes && tile2.getTileTypes().length > 1) continue;
          if (avoidResourceTiles && MapResources.isResourceTile(tile2)) continue;
          if (Numbers.safeRandom() <= options.setTileChance) {
            this.setTileBiome({
              tile: tile2,
              tileType: options.setTileType,
              clearTileTypes: options.clearExistingTileTypes,
              insertIndex: options.insertIndex
            });
            tilesSet++;
            tile2.setGenerationHeight(tile2.getGenerationHeight() + 1);
          } else {
            skippedValidGenerationTiles.push(tile2);
          }
          for (const adjTile of tile2.getAdjacentTiles()) {
            if (!adjTile) continue;
            if (adjTile.containsTileTypes(options.followTileTypes)) {
              adjacentFollowTiles.push(adjTile);
            }
          }
        }
        nextPathTile = adjacentFollowTiles[random_default.int(0, adjacentFollowTiles.length)];
        if (!nextPathTile) break;
        tile = nextPathTile;
      }
      if (tilesSet < minTilesSet) {
        for (let i = tilesSet; i < minTilesSet; i++) {
          if (skippedValidGenerationTiles.length < 1) break;
          const rndTile = skippedValidGenerationTiles[random_default.int(0, skippedValidGenerationTiles.length - 1)];
          if (!rndTile) break;
          this.setTileBiome({
            tile: rndTile,
            tileType: options.setTileType,
            clearTileTypes: options.clearExistingTileTypes,
            insertIndex: options.insertIndex
          });
          tilesSet++;
        }
      }
    }
    /**
     * This method iterates through tiles randomly until it finds a tile that meets the specified criteria.
     * If the method cannot find a suitable Tile object after 7500 iterations, it returns undefined.
     * @param options.tileTypes - The tiletypes of tiles that can be randomly picked.
     * @param options.tempRange - (Optional) A tuple of two numbers that specify the temperature range for the generated Tile object. If not provided, the default temperature range is [0, 100].
     * @param options.onAdditionalTileTypes - (Optional) A boolean value that indicates if we allow the random tile to contain more than 1 tile type. (E.g. a forest). Default value = FALSE
     * @param options.avoidResourceTiles - (Optional) A boolean value that indicates if we allow the random tile to be an existing resource tile(E.g. coal, horses, fish, ect.). Default value = FALSE
     * @returns A Tile object that meets the specified criteria, or undefined if no such Tile is found.
     */
    //FIXME: We really should use a tileMap to get tiles w/ the associated tileTypes in O(1) time.
    // Then we can apply the rest of the options in O(n)
    getRandomTileWith(options) {
      let originTile = void 0;
      let iterations = 0;
      const { tempRange = [0, 100], onAdditionalTileTypes = false, avoidResourceTiles = false } = options;
      const minTemp = tempRange[0];
      const maxTemp = tempRange[1];
      const maxIterations = 100;
      while (!originTile) {
        iterations++;
        if (iterations >= maxIterations) {
          console.log("Reached max iterations for random tile: " + options.tileTypes);
          break;
        }
        const randomTile = this.tiles[random_default.int(0, this.mapWidth - 1)][random_default.int(0, this.mapHeight - 1)];
        if (options.avoidTileTypes && randomTile.containsTileTypes(options.avoidTileTypes)) continue;
        if (options.tileTypes && !randomTile.containsTileTypes(options.tileTypes)) continue;
        if (randomTile.getGenerationTemp() < minTemp || randomTile.getGenerationTemp() > maxTemp) continue;
        if (!onAdditionalTileTypes && randomTile.getTileTypes().length > 1) continue;
        if (avoidResourceTiles && MapResources.isResourceTile(randomTile)) continue;
        originTile = randomTile;
      }
      return originTile;
    }
    removeTopRiverSideCache() {
      this.riverSideHistory.shift();
    }
    cacheSetRiverSides() {
      const riverSidesMap = /* @__PURE__ */ new Map();
      this.riverSideHistory.unshift(riverSidesMap);
    }
    restoreCachedRiverSides() {
      const riverSidesMap = this.riverSideHistory.shift();
      for (const [effectedTile, riverSides] of riverSidesMap.entries()) {
        for (const riverSide of riverSides) {
          effectedTile.getRiverSides()[riverSide] = false;
        }
      }
    }
    storeSetRiverSideEntry(tilesEffected) {
      if (this.riverSideHistory.length < 1) return;
      const riverSidesMap = this.riverSideHistory[0];
      for (const [effectedTile, riverSide] of tilesEffected.entries()) {
        if (riverSidesMap.has(effectedTile)) {
          riverSidesMap.get(effectedTile).push(riverSide);
        } else {
          riverSidesMap.set(effectedTile, [riverSide]);
        }
      }
    }
    // https://en.wikipedia.org/wiki/A*_search_algorithm
    constructShortestPath(unit, startTile, goalTile) {
      if (!startTile || !goalTile) return [];
      let h = (n) => Math.floor(Tile.gridDistance(n, goalTile));
      let gScore = [];
      let fScore = [];
      let cameFrom = [];
      for (let x = 0; x < this.mapWidth; x++) {
        gScore[x] = [];
        fScore[x] = [];
        cameFrom[x] = [];
        for (let y = 0; y < this.mapHeight; y++) {
          gScore[x][y] = Number.MAX_VALUE;
          fScore[x][y] = 0;
        }
      }
      gScore[startTile.getX()][startTile.getY()] = 0;
      fScore[startTile.getX()][startTile.getY()] = h(startTile);
      let openSet = new PriorityQueue({
        comparator: (a, b) => {
          const fscoreA = fScore[a.getX()][a.getY()];
          const fscoreB = fScore[b.getX()][b.getY()];
          if (fscoreA < fscoreB) {
            return -1;
          } else if (fscoreA > fscoreB) {
            return 1;
          } else {
            return 0;
          }
        },
        initialValues: [startTile]
      });
      while (openSet.length > 0) {
        let currentTile = openSet.dequeue();
        if (currentTile == goalTile) {
          return this.reconstructPath(unit, cameFrom, currentTile);
        }
        for (let neighborTile of currentTile.getAdjacentTiles()) {
          if (!neighborTile) continue;
          let d = (current, neighbor) => unit.getTileWeight(current, neighbor);
          let tentativeGScore = gScore[currentTile.getX()][currentTile.getY()] + d(currentTile, neighborTile);
          if (tentativeGScore < gScore[neighborTile.getX()][neighborTile.getY()]) {
            cameFrom[neighborTile.getX()][neighborTile.getY()] = currentTile;
            gScore[neighborTile.getX()][neighborTile.getY()] = tentativeGScore;
            fScore[neighborTile.getX()][neighborTile.getY()] = tentativeGScore + h(neighborTile);
            openSet.queue(neighborTile);
          }
        }
      }
      return [];
    }
    getTileWithHighestYeild(options) {
      let highestTile = void 0;
      let highestValue = 0;
      for (const tile of options.tiles) {
        if (options.ignoreTiles.includes(tile)) continue;
        let value = tile.getTotalStatValue(options.stats);
        if (value > highestValue || highestTile === void 0) {
          highestValue = value;
          highestTile = tile;
        }
      }
      return highestTile;
    }
    reconstructPath(unit, cameFrom, currentTile) {
      const totalPath = [currentTile];
      let movementCost = 0;
      movementCost += unit.getTileWeight(currentTile, void 0);
      while (currentTile != void 0) {
        currentTile = cameFrom[currentTile.getX()][currentTile.getY()];
        if (currentTile) {
          totalPath.unshift(currentTile);
          movementCost += unit.getTileWeight(currentTile, void 0);
        }
      }
      if (movementCost >= 9999) {
        return [];
      }
      return totalPath;
    }
  };
  __publicField(_GameMap, "instance");
  __publicField(_GameMap, "oddEdgeAxis", [
    [0, -1],
    [1, -1],
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 0]
  ]);
  __publicField(_GameMap, "evenEdgeAxis", [
    [-1, -1],
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 1],
    [-1, 0]
  ]);
  var GameMap = _GameMap;

  // wsf:src/openciv-src/server/src/unit/Unit
  var _Unit = class _Unit {
    constructor(options) {
      __publicField(this, "name");
      __publicField(this, "player");
      __publicField(this, "attackType");
      __publicField(this, "defaultMoveDistance");
      __publicField(this, "availableMovement");
      __publicField(this, "tile");
      __publicField(this, "queuedMovementTiles");
      __publicField(this, "id");
      // Increment this every time a unit object is created
      __publicField(this, "actions");
      this.name = options.name;
      this.player = options.player;
      this.tile = options.tile;
      this.attackType = options.attackType || "none";
      this.defaultMoveDistance = options.defaultMoveDistance || 2;
      this.availableMovement = this.defaultMoveDistance;
      this.actions = options.actions || [];
      this.actions = options.actions || [];
      this.queuedMovementTiles = [];
      this.player.addUnit(this);
      this.id = _Unit.nextId;
      _Unit.nextId += 1;
      ServerEvents.on({
        eventName: "moveUnit",
        parentObject: this,
        callback: (data, websocket) => {
          const targetTile = GameMap.getInstance().getTiles()[data["targetX"]][data["targetY"]];
          const player = Game.getInstance().getPlayerFromWebsocket(websocket);
          if (this.id !== data["id"] || this.tile === targetTile || this.player != player) return;
          const [arrivedTile, remainingTiles, remainingMovement] = this.getMovementTowardsTargetTile(targetTile);
          if (!arrivedTile) return;
          this.moveToTile({
            previousTile: this.tile,
            targetTile: arrivedTile,
            remainingTiles,
            remainingMovement
          });
        }
      });
      ServerEvents.on({
        eventName: "unitAction",
        parentObject: this,
        callback: (data, websocket) => {
          const unitTile = GameMap.getInstance().getTiles()[data["unitX"]][data["unitY"]];
          if (this.tile !== unitTile) return;
          const action = this.getActionByName(data["actionName"]);
          if (action) {
            action.onAction(this);
          }
        }
      });
      ServerEvents.on({
        eventName: "nextTurn",
        parentObject: this,
        callback: (data) => {
          this.availableMovement = this.defaultMoveDistance;
          if (this.queuedMovementTiles.length > 0) {
            this.moveWithMovementQueue();
          }
        }
      });
    }
    moveToTile(options) {
      const previousTile = options.previousTile;
      const targetTile = options.targetTile;
      const remainingTiles = options.remainingTiles;
      const remainingMovement = options.remainingMovement;
      this.tile.removeUnit(this);
      targetTile.addUnit(this);
      this.tile = targetTile;
      this.queuedMovementTiles = remainingTiles;
      this.availableMovement = remainingMovement;
      const dataPacket = {
        event: "moveUnit",
        id: this.id,
        remainingMovement,
        unitX: previousTile.getX(),
        unitY: previousTile.getY(),
        targetX: targetTile.getX(),
        targetY: targetTile.getY()
      };
      if (remainingTiles.length > 0) {
        const remainingTilesJSON = [];
        for (const tile of remainingTiles) {
          remainingTilesJSON.push({ x: tile.getX(), y: tile.getY() });
        }
        dataPacket["queuedTiles"] = remainingTilesJSON;
      }
      Game.getInstance().getPlayers().forEach((player) => {
        player.sendNetworkEvent(dataPacket);
      });
    }
    moveWithMovementQueue() {
      const targetTile = this.getTargetQueuedTile();
      const existingPath = [this.tile, ...this.queuedMovementTiles];
      const [arrivedTile, remainingTiles, remainingMovement] = this.getMovementTowardsTargetTile(
        targetTile,
        existingPath
      );
      if (!arrivedTile) return;
      this.moveToTile({
        previousTile: this.tile,
        targetTile: arrivedTile,
        remainingTiles,
        remainingMovement
      });
    }
    getMovementTowardsTargetTile(tile, existingPath) {
      const shortestPath = existingPath ?? GameMap.getInstance().constructShortestPath(
        this,
        this.tile,
        // Starting tile
        tile
        // Target tile
      );
      const traversedTiles = [this.tile];
      let remainingMovement = this.availableMovement;
      for (let i = 0; i < shortestPath.length; i++) {
        const currentTile = shortestPath[i];
        const nextTile = i + 1 >= shortestPath.length ? void 0 : shortestPath[i + 1];
        if (!nextTile) continue;
        if (remainingMovement <= 0) {
          break;
        }
        const movementCost = this.getTileWeight(currentTile, nextTile);
        remainingMovement = Math.max(remainingMovement - movementCost, 0);
        traversedTiles.push(nextTile);
      }
      const remainingTiles = shortestPath.filter((tile2) => !traversedTiles.includes(tile2));
      return [traversedTiles.pop(), remainingTiles, remainingMovement];
    }
    delete() {
      this.tile.removeUnit(this);
      this.player.removeUnit(this);
      ServerEvents.removeCallbacksByParentObject(this);
      Game.getInstance().getPlayers().forEach((player) => {
        player.sendNetworkEvent({
          event: "removeUnit",
          id: this.id,
          unitX: this.tile.getX(),
          unitY: this.tile.getY()
        });
      });
    }
    getPlayer() {
      return this.player;
    }
    getTile() {
      return this.tile;
    }
    asJSON() {
      const queuedTilesJSON = this.queuedMovementTiles.map((tile) => ({
        x: tile.getX(),
        y: tile.getY()
      }));
      return {
        name: this.name,
        tileX: this.tile.getX(),
        tileY: this.tile.getY(),
        player: this.player.getName(),
        attackType: this.attackType,
        id: this.id,
        actions: this.getUnitActionsJSON(),
        queuedTiles: queuedTilesJSON,
        remainingMovement: this.availableMovement,
        defaultMoveDistance: this.defaultMoveDistance
      };
    }
    getActionByName(name) {
      for (const action of this.actions) {
        if (action.name === name) {
          return action;
        }
      }
      return void 0;
    }
    getUnitActionsJSON() {
      const actions = [];
      actions.push(
        ...this.actions.map(({ name, icon, requirements, desc }) => ({
          name,
          icon,
          requirements,
          desc
        }))
      );
      return actions;
    }
    getTileWeight(current, neighbor) {
      if (current.isWater()) {
        return 9999;
      }
      if (!neighbor) return current.getMovementCost();
      return Tile.getWeight(current, neighbor);
    }
    getTargetQueuedTile() {
      if (this.queuedMovementTiles.length < 1) return void 0;
      return this.queuedMovementTiles[this.queuedMovementTiles.length - 1];
    }
  };
  __publicField(_Unit, "nextId", 0);
  var Unit = _Unit;

  // wsf:src/openciv-src/shims/node-schedule
  var jobs = [];
  var Job = class {
    cancel() {
    }
  };
  function scheduleJob(expr, cb) {
    const id = window.setInterval(cb, 1e3);
    jobs.push(id);
    return new Job();
  }
  function gracefulShutdown() {
    for (const id of jobs) window.clearInterval(id);
    jobs.length = 0;
  }

  // wsf:src/openciv-src/server/src/city/City
  var City = class {
    /**
     * Creates a new City instance.
     * @param options - The options for initializing the city.
     * @param options.tile - The tile where the city is located.
     * @param options.player - The player who owns the city.
     */
    constructor(options) {
      __publicField(this, "tile");
      __publicField(this, "player");
      __publicField(this, "name");
      __publicField(this, "buildings");
      __publicField(this, "population");
      __publicField(this, "foodSurplus");
      __publicField(this, "territory");
      __publicField(this, "workedTiles");
      this.tile = options.tile;
      this.player = options.player;
      this.name = this.player.getNextAvailableCityName();
      this.buildings = [];
      this.population = 1;
      this.foodSurplus = 0;
      this.territory = [this.tile];
      for (const adjTile of this.tile.getAdjacentTiles()) {
        if (!adjTile) continue;
        this.territory.push(adjTile);
      }
      this.sendTerritoryUpdate();
      this.updateWorkedTiles({ sendStatUpdate: true });
      ServerEvents.on({
        eventName: "requestCityStats",
        parentObject: this,
        callback: (data, websocket) => {
          const player = Game.getInstance().getPlayerFromWebsocket(websocket);
          if (this.name != data["cityName"] || this.player != player) {
            return;
          }
          this.sendStatUpdate(player);
        }
      });
    }
    updateWorkedTiles(options) {
      this.workedTiles = [this.tile];
      for (let i = 0; i < this.population; i++) {
        const statline = this.getStatline({ asArray: false });
        const tileFocus = statline["food"] < 0 ? "food" : "default";
        const tile = GameMap.getInstance().getTileWithHighestYeild({
          stats: [tileFocus],
          tiles: this.territory,
          ignoreTiles: this.workedTiles
        });
        this.workedTiles.push(tile);
      }
      if (options.sendStatUpdate) {
        this.sendStatUpdate(this.player);
      }
    }
    addBuilding(name) {
      const buildingData = Game.getInstance().getCurrentStateAs().getBuildingDataByName(name);
      this.buildings.push(buildingData);
      this.player.sendNetworkEvent({
        event: "addBuilding",
        cityName: this.name,
        building: buildingData
      });
      this.updateWorkedTiles({ sendStatUpdate: true });
    }
    sendTerritoryUpdate() {
    }
    /*
      Get the city-stat line, and send it to the player
    */
    sendStatUpdate(player) {
      const cityStats = this.getStatline({ asArray: true });
      player.sendNetworkEvent({
        event: "updateCityStats",
        cityName: this.name,
        cityStats,
        workedTiles: this.workedTiles.map((tile) => ({ x: tile.getX(), y: tile.getY() }))
      });
    }
    getStatline(options) {
      if (options.asArray) {
        const cityStats2 = [
          {
            population: this.population
          },
          { science: 0 },
          { gold: 0 },
          { production: 0 },
          { faith: 0 },
          { culture: 0 },
          { food: -(this.population * 2) },
          { morale: 0 },
          //TODO: Implement morale
          { foodSurplus: this.foodSurplus }
        ];
        for (const buildingData of this.buildings) {
          for (const stat of buildingData.stats) {
            const statType = Object.keys(stat)[0];
            const statValue = stat[statType];
            for (const cityStat of cityStats2) {
              if (Object.keys(cityStat)[0] === statType) {
                cityStat[statType] += statValue;
              }
            }
          }
        }
        console.log(`[City ${this.name}] Updating stats (asArray). Worked tiles: ${this.workedTiles.length}`);
        for (const tile of this.workedTiles) {
          console.log(`[City ${this.name}] Working tile at ${tile.getX()},${tile.getY()}`);
          for (const stat of tile.getStats()) {
            const statType = Object.keys(stat)[0];
            const statValue = stat[statType];
            if (statValue !== 0) {
              console.log(`[City ${this.name}] Tile yields ${statType}: ${statValue}`);
            }
            for (const cityStat of cityStats2) {
              if (Object.keys(cityStat)[0] === statType) {
                cityStat[statType] += statValue;
              }
            }
          }
        }
        return cityStats2;
      }
      const cityStats = {
        population: this.population,
        science: 0,
        gold: 0,
        production: 0,
        faith: 0,
        culture: 0,
        food: -(this.population * 2),
        morale: 0,
        //TODO: Implement morale
        foodSurplus: this.foodSurplus
      };
      for (const buildingData of this.buildings) {
        for (const stat of buildingData.stats) {
          const statType = Object.keys(stat)[0];
          const statValue = stat[statType];
          if (cityStats.hasOwnProperty(statType)) {
            cityStats[statType] += statValue;
          }
        }
      }
      for (const tile of this.workedTiles) {
        for (const stat of tile.getStats()) {
          const statType = Object.keys(stat)[0];
          const statValue = stat[statType];
          if (cityStats.hasOwnProperty(statType)) {
            cityStats[statType] += statValue;
          }
        }
      }
      return cityStats;
    }
    getTile() {
      return this.tile;
    }
    getPlayer() {
      return this.player;
    }
    getName() {
      return this.name;
    }
    getJSON() {
      const territoryCoords = this.territory.map((tile) => ({
        tileX: tile.getX(),
        tileY: tile.getY()
      }));
      return {
        cityName: this.name,
        player: this.player.getName(),
        tileX: this.tile.getX(),
        tileY: this.tile.getY(),
        territory: territoryCoords,
        workedTiles: this.workedTiles.map((tile) => ({ x: tile.getX(), y: tile.getY() }))
      };
    }
  };

  // wsf:src/openciv-src/server/src/unit/UnitActions
  var UnitActions = class {
    static settleCity() {
      return {
        name: "settle",
        icon: "SETTLE_ICON",
        requirements: ["awayFromCity", "movement"],
        desc: "Settle City",
        onAction: (unit) => {
          console.log("ACTION: Act on settle city.");
          const tile = unit.getTile();
          const player = unit.getPlayer();
          unit.delete();
          const city = new City({ player, tile });
          tile.setCity(city);
          player.getCities().push(city);
          Game.getInstance().getPlayers().forEach((gamePlayer) => {
            gamePlayer.sendNetworkEvent({
              event: "newCity",
              ...city.getJSON()
            });
          });
          if (player.getCities().length < 2) {
            city.addBuilding("palace");
          }
        }
      };
    }
    createReligion() {
    }
  };

  // wsf:src/openciv-src/server/src/state/type/InGameState
  var InGameState = class extends State {
    constructor() {
      super(...arguments);
      __publicField(this, "turnTimeJob");
      __publicField(this, "currentTurn");
      __publicField(this, "totalTurnTime");
      __publicField(this, "turnTime");
      __publicField(this, "cityBuildings");
    }
    onInitialize() {
      this.totalTurnTime = 60;
      this.currentTurn = 0;
      this.turnTime = 0;
      const buildingsYMLData = yaml_default.parse(fs_default.readFileSync("./config/buildings.yml", "utf-8"));
      this.cityBuildings = JSON.parse(JSON.stringify(buildingsYMLData.buildings));
      Game.getInstance().getPlayers().forEach((player) => {
        player.sendNetworkEvent({ event: "setScene", scene: "loading_scene" });
      });
      GameMap.init();
      console.log("InGame state initialized");
      ServerEvents.on({
        eventName: "connection",
        parentObject: this,
        callback: (data, websocket) => {
          console.log("Connection attempted while game in progress...");
          websocket.send(
            JSON.stringify({
              event: "messageBox",
              messageName: "gameInProgress",
              message: "Connection Error: Game in progress."
            })
          );
          websocket.close();
        }
      });
      ServerEvents.on({
        eventName: "requestMap",
        parentObject: this,
        callback: (data, websocket) => {
          const player = Game.getInstance().getPlayerFromWebsocket(websocket);
          GameMap.getInstance().sendMapChunksToPlayer(player);
        }
      });
      ServerEvents.on({
        eventName: "requestTileYields",
        parentObject: this,
        callback: (data, websocket) => {
          const player = Game.getInstance().getPlayerFromWebsocket(websocket);
          GameMap.getInstance().sendTileYieldsToPlayer(player);
        }
      });
      Game.getInstance().getPlayers().forEach((player) => {
        const badTileTypes = [
          "ocean",
          "shallow_ocean",
          "freshwater",
          "mountain",
          "snow",
          "snow_hill",
          "tundra",
          "tundra_hill"
        ];
        const spawnTile = GameMap.getInstance().getRandomTileWith({
          avoidTileTypes: badTileTypes
        });
        spawnTile.addUnit(
          new Unit({
            name: "settler",
            player,
            tile: spawnTile,
            actions: [UnitActions.settleCity()]
          })
        );
        for (const adjTile of spawnTile.getAdjacentTiles()) {
          if (!adjTile || adjTile.containsTileTypes(badTileTypes)) continue;
          adjTile.addUnit(
            new Unit({
              name: "warrior",
              player,
              tile: adjTile,
              attackType: "melee",
              actions: []
            })
          );
          break;
        }
        player.onLoadedIn(() => {
          player.zoomToLocation(spawnTile.getX(), spawnTile.getY(), 3);
          let allLoaded = true;
          Game.getInstance().getPlayers().forEach((player2) => {
            if (!player2.isLoadedIn()) {
              allLoaded = false;
            }
          });
          if (allLoaded) {
            ServerEvents.call("allPlayersLoaded", {});
          }
        });
        player.sendNetworkEvent({ event: "setScene", scene: "in_game" });
      });
      ServerEvents.on({
        eventName: "allPlayersLoaded",
        parentObject: this,
        callback: () => {
          this.incrementTurn();
          this.beginTurnTimer();
        }
      });
      ServerEvents.on({
        eventName: "nextTurnRequest",
        parentObject: this,
        callback: (data, websocket) => {
          const player = Game.getInstance().getPlayerFromWebsocket(websocket);
          player.setRequestedNextTurn(data["value"]);
          const allRequested = Array.from(Game.getInstance().getPlayers().values()).every(
            (player2) => player2.hasRequestedNextTurn()
          );
          if (allRequested) {
            this.incrementTurn();
            Game.getInstance().getPlayers().forEach((player2) => {
              player2.setRequestedNextTurn(false);
            });
          }
        }
      });
    }
    getBuildingDataByName(name) {
      for (const building of this.cityBuildings) {
        if (building.name.toLocaleLowerCase() === name.toLocaleLowerCase()) {
          return building;
        }
      }
      return void 0;
    }
    // Decrease trunTime by -1 every 1 second
    beginTurnTimer() {
      this.turnTimeJob = scheduleJob("* * * * * *", () => {
        Game.getInstance().getPlayers().forEach((player) => {
          player.sendNetworkEvent({
            event: "turnTimeDecrement",
            turn: this.currentTurn,
            turnTime: this.turnTime
          });
        });
        if (this.turnTime <= 0) {
          this.incrementTurn();
        }
        this.turnTime -= 1;
      });
    }
    incrementTurn() {
      this.currentTurn++;
      this.turnTime = this.totalTurnTime;
      Game.getInstance().getPlayers().forEach((player) => {
        player.sendNetworkEvent({
          event: "newTurn",
          turn: this.currentTurn,
          turnTime: this.turnTime
        });
      });
      ServerEvents.call("nextTurn", { turn: this.currentTurn });
    }
    onDestroyed() {
      if (this.turnTimeJob) {
        gracefulShutdown();
      }
      GameMap.destroyInstance();
      return super.onDestroyed();
    }
  };

  // wsf:src/openciv-src/server/src/Player
  var Player = class {
    /**
     * Creates a new player object.
     * @param name The name of the player.
     * @param wsConnection The WebSocket connection of the player.
     */
    constructor(name, wsConnection) {
      /** The name of the player. */
      __publicField(this, "name");
      /** The WebSocket connection of the player. */
      __publicField(this, "wsConnection");
      /** Whether the player has loaded into the game. */
      __publicField(this, "loadedIn");
      /** The callback to execute when the player has loaded into the game. */
      __publicField(this, "loadedInCallback");
      /** The callback to execute when the player resizes their window. */
      __publicField(this, "resizeWindowCallback");
      __publicField(this, "requestedNextTurn");
      __publicField(this, "civilizationData");
      __publicField(this, "cities");
      __publicField(this, "units");
      this.name = name;
      this.wsConnection = wsConnection;
      this.loadedIn = false;
      this.requestedNextTurn = false;
      this.cities = [];
      this.units = [];
      this.wsConnection.on("close", (data) => {
        console.log(name + " quit");
        ServerEvents.call("playerQuit", {}, this.wsConnection);
        Game.getInstance().getPlayers().delete(this.name);
        for (const player of Array.from(Game.getInstance().getPlayers().values())) {
          if (player === this) {
            continue;
          }
          player.sendNetworkEvent({ event: "playerQuit", playerName: this.name });
        }
      });
      ServerEvents.on({
        eventName: "loadedIn",
        parentObject: this,
        callback: (data, websocket) => {
          if (this.wsConnection != websocket) return;
          this.loadedIn = true;
          this.loadedInCallback.call(void 0);
        },
        globalEvent: true
      });
      ServerEvents.on({
        eventName: "resizeWindow",
        parentObject: this,
        callback: (data, websocket) => {
          if (this.wsConnection != websocket) return;
          this.resizeWindowCallback.call(void 0);
        },
        globalEvent: true
      });
    }
    /**
     * Instruct all players to zoom onto a specified location.
     * @param x The x coordinate of the location.
     * @param y The y coordinate of the location.
     * @param zoomAmount The zoom amount to apply.
     */
    static allZoomOnto(x, y, zoomAmount) {
      for (let player of Game.getInstance().getPlayers().values()) {
        player.zoomToLocation(x, y, zoomAmount);
      }
    }
    /**
     * Registers a callback to execute when the player has loaded into the game.
     * @param callback The callback function to execute.
     */
    onLoadedIn(callback) {
      this.loadedInCallback = callback;
    }
    onResizeWindow(callback) {
      this.resizeWindowCallback = callback;
    }
    setRequestedNextTurn(value) {
      this.requestedNextTurn = value;
    }
    hasRequestedNextTurn() {
      return this.requestedNextTurn;
    }
    setCivilizationData(civilizationData) {
      this.civilizationData = civilizationData;
    }
    /**
     * Send a network packet to instruct the client to zoom onto a specified location.
     * @param x The x coordinate of the location.
     * @param y The y coordinate of the location.
     * @param zoomAmount The zoom amount to apply.
     */
    zoomToLocation(x, y, zoomAmount) {
      this.sendNetworkEvent({
        event: "zoomToLocation",
        x,
        y,
        zoomAmount
      });
    }
    /**
     * Sends a network event to the player.
     * @param event The network event to send.
     */
    sendNetworkEvent(event) {
      this.wsConnection.send(JSON.stringify(event));
    }
    /**
     * Returns the name of the player.
     * @returns The name of the player.
     */
    getName() {
      return this.name;
    }
    /**
     * Returns the WebSocket connection of the player.
     * @returns The WebSocket connection of the player.
     */
    getWebsocket() {
      return this.wsConnection;
    }
    isLoadedIn() {
      return this.loadedIn;
    }
    toJSON() {
      return {
        name: this.name,
        civData: this.civilizationData,
        requestedNextTurn: this.requestedNextTurn
      };
    }
    getCivilizationData() {
      return this.civilizationData;
    }
    /**
     * Checks for exsting city names, and returns the next available city name.
     */
    getNextAvailableCityName() {
      const eixtingNames = [];
      const allCityNames = this.civilizationData["cities"];
      for (const city of this.cities) {
        eixtingNames.push(city.getName());
      }
      for (const name of allCityNames) {
        if (!eixtingNames.includes(name)) {
          return name;
        }
      }
      return "MAX_CITIES_REACHED";
    }
    getCities() {
      return this.cities;
    }
    getUnits() {
      return this.units;
    }
    addUnit(unit) {
      this.units.push(unit);
    }
    removeUnit(unit) {
      this.units = this.units.filter((u) => u !== unit);
    }
  };

  // wsf:src/openciv-src/server/src/state/type/LobbyState
  var playerIndex = 1;
  var LobbyState = class extends State {
    constructor() {
      super(...arguments);
      __publicField(this, "playableCivs");
    }
    onInitialize() {
      console.log("Lobby state initialized");
      playerIndex = 1;
      const civYAMLData = yaml_default.parse(fs_default.readFileSync("./config/civilizations.yml", "utf-8"));
      this.playableCivs = JSON.parse(JSON.stringify(civYAMLData.civilizations));
      ServerEvents.on({
        eventName: "connection",
        parentObject: this,
        callback: (data, websocket) => {
          const playerName = "Player" + playerIndex;
          playerIndex++;
          console.log(playerName + " has joined the lobby");
          const newPlayer = new Player(playerName, websocket);
          Game.getInstance().getPlayers().set(playerName, newPlayer);
          for (const player of Array.from(Game.getInstance().getPlayers().values())) {
            player.sendNetworkEvent({
              event: "playerJoin",
              playerName
            });
          }
          newPlayer.sendNetworkEvent({ event: "setScene", scene: "lobby" });
        }
      });
      ServerEvents.on({
        eventName: "availableCivs",
        parentObject: this,
        callback: (_, websocket) => {
          const player = Game.getInstance().getPlayerFromWebsocket(websocket);
          const playableCivs = [];
          for (const civ of this.playableCivs) {
            playableCivs.push({ name: civ.name, icon_name: civ.icon_name });
          }
          player.sendNetworkEvent({
            event: "availableCivs",
            civs: playableCivs
          });
        }
      });
      ServerEvents.on({
        eventName: "civInfo",
        parentObject: this,
        callback: (data, websocket) => {
          const player = Game.getInstance().getPlayerFromWebsocket(websocket);
          const civilization = this.getCivByName(data["name"]);
          if (civilization) {
            player.sendNetworkEvent({
              event: "civInfo",
              name: civilization.name,
              icon_name: civilization.icon_name,
              start_bias_desc: civilization.start_bias_desc,
              unique_unit_descs: civilization.unique_unit_descs,
              unique_building_descs: civilization.unique_building_descs,
              ability_descs: civilization.ability_descs
            });
          }
        }
      });
      ServerEvents.on({
        eventName: "selectCiv",
        parentObject: this,
        callback: (data, websocket) => {
          const player = Game.getInstance().getPlayerFromWebsocket(websocket);
          const civilization = this.getCivByName(data["name"]);
          player.setCivilizationData(civilization);
          Game.getInstance().getPlayers().forEach((gamePlayer) => {
            gamePlayer.sendNetworkEvent({
              event: "selectCiv",
              name: civilization.name,
              playerName: player.getName(),
              civData: civilization
            });
          });
        }
      });
    }
    getCivByName(name) {
      let civilization = void 0;
      for (const civ of this.playableCivs) {
        if (civ.name === name) {
          civilization = civ;
        }
      }
      return civilization;
    }
    onDestroyed() {
      Game.getInstance().getPlayers().forEach((player) => {
        if (!player.getCivilizationData()) {
          player.setCivilizationData(this.getRandomNonAssignedCiv());
        }
      });
      return super.onDestroyed();
    }
    getRandomNonAssignedCiv() {
      const assignedCivs = [];
      Game.getInstance().getPlayers().forEach((player) => {
        if (player.getCivilizationData()) {
          assignedCivs.push(player.getCivilizationData());
        }
      });
      const nonAssignedCivs = this.playableCivs.filter((civ) => {
        return !assignedCivs.includes(civ);
      });
      const randomIndex = random_default.int(0, nonAssignedCivs.length - 1);
      return nonAssignedCivs[randomIndex];
    }
  };

  // wsf:src/openciv-src/server/src/Server
  var _Server = class _Server {
    constructor() {
      __publicField(this, "port", 2e3);
      __publicField(this, "wss");
      __publicField(this, "connectedIPs", /* @__PURE__ */ new Set());
      __publicField(this, "allowDuplicateIPs", false);
    }
    /**
     *
     * @returns Server singleton instance
     */
    static getInstance() {
      if (this.serverInstance == void 0) {
        this.serverInstance = new _Server();
      }
      return this.serverInstance;
    }
    /**
     * Start the OpenCiv server
     */
    start() {
      this.wss = new WebSocketServer({ port: this.port });
      this.wss.on("connection", (websocket, request) => {
        const ip = request.socket.remoteAddress;
        console.log(`New connection from IP: ${ip}`);
        if (!this.allowDuplicateIPs && ip && this.connectedIPs.has(ip)) {
          websocket.close(4001, "Multiple connections from same IP are not allowed.");
          console.log(`Connection from IP ${ip} rejected: Multiple connections not allowed.`);
          return;
        }
        if (ip) {
          this.connectedIPs.add(ip);
        }
        websocket.on("close", () => {
          if (ip) this.connectedIPs.delete(ip);
          console.log(`Connection closed from IP: ${ip}`);
        });
        websocket.on("message", (data) => {
          console.log("Message: " + data);
          const jsonData = JSON.parse(data);
          ServerEvents.call(jsonData["event"], jsonData, websocket);
        });
        ServerEvents.call("connection", {}, websocket);
      });
      console.log("Server initialized on port: " + this.port);
      Game.init();
      Game.getInstance().addState("lobby", new LobbyState());
      Game.getInstance().addState("in_game", new InGameState());
      Game.getInstance().setState("lobby");
    }
    /**
     * Stop the OpenCiv server
     */
    stop() {
      console.log("Stopping server...");
      this.wss.close();
      process.exit(0);
    }
    setAllowDuplicateIPs(allow) {
      this.allowDuplicateIPs = allow;
    }
  };
  __publicField(_Server, "serverInstance");
  var Server = _Server;
  Server.getInstance().setAllowDuplicateIPs(true);
  Server.getInstance().start();

  // wsf:src/openciv-src/client/src/Assets
  var SpriteRegion = /* @__PURE__ */ ((SpriteRegion4) => {
    SpriteRegion4["WARRIOR"] = "0,1";
    SpriteRegion4["ARCHER"] = "0,0";
    SpriteRegion4["BUILDER"] = "1,0";
    SpriteRegion4["CAMEL_ARCHER"] = "2,0";
    SpriteRegion4["CARAVAN"] = "3,0";
    SpriteRegion4["CATAPULT"] = "5,0";
    SpriteRegion4["COMPOSITE_BOWMAN"] = "7,0";
    SpriteRegion4["CROSSBOWMAN"] = "8,0";
    SpriteRegion4["HORSEMAN"] = "10,0";
    SpriteRegion4["ROMAN_LEGION"] = "11,0";
    SpriteRegion4["SETTLER"] = "16,0";
    SpriteRegion4["BLANK_TILE"] = "9,8";
    SpriteRegion4["SHALLOW_OCEAN"] = "16,6";
    SpriteRegion4["OCEAN"] = "5,8";
    SpriteRegion4["FRESHWATER"] = "7,7";
    SpriteRegion4["GRASS"] = "3,6";
    SpriteRegion4["GRASS_HILL"] = "4,6";
    SpriteRegion4["MOUNTAIN"] = "14,6";
    SpriteRegion4["DESERT"] = "10,5";
    SpriteRegion4["DESERT_HILL"] = "11,5";
    SpriteRegion4["PLAINS"] = "1,7";
    SpriteRegion4["PLAINS_HILL"] = "2,7";
    SpriteRegion4["TUNDRA"] = "15,7";
    SpriteRegion4["TUNDRA_HILL"] = "16,7";
    SpriteRegion4["SNOW"] = "3,8";
    SpriteRegion4["SNOW_HILL"] = "4,8";
    SpriteRegion4["JUNGLE"] = "10,6";
    SpriteRegion4["FOREST"] = "17,5";
    SpriteRegion4["FLOODPLAINS"] = "16,5";
    SpriteRegion4["CATTLE"] = "1,5";
    SpriteRegion4["SHEEP"] = "8,7";
    SpriteRegion4["FISH"] = "14,5";
    SpriteRegion4["CRAB"] = "8,5";
    SpriteRegion4["WHALES"] = "1,8";
    SpriteRegion4["TURTLES"] = "18,7";
    SpriteRegion4["HORSES"] = "6,6";
    SpriteRegion4["COPPER"] = "4,5";
    SpriteRegion4["GOLD"] = "1,6";
    SpriteRegion4["IRON"] = "8,6";
    SpriteRegion4["COTTON"] = "6,5";
    SpriteRegion4["CITRUS"] = "17,6";
    SpriteRegion4["OLIVES"] = "14,7";
    SpriteRegion4["STONE"] = "13,7";
    SpriteRegion4["CITY"] = "8,8";
    SpriteRegion4["STAR"] = "0,3";
    SpriteRegion4["HOVERED_TILE"] = "6,8";
    SpriteRegion4["UNIT_SELECTION_TILE"] = "7,8";
    SpriteRegion4["DEBUG1"] = "3,11";
    SpriteRegion4["DEBUG2"] = "14,13";
    SpriteRegion4["DEBUG3"] = "17,13";
    SpriteRegion4["UI_STATUSBAR"] = "4,3";
    SpriteRegion4["RADIO_BUTTON_UNSELECTED"] = "8,14";
    SpriteRegion4["RADIO_BUTTON_SELECTED"] = "9,14";
    SpriteRegion4["UNIT_SELECTION_CIRCLE"] = "1,3";
    SpriteRegion4["UNKNOWN_ICON"] = "2,11";
    SpriteRegion4["ROME_ICON"] = "13,11";
    SpriteRegion4["MONGOLIA_ICON"] = "2,12";
    SpriteRegion4["MAMLUKS_ICON"] = "5,12";
    SpriteRegion4["AMERICA_ICON"] = "7,14";
    SpriteRegion4["GERMANY_ICON"] = "18,12";
    SpriteRegion4["ENGLAND_ICON"] = "3,13";
    SpriteRegion4["CUBA_ICON"] = "5,13";
    SpriteRegion4["CANADA_ICON"] = "3,14";
    SpriteRegion4["PRODUCTION_ICON"] = "16,11";
    SpriteRegion4["FOOD_ICON"] = "0,13";
    SpriteRegion4["MORALE_ICON"] = "1,12";
    SpriteRegion4["POPULATION_ICON"] = "17,13";
    SpriteRegion4["SCIENCE_ICON"] = "12,11";
    SpriteRegion4["CULTURE_ICON"] = "10,12";
    SpriteRegion4["GOLD_ICON"] = "17,12";
    SpriteRegion4["FAITH_ICON"] = "2,13";
    SpriteRegion4["TRADE_ICON"] = "5,14";
    SpriteRegion4["SETTLE_ICON"] = "11,11";
    SpriteRegion4["BUILDING_PALACE"] = "5,18";
    return SpriteRegion4;
  })(SpriteRegion || {});
  var assetList = [
    "./src/assets/ui_button.png",
    "./src/assets/ui_button_hovered.png",
    "./src/assets/ui_icon_button.png",
    "./src/assets/ui_icon_button_hovered.png",
    "./src/assets/spritesheet.png",
    "./src/assets/river.png",
    "./src/assets/ui_popup_box.png",
    "./src/assets/debug.png",
    "./src/assets/font.png",
    "./src/assets/logo.png"
  ];

  // wsf:src/openciv-src/client/src/network/Client
  var CallbackData2 = class {
    // Not associated with the current scene.
    constructor(parentObject, callbackFunctions, globalEvent) {
      __publicField(this, "parentObject");
      __publicField(this, "callbackFunction");
      __publicField(this, "globalEvent");
      this.parentObject = parentObject;
      this.callbackFunction = callbackFunctions;
      this.globalEvent = globalEvent;
    }
  };
  var NetworkEvents = class {
    constructor() {
    }
    static call(eventName, data) {
      if (this.storedEvents.has(eventName)) {
        const callbackDataList = this.storedEvents.get(eventName);
        for (let callbackData of callbackDataList) {
          callbackData.callbackFunction(data);
        }
      }
    }
    /**
     * Register a callback function to be called when a network event is received.
     *
     * @param {OnNetworkEventOptions} options - Options for the event listener.
     * @param {string} options.eventName - The name of the event to listen for.
     * @param {(data: JSON) => void} options.callback - The callback function to be called when the event is received.
     * @param {boolean} [options.globalEvent=false] - Determine if we don't remove the event when the scene changes.
     */
    static on(options) {
      if (!this.storedEvents) {
        this.storedEvents = /* @__PURE__ */ new Map();
      }
      this.addCallbackEvent(
        this.storedEvents,
        options.eventName,
        options.parentObject,
        options.callback,
        options.globalEvent
      );
    }
    /**
     * Removes all associated callback functions that isn't a globalEvent
     */
    static clear() {
      const globalEventCallbacks = this.getGlobalEventCallbacks(this.storedEvents);
      this.storedEvents = globalEventCallbacks;
    }
    static removeCallbacksByParentObject(parentObj) {
      this.storedEvents.forEach((callbackDataList, eventName) => {
        const filteredDataList = callbackDataList.filter((callbackData) => callbackData.parentObject !== parentObj);
        if (filteredDataList.length === 0) {
          this.storedEvents.delete(eventName);
        } else {
          this.storedEvents.set(eventName, filteredDataList);
        }
      });
    }
    static getGlobalEventCallbacks(storedEvents) {
      const globalEventCallbacks = /* @__PURE__ */ new Map();
      this.storedEvents.forEach((callbackDataList, eventName) => {
        for (const callbackData of callbackDataList) {
          if (callbackData.globalEvent) {
            this.addCallbackEvent(
              globalEventCallbacks,
              eventName,
              callbackData.parentObject,
              callbackData.callbackFunction,
              true
            );
          }
        }
      });
      return globalEventCallbacks;
    }
    static addCallbackEvent(storedEvents, eventName, parentObject, callback, globalEvent) {
      let callbackDataList = storedEvents.get(eventName) ?? [];
      callbackDataList.push(new CallbackData2(parentObject, callback, globalEvent));
      storedEvents.set(eventName, callbackDataList);
    }
  };
  __publicField(NetworkEvents, "storedEvents");
  var WebsocketClient = class {
    constructor() {
    }
    // TODO: Add network events here with string & function that has arguments.
    // e.g. setScreen & screenType arg.
    static init(serverAddress) {
      this.websocket = new WebSocket("ws://" + serverAddress + ":2000/");
      this.websocket.onerror = (event) => {
        NetworkEvents.call("websocketError", JSON.parse("{}"));
      };
      this.websocket.addEventListener("open", (event) => {
        console.log("Connected to server");
        NetworkEvents.call("connected", JSON.parse("{}"));
      });
      this.websocket.addEventListener("message", (event) => {
        const eventsToIgnore = ["turnTimeDecrement"];
        const eventJSON = JSON.parse(event.data);
        if (!eventsToIgnore.includes(eventJSON["event"])) {
          console.log("Message from server: " + event.data);
        }
        NetworkEvents.call(eventJSON["event"], eventJSON);
      });
      this.websocket.addEventListener("close", (event) => {
        NetworkEvents.call("connectionClosed", JSON.parse("{}"));
      });
    }
    static disconnect() {
      this.websocket.close();
    }
    static sendMessage(message) {
      this.websocket.send(JSON.stringify(message));
    }
  };
  __publicField(WebsocketClient, "websocket");

  // wsf:src/openciv-src/client/src/Game
  var _Game2 = class _Game2 {
    constructor(options, assetsLoadedCallback) {
      __publicField(this, "canvas");
      __publicField(this, "canvasContext");
      __publicField(this, "scenes");
      __publicField(this, "currentScene");
      __publicField(this, "images", []);
      __publicField(this, "countedFrames", 0);
      __publicField(this, "lastTimeUpdate", Date.now());
      __publicField(this, "fps", 0);
      __publicField(this, "actors", []);
      __publicField(this, "lines", []);
      __publicField(this, "mouseX");
      __publicField(this, "mouseY");
      __publicField(this, "runGameLoop");
      __publicField(this, "wrappedTextCache", {});
      __publicField(this, "resizeTimer");
      __publicField(this, "oldWidth");
      __publicField(this, "oldHeight");
      __publicField(this, "dpr");
      this.scenes = /* @__PURE__ */ new Map();
      this.canvas = document.getElementById("canvas");
      this.dpr = window.devicePixelRatio || 1;
      this.canvas.width = window.innerWidth * this.dpr;
      this.canvas.height = window.innerHeight * this.dpr;
      this.canvas.style.width = window.innerWidth + "px";
      this.canvas.style.height = window.innerHeight + "px";
      this.canvasContext = this.canvas.getContext("2d");
      this.canvasContext.fillStyle = options.canvasColor ?? "white";
      this.canvasContext.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this.canvasContext.font = "12px Times new Roman";
      this.canvasContext.imageSmoothingEnabled = false;
      this.runGameLoop = true;
      document.fonts.ready.then(() => {
        this.canvas.addEventListener("mousemove", (event) => {
          this.actors.forEach((actor) => {
            actor.call("mousemove", {
              x: this.getWorldX(event.clientX),
              y: this.getWorldY(event.clientY),
              // We provide direct clientX & clientY for instances where we don't want to apply the DPR or camera transformations.
              clientX: event.clientX,
              clientY: event.clientY
            });
          });
          if (this.currentScene) {
            this.currentScene.call("mousemove", {
              x: this.getWorldX(event.clientX),
              y: this.getWorldY(event.clientY),
              // We provide direct clientX & clientY for instances where we don't want to apply the DPR or camera transformations.
              clientX: event.clientX,
              clientY: event.clientY,
              button: event.button
            });
          }
          this.mouseX = event.clientX;
          this.mouseY = event.clientY;
        });
        this.canvas.addEventListener("mousedown", (event) => {
          this.actors.forEach((actor) => {
            actor.call("mousedown", {
              x: this.getWorldX(event.clientX),
              y: this.getWorldY(event.clientY),
              // We provide direct clientX & clientY for instances where we don't want to apply the DPR or camera transformations.
              clientX: event.clientX,
              clientY: event.clientY,
              button: event.button
            });
          });
          if (this.currentScene) {
            this.currentScene.call("mousedown", {
              x: this.getWorldX(event.clientX),
              y: this.getWorldY(event.clientY),
              // We provide direct clientX & clientY for instances where we don't want to apply the DPR or camera transformations.
              clientX: event.clientX,
              clientY: event.clientY,
              button: event.button
            });
          }
        });
        this.canvas.addEventListener("mouseup", (event) => {
          this.actors.forEach((actor) => {
            actor.call("mouseup", {
              x: this.getWorldX(event.clientX),
              y: this.getWorldY(event.clientY),
              // We provide direct clientX & clientY for instances where we don't want to apply the DPR or camera transformations.
              clientX: event.clientX,
              clientY: event.clientY,
              button: event.button
            });
          });
          if (this.currentScene) {
            this.currentScene.call("mouseup", {
              x: this.getWorldX(event.clientX),
              y: this.getWorldY(event.clientY),
              // We provide direct clientX & clientY for instances where we don't want to apply the DPR or camera transformations.
              clientX: event.clientX,
              clientY: event.clientY,
              button: event.button
            });
          }
        });
        this.canvas.addEventListener("mouseleave", (event) => {
          this.actors.forEach((actor) => {
            actor.call("mouseleave", { x: this.getWorldX(event.clientX), y: this.getWorldY(event.clientY) });
          });
          if (this.currentScene) {
            this.currentScene.call("mouseleave", {
              x: this.getWorldX(event.clientX),
              y: this.getWorldY(event.clientY)
            });
          }
        });
        this.canvas.addEventListener("wheel", (event) => {
          this.actors.forEach((actor) => {
            actor.call("wheel", { deltaY: event.deltaY });
          });
          if (this.currentScene) {
            this.currentScene.call("wheel", {
              x: event.offsetX,
              y: event.offsetY,
              deltaY: event.deltaY
            });
          }
        });
        document.body.addEventListener("keydown", (event) => {
          this.actors.forEach((actor) => {
            actor.call("keydown", { key: event.key });
          });
          if (this.currentScene) {
            this.currentScene.call("keydown", { key: event.key });
          }
          if (event.key === "Backspace") {
            event.preventDefault();
          }
        });
        document.body.addEventListener("keyup", (event) => {
          this.actors.forEach((actor) => {
            actor.call("keyup", { key: event.key });
          });
          if (this.currentScene) {
            this.currentScene.call("keyup", { key: event.key });
          }
        });
        document.addEventListener("contextmenu", (event) => event.preventDefault());
        window.addEventListener("resize", () => {
          clearTimeout(this.resizeTimer);
          this.resizeTimer = setTimeout(() => {
            this.oldWidth = this.canvas.width;
            this.oldHeight = this.canvas.height;
            this.dpr = window.devicePixelRatio || 1;
            this.canvas.width = window.innerWidth * this.dpr;
            this.canvas.height = window.innerHeight * this.dpr;
            this.canvas.style.width = window.innerWidth + "px";
            this.canvas.style.height = window.innerHeight + "px";
            if (this.currentScene) {
              this.currentScene.redraw();
            }
            this.canvasContext.fillStyle = options.canvasColor ?? "white";
            this.canvasContext.fillRect(0, 0, this.canvas.width, this.canvas.height);
            this.canvasContext.font = "12px Times new Roman";
            this.canvasContext.imageSmoothingEnabled = false;
          }, 300);
        });
        let promise = this.loadAssetsPromise(options.assetList);
        promise.then((res) => {
          console.log("All assets loaded...");
          document.getElementById("loading_element").style.display = "none";
          document.getElementById("canvas").removeAttribute("hidden");
          window.requestAnimationFrame(() => {
            this.gameLoop();
          });
          assetsLoadedCallback();
        });
        NetworkEvents.on({
          eventName: "setScene",
          parentObject: this,
          callback: (data) => {
            this.setScene(data["scene"]);
          },
          globalEvent: true
        });
        NetworkEvents.on({
          eventName: "messageBox",
          parentObject: this,
          callback: (data) => {
            const message = data["message"];
            alert(message);
          },
          globalEvent: true
        });
      });
    }
    getWorldX(clientX) {
      return clientX * this.dpr;
    }
    getWorldY(clientY) {
      return clientY * this.dpr;
    }
    static getInstance() {
      return this.gameInstance;
    }
    static createInstance(options, assetsLoadedCallback) {
      this.gameInstance = new _Game2(options, assetsLoadedCallback);
    }
    gameLoop() {
      if (!this.runGameLoop) return;
      this.canvasContext.fillRect(0, 0, this.canvas.width, this.canvas.height);
      if (Date.now() - this.lastTimeUpdate >= 1e3) {
        this.fps = this.countedFrames;
        this.lastTimeUpdate = Date.now();
        this.countedFrames = 0;
      }
      this.currentScene.gameLoop();
      const fpsText = "FPS: " + this.fps;
      this.canvasContext.save();
      this.canvasContext.font = "12px sans";
      const metrics = this.canvasContext.measureText(fpsText);
      const textWidth = metrics.width;
      const padding = 2;
      const x = Math.max(this.getWidth() - textWidth - padding, padding);
      const y = this.getHeight() - 12;
      this.drawText(
        {
          text: fpsText,
          x,
          y,
          color: "white",
          font: "12px sans"
        },
        this.canvasContext
      );
      this.canvasContext.restore();
      this.countedFrames++;
      window.requestAnimationFrame(() => {
        this.gameLoop();
      });
    }
    async loadAssetsPromise(assetList2) {
      console.log("Asset list:", JSON.stringify(assetList2, null, 2));
      await Promise.all(assetList2.map((url, index) => {
        return new Promise((resolve, reject) => {
          console.log("Starting load for:", url);
          const image = new Image();
          image.crossOrigin = "Anonymous";
          image.onload = () => {
            console.log("\u2705 Successfully loaded:", url);
            this.images[index] = image;
            resolve();
          };
          image.onerror = (e) => {
            console.error("\u274C Load failed for:", url);
            console.error("Error event:", e);
            reject(`Failed to load ${url}`);
          };
          try {
            const absoluteUrl = new URL(url, window.location.href).href;
            console.log("Loading absolute URL:", absoluteUrl);
            image.src = absoluteUrl;
          } catch (error) {
            console.error("Invalid URL:", url, error);
            reject(`Invalid URL: ${url}`);
          }
        });
      }));
    }
    addScene(sceneName, scene) {
      this.scenes.set(sceneName, scene);
      scene.setName(sceneName);
    }
    setScene(sceneName) {
      this.actors = [];
      this.wrappedTextCache = {};
      const newScene = this.scenes.get(sceneName);
      if (this.currentScene != null) {
        this.currentScene.onDestroyed(newScene);
      }
      this.currentScene = newScene;
      this.currentScene.onInitialize();
    }
    addActor(actor) {
      this.actors.push(actor);
      actor.onCreated();
    }
    addLine(line) {
      this.lines.push(line);
    }
    removeLine(line) {
      this.lines = this.lines.filter((element) => element !== line);
    }
    removeActor(actor) {
      this.actors = this.actors.filter((element) => element !== actor);
      actor.onDestroyed();
    }
    drawNineSliceImage(actor, context) {
      const image = actor.getImage();
      const x = actor.getX();
      const y = actor.getY();
      const width = actor.getWidth();
      const height = actor.getHeight();
      const cornerSize = actor.getCornerSize();
      if (!image) return;
      const originalSmoothing = context.imageSmoothingEnabled;
      context.imageSmoothingEnabled = false;
      context.drawImage(image, 0, 0, cornerSize, cornerSize, Math.floor(x), Math.floor(y), cornerSize, cornerSize);
      context.drawImage(
        image,
        cornerSize,
        0,
        image.width - cornerSize * 2,
        cornerSize,
        Math.floor(x + cornerSize),
        Math.floor(y),
        Math.ceil(width - cornerSize * 2),
        cornerSize
      );
      context.drawImage(
        image,
        image.width - cornerSize,
        0,
        cornerSize,
        cornerSize,
        Math.floor(x + width - cornerSize),
        Math.floor(y),
        cornerSize,
        cornerSize
      );
      context.drawImage(
        image,
        0,
        cornerSize,
        cornerSize,
        image.height - cornerSize * 2,
        Math.floor(x),
        Math.floor(y + cornerSize),
        cornerSize,
        Math.ceil(height - cornerSize * 2)
      );
      context.drawImage(
        image,
        cornerSize,
        cornerSize,
        image.width - cornerSize * 2,
        image.height - cornerSize * 2,
        Math.floor(x + cornerSize),
        Math.floor(y + cornerSize),
        Math.ceil(width - cornerSize * 2),
        Math.ceil(height - cornerSize * 2)
      );
      context.drawImage(
        image,
        image.width - cornerSize,
        cornerSize,
        cornerSize,
        image.height - cornerSize * 2,
        Math.floor(x + width - cornerSize),
        Math.floor(y + cornerSize),
        cornerSize,
        Math.ceil(height - cornerSize * 2)
      );
      context.drawImage(
        image,
        0,
        image.height - cornerSize,
        cornerSize,
        cornerSize,
        Math.floor(x),
        Math.floor(y + height - cornerSize),
        cornerSize,
        cornerSize
      );
      context.drawImage(
        image,
        cornerSize,
        image.height - cornerSize,
        image.width - cornerSize * 2,
        cornerSize,
        Math.floor(x + cornerSize),
        Math.floor(y + height - cornerSize),
        Math.ceil(width - cornerSize * 2),
        cornerSize
      );
      context.drawImage(
        image,
        image.width - cornerSize,
        image.height - cornerSize,
        cornerSize,
        cornerSize,
        Math.floor(x + width - cornerSize),
        Math.floor(y + height - cornerSize),
        cornerSize,
        cornerSize
      );
      context.imageSmoothingEnabled = originalSmoothing;
    }
    drawImageFromActor(actor, context) {
      if (!actor.getImage()) {
        console.log("Warning: Attempted to draw empty actor: " + actor.getWidth());
        return;
      }
      let canvasContext = context;
      canvasContext.save();
      if (actor.isCameraApplied() && this.currentScene.getCamera() && canvasContext === this.canvasContext) {
        const zoom = this.currentScene.getCamera().getZoomAmount();
        const cameraX = this.currentScene.getCamera().getX();
        const cameraY = this.currentScene.getCamera().getY();
        const dpr = this.dpr || 1;
        canvasContext.setTransform(
          zoom * dpr,
          0,
          0,
          zoom * dpr,
          cameraX * dpr,
          cameraY * dpr
        );
      }
      canvasContext.translate(actor.getRotationOriginX(), actor.getRotationOriginY());
      canvasContext.rotate(actor.getRotation());
      canvasContext.translate(-actor.getRotationOriginX(), -actor.getRotationOriginY());
      canvasContext.globalAlpha = actor.getTransparency();
      if (actor.canDrawSpriteRegion()) {
        const spriteX = parseInt(actor.getSpriteRegion().split(",")[0]) * 32;
        const spriteY = parseInt(actor.getSpriteRegion().split(",")[1]) * 32;
        canvasContext.drawImage(
          actor.getImage(),
          //TODO: Calculate sprite position
          spriteX,
          spriteY,
          32,
          32,
          actor.getX(),
          actor.getY(),
          actor.getWidth(),
          actor.getHeight()
        );
      } else if (actor.isNineSlice()) {
        this.drawNineSliceImage(actor, canvasContext);
      } else {
        canvasContext.drawImage(actor.getImage(), actor.getX(), actor.getY(), actor.getWidth(), actor.getHeight());
      }
      canvasContext.globalAlpha = 1;
      canvasContext.restore();
    }
    measureText(text, font) {
      this.canvasContext.save();
      this.canvasContext.font = font || "24px serif";
      const metrics = this.canvasContext.measureText(text);
      let height = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
      this.canvasContext.restore();
      return { width: metrics.width, height };
    }
    /**
     * Returns a wrapped text string and height of the wrapped text, and stores the wrapped text in a cache.
     */
    async getWrappedText(text, font, maxWidth) {
      let currentWidth = 0;
      if (this.wrappedTextCache[text]) {
        return this.wrappedTextCache[text];
      }
      const { width: _, height: unwrappedWordHeight } = this.measureText(text, font);
      let modifiedText = text + "";
      let wrappedHeight = unwrappedWordHeight;
      for (const word of modifiedText.split(" ")) {
        const { width: wordWidth, height: wordHeight } = this.measureText(word + " ", font);
        if (currentWidth + wordWidth > maxWidth) {
          modifiedText = modifiedText.replace(word, "\n" + word);
          currentWidth = wordWidth;
          wrappedHeight += wordHeight;
        } else {
          currentWidth += wordWidth;
        }
      }
      this.wrappedTextCache[text] = [modifiedText, wrappedHeight, unwrappedWordHeight];
      return [modifiedText, wrappedHeight, unwrappedWordHeight];
    }
    drawText(textOptions, canvasContext) {
      let text = textOptions.text;
      if (!text) {
        return;
      }
      canvasContext.save();
      canvasContext.textBaseline = "top";
      if (textOptions.applyCamera && this.currentScene.getCamera() && canvasContext === this.canvasContext) {
        const zoom = this.currentScene.getCamera().getZoomAmount();
        const cameraX = this.currentScene.getCamera().getX();
        const cameraY = this.currentScene.getCamera().getY();
        const dpr = this.dpr || 1;
        canvasContext.setTransform(
          zoom * dpr,
          0,
          0,
          zoom * dpr,
          cameraX * dpr,
          cameraY * dpr
        );
      }
      canvasContext.globalAlpha = textOptions.transparency;
      canvasContext.fillStyle = textOptions.color;
      canvasContext.font = textOptions.font;
      canvasContext.shadowColor = textOptions.shadowColor ?? "white";
      canvasContext.lineWidth = textOptions.lineWidth ?? 0;
      const xPos = textOptions.x;
      const yPos = textOptions.y;
      if (textOptions.lineWidth > 0) {
        if (text.includes("\n")) {
          for (const [index, line] of text.split("\n").entries()) {
            canvasContext.strokeText(line, xPos, yPos + textOptions.height * index);
          }
        } else {
          canvasContext.strokeText(text, xPos, yPos);
        }
      }
      if (text.includes("\n")) {
        for (const [index, line] of text.split("\n").entries()) {
          canvasContext.fillText(line, xPos, yPos + textOptions.height * index);
        }
      } else {
        canvasContext.fillText(text, xPos, yPos);
      }
      canvasContext.restore();
    }
    drawLine(line, canvasContext) {
      canvasContext.save();
      if (this.currentScene.getCamera() && canvasContext === this.canvasContext) {
        const zoom = this.currentScene.getCamera().getZoomAmount();
        const cameraX = this.currentScene.getCamera().getX();
        const cameraY = this.currentScene.getCamera().getY();
        const dpr = this.dpr || 1;
        canvasContext.setTransform(
          zoom * dpr,
          0,
          0,
          zoom * dpr,
          cameraX * dpr,
          cameraY * dpr
        );
      }
      const x1 = line.getX1();
      const x2 = line.getX2();
      const y1 = line.getY1();
      const y2 = line.getY2();
      canvasContext.globalAlpha = line.getTransparency();
      canvasContext.strokeStyle = line.getColor();
      canvasContext.lineWidth = line.getGirth();
      canvasContext.lineCap = "round";
      canvasContext.beginPath();
      canvasContext.moveTo(x1, y1);
      canvasContext.lineTo(x2, y2);
      canvasContext.stroke();
      canvasContext.restore();
    }
    drawRect({
      x,
      y,
      width,
      height,
      color,
      canvasContext,
      fill
    }) {
      canvasContext.save();
      if (fill) {
        canvasContext.fillStyle = color;
        canvasContext.fillRect(x, y, width, height);
      } else {
        canvasContext.strokeStyle = color;
        canvasContext.strokeRect(x, y, width, height);
      }
      canvasContext.restore();
    }
    getImage(gameImage) {
      return this.images[gameImage];
    }
    getHeight() {
      return this.canvas.height;
    }
    getWidth() {
      return this.canvas.width;
    }
    getOldHeight() {
      return this.oldHeight;
    }
    getOldWidth() {
      return this.oldWidth;
    }
    getCanvasContext() {
      return this.canvasContext;
    }
    getCanvas() {
      return this.canvas;
    }
    getCurrentScene() {
      return this.currentScene;
    }
    /**
     * Return the current scene & cast the class specified in the generic type.
     * @returns
     */
    getCurrentSceneAs() {
      return this.currentScene;
    }
    getMouseX() {
      return this.mouseX;
    }
    getMouseY() {
      return this.mouseY;
    }
    getRelativeMouseX() {
      return this.mouseX - (this.currentScene.getCamera()?.getX() ?? 0);
    }
    getRelativeMouseY() {
      return this.mouseY - (this.currentScene.getCamera()?.getY() ?? 0);
    }
    toggleGameLoop() {
      this.runGameLoop = !this.runGameLoop;
    }
    setCursor(type) {
      this.canvas.style.cursor = type;
    }
    getDPR() {
      return this.dpr;
    }
  };
  __publicField(_Game2, "gameInstance");
  var Game2 = _Game2;

  // wsf:src/openciv-src/client/src/scene/Actor
  var Actor = class _Actor {
    constructor(actorOptions) {
      __publicField(this, "debugMe", false);
      // For debugging purposes, set to true to log actor information
      __publicField(this, "color");
      __publicField(this, "image");
      __publicField(this, "spriteRegion");
      // Location of sprite on spritesheet
      __publicField(this, "x");
      __publicField(this, "y");
      __publicField(this, "z");
      __publicField(this, "width");
      __publicField(this, "height");
      __publicField(this, "rotation");
      __publicField(this, "transparency");
      __publicField(this, "storedEvents");
      __publicField(this, "mouseInside");
      __publicField(this, "cameraApplies");
      __publicField(this, "drawSpriteRegion");
      // Draw region from spritesheet
      __publicField(this, "nineSlice");
      __publicField(this, "cornerSize");
      this.storedEvents = /* @__PURE__ */ new Map();
      this.color = actorOptions.color;
      this.image = actorOptions.image;
      this.spriteRegion = actorOptions.spriteRegion;
      this.x = actorOptions.x;
      this.y = actorOptions.y;
      this.z = actorOptions.z;
      this.width = actorOptions.width;
      this.height = actorOptions.height;
      this.rotation = actorOptions.rotation ?? 0;
      this.transparency = actorOptions.transparency ?? 1;
      this.cameraApplies = actorOptions.cameraApplies === void 0 ? true : actorOptions.cameraApplies;
      this.nineSlice = actorOptions.nineSlice ?? false;
      this.cornerSize = actorOptions.cornerSize ?? 10;
      this.on("mousemove", (options) => {
        const x = this.cameraApplies ? options.clientX : options.x;
        const y = this.cameraApplies ? options.clientY : options.y;
        if (this.insideActor(x, y)) {
          if (!this.mouseInside) {
            this.call("mouse_enter");
            this.mouseInside = true;
          }
        } else {
          if (this.mouseInside) {
            this.call("mouse_exit");
          }
          this.mouseInside = false;
        }
      });
      this.on("mouseup", (options) => {
        const x = this.cameraApplies ? options.clientX : options.x;
        const y = this.cameraApplies ? options.clientY : options.y;
        if (this.insideActor(x, y) && options.button === 0) {
          this.call("clicked");
        }
      });
      if (this.spriteRegion) {
        this.drawSpriteRegion = true;
      }
      if (this.color && this.image && this.spriteRegion) {
        this.setColor(this.color);
      }
    }
    setColor(color) {
      this.color = color;
      const canvas = document.getElementById("auxillary_canvas");
      const context = canvas.getContext("2d");
      canvas.width = this.width;
      canvas.height = this.height;
      context.clearRect(0, 0, canvas.width, canvas.height);
      if (this.spriteRegion) {
        const spriteX = parseInt(this.getSpriteRegion().split(",")[0]) * 32;
        const spriteY = parseInt(this.getSpriteRegion().split(",")[1]) * 32;
        context.drawImage(
          Game2.getInstance().getImage(4 /* SPRITESHEET */),
          spriteX,
          spriteY,
          32,
          32,
          0,
          0,
          this.getWidth(),
          this.getHeight()
        );
      }
      context.globalCompositeOperation = "source-in";
      context.fillStyle = this.color;
      context.fillRect(0, 0, canvas.width, canvas.height);
      const dataURL = canvas.toDataURL();
      const image = new Image();
      image.width = canvas.width;
      image.height = canvas.height;
      image.src = dataURL;
      this.image = image;
      this.drawSpriteRegion = false;
      context.globalCompositeOperation = "source-out";
    }
    getZIndex() {
      return this.z;
    }
    setZValue(value) {
      this.z = value;
    }
    draw(canvasContext) {
      const game = Game2.getInstance();
      const scene = game.getCurrentScene();
      const camera = scene?.getCamera();
      if (camera && this.cameraApplies && canvasContext === game.getCanvasContext()) {
        if (this.debugMe) {
          canvasContext.save();
          canvasContext.strokeStyle = "purple";
          canvasContext.lineWidth = 2;
          canvasContext.strokeRect(this.getScreenPixelX(), this.getScreenPixelY(), this.getScreenPixelWidth(), this.getScreenPixelHeight());
          canvasContext.restore();
        }
        const gameCanvas = game.getCanvas();
        const canvasWidth = gameCanvas.width;
        const canvasHeight = gameCanvas.height;
        const screenX = this.getScreenPixelX();
        const screenY = this.getScreenPixelY();
        const screenWidth = this.getScreenPixelWidth();
        const screenHeight = this.getScreenPixelHeight();
        if (screenX + screenWidth < 0 || screenY + screenHeight < 0 || screenX > canvasWidth || screenY > canvasHeight) {
          if (this.debugMe) {
            console.log("Actor culled (outside canvas):", {
              screenX,
              screenY,
              screenWidth,
              screenHeight,
              canvasWidth,
              canvasHeight
            });
          }
          return;
        }
        if (this.debugMe) {
          console.log("Actor cull check variables:", {
            screenX,
            screenY,
            screenWidth,
            screenHeight,
            canvasWidth,
            canvasHeight
          });
        }
      }
      if (!this.image && this.color) {
        Game2.getInstance().drawRect({
          x: this.x,
          y: this.y,
          width: this.width,
          height: this.height,
          color: this.color,
          fill: true,
          canvasContext
        });
      } else if (this.image) {
        Game2.getInstance().drawImageFromActor(this, canvasContext);
      } else {
        console.log("Warning: Nothing for actor can be drawn:" + this);
      }
    }
    onCreated() {
    }
    onDestroyed() {
    }
    call(eventName, options) {
      if (this.storedEvents.has(eventName)) {
        const functions = this.storedEvents.get(eventName);
        for (let currentFunction of functions) {
          currentFunction(options);
        }
      }
    }
    on(eventName, callback) {
      let functions = this.storedEvents.get(eventName) ?? [];
      functions.push(callback);
      this.storedEvents.set(eventName, functions);
    }
    insideActor(x, y) {
      if (this.cameraApplies && Game2.getInstance().getCurrentScene().getCamera()) {
        const zoom = Game2.getInstance().getCurrentScene().getCamera().getZoomAmount();
        const cameraX = Game2.getInstance().getCurrentScene().getCamera().getX();
        const cameraY = Game2.getInstance().getCurrentScene().getCamera().getY();
        x = (x - cameraX) / zoom;
        y = (y - cameraY) / zoom;
      }
      if (x >= this.x && x <= this.x + this.width) {
        if (y >= this.y && y <= this.y + this.height) {
          return true;
        }
      }
      return false;
    }
    setImage(image) {
      this.image = Game2.getInstance().getImage(image);
    }
    setSpriteRegion(spriteRegion) {
      this.spriteRegion = spriteRegion;
    }
    getImage() {
      return this.image;
    }
    getX() {
      return this.x;
    }
    getY() {
      return this.y;
    }
    /**
     * Returns the X coordinate of the actor on the screen (in device pixels), accounting for camera and zoom.
     */
    getScreenPixelX() {
      const game = Game2.getInstance();
      const scene = game.getCurrentScene();
      const camera = scene?.getCamera();
      const dpr = game.getDPR();
      const zoom = camera.getZoomAmount();
      return (this.x * zoom + camera.getX()) * dpr;
    }
    /**
     * Returns the Y coordinate of the actor on the screen (in device pixels), accounting for camera and zoom.
     */
    getScreenPixelY() {
      const game = Game2.getInstance();
      const scene = game.getCurrentScene();
      const camera = scene?.getCamera();
      const dpr = game.getDPR();
      const zoom = camera.getZoomAmount();
      return (this.y * zoom + camera.getY()) * dpr;
    }
    /**
     * Returns the width of the actor on the screen (in device pixels), accounting for camera and zoom.
     */
    getScreenPixelWidth() {
      const game = Game2.getInstance();
      const scene = game.getCurrentScene();
      const camera = scene?.getCamera();
      const dpr = game.getDPR();
      const zoom = camera.getZoomAmount();
      return this.width * zoom * dpr;
    }
    /**
     * Returns the height of the actor on the screen (in device pixels), accounting for camera and zoom.
     */
    getScreenPixelHeight() {
      const game = Game2.getInstance();
      const scene = game.getCurrentScene();
      const camera = scene?.getCamera();
      const dpr = game.getDPR();
      const zoom = camera.getZoomAmount();
      return this.height * zoom * dpr;
    }
    getWidth() {
      return this.width;
    }
    getHeight() {
      return this.height;
    }
    getColor() {
      return this.color;
    }
    getSpriteRegion() {
      return this.spriteRegion;
    }
    canDrawSpriteRegion() {
      return this.drawSpriteRegion;
    }
    getRotation() {
      return this.rotation;
    }
    setRotation(rotation) {
      this.rotation = rotation;
    }
    setPosition(x, y) {
      this.x = x;
      this.y = y;
    }
    getRotationOriginX() {
      return 0;
    }
    getRotationOriginY() {
      return 0;
    }
    getTransparency() {
      return this.transparency;
    }
    static mergeActors(options) {
      let canvas = document.getElementById("auxillary_canvas");
      let maxRight = 0;
      let maxBottom = 0;
      let greatestZ = 0;
      options.actors.forEach((actor) => {
        const right = actor.getX() + actor.getWidth();
        const bottom = actor.getY() + actor.getHeight();
        if (right > maxRight) maxRight = right;
        if (bottom > maxBottom) maxBottom = bottom;
        if (actor.getZIndex() > greatestZ) greatestZ = actor.getZIndex();
      });
      canvas.width = options.canvasWidth || maxRight;
      canvas.height = options.canvasHeight || maxBottom;
      const ctx = canvas.getContext("2d");
      options.actors.forEach((actor) => {
        actor.draw(ctx);
      });
      let image = new Image();
      image.src = canvas.toDataURL();
      let mergedActor = new _Actor({
        image,
        x: options.actors[0].getX(),
        y: options.actors[0].getY(),
        z: greatestZ,
        width: canvas.width,
        height: canvas.height
      });
      return mergedActor;
    }
    setSize(width, height) {
      this.width = width;
      this.height = height;
    }
    setCameraApplies(value) {
      this.cameraApplies = value;
    }
    isCameraApplied() {
      return this.cameraApplies;
    }
    /**
     * Returns the variable that keeps track of this. NOT always true as this is outdated compared to insideActor().
     * @returns
     */
    isMouseInside() {
      return this.mouseInside;
    }
    setMouseInside(value) {
      this.mouseInside = value;
    }
    isNineSlice() {
      return this.nineSlice;
    }
    getCornerSize() {
      return this.cornerSize;
    }
  };

  // wsf:src/openciv-src/client/src/util/Vector
  var Vector = class _Vector {
    constructor(x, y) {
      __publicField(this, "x");
      __publicField(this, "y");
      this.x = x;
      this.y = y;
    }
    clone() {
      return new _Vector(this.x, this.y);
    }
    distance(vector) {
      const dx = this.x - vector.x;
      const dy = this.y - vector.y;
      return Math.sqrt(dx * dx + dy * dy);
    }
    subtract(vector) {
      return new _Vector(this.x - vector.x, this.y - vector.y);
    }
    multiplyScalar(scalar) {
      return new _Vector(this.x * scalar, this.y * scalar);
    }
    add(otherVec) {
      return new _Vector(this.x + otherVec.x, this.y + otherVec.y);
    }
    static getCenterOfPolygon(vectors) {
      const centerPoint = vectors.reduce((acc, curr) => new _Vector(acc.x + curr.x, acc.y + curr.y), new _Vector(0, 0));
      centerPoint.x /= vectors.length;
      centerPoint.y /= vectors.length;
      return centerPoint;
    }
    static shiftVectorsAwayFromCenter(centerX, centerY, vectors, shiftDistance) {
      let centerPoint = new _Vector(centerX, centerY);
      const shiftedVectors = vectors.map((vector) => {
        const distanceFromCenter = vector.distance(new _Vector(centerPoint.x, centerPoint.y));
        const shiftAmount = 1 - shiftDistance / distanceFromCenter;
        const shiftedVector = vector.clone().subtract(new _Vector(centerPoint.x, centerPoint.y)).multiplyScalar(shiftAmount).add(new _Vector(centerPoint.x, centerPoint.y));
        return shiftedVector;
      });
      return shiftedVectors;
    }
    static angleBetweenVectors(vector1, vector2) {
      const dotProduct = vector1.x * vector2.x + vector1.y * vector2.y;
      const mag1 = Math.sqrt(vector1.x ** 2 + vector1.y ** 2);
      const mag2 = Math.sqrt(vector2.x ** 2 + vector2.y ** 2);
      const cosTheta = dotProduct / (mag1 * mag2);
      const angleInRadians = Math.acos(cosTheta);
      const angleInDegrees = angleInRadians * (180 / Math.PI);
      return angleInDegrees;
    }
    static isInsidePolygon(vectors, mouseVector, mouseExtremeVector) {
      let count = 0;
      let i = 0;
      do {
        let next = (i + 1) % 6;
        if (this.doIntersect(vectors[i], vectors[next], mouseVector, mouseExtremeVector)) {
          if (this.orientation(vectors[i], mouseVector, vectors[next]) == 0) {
            return this.onSegment(vectors[i], mouseVector, vectors[next]);
          }
          count++;
        }
        i = next;
      } while (i != 0);
      return count % 2 == 1;
    }
    static doIntersect(p1, q1, p2, q2) {
      let o1 = this.orientation(p1, q1, p2);
      let o2 = this.orientation(p1, q1, q2);
      let o3 = this.orientation(p2, q2, p1);
      let o4 = this.orientation(p2, q2, q1);
      if (o1 != o2 && o3 != o4) {
        return true;
      }
      if (o1 == 0 && this.onSegment(p1, p2, q1)) {
        return true;
      }
      if (o2 == 0 && this.onSegment(p1, q2, q1)) {
        return true;
      }
      if (o3 == 0 && this.onSegment(p2, p1, q2)) {
        return true;
      }
      if (o4 == 0 && this.onSegment(p2, q1, q2)) {
        return true;
      }
      return false;
    }
    static onSegment(p, q, r) {
      if (q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) && q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y)) {
        return true;
      }
      return false;
    }
    // To find orientation of ordered triplet (p, q, r).
    // The function returns following values
    // 0 --> p, q and r are colinear
    // 1 --> Clockwise
    // 2 --> Counterclockwise
    static orientation(p, q, r) {
      let val = Math.floor((q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y));
      if (val == 0) {
        return 0;
      }
      return val > 0 ? 1 : 2;
    }
  };

  // wsf:src/openciv-src/client/src/map/Tile
  var _Tile2 = class _Tile2 extends Actor {
    constructor(options) {
      super({
        x: options.x,
        y: options.y,
        z: options.z || 0,
        width: options.width ?? _Tile2.WIDTH,
        height: options.height ?? _Tile2.HEIGHT,
        color: options.color
      });
      __publicField(this, "tileTypes");
      __publicField(this, "adjacentTiles");
      __publicField(this, "vectors");
      __publicField(this, "riverSides");
      __publicField(this, "units");
      __publicField(this, "movementCost");
      // Default movement cost of the tile (e.g., Hill=2, Mountain=999)
      __publicField(this, "gridX");
      __publicField(this, "gridY");
      __publicField(this, "city");
      __publicField(this, "yields");
      this.tileTypes = options.tileTypes;
      this.adjacentTiles = [];
      this.vectors = [];
      this.riverSides = options.riverSides ?? Array(6).fill(false);
      this.units = [];
      this.movementCost = options.movementCost;
      this.yields = options.yields;
      this.gridX = options.gridX;
      this.gridY = options.gridY;
      this.initializeVectors();
    }
    static gridDistance(tile1, tile2) {
      return Math.sqrt(
        Math.pow(tile2.getGridX() - tile1.getGridX(), 2) + Math.pow(tile2.getGridY() - tile1.getGridY(), 2)
      );
    }
    static riverCrosses(tile1, tile2) {
      let tile1RiverSide = -1;
      for (let i = 0; i < tile1.getAdjacentTiles().length; i++) {
        if (tile2 === tile1.getAdjacentTiles()[i]) {
          tile1RiverSide = i;
        }
      }
      if (tile1.getRiverSides()[tile1RiverSide]) {
        return true;
      }
      return false;
    }
    static getWeight(tile1, tile2) {
      if (_Tile2.riverCrosses(tile1, tile2)) {
        return Math.max(2, tile2.getMovementCost());
      }
      return tile2.getMovementCost();
    }
    static setTileYields(data) {
      _Tile2.allTileStats = data;
    }
    static getTileYields() {
      return _Tile2.allTileStats;
    }
    async loadImage() {
      const key = JSON.stringify(this.tileTypes);
      if (_Tile2.loadedTileImages.has(key)) {
        this.image = _Tile2.loadedTileImages.get(key);
      } else {
        this.image = await _Tile2.generateImageFromTileTypes(this.tileTypes);
        _Tile2.loadedTileImages.set(key, this.image);
      }
    }
    draw(canvasContext) {
      super.draw(canvasContext);
    }
    getTileYield() {
      if (this.yields) {
        const tileYield2 = {};
        for (const statObj of this.yields) {
          for (const [key, value] of Object.entries(statObj)) {
            tileYield2[key] = (tileYield2[key] || 0) + (typeof value === "number" ? value : 0);
          }
        }
        return tileYield2;
      }
      const allTileStats = _Tile2.getTileYields();
      if (!allTileStats) return void 0;
      const tileYield = {};
      for (const tileType of this.tileTypes) {
        const yieldData = allTileStats[tileType] || allTileStats[tileType.toUpperCase()] || allTileStats[tileType.toLowerCase()];
        if (yieldData && yieldData.stats) {
          for (const statObj of yieldData.stats) {
            for (const [key, value] of Object.entries(statObj)) {
              tileYield[key] = (tileYield[key] || 0) + (typeof value === "number" ? value : 0);
            }
          }
        }
      }
      return Object.keys(tileYield).length > 0 ? tileYield : void 0;
    }
    setCity(city) {
      this.city = city;
      this.tileTypes.push("city");
      GameMap2.getInstance().redrawMap([this]);
    }
    getCity() {
      return this.city;
    }
    samePosition(tile) {
      return this.gridX === tile.getGridX() && this.gridY === tile.getGridY();
    }
    getMovementCost() {
      return this.movementCost;
    }
    addUnit(unit) {
      this.units.push(unit);
    }
    hasRiver() {
      return this.riverSides.some((side) => side);
    }
    getRiverSides() {
      return this.riverSides;
    }
    getNumberedRiverSides() {
      const numberedSides = [];
      for (let i = 0; i < this.riverSides.length; i++) {
        if (this.riverSides[i]) numberedSides.push(i);
      }
      return numberedSides;
    }
    getTileTypes() {
      return this.tileTypes;
    }
    setTileTypes(tileTypes) {
      this.tileTypes = tileTypes;
    }
    getGridX() {
      return this.gridX;
    }
    getGridY() {
      return this.gridY;
    }
    static async generateImageFromTileTypes(tileTypes) {
      let canvas = document.getElementById("auxillary_canvas");
      canvas.width = _Tile2.WIDTH;
      canvas.height = _Tile2.HEIGHT;
      canvas.getContext("2d").fillStyle = "rgba(0,0,0,0)";
      canvas.getContext("2d").fillRect(0, 0, canvas.width, canvas.height);
      for (let tileType of tileTypes) {
        const spritesheetImage = Game2.getInstance().getImage(4 /* SPRITESHEET */);
        const spriteRegion = SpriteRegion[tileType.toUpperCase()];
        const spriteX = parseInt(spriteRegion.split(",")[0]) * 32;
        const spriteY = parseInt(spriteRegion.split(",")[1]) * 32;
        canvas.getContext("2d").drawImage(spritesheetImage, spriteX, spriteY, 32, 32, 0, 0, _Tile2.WIDTH, _Tile2.HEIGHT);
      }
      let image = new Image();
      image.src = canvas.toDataURL();
      image.width = _Tile2.WIDTH;
      image.height = _Tile2.HEIGHT;
      await new Promise((resolve) => {
        image.onload = () => resolve(image);
      });
      return image;
    }
    getAdjacentTiles() {
      return this.adjacentTiles;
    }
    setAdjacentTile(index, tile) {
      this.adjacentTiles[index] = tile;
    }
    getVectors() {
      return this.vectors;
    }
    initializeVectors() {
      this.vectors.push(new Vector(this.x, this.y + 7));
      this.vectors.push(new Vector(this.x + this.width / 2, this.y));
      this.vectors.push(new Vector(this.x + 32, this.y + 7));
      this.vectors.push(new Vector(this.x + 32, this.y + 25));
      this.vectors.push(new Vector(this.x + this.width / 2, this.y + 32));
      this.vectors.push(new Vector(this.x, this.y + 25));
    }
    /**
     * Returns the center position of the tile in local (actor) coordinates.
     * Note: This uses this.x and this.y.
     */
    getCenterPosition() {
      return {
        x: this.x + _Tile2.WIDTH / 2,
        y: this.y + _Tile2.HEIGHT / 2
      };
    }
    getDistanceFrom(x1, y1) {
      let x2 = this.getCenterPosition().x;
      let y2 = this.getCenterPosition().y;
      return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
    }
    getUnits() {
      return this.units;
    }
    getUnitByID(id) {
      return this.units.find((unit) => unit.getID() === id);
    }
    removeUnit(unit) {
      this.units.splice(this.units.indexOf(unit), 1);
    }
    //public getNodeIndex(): number {
    //  return GameMap.getInstance().getWidth() * this.gridY + this.gridX;
    //}
    isWater() {
      const waterTileTypes = ["ocean", "shallow_ocean", "freshwater"];
      return this.tileTypes.some((type) => waterTileTypes.includes(type));
    }
  };
  __publicField(_Tile2, "WIDTH", 32);
  __publicField(_Tile2, "HEIGHT", 32);
  __publicField(_Tile2, "loadedTileImages", /* @__PURE__ */ new Map());
  __publicField(_Tile2, "allTileStats");
  var Tile2 = _Tile2;

  // wsf:src/openciv-src/client/src/player/AbstractPlayer
  var AbstractPlayer = class {
    constructor(playerJSON) {
      __publicField(this, "name");
      __publicField(this, "civData");
      __publicField(this, "units", []);
      __publicField(this, "cities", []);
      this.civData = playerJSON["civData"];
      this.name = playerJSON["name"];
    }
    static getPlayerByName(name) {
      const players = Game2.getInstance().getCurrentSceneAs().getPlayers();
      for (const player of players) {
        if (player.getName() === name) {
          return player;
        }
      }
      return void 0;
    }
    getName() {
      return this.name;
    }
    setName(name) {
      this.name = name;
    }
    getCivilizationData() {
      return this.civData;
    }
    addUnit(unit) {
      this.units.push(unit);
    }
    removeUnit(unit) {
      this.units = this.units.filter((u) => u !== unit);
    }
    getUnits() {
      return this.units;
    }
    addCity(city) {
      this.cities.push(city);
    }
    removeCity(city) {
      this.cities = this.cities.filter((c) => c !== city);
    }
    getCities() {
      return this.cities;
    }
  };

  // wsf:src/openciv-src/client/src/scene/ActorGroup
  var ActorGroup = class _ActorGroup extends Actor {
    constructor(options) {
      super({
        x: options.x,
        y: options.y,
        width: options.width,
        height: options.height,
        cameraApplies: options.cameraApplies,
        z: options.z
      });
      __publicField(this, "actors");
      this.actors = [];
      this.on("mousemove", (options2) => {
        for (const actor of this.getActors()) {
          actor.call("mousemove", options2);
          if (actor.insideActor(options2.x, options2.y)) {
            if (!actor.isMouseInside()) {
              actor.call("mouse_enter");
              actor.setMouseInside(true);
            }
          } else {
            if (actor.isMouseInside()) {
              actor.call("mouse_exit");
            }
            actor.setMouseInside(false);
          }
        }
      });
      this.on("mouseup", (options2) => {
        if (options2.button !== 0) {
          return;
        }
        for (const actor of this.getActors()) {
          if (actor.insideActor(options2.x, options2.y)) {
            actor.call("clicked");
          }
        }
      });
    }
    /**
     *
     * @returns All actors in this group and all subgroups
     */
    getActors() {
      const actors = [...this.actors];
      for (const actor of this.actors) {
        if (actor instanceof _ActorGroup) {
          actors.push(...actor.getActors());
        }
      }
      return actors;
    }
    draw(canvasContext) {
      for (const actor of this.actors) {
        actor.draw(canvasContext);
      }
    }
    addActor(actor) {
      actor.setCameraApplies(this.cameraApplies);
      actor.setZValue(this.z);
      this.actors.push(actor);
    }
    removeActor(actor) {
      const actorIndex = this.actors.indexOf(actor);
      if (actorIndex < 0) return;
      const deletedActor = this.actors.splice(actorIndex, 1)[0];
      deletedActor.onDestroyed();
    }
    onDestroyed() {
      super.onDestroyed();
      for (const actor of this.actors) {
        actor.onDestroyed();
      }
    }
  };

  // wsf:src/openciv-src/client/src/util/Strings
  var Strings = class {
    static capitalizeWords(input) {
      return input.replace(/\b\w/g, (match) => match.toUpperCase());
    }
    /**
     * Returns a string with +n if the number is >= 0, otherwise -n.
     * @param input
     */
    static convertToStatUnit(n) {
      if (n >= 0) {
        return "+" + n;
      } else {
        return n.toString();
      }
    }
  };

  // wsf:src/openciv-src/client/src/ui/Button
  var Button = class extends ActorGroup {
    constructor(options) {
      super({
        x: options.x,
        y: options.y,
        z: options.z,
        width: options.width,
        height: options.height,
        cameraApplies: false
      });
      __publicField(this, "buttonImage");
      __publicField(this, "buttonHoveredImage");
      __publicField(this, "text");
      __publicField(this, "icon");
      __publicField(this, "callbackFunction");
      __publicField(this, "mouseEnterCallbackFunction");
      __publicField(this, "mouseExitCallbackFunction");
      __publicField(this, "font");
      __publicField(this, "fontColor");
      __publicField(this, "textWidth");
      __publicField(this, "textHeight");
      __publicField(this, "buttonActor");
      __publicField(this, "iconOnly");
      __publicField(this, "disableHoverWhen");
      this.icon = options.icon;
      this.textWidth = -1;
      this.textHeight = -1;
      this.callbackFunction = options.onClicked;
      this.mouseEnterCallbackFunction = options.onMouseEnter || function() {
      };
      this.mouseExitCallbackFunction = options.onMouseExit || function() {
      };
      this.font = options.font ?? "24px serif";
      this.fontColor = options.fontColor ?? "black";
      this.buttonImage = options.buttonImage || 0 /* BUTTON */;
      this.buttonHoveredImage = options.buttonHoveredImage || 1 /* BUTTON_HOVERED */;
      this.iconOnly = options.iconOnly || false;
      this.disableHoverWhen = options.disableHoverWhen;
      if (!this.iconOnly) {
        this.buttonActor = new Actor({
          image: Game2.getInstance().getImage(this.buttonImage),
          x: this.x,
          y: this.y,
          width: this.width,
          height: this.height,
          nineSlice: true,
          cornerSize: 8
        });
        this.addActor(this.buttonActor);
      }
      if (this.icon) {
        const iconWidth = options.iconWidth || this.width;
        const iconHeight = options.iconHeight || this.height;
        this.addActor(
          new Actor({
            image: Game2.getInstance().getImage(4 /* SPRITESHEET */),
            spriteRegion: this.icon,
            x: this.x + this.width / 2 - iconWidth / 2,
            y: this.y + this.height / 2 - iconHeight / 2,
            width: iconWidth,
            height: iconHeight
          })
        );
      }
      this.on("mousemove", (options2) => {
        if (this.mouseInside) {
          if (this.disableHoverWhen && this.disableHoverWhen()) {
            return;
          }
          Game2.getInstance().setCursor("pointer");
        }
      });
      this.on("mouse_enter", () => {
        if (this.disableHoverWhen && this.disableHoverWhen()) {
          return;
        }
        if (!this.iconOnly) {
          this.buttonActor.setImage(this.buttonHoveredImage);
        }
        Game2.getInstance().setCursor("pointer");
        this.mouseEnterCallbackFunction();
      });
      this.on("mouse_exit", () => {
        if (!this.iconOnly) {
          this.buttonActor.setImage(this.buttonImage);
        }
        Game2.getInstance().setCursor("default");
        this.mouseExitCallbackFunction();
      });
      this.on("clicked", () => {
        this.callbackFunction();
      });
      this.text = options.text || "";
      this.icon = options.icon;
    }
    draw(canvasContext) {
      super.draw(canvasContext);
      if (this.textWidth == -1 && this.textHeight == -1) {
        const { width: textWidth, height: textHeight } = Game2.getInstance().measureText(this.text, this.font);
        this.textWidth = textWidth;
        this.textHeight = textHeight;
        return;
      }
      if (this.text) {
        Game2.getInstance().drawText(
          {
            text: this.text,
            x: this.x + this.width / 2 - this.textWidth / 2,
            y: this.y + this.height / 2 - this.textHeight / 2,
            color: this.fontColor,
            font: this.font
          },
          canvasContext
        );
      }
      if (this.icon) {
      }
    }
    onDestroyed() {
      super.onDestroyed();
      if (this.mouseInside) {
        Game2.getInstance().setCursor("default");
      }
    }
    setText(text) {
      this.text = text;
    }
  };

  // wsf:src/openciv-src/client/src/ui/Label
  var Label = class extends Actor {
    // When were waiting to conform label size.
    constructor(options) {
      super({
        x: options.x,
        y: options.y,
        z: options.z,
        cameraApplies: options.cameraApplies || false,
        width: 0,
        height: 0,
        transparency: options.transparency
      });
      __publicField(this, "text");
      __publicField(this, "font");
      __publicField(this, "fontColor");
      __publicField(this, "lineWidth");
      // For drawing bold text
      __publicField(this, "shadowColor");
      __publicField(this, "shadowBlur");
      __publicField(this, "onClickCallback");
      __publicField(this, "maxWidth");
      __publicField(this, "wrappedText");
      __publicField(this, "unwrappedWordHeight");
      __publicField(this, "oldText");
      this.text = options.text;
      this.font = options.font ?? "24px sans-serif";
      this.fontColor = options.fontColor;
      this.lineWidth = options.lineWidth ?? 0;
      this.shadowColor = options.shadowColor ?? this.color;
      this.shadowBlur = options.shadowBlur ?? 0;
      this.maxWidth = options.maxWidth;
      if (options.onClick) {
        this.setOnClick(options.onClick);
      }
    }
    setOnClick(onClickCallback) {
      this.onClickCallback = onClickCallback;
      if (this.onClickCallback) {
        this.on("clicked", () => {
          this.onClickCallback();
        });
        this.on("mousemove", () => {
          if (this.mouseInside) {
            if (!Game2.getInstance().getCurrentScene().hasSystemMenuOpen()) {
              Game2.getInstance().setCursor("pointer");
            } else {
              Game2.getInstance().setCursor("default");
            }
          }
        });
        this.on("mouse_exit", () => {
          Game2.getInstance().setCursor("default");
        });
      }
    }
    draw(canvasContext) {
      let text = this.text;
      if (this.wrappedText) {
        text = this.wrappedText;
      }
      if (this.oldText) {
        text = this.oldText;
      }
      Game2.getInstance().drawText(
        {
          text,
          x: this.x,
          y: this.y,
          height: this.wrappedText ? this.unwrappedWordHeight : this.height,
          color: this.fontColor,
          font: this.font,
          shadowColor: this.shadowColor,
          shadowBlur: this.shadowBlur,
          lineWidth: this.lineWidth,
          applyCamera: this.cameraApplies,
          transparency: this.transparency,
          maxWidth: this.maxWidth
        },
        canvasContext
      );
    }
    /**
     * Updates the width and height of the label to conform to whatever the text is
     */
    async conformSize() {
      if (this.maxWidth) {
        const [wrappedText, wrappedHeight, unwrappedWordHeight] = await Game2.getInstance().getWrappedText(
          this.text,
          this.font,
          this.maxWidth
        );
        this.wrappedText = wrappedText;
        this.width = this.maxWidth;
        this.height = wrappedHeight;
        this.unwrappedWordHeight = unwrappedWordHeight;
      } else {
        const { width: textWidth, height: textHeight } = Game2.getInstance().measureText(this.text, this.font);
        this.width = textWidth;
        this.height = textHeight;
      }
      this.oldText = void 0;
    }
    setText(text, waitForConformSize = false) {
      if (waitForConformSize) {
        this.oldText = this.text;
      }
      this.text = text;
    }
    getText() {
      return this.text;
    }
    getFont() {
      return this.font;
    }
  };

  // wsf:src/openciv-src/client/src/ui/UnitDisplayInfo
  var UnitDisplayInfo = class extends ActorGroup {
    constructor(unit) {
      super({
        x: Game2.getInstance().getWidth() - 250,
        y: Game2.getInstance().getHeight() - 150,
        width: 250,
        height: 150,
        cameraApplies: false,
        z: 5
      });
      __publicField(this, "unit");
      __publicField(this, "movementLabel");
      __publicField(this, "actionButtons");
      this.unit = unit;
      this.actionButtons = [];
      this.addActor(
        new Actor({
          image: Game2.getInstance().getImage(6 /* POPUP_BOX */),
          x: this.x,
          y: this.y,
          width: this.width,
          height: this.height,
          nineSlice: true,
          cornerSize: 20
        })
      );
      const nameLabel = new Label({
        text: Strings.capitalizeWords(unit.getName()),
        x: this.x,
        y: this.y,
        font: "18px serif",
        fontColor: "white"
      });
      nameLabel.conformSize().then(() => {
        nameLabel.setPosition(this.x + this.width / 2 - nameLabel.getWidth() / 2, this.y + 10);
        this.addActor(nameLabel);
      });
      this.movementLabel = new Label({
        text: `Movement: ${unit.getAvailableMovement()}/${unit.getDefaultMoveDistance()}`,
        x: this.x,
        y: this.y,
        font: "18px serif",
        fontColor: "white"
      });
      this.updateMovementLabel({ updateText: false });
      this.addActor(this.movementLabel);
      this.updateActionButtons();
      NetworkEvents.on({
        eventName: "newTurn",
        parentObject: this,
        callback: (data) => {
          this.refreshDisplayInfo();
        }
      });
      NetworkEvents.on({
        eventName: "moveUnit",
        parentObject: this,
        callback: (data) => {
          if (this.unit.getID() !== data["id"]) {
            return;
          }
          this.refreshDisplayInfo();
        }
      });
    }
    // Clear our networks events associated with this object
    onDestroyed() {
      super.onDestroyed();
      NetworkEvents.removeCallbacksByParentObject(this);
    }
    updateMovementLabel(options) {
      if (options.updateText) {
        this.movementLabel.setText(`Movement: ${this.unit.getAvailableMovement()}/${this.unit.getDefaultMoveDistance()}`);
      }
      this.movementLabel.conformSize().then(() => {
        this.movementLabel.setPosition(
          this.x + this.width / 2 - this.movementLabel.getWidth() / 2,
          this.y + this.height - 25
        );
      });
    }
    updateActionButtons() {
      let xOffset = 0;
      const newActionButtons = [];
      for (const action of this.unit.getActions()) {
        if (!action.requirementsMet(this.unit)) continue;
        const button = new Button({
          buttonImage: 2 /* ICON_BUTTON */,
          buttonHoveredImage: 3 /* ICON_BUTTON_HOVERED */,
          icon: action.getIcon(),
          iconWidth: 32,
          iconHeight: 32,
          x: this.x + 16 + xOffset,
          y: this.y + 28,
          width: 50,
          height: 50,
          onClicked: () => {
            console.log(`Action: ${action.getName()} clicked`);
            WebsocketClient.sendMessage({
              event: "unitAction",
              unitX: this.unit.getTile().getGridX(),
              unitY: this.unit.getTile().getGridY(),
              id: this.unit.getID(),
              actionName: action.getName()
            });
          },
          onMouseEnter: () => {
            this.movementLabel.setText(action.getDesc());
            this.updateMovementLabel({ updateText: false });
          },
          onMouseExit: () => {
            this.updateMovementLabel({ updateText: true });
          }
        });
        this.addActor(button);
        newActionButtons.push(button);
        xOffset += 38;
      }
      for (const button of this.actionButtons) {
        this.removeActor(button);
      }
      this.actionButtons = newActionButtons;
    }
    refreshDisplayInfo() {
      this.updateMovementLabel({ updateText: true });
      this.updateActionButtons();
    }
  };

  // wsf:src/openciv-src/client/src/Unit
  var UnitAction = class {
    constructor(actionName, desc, requirements, icon) {
      __publicField(this, "actionName");
      __publicField(this, "desc");
      __publicField(this, "requirements");
      // We assign these strings to client-side functions to check if there met.
      __publicField(this, "icon");
      this.actionName = actionName;
      this.desc = desc;
      this.requirements = requirements;
      this.icon = icon;
    }
    getName() {
      return this.actionName;
    }
    getDesc() {
      return this.desc;
    }
    getIcon() {
      return this.icon;
    }
    requirementsMet(unit) {
      let allMet = true;
      for (const requirement of this.requirements) {
        const requirementMethod = this[requirement];
        if (requirementMethod && !requirementMethod.call(this, unit)) {
          allMet = false;
        }
      }
      return allMet;
    }
    // Requirement methods
    movement(unit) {
      return unit.getAvailableMovement() > 0;
    }
    /*protected nearEnemy(unit: Unit) {
      return false;
    }*/
    awayFromCity(unit) {
      return true;
    }
  };
  var Unit2 = class extends ActorGroup {
    constructor(tile, unitJSON) {
      super({
        x: tile.getCenterPosition().x - 28 / 2,
        y: tile.getCenterPosition().y - 28 / 2,
        z: 2,
        width: 28,
        height: 28
      });
      __publicField(this, "name");
      __publicField(this, "id");
      __publicField(this, "tile");
      __publicField(this, "attackType");
      __publicField(this, "unitActor");
      __publicField(this, "selectionActors");
      __publicField(this, "selected");
      __publicField(this, "defaultMoveDistance");
      __publicField(this, "availableMovement");
      __publicField(this, "unitDisplayInfo");
      __publicField(this, "actions");
      __publicField(this, "queuedMovementTiles");
      __publicField(this, "player");
      this.tile = tile;
      this.name = unitJSON["name"];
      this.unitActor = new Actor({
        image: Game2.getInstance().getImage(4 /* SPRITESHEET */),
        spriteRegion: SpriteRegion[this.name.toUpperCase()],
        x: tile.getCenterPosition().x - 28 / 2,
        y: tile.getCenterPosition().y - 28 / 2,
        z: 2,
        width: 28,
        height: 28
      });
      this.addActor(this.unitActor);
      this.id = unitJSON["id"];
      this.attackType = unitJSON["attackType"];
      this.availableMovement = unitJSON["remainingMovement"];
      this.defaultMoveDistance = unitJSON["defaultMoveDistance"];
      this.player = AbstractPlayer.getPlayerByName(unitJSON["player"]);
      if (this.player) {
        this.player.addUnit(this);
      }
      this.queuedMovementTiles = [];
      for (const jsonTile of unitJSON["queuedTiles"]) {
        this.queuedMovementTiles.push(GameMap2.getInstance().getTiles()[jsonTile["x"]][jsonTile["y"]]);
      }
      this.selectionActors = [];
      this.actions = [];
      for (const actionJSON of unitJSON["actions"]) {
        this.actions.push(
          new UnitAction(actionJSON.name, actionJSON.desc, actionJSON.requirements, SpriteRegion[actionJSON.icon])
        );
      }
      console.log("new unit with id: " + this.id);
      NetworkEvents.on({
        eventName: "moveUnit",
        parentObject: this,
        callback: (data) => {
          const unitTile = GameMap2.getInstance().getTiles()[data["unitX"]][data["unitY"]];
          const targetTile = GameMap2.getInstance().getTiles()[data["targetX"]][data["targetY"]];
          if (this.tile !== unitTile || this.id !== data["id"]) {
            return;
          }
          if (this.selected) {
            this.removeSelectionActors();
          }
          this.queuedMovementTiles = [];
          this.availableMovement = data["remainingMovement"];
          this.tile.removeUnit(this);
          this.tile = targetTile;
          targetTile.addUnit(this);
          this.updatePosition(targetTile);
          if (this.selected) {
            this.addSelectionActors();
          }
          if ("queuedTiles" in data) {
            for (const tileJSON of data["queuedTiles"]) {
              const tile2 = GameMap2.getInstance().getTiles()[tileJSON["x"]][tileJSON["y"]];
              this.queuedMovementTiles.push(tile2);
            }
          }
        }
      });
      NetworkEvents.on({
        eventName: "newTurn",
        parentObject: this,
        callback: (data) => {
          this.availableMovement = this.defaultMoveDistance;
        }
      });
      NetworkEvents.on({
        eventName: "removeUnit",
        parentObject: this,
        callback: (data) => {
          const unitTile = GameMap2.getInstance().getTiles()[data["unitX"]][data["unitY"]];
          if (this.tile !== unitTile) {
            return;
          }
          this.unselect();
          this.tile.removeUnit(this);
          if (this.player) {
            this.player.removeUnit(this);
          }
          Game2.getInstance().getCurrentScene().removeActor(this);
        }
      });
    }
    getTileWeight(current, neighbor) {
      if (current.isWater()) {
        return 9999;
      }
      if (!neighbor) return current.getMovementCost();
      return Tile2.getWeight(current, neighbor);
    }
    reduceMovement(amount) {
      this.availableMovement -= amount;
    }
    setAvailableMovement(amount) {
      this.availableMovement = amount;
    }
    getDefaultMoveDistance() {
      return this.defaultMoveDistance;
    }
    getAvailableMovement() {
      return this.availableMovement;
    }
    getID() {
      return this.id;
    }
    toString() {
      return JSON.stringify({ name: this.name, attackType: this.attackType });
    }
    unselect() {
      this.selected = false;
      this.removeSelectionActors();
      Game2.getInstance().getCurrentScene().removeActor(this.unitDisplayInfo);
    }
    select() {
      console.log("Select Unit");
      this.selected = true;
      this.addSelectionActors();
      this.unitDisplayInfo = new UnitDisplayInfo(this);
      Game2.getInstance().getCurrentScene().addActor(this.unitDisplayInfo);
    }
    getQueuedMovementTiles() {
      return this.queuedMovementTiles;
    }
    getTargetQueuedTile() {
      if (this.queuedMovementTiles.length < 1) return void 0;
      return this.queuedMovementTiles[this.queuedMovementTiles.length - 1];
    }
    hasMovementQueue() {
      return this.queuedMovementTiles.length > 0;
    }
    getActions() {
      return this.actions;
    }
    getName() {
      return this.name;
    }
    getAttackType() {
      return this.attackType;
    }
    getTile() {
      return this.tile;
    }
    isSelected() {
      return this.selected;
    }
    /**
     * Updates the unit position, modify sub-actors locations
     * @param tile The tile we are now positioned on.
     */
    updatePosition(tile) {
      super.setPosition(tile.getCenterPosition().x - 28 / 2, tile.getCenterPosition().y - 28 / 2);
      this.unitActor.setPosition(tile.getCenterPosition().x - 28 / 2, tile.getCenterPosition().y - 28 / 2);
    }
    removeSelectionActors() {
      for (const actor of this.selectionActors) {
        this.removeActor(actor);
      }
      this.selectionActors = [];
      GameMap2.getInstance().removeOutline({
        tile: this.tile,
        cityOutline: false
      });
    }
    addSelectionActors() {
      this.selectionActors.push(
        new Actor({
          image: Game2.getInstance().getImage(4 /* SPRITESHEET */),
          spriteRegion: "7,8" /* UNIT_SELECTION_TILE */,
          x: this.getTile().getX(),
          y: this.getTile().getY(),
          width: 32,
          height: 32
        })
      );
      GameMap2.getInstance().drawUnitSelectionOutline(this.tile, "aqua");
      for (const actor of this.selectionActors) {
        this.addActor(actor);
      }
    }
    getPlayer() {
      return this.player;
    }
  };

  // wsf:src/openciv-src/client/src/map/River
  var River = class extends Actor {
    constructor(options) {
      const vectorOffset = -1.75;
      let side = options.side;
      let otherVectorSide = side + 1;
      if (otherVectorSide === 6) {
        otherVectorSide = 0;
      }
      const shiftedTileVectors = Vector.shiftVectorsAwayFromCenter(
        options.tile.getX() + options.tile.getWidth() / 2,
        options.tile.getY() + options.tile.getHeight() / 2,
        options.tile.getVectors(),
        vectorOffset
      );
      const originV1 = shiftedTileVectors[side];
      const originV2 = shiftedTileVectors[otherVectorSide];
      const v1 = new Vector(originV1.x, originV1.y);
      const v2 = new Vector(originV2.x, originV2.y);
      const dx = v2.x - v1.x;
      const dy = v2.y - v1.y;
      const rotation = Math.atan2(dy, dx) * 180 / Math.PI;
      let distance = Math.sqrt(dx ** 2 + dy ** 2);
      let x = v1.x;
      let y = v1.y;
      super({
        x,
        y,
        image: Game2.getInstance().getImage(5 /* RIVER */),
        width: distance,
        height: 3,
        transparency: 0.95
      });
      this.setRotation(rotation * (Math.PI / 180));
    }
    //FIXME: Remove these?
    getRotationOriginX() {
      return this.x;
    }
    getRotationOriginY() {
      return this.y;
    }
  };

  // wsf:src/openciv-src/client/src/scene/Line
  var Line = class {
    constructor(options) {
      __publicField(this, "color");
      __publicField(this, "girth");
      __publicField(this, "x1");
      __publicField(this, "y1");
      __publicField(this, "x2");
      __publicField(this, "y2");
      __publicField(this, "z");
      __publicField(this, "transparency");
      __publicField(this, "originalPositions");
      this.color = options.color;
      this.girth = options.girth;
      this.x1 = options.x1;
      this.y1 = options.y1;
      this.x2 = options.x2;
      this.y2 = options.y2;
      this.z = options.z ?? 0;
      this.transparency = options.transparency ?? 1;
      this.originalPositions = [];
      this.originalPositions.push(new Vector(this.x1, this.y1), new Vector(this.x2, this.y2));
    }
    increaseDistance(amount) {
      const dx = this.x2 - this.x1;
      const dy = this.y2 - this.y1;
      const currentDistance = Math.sqrt(dx * dx + dy * dy);
      const unitVectorX = dx / currentDistance;
      const unitVectorY = dy / currentDistance;
      const newDistance = currentDistance + amount;
      this.x1 -= unitVectorX * (amount / 2);
      this.y1 -= unitVectorY * (amount / 2);
      this.x2 = this.x1 + unitVectorX * newDistance;
      this.y2 = this.y1 + unitVectorY * newDistance;
    }
    setPosition(options) {
      this.x1 = options.x1;
      this.y1 = options.y1;
      this.x2 = options.x2;
      this.y2 = options.y2;
    }
    setToOriginalPositions() {
      if (this.originalPositions.length < 1) return;
      this.x1 = this.originalPositions[0].x;
      this.y1 = this.originalPositions[0].y;
      this.x2 = this.originalPositions[1].x;
      this.y2 = this.originalPositions[1].y;
    }
    getVectors() {
      const vectors = [];
      vectors.push(new Vector(this.x1, this.y1));
      vectors.push(new Vector(this.x2, this.y2));
      return vectors;
    }
    setGirth(girth) {
      this.girth = girth;
    }
    getTransparency() {
      return this.transparency;
    }
    getZIndex() {
      return this.z;
    }
    setZValue(value) {
      this.z = value;
    }
    draw(canvasContext) {
      Game2.getInstance().drawLine(this, canvasContext);
    }
    getColor() {
      return this.color;
    }
    getGirth() {
      return this.girth;
    }
    getX1() {
      return this.x1;
    }
    getY1() {
      return this.y1;
    }
    getX2() {
      return this.x2;
    }
    getY2() {
      return this.y2;
    }
  };

  // wsf:src/openciv-src/client/src/city/Building
  var Buidling = class {
    constructor(buildingData) {
      __publicField(this, "name");
      __publicField(this, "statLine");
      __publicField(this, "spriteRegion");
      this.name = buildingData["name"];
      this.spriteRegion = SpriteRegion[buildingData["asset_name"]];
      this.statLine = {};
      for (const stat of buildingData["stats"]) {
        const statType = Object.keys(stat)[0];
        const statValue = stat[statType];
        this.statLine[statType] = statValue;
      }
    }
    getSpriteRegion() {
      return this.spriteRegion;
    }
    getStatLine() {
      return this.statLine;
    }
    getName() {
      return this.name;
    }
  };

  // wsf:src/openciv-src/client/src/city/City
  var City2 = class extends ActorGroup {
    constructor(options) {
      super({ x: 0, y: 0, z: 2, width: 0, height: 0 });
      __publicField(this, "player");
      __publicField(this, "tile");
      __publicField(this, "territory");
      __publicField(this, "territoryOverlays");
      __publicField(this, "workedTiles");
      __publicField(this, "name");
      __publicField(this, "civIcon");
      __publicField(this, "nameLabel");
      __publicField(this, "innerBorderColor");
      __publicField(this, "outsideBorderColor");
      __publicField(this, "buildings");
      __publicField(this, "stats");
      __publicField(this, "statsPresent");
      this.player = options.player;
      this.player.addCity(this);
      this.tile = options.tile;
      this.tile.setCity(this);
      this.name = options.name;
      this.buildings = [];
      this.stats = /* @__PURE__ */ new Map();
      this.statsPresent = false;
      this.innerBorderColor = this.player.getCivilizationData()["inside_border_color"];
      this.outsideBorderColor = this.player.getCivilizationData()["outside_border_color"];
      this.territoryOverlays = [];
      this.territory = options.territory;
      this.workedTiles = options.workedTiles;
      console.log(`[City ${this.name}] Initialized with ${this.workedTiles ? this.workedTiles.length : "undefined"} worked tiles.`);
      this.nameLabel = new Label({
        text: this.name,
        cameraApplies: true,
        x: this.tile.getX(),
        y: this.tile.getY(),
        font: "12px serif",
        fontColor: "white",
        transparency: 1,
        shadowBlur: 1,
        shadowColor: "black",
        lineWidth: 1,
        z: 4
      });
      if (this.player == Game2.getInstance().getCurrentSceneAs().getClientPlayer()) {
        this.nameLabel.setOnClick(() => {
          Game2.getInstance().getCurrentSceneAs().toggleCityUI(this);
        });
      }
      this.nameLabel.conformSize().then(() => {
        this.nameLabel.setPosition(
          this.tile.getX() - this.nameLabel.getWidth() / 2 + this.tile.getWidth() / 2 + 7,
          this.tile.getY() - this.nameLabel.getHeight()
        );
        Game2.getInstance().getCurrentScene().addActor(this.nameLabel);
        this.civIcon = new Actor({
          image: Game2.getInstance().getImage(4 /* SPRITESHEET */),
          spriteRegion: SpriteRegion[this.player.getCivilizationData()["icon_name"]],
          x: this.nameLabel.getX() - 14,
          y: this.nameLabel.getY(),
          z: 4,
          width: 12,
          height: 12
        });
        Game2.getInstance().getCurrentScene().addActor(this.civIcon);
      });
      for (const tile of this.territory) {
        const territoryOverlay = new Actor({
          image: Game2.getInstance().getImage(4 /* SPRITESHEET */),
          spriteRegion: "9,8" /* BLANK_TILE */,
          x: tile.getX(),
          y: tile.getY(),
          width: 32,
          height: 32,
          color: this.innerBorderColor
        });
        this.addActor(territoryOverlay);
        this.territoryOverlays.push(territoryOverlay);
      }
      GameMap2.getInstance().drawBorder(this.territory, this.outsideBorderColor, 3);
      NetworkEvents.on({
        eventName: "addBuilding",
        parentObject: this,
        callback: (data) => {
          const buildingData = data["building"];
          this.buildings.push(new Buidling(buildingData));
        }
      });
      NetworkEvents.on({
        eventName: "updateCityStats",
        parentObject: this,
        callback: (data) => {
          const stats = data["cityStats"];
          for (const stat of stats) {
            const statType = Object.keys(stat)[0];
            const statValue = stat[statType];
            this.stats.set(statType, statValue);
          }
          const workedTilesData = data["workedTiles"];
          if (workedTilesData) {
            const newWorkedTiles = [];
            for (const tileData of workedTilesData) {
              newWorkedTiles.push(GameMap2.getInstance().getTiles()[tileData.x][tileData.y]);
            }
            this.workedTiles = newWorkedTiles;
            console.log(`[City ${this.name}] Updated worked tiles: ${this.workedTiles.length}`);
          }
          this.statsPresent = true;
        }
      });
    }
    hasStats() {
      return this.statsPresent;
    }
    getStat(stat) {
      return this.stats.get(stat);
    }
    onDestroyed() {
      this.player.removeCity(this);
      super.onDestroyed();
      Game2.getInstance().getCurrentScene().removeActor(this.nameLabel);
    }
    getTerritory() {
      return this.territory;
    }
    getPlayer() {
      return this.player;
    }
    getTile() {
      return this.tile;
    }
    getName() {
      return this.name;
    }
    getBuildings() {
      return this.buildings;
    }
    getWorkedTiles() {
      return this.workedTiles;
    }
  };

  // wsf:src/openciv-src/client/src/map/TileOutline
  var TileOutline = class {
    constructor(line, edge, cityOutline) {
      __publicField(this, "line");
      __publicField(this, "edge");
      __publicField(this, "cityOutline");
      __publicField(this, "effectedOutlines");
      this.line = line;
      this.edge = edge;
      this.effectedOutlines = /* @__PURE__ */ new Map();
      this.cityOutline = cityOutline;
    }
    addEffectedOutlines(tile, tileOutline) {
      if (!this.effectedOutlines.has(tile)) {
        this.effectedOutlines.set(tile, []);
      }
      const tileOutlines = this.effectedOutlines.get(tile);
      tileOutlines.push(tileOutline);
    }
    getEffectedOutlines() {
      return this.effectedOutlines;
    }
  };

  // wsf:src/openciv-src/client/src/map/GameMap
  var _GameMap2 = class _GameMap2 {
    constructor() {
      __publicField(this, "oddEdgeAxis", [
        [0, -1],
        [1, -1],
        [1, 0],
        [1, 1],
        [0, 1],
        [-1, 0]
      ]);
      __publicField(this, "evenEdgeAxis", [
        [-1, -1],
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 1],
        [-1, 0]
      ]);
      __publicField(this, "tiles");
      __publicField(this, "mapWidth");
      __publicField(this, "mapHeight");
      __publicField(this, "previousGScore");
      __publicField(this, "previousFScore");
      __publicField(this, "tileOutlines");
      __publicField(this, "topLayerMapChunks");
      __publicField(this, "topLayerTileActorList", []);
      this.previousGScore = void 0;
      this.previousFScore = void 0;
      this.topLayerMapChunks = /* @__PURE__ */ new Map();
      this.tileOutlines = /* @__PURE__ */ new Map();
      NetworkEvents.on({
        eventName: "newCity",
        parentObject: this,
        callback: (data) => {
          const city = this.getCityFromJSONData(data);
          city.getTile().setCity(city);
          Game2.getInstance().getCurrentScene().addActor(city);
        }
      });
    }
    static getInstance() {
      return this.instance;
    }
    /**
     * Initializes the GameMap singleton object, starts a map request to the server.
     */
    static init() {
      _GameMap2.instance = new _GameMap2();
      this.instance.requestMapFromServer();
      this.instance.requestTileYieldsFromServer();
    }
    getTiles() {
      return this.tiles;
    }
    getWidth() {
      return this.tiles.length;
    }
    getHeight() {
      return this.tiles[0].length;
    }
    /**
     * Returns an array of adjacent tiles to the given grid coordinates.
     * @param {number} gridX - The x coordinate of the tile on the grid.
     * @param {number} gridY - The y coordinate of the tile on the grid.
     * @returns {Tile[]} An array of adjacent tiles to the given grid coordinates.
     */
    getAdjacentTiles(gridX, gridY) {
      const adjTiles = [];
      let edgeAxis;
      if (gridY % 2 == 0) edgeAxis = this.evenEdgeAxis;
      else edgeAxis = this.oddEdgeAxis;
      for (let i = 0; i < edgeAxis.length; i++) {
        let edgeX = gridX + edgeAxis[i][0];
        let edgeY = gridY + edgeAxis[i][1];
        if (edgeX == -1 || edgeY == -1 || edgeX > this.mapWidth - 1 || edgeY > this.mapHeight - 1 || gridX + edgeAxis[i][0] < 0) {
          continue;
        }
        adjTiles.push(this.tiles[gridX + edgeAxis[i][0]][gridY + edgeAxis[i][1]]);
      }
      return adjTiles;
    }
    // https://en.wikipedia.org/wiki/A*_search_algorithm
    constructShortestPath(unit, startTile, goalTile) {
      if (!startTile || !goalTile) return [];
      let h = (n) => Math.floor(Tile2.gridDistance(n, goalTile));
      let gScore = [];
      let fScore = [];
      let cameFrom = [];
      for (let x = 0; x < this.getWidth(); x++) {
        gScore[x] = [];
        fScore[x] = [];
        cameFrom[x] = [];
        for (let y = 0; y < this.getHeight(); y++) {
          gScore[x][y] = Number.MAX_VALUE;
          fScore[x][y] = 0;
          if (this.previousGScore || this.previousFScore) {
          }
        }
      }
      gScore[startTile.getGridX()][startTile.getGridY()] = 0;
      fScore[startTile.getGridX()][startTile.getGridY()] = h(startTile);
      let openSet = new PriorityQueue({
        comparator: (a, b) => {
          const fscoreA = fScore[a.getGridX()][a.getGridY()];
          const fscoreB = fScore[b.getGridX()][b.getGridY()];
          if (fscoreA < fscoreB) {
            return -1;
          } else if (fscoreA > fscoreB) {
            return 1;
          } else {
            return 0;
          }
        },
        initialValues: [startTile]
      });
      while (openSet.length > 0) {
        let currentTile = openSet.dequeue();
        if (currentTile == goalTile) {
          this.previousGScore = gScore;
          this.previousFScore = fScore;
          return this.reconstructPath(unit, cameFrom, currentTile);
        }
        for (let neighborTile of currentTile.getAdjacentTiles()) {
          if (!neighborTile) continue;
          let d = (current, neighbor) => unit.getTileWeight(current, neighbor);
          let tentativeGScore = gScore[currentTile.getGridX()][currentTile.getGridY()] + d(currentTile, neighborTile);
          if (tentativeGScore < gScore[neighborTile.getGridX()][neighborTile.getGridY()]) {
            cameFrom[neighborTile.getGridX()][neighborTile.getGridY()] = currentTile;
            gScore[neighborTile.getGridX()][neighborTile.getGridY()] = tentativeGScore;
            fScore[neighborTile.getGridX()][neighborTile.getGridY()] = tentativeGScore + h(neighborTile);
            openSet.queue(neighborTile);
          }
        }
      }
      return [];
    }
    reconstructPath(unit, cameFrom, currentTile) {
      const totalPath = [currentTile];
      let movementCost = 0;
      movementCost += unit.getTileWeight(currentTile, void 0);
      while (currentTile != void 0) {
        currentTile = cameFrom[currentTile.getGridX()][currentTile.getGridY()];
        if (currentTile) {
          totalPath.unshift(currentTile);
          movementCost += unit.getTileWeight(currentTile, void 0);
        }
      }
      if (movementCost >= 9999) {
        return [];
      }
      return totalPath;
    }
    requestTileYieldsFromServer() {
      WebsocketClient.sendMessage({ event: "requestTileYields" });
      NetworkEvents.on({
        eventName: "tileYields",
        parentObject: this,
        callback: (data) => {
          console.log("Received tile yields from server.");
          console.log(data);
          Tile2.setTileYields(data["yields"]);
        }
      });
    }
    requestMapFromServer() {
      const scene = Game2.getInstance().getCurrentScene();
      this.tiles = [];
      const baseLayerTiles = [];
      const riverActors = [];
      const cityJSONS = [];
      const unitJSONS = [];
      WebsocketClient.sendMessage({ event: "requestMap" });
      NetworkEvents.on({
        eventName: "mapSize",
        parentObject: this,
        callback: (data) => {
          this.mapWidth = parseInt(data["width"]);
          this.mapHeight = parseInt(data["height"]);
          for (let x = 0; x < this.mapWidth; x++) {
            this.tiles[x] = [];
            for (let y = 0; y < this.mapHeight; y++) {
            }
          }
        }
      });
      NetworkEvents.on({
        eventName: "mapChunk",
        parentObject: this,
        callback: async (data) => {
          const tileList = data["tiles"];
          const lastChunk = JSON.parse(data["lastChunk"]);
          const chunkX = data["chunkX"] * 32;
          const chunkY = data["chunkY"] * 25;
          const topLayerTiles = [];
          let relativeX = 0;
          let relativeY = 0;
          for (const tileJSON of tileList) {
            const tileTypes = tileJSON["tileTypes"];
            const riverSides = tileJSON["riverSides"];
            const jsonUnits = tileJSON["units"];
            const gridX = parseInt(tileJSON["x"]);
            const gridY = parseInt(tileJSON["y"]);
            const movementCost = parseInt(tileJSON["movementCost"]);
            let yPos = gridY * 25;
            let xPos = gridX * 32;
            if (gridY % 2 != 0) {
              xPos += 16;
            }
            let yPosRelative = relativeY * 25;
            let xPosRelative = relativeX * 32;
            if (relativeY % 2 != 0) {
              xPosRelative += 16;
            }
            relativeY += 1;
            if (relativeY > 3) {
              relativeY = 0;
              relativeX++;
            }
            const tile = new Tile2({
              tileTypes: [tileTypes[0]],
              // Only assign the base tile type, for now....
              riverSides,
              x: xPos,
              y: yPos,
              gridX,
              gridY,
              movementCost,
              yields: tileJSON["yields"]
            });
            this.tiles[gridX][gridY] = tile;
            baseLayerTiles.push(tile);
            if (tile.hasRiver()) {
              for (let numberedRiverSide of tile.getNumberedRiverSides()) {
                riverActors.push(new River({ tile, side: numberedRiverSide }));
              }
            }
            if (tileTypes.length > 1) {
              const topLayerTileTypes = [...tileTypes];
              topLayerTileTypes.shift();
              const topLayerTile = new Tile2({
                tileTypes: topLayerTileTypes,
                x: xPosRelative,
                y: yPosRelative,
                gridX,
                gridY,
                movementCost,
                yields: tileJSON["yields"]
              });
              topLayerTiles.push(topLayerTile);
              this.topLayerTileActorList.push(topLayerTile);
              if (topLayerTileTypes.includes("city")) {
                const cityJSON = tileJSON["city"];
                cityJSONS.push(cityJSON);
              }
            }
            for (const jsonUnit of jsonUnits) {
              unitJSONS.push(jsonUnit);
            }
          }
          for (let tile of topLayerTiles) {
            await tile.loadImage();
          }
          const mapActors = [...topLayerTiles];
          const placeholderActor = new Actor({
            color: "black",
            x: 0,
            y: 0,
            width: 0,
            height: 0
          });
          mapActors.push(placeholderActor);
          const canvasWidth = 32 * 4 + 16;
          const canvasHeight = 25 * 4 + 7;
          const mapChunk = Actor.mergeActors({
            actors: mapActors,
            spriteRegion: false,
            canvasWidth,
            canvasHeight
          });
          mapChunk.setPosition(chunkX, chunkY);
          this.topLayerMapChunks.set(mapChunk, topLayerTiles);
          if (lastChunk) {
            this.initAdjacentTiles();
            for (let tile of baseLayerTiles) {
              await tile.loadImage();
            }
            const bottomLayerActors = [...baseLayerTiles, ...riverActors];
            const bottomLayerActor = Actor.mergeActors({
              actors: bottomLayerActors,
              spriteRegion: false
            });
            scene.addActor(bottomLayerActor);
            this.topLayerMapChunks.forEach((_, chunkActor) => {
              scene.addActor(chunkActor);
            });
            for (const unitJSON of unitJSONS) {
              const tile = this.tiles[unitJSON["tileX"]][unitJSON["tileY"]];
              const unit = new Unit2(tile, unitJSON);
              tile.addUnit(unit);
              scene.addActor(unit);
            }
            for (let topLayerTile of this.topLayerTileActorList) {
              const baseLayerTile = this.tiles[topLayerTile.getGridX()][topLayerTile.getGridY()];
              baseLayerTile.setTileTypes(baseLayerTile.getTileTypes().concat(topLayerTile.getTileTypes()));
            }
            for (const cityJSON of cityJSONS) {
              const city = this.getCityFromJSONData(cityJSON);
              city.getTile().setCity(city);
              scene.addActor(city);
              WebsocketClient.sendMessage({
                event: "requestCityStats",
                cityName: city.getName()
              });
            }
            Game2.getInstance().getCurrentScene().call("mapLoaded");
          }
        }
      });
    }
    drawBorder(tiles, color, z) {
      const outerTiles = tiles.filter((tile) => {
        return !tile.getAdjacentTiles().every((adjTile) => tiles.includes(adjTile));
      });
      for (const tile of outerTiles) {
        const outlineEdges = [0, 0, 0, 0, 0, 0];
        for (let i = 0; i < 6; i++) {
          const adjTile = tile.getAdjacentTiles()[i];
          if (adjTile && tiles.includes(adjTile)) {
            continue;
          }
          let index = i;
          outlineEdges[index] = 1;
        }
        this.setOutline({
          tile,
          edges: outlineEdges,
          thickness: 1,
          color,
          cityOutline: true,
          z
        });
      }
    }
    /**
     * BUG: If we hover inside a city territory, then place an adjacent city, we remove city lines improperly, causing no effect to occur.
     */
    removeOutline(options) {
      const outlines = this.tileOutlines.get(options.tile);
      if (!outlines) return;
      for (const outline of [...outlines]) {
        if (outline.cityOutline && !options.cityOutline) continue;
        Game2.getInstance().getCurrentScene().removeLine(outline.line);
        outlines.splice(outlines.indexOf(outline), 1);
        for (const [_, effectedOutlines] of outline.getEffectedOutlines().entries()) {
          for (const effectedOutline of effectedOutlines) {
            effectedOutline.line.setZValue(2);
            effectedOutline.line.setToOriginalPositions();
          }
        }
      }
      if (outlines.length < 1) {
        this.tileOutlines.delete(options.tile);
      }
    }
    drawUnitSelectionOutline(tile, color) {
      _GameMap2.getInstance().setOutline({
        tile,
        edges: [1, 1, 1, 1, 1, 1],
        thickness: 1,
        color,
        cityOutline: false,
        z: 3
      });
    }
    setOutline(options) {
      const tile = options.tile;
      const tileOutlines = [];
      const oppositeSides = [3, 4, 5, 0, 1, 2];
      for (let i = 0; i < 6; i++) {
        if (!options.edges[i]) continue;
        const iNext = i < 5 ? i + 1 : 0;
        let line = new Line({
          color: options.color,
          girth: options.thickness,
          x1: tile.getVectors()[i].x,
          y1: tile.getVectors()[i].y,
          x2: tile.getVectors()[iNext].x,
          y2: tile.getVectors()[iNext].y,
          z: options.z ?? 2
        });
        if (!options.cityOutline) {
          this.setLinePositionCloserToTile(line, tile, 1);
        }
        tileOutlines.push(new TileOutline(line, i, options.cityOutline));
      }
      if (options.cityOutline) {
        for (const outline of tileOutlines) {
          const adjTile = tile.getAdjacentTiles()[outline.edge];
          if (this.tileOutlines.has(adjTile)) {
            const oppositeAdjEdge = oppositeSides[outline.edge];
            if (this.isOutlineDrawn(adjTile, oppositeAdjEdge)) {
              this.setLinePositionCloserToTile(outline.line, tile, 0.5);
              for (const adjTileOutline of this.tileOutlines.get(adjTile)) {
                if (adjTileOutline.edge === oppositeAdjEdge) {
                  const adjLine = adjTileOutline.line;
                  adjLine.setZValue(outline.line.getZIndex() + 1);
                  this.setLinePositionCloserToTile(adjLine, adjTile, 0.5);
                  adjLine.increaseDistance(0.75);
                  outline.addEffectedOutlines(adjTile, adjTileOutline);
                }
              }
            }
          }
        }
      }
      for (const outline of tileOutlines) {
        Game2.getInstance().getCurrentScene().addLine(outline.line);
      }
      if (this.tileOutlines.has(tile)) {
        this.tileOutlines.get(tile).push(...tileOutlines);
      } else {
        this.tileOutlines.set(tile, tileOutlines);
      }
    }
    setLinePositionCloserToTile(line, tile, amount) {
      const shiftedTileVectors = Vector.shiftVectorsAwayFromCenter(
        tile.getCenterPosition().x,
        tile.getCenterPosition().y,
        line.getVectors(),
        amount
      );
      line.setPosition({
        x1: shiftedTileVectors[0].x,
        y1: shiftedTileVectors[0].y,
        x2: shiftedTileVectors[1].x,
        y2: shiftedTileVectors[1].y
      });
    }
    isOutlineDrawn(tile, edge) {
      for (const tileOutline of this.tileOutlines.get(tile)) {
        if (tileOutline.edge === edge) return true;
      }
      return false;
    }
    async redrawMap(modifiedTiles) {
      for (const tile of modifiedTiles) {
        this.topLayerMapChunks.forEach(async (topLayerTiles, chunk) => {
          if (tile.getX() >= chunk.getX() && tile.getX() + tile.getWidth() <= chunk.getX() + chunk.getWidth() && tile.getY() >= chunk.getY() && tile.getY() + tile.getHeight() <= chunk.getY() + chunk.getHeight()) {
            const xPosRelative = tile.getX() - chunk.getX();
            const yPosRelative = tile.getY() - chunk.getY();
            const topLayerTile = new Tile2({
              tileTypes: tile.getTileTypes().slice(1),
              x: xPosRelative,
              y: yPosRelative,
              gridX: tile.getGridX(),
              gridY: tile.getGridY(),
              movementCost: tile.getMovementCost()
            });
            this.topLayerTileActorList.push(topLayerTile);
            const chunkTileActors = [...topLayerTiles, topLayerTile];
            for (let tile2 of chunkTileActors) {
              await tile2.loadImage();
            }
            const canvasWidth = 32 * 4 + 16;
            const canvasHeight = 25 * 4 + 7;
            const updatedMapChunk = Actor.mergeActors({
              actors: chunkTileActors,
              spriteRegion: false,
              canvasWidth,
              canvasHeight
            });
            updatedMapChunk.setPosition(chunk.getX(), chunk.getY());
            Game2.getInstance().getCurrentScene().addActor(updatedMapChunk);
            Game2.getInstance().getCurrentScene().removeActor(chunk);
            this.topLayerMapChunks.delete(chunk);
            this.topLayerMapChunks.set(updatedMapChunk, chunkTileActors);
          }
        });
      }
    }
    /**
     * Iterate through every tile & assign it's adjacent neighboring tiles through: setAdjacentTile()
     */
    initAdjacentTiles() {
      for (let x = 0; x < this.mapWidth; x++) {
        for (let y = 0; y < this.mapHeight; y++) {
          let edgeAxis;
          if (y % 2 == 0) edgeAxis = this.evenEdgeAxis;
          else edgeAxis = this.oddEdgeAxis;
          for (let i = 0; i < edgeAxis.length; i++) {
            let edgeX = x + edgeAxis[i][0];
            let edgeY = y + edgeAxis[i][1];
            if (edgeX == -1 || edgeY == -1 || edgeX > this.mapWidth - 1 || edgeY > this.mapHeight - 1) {
              this.tiles[x][y].setAdjacentTile(i, null);
              continue;
            }
            this.tiles[x][y].setAdjacentTile(i, this.tiles[x + edgeAxis[i][0]][y + edgeAxis[i][1]]);
          }
        }
      }
    }
    getCityFromJSONData(data) {
      const tile = this.tiles[data["tileX"]][data["tileY"]];
      const player = AbstractPlayer.getPlayerByName(data["player"]);
      const cityName = data["cityName"];
      const territory = [];
      for (const territoryJSON of data["territory"]) {
        territory.push(this.tiles[territoryJSON["tileX"]][territoryJSON["tileY"]]);
      }
      const workedTiles = [];
      if (data["workedTiles"]) {
        for (const workedTileJSON of data["workedTiles"]) {
          workedTiles.push(this.tiles[workedTileJSON["x"]][workedTileJSON["y"]]);
        }
      }
      console.log(`[GameMap] Creating city ${cityName} with ${workedTiles.length} worked tiles.`);
      const city = new City2({
        tile,
        territory,
        workedTiles,
        player,
        name: cityName
      });
      return city;
    }
  };
  __publicField(_GameMap2, "instance");
  var GameMap2 = _GameMap2;

  // wsf:src/openciv-src/client/src/map/HoveredTile
  var HoveredTile = class extends Tile2 {
    constructor(x, y) {
      super({
        x,
        y,
        z: 2,
        gridX: 0,
        //Grid values don't matter.
        gridY: 0,
        tileTypes: ["hovered_tile"],
        width: 32,
        height: 32,
        movementCost: 0
      });
      __publicField(this, "representedTile");
      __publicField(this, "hidden", false);
    }
    setRepresentedTile(representedTile) {
      this.representedTile = representedTile;
      if (!representedTile) {
        Game2.getInstance().getCurrentScene().call("tileHovered", {
          tile: void 0
        });
        this.setPosition(9999, 9999);
        return;
      }
      Game2.getInstance().getCurrentScene().call("tileHovered", {
        tile: representedTile
      });
      this.setPosition(representedTile.getX(), representedTile.getY());
    }
    draw(canvasContext) {
      if (this.hidden) {
        return;
      }
      super.draw(canvasContext);
    }
    setHidden(hidden) {
      this.hidden = hidden;
    }
    getRepresentedTile() {
      return this.representedTile;
    }
  };

  // wsf:src/openciv-src/client/src/util/Numbers
  var Numbers2 = class {
    static clamp(num, min, max) {
      return Math.min(Math.max(num, min), max);
    }
    static addAndWrapAround(num, addend, max) {
      let sum = num + addend;
      if (sum > max) {
        sum = sum % (max + 1);
      }
      return sum;
    }
    static safeRandom() {
      const crypto = window.crypto;
      const array = new Uint32Array(1);
      crypto.getRandomValues(array);
      return array[0] / (4294967295 + 1);
    }
  };

  // wsf:src/openciv-src/client/src/player/ClientPlayer
  var ClientPlayer = class extends AbstractPlayer {
    constructor(playerJSON) {
      super(playerJSON);
      __publicField(this, "selectedUnit");
      __publicField(this, "hoveredTile");
      __publicField(this, "movementLines");
      __publicField(this, "rightMouseDrag");
      __publicField(this, "requestedNextTurn");
      this.movementLines = [];
      this.requestedNextTurn = playerJSON["requestedNextTurn"];
      Game2.getInstance().getCurrentScene().on("mapLoaded", () => {
        this.hoveredTile = new HoveredTile(9999, 9999);
        this.hoveredTile.loadImage().then(() => {
          Game2.getInstance().getCurrentScene().addActor(this.hoveredTile);
          this.updateHoveredTile(Game2.getInstance().getMouseX(), Game2.getInstance().getMouseY());
        });
      });
      Game2.getInstance().getCurrentScene().on("mousemove", (options) => {
        const mouseX = options.clientX;
        const mouseY = options.clientY;
        let oldHoveredTile = this.hoveredTile ? this.hoveredTile.getRepresentedTile() : void 0;
        this.updateHoveredTile(mouseX, mouseY);
        if (!this.selectedUnit || oldHoveredTile === this.hoveredTile.getRepresentedTile() || !this.rightMouseDrag) {
          return;
        }
        if (oldHoveredTile !== this.selectedUnit.getTile()) {
          GameMap2.getInstance().removeOutline({
            tile: oldHoveredTile,
            cityOutline: false
          });
        }
        if (!this.hoveredTile.getRepresentedTile()) {
          this.clearMovementPath();
          return;
        }
        const isQueuedMovement = this.drawMovementPath(
          this.selectedUnit.getTile(),
          this.hoveredTile.getRepresentedTile()
        );
        if (this.movementLines.length > 0) {
          this.drawTargetTileOutline(this.hoveredTile.getRepresentedTile(), isQueuedMovement);
        }
      });
      Game2.getInstance().getCurrentScene().on("mousedown", (options) => {
        if (options.button === 2) {
          this.onMouseRightClick();
        }
      });
      Game2.getInstance().getCurrentScene().on("mouseup", (options) => {
        if (Game2.getInstance().getCurrentScene().getCamera().isLocked() || !this.hoveredTile) {
          return;
        }
        const clickedTile = this.hoveredTile.getRepresentedTile();
        if (options.button === 0) {
          if (clickedTile && clickedTile.getUnits().length > 0) {
            this.onClickedTileWithUnit(clickedTile);
          }
        }
        if (options.button === 2) {
          this.rightMouseDrag = false;
          if (clickedTile && this.selectedUnit) {
            this.moveSelectedUnit(clickedTile);
          }
        }
      });
      NetworkEvents.on({
        eventName: "zoomToLocation",
        parentObject: this,
        callback: (data) => {
          const gridX = data["x"];
          const gridY = data["y"];
          const tile = GameMap2.getInstance().getTiles()[gridX][gridY];
          const zoomAmount = data["zoomAmount"];
          Game2.getInstance().getCurrentSceneAs().focusOnTile(tile, zoomAmount);
        }
      });
      NetworkEvents.on({
        eventName: "removeUnit",
        parentObject: this,
        callback: (data) => {
          if (!this.selectedUnit) return;
          if (this.selectedUnit.getID() === data["id"]) {
            this.selectedUnit = void 0;
            this.clearMovementPath();
            GameMap2.getInstance().removeOutline({
              tile: this.hoveredTile.getRepresentedTile(),
              cityOutline: false
            });
          }
        }
      });
      NetworkEvents.on({
        eventName: "moveUnit",
        parentObject: this,
        callback: (data) => {
          if (!this.selectedUnit || this.selectedUnit.getID() !== data["id"]) {
            return;
          }
          this.clearMovementPath();
          if ("queuedTiles" in data) {
            const movementPath = [this.selectedUnit.getTile()];
            for (const tileLocation of data["queuedTiles"]) {
              movementPath.push(GameMap2.getInstance().getTiles()[tileLocation["x"]][tileLocation["y"]]);
            }
            this.drawMovementPathFromTiles(movementPath);
          }
        }
      });
      Game2.getInstance().getCurrentScene().on("uiStateChanged", (options) => {
        if (this.selectedUnit && options.opened) {
          this.unselectUnit();
        }
        if (options.opened) {
          this.hoveredTile.setHidden(true);
        } else {
          this.hoveredTile.setHidden(false);
        }
      });
      NetworkEvents.on({
        eventName: "newTurn",
        parentObject: this,
        callback: (data) => {
          this.unselectUnit();
          this.clearMovementPath();
        }
      });
    }
    setRequestedNextTurn(value) {
      this.requestedNextTurn = value;
    }
    hasRequestedNextTurn() {
      return this.requestedNextTurn;
    }
    onMouseRightClick() {
      this.rightMouseDrag = true;
      if (!this.selectedUnit || !this.hoveredTile.getRepresentedTile()) {
        return;
      }
      const isQueuedMovement = this.drawMovementPath(this.selectedUnit.getTile(), this.hoveredTile.getRepresentedTile());
      if (this.selectedUnit.hasMovementQueue()) {
        GameMap2.getInstance().removeOutline({
          tile: this.selectedUnit.getTargetQueuedTile(),
          cityOutline: false
        });
      }
      this.drawTargetTileOutline(this.hoveredTile.getRepresentedTile(), isQueuedMovement);
    }
    moveSelectedUnit(targetTile) {
      WebsocketClient.sendMessage({
        event: "moveUnit",
        unitX: this.selectedUnit.getTile().getGridX(),
        unitY: this.selectedUnit.getTile().getGridY(),
        id: this.selectedUnit.getID(),
        targetX: targetTile.getGridX(),
        targetY: targetTile.getGridY()
      });
      GameMap2.getInstance().removeOutline({
        tile: targetTile,
        cityOutline: false
      });
      this.selectedUnit.unselect();
      this.selectedUnit = void 0;
      this.clearMovementPath();
    }
    onClickedTileWithUnit(tile) {
      const units = tile.getUnits();
      const unit = units[0];
      if (unit.getPlayer() != this) {
        return;
      }
      this.clearMovementPath();
      const unselectedUnit = this.unselectUnit();
      if (unselectedUnit === unit) {
        return;
      }
      unit.select();
      this.selectedUnit = unit;
      if (this.selectedUnit.hasMovementQueue()) {
        const isQueuedMovement = this.drawMovementPathFromTiles([unit.getTile(), ...unit.getQueuedMovementTiles()]);
        this.drawTargetTileOutline(this.selectedUnit.getTargetQueuedTile(), isQueuedMovement);
      }
    }
    unselectUnit() {
      const unselectedUnit = this.selectedUnit;
      if (this.selectedUnit) {
        this.selectedUnit.unselect();
        if (this.selectedUnit.hasMovementQueue()) {
          GameMap2.getInstance().removeOutline({
            tile: this.selectedUnit.getTargetQueuedTile(),
            cityOutline: false
          });
        }
      }
      this.selectedUnit = void 0;
      return unselectedUnit;
    }
    updateHoveredTile(mouseX, mouseY) {
      if (!this.hoveredTile || isNaN(mouseX) || isNaN(mouseY)) return;
      let zoom = Game2.getInstance().getCurrentScene().getCamera().getZoomAmount();
      let camX = -Game2.getInstance().getCurrentScene().getCamera().getX();
      let camY = -Game2.getInstance().getCurrentScene().getCamera().getY();
      mouseX += camX;
      mouseY += camY;
      mouseX /= zoom;
      mouseY /= zoom;
      let mouseVector = new Vector(mouseX, mouseY);
      let mouseExtremeVector = new Vector(mouseX + 1e3, mouseY);
      let gridX = Math.floor(mouseX / Tile2.WIDTH);
      let gridY = Math.floor(mouseY / 25);
      if (gridY % 2 != 0) {
        gridX = Math.floor((mouseX - Tile2.WIDTH / 2) / Tile2.WIDTH);
      }
      let estimatedTile = void 0;
      let accurateTile = void 0;
      if (gridX >= GameMap2.getInstance().getWidth() || gridX < 0 || gridY >= GameMap2.getInstance().getHeight() || gridY < 0 || // We also check for mouse values that could indicate were out of bounds...
      mouseY < 6 || mouseX < 15 || mouseX > GameMap2.getInstance().getWidth() * 32) {
        const adjBorderTiles = GameMap2.getInstance().getAdjacentTiles(gridX, gridY);
        const clampedBorderTile = GameMap2.getInstance().getTiles()[Numbers2.clamp(gridX, 0, GameMap2.getInstance().getWidth() - 1)][Numbers2.clamp(gridY, 0, GameMap2.getInstance().getHeight() - 1)];
        adjBorderTiles.push(clampedBorderTile);
        let foundAdjBorderTile = false;
        for (const adjTile of adjBorderTiles) {
          if (!adjTile) continue;
          if (Vector.isInsidePolygon(adjTile.getVectors(), mouseVector, mouseExtremeVector)) {
            accurateTile = adjTile;
            foundAdjBorderTile = true;
          }
        }
        if (!foundAdjBorderTile) {
          this.hoveredTile.setRepresentedTile(void 0);
          return;
        }
      } else {
        estimatedTile = GameMap2.getInstance().getTiles()[gridX][gridY];
        if (!estimatedTile) {
          console.log("on border of map?");
          return;
        }
        if (Vector.isInsidePolygon(estimatedTile.getVectors(), mouseVector, mouseExtremeVector)) {
          accurateTile = estimatedTile;
        } else {
          for (const adjTile of estimatedTile.getAdjacentTiles()) {
            if (!adjTile) continue;
            if (Vector.isInsidePolygon(adjTile.getVectors(), mouseVector, mouseExtremeVector)) {
              accurateTile = adjTile;
            }
          }
        }
      }
      if (!accurateTile) {
        return;
      }
      if (this.hoveredTile !== accurateTile) {
        this.hoveredTile.setRepresentedTile(accurateTile);
      }
    }
    clearMovementPath() {
      for (const line of this.movementLines) {
        Game2.getInstance().getCurrentScene().removeLine(line);
      }
      this.movementLines = [];
    }
    drawMovementPath(startTile, goalTile) {
      if (this.movementLines.length > 0) {
        this.clearMovementPath();
      }
      const pathTiles = GameMap2.getInstance().constructShortestPath(this.selectedUnit, startTile, goalTile);
      return this.drawMovementPathFromTiles(pathTiles);
    }
    drawMovementPathFromTiles(pathTiles) {
      if (pathTiles.length < 1) return false;
      let availableMovement = this.selectedUnit.getAvailableMovement();
      let queuedPath = false;
      for (let i = 0; i < pathTiles.length - 1; i++) {
        const tile1 = pathTiles[i];
        const tile2 = pathTiles[i + 1];
        const tileCost = Tile2.getWeight(tile1, tile2);
        let color = "rgba(7, 250, 214, 1)";
        if (availableMovement <= 0) {
          color = "rgba(154, 158, 153, 1)";
          queuedPath = true;
        }
        availableMovement -= tileCost;
        const line = new Line({
          color,
          girth: 2,
          z: 3,
          x1: tile1.getCenterPosition().x,
          y1: tile1.getCenterPosition().y,
          x2: tile2.getCenterPosition().x,
          y2: tile2.getCenterPosition().y
        });
        this.movementLines.push(line);
        Game2.getInstance().getCurrentScene().addLine(line);
      }
      return queuedPath;
    }
    drawTargetTileOutline(tile, queuedPath) {
      let color = queuedPath ? "lightgrey" : "aqua";
      GameMap2.getInstance().drawUnitSelectionOutline(tile, color);
    }
  };

  // wsf:src/openciv-src/client/src/player/ExternalPlayer
  var ExternalPlayer = class extends AbstractPlayer {
    constructor(playerJSON) {
      super(playerJSON);
    }
  };

  // wsf:src/openciv-src/client/src/ui/Listbox
  var Row = class extends ActorGroup {
    // TODO: Support image
    constructor(options) {
      super({
        x: options.x,
        y: options.y,
        z: options.z,
        width: options.width,
        height: options.height,
        cameraApplies: false
      });
      __publicField(this, "label");
      this.addActor(
        new Actor({
          x: this.x,
          y: this.y,
          width: this.width,
          height: this.height,
          color: options.color
        })
      );
      const label = new Label({
        text: options.text,
        fontColor: options.fontColor,
        font: options.font,
        x: options.textX ?? this.x,
        y: options.textY ?? this.y
      });
      this.label = label;
      this.addActor(label);
    }
    conformLabelSize() {
      return this.label.conformSize();
    }
    setLabelPosition(x, y) {
      this.label.setPosition(x, y);
    }
    getWidth() {
      return this.width;
    }
    getX() {
      return this.x;
    }
    getY() {
      return this.y;
    }
    getHeight() {
      return this.height;
    }
    getLabel() {
      return this.label;
    }
  };
  var ListBox = class extends ActorGroup {
    constructor(options) {
      super(options);
      __publicField(this, "rowHeight");
      __publicField(this, "rows");
      __publicField(this, "textFont");
      __publicField(this, "fontColor");
      this.rowHeight = options.rowHeight ?? 32;
      this.textFont = options.textFont;
      this.fontColor = options.fontColor;
      this.rows = [];
      this.addActor(
        new Actor({
          x: this.x,
          y: this.y,
          width: this.width,
          height: this.height,
          color: "black"
        })
      );
    }
    addCategory(name) {
      const row = new Row({
        x: this.getNextRowPosition().x,
        y: this.getNextRowPosition().y,
        z: this.z,
        width: this.width,
        height: 25,
        //FIXME: Should be dependent on text height
        color: this.rows.length % 2 == 0 ? "#9e9e9e" : " #bbbbbb",
        font: this.textFont,
        fontColor: this.fontColor,
        text: name
      });
      row.conformLabelSize().then(() => {
        row.setLabelPosition(
          row.getLabel().getX() + row.getWidth() / 2 - row.getLabel().getWidth() / 2,
          row.getLabel().getY() + row.getHeight() / 2 - row.getLabel().getHeight() / 2
        );
      });
      this.rows.push(row);
      this.addActor(row);
    }
    addRow(options) {
      const row = new Row({
        x: this.getNextRowPosition().x,
        y: this.getNextRowPosition().y,
        z: this.z,
        text: options.text,
        width: this.width,
        height: options.rowHeight ?? this.rowHeight,
        color: options.color ?? this.rows.length % 2 == 0 ? "#9e9e9e" : " #bbbbbb",
        font: this.textFont,
        fontColor: this.fontColor,
        textX: options.textX,
        textY: options.textY
      });
      for (const actionIcon of options.actorIcons ?? []) {
        row.addActor(actionIcon);
      }
      if (options.centerTextY) {
        row.getLabel().setText(options.text, true);
        row.conformLabelSize().then(() => {
          row.setLabelPosition(
            row.getLabel().getX(),
            row.getLabel().getY() + row.getHeight() / 2 - row.getLabel().getHeight() / 2
          );
        });
      }
      this.rows.push(row);
      this.addActor(row);
      return row;
    }
    getNextRowPosition() {
      let nextY = this.y;
      for (const row of this.rows) {
        nextY += row.getHeight();
      }
      return new Vector(this.x, nextY);
    }
    clearRows() {
      for (const row of this.rows) {
        this.removeActor(row);
      }
      this.rows = [];
    }
    getRows() {
      return this.rows;
    }
  };

  // wsf:src/openciv-src/client/src/ui/RadioButton
  var RadioButton = class extends Actor {
    constructor(options) {
      super({
        image: Game2.getInstance().getImage(4 /* SPRITESHEET */),
        spriteRegion: "8,14" /* RADIO_BUTTON_UNSELECTED */,
        x: options.x,
        y: options.y,
        z: options.z,
        width: options.width,
        height: options.height,
        cameraApplies: false
      });
      __publicField(this, "selected");
      __publicField(this, "getOtherRadioButtons");
      this.selected = options.selected ?? false;
      this.getOtherRadioButtons = options.getOtherRadioButtons;
      if (this.selected) {
        this.spriteRegion = "9,14" /* RADIO_BUTTON_SELECTED */;
      }
      this.on("mousemove", () => {
        if (this.mouseInside) {
          Game2.getInstance().setCursor("pointer");
        }
      });
      this.on("mouse_enter", () => {
        Game2.getInstance().setCursor("pointer");
      });
      this.on("mouse_exit", () => {
        Game2.getInstance().setCursor("default");
      });
      this.on("clicked", () => {
        this.select(true);
      });
    }
    select(value) {
      this.selected = value;
      if (this.selected) {
        this.spriteRegion = "9,14" /* RADIO_BUTTON_SELECTED */;
        for (const radioButton of this.getOtherRadioButtons()) {
          if (radioButton === this) {
            continue;
          }
          radioButton.select(false);
        }
      } else {
        this.spriteRegion = "8,14" /* RADIO_BUTTON_UNSELECTED */;
      }
    }
  };

  // wsf:src/openciv-src/client/src/ui/CityDisplayInfo
  var CityDisplayInfo = class extends ActorGroup {
    constructor(city) {
      super({
        x: 0,
        y: 0,
        z: 6,
        width: Game2.getInstance().getWidth(),
        height: Game2.getInstance().getHeight(),
        cameraApplies: false
      });
      __publicField(this, "city");
      __publicField(this, "citizenMgmtRadioButtons");
      __publicField(this, "statLabels");
      this.city = city;
      this.citizenMgmtRadioButtons = [];
      this.statLabels = /* @__PURE__ */ new Map();
      this.initializeStatsWindow();
      this.initializeBuildingsWindow();
    }
    initializeBuildingsWindow() {
      const listbox = new ListBox({
        x: Game2.getInstance().getWidth() - 275,
        y: 21,
        width: 275,
        height: Game2.getInstance().getHeight() - 21,
        textFont: "20px serif",
        fontColor: "white"
      });
      listbox.addCategory("Citizen Management");
      const radioButton = new RadioButton({
        x: listbox.getNextRowPosition().x - 8,
        y: listbox.getNextRowPosition().y + 50 / 2 - 64 / 2,
        z: this.z,
        width: 64,
        height: 64,
        getOtherRadioButtons: this.getCitizenMgmtRadioButtons.bind(this),
        selected: true
      });
      this.citizenMgmtRadioButtons.push(radioButton);
      listbox.addRow({
        category: "Citizen Management",
        text: "Default Focus",
        textX: listbox.getNextRowPosition().x + 48,
        centerTextY: true,
        rowHeight: 50,
        actorIcons: [radioButton]
      });
      const focuses = [
        { name: "Food Focus", icon: "0,13" /* FOOD_ICON */ },
        { name: "Production Focus", icon: "16,11" /* PRODUCTION_ICON */ },
        { name: "Gold Focus", icon: "17,12" /* GOLD_ICON */ },
        { name: "Science Focus", icon: "12,11" /* SCIENCE_ICON */ },
        { name: "Culture Focus", icon: "10,12" /* CULTURE_ICON */ }
      ];
      for (const focus of focuses) {
        const radioButton2 = new RadioButton({
          x: listbox.getNextRowPosition().x - 8,
          y: listbox.getNextRowPosition().y + 50 / 2 - 64 / 2,
          z: this.z,
          width: 64,
          height: 64,
          getOtherRadioButtons: this.getCitizenMgmtRadioButtons.bind(this)
        });
        this.citizenMgmtRadioButtons.push(radioButton2);
        listbox.addRow({
          category: "Citizen Management",
          text: focus.name,
          textX: listbox.getNextRowPosition().x + 68,
          centerTextY: true,
          rowHeight: 50,
          actorIcons: [
            radioButton2,
            new Actor({
              image: Game2.getInstance().getImage(4 /* SPRITESHEET */),
              spriteRegion: focus.icon,
              x: listbox.getNextRowPosition().x + 38,
              y: listbox.getNextRowPosition().y + 50 / 2 - 32 / 2,
              z: this.z,
              width: 32,
              height: 32,
              cameraApplies: false
            })
          ]
        });
      }
      listbox.addCategory("Buildings");
      this.addActor(listbox);
    }
    getCitizenMgmtRadioButtons() {
      return this.citizenMgmtRadioButtons;
    }
    initializeStatsWindow() {
      const x = 0;
      const y = 21;
      const width = 260;
      const height = 300;
      this.addActor(
        new Actor({
          image: Game2.getInstance().getImage(6 /* POPUP_BOX */),
          x,
          y,
          // (Height of status-bar)
          cornerSize: 20,
          width,
          height,
          nineSlice: true
        })
      );
      const nameLabel = new Label({
        text: this.city.getName(),
        font: "20px serif",
        fontColor: "white"
      });
      nameLabel.conformSize().then(() => {
        nameLabel.setPosition(0 + 260 / 2 - nameLabel.getWidth() / 2, 32);
        this.addActor(nameLabel);
      });
      const populationIcon = new Actor({
        image: Game2.getInstance().getImage(4 /* SPRITESHEET */),
        spriteRegion: "17,13" /* POPULATION_ICON */,
        x: 10,
        y: 52,
        width: 32,
        height: 32
      });
      this.addActor(populationIcon);
      this.addActor(
        new Label({
          text: "Population:",
          font: "20px serif",
          fontColor: "white",
          x: populationIcon.getX() + populationIcon.getWidth(),
          y: populationIcon.getY() + 8
        })
      );
      const populationLabel = new Label({
        text: this.city.getStat("population").toString(),
        font: "20px serif",
        fontColor: "white"
      });
      populationLabel.conformSize().then(() => {
        populationLabel.setPosition(width - populationLabel.getWidth() - 10, populationIcon.getY() + 8);
        this.addActor(populationLabel);
      });
      this.statLabels.set("population", populationLabel);
      const moraleIcon = new Actor({
        image: Game2.getInstance().getImage(4 /* SPRITESHEET */),
        spriteRegion: "1,12" /* MORALE_ICON */,
        x: 10,
        y: populationIcon.getY() + 32,
        width: 32,
        height: 32
      });
      this.addActor(moraleIcon);
      this.addActor(
        new Label({
          text: "Morale:",
          font: "20px serif",
          fontColor: "orange",
          x: moraleIcon.getX() + moraleIcon.getWidth(),
          y: moraleIcon.getY() + 8
        })
      );
      const moraleLabel = new Label({
        text: this.city.getStat("morale").toString(),
        font: "20px serif",
        fontColor: "white"
      });
      moraleLabel.conformSize().then(() => {
        moraleLabel.setPosition(width - moraleLabel.getWidth() - 10, moraleIcon.getY() + 8);
        this.addActor(moraleLabel);
      });
      this.statLabels.set("morale", moraleLabel);
      const foodIcon = new Actor({
        image: Game2.getInstance().getImage(4 /* SPRITESHEET */),
        spriteRegion: "0,13" /* FOOD_ICON */,
        x: 10,
        y: moraleIcon.getY() + 32,
        width: 32,
        height: 32
      });
      this.addActor(foodIcon);
      this.addActor(
        new Label({
          text: "Food:",
          font: "20px serif",
          fontColor: "lime",
          x: foodIcon.getX() + foodIcon.getWidth(),
          y: foodIcon.getY() + 8
        })
      );
      const foodLabel = new Label({
        text: Strings.convertToStatUnit(this.city.getStat("food")),
        font: "20px serif",
        fontColor: "white"
      });
      foodLabel.conformSize().then(() => {
        foodLabel.setPosition(width - foodLabel.getWidth() - 10, foodIcon.getY() + 8);
        this.addActor(foodLabel);
      });
      this.statLabels.set("food", foodLabel);
      const productionIcon = new Actor({
        image: Game2.getInstance().getImage(4 /* SPRITESHEET */),
        spriteRegion: "16,11" /* PRODUCTION_ICON */,
        x: 10,
        y: foodIcon.getY() + 32,
        width: 32,
        height: 32
      });
      this.addActor(productionIcon);
      this.addActor(
        new Label({
          text: "Production:",
          font: "20px serif",
          fontColor: "rgb(220,162,29)",
          x: productionIcon.getX() + productionIcon.getWidth(),
          y: productionIcon.getY() + 8
        })
      );
      const productionLabel = new Label({
        text: Strings.convertToStatUnit(this.city.getStat("production")),
        font: "20px serif",
        fontColor: "white"
      });
      productionLabel.conformSize().then(() => {
        productionLabel.setPosition(width - productionLabel.getWidth() - 10, productionIcon.getY() + 8);
        this.addActor(productionLabel);
      });
      this.statLabels.set("production", productionLabel);
      const goldIcon = new Actor({
        image: Game2.getInstance().getImage(4 /* SPRITESHEET */),
        spriteRegion: "17,12" /* GOLD_ICON */,
        x: 10,
        y: productionIcon.getY() + 32,
        width: 32,
        height: 32
      });
      this.addActor(goldIcon);
      this.addActor(
        new Label({
          text: "Gold:",
          font: "20px serif",
          fontColor: "gold",
          x: goldIcon.getX() + goldIcon.getWidth(),
          y: goldIcon.getY() + 8
        })
      );
      const goldLabel = new Label({
        text: Strings.convertToStatUnit(this.city.getStat("gold")),
        font: "20px serif",
        fontColor: "white"
      });
      goldLabel.conformSize().then(() => {
        goldLabel.setPosition(width - goldLabel.getWidth() - 10, goldIcon.getY() + 8);
        this.addActor(goldLabel);
      });
      this.statLabels.set("gold", goldLabel);
      const scienceIcon = new Actor({
        image: Game2.getInstance().getImage(4 /* SPRITESHEET */),
        spriteRegion: "12,11" /* SCIENCE_ICON */,
        x: 10,
        y: goldIcon.getY() + 32,
        width: 32,
        height: 32
      });
      this.addActor(scienceIcon);
      this.addActor(
        new Label({
          text: "Science:",
          font: "20px serif",
          fontColor: "aqua",
          x: scienceIcon.getX() + scienceIcon.getWidth(),
          y: scienceIcon.getY() + 8
        })
      );
      const scienceLabel = new Label({
        text: Strings.convertToStatUnit(this.city.getStat("science")),
        font: "20px serif",
        fontColor: "white"
      });
      scienceLabel.conformSize().then(() => {
        scienceLabel.setPosition(width - scienceLabel.getWidth() - 10, scienceIcon.getY() + 8);
        this.addActor(scienceLabel);
      });
      this.statLabels.set("science", scienceLabel);
      const cultureIcon = new Actor({
        image: Game2.getInstance().getImage(4 /* SPRITESHEET */),
        spriteRegion: "10,12" /* CULTURE_ICON */,
        x: 10,
        y: scienceIcon.getY() + 32,
        width: 32,
        height: 32
      });
      this.addActor(cultureIcon);
      this.addActor(
        new Label({
          text: "Culture:",
          font: "20px serif",
          fontColor: "rgb(207, 159, 255)",
          x: cultureIcon.getX() + cultureIcon.getWidth(),
          y: cultureIcon.getY() + 8
        })
      );
      const cultureLabel = new Label({
        text: Strings.convertToStatUnit(this.city.getStat("culture")),
        font: "20px serif",
        fontColor: "white"
      });
      cultureLabel.conformSize().then(() => {
        cultureLabel.setPosition(width - cultureLabel.getWidth() - 10, cultureIcon.getY() + 8);
        this.addActor(cultureLabel);
      });
      this.statLabels.set("culture", cultureLabel);
    }
  };

  // wsf:src/openciv-src/client/src/ui/StatusBar
  var StatusBar = class extends ActorGroup {
    constructor() {
      super({
        x: 0,
        y: 0,
        z: 5,
        width: Game2.getInstance().getWidth(),
        height: 21,
        cameraApplies: false
      });
      __publicField(this, "statusBarActor");
      __publicField(this, "currentTurnText");
      //when currentTurnLabel may not be initalized yet
      __publicField(this, "currentTurnLabel");
      __publicField(this, "scienceDescLabel");
      __publicField(this, "scienceIcon");
      __publicField(this, "scienceLabel");
      __publicField(this, "cultureDescLabel");
      __publicField(this, "cultureIcon");
      __publicField(this, "cultureLabel");
      __publicField(this, "goldDescLabel");
      __publicField(this, "goldIcon");
      __publicField(this, "goldLabel");
      __publicField(this, "faithDescLabel");
      __publicField(this, "faithIcon");
      __publicField(this, "faithLabel");
      __publicField(this, "tradeDescLabel");
      __publicField(this, "tradeIcon");
      __publicField(this, "tradeLabel");
      this.generateActors();
      NetworkEvents.on({
        eventName: "newTurn",
        parentObject: this,
        callback: (data) => {
          this.updateCurrentTurnLabel(data);
        }
      });
      NetworkEvents.on({
        eventName: "turnTimeDecrement",
        parentObject: this,
        callback: (data) => {
          this.updateCurrentTurnLabel(data);
        }
      });
    }
    updateCurrentTurnLabel(data) {
      const text = `Turns: ${data["turn"]} (${data["turnTime"]}s)`;
      if (!this.currentTurnLabel) {
        this.currentTurnText = text;
      } else {
        this.currentTurnLabel.setText(text);
        this.currentTurnLabel.conformSize().then(() => {
          this.currentTurnLabel.setPosition(Game2.getInstance().getWidth() - this.currentTurnLabel.getWidth() - 1, 3);
        });
      }
    }
    async generateActors() {
      this.statusBarActor = new Actor({
        image: Game2.getInstance().getImage(4 /* SPRITESHEET */),
        spriteRegion: "4,3" /* UI_STATUSBAR */,
        x: this.x,
        y: this.y,
        width: this.width,
        height: this.height
      });
      this.addActor(this.statusBarActor);
      this.scienceDescLabel = new Label({
        text: "Science:",
        font: "16px serif",
        fontColor: "white"
      });
      await this.scienceDescLabel.conformSize();
      this.scienceDescLabel.setPosition(this.x + 1, 3);
      this.addActor(this.scienceDescLabel);
      this.scienceIcon = new Actor({
        image: Game2.getInstance().getImage(4 /* SPRITESHEET */),
        spriteRegion: "12,11" /* SCIENCE_ICON */,
        x: this.scienceDescLabel.getX() + this.scienceDescLabel.getWidth(),
        y: -6,
        width: 32,
        height: 32
      });
      this.addActor(this.scienceIcon);
      this.scienceLabel = new Label({
        text: "+0",
        font: "16px serif",
        fontColor: "white"
      });
      await this.scienceLabel.conformSize();
      this.scienceLabel.setPosition(this.scienceIcon.getX() + this.scienceIcon.getWidth() - 6, 3);
      this.addActor(this.scienceLabel);
      this.cultureDescLabel = new Label({
        text: "Culture:",
        font: "16px serif",
        fontColor: "white"
      });
      await this.cultureDescLabel.conformSize();
      this.cultureDescLabel.setPosition(this.scienceLabel.getX() + this.scienceLabel.getWidth() + 10, 3);
      this.addActor(this.cultureDescLabel);
      this.cultureIcon = new Actor({
        image: Game2.getInstance().getImage(4 /* SPRITESHEET */),
        spriteRegion: "10,12" /* CULTURE_ICON */,
        x: this.cultureDescLabel.getX() + this.cultureDescLabel.getWidth(),
        y: -6,
        width: 32,
        height: 32
      });
      this.addActor(this.cultureIcon);
      this.cultureLabel = new Label({
        text: "+0",
        font: "16px serif",
        fontColor: "white"
      });
      await this.cultureLabel.conformSize();
      this.cultureLabel.setPosition(this.cultureIcon.getX() + this.cultureIcon.getWidth() - 6, 3);
      this.addActor(this.cultureLabel);
      this.goldDescLabel = new Label({
        text: "Gold:",
        font: "16px serif",
        fontColor: "white"
      });
      await this.goldDescLabel.conformSize();
      this.goldDescLabel.setPosition(this.cultureLabel.getX() + this.cultureLabel.getWidth() + 10, 3);
      this.addActor(this.goldDescLabel);
      this.goldIcon = new Actor({
        image: Game2.getInstance().getImage(4 /* SPRITESHEET */),
        spriteRegion: "17,12" /* GOLD_ICON */,
        x: this.goldDescLabel.getX() + this.goldDescLabel.getWidth(),
        y: -6,
        width: 32,
        height: 32
      });
      this.addActor(this.goldIcon);
      this.goldLabel = new Label({
        text: "+0",
        font: "16px serif",
        fontColor: "white"
      });
      await this.goldLabel.conformSize();
      this.goldLabel.setPosition(this.goldIcon.getX() + this.goldIcon.getWidth() - 6, 3);
      this.addActor(this.goldLabel);
      this.faithDescLabel = new Label({
        text: "Faith:",
        font: "16px serif",
        fontColor: "white"
      });
      await this.faithDescLabel.conformSize();
      this.faithDescLabel.setPosition(this.goldLabel.getX() + this.goldLabel.getWidth() + 10, 3);
      this.addActor(this.faithDescLabel);
      this.faithIcon = new Actor({
        image: Game2.getInstance().getImage(4 /* SPRITESHEET */),
        spriteRegion: "2,13" /* FAITH_ICON */,
        x: this.faithDescLabel.getX() + this.faithDescLabel.getWidth(),
        y: -6,
        width: 32,
        height: 32
      });
      this.addActor(this.faithIcon);
      this.faithLabel = new Label({
        text: "+0",
        font: "16px serif",
        fontColor: "white"
      });
      await this.faithLabel.conformSize();
      this.faithLabel.setPosition(this.faithIcon.getX() + this.faithIcon.getWidth() - 6, 3);
      this.addActor(this.faithLabel);
      this.tradeDescLabel = new Label({
        text: "Trade:",
        font: "16px serif",
        fontColor: "white"
      });
      await this.tradeDescLabel.conformSize();
      this.tradeDescLabel.setPosition(this.faithLabel.getX() + this.faithLabel.getWidth() + 10, 3);
      this.addActor(this.tradeDescLabel);
      this.tradeIcon = new Actor({
        image: Game2.getInstance().getImage(4 /* SPRITESHEET */),
        spriteRegion: "5,14" /* TRADE_ICON */,
        x: this.tradeDescLabel.getX() + this.tradeDescLabel.getWidth() + 10,
        y: 2,
        width: 16,
        height: 16
      });
      this.addActor(this.tradeIcon);
      this.tradeLabel = new Label({
        text: "0/0",
        font: "16px serif",
        fontColor: "white"
      });
      await this.tradeLabel.conformSize();
      this.tradeLabel.setPosition(this.tradeIcon.getX() + this.tradeIcon.getWidth() + 4, 3);
      this.addActor(this.tradeLabel);
      this.currentTurnLabel = new Label({
        text: this.currentTurnText,
        font: "16px serif",
        fontColor: "white"
      });
      await this.currentTurnLabel.conformSize();
      this.currentTurnLabel.setPosition(Game2.getInstance().getWidth() - this.currentTurnLabel.getWidth() - 1, 3);
      this.addActor(this.currentTurnLabel);
    }
  };

  // wsf:src/openciv-src/client/src/scene/Camera
  var Camera = class _Camera {
    constructor(options) {
      //TODO: Implement zoom: https://stackoverflow.com/questions/5189968/zoom-canvas-to-mouse-cursor/5526721#5526721
      __publicField(this, "keysHeld");
      __publicField(this, "x");
      __publicField(this, "y");
      __publicField(this, "targetX");
      __publicField(this, "targetY");
      __publicField(this, "xVelAmount");
      __publicField(this, "yVelAmount");
      __publicField(this, "zoomAmount");
      __publicField(this, "targetZoomAmount");
      __publicField(this, "lastMouseX");
      __publicField(this, "lastMouseY");
      __publicField(this, "mouseHeld");
      __publicField(this, "locked");
      __publicField(this, "wasdControls");
      __publicField(this, "mouseControls");
      __publicField(this, "arrowControls");
      this.keysHeld = [];
      this.x = 0;
      this.y = 0;
      this.targetX = 0;
      this.targetY = 0;
      this.wasdControls = options.wasd_controls;
      this.mouseControls = options.mouse_controls;
      this.arrowControls = options.arrow_controls;
      this.xVelAmount = 0;
      this.yVelAmount = 0;
      this.zoomAmount = 1;
      this.targetZoomAmount = 1;
      this.lastMouseX = 0;
      this.lastMouseY = 0;
      this.locked = false;
      const scene = Game2.getInstance().getCurrentScene();
      scene.on("keydown", (options2) => {
        if (this.keysHeld.includes(options2.key) || this.locked) {
          return;
        }
        this.keysHeld.push(options2.key);
        if (this.wasdControls) {
          if (options2.key == "a" || options2.key == "A") {
            scene.getCamera().addVel(5, 0);
          }
          if (options2.key == "d" || options2.key == "D") {
            scene.getCamera().addVel(-5, 0);
          }
          if (options2.key == "w" || options2.key == "W") {
            scene.getCamera().addVel(0, 5);
          }
          if (options2.key == "s" || options2.key == "S") {
            scene.getCamera().addVel(0, -5);
          }
        }
        if (this.arrowControls) {
          if (options2.key == "ArrowLeft") {
            scene.getCamera().addVel(5, 0);
          }
          if (options2.key == "ArrowRight") {
            scene.getCamera().addVel(-5, 0);
          }
          if (options2.key == "ArrowUp") {
            scene.getCamera().addVel(0, 5);
          }
          if (options2.key == "ArrowDown") {
            scene.getCamera().addVel(0, -5);
          }
        }
        if (options2.key == "=") {
          scene.getCamera().zoom(Game2.getInstance().getWidth() / 2, Game2.getInstance().getHeight() / 2, 1.2);
        }
        if (options2.key == "-") {
          scene.getCamera().zoom(Game2.getInstance().getWidth() / 2, Game2.getInstance().getHeight() / 2, 0.8);
        }
      });
      scene.on("keyup", (options2) => {
        if (this.wasdControls) {
          this.keysHeld = this.keysHeld.filter((element) => element !== options2.key);
          if (options2.key == "a" || options2.key == "A") {
            scene.getCamera().addVel(-5, 0);
          }
          if (options2.key == "d" || options2.key == "D") {
            scene.getCamera().addVel(5, 0);
          }
          if (options2.key == "w" || options2.key == "W") {
            scene.getCamera().addVel(0, -5);
          }
          if (options2.key == "s" || options2.key == "S") {
            scene.getCamera().addVel(0, 5);
          }
        }
        if (this.arrowControls) {
          this.keysHeld = this.keysHeld.filter((element) => element !== options2.key);
          if (options2.key == "ArrowLeft") {
            scene.getCamera().addVel(-5, 0);
          }
          if (options2.key == "ArrowRight") {
            scene.getCamera().addVel(5, 0);
          }
          if (options2.key == "ArrowUp") {
            scene.getCamera().addVel(0, -5);
          }
          if (options2.key == "ArrowDown") {
            scene.getCamera().addVel(0, 5);
          }
        }
      });
      if (options.mouse_controls) {
        scene.on("mousedown", (options2) => {
          if (options2.button !== 0 || this.locked) {
            return;
          }
          this.lastMouseX = options2.x - scene.getCamera().getX();
          this.lastMouseY = options2.y - scene.getCamera().getY();
          this.mouseHeld = true;
        });
        scene.on("mousemove", (options2) => {
          if (this.mouseHeld) {
            scene.getCamera().setTargetPosition(options2.x - this.lastMouseX, options2.y - this.lastMouseY);
          }
        });
        scene.on("mouseup", (options2) => {
          this.lastMouseX = options2.x - scene.getCamera().getX();
          this.lastMouseY = options2.y - scene.getCamera().getY();
          this.mouseHeld = false;
        });
        scene.on("wheel", (options2) => {
          if (this.locked) {
            return;
          }
          if (options2.deltaY > 0) {
            scene.getCamera().zoom(options2.x, options2.y, 0.8);
          }
          if (options2.deltaY < 0) {
            scene.getCamera().zoom(options2.x, options2.y, 1.2);
          }
          this.lastMouseX = options2.x - scene.getCamera().getX();
          this.lastMouseY = options2.y - scene.getCamera().getY();
        });
        scene.on("mouseleave", (options2) => {
          this.lastMouseX = options2.x - scene.getCamera().getX();
          this.lastMouseY = options2.y - scene.getCamera().getY();
          this.mouseHeld = false;
        });
      }
    }
    static fromCamera(camera) {
      const newCamera = new _Camera({
        wasd_controls: camera.hasWASDControls(),
        mouse_controls: camera.hasMouseControls(),
        arrow_controls: camera.hasArrowControls()
      });
      newCamera.setPosition(camera.getX(), camera.getY());
      newCamera.setZoom(camera.getZoomAmount());
      return newCamera;
    }
    // Lerp helper
    lerp(a, b, t) {
      return a + (b - a) * t;
    }
    hasWASDControls() {
      return this.wasdControls;
    }
    hasMouseControls() {
      return this.mouseControls;
    }
    hasArrowControls() {
      return this.arrowControls;
    }
    setZoom(amount) {
      this.zoomAmount = amount;
    }
    /**
     * Smoothly zooms the camera to a specific world location and centers it in the viewport.
     *
     * Unlike {@link zoom}, which may only adjust the zoom level or perform a generic zoom operation,
     * this method sets both the target zoom amount and the camera's target position so that the given
     * world coordinates (`x`, `y`) are centered on the screen after zooming. This is useful for focusing
     * on a particular point of interest in the game world, ensuring it remains centered as the zoom occurs.
     *
     * @param x - The world x-coordinate to center on after zooming.
     * @param y - The world y-coordinate to center on after zooming.
     * @param zoomAmount - The target zoom level to apply.
     */
    zoomToLocation(x, y, zoomAmount) {
      const game = Game2.getInstance();
      const width = game.getWidth() / game.getDPR();
      const height = game.getHeight() / game.getDPR();
      this.targetZoomAmount = zoomAmount;
      this.targetX = -x * zoomAmount + width / 2;
      this.targetY = -y * zoomAmount + height / 2;
    }
    addVel(x, y) {
      this.xVelAmount += x;
      this.yVelAmount += y;
    }
    getX() {
      return this.x;
    }
    getY() {
      return this.y;
    }
    setPosition(x, y) {
      this.x = x;
      this.y = y;
    }
    setTargetPosition(x, y) {
      this.targetX = x;
      this.targetY = y;
    }
    /**
     * Updates x & y position of camera based on assigned xVel and yVel. To be called every render frame.
     */
    updateOffset() {
      if (this.xVelAmount) {
        this.targetX += this.xVelAmount * Math.max(1, this.zoomAmount);
      }
      if (this.yVelAmount) {
        this.targetY += this.yVelAmount * Math.max(1, this.zoomAmount);
      }
      const easing = 0.4;
      this.x = this.lerp(this.x, this.targetX, easing);
      this.y = this.lerp(this.y, this.targetY, easing);
      this.zoomAmount = this.lerp(this.zoomAmount, this.targetZoomAmount, easing);
    }
    /**
     * Adjusts the camera's zoom level centered at the specified (atX, atY) coordinates.
     * Updates the camera's target position to maintain the zoom focus at the given point,
     * and sets the target zoom amount. This function is intended to be called when the user
     * performs a zoom action (e.g., mouse wheel or pinch gesture) at a specific location.
     * 
     * @param atX - The x-coordinate around which to zoom.
     * @param atY - The y-coordinate around which to zoom.
     * @param amount - The zoom factor to apply (e.g., 1.1 to zoom in, 0.9 to zoom out).
     * @param incrementZoom - If true, multiplies the current zoom by `amount`; if false, sets zoom directly to `amount`.
     */
    zoom(atX, atY, amount, incrementZoom = true) {
      const newX = atX - (atX - this.x) * amount;
      const newY = atY - (atY - this.y) * amount;
      this.targetX = newX;
      this.targetY = newY;
      if (incrementZoom) {
        this.targetZoomAmount = this.zoomAmount * amount;
      } else {
        this.targetZoomAmount = amount;
      }
    }
    getZoomAmount() {
      return this.zoomAmount;
    }
    lock(value) {
      this.locked = value;
    }
    isLocked() {
      return this.locked;
    }
  };

  // wsf:src/openciv-src/client/src/scene/Scene
  var _Scene = class _Scene {
    constructor() {
      __publicField(this, "storedEvents");
      __publicField(this, "firstLoad");
      __publicField(this, "systemMenuOpen");
      __publicField(this, "camera");
      __publicField(this, "oldCamera");
      __publicField(this, "sceneObjects");
      __publicField(this, "name");
      this.storedEvents = /* @__PURE__ */ new Map();
      this.sceneObjects = [];
      this.firstLoad = true;
    }
    setName(name) {
      this.name = name;
    }
    getName() {
      return this.name;
    }
    addLine(line) {
      this.sceneObjects.push(line);
      this.sortSceneObjects();
      Game2.getInstance().addLine(line);
    }
    removeLine(line) {
      this.sceneObjects = this.sceneObjects.filter((element) => element !== line);
      this.sortSceneObjects();
      Game2.getInstance().removeLine(line);
    }
    addActor(actor) {
      this.sceneObjects.push(actor);
      this.sortSceneObjects();
      Game2.getInstance().addActor(actor);
    }
    removeActor(actor) {
      if (!actor) return;
      this.sceneObjects = this.sceneObjects.filter((element) => element !== actor);
      this.sortSceneObjects();
      Game2.getInstance().removeActor(actor);
    }
    gameLoop() {
      if (this.camera) {
        this.camera.updateOffset();
      }
      this.sceneObjects.forEach((object) => {
        object.draw(Game2.getInstance().getCanvasContext());
      });
    }
    redraw() {
      this.onDestroyed(this);
      this.onInitialize();
    }
    onInitialize() {
    }
    onDestroyed(newScene) {
      this.sceneObjects.forEach((object) => {
        if (object instanceof Actor || object instanceof ActorGroup) {
          const actor = object;
          actor.call("mouse_exit");
          this.removeActor(object);
        }
      });
      if (this.camera) {
        this.oldCamera = this.camera;
      }
      this.camera = void 0;
      this.sceneObjects = [];
      this.storedEvents.clear();
      NetworkEvents.clear();
      this.firstLoad = false;
      return _Scene.ExitReceipt;
    }
    call(eventName, options) {
      if (this.storedEvents.has(eventName)) {
        const functions = this.storedEvents.get(eventName);
        for (let currentFunction of functions) {
          currentFunction(options);
        }
      }
    }
    on(eventName, callback) {
      let functions = this.storedEvents.get(eventName) ?? [];
      functions.push(callback);
      this.storedEvents.set(eventName, functions);
    }
    hasActor(actor) {
      const actorIndex = this.sceneObjects.indexOf(actor);
      if (actorIndex < 0) return false;
      return true;
    }
    setCamera(camera) {
      this.camera = camera;
    }
    getCamera() {
      return this.camera;
    }
    restoreCamera() {
      this.camera = Camera.fromCamera(this.oldCamera);
      const wDiff = Game2.getInstance().getWidth() - Game2.getInstance().getOldWidth();
      const hDiff = Game2.getInstance().getHeight() - Game2.getInstance().getOldHeight();
      this.camera.setPosition(this.camera.getX() + wDiff / 2, this.camera.getY() + hDiff / 2);
    }
    sortSceneObjects() {
      this.sceneObjects.sort((obj1, obj2) => {
        return obj1.getZIndex() - obj2.getZIndex();
      });
    }
    hasSystemMenuOpen() {
      return this.systemMenuOpen;
    }
  };
  __publicField(_Scene, "ExitReceipt", new class {
  }());
  var Scene = _Scene;

  // wsf:src/openciv-src/client/src/scene/type/InGameScene
  var InGameScene = class extends Scene {
    constructor() {
      super(...arguments);
      __publicField(this, "players");
      __publicField(this, "clientPlayer");
      __publicField(this, "tileInformationLabel");
      __publicField(this, "tileYieldActors", []);
      __publicField(this, "statusBar");
      __publicField(this, "cityDisplayInfo");
      __publicField(this, "nextTurnButton");
      __publicField(this, "closeCityDisplayButton");
      __publicField(this, "escMenu");
      __publicField(this, "isUIOpen", false);
      __publicField(this, "activeGameplayUI");
    }
    onInitialize() {
      this.players = [];
      if (this.firstLoad) {
        const camera = new Camera({
          wasd_controls: false,
          mouse_controls: true,
          arrow_controls: true
          //initial_position: [1, 1],
        });
        this.setCamera(camera);
      } else {
        this.restoreCamera();
      }
      this.on("keyup", (options) => {
        if (options.key === "Escape") {
          if (this.activeGameplayUI) {
            this.activeGameplayUI.close();
          } else {
            this.toggleEscMenu();
          }
        }
      });
      WebsocketClient.sendMessage({ event: "connectedPlayers" });
      NetworkEvents.on({
        eventName: "connectedPlayers",
        parentObject: this,
        callback: (data) => {
          for (let i = 0; i < data["players"].length; i++) {
            const playerJSON = data["players"][i];
            if (playerJSON["name"] === data["requestingName"]) {
              this.clientPlayer = new ClientPlayer(playerJSON);
              this.players.push(this.clientPlayer);
            } else {
              this.players.push(new ExternalPlayer(playerJSON));
            }
          }
        }
      });
      GameMap2.init();
      this.on("mapLoaded", () => {
        this.tileInformationLabel = new Label({
          text: "N/A",
          font: "16px serif",
          fontColor: "white",
          shadowColor: "black",
          lineWidth: 4,
          x: 0,
          y: 0,
          z: 5
        });
        this.tileInformationLabel.conformSize().then(() => {
          this.tileInformationLabel.setPosition(
            2,
            Game2.getInstance().getHeight() - this.tileInformationLabel.getHeight() - 6
          );
          this.addActor(this.tileInformationLabel);
        });
        this.statusBar = new StatusBar();
        this.addActor(this.statusBar);
        this.nextTurnButton = new Button({
          text: this.clientPlayer.hasRequestedNextTurn() ? "Waiting..." : "Next Turn",
          x: Game2.getInstance().getWidth() / 2 - 150 / 2,
          y: Game2.getInstance().getHeight() - 44,
          z: 6,
          width: 150,
          height: 42,
          fontColor: "white",
          onClicked: () => {
            if (this.clientPlayer.hasRequestedNextTurn()) {
              this.nextTurnButton.setText("Next Turn");
              WebsocketClient.sendMessage({
                event: "nextTurnRequest",
                value: false
              });
              this.clientPlayer.setRequestedNextTurn(false);
            } else {
              WebsocketClient.sendMessage({
                event: "nextTurnRequest",
                value: true
              });
              this.nextTurnButton.setText("Waiting...");
              this.clientPlayer.setRequestedNextTurn(true);
            }
          }
        });
        this.addActor(this.nextTurnButton);
        this.closeCityDisplayButton = new Button({
          text: "Return to Map",
          x: Game2.getInstance().getWidth() / 2 - 275 / 2,
          y: Game2.getInstance().getHeight() - 88,
          z: 5,
          width: 275,
          height: 52,
          fontColor: "white",
          onClicked: () => {
            this.toggleCityUI();
          }
        });
        this.on("tileHovered", (options) => {
          for (const actor of this.tileYieldActors) {
            this.removeActor(actor);
          }
          this.tileYieldActors = [];
          if (options.tile && !this.isUIOpen) {
            let tileTypes = options.tile.getTileTypes().toString();
            tileTypes = tileTypes.replaceAll("_", " ");
            tileTypes = tileTypes.replaceAll(",", ", ");
            let strArray = tileTypes.split("");
            strArray[0] = strArray[0].toUpperCase();
            for (let i = 1; i < tileTypes.length; i++) {
              if (tileTypes[i - 1] === " ") {
                strArray[i] = tileTypes[i].toUpperCase();
              }
            }
            tileTypes = strArray.join("");
            const yields = options.tile.getTileYield();
            const statSpriteRegions = {
              food: "0,13" /* FOOD_ICON */,
              production: "16,11" /* PRODUCTION_ICON */,
              gold: "17,12" /* GOLD_ICON */,
              faith: "2,13" /* FAITH_ICON */,
              morale: "1,12" /* MORALE_ICON */,
              science: "12,11" /* SCIENCE_ICON */,
              culture: "10,12" /* CULTURE_ICON */
            };
            this.tileInformationLabel.setText(
              `[${options.tile.getGridX()},${options.tile.getGridY()}] ` + tileTypes + (options.tile.hasRiver() ? ", River" : "")
            );
            this.tileInformationLabel.conformSize().then(() => {
              let iconX = this.tileInformationLabel.getX() + this.tileInformationLabel.getWidth();
              const iconY = this.tileInformationLabel.getY() - 10;
              if (yields) {
                for (const [key, value] of Object.entries(yields)) {
                  if (typeof value === "number" && value > 0 && statSpriteRegions[key]) {
                    const iconActor = new Actor({
                      image: Game2.getInstance().getImage(4 /* SPRITESHEET */),
                      spriteRegion: statSpriteRegions[key],
                      x: iconX,
                      y: iconY,
                      width: 32,
                      height: 32,
                      z: 10,
                      cameraApplies: false
                    });
                    this.addActor(iconActor);
                    this.tileYieldActors.push(iconActor);
                    const valueLabel = new Label({
                      text: value.toString(),
                      font: "16px serif",
                      fontColor: "white",
                      shadowColor: "black",
                      lineWidth: 4,
                      x: iconX + iconActor.getWidth() - 6,
                      y: this.tileInformationLabel.getY(),
                      z: 10
                    });
                    this.addActor(valueLabel);
                    this.tileYieldActors.push(valueLabel);
                    iconX += 42;
                  }
                }
              }
            });
          }
        });
        if (this.firstLoad) {
          WebsocketClient.sendMessage({ event: "loadedIn" });
        }
        NetworkEvents.on({
          eventName: "newTurn",
          parentObject: this,
          callback: (data) => {
            this.nextTurnButton.setText("Next Turn");
            this.clientPlayer.setRequestedNextTurn(false);
          }
        });
      });
    }
    onDestroyed() {
      super.onDestroyed(this);
      this.escMenu = void 0;
      this.cityDisplayInfo = void 0;
      return Scene.ExitReceipt;
    }
    focusOnTile(tile, zoomAmount) {
      const x = tile.getCenterPosition().x;
      const y = tile.getCenterPosition().y;
      Game2.getInstance().getCurrentScene().getCamera().zoomToLocation(x, y, zoomAmount);
    }
    toggleCityUI(city) {
      if (!this.cityDisplayInfo && city) {
        if (this.isUIOpen) return;
        this.openCityUI(city);
        this.call("toggleCityUI", { opened: true, city });
      } else {
        this.closeCityUI();
        this.call("toggleCityUI", { opened: false, city });
      }
    }
    setUIState(isOpen) {
      this.isUIOpen = isOpen;
      this.getCamera().lock(isOpen);
      this.call("uiStateChanged", { opened: isOpen });
      if (isOpen) {
        this.tileInformationLabel.setText("");
        this.tileYieldActors.forEach((actor) => {
          this.removeActor(actor);
        });
        this.tileYieldActors = [];
      } else {
        this.systemMenuOpen = false;
      }
    }
    getPlayers() {
      return this.players;
    }
    getClientPlayer() {
      return this.clientPlayer;
    }
    openCityUI(city) {
      if (city.getPlayer() != this.clientPlayer || !city.hasStats()) {
        return;
      }
      this.cityDisplayInfo = new CityDisplayInfo(city);
      this.addActor(this.cityDisplayInfo);
      this.focusOnTile(city.getTile(), 3);
      this.setUIState(true);
      this.systemMenuOpen = false;
      this.activeGameplayUI = { close: () => this.toggleCityUI() };
      this.removeActor(this.nextTurnButton);
      this.removeActor(this.tileInformationLabel);
      this.addActor(this.closeCityDisplayButton);
    }
    closeCityUI() {
      this.removeActor(this.cityDisplayInfo);
      this.cityDisplayInfo = void 0;
      this.setUIState(false);
      this.activeGameplayUI = void 0;
      this.addActor(this.nextTurnButton);
      this.addActor(this.tileInformationLabel);
      this.removeActor(this.closeCityDisplayButton);
    }
    toggleEscMenu() {
      if (this.escMenu) {
        this.removeActor(this.escMenu);
        this.escMenu = void 0;
        this.systemMenuOpen = false;
        this.setUIState(false);
        return;
      }
      this.setUIState(true);
      this.systemMenuOpen = true;
      Game2.getInstance().setCursor("default");
      this.escMenu = new ActorGroup({
        x: Game2.getInstance().getWidth() / 2 - 250 / 2,
        y: Game2.getInstance().getHeight() / 2 - 250 / 2,
        width: 250,
        height: 275,
        cameraApplies: false
      });
      this.escMenu.addActor(
        new Actor({
          x: this.escMenu.getX(),
          y: this.escMenu.getY(),
          width: this.escMenu.getWidth(),
          height: this.escMenu.getHeight(),
          image: Game2.getInstance().getImage(6 /* POPUP_BOX */),
          nineSlice: true,
          cornerSize: 20
        })
      );
      this.escMenu.addActor(
        new Button({
          text: "Return",
          x: this.escMenu.getX() + 23,
          y: this.escMenu.getY() + 23,
          width: 210,
          height: 50,
          fontColor: "white",
          onClicked: () => {
            this.toggleEscMenu();
          }
        })
      );
      this.escMenu.addActor(
        new Button({
          text: "Settings",
          x: this.escMenu.getX() + 23,
          y: this.escMenu.getY() + 83,
          width: 210,
          height: 50,
          fontColor: "white",
          onClicked: () => {
            console.log("Toggle settings menu");
          }
        })
      );
      this.escMenu.addActor(
        new Button({
          text: "Save Game",
          x: this.escMenu.getX() + 23,
          y: this.escMenu.getY() + 143,
          width: 210,
          height: 50,
          fontColor: "white",
          onClicked: () => {
          }
        })
      );
      this.escMenu.addActor(
        new Button({
          text: "Main Menu",
          x: this.escMenu.getX() + 23,
          y: this.escMenu.getY() + 203,
          width: 210,
          height: 50,
          fontColor: "white",
          onClicked: () => {
            WebsocketClient.disconnect();
            Game2.getInstance().setScene("main_menu");
            this.firstLoad = true;
          }
        })
      );
      this.addActor(this.escMenu);
    }
  };

  // wsf:src/openciv-src/client/src/ui/Textbox
  var TextBox = class extends Actor {
    constructor(options) {
      super({
        x: options.x,
        y: options.y,
        width: options.width,
        height: options.height
      });
      __publicField(this, "selected");
      __publicField(this, "shouldBlink");
      __publicField(this, "blinkInterval");
      __publicField(this, "text");
      __publicField(this, "textHeight");
      __publicField(this, "blinkerX");
      __publicField(this, "font");
      this.selected = false;
      this.shouldBlink = false;
      this.textHeight = -1;
      this.text = "";
      this.blinkerX = this.x + 5;
      this.font = options.font ?? "24px sans-serif";
      this.on("mouse_enter", () => {
        document.getElementById("canvas").style.cursor = "text";
      });
      this.on("mouse_exit", () => {
        document.getElementById("canvas").style.cursor = "auto";
      });
      this.on("clicked", () => {
        if (this.selected) return;
        this.selected = true;
        this.shouldBlink = true;
        this.blinkInterval = setInterval(() => {
          this.shouldBlink = !this.shouldBlink;
        }, 500);
      });
      this.on("mouse_up", (options2) => {
        if (!this.insideActor(options2.x, options2.y)) {
          this.selected = false;
          this.shouldBlink = false;
          clearInterval(this.blinkInterval);
        }
      });
      this.on("keydown", (options2) => {
        if (!this.selected) return;
        if (options2.key.charAt(0) === "F" && options2.key.length > 1) {
          return;
        }
        if (options2.key.startsWith("Arrow")) {
          return;
        }
        switch (options2.key) {
          case "WakeUp":
          case "Enter":
          case "Escape":
          case "Shift":
          case "Alt":
          case "CapsLock":
          case "Home":
          case "End":
          case "Insert":
          case "Delete":
          case "PageDown":
          case "PageUp":
          case "OS":
          case "Tab":
            return;
          case "Backspace":
            this.setText(this.text.slice(0, -1));
            break;
          case "Control":
            return;
          default:
            this.setText(this.getText() + options2.key);
            break;
        }
      });
    }
    onDestroyed() {
      clearInterval(this.blinkInterval);
    }
    draw(canvasContext) {
      if (this.textHeight == -1) {
        const { height } = Game2.getInstance().measureText("M", this.font);
        this.textHeight = height;
      }
      Game2.getInstance().drawRect({
        x: this.x,
        y: this.y,
        width: this.width,
        height: this.height,
        color: "#FFFFFF",
        fill: true,
        canvasContext
      });
      if (this.shouldBlink) {
        Game2.getInstance().drawRect({
          x: this.blinkerX,
          y: this.y + 4,
          width: 2,
          height: this.height - 8,
          color: "black",
          fill: true,
          canvasContext
        });
      }
      Game2.getInstance().drawText(
        {
          text: this.text,
          font: this.font,
          color: "black",
          x: this.x,
          y: this.y + this.height / 2 - this.textHeight / 2
        },
        canvasContext
      );
    }
    setSelected(selected) {
      if (selected && !this.selected) {
        this.selected = true;
        this.shouldBlink = true;
        this.blinkInterval = setInterval(() => {
          this.shouldBlink = !this.shouldBlink;
        }, 500);
      } else if (!selected && this.selected) {
        this.selected = false;
        this.shouldBlink = false;
        clearInterval(this.blinkInterval);
      }
    }
    getText() {
      return this.text;
    }
    setText(text) {
      this.text = text;
      const { width } = Game2.getInstance().measureText(this.text, this.font);
      this.blinkerX = this.x + 2 + width;
    }
  };

  // wsf:src/openciv-src/client/src/scene/SceneBackground
  var SceneBackground = class {
    static generateOcean() {
      let tileActors = [];
      for (let y = -1; y < (Game2.getInstance().getHeight() + 24) / 24; y++) {
        for (let x = -1; x < (Game2.getInstance().getWidth() + 32) / 32; x++) {
          let yPos = y * 24;
          let xPos = x * 32;
          if (y % 2 != 0) {
            xPos += 16;
          }
          tileActors.push(
            new Actor({
              image: Game2.getInstance().getImage(4 /* SPRITESHEET */),
              spriteRegion: "5,8" /* OCEAN */,
              x: xPos,
              y: yPos,
              width: 32,
              height: 32
            })
          );
        }
      }
      return Actor.mergeActors({
        actors: tileActors,
        spriteRegion: true,
        spriteSize: 32
      });
    }
    static generateRandomGrassland() {
      let tileActors = [];
      for (let y = -1; y < (Game2.getInstance().getHeight() + 24) / 24; y++) {
        for (let x = -1; x < (Game2.getInstance().getWidth() + 32) / 32; x++) {
          let yPos = y * 24;
          let xPos = x * 32;
          if (y % 2 != 0) {
            xPos += 16;
          }
          tileActors.push(
            new Actor({
              image: Game2.getInstance().getImage(4 /* SPRITESHEET */),
              spriteRegion: Numbers2.safeRandom() < 0.1 ? "4,6" /* GRASS_HILL */ : "3,6" /* GRASS */,
              x: xPos,
              y: yPos,
              width: 32,
              height: 32
            })
          );
        }
      }
      for (let y = -1; y < (Game2.getInstance().getHeight() + 24) / 24; y++) {
        for (let x = -1; x < (Game2.getInstance().getWidth() + 32) / 32; x++) {
          let yPos = y * 24;
          let xPos = x * 32;
          if (y % 2 != 0) {
            xPos += 16;
          }
          if (Numbers2.safeRandom() > 0.02) continue;
          tileActors.push(
            new Actor({
              image: Game2.getInstance().getImage(4 /* SPRITESHEET */),
              spriteRegion: Object.values(SpriteRegion)[Math.floor(Numbers2.safeRandom() * 9)],
              x: xPos,
              y: yPos,
              width: 32,
              height: 32
            })
          );
        }
      }
      return Actor.mergeActors({
        actors: tileActors,
        spriteRegion: true,
        spriteSize: 32
      });
    }
  };

  // wsf:src/openciv-src/client/src/scene/type/JoinGameScene
  var JoinGameScene = class extends Scene {
    constructor() {
      super(...arguments);
      __publicField(this, "serverTextBox");
      __publicField(this, "isConnecting", false);
    }
    onInitialize() {
      super.onInitialize();
      this.addActor(SceneBackground.generateRandomGrassland());
      const backgroundActor = new Actor({
        image: Game2.getInstance().getImage(6 /* POPUP_BOX */),
        x: Game2.getInstance().getWidth() / 2 - 600 / 2,
        y: Game2.getInstance().getHeight() / 2 - 500 / 2,
        width: 600,
        height: 500,
        cornerSize: 20,
        nineSlice: true
      });
      this.addActor(backgroundActor);
      this.serverTextBox = new TextBox({
        x: Game2.getInstance().getWidth() / 2 - 400 / 2,
        y: Game2.getInstance().getHeight() / 2 - 100,
        width: 400,
        height: 50
      });
      this.serverTextBox.setSelected(true);
      this.serverTextBox.setText("localhost");
      this.addActor(this.serverTextBox);
      const infoLabel = new Label({
        text: "Enter server IP:",
        font: "24px serif",
        fontColor: "white"
      });
      infoLabel.conformSize().then(() => {
        infoLabel.setPosition(
          Game2.getInstance().getWidth() / 2 - infoLabel.getWidth() / 2,
          this.serverTextBox.getY() - 30
        );
        this.addActor(infoLabel);
      });
      const joinButton = new Button({
        text: "Join",
        x: Game2.getInstance().getWidth() / 2 - 242 / 2,
        y: Game2.getInstance().getHeight() / 2 - 25,
        width: 242,
        height: 62,
        fontColor: "white",
        onClicked: () => {
          if (this.isConnecting) return;
          this.isConnecting = true;
          infoLabel.setText("Connecting...", true);
          infoLabel.conformSize().then(() => {
            infoLabel.setPosition(
              Game2.getInstance().getWidth() / 2 - infoLabel.getWidth() / 2,
              this.serverTextBox.getY() - 30
            );
          });
          WebsocketClient.init(this.serverTextBox.getText());
        }
      });
      this.addActor(joinButton);
      this.addActor(
        new Button({
          text: "Server List",
          x: Game2.getInstance().getWidth() / 2 - 242 / 2 - 150,
          y: Game2.getInstance().getHeight() / 2 + 150,
          width: 242,
          height: 62,
          fontColor: "white",
          onClicked: () => {
          }
        })
      );
      this.addActor(
        new Button({
          text: "Back",
          x: Game2.getInstance().getWidth() / 2 - 242 / 2 + 150,
          y: Game2.getInstance().getHeight() / 2 + 150,
          width: 242,
          height: 62,
          fontColor: "white",
          onClicked: () => {
            Game2.getInstance().setScene("main_menu");
          }
        })
      );
      NetworkEvents.on({
        eventName: "websocketError",
        parentObject: this,
        callback: (data) => {
          this.isConnecting = false;
          infoLabel.setText("Connection Failed.", true);
          infoLabel.conformSize().then(() => {
            infoLabel.setPosition(
              Game2.getInstance().getWidth() / 2 - infoLabel.getWidth() / 2,
              this.serverTextBox.getY() - 30
            );
          });
        }
      });
      NetworkEvents.on({
        eventName: "connected",
        parentObject: this,
        callback: () => {
          this.isConnecting = false;
        }
      });
      NetworkEvents.on({
        eventName: "messageBox",
        parentObject: this,
        callback: (data) => {
          const messageName = data["messageName"];
          if (messageName === "gameInProgress") {
            infoLabel.setText("Connection Failed: Game in progress.");
            infoLabel.conformSize().then(() => {
              infoLabel.setPosition(
                Game2.getInstance().getWidth() / 2 - infoLabel.getWidth() / 2,
                this.serverTextBox.getY() - 30
              );
            });
          }
        }
      });
    }
    redraw() {
      const oldText = this.serverTextBox.getText();
      super.redraw();
      this.serverTextBox.setText(oldText);
    }
  };

  // wsf:src/openciv-src/client/src/scene/type/LoadingScene
  var LoadingScene = class extends Scene {
    onInitialize() {
      super.onInitialize();
      this.addActor(SceneBackground.generateRandomGrassland());
      const loadingLabel = new Label({
        text: "Loading Map...",
        font: "bold 22px arial",
        fontColor: "white",
        shadowColor: "black",
        lineWidth: 4,
        shadowBlur: 20
      });
      loadingLabel.conformSize().then(() => {
        loadingLabel.setPosition(
          Game2.getInstance().getWidth() / 2 - loadingLabel.getWidth() / 2,
          Game2.getInstance().getHeight() / 2 - loadingLabel.getHeight() / 2
        );
      });
      this.addActor(loadingLabel);
    }
  };

  // wsf:src/openciv-src/client/src/ui/SelectCivilizationGroup
  var SelectCivilizationGroup = class extends ActorGroup {
    constructor(x, y, width, height) {
      super({
        x,
        y,
        width,
        height
      });
      __publicField(this, "titleLabel");
      __publicField(this, "selectCivActors");
      __publicField(this, "civInformationActors");
      this.selectCivActors = [];
      this.civInformationActors = [];
      this.addActor(
        new Actor({
          image: Game2.getInstance().getImage(6 /* POPUP_BOX */),
          x: this.x,
          y: this.y,
          width: this.width,
          height: this.height,
          nineSlice: true,
          cornerSize: 20
        })
      );
      this.listAvailableCivs();
      NetworkEvents.on({
        eventName: "availableCivs",
        parentObject: this,
        callback: (data) => {
          let xOffsset = 0;
          let yOffset = 1;
          for (const civJSON of data["civs"]) {
            let iconX = this.x + 68 * xOffsset + 14;
            if (iconX + 64 > this.x + this.width) {
              iconX = this.x + 68 * (xOffsset = 0) + 14;
              yOffset++;
            }
            let iconY = this.y + 68 * yOffset;
            const selectCivButton = new Button({
              icon: SpriteRegion[civJSON["icon_name"]],
              iconOnly: true,
              x: iconX,
              y: iconY,
              width: 64,
              height: 64,
              onClicked: () => {
                WebsocketClient.sendMessage({
                  event: "civInfo",
                  name: civJSON["name"]
                });
              },
              onMouseEnter: () => {
                console.log("Mouse enter");
              }
            });
            this.selectCivActors.push(selectCivButton);
            this.addActor(selectCivButton);
            xOffsset++;
          }
        }
      });
      NetworkEvents.on({
        eventName: "civInfo",
        parentObject: this,
        callback: (data) => {
          this.displayCivInformation(data);
        }
      });
      NetworkEvents.on({
        eventName: "selectCiv",
        parentObject: this,
        callback: () => {
          Game2.getInstance().getCurrentScene().removeActor(this);
        }
      });
    }
    listAvailableCivs() {
      for (const actor of this.civInformationActors) {
        this.removeActor(actor);
      }
      const titleText = "Select a Civilization";
      if (!this.titleLabel) {
        this.titleLabel = new Label({
          text: "Select a Civilization",
          font: "20px serif",
          fontColor: "white"
        });
        this.addActor(this.titleLabel);
      } else {
        this.titleLabel.setText(titleText);
      }
      this.titleLabel.conformSize().then(() => {
        this.titleLabel.setPosition(this.x + this.width / 2 - this.titleLabel.getWidth() / 2, this.y + 12);
      });
      const closeButton = new Button({
        text: "Close",
        x: this.x + this.width / 2 - 150 / 2,
        y: this.y + this.height - 60,
        width: 150,
        height: 50,
        fontColor: "white",
        onClicked: () => {
          Game2.getInstance().getCurrentScene().removeActor(this);
        }
      });
      this.selectCivActors.push(closeButton);
      this.addActor(closeButton);
      WebsocketClient.sendMessage({ event: "availableCivs" });
    }
    async displayCivInformation(data) {
      this.titleLabel.setText(data["name"]);
      this.titleLabel.conformSize().then(() => {
        this.titleLabel.setPosition(this.x + this.width / 2 - this.titleLabel.getWidth() / 2, this.y + 12);
      });
      for (const actor of this.selectCivActors) {
        this.removeActor(actor);
      }
      const civIcon = new Actor({
        image: Game2.getInstance().getImage(4 /* SPRITESHEET */),
        spriteRegion: SpriteRegion[data["icon_name"]],
        x: this.x + this.width / 2 - 32 / 2,
        y: this.y + 40,
        width: 32,
        height: 32
      });
      this.addActor(civIcon);
      this.civInformationActors.push(civIcon);
      const informationLabels = [];
      const startBiasLabel = new Label({
        text: data["start_bias_desc"],
        font: "20px serif",
        fontColor: "white",
        x: this.x + 12,
        y: this.y + 80
      });
      await startBiasLabel.conformSize();
      this.civInformationActors.push(startBiasLabel);
      informationLabels.push(startBiasLabel);
      this.addActor(startBiasLabel);
      const uniqueUnitDescLabel = new Label({
        text: "Unique Units:",
        font: "bold 20px serif",
        fontColor: "white",
        x: this.x + 12,
        y: startBiasLabel.getY() + startBiasLabel.getHeight() + 30,
        maxWidth: this.width - 12
      });
      await uniqueUnitDescLabel.conformSize();
      this.civInformationActors.push(uniqueUnitDescLabel);
      this.addActor(uniqueUnitDescLabel);
      for (const uniqueUnitDesc of data["unique_unit_descs"]) {
        const lastLabel2 = this.civInformationActors[this.civInformationActors.length - 1];
        const unitLabel = new Label({
          text: "* " + uniqueUnitDesc,
          font: "20px serif",
          fontColor: "white",
          x: this.x + 12,
          y: lastLabel2.getY() + lastLabel2.getHeight() + 5,
          maxWidth: this.width - 12
        });
        await unitLabel.conformSize();
        this.civInformationActors.push(unitLabel);
        this.addActor(unitLabel);
      }
      if ("unique_building_descs" in data) {
        const lastLabel2 = this.civInformationActors[this.civInformationActors.length - 1];
        const uniqueBuildingsDescLabel = new Label({
          text: "Unique Buildings:",
          font: "bold 20px serif",
          fontColor: "white",
          x: this.x + 12,
          y: lastLabel2.getY() + lastLabel2.getHeight() + 30,
          maxWidth: this.width - 12
        });
        await uniqueBuildingsDescLabel.conformSize();
        this.civInformationActors.push(uniqueBuildingsDescLabel);
        this.addActor(uniqueBuildingsDescLabel);
        for (const buildingDesc of data["unique_building_descs"]) {
          const lastLabel3 = this.civInformationActors[this.civInformationActors.length - 1];
          const abilityLabel = new Label({
            text: "* " + buildingDesc,
            font: "20px serif",
            fontColor: "white",
            x: this.x + 12,
            y: lastLabel3.getY() + lastLabel3.getHeight() + 5,
            maxWidth: this.width - 12
          });
          await abilityLabel.conformSize();
          this.civInformationActors.push(abilityLabel);
          this.addActor(abilityLabel);
        }
      }
      const lastLabel = this.civInformationActors[this.civInformationActors.length - 1];
      const uniqueAbilityDescLabel = new Label({
        text: "Special Abilities:",
        font: "bold 20px serif",
        fontColor: "white",
        x: this.x + 12,
        y: lastLabel.getY() + lastLabel.getHeight() + 30,
        maxWidth: this.width - 12
      });
      await uniqueAbilityDescLabel.conformSize();
      this.civInformationActors.push(uniqueAbilityDescLabel);
      this.addActor(uniqueAbilityDescLabel);
      for (const abilityDesc of data["ability_descs"]) {
        const lastLabel2 = this.civInformationActors[this.civInformationActors.length - 1];
        const abilityLabel = new Label({
          text: "* " + abilityDesc,
          font: "20px serif",
          fontColor: "white",
          x: this.x + 12,
          y: lastLabel2.getY() + lastLabel2.getHeight() + 5,
          maxWidth: this.width - 12
        });
        await abilityLabel.conformSize();
        this.civInformationActors.push(abilityLabel);
        this.addActor(abilityLabel);
      }
      const selectButton = new Button({
        text: "Select",
        fontColor: "white",
        x: this.x + this.width / 2 - 100 - 150 / 2,
        y: this.y + this.height - 60,
        width: 150,
        height: 50,
        onClicked: () => {
          WebsocketClient.sendMessage({ event: "selectCiv", name: data["name"] });
        }
      });
      this.civInformationActors.push(selectButton);
      this.addActor(selectButton);
      const backButton = new Button({
        text: "Back",
        fontColor: "white",
        x: this.x + this.width / 2 + 100 - 150 / 2,
        y: this.y + this.height - 60,
        width: 150,
        height: 50,
        onClicked: () => {
          this.listAvailableCivs();
        }
      });
      this.civInformationActors.push(backButton);
      this.addActor(backButton);
    }
    onDestroyed() {
      super.onDestroyed();
      NetworkEvents.removeCallbacksByParentObject(this);
    }
  };

  // wsf:src/openciv-src/client/src/scene/type/LobbyScene
  var LobbyScene = class extends Scene {
    constructor() {
      super(...arguments);
      __publicField(this, "selectCivGroup");
    }
    onInitialize() {
      super.onInitialize();
      this.addActor(SceneBackground.generateRandomGrassland());
      const playerList = new ListBox({
        x: Game2.getInstance().getWidth() / 2 - 600 / 2,
        y: 35,
        width: 600,
        height: Game2.getInstance().getHeight() - 275,
        rowHeight: 50,
        textFont: "20px serif",
        fontColor: "white"
      });
      this.addActor(playerList);
      this.addActor(
        new Button({
          text: "Select Civilization",
          x: Game2.getInstance().getWidth() / 2 - 282 / 2,
          y: playerList.getY() + playerList.getHeight() + 10,
          width: 282,
          height: 62,
          fontColor: "white",
          onClicked: () => {
            if (this.hasActor(this.selectCivGroup)) {
              return;
            }
            console.log("Choose civilization");
            if (!this.selectCivGroup || !this.hasActor(this.selectCivGroup)) {
              this.selectCivGroup = new SelectCivilizationGroup(
                playerList.getX() + playerList.getWidth() / 2 - 432 / 2,
                Game2.getInstance().getHeight() / 2 - 440 / 2,
                432,
                440
              );
              this.addActor(this.selectCivGroup);
            } else {
              this.removeActor(this.selectCivGroup);
            }
          },
          disableHoverWhen: () => {
            return this.hasActor(this.selectCivGroup);
          }
        })
      );
      this.addActor(
        new Button({
          text: "Ready Up",
          x: Game2.getInstance().getWidth() / 2 - 282 / 2,
          y: playerList.getY() + playerList.getHeight() + 75,
          width: 282,
          height: 62,
          fontColor: "white",
          onClicked: () => {
            if (this.hasActor(this.selectCivGroup)) {
              return;
            }
            WebsocketClient.sendMessage({ event: "setState", state: "in_game" });
          },
          disableHoverWhen: () => {
            return this.hasActor(this.selectCivGroup);
          }
        })
      );
      this.addActor(
        new Button({
          text: "Back",
          x: Game2.getInstance().getWidth() / 2 - 282 / 2,
          y: playerList.getY() + playerList.getHeight() + 140,
          width: 282,
          height: 62,
          fontColor: "white",
          onClicked: () => {
            if (this.hasActor(this.selectCivGroup)) {
              return;
            }
            Game2.getInstance().setScene("join_game");
          },
          disableHoverWhen: () => {
            return this.hasActor(this.selectCivGroup);
          }
        })
      );
      this.updatePlayerList();
      NetworkEvents.on({
        eventName: "playerJoin",
        parentObject: this,
        callback: this.updatePlayerList
      });
      NetworkEvents.on({
        eventName: "playerQuit",
        parentObject: this,
        callback: this.updatePlayerList
      });
      NetworkEvents.on({
        eventName: "playerLeave",
        parentObject: this,
        callback: this.updatePlayerList
      });
      NetworkEvents.on({
        eventName: "connectedPlayers",
        parentObject: this,
        callback: (data) => {
          const players = data["players"];
          const requestingName = data["requestingName"];
          playerList.clearRows();
          for (let i = 0; i < players.length; i++) {
            const playerName = players[i]["name"];
            let civIcon = "2,11" /* UNKNOWN_ICON */;
            if ("civData" in players[i]) {
              civIcon = SpriteRegion[players[i]["civData"]["icon_name"]];
            }
            const currentRow = playerList.addRow({
              text: playerName
            });
            currentRow.addActor(
              new Actor({
                image: Game2.getInstance().getImage(4 /* SPRITESHEET */),
                spriteRegion: civIcon,
                x: currentRow.getX() + 8,
                y: currentRow.getY() - 32 / 2 + currentRow.getHeight() / 2,
                width: 32,
                height: 32
              })
            );
            if (playerName === requestingName) {
              currentRow.addActor(
                new Actor({
                  image: Game2.getInstance().getImage(4 /* SPRITESHEET */),
                  spriteRegion: "0,3" /* STAR */,
                  x: currentRow.getX() + currentRow.getWidth() - 32 - 8,
                  y: currentRow.getY() - 32 / 2 + currentRow.getHeight() / 2,
                  width: 32,
                  height: 32
                })
              );
            }
            currentRow.conformLabelSize().then(() => {
              currentRow.setLabelPosition(
                currentRow.getX() + 48,
                currentRow.getY() + currentRow.getHeight() / 2 - currentRow.getLabel().getHeight() / 2
              );
            });
          }
        }
      });
      NetworkEvents.on({
        eventName: "selectCiv",
        parentObject: this,
        callback: (data) => {
          for (const row of playerList.getRows()) {
            if (row.getLabel().getText() !== data["playerName"]) {
              continue;
            }
            for (const rowActor of row.getActors()) {
              if (rowActor.getSpriteRegion() === "0,3" /* STAR */) {
                continue;
              }
              rowActor.setSpriteRegion(SpriteRegion[data["civData"]["icon_name"]]);
            }
          }
        }
      });
    }
    onDestroyed(newScene) {
      const exitReceipt = super.onDestroyed(newScene);
      if (newScene.getName() !== "loading_scene" && newScene.getName() !== "lobby") {
        WebsocketClient.disconnect();
      }
      return exitReceipt;
    }
    updatePlayerList() {
      WebsocketClient.sendMessage({ event: "connectedPlayers" });
    }
  };

  // wsf:src/openciv-src/client/src/scene/type/MainMenuScene
  var MainMenuScene = class extends Scene {
    onInitialize() {
      super.onInitialize();
      this.addActor(SceneBackground.generateRandomGrassland());
      const titleLabel = new Label({
        text: "Open Civilization",
        font: "bold 97px arial",
        fontColor: "white",
        shadowColor: "black",
        lineWidth: 4,
        shadowBlur: 20
      });
      titleLabel.conformSize().then(() => {
        titleLabel.setPosition(Game2.getInstance().getWidth() / 2 - titleLabel.getWidth() / 2, Game2.getInstance().getHeight() / 3 - 75);
      });
      this.addActor(titleLabel);
      this.addActor(
        new Button({
          text: "Play",
          x: Game2.getInstance().getWidth() / 2 - 242 / 2,
          y: Game2.getInstance().getHeight() / 3 + 68,
          width: 242,
          height: 62,
          fontColor: "white",
          onClicked: () => {
            Game2.getInstance().setScene("join_game");
          }
        })
      );
      this.addActor(
        new Button({
          text: "Options",
          x: Game2.getInstance().getWidth() / 2 - 242 / 2,
          y: Game2.getInstance().getHeight() / 3 + 136,
          width: 242,
          height: 62,
          fontColor: "white",
          onClicked: () => {
            console.log("options scene");
          }
        })
      );
    }
  };

  // wsf:src/openciv-src/client/src/Index
  Game2.createInstance({ assetList, canvasColor: "gray" }, () => {
    Game2.getInstance().addScene("main_menu", new MainMenuScene());
    Game2.getInstance().addScene("join_game", new JoinGameScene());
    Game2.getInstance().addScene("lobby", new LobbyScene());
    Game2.getInstance().addScene("in_game", new InGameScene());
    Game2.getInstance().addScene("loading_scene", new LoadingScene());
    Game2.getInstance().setScene("main_menu");
  });
})();
