/**
 * PolyBuilder - PolyTrack's built-in procedural generator, reimplemented
 * from the editor generator found in 112.bundle.js.
 *
 * The important difference from the old generator is that this works in
 * PolyTrack's logical generator grid and then writes the exact world
 * coordinates used by TrackData.setPart(): x/z are multiplied by 4.
 *
 * Usage:
 *   node track_generator_fixed.js
 *   node track_generator_fixed.js --seed 42
 *   node track_generator_fixed.js --length 50
 *   node track_generator_fixed.js --out track.json
 */

'use strict';

const fs = require('fs');

function mulberry32(seed) {
  let s = seed | 0;
  return function rng() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseArgs(argv) {
  const args = {
    seed: Date.now() & 0xffffffff,
    length: 50,
    out: null,
  };

  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--seed':
        args.seed = Number(argv[++i]);
        break;

      case '--length':
      case '--pieces':
        args.length = Number(argv[++i]);
        break;

      case '--out':
        args.out = argv[++i];
        break;

      default:
        throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }

  if (!Number.isInteger(args.length) || args.length < 1) {
    throw new Error('--length must be a positive integer');
  }

  return args;
}


// Exact PolyTrack part IDs from the game's TrackPartType enum.
const PART = Object.freeze({
  Straight: 0,
  TurnSharp: 1,
  SlopeUp: 2,
  SlopeDown: 3,
  Slope: 4,

  Start: 5,
  Finish: 6,

  ToWideLeft: 8,
  ToWideRight: 9,
  StraightWide: 10,
  InnerCornerWide: 11,
  OuterCornerWide: 12,

  SlopeUpLeftWide: 13,
  SlopeUpRightWide: 14,
  SlopeDownLeftWide: 15,
  SlopeDownRightWide: 16,
  SlopeLeftWide: 17,
  SlopeRightWide: 18,

  PillarTop: 19,
  PillarMiddle: 20,
  PillarBottom: 21,
  PillarShort: 22,
});


// TrackData's Y-positive rotation axis.
const ROTATION_AXIS_Y_POSITIVE = 0;


function key(x, y, z) {
  return `${x}|${y}|${z}`;
}


function normalizeRotation(rotation) {
  return ((rotation % 4) + 4) % 4;
}


/**
 * Reimplementation of the editor's generator.
 *
 * Entries with type === null are collision/clearance markers.
 * They are never emitted as actual track parts, but they participate
 * in collision detection.
 */
function generatePolyTrack(rng, length = 50) {

  while (true) {

    const occupied = new Map();
    let collision = false;

    // PolyTrack generator state.
    let x = 0;
    let lateral = 0;
    let z = 0;

    let direction = Math.floor(4 * rng());

    if (rng() < 0.5) {
      lateral = Math.floor(20 * rng());
    }


    // ------------------------------------------------------------
    // Direction helpers
    // ------------------------------------------------------------

    function forward() {

      switch (direction) {

        case 0:
          --z;
          break;

        case 1:
          --x;
          break;

        case 2:
          ++z;
          break;

        case 3:
          ++x;
          break;
      }
    }


    function backward() {

      switch (direction) {

        case 0:
          ++z;
          break;

        case 1:
          ++x;
          break;

        case 2:
          --z;
          break;

        case 3:
          --x;
          break;
      }
    }


    function sideLeft() {

      switch ((direction + 1) % 4) {

        case 0:
          --z;
          break;

        case 1:
          --x;
          break;

        case 2:
          ++z;
          break;

        case 3:
          ++x;
          break;
      }
    }


    function sideRight() {

      switch (((direction - 1) % 4 + 4) % 4) {

        case 0:
          --z;
          break;

        case 1:
          --x;
          break;

        case 2:
          ++z;
          break;

        case 3:
          ++x;
          break;
      }
    }


    // ------------------------------------------------------------
    // Logical part map
    // ------------------------------------------------------------

    function add(px, py, pz, type, rotation = 0) {

      const k = key(px, py, pz);

      if (occupied.has(k)) {
        collision = true;
      }

      occupied.set(k, {
        x: px,
        y: py,
        z: pz,
        type,
        direction: normalizeRotation(rotation),
      });
    }


    function isOccupied(px, py, pz) {
      return occupied.has(key(px, py, pz));
    }


    // ------------------------------------------------------------
    // Support/pillar pieces
    // ------------------------------------------------------------

    function supports() {

      let blocked = false;

      for (let yy = 0; yy < lateral; ++yy) {

        if (isOccupied(x, yy, z)) {
          blocked = true;
          break;
        }
      }


      if (!blocked) {

        for (let yy = 0; yy < lateral; ++yy) {

          let type;

          if (yy === 0 && yy === lateral - 1) {
            type = PART.PillarShort;
          }

          else if (yy === 0) {
            type = PART.PillarBottom;
          }

          else if (yy === lateral - 1) {
            type = PART.PillarTop;
          }

          else {
            type = PART.PillarMiddle;
          }

          add(x, yy, z, type, 0);
        }
      }
    }


    // ------------------------------------------------------------
    // Narrow track
    // ------------------------------------------------------------

    function narrow(t) {

      if (t > 0) {

        --t;

        if (rng() < 0.2) {
          wideTransition(t);
        }

        else if (rng() < 0.6) {
          straight(t);
        }

        else if (rng() < 0.5) {
          slope(
            t,
            lateral < 2 || rng() < 0.5
          );
        }

        else if (rng() < 0.5) {
          turnLeft(t);
        }

        else {
          turnRight(t);
        }

      }

      else {
        finish();
      }
    }


    // ------------------------------------------------------------
    // Wide track
    // ------------------------------------------------------------

    function wide(t) {

      if (t > 0) {

        --t;

        if (rng() < 0.1) {
          narrowTransition(t);
        }

        else if (rng() < 0.6) {
          wideStraight(t);
        }

        else if (rng() < 0.5) {
          wideSlope(
            t,
            lateral < 2 || rng() < 0.5
          );
        }

        else if (rng() < 0.5) {
          wideCornerA(t);
        }

        else {
          wideCornerB(t);
        }

      }

      else {
        narrowTransition(t);
      }
    }


    // ------------------------------------------------------------
    // Straight
    // ------------------------------------------------------------

    function straight(t) {

      add(
        x,
        lateral,
        z,
        PART.Straight,
        direction
      );

      supports();

      forward();

      narrow(t);
    }


    // ------------------------------------------------------------
    // Left turn
    // ------------------------------------------------------------

    function turnLeft(t) {

      add(
        x,
        lateral,
        z,
        PART.TurnSharp,
        direction - 1
      );

      supports();

      direction = (direction + 1) % 4;

      forward();

      if (t > 0) {

        --t;

        if (rng() < 0.4) {
          straight(t);
        }

        else if (rng() < 0.5) {
          turnLeft(t);
        }

        else {
          turnRight(t);
        }

      }

      else {
        finish();
      }
    }


    // ------------------------------------------------------------
    // Right turn
    // ------------------------------------------------------------

    function turnRight(t) {

      add(
        x,
        lateral,
        z,
        PART.TurnSharp,
        direction
      );

      supports();

      direction =
        ((direction - 1) % 4 + 4) % 4;

      forward();

      if (t > 0) {

        --t;

        if (rng() < 0.4) {
          straight(t);
        }

        else if (rng() < 0.5) {
          turnLeft(t);
        }

        else {
          turnRight(t);
        }

      }

      else {
        finish();
      }
    }


    // ------------------------------------------------------------
    // Narrow slope
    // ------------------------------------------------------------

    function slope(t, up) {

      const type =
        up
          ? PART.SlopeUp
          : PART.SlopeDown;

      if (!up) {
        --lateral;
      }

      add(
        x,
        lateral + 1,
        z,
        null,
        0
      );

      add(
        x,
        lateral,
        z,
        type,
        direction
      );

      forward();

      if (up) {
        ++lateral;
      }


      if (t > 0) {

        --t;

        if (
          rng() < 0.4 ||
          lateral <= 3
        ) {

          reverseSlope(t, up);

        }

        else {

          sideSlope(t, up);

        }

      }

      else {

        reverseSlope(t, up);

      }
    }


    // ------------------------------------------------------------
    // Reverse narrow slope
    // ------------------------------------------------------------

    function reverseSlope(t, up) {

      if (!up) {
        --lateral;
      }

      add(
        x,
        lateral + 1,
        z,
        null,
        0
      );

      const type =
        up
          ? PART.SlopeDown
          : PART.SlopeUp;

      add(
        x,
        lateral,
        z,
        type,
        direction + 2
      );

      forward();

      if (up) {
        ++lateral;
      }

      if (t > 0) {
        narrow(t - 1);
      }

      else {
        finish();
      }
    }


    // ------------------------------------------------------------
    // Sideways narrow slope
    // ------------------------------------------------------------

    function sideSlope(t, up) {

      if (!up) {
        lateral -= 2;
      }

      add(
        x,
        lateral + 1,
        z,
        null,
        0
      );

      add(
        x,
        lateral + 2,
        z,
        null,
        0
      );

      add(
        x,
        lateral,
        z,
        PART.Slope,
        up
          ? direction
          : direction + 2
      );

      forward();

      if (up) {
        lateral += 2;
      }

      if (t > 0) {

        --t;

        if (
          rng() < 0.4 ||
          lateral <= 3
        ) {

          reverseSlope(t, up);

        }

        else {

          sideSlope(t, up);

        }

      }

      else {

        reverseSlope(t, up);

      }
    }


    // ------------------------------------------------------------
    // Finish
    // ------------------------------------------------------------

    function finish() {

      add(
        x,
        lateral,
        z,
        PART.Finish,
        direction
      );
    }


    // ------------------------------------------------------------
    // Start
    // ------------------------------------------------------------

    function start(t) {

      add(
        x,
        lateral,
        z,
        PART.Start,
        direction
      );

      supports();

      forward();

      narrow(t);
    }


    // ------------------------------------------------------------
    // Narrow -> Wide
    // ------------------------------------------------------------

    function wideTransition(t) {

      if (rng() < 0.5) {

        add(
          x,
          lateral,
          z,
          PART.ToWideLeft,
          direction
        );

        supports();

        sideRight();

        add(
          x,
          lateral,
          z,
          PART.OuterCornerWide,
          direction + 2
        );

        supports();

        forward();

      }

      else {

        add(
          x,
          lateral,
          z,
          PART.ToWideRight,
          direction
        );

        supports();

        sideLeft();

        add(
          x,
          lateral,
          z,
          PART.OuterCornerWide,
          direction + 1
        );

        supports();

        forward();

        sideRight();
      }

      wide(t);
    }


    // ------------------------------------------------------------
    // Wide -> Narrow
    // ------------------------------------------------------------

    function narrowTransition(t) {

      if (rng() < 0.5) {

        add(
          x,
          lateral,
          z,
          PART.OuterCornerWide,
          direction + 3
        );

        supports();

        sideLeft();

        add(
          x,
          lateral,
          z,
          PART.ToWideRight,
          direction + 2
        );

        supports();

        forward();

      }

      else {

        add(
          x,
          lateral,
          z,
          PART.ToWideLeft,
          direction + 2
        );

        supports();

        sideLeft();

        add(
          x,
          lateral,
          z,
          PART.OuterCornerWide,
          direction
        );

        supports();

        forward();

        sideRight();
      }

      narrow(t);
    }


    // ------------------------------------------------------------
    // Wide straight
    // ------------------------------------------------------------

    function wideStraight(t) {

      add(
        x,
        lateral,
        z,
        PART.StraightWide,
        direction
      );

      supports();

      sideLeft();

      add(
        x,
        lateral,
        z,
        PART.StraightWide,
        direction + 2
      );

      supports();

      sideRight();

      forward();

      wide(t);
    }


    // ------------------------------------------------------------
    // Wide corner A
    // ------------------------------------------------------------

    function wideCornerA(t) {

      add(
        x,
        lateral,
        z,
        PART.StraightWide,
        direction
      );

      supports();

      forward();

      add(
        x,
        lateral,
        z,
        PART.OuterCornerWide,
        direction + 3
      );

      supports();

      sideLeft();

      add(
        x,
        lateral,
        z,
        PART.StraightWide,
        direction + 1
      );

      supports();

      backward();

      add(
        x,
        lateral,
        z,
        PART.InnerCornerWide,
        direction + 3
      );

      supports();

      forward();

      direction =
        (direction + 1) % 4;

      forward();

      wide(t);
    }


    // ------------------------------------------------------------
    // Wide corner B
    // ------------------------------------------------------------

    function wideCornerB(t) {

      add(
        x,
        lateral,
        z,
        PART.InnerCornerWide,
        direction
      );

      supports();

      sideLeft();

      add(
        x,
        lateral,
        z,
        PART.StraightWide,
        direction + 2
      );

      supports();

      forward();

      add(
        x,
        lateral,
        z,
        PART.OuterCornerWide,
        direction
      );

      supports();

      sideRight();

      add(
        x,
        lateral,
        z,
        PART.StraightWide,
        direction + 1
      );

      supports();

      backward();

      direction =
        ((direction - 1) % 4 + 4) % 4;

      forward();

      wide(t);
    }


    // ------------------------------------------------------------
    // Wide slope
    // ------------------------------------------------------------

    function wideSlope(t, up) {

      let a;
      let b;

      if (up) {

        a = PART.SlopeUpLeftWide;
        b = PART.SlopeUpRightWide;

      }

      else {

        a = PART.SlopeDownLeftWide;
        b = PART.SlopeDownRightWide;

      }


      if (!up) {
        --lateral;
      }


      sideLeft();

      add(
        x,
        lateral + 1,
        z,
        null,
        0
      );

      add(
        x,
        lateral,
        z,
        a,
        direction
      );


      sideRight();

      add(
        x,
        lateral + 1,
        z,
        null,
        0
      );

      add(
        x,
        lateral,
        z,
        b,
        direction
      );


      forward();

      if (up) {
        ++lateral;
      }


      if (t > 0) {

        --t;

        if (
          rng() < 0.4 ||
          lateral <= 3
        ) {

          wideSlopeReverse(t, up);

        }

        else {

          wideSlopeSide(t, up);

        }

      }

      else {

        wideSlopeReverse(t, up);

      }
    }


    // ------------------------------------------------------------
    // Reverse wide slope
    // ------------------------------------------------------------

    function wideSlopeReverse(t, up) {

      let a;
      let b;


      if (!up) {
        --lateral;
      }


      if (up) {

        a = PART.SlopeDownRightWide;
        b = PART.SlopeDownLeftWide;

      }

      else {

        a = PART.SlopeUpRightWide;
        b = PART.SlopeUpLeftWide;

      }


      sideLeft();

      add(
        x,
        lateral + 1,
        z,
        null,
        0
      );

      add(
        x,
        lateral,
        z,
        a,
        direction + 2
      );


      sideRight();

      add(
        x,
        lateral + 1,
        z,
        null,
        0
      );

      add(
        x,
        lateral,
        z,
        b,
        direction + 2
      );


      forward();

      if (up) {
        ++lateral;
      }

      wide(t);
    }


    // ------------------------------------------------------------
    // Sideways wide slope
    // ------------------------------------------------------------

    function wideSlopeSide(t, up) {

      if (!up) {
        lateral -= 2;
      }


      if (up) {

        sideLeft();

        add(
          x,
          lateral + 1,
          z,
          null,
          0
        );

        add(
          x,
          lateral + 2,
          z,
          null,
          0
        );

        add(
          x,
          lateral,
          z,
          PART.SlopeLeftWide,
          direction
        );


        sideRight();

        add(
          x,
          lateral + 1,
          z,
          null,
          0
        );

        add(
          x,
          lateral + 2,
          z,
          null,
          0
        );

        add(
          x,
          lateral,
          z,
          PART.SlopeRightWide,
          direction
        );

      }

      else {

        sideLeft();

        add(
          x,
          lateral + 1,
          z,
          null,
          0
        );

        add(
          x,
          lateral + 2,
          z,
          null,
          0
        );

        add(
          x,
          lateral,
          z,
          PART.SlopeRightWide,
          direction + 2
        );


        sideRight();

        add(
          x,
          lateral + 1,
          z,
          null,
          0
        );

        add(
          x,
          lateral + 2,
          z,
          null,
          0
        );

        add(
          x,
          lateral,
          z,
          PART.SlopeLeftWide,
          direction + 2
        );
      }


      forward();

      if (up) {
        lateral += 2;
      }


      if (t > 0) {

        --t;

        if (
          rng() < 0.4 ||
          lateral <= 3
        ) {

          wideSlopeReverse(t, up);

        }

        else {

          wideSlopeSide(t, up);

        }

      }

      else {

        wideSlopeReverse(t, up);

      }
    }


    // ------------------------------------------------------------
    // Begin generation
    // ------------------------------------------------------------

    start(length);


    // ------------------------------------------------------------
    // Collision-free attempt
    // ------------------------------------------------------------

    if (!collision) {

      const parts = [];

      for (const entry of occupied.values()) {

        // Null entries are collision markers only.
        if (entry.type == null) {
          continue;
        }


        parts.push({

          // PolyTrack's generator converts logical X/Z
          // coordinates to world coordinates using *4.
          x: 4 * entry.x,

          y: entry.y,

          z: 4 * entry.z,

          partId: entry.type,

          rotation: entry.direction,

          rotationAxis:
            ROTATION_AXIS_Y_POSITIVE,

          color: 0,

          checkpointOrder: null,

          startOrder:
            entry.type === PART.Start
              ? 0
              : null,
        });
      }


      return {
        parts,
        logicalEntries: occupied.size,
      };
    }

    // If a collision occurred, discard this entire
    // attempt and generate again.
  }
}


// ------------------------------------------------------------
// PolyTrack2 JSON wrapper
// ------------------------------------------------------------

function makeTrackData(parts, seed) {

  return {

    format: 'PolyTrack2',

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


// ------------------------------------------------------------
// Main
// ------------------------------------------------------------

function main() {

  const args =
    parseArgs(process.argv);

  const rng =
    mulberry32(args.seed);

  const result =
    generatePolyTrack(
      rng,
      args.length
    );

  const data =
    makeTrackData(
      result.parts,
      args.seed
    );


  console.log(
    `Generated PolyTrack-style track: ${result.parts.length} parts`
  );

  console.log(
    `Seed: ${args.seed}`
  );

  console.log(
    `Logical entries: ${result.logicalEntries}`
  );


  if (args.out) {

    fs.writeFileSync(
      args.out,
      JSON.stringify(data, null, 2),
      'utf8'
    );

    console.log(
      `Wrote ${args.out}`
    );

  }

  else {

    console.log(
      JSON.stringify(data, null, 2)
    );
  }
}


main();
