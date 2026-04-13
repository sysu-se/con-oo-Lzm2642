/**
 * Grid Store - 数独网格状态管理
 * 
 * 这个 store 内部持有 Game 实例，对外暴露响应式状态
 */

import { writable, get } from 'svelte/store';
import { createGame, createSudoku } from '../domain/index.js';
import { generatePuzzle, decode } from '../sencode.js';

// 内部状态
let game = null;
let initialGrid = null;

// 创建可写 store
export const grid = writable([]);
export const userGrid = writable([]);
export const invalidCells = writable([]);

/**
 * 初始化游戏
 */
export function initGame(puzzle) {
  const sudoku = createSudoku(puzzle);
  game = createGame({ sudoku });
  initialGrid = puzzle;
  
  // 更新 store
  grid.set(puzzle);
  userGrid.set(sudoku.getGrid());
  invalidCells.set([]);
}

/**
 * 开始新游戏（根据难度）
 */
export function startNewGame(difficulty) {
  const puzzle = generatePuzzle(difficulty);
  initGame(puzzle);
}

/**
 * 开始自定义游戏（根据 sencode）
 */
export function startCustomGame(sencode) {
  const puzzle = decode(sencode);
  initGame(puzzle);
}

/**
 * 填入数字
 */
export function setGuess(cursor, value) {
  if (!game) return;
  
  // 检查是否是初始数字
  if (initialGrid && initialGrid[cursor.y][cursor.x] !== 0) {
    return; // 不允许修改初始数字
  }
  
  // 调用领域对象
  game.guess({ row: cursor.y, col: cursor.x, value });
  
  // 更新响应式状态
  const newGrid = game.getSudoku().getGrid();
  userGrid.set(newGrid);
  invalidCells.set(game.getSudoku().getInvalidCells());
}

/**
 * 应用提示（自动填入正确答案）
 */
export function applyHint(cursor) {
  if (!game) return;
  
  // 简化实现：随机填入一个有效数字
  // 实际应该根据解答填入
  const currentGrid = game.getSudoku().getGrid();
  const currentValue = currentGrid[cursor.y][cursor.x];
  
  if (currentValue === 0) {
    // 尝试 1-9 找一个有效的
    for (let v = 1; v <= 9; v++) {
      game.guess({ row: cursor.y, col: cursor.x, value: v });
      if (game.getSudoku().isValid(cursor.y, cursor.x)) {
        const newGrid = game.getSudoku().getGrid();
        userGrid.set(newGrid);
        invalidCells.set(game.getSudoku().getInvalidCells());
        return true;
      }
    }
    // 如果都不对，撤销
    game.guess({ row: cursor.y, col: cursor.x, value: 0 });
  }
  
  return false;
}

/**
 * 获取当前 Game 实例
 */
export function getGame() {
  return game;
}

/**
 * 检查是否胜利
 */
export function checkWin() {
  if (!game) return false;
  return game.getSudoku().isWon();
}
