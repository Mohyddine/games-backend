export type RpsChoice = "ROCK" | "PAPER" | "SCISSORS";

export const RPS_CHOICES: readonly RpsChoice[] = ["ROCK", "PAPER", "SCISSORS"];

export const isRpsChoice = (value: unknown): value is RpsChoice =>
  typeof value === "string" && RPS_CHOICES.includes(value as RpsChoice);

export const getRpsWinner = (
  firstPlayerId: string,
  firstChoice: RpsChoice,
  secondPlayerId: string,
  secondChoice: RpsChoice
): string | "DRAW" => {
  if (firstChoice === secondChoice) return "DRAW";

  const firstWins =
    (firstChoice === "ROCK" && secondChoice === "SCISSORS") ||
    (firstChoice === "PAPER" && secondChoice === "ROCK") ||
    (firstChoice === "SCISSORS" && secondChoice === "PAPER");

  return firstWins ? firstPlayerId : secondPlayerId;
};
