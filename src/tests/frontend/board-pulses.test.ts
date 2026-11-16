import { describe, expect, it } from "vitest";
import type { LiveEventBuffers, PulseGates } from "frontend/components/match/board-pulses";
import { createPulseGates, deriveBoardPulses } from "frontend/components/match/board-pulses";
import type { MatchUnit, MatchView } from "frontend/components/match/match-view";
import type { TurnSnapshot } from "frontend/components/match/turn-snapshot-view";
import type { ActionQueueState, ActionKind, QueuedAction } from "frontend/utils/action-queue";
import type { MainAction } from "shared/schemas/action";

// Minimal plain fixtures — the derivation only reads turn/turnStart/crashes/units, so we cast past
// the large inferred wire types (same approach as optimistic-view.test.ts).
const unit = (position: [number, number], over: Partial<MatchUnit> = {}): MatchUnit =>
  ({ type: "infantry", playerSlot: 0, position, ...over }) as unknown as MatchUnit;

const view = (over: Partial<MatchView> = {}): MatchView =>
  ({ turn: 1, units: [], turnStart: null, crashes: null, ...over }) as unknown as MatchView;

let seq = 0;
const queued = (kind: ActionKind, action: MainAction): QueuedAction => ({
  clientId: `c${seq}`,
  seq: seq++,
  kind,
  action,
  status: "pending",
});

const queue = (...actions: QueuedAction[]): ActionQueueState =>
  ({ actions }) as unknown as ActionQueueState;

const movePath = (...path: [number, number][]): MainAction => ({
  type: "move",
  path,
  subAction: { type: "wait" },
});

const buffers = (over: Partial<Record<keyof LiveEventBuffers, unknown>> = {}): LiveEventBuffers =>
  ({
    opponentMovePaths: { current: [] },
    destroyedPositions: { current: [] },
    capturePositions: { current: [] },
    ...over,
  }) as LiveEventBuffers;

type Overrides = Partial<Parameters<typeof deriveBoardPulses>[0]>;

const derive = (gates: PulseGates, over: Overrides = {}) =>
  deriveBoardPulses({
    view: view(),
    playerId: "me",
    actingPlayerId: "me",
    animationScope: "all",
    queue: queue(),
    snapshot: null,
    dataUpdatedAt: 1,
    gates,
    live: buffers(),
    ...over,
  });

describe("board pulse derivation", () => {
  describe("start-of-turn flourish", () => {
    const turnStart = { playerId: "me", repaired: [{ position: [1, 1] }], refuelled: [[2, 2]] };

    it("fires on the first render of a turn and not on the rebuilds after it", () => {
      const gates = createPulseGates();
      const params = { view: view({ turnStart } as Partial<MatchView>) };

      expect(derive(gates, params).turnStartPulse).toEqual({
        repaired: [[1, 1]],
        refuelled: [[2, 2]],
      });
      expect(derive(gates, params).turnStartPulse).toBeUndefined();
    });

    it("fires again for the other player on the SAME day (the gate is player-keyed)", () => {
      const gates = createPulseGates();

      derive(gates, { view: view({ turnStart } as Partial<MatchView>) });
      const other = { ...turnStart, playerId: "them" };

      expect(
        derive(gates, { view: view({ turnStart: other } as Partial<MatchView>) }).turnStartPulse,
      ).toBeDefined();
    });

    it("stays quiet for the opponent's upkeep when the scope is own-only", () => {
      const other = { ...turnStart, playerId: "them" };

      expect(
        derive(createPulseGates(), {
          animationScope: "own",
          view: view({ turnStart: other } as Partial<MatchView>),
        }).turnStartPulse,
      ).toBeUndefined();
    });
  });

  describe("fuel-out crashes", () => {
    const crashes = { playerId: "them", positions: [[3, 4]] };

    it("plays the opponent's crashes on its own gate, once", () => {
      const gates = createPulseGates();
      const params = { view: view({ crashes } as Partial<MatchView>) };

      expect(derive(gates, params).crashPulse).toEqual({ positions: [[3, 4]] });
      expect(derive(gates, params).crashPulse).toBeUndefined();
    });

    it("does not fire for an empty crash report", () => {
      const empty = { playerId: "them", positions: [] } as unknown as MatchView["crashes"];

      expect(
        derive(createPulseGates(), { view: view({ crashes: empty } as Partial<MatchView>) })
          .crashPulse,
      ).toBeUndefined();
    });
  });

  describe("buffered own moves", () => {
    it("slides each buffered move exactly once within a turn", () => {
      const gates = createPulseGates();
      const q = queue(queued("move", movePath([0, 0], [1, 0])));

      expect(derive(gates, { queue: q }).movePulses).toEqual([
        {
          path: [
            [0, 0],
            [1, 0],
          ],
        },
      ]);
      expect(derive(gates, { queue: q }).movePulses).toEqual([]);
    });

    it("animates a move that ends in an attack — the unit walks the path either way", () => {
      const q = queue(queued("attack", movePath([0, 0], [1, 0])));

      expect(derive(createPulseGates(), { queue: q }).movePulses).toHaveLength(1);
    });

    it("ignores a zero-length move (the unit never leaves its tile)", () => {
      const q = queue(queued("move", movePath([0, 0])));

      expect(derive(createPulseGates(), { queue: q }).movePulses).toEqual([]);
    });

    it("re-animates after a turn change, since the play-once sets are cleared", () => {
      const gates = createPulseGates();
      const q = queue(queued("move", movePath([0, 0], [1, 0])));

      derive(gates, { queue: q });

      expect(derive(gates, { queue: q, view: view({ turn: 2 }) }).movePulses).toHaveLength(1);
    });

    it("stays still when animations are off", () => {
      const q = queue(queued("move", movePath([0, 0], [1, 0])));

      expect(derive(createPulseGates(), { animationScope: "none", queue: q }).movePulses).toEqual(
        [],
      );
    });
  });

  describe("buffered own captures", () => {
    const capture = () => queue(queued("capture", movePath([0, 0], [1, 0])));

    it("marks the capture completed when the unit's rate finishes it off", () => {
      const snapshot = {
        units: [{ position: [0, 0], currentCapturePoints: 10, captureRate: 10 }],
      } as unknown as TurnSnapshot;

      expect(derive(createPulseGates(), { queue: capture(), snapshot }).capturePulses).toEqual([
        { position: [1, 0], completed: true, full: true },
      ]);
    });

    it("leaves it in progress when the rate falls short", () => {
      const snapshot = {
        units: [{ position: [0, 0], currentCapturePoints: 20, captureRate: 5 }],
      } as unknown as TurnSnapshot;

      expect(
        derive(createPulseGates(), { queue: capture(), snapshot }).capturePulses[0].completed,
      ).toBe(false);
    });

    it("keeps the lightweight indicator (full: false) when animations are off", () => {
      expect(
        derive(createPulseGates(), { animationScope: "none", queue: capture() }).capturePulses,
      ).toEqual([{ position: [1, 0], completed: false, full: false }]);
    });
  });

  describe("live opponent events", () => {
    it("drains a batch once per authoritative fetch and clears the buffers", () => {
      const gates = createPulseGates();
      const live = buffers({
        opponentMovePaths: {
          current: [
            [
              [0, 0],
              [1, 0],
            ],
          ],
        },
        destroyedPositions: { current: [[5, 5]] },
      });

      const first = derive(gates, { actingPlayerId: "them", live });

      expect(first.movePulses).toHaveLength(1);
      expect(first.deathPulses).toEqual([[5, 5]]);
      expect(live.opponentMovePaths.current).toEqual([]);

      expect(derive(gates, { actingPlayerId: "them", live }).movePulses).toEqual([]);
    });

    it("suppresses opponent moves when the scope is own-only", () => {
      const live = buffers({
        opponentMovePaths: {
          current: [
            [
              [0, 0],
              [1, 0],
            ],
          ],
        },
      });

      expect(
        derive(createPulseGates(), { animationScope: "own", actingPlayerId: "them", live })
          .movePulses,
      ).toEqual([]);
    });

    it("still shows destructions on an own-only scope — a kill is public", () => {
      const live = buffers({ destroyedPositions: { current: [[5, 5]] } });

      expect(
        derive(createPulseGates(), { animationScope: "own", actingPlayerId: "them", live })
          .deathPulses,
      ).toEqual([[5, 5]]);
    });

    it("hides destructions only when animations are off entirely", () => {
      const live = buffers({ destroyedPositions: { current: [[5, 5]] } });

      expect(
        derive(createPulseGates(), { animationScope: "none", actingPlayerId: "them", live })
          .deathPulses,
      ).toEqual([]);
    });

    it("discards an accumulated ability position that isn't an infantry/mech capture", () => {
      const live = buffers({ capturePositions: { current: [[2, 2]] } });

      expect(
        derive(createPulseGates(), {
          actingPlayerId: "them",
          live,
          view: view({ units: [unit([2, 2], { type: "apc" } as Partial<MatchUnit>)] }),
        }).capturePulses,
      ).toEqual([]);
    });

    it("reads a vanished capture-points field as the tick that completed the capture", () => {
      const live = buffers({ capturePositions: { current: [[2, 2]] } });

      expect(
        derive(createPulseGates(), {
          actingPlayerId: "them",
          live,
          view: view({ units: [unit([2, 2])] }),
        }).capturePulses,
      ).toEqual([{ position: [2, 2], completed: true, full: true }]);
    });
  });
});
