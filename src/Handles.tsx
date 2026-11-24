import { Handle, Position } from "@xyflow/react";

const SIDES: [string, Position][] = [["t", Position.Top], ["r", Position.Right], ["b", Position.Bottom], ["l", Position.Left]];

/** A connection point on every side. Edges pick the best side automatically (see lines.ts). */
export function AllHandles({ hidden }: { hidden?: boolean }) {
  return (
    <>
      {SIDES.map(([id, pos]) => (
        <span key={id}>
          <Handle id={`s-${id}`} type="source" position={pos} className={hidden ? "frame-hdl" : undefined} />
          <Handle id={`t-${id}`} type="target" position={pos} className="h-target" />
        </span>
      ))}
    </>
  );
}
