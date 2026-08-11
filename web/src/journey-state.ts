import type { RoutePresetId } from "./world-data";

export const FINAL_STORY_ACT = 9;
export const TECHNICAL_ACT = 10;

export type JourneyAct = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface JourneyState {
  started: boolean;
  activeAct: JourneyAct;
  maxUnlockedAct: JourneyAct;
  routeSelected: RoutePresetId | null;
  routeLocked: boolean;
  heatAnimating: boolean;
  heatReleased: boolean;
  compareMode: boolean;
  technicalUnlocked: boolean;
  writtenFallback: boolean;
}

export type JourneyAction =
  | { type: "START" }
  | { type: "SET_ACTIVE_ACT"; act: JourneyAct }
  | { type: "SELECT_ROUTE"; routeId: RoutePresetId }
  | { type: "RELEASE_HEAT" }
  | { type: "COMPLETE_HEAT" }
  | { type: "PROCEED"; act: JourneyAct }
  | { type: "TOGGLE_COMPARE" }
  | { type: "SET_COMPARE"; enabled: boolean }
  | { type: "ENTER_WRITTEN_FALLBACK" }
  | { type: "WORLD_DATA_AVAILABLE" }
  | { type: "WORLD_CHANGED"; routeIds: readonly RoutePresetId[] }
  | { type: "REPLAY" };

export function createInitialJourneyState(): JourneyState {
  return {
    started: false,
    activeAct: 0,
    maxUnlockedAct: 0,
    routeSelected: null,
    routeLocked: false,
    heatAnimating: false,
    heatReleased: false,
    compareMode: false,
    technicalUnlocked: false,
    writtenFallback: false,
  };
}

export function isActUnlocked(state: JourneyState, act: JourneyAct): boolean {
  return state.started && act <= state.maxUnlockedAct;
}

export function canProceed(state: JourneyState, act: JourneyAct): boolean {
  if (!isActUnlocked(state, act) || act >= TECHNICAL_ACT) return false;
  if (act === 3) return state.writtenFallback || state.routeSelected !== null;
  if (act === 4) return state.writtenFallback || state.heatReleased;
  return true;
}

export function isCompareEligible(state: JourneyState): boolean {
  return (
    state.started &&
    state.routeLocked &&
    state.routeSelected !== null &&
    state.maxUnlockedAct >= 7
  );
}

function nextAct(act: JourneyAct): JourneyAct {
  return Math.min(TECHNICAL_ACT, act + 1) as JourneyAct;
}

export function reduceJourney(
  state: JourneyState,
  action: JourneyAction,
): JourneyState {
  switch (action.type) {
    case "START":
      if (state.started) return state;
      return {
        ...createInitialJourneyState(),
        started: true,
        writtenFallback: state.writtenFallback,
      };

    case "SET_ACTIVE_ACT":
      if (!isActUnlocked(state, action.act)) return state;
      return {
        ...state,
        activeAct: action.act,
        compareMode: action.act < 7 ? false : state.compareMode,
      };

    case "SELECT_ROUTE":
      if (!state.started || state.routeLocked || !action.routeId) return state;
      return {
        ...state,
        routeSelected: action.routeId,
        compareMode: false,
      };

    case "RELEASE_HEAT":
      if (
        !isActUnlocked(state, 4) ||
        state.heatAnimating ||
        state.heatReleased
      ) {
        return state;
      }
      return { ...state, heatAnimating: true, compareMode: false };

    case "COMPLETE_HEAT":
      if (!state.heatAnimating && state.heatReleased) return state;
      return {
        ...state,
        heatAnimating: false,
        heatReleased: true,
      };

    case "PROCEED": {
      if (!canProceed(state, action.act)) return state;
      const destination = nextAct(action.act);
      const maxUnlockedAct =
        action.act === state.maxUnlockedAct
          ? destination
          : state.maxUnlockedAct;
      return {
        ...state,
        activeAct: destination,
        maxUnlockedAct,
        routeLocked:
          action.act === 3 && !state.writtenFallback ? true : state.routeLocked,
        compareMode: destination < 7 ? false : state.compareMode,
        technicalUnlocked:
          state.technicalUnlocked || destination === TECHNICAL_ACT,
      };
    }

    case "TOGGLE_COMPARE":
      if (!isCompareEligible(state)) return state;
      return { ...state, compareMode: !state.compareMode };

    case "SET_COMPARE":
      if (action.enabled && !isCompareEligible(state)) return state;
      return { ...state, compareMode: action.enabled };

    case "ENTER_WRITTEN_FALLBACK":
      if (state.writtenFallback) return state;
      return {
        ...state,
        writtenFallback: true,
        routeSelected: null,
        routeLocked: false,
        heatAnimating: false,
        heatReleased: false,
        compareMode: false,
      };

    case "WORLD_DATA_AVAILABLE":
      if (!state.writtenFallback) return state;
      return { ...createInitialJourneyState(), started: state.started };

    case "WORLD_CHANGED": {
      if (
        state.routeSelected === null ||
        action.routeIds.includes(state.routeSelected)
      ) {
        return state;
      }
      const maxUnlockedAct = Math.min(state.maxUnlockedAct, 3) as JourneyAct;
      const activeAct = Math.min(state.activeAct, maxUnlockedAct) as JourneyAct;
      return {
        ...state,
        activeAct,
        maxUnlockedAct,
        routeSelected: null,
        routeLocked: false,
        heatAnimating: false,
        heatReleased: false,
        compareMode: false,
        technicalUnlocked: false,
      };
    }

    case "REPLAY":
      return {
        ...createInitialJourneyState(),
        writtenFallback: state.writtenFallback,
      };
  }
}
