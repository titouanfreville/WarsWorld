/**
 * FE-owned unit vocabulary — the exact set of unit-type string literals the board renders sprites
 * and build-menu rows for. Redeclared, not imported from `shared/schemas/unit.ts`: keep this list in
 * step with the server's `unitTypeSchema` by hand when a unit type is added or removed there.
 */
export type UnitType =
  | "infantry"
  | "mech"
  | "recon"
  | "apc"
  | "artillery"
  | "tank"
  | "antiAir"
  | "missile"
  | "rocket"
  | "mediumTank"
  | "neoTank"
  | "megaTank"
  | "transportCopter"
  | "battleCopter"
  | "blackBomb"
  | "bomber"
  | "fighter"
  | "stealth"
  | "blackBoat"
  | "lander"
  | "cruiser"
  | "battleship"
  | "sub"
  | "carrier"
  | "pipeRunner";
