/**
 * PolyBuilder - PolyTrack procedural track generator
 *
 * Full replacement version with working checkpoint generation.
 *
 * Usage:
 *
 *   node track_generator.js
 *
 *   node track_generator.js --seed 42
 *
 *   node track_generator.js --length 500
 *
 *   node track_generator.js --length 500 --checkpoints 10
 *
 *   node track_generator.js --seed 12345 --length 500 --checkpoints 5 --out track.json
 *
 * Checkpoints:
 *
 *   52 = PolyTrack Checkpoint
 *
 * checkpointOrder:
 *
 *   0 = first checkpoint
 *   1 = second checkpoint
 *   2 = third checkpoint
 *   ...
 */

'use strict';

const fs = require('fs');


// ============================================================
// RNG
// ============================================================

function mulberry32(seed) {

  let s = seed | 0;

  return function rng() {

    s = (s + 0x6d2b79f5) | 0;

    let t =
      Math.imul(
        s ^ (s >>> 15),
        1 | s
      );

    t =
      (t +
        Math.imul(
          t ^ (t >>> 7),
          61 | t
        )
      ) ^ t;

    return (
      (t ^ (t >>> 14)) >>> 0
    ) / 4294967296;
  };
}


// ============================================================
// COMMAND LINE
// ============================================================

function parseArgs(argv) {

  const args = {

    seed:
      Date.now() & 0xffffffff,

    length: 50,

    out: null,

    // IMPORTANT:
    // Checkpoints are ON by default.
    checkpoints: 5,
  };


  for (let i = 2; i < argv.length; i++) {

    switch (argv[i]) {

      case '--seed':

        args.seed =
          Number(argv[++i]);

        break;


      case '--length':
      case '--pieces':

        args.length =
          Number(argv[++i]);

        break;


      case '--out':

        args.out =
          argv[++i];

        break;


      case '--checkpoints':

        args.checkpoints =
          Number(argv[++i]);

        break;


      default:

        throw new Error(
          `Unknown argument: ${argv[i]}`
        );
    }
  }


  if (
    !Number.isInteger(args.length) ||
    args.length < 1
  ) {

    throw new Error(
      '--length must be a positive integer'
    );
  }


  if (
    !Number.isInteger(args.checkpoints) ||
    args.checkpoints < 0
  ) {

    throw new Error(
      '--checkpoints must be a non-negative integer'
    );
  }


  return args;
}


// ============================================================
// POLYTRACK PART IDS
// ============================================================

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


  // PolyTrack checkpoint.
  Checkpoint: 52,
});


// ============================================================
// POLYTRACK ROTATION AXIS
// ============================================================

const ROTATION_AXIS_Y_POSITIVE = 0;


// ============================================================
// HELPERS
// ============================================================

function key(x, y, z) {

  return `${x}|${y}|${z}`;
}


function normalizeRotation(rotation) {

  return (
    ((rotation % 4) + 4) % 4
  );
}


// ============================================================
// POLYTRACK GENERATOR
// ============================================================

function generatePolyTrack(
  rng,
  length = 50
) {

  while (true) {

    const occupied =
      new Map();

    let collision = false;


    // --------------------------------------------------------
    // Generator state
    // --------------------------------------------------------

    let x = 0;

    let lateral = 0;

    let z = 0;

    let direction =
      Math.floor(4 * rng());


    if (rng() < 0.5) {

      lateral =
        Math.floor(20 * rng());
    }


    // --------------------------------------------------------
    // Movement
    // --------------------------------------------------------

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

      switch (
        (direction + 1) % 4
      ) {

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

      switch (
        ((direction - 1) % 4 + 4) % 4
      ) {

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


    // --------------------------------------------------------
    // Add logical part
    // --------------------------------------------------------

    function add(
      px,
      py,
      pz,
      type,
      rotation = 0
    ) {

      const k =
        key(px, py, pz);


      if (occupied.has(k)) {

        collision = true;
      }


      occupied.set(
        k,
        {

          x: px,

          y: py,

          z: pz,

          type,

          direction:
            normalizeRotation(rotation),
        }
      );
    }


    function isOccupied(
      px,
      py,
      pz
    ) {

      return occupied.has(
        key(px, py, pz)
      );
    }


    // --------------------------------------------------------
    // Supports
    // --------------------------------------------------------

    function supports() {

      let blocked = false;


      for (
        let yy = 0;
        yy < lateral;
        ++yy
      ) {

        if (
          isOccupied(
            x,
            yy,
            z
          )
        ) {

          blocked = true;

          break;
        }
      }


      if (!blocked) {

        for (
          let yy = 0;
          yy < lateral;
          ++yy
        ) {

          let type;


          if (
            yy === 0 &&
            yy === lateral - 1
          ) {

            type =
              PART.PillarShort;

          }

          else if (yy === 0) {

            type =
              PART.PillarBottom;

          }

          else if (
            yy === lateral - 1
          ) {

            type =
              PART.PillarTop;

          }

          else {

            type =
              PART.PillarMiddle;
          }


          add(
            x,
            yy,
            z,
            type,
            0
          );
        }
      }
    }


    // ========================================================
    // NARROW GENERATION
    // ========================================================

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
            lateral < 2 ||
            rng() < 0.5
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


    // ========================================================
    // WIDE GENERATION
    // ========================================================

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
            lateral < 2 ||
            rng() < 0.5
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


    // ========================================================
    // STRAIGHT
    // ========================================================

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


    // ========================================================
    // TURN LEFT
    // ========================================================

    function turnLeft(t) {

      add(
        x,
        lateral,
        z,
        PART.TurnSharp,
        direction - 1
      );


      supports();


      direction =
        (direction + 1) % 4;


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


    // ========================================================
    // TURN RIGHT
    // ========================================================

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


    // ========================================================
    // SLOPE
    // ========================================================

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

          reverseSlope(
            t,
            up
          );

        }

        else {

          sideSlope(
            t,
            up
          );
        }

      }

      else {

        reverseSlope(
          t,
          up
        );
      }
    }


    // ========================================================
    // REVERSE SLOPE
    // ========================================================

    function reverseSlope(
      t,
      up
    ) {

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


    // ========================================================
    // SIDE SLOPE
    // ========================================================

    function sideSlope(
      t,
      up
    ) {

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

          reverseSlope(
            t,
            up
          );

        }

        else {

          sideSlope(
            t,
            up
          );
        }

      }

      else {

        reverseSlope(
          t,
          up
        );
      }
    }


    // ========================================================
    // FINISH
    // ========================================================

    function finish() {

      add(
        x,
        lateral,
        z,
        PART.Finish,
        direction
      );
    }


    // ========================================================
    // START
    // ========================================================

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


    // ========================================================
    // NARROW -> WIDE
    // ========================================================

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


    // ========================================================
    // WIDE -> NARROW
    // ========================================================

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


    // ========================================================
    // WIDE STRAIGHT
    // ========================================================

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


    // ========================================================
    // WIDE CORNER A
    // ========================================================

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


    // ========================================================
    // WIDE CORNER B
    // ========================================================

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


    // ========================================================
    // WIDE SLOPE
    // ========================================================

    function wideSlope(
      t,
      up
    ) {

      let a;
      let b;


      if (up) {

        a =
          PART.SlopeUpLeftWide;

        b =
          PART.SlopeUpRightWide;

      }

      else {

        a =
          PART.SlopeDownLeftWide;

        b =
          PART.SlopeDownRightWide;
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

          wideSlopeReverse(
            t,
            up
          );

        }

        else {

          wideSlopeSide(
            t,
            up
          );
        }

      }

      else {

        wideSlopeReverse(
          t,
          up
        );
      }
    }


    // ========================================================
    // WIDE SLOPE REVERSE
    // ========================================================

    function wideSlopeReverse(
      t,
      up
    ) {

      let a;
      let b;


      if (!up) {

        --lateral;
      }


      if (up) {

        a =
          PART.SlopeDownRightWide;

        b =
          PART.SlopeDownLeftWide;

      }

      else {

        a =
          PART.SlopeUpRightWide;

        b =
          PART.SlopeUpLeftWide;
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


    // ========================================================
    // WIDE SLOPE SIDE
    // ========================================================

    function wideSlopeSide(
      t,
      up
    ) {

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

          wideSlopeReverse(
            t,
            up
          );

        }

        else {

          wideSlopeSide(
            t,
            up
          );
        }

      }

      else {

        wideSlopeReverse(
          t,
          up
        );
      }
    }


    // ========================================================
    // RUN GENERATOR
    // ========================================================

    start(length);


    // ========================================================
    // EXPORT
    // ========================================================

    if (!collision) {

      const parts = [];


      for (
        const entry of
        occupied.values()
      ) {

        if (entry.type == null) {

          continue;
        }


        parts.push({

          // PolyTrack's generator uses
          // 4x logical coordinates.
          x: 4 * entry.x,

          y: entry.y,

          z: 4 * entry.z,


          partId:
            entry.type,


          rotation:
            entry.direction,


          rotationAxis:
            ROTATION_AXIS_Y_POSITIVE,


          color: 0,


          checkpointOrder:
            null,


          startOrder:
            entry.type === PART.Start
              ? 0
              : null,
        });
      }


      return {

        parts,

        logicalEntries:
          occupied.size,
      };
    }


    // Collision:
    // discard this attempt and regenerate.
  }
}


// ============================================================
// ADD CHECKPOINTS
// ============================================================

function addCheckpoints(
  parts,
  checkpointCount
) {

  if (checkpointCount <= 0) {

    return 0;
  }


  /*
   * IMPORTANT:
   *
   * Do NOT use every part as a candidate.
   *
   * A checkpoint must replace an actual narrow road
   * section.
   *
   * Straight = 0
   * Checkpoint = 52
   */

  const candidates = [];


  for (
    let i = 0;
    i < parts.length;
    i++
  ) {

    if (
      parts[i].partId ===
      PART.Straight
    ) {

      candidates.push(i);
    }
  }


  if (candidates.length === 0) {

    throw new Error(
      'The generated track contains no narrow straight sections for checkpoints.'
    );
  }


  /*
   * We cannot put more checkpoints than there
   * are straight road sections.
   */

  const count =
    Math.min(
      checkpointCount,
      candidates.length
    );


  /*
   * Select UNIQUE candidate indices.
   *
   * This is intentionally different from the
   * previous implementation.
   *
   * We use evenly distributed integer positions,
   * and explicitly prevent duplicates.
   */

  const selected = [];

  let previous =
    -1;


  for (
    let order = 0;
    order < count;
    order++
  ) {

    let index;


    if (count === 1) {

      index =
        Math.floor(
          candidates.length / 2
        );

    }

    else {

      index =
        Math.floor(
          (
            order *
            (candidates.length - 1)
          ) /
          (count - 1)
        );
    }


    /*
     * Make absolutely certain the candidate
     * hasn't already been selected.
     */

    if (index <= previous) {

      index =
        previous + 1;
    }


    if (
      index >= candidates.length
    ) {

      index =
        candidates.length - 1;
    }


    selected.push(
      candidates[index]
    );


    previous = index;
  }


  /*
   * Convert selected road pieces to
   * actual PolyTrack checkpoints.
   */

  for (
    let order = 0;
    order < selected.length;
    order++
  ) {

    const partIndex =
      selected[order];


    const part =
      parts[partIndex];


    part.partId =
      PART.Checkpoint;


    part.checkpointOrder =
      order;
  }


  return selected.length;
}


// ============================================================
// TRACK JSON
// ============================================================

function makeTrackData(
  parts,
  seed
) {

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
// MAIN
// ============================================================

function main() {

  const args =
    parseArgs(
      process.argv
    );


  console.log('');
  console.log(
    'PolyBuilder / PolyTrack Generator'
  );
  console.log(
    '----------------------------------'
  );
  console.log(
    `Seed:        ${args.seed}`
  );
  console.log(
    `Length:      ${args.length}`
  );
  console.log(
    `Checkpoints: ${args.checkpoints}`
  );
  console.log('');


  const rng =
    mulberry32(
      args.seed
    );


  // ----------------------------------------------------------
  // Generate normal track first.
  // ----------------------------------------------------------

  const result =
    generatePolyTrack(
      rng,
      args.length
    );


  // ----------------------------------------------------------
  // Add checkpoints after the track exists.
  // ----------------------------------------------------------

  const checkpointCount =
    addCheckpoints(
      result.parts,
      args.checkpoints
    );


  // ----------------------------------------------------------
  // Build final JSON.
  // ----------------------------------------------------------

  const data =
    makeTrackData(
      result.parts,
      args.seed
    );


  // ----------------------------------------------------------
  // Verify checkpoints BEFORE writing.
  // ----------------------------------------------------------

  const actualCheckpoints =
    data.track.parts.filter(
      part =>
        part.partId ===
        PART.Checkpoint
    );


  console.log(
    `Generated parts: ${data.track.parts.length}`
  );

  console.log(
    `Logical entries: ${result.logicalEntries}`
  );

  console.log(
    `Checkpoints added: ${checkpointCount}`
  );

  console.log(
    `Checkpoints found: ${actualCheckpoints.length}`
  );


  // ----------------------------------------------------------
  // Hard verification.
  // ----------------------------------------------------------

  if (
    actualCheckpoints.length !==
    checkpointCount
  ) {

    throw new Error(
      `Checkpoint verification failed: expected ` +
      `${checkpointCount}, found ` +
      `${actualCheckpoints.length}`
    );
  }


  for (
    let i = 0;
    i < actualCheckpoints.length;
    i++
  ) {

    if (
      actualCheckpoints[i]
        .checkpointOrder !== i
    ) {

      throw new Error(
        `Checkpoint order verification failed at index ${i}`
      );
    }
  }


  console.log(
    'Checkpoint verification: OK'
  );


  // ----------------------------------------------------------
  // Show checkpoint coordinates.
  // ----------------------------------------------------------

  for (
    const checkpoint of
    actualCheckpoints
  ) {

    console.log(
      `  Checkpoint ` +
      `${checkpoint.checkpointOrder + 1}: ` +
      `x=${checkpoint.x}, ` +
      `y=${checkpoint.y}, ` +
      `z=${checkpoint.z}, ` +
      `rotation=${checkpoint.rotation}`
    );
  }


  console.log('');


  // ----------------------------------------------------------
  // Write output.
  // ----------------------------------------------------------

  if (args.out) {

    fs.writeFileSync(
      args.out,
      JSON.stringify(
        data,
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
        data,
        null,
        2
      )
    );
  }
}


main();