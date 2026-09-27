#!/usr/bin/env node

const fs = require("fs");

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

  // Checkpoint IDs recognized by your encoder/decoder.
  Checkpoint: 52,
};

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
// Directions
//
// 0 = East
// 1 = South
// 2 = West
// 3 = North
// ============================================================

const DIRECTIONS = [
  {
    name: "E",
    dx: 1,
    dz: 0,
  },
  {
    name: "S",
    dx: 0,
    dz: 1,
  },
  {
    name: "W",
    dx: -1,
    dz: 0,
  },
  {
    name: "N",
    dx: 0,
    dz: -1,
  },
];

// ============================================================
// Direction helpers
// ============================================================

function directionDelta(direction) {
  return DIRECTIONS[direction];
}

function getTurnType(previousDirection, nextDirection) {
  const difference =
    (nextDirection - previousDirection + 4) % 4;

  if (difference === 0) {
    return "straight";
  }

  if (difference === 1) {
    return "right";
  }

  if (difference === 3) {
    return "left";
  }

  return "reverse";
}

// ============================================================
// PolyTrack rotation
//
// rotation is 0-3.
// rotationAxis 0 corresponds to YPositive.
//
// These values are based on the direction representation used
// by this generator. If your real decoded tracks use a different
// orientation convention, these are the values to calibrate.
// ============================================================

function rotationForDirection(direction) {
  return direction;
}

// ============================================================
// Generate a closed path
// ============================================================

function generateLoop(rng, requestedPieces, maxHeight) {
  const minimumLength = Math.max(
    8,
    requestedPieces
  );

  for (let attempt = 0; attempt < 1000; attempt++) {
    const path = [];

    const visited = new Set();

    let x = 0;
    let y = 0;
    let z = 0;

    let direction =
      Math.floor(rng() * DIRECTIONS.length);

    path.push({
      x,
      y,
      z,
      direction,
    });

    visited.add(`${x},${y},${z}`);

    for (
      let step = 1;
      step < minimumLength;
      step++
    ) {
      const candidates = [];

      // Prefer continuing straight.
      const directionChoices = [
        direction,
        (direction + 1) % 4,
        (direction + 3) % 4,
      ];

      // Occasionally allow a completely different direction.
      if (rng() < 0.10) {
        directionChoices.push(
          (direction + 2) % 4
        );
      }

      for (const nextDirection of directionChoices) {
        const delta =
          directionDelta(nextDirection);

        const nextX = x + delta.dx;
        const nextZ = z + delta.dz;

        let nextY = y;

        // Occasionally change elevation.
        if (rng() < 0.12) {
          if (rng() < 0.5) {
            nextY++;
          } else {
            nextY--;
          }
        }

        if (
          nextY < -maxHeight ||
          nextY > maxHeight
        ) {
          continue;
        }

        const key =
          `${nextX},${nextY},${nextZ}`;

        if (visited.has(key)) {
          continue;
        }

        candidates.push({
          x: nextX,
          y: nextY,
          z: nextZ,
          direction: nextDirection,
        });
      }

      if (candidates.length === 0) {
        break;
      }

      let next;

      // Usually continue straight when possible.
      const straightCandidate =
        candidates.find(
          candidate =>
            candidate.direction === direction
        );

      if (
        straightCandidate &&
        rng() < 0.65
      ) {
        next = straightCandidate;
      } else {
        next =
          candidates[
            Math.floor(
              rng() * candidates.length
            )
          ];
      }

      x = next.x;
      y = next.y;
      z = next.z;
      direction = next.direction;

      path.push(next);

      visited.add(
        `${x},${y},${z}`
      );

      // Try to close the loop once it is long enough.
      if (path.length >= 8) {
        const start = path[0];

        const distance =
          Math.abs(x - start.x) +
          Math.abs(y - start.y) +
          Math.abs(z - start.z);

        if (
          distance === 1 &&
          y === start.y
        ) {
          return path;
        }
      }
    }
  }

  throw new Error(
    "Could not generate a closed track after 1000 attempts."
  );
}

// ============================================================
// Convert the generated path directly into PolyTrack parts
//
// IMPORTANT:
// This function does NOT create the old:
//
//   pieces
//   pieceCount
//   type
//   heading
//
// format.
//
// It creates ONLY the format expected by your encoder:
//
//   x
//   y
//   z
//   partId
//   rotation
//   rotationAxis
//   color
//   checkpointOrder
//   startOrder
// ============================================================

function createPolyTrackParts(
  path,
  checkpointSpacing
) {
  const parts = [];

  if (path.length === 0) {
    throw new Error(
      "Cannot create parts from an empty path."
    );
  }

  // ----------------------------------------------------------
  // Start
  // ----------------------------------------------------------

  const start = path[0];

  parts.push({
    x: start.x,
    y: start.y,
    z: start.z,

    partId: PART_IDS.Start,

    rotation:
      rotationForDirection(
        start.direction
      ),

    rotationAxis: 0,

    color: 0,

    startOrder: 0,
  });

  // ----------------------------------------------------------
  // Remaining track
  // ----------------------------------------------------------

  let checkpointOrder = 0;

  for (
    let i = 1;
    i < path.length;
    i++
  ) {
    const previous = path[i - 1];
    const current = path[i];

    let partId;

    // --------------------------------------------------------
    // Elevation change
    // --------------------------------------------------------

    if (current.y > previous.y) {
      partId = PART_IDS.SlopeUp;
    } else if (current.y < previous.y) {
      partId = PART_IDS.SlopeDown;
    } else {
      // ------------------------------------------------------
      // Horizontal movement
      // ------------------------------------------------------

      const turn =
        getTurnType(
          previous.direction,
          current.direction
        );

      if (
        turn === "left" ||
        turn === "right"
      ) {
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

      rotation:
        rotationForDirection(
          current.direction
        ),

      rotationAxis: 0,

      color: 0,
    };

    // --------------------------------------------------------
    // Checkpoint
    //
    // Checkpoint ID 52 is recognized by your encoder.
    // --------------------------------------------------------

    if (
      checkpointSpacing > 0 &&
      i % checkpointSpacing === 0 &&
      i < path.length - 1
    ) {
      part.partId =
        PART_IDS.Checkpoint;

      part.checkpointOrder =
        checkpointOrder;

      checkpointOrder++;
    }

    parts.push(part);
  }

  return parts;
}

// ============================================================
// Build the exact JSON structure expected by the encoder
// ============================================================

function buildTrack(options) {
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

  const rng =
    mulberry32(seed);

  const path =
    generateLoop(
      rng,
      pieces,
      maxHeight
    );

  const parts =
    createPolyTrackParts(
      path,
      checkpointSpacing
    );

  let environmentId;

  switch (environment) {
    case "Summer":
      environmentId = 0;
      break;

    case "Winter":
      environmentId = 1;
      break;

    case "Desert":
      environmentId = 2;
      break;

    default:
      throw new Error(
        `Unknown environment: ${environment}`
      );
  }

  // ==========================================================
  // THIS IS THE ONLY OUTPUT FORMAT
  //
  // No:
  //   seed
  //   pieceCount
  //   pieces
  //   type
  //   heading
  //
  // ==========================================================

  return {
    format: "PolyTrack2",

    metadata: {
      name,
      author,
      lastModified: null,
    },

    track: {
      environment,
      environmentId,

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
// Validate generated data before writing it
// ============================================================

function validateTrack(data) {
  if (!data) {
    throw new Error(
      "Generated track is empty."
    );
  }

  if (
    data.format !==
    "PolyTrack2"
  ) {
    throw new Error(
      "Invalid format."
    );
  }

  if (
    !data.metadata ||
    typeof data.metadata !== "object"
  ) {
    throw new Error(
      "Missing metadata."
    );
  }

  if (
    !data.track ||
    typeof data.track !== "object"
  ) {
    throw new Error(
      "Missing track object."
    );
  }

  if (
    !Array.isArray(
      data.track.parts
    )
  ) {
    throw new Error(
      "track.parts must be an array."
    );
  }

  if (
    data.track.parts.length === 0
  ) {
    throw new Error(
      "Track contains no parts."
    );
  }

  for (
    let i = 0;
    i < data.track.parts.length;
    i++
  ) {
    const part =
      data.track.parts[i];

    if (
      typeof part.x !== "number" ||
      typeof part.y !== "number" ||
      typeof part.z !== "number"
    ) {
      throw new Error(
        `Part ${i} has invalid coordinates.`
      );
    }

    if (
      !Number.isInteger(
        part.partId
      )
    ) {
      throw new Error(
        `Part ${i} has invalid partId.`
      );
    }

    if (
      !Number.isInteger(
        part.rotation
      ) ||
      part.rotation < 0 ||
      part.rotation > 3
    ) {
      throw new Error(
        `Part ${i} has invalid rotation.`
      );
    }

    if (
      !Number.isInteger(
        part.rotationAxis
      ) ||
      part.rotationAxis < 0 ||
      part.rotationAxis > 7
    ) {
      throw new Error(
        `Part ${i} has invalid rotationAxis.`
      );
    }

    if (
      !Number.isInteger(
        part.color
      ) ||
      part.color < 0 ||
      part.color > 255
    ) {
      throw new Error(
        `Part ${i} has invalid color.`
      );
    }

    // Checkpoint 52 requires checkpointOrder.
    if (
      part.partId ===
      PART_IDS.Checkpoint
    ) {
      if (
        !Number.isInteger(
          part.checkpointOrder
        )
      ) {
        throw new Error(
          `Checkpoint part ${i} is missing checkpointOrder.`
        );
      }
    }

    // Start 5 requires startOrder.
    if (
      part.partId ===
      PART_IDS.Start
    ) {
      if (
        !Number.isInteger(
          part.startOrder
        )
      ) {
        throw new Error(
          `Start part ${i} is missing startOrder.`
        );
      }
    }
  }
}

// ============================================================
// ASCII preview
// ============================================================

function printPreview(parts) {
  if (!parts.length) {
    return;
  }

  const minX =
    Math.min(
      ...parts.map(
        part => part.x
      )
    );

  const maxX =
    Math.max(
      ...parts.map(
        part => part.x
      )
    );

  const minZ =
    Math.min(
      ...parts.map(
        part => part.z
      )
    );

  const maxZ =
    Math.max(
      ...parts.map(
        part => part.z
      )
    );

  const width =
    maxX - minX + 1;

  const height =
    maxZ - minZ + 1;

  // Prevent gigantic terminal previews.
  if (
    width > 100 ||
    height > 100
  ) {
    console.log(
      "\nPreview skipped: track is larger than 100x100.\n"
    );

    return;
  }

  const grid =
    Array.from(
      { length: height },
      () =>
        Array(width).fill(".")
    );

  for (const part of parts) {
    const gx =
      part.x - minX;

    const gz =
      part.z - minZ;

    if (
      gx < 0 ||
      gz < 0 ||
      gx >= width ||
      gz >= height
    ) {
      continue;
    }

    let symbol = "#";

    if (
      part.partId ===
      PART_IDS.Start
    ) {
      symbol = "S";
    } else if (
      part.partId ===
      PART_IDS.Checkpoint
    ) {
      symbol = "C";
    } else if (
      part.partId ===
      PART_IDS.SlopeUp
    ) {
      symbol = "^";
    } else if (
      part.partId ===
      PART_IDS.SlopeDown
    ) {
      symbol = "v";
    } else if (
      part.partId ===
      PART_IDS.Turn
    ) {
      symbol = "+";
    }

    grid[gz][gx] = symbol;
  }

  console.log(
    "\nTrack preview:\n"
  );

  for (const row of grid) {
    console.log(
      row.join("")
    );
  }

  console.log("");
}

// ============================================================
// Command-line helpers
// ============================================================

function getArg(
  name,
  defaultValue
) {
  const index =
    process.argv.indexOf(name);

  if (index === -1) {
    return defaultValue;
  }

  const value =
    process.argv[index + 1];

  if (
    value === undefined
  ) {
    throw new Error(
      `Missing value for ${name}.`
    );
  }

  return value;
}

// ============================================================
// Main
// ============================================================

function main() {
  const seed =
    Number(
      getArg(
        "--seed",
        Date.now()
      )
    );

  const pieces =
    Number(
      getArg(
        "--pieces",
        50
      )
    );

  const maxHeight =
    Number(
      getArg(
        "--maxHeight",
        3
      )
    );

  const checkpointSpacing =
    Number(
      getArg(
        "--checkpointSpacing",
        5
      )
    );

  const output =
    getArg(
      "--out",
      "track.json"
    );

  const name =
    getArg(
      "--name",
      `Generated Track ${seed}`
    );

  const author =
    getArg(
      "--author",
      "PolyBuilder"
    );

  const environment =
    getArg(
      "--environment",
      "Summer"
    );

  const sunDirection =
    Number(
      getArg(
        "--sunDirection",
        0
      )
    );

  // ----------------------------------------------------------
  // Validate arguments
  // ----------------------------------------------------------

  if (
    !Number.isInteger(seed)
  ) {
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
    !Number.isInteger(
      checkpointSpacing
    ) ||
    checkpointSpacing < 1
  ) {
    throw new Error(
      "--checkpointSpacing must be >= 1."
    );
  }

  if (
    ![
      "Summer",
      "Winter",
      "Desert",
    ].includes(environment)
  ) {
    throw new Error(
      "--environment must be Summer, Winter, or Desert."
    );
  }

  if (
    !Number.isInteger(
      sunDirection
    ) ||
    sunDirection < 0 ||
    sunDirection >= 180
  ) {
    throw new Error(
      "--sunDirection must be 0-179."
    );
  }

  // ----------------------------------------------------------
  // Generate
  // ----------------------------------------------------------

  const track =
    buildTrack({
      seed,
      pieces,
      maxHeight,
      checkpointSpacing,
      name,
      author,
      environment,
      sunDirection,
    });

  // ----------------------------------------------------------
  // Validate
  // ----------------------------------------------------------

  validateTrack(track);

  // ----------------------------------------------------------
  // Write ONLY the new format
  // ----------------------------------------------------------

  fs.writeFileSync(
    output,
    JSON.stringify(
      track,
      null,
      2
    ),
    "utf8"
  );

  // ----------------------------------------------------------
  // Statistics
  // ----------------------------------------------------------

  const parts =
    track.track.parts;

  const starts =
    parts.filter(
      part =>
        part.partId ===
        PART_IDS.Start
    );

  const checkpoints =
    parts.filter(
      part =>
        part.partId ===
        PART_IDS.Checkpoint
    );

  console.log(
    "Generated PolyTrack2 JSON"
  );

  console.log(
    `Seed:         ${seed}`
  );

  console.log(
    `Parts:        ${parts.length}`
  );

  console.log(
    `Start parts:  ${starts.length}`
  );

  console.log(
    `Checkpoints:  ${checkpoints.length}`
  );

  console.log(
    `Environment:  ${environment}`
  );

  console.log(
    `Output:       ${output}`
  );

  printPreview(parts);
}

// ============================================================
// Run
// ============================================================

try {
  main();
} catch (error) {
  console.error(
    `\nERROR: ${error.message}\n`
  );

  process.exit(1);
}
