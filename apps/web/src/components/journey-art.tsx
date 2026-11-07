/** Small animated illustrations for the five-step journey. Decorative; the step text carries the meaning. */

export function SubmitArt() {
  return (
    <svg aria-hidden="true" className="art art-submit" viewBox="0 0 160 96">
      <rect className="a-frame" height="34" rx="17" width="140" x="10" y="31" />
      <path className="a-lock" d="M28 46v-3a5 5 0 0 1 10 0v3M26 46h14v10H26z" />
      <rect className="a-type t1" height="4" rx="2" width="22" x="48" y="46" />
      <rect className="a-type t2" height="4" rx="2" width="30" x="74" y="46" />
      <rect className="a-type t3" height="4" rx="2" width="16" x="108" y="46" />
      <rect className="a-caret" height="14" width="2" x="128" y="41" />
    </svg>
  );
}

export function InvestigateArt() {
  return (
    <svg aria-hidden="true" className="art art-radar" viewBox="0 0 160 96">
      <circle className="a-ring" cx="80" cy="48" r="40" />
      <circle className="a-ring" cx="80" cy="48" r="26" />
      <circle className="a-ring" cx="80" cy="48" r="12" />
      <path className="a-cross" d="M80 6v84M38 48h84" />
      <g className="a-sweep">
        <path d="M80 48 L80 8 A40 40 0 0 1 114.6 28 Z" />
      </g>
      <circle className="a-blip b1" cx="101" cy="32" r="3" />
      <circle className="a-blip b2" cx="62" cy="64" r="3" />
      <circle className="a-blip b3 threat" cx="104" cy="66" r="3.5" />
    </svg>
  );
}

export function AnalyseArt() {
  const nodes: Array<[number, number]> = [[24, 52], [58, 24], [64, 70], [100, 44], [136, 22], [134, 72]];
  const edges: Array<[number, number]> = [[0, 1], [0, 2], [1, 3], [2, 3], [3, 4], [3, 5], [1, 4]];
  return (
    <svg aria-hidden="true" className="art art-graph" viewBox="0 0 160 96">
      {edges.map(([a, b]) => (
        <line className="a-edge" key={`${a}-${b}`} x1={nodes[a]![0]} x2={nodes[b]![0]} y1={nodes[a]![1]} y2={nodes[b]![1]} />
      ))}
      {nodes.map(([x, y], index) => (
        <circle className={index === 5 ? "a-node threat" : "a-node"} cx={x} cy={y} key={index} r={index === 3 ? 7 : 5} style={{ animationDelay: `${index * 0.35}s` }} />
      ))}
    </svg>
  );
}

export function AssessArt() {
  return (
    <svg aria-hidden="true" className="art art-gauge" viewBox="0 0 160 96">
      <path className="a-seg ok" d="M30 80 A50 50 0 0 1 47 43" />
      <path className="a-seg warn" d="M52 38 A50 50 0 0 1 108 38" />
      <path className="a-seg bad" d="M113 43 A50 50 0 0 1 130 80" />
      <g className="a-needle">
        <line x1="80" x2="80" y1="80" y2="40" />
      </g>
      <circle className="a-hub" cx="80" cy="80" r="5" />
    </svg>
  );
}

export function VerifyArt() {
  return (
    <svg aria-hidden="true" className="art art-ledger" viewBox="0 0 160 96">
      <rect className="a-block" height="34" rx="8" width="34" x="14" y="31" />
      <rect className="a-block" height="34" rx="8" width="34" x="63" y="31" />
      <rect className="a-block live" height="34" rx="8" width="34" x="112" y="31" />
      <path className="a-link" d="M48 48h15M97 48h15" />
      <path className="a-check" d="M121 48l6 6 11-12" />
    </svg>
  );
}
