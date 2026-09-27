/**
 * PolyBuilder -> PolyTrack2 Generator
 *
 * Generates a closed grid-based track and outputs ONLY:
 *
 * {
 *   format: "PolyTrack2",
 *   metadata: {...},
 *   track: {
 *     environment: ...,
 *     environmentId: ...,
 *     sunDirection: ...,
 *     parts: [...]
 *   }
 * }
 *
 * No old "pieces" format is emitted.
 */

'use strict';

const fs = require('fs');

// ============================================================
// POLYTRACK PART IDs
// ============================================================
//
// Confirmed from PolyTrack's actual part enum:
//
// 0  Straight
// 1  TurnSharp
// 2  SlopeUp
// 3  SlopeDown
// 4  Slope
// 5  Start
// 6  Finish
// 7  ToWideMiddle
// ...
// 36 TurnShort
// 37 TurnLong
// 52 Checkpoint
//
// For our 1-grid-cell 90-degree corners, TurnSharp (1)
// is the appropriate basic corner piece.
// ============================================================

const PART_ID = {
  Straight: 0,

  // IMPORTANT:
  // 1 = TurnSharp
  // 7 = ToWideMiddle
  Turn: 1,

  SlopeUp: 2,
  SlopeDown: 3,
  Slope: 4,

  Start: 5,
  Finish: 6,

  Checkpoint: 52,
};

// ============================================================
// ROTATION
// ============================================================
//
// Your decoder stores:
//   rotation      = 0..3
//   rotationAxis  = 0..7
//
// Axis 0 = YPositive.
//
// Basic direction convention:
//
//   0 = East  (+X)
//   1 = South (+Z)
//   2 = West  (-X)
//   3 = North (-Z)
// ============================================================

const ROTATION_AXIS_Y = 0;

const DIR_VEC = [
  [1, 0],   // E
  [0, 1],   // S
  [-1, 0],  // W
  [0, -1],  // N
];

const DIR_NAME = [
  'E',
  'S',
  'W',
  'N',
];

const HEADING_ROTATION = {
  E: 0,
  S: 1,
  W: 2,
  N: 3,
};

// ============================================================
// SEEDED RNG
// ============================================================

function mulberry32(seed) {
  return function () {
    seed |= 0;

    seed =
      (seed + 0x6D2B79F5) |
      0;

    let t =
      Math.imul(
        seed ^ (seed >>> 15),
        1 | seed
      );

    t =
      (t +
        Math.imul(
          t ^ (t >>> 7),
          61 | t
        )) ^
      t;

    return (
      (t ^ (t >>> 14)) >>> 0
    ) / 4294967296;
  };
}

// ============================================================
// CLI
// ============================================================

function parseArgs(argv) {
  const args = {
    seed:
      Date.now() &
      0xffffffff,

    pieces: 30,

    out: null,

    maxHeight: 3,
  };

  for (
    let i = 2;
    i < argv.length;
    i++
  ) {
    if (
      argv[i] === '--seed'
    ) {
      args.seed =
        parseInt(
          argv[++i],
          10
        );
    }

    else if (
      argv[i] === '--pieces'
    ) {
      args.pieces =
        parseInt(
          argv[++i],
          10
        );
    }

    else if (
      argv[i] === '--out'
    ) {
      args.out =
        argv[++i];
    }

    else if (
      argv[i] === '--maxHeight'
    ) {
      args.maxHeight =
        parseInt(
          argv[++i],
          10
        );
    }
  }

  return args;
}

// ============================================================
// HELPERS
// ============================================================

function key(
  x,
  y,
  z
) {
  return `${x},${y},${z}`;
}

function shuffle(
  arr,
  rng
) {
  const result =
    arr.slice();

  for (
    let i =
      result.length - 1;
    i > 0;
    i--
  ) {
    const j =
      Math.floor(
        rng() * (i + 1)
      );

    [
      result[i],
      result[j],
    ] = [
      result[j],
      result[i],
    ];
  }

  return result;
}

function directionBetween(
  x0,
  z0,
  x1,
  z1
) {
  const dx =
    x1 - x0;

  const dz =
    z1 - z0;

  for (
    let i = 0;
    i < DIR_VEC.length;
    i++
  ) {
    if (
      DIR_VEC[i][0] === dx &&
      DIR_VEC[i][1] === dz
    ) {
      return i;
    }
  }

  return -1;
}

// ============================================================
// GENERATE CLOSED LOOP
// ============================================================

function generateLoop(
  rng,
  targetPieces,
  maxHeight
) {
  const minLen =
    Math.max(
      8,
      Math.floor(
        targetPieces * 0.7
      )
    );

  const maxLen =
    Math.max(
      minLen + 1,
      targetPieces * 2
    );

  for (
    let attempt = 0;
    attempt < 500;
    attempt++
  ) {
    const start = [
      0,
      0,
      0,
    ];

    const visited =
      new Set([
        key(...start),
      ]);

    const path = [
      start,
    ];

    let direction =
      Math.floor(
        rng() * 4
      );

    while (
      path.length <
      maxLen
    ) {
      const current =
        path[
          path.length - 1
        ];

      const [
        x,
        y,
        z,
      ] = current;

      // ------------------------------------------------------
      // Try to close the loop.
      //
      // IMPORTANT:
      // We only close horizontally at the original height.
      // ------------------------------------------------------

      if (
        path.length >=
        minLen
      ) {
        const [
          sx,
          sy,
          sz,
        ] = start;

        const dx =
          sx - x;

        const dz =
          sz - z;

        if (
          Math.abs(dx) +
            Math.abs(dz) ===
            1 &&
          y === sy
        ) {
          path.push(start);

          return {
            path,
            closed: true,
          };
        }
      }

      // ------------------------------------------------------
      // Prefer straight movement, but allow left/right.
      // ------------------------------------------------------

      const order = [
        direction,
        (direction + 3) % 4,
        (direction + 1) % 4,
      ];

      let moved =
        false;

      for (
        const d of
          shuffle(
            order,
            rng
          )
      ) {
        const [
          dx,
          dz,
        ] = DIR_VEC[d];

        // Occasional elevation change.
        let dy = 0;

        if (
          rng() < 0.12
        ) {
          dy =
            rng() < 0.5
              ? 1
              : -1;
        }

        const ny =
          Math.max(
            0,
            Math.min(
              maxHeight,
              y + dy
            )
          );

        const nx =
          x + dx;

        const nz =
          z + dz;

        const nextKey =
          key(
            nx,
            ny,
            nz
          );

        if (
          visited.has(
            nextKey
          )
        ) {
          continue;
        }

        visited.add(
          nextKey
        );

        path.push([
          nx,
          ny,
          nz,
        ]);

        direction = d;

        moved = true;

        break;
      }

      if (!moved) {
        break;
      }
    }
  }

  return {
    path: null,
    closed: false,
  };
}

// ============================================================
// CLASSIFY PATH
// ============================================================
//
// A piece occupies path[i].
//
// Its incoming direction is:
//
//   path[i-1] -> path[i]
//
// Its outgoing direction is:
//
//   path[i] -> path[i+1]
//
// Therefore a turn MUST be determined from both directions.
// ============================================================

function classifyPieces(
  path
) {
  const pieces = [];

  // The final element is the duplicated start used to close
  // the loop, so we don't turn it into another physical piece.

  for (
    let i = 0;
    i <
    path.length - 1;
    i++
  ) {
    const [
      x,
      y,
      z,
    ] = path[i];

    const [
      nextX,
      nextY,
      nextZ,
    ] = path[i + 1];

    const outgoing =
      directionBetween(
        x,
        z,
        nextX,
        nextZ
      );

    if (
      outgoing === -1
    ) {
      throw new Error(
        `Invalid path segment at index ${i}.`
      );
    }

    let incoming =
      outgoing;

    if (i > 0) {
      const [
        previousX,
        ,
        previousZ,
      ] = path[i - 1];

      incoming =
        directionBetween(
          previousX,
          previousZ,
          x,
          z
        );

      if (
        incoming === -1
      ) {
        throw new Error(
          `Invalid incoming direction at index ${i}.`
        );
      }
    }

    const dy =
      nextY - y;

    let type =
      'straight';

    // --------------------------------------------------------
    // Elevation takes priority.
    // --------------------------------------------------------

    if (dy > 0) {
      type =
        'ramp_up';
    }

    else if (dy < 0) {
      type =
        'ramp_down';
    }

    // --------------------------------------------------------
    // Horizontal turn.
    // --------------------------------------------------------

    else if (
      i > 0
    ) {
      const turn =
        (
          outgoing -
          incoming +
          4
        ) % 4;

      if (
        turn === 1
      ) {
        type =
          'turn_right';
      }

      else if (
        turn === 3
      ) {
        type =
          'turn_left';
      }

      else if (
        turn === 2
      ) {
        throw new Error(
          `U-turn detected at (${x}, ${y}, ${z}).`
        );
      }
    }

    pieces.push({
      index: i,

      x,
      y,
      z,

      incoming,

      outgoing,

      heading:
        DIR_NAME[outgoing],

      type,
    });
  }

  return pieces;
}

// ============================================================
// CHECKPOINTS
// ============================================================

function placeCheckpoints(
  pieces,
  everyN
) {
  const checkpoints = [];

  for (
    let i = 0;
    i < pieces.length;
    i += everyN
  ) {
    // Don't replace the start with a checkpoint.
    if (
      pieces[i].index !== 0
    ) {
      checkpoints.push(
        pieces[i].index
      );
    }
  }

  return checkpoints;
}

// ============================================================
// TURN ROTATION
// ============================================================
//
// Straight pieces are simple:
//
// E = 0
// S = 1
// W = 2
// N = 3
//
// For a TurnSharp, the orientation depends on BOTH sides of
// the corner.
//
// We use the following base corner:
//
//   incoming E -> outgoing S = rotation 0
//
// and rotate that corner around Y.
//
// This produces:
//
//   E -> S : 0
//   S -> W : 1
//   W -> N : 2
//   N -> E : 3
//
// The opposite turning direction uses the mirrored corner.
//
//   E -> N : 3
//   N -> W : 2
//   W -> S : 1
//   S -> E : 0
//
// ============================================================

function getTurnRotation(
  incoming,
  outgoing
) {
  const turn =
    (
      outgoing -
      incoming +
      4
    ) % 4;

  // Right turn.
  if (
    turn === 1
  ) {
    return incoming;
  }

  // Left turn.
  if (
    turn === 3
  ) {
    return outgoing;
  }

  throw new Error(
    `Not a 90-degree turn: ${incoming} -> ${outgoing}`
  );
}

// ============================================================
// PART ROTATION
// ============================================================

function getRotation(
  piece
) {
  if (
    piece.type ===
      'turn_left' ||
    piece.type ===
      'turn_right'
  ) {
    return getTurnRotation(
      piece.incoming,
      piece.outgoing
    );
  }

  return piece.outgoing;
}

// ============================================================
// CREATE POLYTRACK PART
// ============================================================

function makePart(
  piece,
  partId,
  rotation,
  extra = {}
) {
  return {
    x: piece.x,
    y: piece.y,
    z: piece.z,

    partId,

    rotation,

    rotationAxis:
      ROTATION_AXIS_Y,

    color: 0,

    ...extra,
  };
}

// ============================================================
// CONVERT TO POLYTRACK2
// ============================================================

function toPolyTrackData(
  pieces,
  checkpoints,
  seed
) {
  const checkpointSet =
    new Set(
      checkpoints
    );

  const parts = [];

  for (
    const piece of pieces
  ) {
    let partId;

    switch (
      piece.type
    ) {
      case 'straight':
        partId =
          PART_ID.Straight;
        break;

      case 'turn_left':
      case 'turn_right':
        partId =
          PART_ID.Turn;
        break;

      case 'ramp_up':
        partId =
          PART_ID.SlopeUp;
        break;

      case 'ramp_down':
        partId =
          PART_ID.SlopeDown;
        break;

      default:
        throw new Error(
          `Unknown piece type: ${piece.type}`
        );
    }

    const rotation =
      getRotation(
        piece
      );

    // --------------------------------------------------------
    // START
    // --------------------------------------------------------

    if (
      piece.index === 0
    ) {
      parts.push(
        makePart(
          piece,
          PART_ID.Start,
          rotation,
          {
            startOrder: 0,
          }
        )
      );

      continue;
    }

    // --------------------------------------------------------
    // CHECKPOINT
    // --------------------------------------------------------

    if (
      checkpointSet.has(
        piece.index
      )
    ) {
      const order =
        checkpoints.indexOf(
          piece.index
        );

      parts.push(
        makePart(
          piece,
          PART_ID.Checkpoint,
          rotation,
          {
            checkpointOrder:
              order,
          }
        )
      );

      continue;
    }

    // --------------------------------------------------------
    // NORMAL PART
    // --------------------------------------------------------

    parts.push(
      makePart(
        piece,
        partId,
        rotation
      )
    );
  }

  return {
    format:
      'PolyTrack2',

    metadata: {
      name:
        `Generated Track ${seed}`,

      author:
        'PolyBuilder',

      lastModified:
        null,
    },

    track: {
      environment:
        'Summer',

      environmentId:
        0,

      sunDirection:
        0,

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
// VALIDATION
// ============================================================

function validateTrack(
  data
) {
  if (
    data.format !==
    'PolyTrack2'
  ) {
    throw new Error(
      'Invalid PolyTrack2 format.'
    );
  }

  if (
    !data.metadata
  ) {
    throw new Error(
      'Missing metadata.'
    );
  }

  if (
    !data.track
  ) {
    throw new Error(
      'Missing track object.'
    );
  }

  if (
    !Array.isArray(
      data.track.parts
    )
  ) {
    throw new Error(
      'track.parts must be an array.'
    );
  }

  if (
    data.track.parts.length === 0
  ) {
    throw new Error(
      'No track parts were generated.'
    );
  }

  let starts = 0;
  let checkpoints = 0;

  const positions =
    new Set();

  for (
    let i = 0;
    i <
    data.track.parts.length;
    i++
  ) {
    const part =
      data.track.parts[i];

    // Coordinates
    if (
      !Number.isInteger(
        part.x
      ) ||
      !Number.isInteger(
        part.y
      ) ||
      !Number.isInteger(
        part.z
      )
    ) {
      throw new Error(
        `Part ${i}: invalid coordinates.`
      );
    }

    // Part ID
    if (
      !Number.isInteger(
        part.partId
      )
    ) {
      throw new Error(
        `Part ${i}: invalid partId.`
      );
    }

    // Rotation
    if (
      !Number.isInteger(
        part.rotation
      ) ||
      part.rotation < 0 ||
      part.rotation > 3
    ) {
      throw new Error(
        `Part ${i}: invalid rotation.`
      );
    }

    // Rotation axis
    if (
      !Number.isInteger(
        part.rotationAxis
      ) ||
      part.rotationAxis < 0 ||
      part.rotationAxis > 7
    ) {
      throw new Error(
        `Part ${i}: invalid rotationAxis.`
      );
    }

    // Color
    if (
      !Number.isInteger(
        part.color
      ) ||
      part.color < 0 ||
      part.color > 255
    ) {
      throw new Error(
        `Part ${i}: invalid color.`
      );
    }

    // Duplicate coordinates should not occur.
    const position =
      `${part.x},${part.y},${part.z}`;

    if (
      positions.has(
        position
      )
    ) {
      throw new Error(
        `Duplicate part position: ${position}`
      );
    }

    positions.add(
      position
    );

    // Start
    if (
      part.partId ===
      PART_ID.Start
    ) {
      starts++;

      if (
        !Number.isInteger(
          part.startOrder
        )
      ) {
        throw new Error(
          'Start is missing startOrder.'
        );
      }
    }

    // Checkpoint
    if (
      part.partId ===
      PART_ID.Checkpoint
    ) {
      checkpoints++;

      if (
        !Number.isInteger(
          part.checkpointOrder
        )
      ) {
        throw new Error(
          'Checkpoint is missing checkpointOrder.'
        );
      }
    }
  }

  if (
    starts !== 1
  ) {
    throw new Error(
      `Expected exactly 1 start, got ${starts}.`
    );
  }

  console.log(
    `Validation OK: ${data.track.parts.length} parts, ${starts} start, ${checkpoints} checkpoints.`
  );
}

// ============================================================
// ASCII MAP
// ============================================================

function printAsciiMap(
  pieces
) {
  if (
    !pieces.length
  ) {
    return;
  }

  const xs =
    pieces.map(
      p => p.x
    );

  const zs =
    pieces.map(
      p => p.z
    );

  const minX =
    Math.min(...xs);

  const maxX =
    Math.max(...xs);

  const minZ =
    Math.min(...zs);

  const maxZ =
    Math.max(...zs);

  // Avoid enormous console output.
  if (
    maxX - minX > 100 ||
    maxZ - minZ > 100
  ) {
    console.log(
      '\nASCII preview skipped: track is larger than 100x100.'
    );

    return;
  }

  const lookup =
    new Map();

  for (
    const piece of pieces
  ) {
    lookup.set(
      `${piece.x},${piece.z}`,
      piece
    );
  }

  console.log(
    '\nTop-down layout:'
  );

  for (
    let z = minZ;
    z <= maxZ;
    z++
  ) {
    let row = '';

    for (
      let x = minX;
      x <= maxX;
      x++
    ) {
      const piece =
        lookup.get(
          `${x},${z}`
        );

      if (!piece) {
        row += '.';
        continue;
      }

      if (
        piece.index === 0
      ) {
        row += 'S';
      }

      else if (
        piece.type ===
        'turn_left'
      ) {
        row += 'L';
      }

      else if (
        piece.type ===
        'turn_right'
      ) {
        row += 'R';
      }

      else if (
        piece.type ===
        'ramp_up'
      ) {
        row += '^';
      }

      else if (
        piece.type ===
        'ramp_down'
      ) {
        row += 'v';
      }

      else if (
        piece.heading === 'E' ||
        piece.heading === 'W'
      ) {
        row += '-';
      }

      else {
        row += '|';
      }
    }

    console.log(row);
  }

  console.log('');
}

// ============================================================
// MAIN
// ============================================================

function main() {
  const args =
    parseArgs(
      process.argv
    );

  if (
    !Number.isInteger(
      args.pieces
    ) ||
    args.pieces < 8
  ) {
    throw new Error(
      '--pieces must be an integer >= 8.'
    );
  }

  if (
    !Number.isInteger(
      args.maxHeight
    ) ||
    args.maxHeight < 0
  ) {
    throw new Error(
      '--maxHeight must be >= 0.'
    );
  }

  const rng =
    mulberry32(
      args.seed
    );

  const result =
    generateLoop(
      rng,
      args.pieces,
      args.maxHeight
    );

  if (
    !result.closed
  ) {
    throw new Error(
      'Could not generate a closed loop. Try another seed or fewer pieces.'
    );
  }

  const pieces =
    classifyPieces(
      result.path
    );

  const checkpoints =
    placeCheckpoints(
      pieces,
      5
    );

  const trackData =
    toPolyTrackData(
      pieces,
      checkpoints,
      args.seed
    );

  validateTrack(
    trackData
  );

  printAsciiMap(
    pieces
  );

  console.log(
    `Generated ${pieces.length} track parts.`
  );

  console.log(
    `Turns: ${
      pieces.filter(
        p =>
          p.type ===
            'turn_left' ||
          p.type ===
            'turn_right'
      ).length
    }`
  );

  console.log(
    `Checkpoints: ${checkpoints.length}`
  );

  console.log(
    `Seed: ${args.seed}`
  );

  if (
    args.out
  ) {
    fs.writeFileSync(
      args.out,
      JSON.stringify(
        trackData,
        null,
        2
      ),
      'utf8'
    );

    console.log(
      `Wrote: ${args.out}`
    );
  }

  else {
    console.log(
      JSON.stringify(
        trackData,
        null,
        2
      )
    );
  }
}

// ============================================================
// RUN
// ============================================================

try {
  main();
}
catch (error) {
  console.error(
    `\nERROR: ${error.message}\n`
  );

  process.exit(1);
}
