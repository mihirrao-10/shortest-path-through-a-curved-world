import { describe, expect, it } from "vitest";
import {
  canProceed,
  createInitialJourneyState,
  isCompareEligible,
  reduceJourney,
  type JourneyState,
} from "../src/journey-state";

function startJourney(): JourneyState {
  return reduceJourney(createInitialJourneyState(), { type: "START" });
}

function unlockThroughRouteChoice(): JourneyState {
  let state = startJourney();
  for (const act of [0, 1, 2] as const) {
    state = reduceJourney(state, { type: "PROCEED", act });
  }
  return state;
}

describe("journey state", () => {
  it("begins before Start with only act zero queued", () => {
    expect(createInitialJourneyState()).toEqual({
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
    });
  });

  it("starts at act zero and unlocks exactly one act per frontier Proceed", () => {
    let state = startJourney();
    expect(state.started).toBe(true);
    expect(state.maxUnlockedAct).toBe(0);
    state = reduceJourney(state, { type: "PROCEED", act: 0 });
    expect(state).toMatchObject({ activeAct: 1, maxUnlockedAct: 1 });
    state = reduceJourney(state, { type: "PROCEED", act: 0 });
    expect(state).toMatchObject({ activeAct: 1, maxUnlockedAct: 1 });
  });

  it("never activates a locked chapter", () => {
    const state = reduceJourney(startJourney(), {
      type: "SET_ACTIVE_ACT",
      act: 7,
    });
    expect(state.activeAct).toBe(0);
    expect(state.maxUnlockedAct).toBe(0);
  });

  it("separates route selection from commitment", () => {
    let state = unlockThroughRouteChoice();
    expect(canProceed(state, 3)).toBe(false);
    state = reduceJourney(state, {
      type: "SELECT_ROUTE",
      routeId: "central-neck",
    });
    expect(state.routeSelected).toBe("central-neck");
    expect(state.routeLocked).toBe(false);
    expect(canProceed(state, 3)).toBe(true);
    state = reduceJourney(state, { type: "PROCEED", act: 3 });
    expect(state).toMatchObject({
      activeAct: 4,
      maxUnlockedAct: 4,
      routeSelected: "central-neck",
      routeLocked: true,
    });
    expect(
      reduceJourney(state, {
        type: "SELECT_ROUTE",
        routeId: "basin-rim",
      }).routeSelected,
    ).toBe("central-neck");
  });

  it("gates heat until completion and preserves the completed milestone", () => {
    let state = unlockThroughRouteChoice();
    state = reduceJourney(state, {
      type: "SELECT_ROUTE",
      routeId: "outer-ridge",
    });
    state = reduceJourney(state, { type: "PROCEED", act: 3 });
    expect(canProceed(state, 4)).toBe(false);
    state = reduceJourney(state, { type: "RELEASE_HEAT" });
    expect(state.heatAnimating).toBe(true);
    expect(canProceed(state, 4)).toBe(false);
    state = reduceJourney(state, { type: "COMPLETE_HEAT" });
    expect(state).toMatchObject({ heatAnimating: false, heatReleased: true });
    expect(canProceed(state, 4)).toBe(true);
    expect(reduceJourney(state, { type: "RELEASE_HEAT" })).toBe(state);
  });

  it("makes comparison eligible only after its chapter is unlocked", () => {
    let state = unlockThroughRouteChoice();
    state = reduceJourney(state, {
      type: "SELECT_ROUTE",
      routeId: "outer-ridge",
    });
    state = reduceJourney(state, { type: "PROCEED", act: 3 });
    state = reduceJourney(state, { type: "RELEASE_HEAT" });
    state = reduceJourney(state, { type: "COMPLETE_HEAT" });
    for (const act of [4, 5, 6] as const) {
      expect(isCompareEligible(state)).toBe(false);
      state = reduceJourney(state, { type: "PROCEED", act });
    }
    expect(isCompareEligible(state)).toBe(true);
    state = reduceJourney(state, { type: "TOGGLE_COMPARE" });
    expect(state.compareMode).toBe(true);
    state = reduceJourney(state, { type: "TOGGLE_COMPARE" });
    expect(state.compareMode).toBe(false);
  });

  it("preserves a committed route across compatible worlds and safely relocks an incompatible world", () => {
    let state = unlockThroughRouteChoice();
    state = reduceJourney(state, {
      type: "SELECT_ROUTE",
      routeId: "basin-rim",
    });
    state = reduceJourney(state, { type: "PROCEED", act: 3 });
    const compatible = reduceJourney(state, {
      type: "WORLD_CHANGED",
      routeIds: ["outer-ridge", "central-neck", "basin-rim"],
    });
    expect(compatible).toBe(state);
    const incompatible = reduceJourney(state, {
      type: "WORLD_CHANGED",
      routeIds: ["different-route"],
    });
    expect(incompatible).toMatchObject({
      activeAct: 3,
      maxUnlockedAct: 3,
      routeSelected: null,
      routeLocked: false,
      heatReleased: false,
      compareMode: false,
    });
  });

  it("replay restores the exact pre-Start state", () => {
    let state = unlockThroughRouteChoice();
    state = reduceJourney(state, {
      type: "SELECT_ROUTE",
      routeId: "outer-ridge",
    });
    expect(reduceJourney(state, { type: "REPLAY" })).toEqual(
      createInitialJourneyState(),
    );
  });

  it("keeps every written chapter reachable when world data is unavailable", () => {
    let state = reduceJourney(createInitialJourneyState(), {
      type: "ENTER_WRITTEN_FALLBACK",
    });
    state = reduceJourney(state, { type: "START" });
    for (const act of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const) {
      expect(canProceed(state, act)).toBe(true);
      state = reduceJourney(state, { type: "PROCEED", act });
    }
    expect(state).toMatchObject({
      activeAct: 10,
      technicalUnlocked: true,
      routeSelected: null,
      routeLocked: false,
      heatReleased: false,
      writtenFallback: true,
    });
    expect(isCompareEligible(state)).toBe(false);
    expect(reduceJourney(state, { type: "REPLAY" }).writtenFallback).toBe(true);
  });
});
