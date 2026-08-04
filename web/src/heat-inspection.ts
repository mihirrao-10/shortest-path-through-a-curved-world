import type { WorldData } from "./world-data";

export type HeatInspectionState = "early" | "middle" | "late";

export interface HeatInspectionFrame {
  state: HeatInspectionState;
  frameIndex: number;
  time: number;
}

export function selectHeatInspectionFrames(
  data: Pick<WorldData, "heatFrameCount" | "frameTimes">,
): HeatInspectionFrame[] {
  const last = data.heatFrameCount - 1;
  const selections: Array<[HeatInspectionState, number]> = [
    ["early", 0],
    ["middle", Math.round(last / 2)],
    ["late", last],
  ];
  return selections.map(([state, frameIndex]) => ({
    state,
    frameIndex,
    time: data.frameTimes[frameIndex]!,
  }));
}
