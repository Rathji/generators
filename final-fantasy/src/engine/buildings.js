// Task #50: BuildingSystem — resolves town-door to interior-map links and
// registers them as first-class transitions.

export class BuildingSystem {
  constructor(buildings = {}) {
    this.buildings = buildings;
  }

  buildingsFor(townId) {
    return [...(this.buildings[townId] ?? [])];
  }

  buildingAt(townId, x, y) {
    return this.buildingsFor(townId).find((b) => b.door.x === x && b.door.y === y) ?? null;
  }

  buildingById(id) {
    for (const list of Object.values(this.buildings)) {
      const b = list.find((x) => x.id === id);
      if (b) return b;
    }
    return null;
  }

  // Enter a building from a town door tile.
  enter(townId, x, y) {
    const b = this.buildingAt(townId, x, y);
    if (!b) return null;
    return {
      building: b.id,
      name: b.name,
      town: townId,
      mapId: b.interior.mapId,
      x: b.interior.x,
      y: b.interior.y,
      facing: b.interior.facing ?? "N",
    };
  }

  // Leave an interior map back to its town doorstep.
  exit(interiorMapId) {
    for (const [town, list] of Object.entries(this.buildings)) {
      for (const b of list) {
        if (b.interior.mapId === interiorMapId) {
          return {
            building: b.id,
            name: b.name,
            town,
            mapId: town,
            x: b.door.x,
            y: b.door.y,
            facing: b.exit.facing ?? "S",
          };
        }
      }
    }
    return null;
  }

  interiorOf(townId, x, y) {
    return this.buildingAt(townId, x, y)?.interior.mapId ?? null;
  }

  townOfInterior(interiorMapId) {
    return this.exit(interiorMapId)?.town ?? null;
  }

  // The interior tile the player must step on to leave this interior.
  exitTile(interiorMapId) {
    for (const [town, list] of Object.entries(this.buildings)) {
      for (const b of list) {
        if (b.interior.mapId === interiorMapId) {
          return { x: b.exit.x, y: b.exit.y, building: b.id, town };
        }
      }
    }
    return null;
  }

  // Register every door as a TransitionManager link (both directions).
  registerTransitions(transitions) {
    for (const [town, list] of Object.entries(this.buildings)) {
      for (const b of list) {
        transitions.addLink({
          fromMap: town,
          fromX: b.door.x,
          fromY: b.door.y,
          toMap: b.interior.mapId,
          toX: b.interior.x,
          toY: b.interior.y,
          facing: b.interior.facing ?? "N",
        });
        transitions.addLink({
          fromMap: b.interior.mapId,
          fromX: b.exit.x,
          fromY: b.exit.y,
          toMap: town,
          toX: b.door.x,
          toY: b.door.y,
          facing: b.exit.facing ?? "S",
        });
      }
    }
    return this;
  }
}
