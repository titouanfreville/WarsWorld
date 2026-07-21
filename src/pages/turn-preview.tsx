import { TurnStartBanner } from "frontend/components/match/hud/TurnStartBanner";
import type { NextPageWithLayout } from "frontend/types/page";
import { ARMIES, CO_NAMES, type Army } from "frontend/utils/sprites";
import { useMemo, useState } from "react";

/**
 * DEV-ONLY preview of the start-of-turn banner ({@link TurnStartBanner}) — the acting CO's mugshot +
 * name (army-themed), "DAY N", and the own-turn upkeep line vs the opponent's "enemy turn". Pick any
 * CO / army / perspective and replay the entrance. Not linked anywhere; safe to delete. The real
 * banner is driven live from the board (see useTurnBanner in MatchBoardV2).
 */

const input: React.CSSProperties = {
  background: "#111a30",
  color: "#e2e8f0",
  border: "1px solid #334155",
  borderRadius: 5,
  padding: "3px 6px",
};

const TurnPreviewPage: NextPageWithLayout = () => {
  const [coName, setCoName] = useState<string>("andy");
  const [army, setArmy] = useState<Army>("orange-star");
  const [isViewer, setIsViewer] = useState(true);
  const [day, setDay] = useState(3);
  const [repaired, setRepaired] = useState(2);
  const [refuelled, setRefuelled] = useState(1);
  const [crashed, setCrashed] = useState(0);
  const [startFunds, setStartFunds] = useState(8000);
  const [income, setIncome] = useState(4000);
  const [repairSpent, setRepairSpent] = useState(1200);
  const [nonce, setNonce] = useState(0);

  const funds = isViewer
    ? { before: startFunds, peak: startFunds + income, after: startFunds + income - repairSpent }
    : null;

  const stageKey = useMemo(
    () =>
      `${coName}|${army}|${isViewer}|${day}|${repaired}|${refuelled}|${crashed}|${startFunds}|${income}|${repairSpent}|${nonce}`,
    [
      coName,
      army,
      isViewer,
      day,
      repaired,
      refuelled,
      crashed,
      startFunds,
      income,
      repairSpent,
      nonce,
    ],
  );

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <div
        style={{
          width: 300,
          flex: "0 0 300px",
          padding: 16,
          background: "#0d1428",
          color: "#e2e8f0",
          fontFamily: "system-ui, sans-serif",
          fontSize: 13,
          boxSizing: "border-box",
        }}
      >
        <h1 style={{ fontSize: 16, margin: "0 0 10px", fontFamily: "RussoOne, sans-serif" }}>
          Turn Banner — Preview
        </h1>

        <label style={{ display: "block", margin: "10px 0 4px", opacity: 0.75 }}>CO</label>
        <select
          style={{ ...input, width: "100%" }}
          value={coName}
          onChange={(event) => setCoName(event.target.value)}
        >
          {CO_NAMES.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>

        <label style={{ display: "block", margin: "10px 0 4px", opacity: 0.75 }}>
          Army (accent)
        </label>
        <select
          style={{ ...input, width: "100%" }}
          value={army}
          onChange={(event) => setArmy(event.target.value as Army)}
        >
          {ARMIES.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>

        <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0" }}>
          <input
            type="checkbox"
            checked={isViewer}
            onChange={(event) => setIsViewer(event.target.checked)}
          />
          Your turn (shows upkeep) — off = enemy turn
        </label>

        <label style={{ display: "block", margin: "6px 0 4px", opacity: 0.75 }}>Day</label>
        <input
          type="number"
          min={1}
          value={day}
          style={{ ...input, width: 70 }}
          onChange={(event) => setDay(Number(event.target.value) || 1)}
        />

        {isViewer && (
          <div style={{ marginTop: 8 }}>
            <label style={{ display: "block", margin: "6px 0 4px", opacity: 0.75 }}>
              Upkeep: repaired / refuelled / lost to fuel
            </label>
            <input
              type="number"
              min={0}
              value={repaired}
              style={{ ...input, width: 60, marginRight: 6 }}
              onChange={(event) => setRepaired(Number(event.target.value) || 0)}
            />
            <input
              type="number"
              min={0}
              value={refuelled}
              style={{ ...input, width: 60, marginRight: 6 }}
              onChange={(event) => setRefuelled(Number(event.target.value) || 0)}
            />
            <input
              type="number"
              min={0}
              value={crashed}
              style={{ ...input, width: 60 }}
              onChange={(event) => setCrashed(Number(event.target.value) || 0)}
            />

            <label style={{ display: "block", margin: "12px 0 4px", opacity: 0.75 }}>
              Funds: banked / income / repair
            </label>
            <input
              type="number"
              min={0}
              value={startFunds}
              style={{ ...input, width: 74, marginRight: 6 }}
              onChange={(event) => setStartFunds(Number(event.target.value) || 0)}
            />
            <input
              type="number"
              min={0}
              value={income}
              style={{ ...input, width: 64, marginRight: 6 }}
              onChange={(event) => setIncome(Number(event.target.value) || 0)}
            />
            <input
              type="number"
              min={0}
              value={repairSpent}
              style={{ ...input, width: 64 }}
              onChange={(event) => setRepairSpent(Number(event.target.value) || 0)}
            />
          </div>
        )}

        <button
          type="button"
          style={{
            ...input,
            marginTop: 16,
            width: "100%",
            padding: "9px 0",
            background: "#fbbf24",
            color: "#0b1020",
            fontWeight: 700,
            cursor: "pointer",
          }}
          onClick={() => setNonce((n) => n + 1)}
        >
          ▶ Replay
        </button>
      </div>

      <div style={{ position: "relative", flex: 1, height: "100vh", background: "#000b2c" }}>
        <TurnStartBanner
          key={stageKey}
          nonce={0}
          day={day}
          coName={coName}
          army={army}
          isViewer={isViewer}
          repaired={repaired}
          refuelled={refuelled}
          crashed={crashed}
          funds={funds}
        />
      </div>
    </div>
  );
};

// Dev tool: no navbar so the full-viewport banner overlay renders cleanly.
TurnPreviewPage.getLayout = (page) => page;

export default TurnPreviewPage;
