// src/roadmap.js — machine-readable copy of the roadmap in main.pjs.
// Keeps the hidden Roadmap debug UI (index.html) in sync with the task
// checklist in main.pjs. Regenerate from main.pjs whenever tasks change
// (parse the `// N. [ ]/ [x] **Title**: desc` comment lines).
window.ROADMAP = {
  "phases": [
    {
      "number": 1,
      "name": "Framework & Branding",
      "tasks": [
        {
          "num": 1,
          "done": true,
          "title": "Bootstrap Project Structure",
          "desc": "Create `main.pjs` for state/config and `index.html` for layout; initialize a canvas 2D context with a fixed 224x256 resolution scaled to fit window."
        },
        {
          "num": 2,
          "done": true,
          "title": "Render Loop",
          "desc": "Implement a `requestAnimationFrame` loop in `src/game.js` that clears the canvas to `#000033` (dark blue) and logs \"Frame Rendered\" to console."
        },
        {
          "num": 3,
          "done": true,
          "title": "Roadmap Checklist",
          "desc": "Implement a hidden debug UI in `index.html` that lists all roadmap tasks, allowing the agent to mark them complete via `localStorage`."
        },
        {
          "num": 4,
          "done": true,
          "title": "Input Manager",
          "desc": "Create a keyboard listener mapping `ArrowLeft`, `ArrowRight`, `ArrowUp`, `ArrowDown`, and `Space` (Jump) to a `keys` state object."
        },
        {
          "num": 5,
          "done": true,
          "title": "Visual Test Harness",
          "desc": "Draw a 16x16 red square (Player proxy) and a 16x16 blue rectangle (Platform proxy) to verify coordinates and rendering scale."
        }
      ]
    },
    {
      "number": 2,
      "name": "Core Physics & Player Movement",
      "tasks": [
        {
          "num": 6,
          "done": true,
          "title": "Player State Machine",
          "desc": "Implement `Player` class with states: `IDLE`, `WALKING`, `CLIMBING`, `JUMPING`, `DYING`."
        },
        {
          "num": 7,
          "done": true,
          "title": "Horizontal Movement",
          "desc": "Implement left/right movement with acceleration/friction and collision detection against canvas edges."
        },
        {
          "num": 8,
          "done": true,
          "title": "Gravity & Jumping",
          "desc": "Implement a jump arc using a vertical velocity variable; verify Mario can jump and land on a static platform."
        },
        {
          "num": 9,
          "done": true,
          "title": "Ladder Logic",
          "desc": "Implement \"Ladder Zones\" where `ArrowUp`/`ArrowDown` allows the player to transition between vertical levels."
        },
        {
          "num": 10,
          "done": true,
          "title": "Ladder Edge Grabbing",
          "desc": "Implement logic to snap the player to the top of a ladder if they overlap the top edge while falling."
        },
        {
          "num": 11,
          "done": true,
          "title": "Fall Logic",
          "desc": "Implement \"hole\" detection in platforms (ladders) allowing the player to fall through to the level below."
        }
      ]
    },
    {
      "number": 3,
      "name": "Screen 1 Architecture (25m)",
      "tasks": [
        {
          "num": 12,
          "done": true,
          "title": "Girder Layout",
          "desc": "Define a data array for Screen 1: 5 girders with specific x/y coordinates and slight clockwise rotations (slopes)."
        },
        {
          "num": 13,
          "done": true,
          "title": "Procedural Girders",
          "desc": "Render girders as cyan lines (`#00FFFF`) with small grey circles for rivets."
        },
        {
          "num": 14,
          "done": true,
          "title": "Ladder Rendering",
          "desc": "Render ladders as sets of parallel vertical lines connecting the girders."
        },
        {
          "num": 15,
          "done": true,
          "title": "Barrel Spawner",
          "desc": "Implement a `Barrel` class and a spawner at the top-left (Donkey Kong's position) that pushes barrels into a queue."
        },
        {
          "num": 16,
          "done": true,
          "title": "Barrel Physics",
          "desc": "Implement barrel rolling: move horizontally, detect girder collisions, and \"fall\" through ladder gaps."
        },
        {
          "num": 17,
          "done": true,
          "title": "Ramp Deflection",
          "desc": "Implement logic where barrels hitting a sloped girder change direction to roll down to the next level."
        },
        {
          "num": 18,
          "done": true,
          "title": "Barrel-Player Collision",
          "desc": "Implement a hitbox check; if player touches barrel without Hammer, trigger `DYING` state."
        }
      ]
    },
    {
      "number": 4,
      "name": "Items, Power-ups & Scoring",
      "tasks": [
        {
          "num": 19,
          "done": true,
          "title": "Score HUD",
          "desc": "Create a top-bar UI showing `SCORE`, `HI-SCORE`, and `LIVES` (initialized to 3)."
        },
        {
          "num": 20,
          "done": true,
          "title": "Collectibles",
          "desc": "Spawn the Hat, Handbag, and Parasol at fixed coordinates on Screen 1; implement collision and point addition."
        },
        {
          "num": 21,
          "done": true,
          "title": "Hammer Power-up",
          "desc": "Implement a Hammer spawn timer; when collected, player state changes to `HAMMER_MODE` for 5 seconds."
        },
        {
          "num": 22,
          "done": true,
          "title": "Hammer Combat",
          "desc": "In `HAMMER_MODE`, player can destroy barrels on contact (500 pts) instead of dying."
        },
        {
          "num": 23,
          "done": true,
          "title": "Jump Scoring",
          "desc": "Implement logic to award 100 points when a barrel's X-position is passed by a jumping player."
        },
        {
          "num": 24,
          "done": true,
          "title": "Pauline & Win Condition",
          "desc": "Place Pauline at the top; colliding with her triggers \"Level Clear\" and 5000 points."
        }
      ]
    },
    {
      "number": 5,
      "name": "Fireballs & Hazards",
      "tasks": [
        {
          "num": 25,
          "done": true,
          "title": "Fireball Spawner",
          "desc": "Implement a spawner at the oil cans on Screen 1."
        },
        {
          "num": 26,
          "done": true,
          "title": "Fireball AI",
          "desc": "Fireballs move horizontally, climb ladders randomly, and patrol girders."
        },
        {
          "num": 27,
          "done": true,
          "title": "Fireball Evolution",
          "desc": "Implement a timer where fireballs turn blue (increased speed/points) after a set duration."
        },
        {
          "num": 28,
          "done": true,
          "title": "Fireball Collision",
          "desc": "Implement death trigger upon contact with fireballs."
        }
      ]
    },
    {
      "number": 6,
      "name": "Screen 2 - Conveyor Belts",
      "tasks": [
        {
          "num": 29,
          "done": true,
          "title": "Conveyor belt logic",
          "desc": "Implement movement modifiers that push the player left or right based on belt direction."
        },
        {
          "num": 30,
          "done": true,
          "title": "Screen 2 layout",
          "desc": "Define the platform and belt positions for the 50m mark."
        },
        {
          "num": 31,
          "done": true,
          "title": "Barrel spawning",
          "desc": "Implement barrel spawners specific to Screen 2."
        },
        {
          "num": 32,
          "done": true,
          "title": "Collision refinement",
          "desc": "Ensure player/barrel interactions remain consistent on moving belts."
        },
        {
          "num": 33,
          "done": true,
          "title": "Screen transition",
          "desc": "Implement the trigger to move from Screen 1 to Screen 2."
        },
        {
          "num": 34,
          "done": true,
          "title": "Screen 2 win condition",
          "desc": "Define the trigger to advance to Screen 3."
        }
      ]
    },
    {
      "number": 7,
      "name": "Screen 3 - Elevators & Oil",
      "tasks": [
        {
          "num": 35,
          "done": true,
          "title": "Elevator base class",
          "desc": "Create a system for platforms that move vertically between two set points."
        },
        {
          "num": 36,
          "done": true,
          "title": "Blue elevators",
          "desc": "Implement platforms that move up/down on a set timer."
        },
        {
          "num": 37,
          "done": true,
          "title": "Pink elevators",
          "desc": "Implement platforms that move up/down with a different timing/offset."
        },
        {
          "num": 38,
          "done": true,
          "title": "Player riding logic",
          "desc": "Ensure player stays pinned to the platform while it moves."
        },
        {
          "num": 39,
          "done": true,
          "title": "Oil can fire",
          "desc": "Implement fire hazard entities at the bottom of the screen."
        },
        {
          "num": 40,
          "done": true,
          "title": "Item spawning",
          "desc": "Place collectable items throughout the elevator shafts."
        },
        {
          "num": 41,
          "done": true,
          "title": "Item collection logic",
          "desc": "Implement score increase and visual feedback for collected items."
        },
        {
          "num": 42,
          "done": true,
          "title": "Screen 3 layout",
          "desc": "Finalize the spatial arrangement of elevators and hazards."
        },
        {
          "num": 43,
          "done": true,
          "title": "Screen transition",
          "desc": "Implement the trigger to move from Screen 2 to Screen 3."
        }
      ]
    },
    {
      "number": 8,
      "name": "Screen 4 - The Rivets",
      "tasks": [
        {
          "num": 44,
          "done": true,
          "title": "Rivet entity",
          "desc": "Create a \"Rivet\" object that can be toggled between active and removed."
        },
        {
          "num": 45,
          "done": true,
          "title": "Rivet trigger",
          "desc": "Implement logic where stepping on a rivet removes it from the game world."
        },
        {
          "num": 46,
          "done": true,
          "title": "Rivet tracking",
          "desc": "Create a counter to track how many rivets remain on the screen."
        },
        {
          "num": 47,
          "done": true,
          "title": "Structure collapse logic",
          "desc": "Implement a \"collapse\" state that triggers when all rivets are removed."
        },
        {
          "num": 48,
          "done": true,
          "title": "Collapse animation",
          "desc": "Create a visual sequence where the platforms fall away."
        },
        {
          "num": 49,
          "done": true,
          "title": "Screen 4 layout",
          "desc": "Design the rivet-based structure."
        },
        {
          "num": 50,
          "done": true,
          "title": "Level Win trigger",
          "desc": "Implement the final victory state upon structure collapse."
        },
        {
          "num": 51,
          "done": true,
          "title": "Screen transition",
          "desc": "Implement the trigger to move from Screen 3 to Screen 4."
        }
      ]
    },
    {
      "number": 9,
      "name": "Game Flow & UI",
      "tasks": [
        {
          "num": 52,
          "done": true,
          "title": "Title Screen",
          "desc": "Create the main menu with \"Start Game\" and \"Instructions\"."
        },
        {
          "num": 53,
          "done": true,
          "title": "Game State Manager",
          "desc": "Implement transitions between Title -> Gameplay -> Game Over -> Victory."
        },
        {
          "num": 54,
          "done": true,
          "title": "2-Player Setup",
          "desc": "Add logic for a second player (input mapping and spawn)."
        },
        {
          "num": 55,
          "done": true,
          "title": "Player 2 collisions",
          "desc": "Ensure P2 interacts correctly with all screen mechanics."
        },
        {
          "num": 56,
          "done": true,
          "title": "Lives/Score System",
          "desc": "Implement a global tracker for lives and total score."
        },
        {
          "num": 57,
          "done": true,
          "title": "Death/Respawn",
          "desc": "Handle player death and resetting the current screen."
        },
        {
          "num": 58,
          "done": true,
          "title": "HUD",
          "desc": "Create an on-screen display for current score and player lives."
        }
      ]
    },
    {
      "number": 10,
      "name": "Audio & Polish",
      "tasks": [
        {
          "num": 59,
          "done": true,
          "title": "Sound Engine",
          "desc": "Implement a basic audio manager for SFX."
        },
        {
          "num": 60,
          "done": true,
          "title": "BGM",
          "desc": "Add looping background music tracks for the level."
        },
        {
          "num": 61,
          "done": true,
          "title": "SFX - Movement",
          "desc": "Add sounds for jumping and walking."
        },
        {
          "num": 62,
          "done": true,
          "title": "SFX - Combat",
          "desc": "Add sounds for barrel collisions and rivet removals."
        },
        {
          "num": 63,
          "done": true,
          "title": "SFX - UI",
          "desc": "Add sounds for menu navigation and game over."
        },
        {
          "num": 64,
          "done": true,
          "title": "Visual Polish",
          "desc": "Add screen shake or particle effects for the rivet collapse."
        },
        {
          "num": 65,
          "done": true,
          "title": "Final Balancing",
          "desc": "Tune movement speeds and barrel spawn rates across all 4 screens."
        },
        {
          "num": 66,
          "done": true,
          "title": "End-to-End Test",
          "desc": "Conduct a full playthrough from title screen to the final rivet."
        }
      ]
    }
  ]
};
