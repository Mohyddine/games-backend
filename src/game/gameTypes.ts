export type GameType = "TIC_TAC_TOE" | "ROCK_PAPER_SCISSORS";

export const GAME_TYPES: readonly GameType[] = [
  "TIC_TAC_TOE",
  "ROCK_PAPER_SCISSORS",
];

export const isGameType = (value: unknown): value is GameType =>
  typeof value === "string" && GAME_TYPES.includes(value as GameType);
