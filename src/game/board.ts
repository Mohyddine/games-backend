export type PlayerSymbol = "X" | "O";

export type CellValue = PlayerSymbol | null;

export type BoardState = [
  CellValue, CellValue, CellValue,
  CellValue, CellValue, CellValue,
  CellValue, CellValue, CellValue
];

export const WINNING_COMBINATIONS: readonly (readonly [number, number, number])[] = [
  // Rows
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  // Columns
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  // Diagonals
  [0, 4, 8],
  [2, 4, 6],
];

export const createEmptyBoard = (): BoardState => {
  return [null, null, null, null, null, null, null, null, null];
};

export const checkWin = (board: BoardState, symbol: PlayerSymbol): boolean => {
  return WINNING_COMBINATIONS.some(([a, b, c]) => {
    return board[a] === symbol && board[b] === symbol && board[c] === symbol;
  });
};

export const isBoardFull = (board: BoardState): boolean => {
  return board.every((cell) => cell !== null);
};

export const getAvailableCells = (board: BoardState): number[] => {
  const available: number[] = [];
  for (let i = 0; i < board.length; i++) {
    if (board[i] === null) {
      available.push(i);
    }
  }
  return available;
};
