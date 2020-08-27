import { assert } from 'devAssert';
import { drawablePush, drawableRemove } from 'drawables';
import { eventQueuePush } from 'eventQueue';
import { fps, getNextFrame } from 'frame';
import { fromHash, hexRange, hexVertices, neighborHexes, Point } from 'hex';
import { deduceResources, getMissingResourceInfo, Requirements } from 'resources';
import { getTextImage } from 'text';

type BuildingName = 'blank' | 'townCenter' | 'lumberjackHut' | 'tower';
type AreaExpandingBuilding = 'townCenter' | 'tower';

interface BuildingInfo {
  name: BuildingName;
  hex: Point<true>;
  drawableHandle: number;
}

const buildingDefs: Readonly<Record<
  BuildingName,
  {
    name: string;
    requirements: Requirements;
  }
>> = {
  blank: {
    name: '-',
    requirements: [],
  },
  townCenter: {
    name: 'town center',
    requirements: [],
  },
  lumberjackHut: {
    name: "lumberjack's hut",
    requirements: [
      ['wood', 2],
      ['stone', 2],
    ],
  },
  tower: {
    name: 'tower',
    requirements: [
      ['wood', 2],
      ['stone', 3],
    ],
  },
};

const areaExpandRadius = 2;
const buildings = new Map<string, BuildingInfo>();
const buildingsToDestroy = new Set<string>();
const borderHashes = new Set<string>();
let borderEstabilished = false;

export function buildingsInit(): void {
  if (!borderEstabilished) {
    drawablePush(drawBorder);
    eventQueuePush({
      run: animateBorder,
      duration: Infinity,
    });
    borderEstabilished = true;
  }

  buildings.clear();
  addAreaExpandingBuilding(new Point(0, 0), 'townCenter');
  addAreaExpandingBuilding(new Point(2, -2), 'tower');
  addAreaExpandingBuilding(new Point(3, -1), 'tower');
  removeAreaExpandingBuilding(new Point(2, -2));
}

function addAreaExpandingBuilding(hex: Point<true>, name: AreaExpandingBuilding): void {
  setBuilding(hex, name, true);
  recalculateBorder(hex);
}

function removeAreaExpandingBuilding(hex: Point<true>): void {
  assert(buildings.has(hex.toHash()), 'The building does not exist on the map');
  assert(
    ['townCenter', 'tower'].includes(buildings.get(hex.toHash())!.name),
    'The building does not expand the area',
  );
  setBuilding(hex, 'blank', true);
  recalculateBorder(hex);
}

function setBuilding(hex: Point<true>, name: BuildingName, overwrite: boolean): void {
  const hash = hex.toHash();
  if (buildings.has(hash)) {
    if (!overwrite) {
      return;
    }
    drawableRemove(buildings.get(hash)!.drawableHandle);
  }
  buildings.set(hash, {
    name,
    hex,
    drawableHandle: drawablePush(
      drawHex({
        name: buildingDefs[name].name,
        hex,
      }),
      hex,
    ),
  });
}

function recalculateBorder(hex: Point<true>): void {
  const add = buildings.get(hex.toHash())!.name !== 'blank';

  if (add) {
    const neighborInnerHashes = new Set<string>();

    for (const neighborHex of hexRange(areaExpandRadius * 2)) {
      const building = buildings.get(hex.add(neighborHex).toHash());
      if (building && (building.name === 'townCenter' || building.name === 'tower')) {
        for (const neighborHex of hexRange(areaExpandRadius - 1)) {
          neighborInnerHashes.add(building.hex.add(neighborHex).toHash());
        }
      }
    }

    for (const neighborHex of hexRange(areaExpandRadius)) {
      setBuilding(hex.add(neighborHex), 'blank', false);
    }

    for (const neighborHex of hexRange(areaExpandRadius, areaExpandRadius)) {
      const hash = hex.add(neighborHex).toHash();
      if (!neighborInnerHashes.has(hash)) {
        borderHashes.add(hash);
      }
    }

    for (const neighborHex of hexRange(areaExpandRadius - 1)) {
      const hash = hex.add(neighborHex).toHash();
      borderHashes.delete(hash);
    }
  } else {
    const neighborBorderHashes = new Set<string>();
    const neighborInnerHashes = new Set<string>();

    for (const neighborHex of hexRange(areaExpandRadius * 2)) {
      const building = buildings.get(hex.add(neighborHex).toHash());
      if (building && (building.name === 'townCenter' || building.name === 'tower')) {
        for (const neighborHex of hexRange(areaExpandRadius, areaExpandRadius)) {
          neighborBorderHashes.add(building.hex.add(neighborHex).toHash());
        }
        for (const neighborHex of hexRange(areaExpandRadius - 1)) {
          neighborInnerHashes.add(building.hex.add(neighborHex).toHash());
        }
      }
    }

    for (const neighborHash of neighborInnerHashes) {
      neighborBorderHashes.delete(neighborHash);
    }

    for (const neighborHex of hexRange(areaExpandRadius)) {
      const hash = hex.add(neighborHex).toHash();
      if (neighborBorderHashes.has(hash)) {
        borderHashes.add(hash);
      } else if (!neighborInnerHashes.has(hash)) {
        const building = buildings.get(hash);
        assert(building, "The building has to be there since it's a neighbor of a deleted hex");
        drawableRemove(building.drawableHandle);
        buildings.delete(hash);
        buildingsToDestroy.add(hash);
        borderHashes.delete(hash);
      }
    }
  }
}

export function addBuildingButton(name: BuildingName): void {
  const button = document.createElement('button');
  button.textContent = `Build ${buildingDefs[name].name}`;
  button.addEventListener('click', () => {
    build(name);
  });
  document.body.append(button);
}

function build(name: BuildingName): void {
  const building = buildingDefs[name];
  const missingResourceInfo = getMissingResourceInfo(building.requirements);

  if (missingResourceInfo.length > 0) {
    const pre = document.createElement('pre');
    pre.textContent = missingResourceInfo.join('\n');
    document.body.append(pre);
    eventQueuePush({
      frame: getNextFrame(5000),
      run: () => {
        document.body.removeChild(pre);
      },
    });
  } else {
    deduceResources(building.requirements);
  }
}

function drawHex({ name, hex }: { name: string; hex: Point<true> }) {
  return (context: CanvasRenderingContext2D, hoveredHex: Point<true> | undefined): void => {
    const relativeMid = hex.toCanvas();

    if (hoveredHex && hex.equal(hoveredHex)) {
      context.beginPath();
      const [firstHex, ...restHexes] = hexVertices;
      context.moveTo(...relativeMid.add(firstHex).toArray());
      for (const restHex of restHexes) {
        context.lineTo(...relativeMid.add(restHex).toArray());
      }
      context.closePath();

      context.fillStyle = '#fffa';

      context.fill();
    }

    const text = getTextImage(name, [0, 0, 0]);
    context.drawImage(
      text,
      ...relativeMid.add(new Point<false>(text.width, text.height).mul(-1.5)).round().toArray(),
      text.width * 3,
      text.height * 3,
    );
  };
}

const dashLength = 6;
const dashSpace = 4;
const dashSpeed = (dashLength + dashSpace) / fps / 0.8;
let borderLineDashOffset = 0;

function drawBorder(context: CanvasRenderingContext2D): void {
  context.beginPath();

  for (const hash of borderHashes) {
    const hex = fromHash(hash);
    const relativeMid = hex.toCanvas();
    for (let index = 0; index < 6; index += 1) {
      if (!buildings.has(hex.add(neighborHexes[index]).toHash())) {
        context.moveTo(...relativeMid.add(hexVertices[index]).toArray());
        context.lineTo(...relativeMid.add(hexVertices[(index + 1) % 6]).toArray());
      }
    }
  }

  context.lineJoin = 'round';
  context.lineWidth = 4;
  context.strokeStyle = 'white';
  context.lineDashOffset = borderLineDashOffset;
  context.setLineDash([dashLength, dashSpace]);

  context.stroke();

  context.lineDashOffset = 0;
  context.setLineDash([]);
}

function animateBorder(currentFrame: number): void {
  borderLineDashOffset = (currentFrame * dashSpeed) % (dashLength + dashSpace);
}
