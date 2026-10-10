import { memo } from 'react';

/**
 * The picture behind the content: a soft field with geraniums, drawn as an inline SVG so it
 * follows the light/dark theme (colours come from CSS variables) and loads nothing from
 * outside. It sits under the cards, which stay opaque, so figures are never drawn over it.
 */

export type BackdropKind = 'geraniums' | 'field' | 'plain';

const r1 = (n: number) => Math.round(n * 10) / 10;

/** One five-petalled geranium flower. */
function Flower({ x, y, r, turn }: { x: number; y: number; r: number; turn: number }) {
  return (
    <g transform={`translate(${r1(x)} ${r1(y)}) rotate(${turn})`}>
      {[0, 72, 144, 216, 288].map((a) => (
        <ellipse key={a} cx={0} cy={r1(-r * 0.55)} rx={r1(r * 0.48)} ry={r1(r * 0.62)} transform={`rotate(${a})`} className="art-petal" />
      ))}
      <circle r={r1(r * 0.2)} className="art-centre" />
    </g>
  );
}

/** A rounded flower head of several flowers, as geraniums grow. */
function Umbel({ x, y, r }: { x: number; y: number; r: number }) {
  const spots: [number, number][] = [[0, 0], [-1.05, 0.25], [1.05, 0.25], [-0.55, -0.75], [0.55, -0.75], [0, -1.25], [-1.35, -0.6], [1.35, -0.6], [-0.5, 0.75], [0.6, 0.7]];
  return (
    <g>
      {spots.map(([dx, dy], i) => <Flower key={i} x={x + dx * r * 0.95} y={y + dy * r * 0.85} r={r * (i < 6 ? 0.62 : 0.5)} turn={(i * 37) % 72} />)}
    </g>
  );
}

/** A round, softly scalloped geranium leaf with its darker band. */
function Leaf({ x, y, r, tilt }: { x: number; y: number; r: number; tilt: number }) {
  const pts: string[] = [];
  for (let i = 0; i <= 64; i++) {
    const t = (i / 64) * Math.PI * 2;
    // A notch where the stalk joins, and gentle scallops round the edge.
    const notch = 1 - 0.28 * Math.exp(-((t - Math.PI / 2) ** 2) / 0.05);
    const rr = r * (1 + 0.09 * Math.cos(7 * t)) * notch;
    pts.push(`${r1(Math.cos(t) * rr)},${r1(Math.sin(t) * rr)}`);
  }
  return (
    <g transform={`translate(${r1(x)} ${r1(y)}) rotate(${tilt})`}>
      <polygon points={pts.join(' ')} className="art-leaf" />
      <circle r={r1(r * 0.55)} className="art-leaf-band" />
    </g>
  );
}

function Plant({ x, ground, scale }: { x: number; ground: number; scale: number }) {
  const s = scale;
  const heads: [number, number, number][] = [[-60, -250, 34], [35, -300, 40], [110, -225, 30]];
  return (
    <g>
      {heads.map(([dx, dy], i) => (
        <path key={i} d={`M${x + dx * 0.25 * s} ${ground} Q${x + dx * 0.6 * s} ${ground + dy * 0.5 * s} ${x + dx * s} ${ground + dy * s}`} className="art-stem" />
      ))}
      {[[-95, -70, 46, -20], [70, -90, 52, 15], [-20, -120, 44, 5], [140, -40, 40, 30], [-150, -30, 38, -35], [20, -40, 50, 0]].map(([dx, dy, r, t], i) => (
        <Leaf key={i} x={x + dx * s} y={ground + dy * s} r={r * s} tilt={t} />
      ))}
      {heads.map(([dx, dy, r], i) => <Umbel key={i} x={x + dx * s} y={ground + dy * s} r={r * s} />)}
    </g>
  );
}

/** Small flowers and grass scattered over the field. */
function Meadow() {
  const out = [];
  for (let i = 0; i < 46; i++) {
    const x = (i * 211) % 1600;
    const y = 352 + ((i * 53) % 60);
    out.push(<path key={`g${i}`} d={`M${x} ${y} q3 -16 ${i % 2 ? 7 : -5} -26`} className="art-grass" />);
    if (i % 3 === 0) out.push(<circle key={`f${i}`} cx={x + 4} cy={y - 24} r={3.4} className={i % 2 ? 'art-dot-a' : 'art-dot-b'} />);
  }
  return <g>{out}</g>;
}

export const Backdrop = memo(function Backdrop({ kind }: { kind: BackdropKind }) {
  if (kind === 'plain') return null;
  return (
    <div className="backdrop" aria-hidden="true">
      <svg className="backdrop-field" viewBox="0 0 1600 420" preserveAspectRatio="xMidYMax slice" focusable="false">
        <path d="M0 300 C220 250 420 262 640 286 C860 310 1080 250 1300 236 C1420 228 1520 240 1600 252 L1600 420 L0 420 Z" className="art-hill-1" />
        <path d="M0 336 C260 300 520 318 780 334 C1040 350 1280 306 1600 300 L1600 420 L0 420 Z" className="art-hill-2" />
        <path d="M0 372 C300 352 600 366 900 376 C1200 386 1400 362 1600 358 L1600 420 L0 420 Z" className="art-hill-3" />
        <Meadow />
      </svg>
      {kind === 'geraniums' && (
        <>
          {/* Each plant is anchored to its own corner so it is never cut off, whatever the window size. */}
          <svg className="backdrop-plant backdrop-plant-left" viewBox="0 0 260 420" preserveAspectRatio="xMinYMax meet" focusable="false">
            <Plant x={130} ground={410} scale={0.62} />
          </svg>
          <svg className="backdrop-plant backdrop-plant-right" viewBox="0 0 400 420" preserveAspectRatio="xMaxYMax meet" focusable="false">
            <Plant x={200} ground={402} scale={0.95} />
          </svg>
        </>
      )}
    </div>
  );
});
