#!/usr/bin/env node

const fs = require("fs");

// ============================================================
// Seeded random number generator
// ============================================================

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================
// PolyTrack part IDs
// ============================================================

const PART_IDS = {
  Straight: 0,
  TurnSharp: 1,
  SlopeUp: 2,
  SlopeDown: 3,
  Slope: 4,
  Start: 5,
  Finish: 6,
  Turn: 7,
  TurnWide: 8,
  StraightLong: 9,
  StraightWide: 10,
  Checkpoint: 52,
};

// ============================================================
// Directions
// ============================================================

const DIRS = [
  { name: "E", dx: 1, dz: 0 },
  { name: "S", dx: 0, dz: 1 },
  { name: "W", dx: -1, dz: 0 },
  { name: "N", dx: 0, dz: -1 },
];

function directionIndex(name) {
  return DIRS.findIndex(d => d.name === name);
}

function oppositeDirection(dir) {
  return (dir + 2) % 4;
}

function turnType(from, to) {
  const diff = (to - from + 4) % 4;

  if (diff === 0) {
    return "Straight";
  }

  if (diff === 1) {
    return "TurnRight";
  }

  if (diff === 3) {
    return "TurnLeft";
  }

  return "Turn";
}

// ============================================================
// Rotation
//
// PolyTrack stores rotation as 0-3.
// This generator uses Y-axis rotation for horizontal track
// pieces.
//
// 0 = East
// 1 = South
// 2 = West
// 3 = North
// ============================================================

function rotationForDirection(dir) {
  return dir;
}

// ============================================================
// Generate a closed path
// ============================================================

function generateLoop(rng, requestedPieces, maxHeight) {
  const minimumLength = Math.max(8, requestedPieces);

  for (let attempt = 0; attempt < 500; attempt++) {
    const path = [];

    const visited = new Set();

    let x = 0;
    let y = 0;
    let z = 0;

    let direction = Math.floor(rng() * 4);

    path.push({
      x,
      y,
      z,
      direction,
    });

    visited.add(`${x},${y},${z}`);

    for (let step = 1; step < minimumLength; step++) {
      const candidates = [];

      // Prefer continuing forward, but allow turns.
      const directionChoices = [
        direction,
        (direction + 1) % 4,
        (direction + 3) % 4,
      ];

      // Occasionally allow a sharper/random direction.
      if (rng() < 0.15) {
        directionChoices.push((direction + 2) % 4);
      }

      for (const nextDirection of directionChoices) {
        const d = DIRS[nextDirection];

        const nx = x + d.dx;
        const nz = z + d.dz;

        let ny = y;

        // Occasional elevation change.
        if (rng() < 0.12) {
          ny += rng() < 0.5 ? 1 : -1;
        }

        if (ny < -maxHeight || ny > maxHeight) {
          continue;
        }

        const key = `${nx},${ny},${nz}`;

        if (visited.has(key)) {
          continue;
        }

        candidates.push({
          x: nx,
          y: ny,
          z: nz,
          direction: nextDirection,
        });
      }

      if (candidates.length === 0) {
        break;
      }

      // Prefer straight movement.
      let next;

      const straight = candidates.find(
        c => c.direction === direction
      );

      if (straight && rng() < 0.65) {
        next = straight;
      } else {
        next = candidates[
          Math.floor(rng() * candidates.length)
        ];
      }

      x = next.x;
      y = next.y;
      z = next.z;
      direction = next.direction;

      path.push(next);

      visited.add(`${x},${y},${z}`);

      // Try to close the loop after enough pieces.
      if (path.length >= 8) {
        const start = path[0];

        const dx = Math.abs(x - start.x);
        const dy = Math.abs(y - start.y);
        const dz = Math.abs(z - start.z);

        if (dx + dy + dz === 1 && y === start.y) {
          return path;
        }
      }
    }
  }

  throw new Error(
    "Unable to generate a closed track after 500 attempts."
  );
}

// ============================================================
// Convert generated path into PolyTrack parts
// ============================================================

function classifyParts(path, checkpointSpacing) {
  const parts = [];

  // Start piece.
  const start = path[0];

  parts.push({
    x: start.x,
    y: start.y,
    z: start.z,
    partId: PART_IDS.Start,
    rotation: rotationForDirection(start.direction),
    rotationAxis: 0,
    color: 0,
    startOrder: 0,
  });

  let checkpointOrder = 0;

  for (let i = 1; i < path.length; i++) {
    const current = path[i];
    const previous = path[i - 1];

    const previousDir = previous.direction;
    const currentDir = current.direction;

    let partId = PART_IDS.Straight;

    // Height change.
    if (current.y > previous.y) {
      partId = PART_IDS.SlopeUp;
    } else if (current.y < previous.y) {
      partId = PART_IDS.SlopeDown;
    } else {
      // Horizontal movement.
      const type = turnType(
        previousDir,
        currentDir
      );

      if (type === "TurnLeft" || type === "TurnRight") {
        partId = PART_IDS.Turn;
      } else {
        partId = PART_IDS.Straight;
      }
    }

    const part = {
      x: current.x,
      y: current.y,
      z: current.z,

      partId,

      rotation: rotationForDirection(currentDir),

      // Horizontal track pieces rotate around Y.
      rotationAxis: 0,

      color: 0,
    };

    // Add checkpoints at regular intervals.
    if (
      i > 0 &&
      i % checkpointSpacing === 0 &&
      i < path.length - 1
    ) {
      part.partId = PART_IDS.Checkpoint;
      part.checkpointOrder = checkpointOrder++;
    }

    parts.push(part);
  }

  return parts;
}

// ============================================================
// Generate PolyTrack decoder/encoder-compatible JSON
// ============================================================

function generateTrack(options) {
  const {
    seed,
    pieces,
    maxHeight,
    checkpointSpacing,
    name,
    author,
    environment,
    sunDirection,
  } = options;

  const rng = mulberry32(seed);

  const path = generateLoop(
    rng,
    pieces,
    maxHeight
  );

  const parts = classifyParts(
    path,
    checkpointSpacing
  );

  return {
    format: "PolyTrack2",

    metadata: {
      name,
      author,
      lastModified: null,
    },

    track: {
      environment,
      environmentId:
        environment === "Winter"
          ? 1
          : environment === "Desert"
            ? 2
            : 0,

      sunDirection,

      baseCoordinates: {
        x: 0,
        y: 0,
        z: 0,
      },

      coordinateWidths: {
        x: 1,
        y: 1,
        z: 1,
      },

      parts,
    },
  };
}

// ============================================================
// ASCII preview
// ============================================================

function printPreview(parts) {
  if (!parts.length) {
    return;
  }

  const minX = Math.min(...parts.map(p => p.x));
  const maxX = Math.max(...parts.map(p => p.x));

  const minZ = Math.min(...parts.map(p => p.z));
  const maxZ = Math.max(...parts.map(p => p.z));

  const width = maxX - minX + 1;
  const height = maxZ - minZ + 1;

  const grid = Array.from(
    { length: height },
    () => Array(width).fill(".")
  );

  for (const part of parts) {
    const gx = part.x - minX;
    const gz = part.z - minZ;

    if (
      gx < 0 ||
      gz < 0 ||
      gx >= width ||
      gz >= height
    ) {
      continue;
    }

    if (part.partId === PART_IDS.Start) {
      grid[gz][gx] = "S";
    } else if (part.partId === PART_IDS.Checkpoint) {
      grid[gz][gx] = "C";
    } else if (part.partId === PART_IDS.SlopeUp) {
      grid[gz][gx] = "^";
    } else if (part.partId === PART_IDS.SlopeDown) {
      grid[gz][gx] = "v";
    } else if (part.partId === PART_IDS.Turn) {
      grid[gz][gx] = "+";
    } else {
      grid[gz][gx] = "#";
    }
  }

  console.log("\nTrack preview:\n");

  for (const row of grid) {
    console.log(row.join(""));
  }

  console.log("");
}

// ============================================================
// Command-line argument parsing
// ============================================================

function getArg(name, defaultValue) {
  const index = process.argv.indexOf(name);

  if (index === -1) {
    return defaultValue;
  }

  const value = process.argv[index + 1];

  if (value === undefined) {
    throw new Error(
      `Missing value for ${name}`
    );
  }

  return value;
}

function hasArg(name) {
  return process.argv.includes(name);
}

// ============================================================
// Main
// ============================================================

function main() {
  const seed = Number(
    getArg("--seed", Date.now())
  );

  const pieces = Number(
    getArg("--pieces", 50)
  );

  const maxHeight = Number(
    getArg("--maxHeight", 3)
  );

  const checkpointSpacing = Number(
    getArg("--checkpointSpacing", 5)
  );

  const output = getArg(
    "--out",
    "track.json"
  );

  const name = getArg(
    "--name",
    `Generated Track ${seed}`
  );

  const author = getArg(
    "--author",
    "PolyBuilder"
  );

  const environment = getArg(
    "--environment",
    "Summer"
  );

  const sunDirection = Number(
    getArg("--sunDirection", 0)
  );

  if (!Number.isInteger(seed)) {
    throw new Error(
      "--seed must be an integer."
    );
  }

  if (
    !Number.isInteger(pieces) ||
    pieces < 8
  ) {
    throw new Error(
      "--pieces must be an integer >= 8."
    );
  }

  if (
    !Number.isInteger(maxHeight) ||
    maxHeight < 0
  ) {
    throw new Error(
      "--maxHeight must be an integer >= 0."
    );
  }

  if (
    !Number.isInteger(checkpointSpacing) ||
    checkpointSpacing < 1
  ) {
    throw new Error(
      "--checkpointSpacing must be >= 1."
    );
  }

  if (
    !["Summer", "Winter", "Desert"]
      .includes(environment)
  ) {
    throw new Error(
      "--environment must be Summer, Winter, or Desert."
    );
  }

  if (
    !Number.isInteger(sunDirection) ||
    sunDirection < 0 ||
    sunDirection >= 180
  ) {
    throw new Error(
      "--sunDirection must be 0-179."
    );
  }

  const track = generateTrack({
    seed,
    pieces,
    maxHeight,
    checkpointSpacing,
    name,
    author,
    environment,
    sunDirection,
  });

  fs.writeFileSync(
    output,
    JSON.stringify(track, null, 2),
    "utf8"
  );

  console.log(
    `Generated ${track.track.parts.length} parts.`
  );

  console.log(
    `Seed: ${seed}`
  );

  console.log(
    `Output: ${output}`
  );

  printPreview(
    track.track.parts
  );
}

main();
