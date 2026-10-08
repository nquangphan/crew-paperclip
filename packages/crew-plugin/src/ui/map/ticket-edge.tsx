import { createElement as h } from "react";
import { BaseEdge, getSmoothStepPath } from "@xyflow/react";

export const edgeKinds = {
  parent: { label: "Thuộc yêu cầu", className: "crew-map-edge-parent" },
  dependency: { label: "Phải xong trước", className: "crew-map-edge-dependency" },
  repair: { label: "Vòng sửa", className: "crew-map-edge-repair" },
} as const;

type Props = {
  source: string; target: string; sourceX: number; sourceY: number; targetX: number; targetY: number;
  sourcePosition: unknown; targetPosition: unknown; markerEnd?: string;
  data?: { label?: string };
};

function draw(kind: keyof typeof edgeKinds, props: Props) {
  const path = props.source === props.target
    ? `M ${props.sourceX},${props.sourceY} C ${props.sourceX + 70},${props.sourceY - 70} ${props.targetX + 70},${props.targetY + 70} ${props.targetX},${props.targetY}`
    : getSmoothStepPath({
      sourceX: props.sourceX, sourceY: props.sourceY, targetX: props.targetX, targetY: props.targetY,
      sourcePosition: props.sourcePosition as never, targetPosition: props.targetPosition as never,
      borderRadius: 0,
    })[0];
  return h(BaseEdge, { path, markerEnd: props.markerEnd, className: edgeKinds[kind].className,
    interactionWidth: 12, "aria-label": props.data?.label ?? edgeKinds[kind].label });
}

export const ParentEdge = (props: Props) => draw("parent", props);
export const DependencyEdge = (props: Props) => draw("dependency", props);
export const RepairEdge = (props: Props) => draw("repair", props);
export const ticketEdgeTypes = { parent: ParentEdge, dependency: DependencyEdge, repair: RepairEdge };
