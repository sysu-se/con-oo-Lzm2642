# 设计文档：领域对象与 Svelte 响应式集成

## 一、架构概述

本项目采用**分层架构**，将领域逻辑与 UI 框架解耦：

```
┌─────────────────────────────────────────────────────┐
│                    UI Layer (Svelte)                │
│  组件通过 $store 语法订阅状态，调用 game.js 方法      │
├─────────────────────────────────────────────────────┤
│              Adapter Layer (game.js)                │
│  协调 stores 与领域对象，提供统一的操作入口           │
├─────────────────────────────────────────────────────┤
│               Store Layer (stores/)                 │
│  持有 Game 实例，暴露响应式状态给 Svelte             │
├─────────────────────────────────────────────────────┤
│              Domain Layer (domain/)                 │
│  Sudoku / Game 领域对象，纯业务逻辑                  │
└─────────────────────────────────────────────────────┘
```

---

## 二、领域对象设计

### 2.1 Sudoku

**职责：**
- 持有当前 grid / board 数据
- 提供 `guess({ row, col, value })` 接口进行填数
- 提供校验能力（`isValid`, `getInvalidCells`, `isWon`）
- 提供外表化能力（`toString()`, `toJSON()`）
- 支持克隆用于历史快照

**核心方法：**

| 方法 | 说明 |
|------|------|
| `getGrid()` | 获取当前网格副本 |
| `getInitialGrid()` | 获取初始谜题副本 |
| `guess(move)` | 在指定位置填入数字 |
| `isValid(row, col)` | 检查指定位置是否有效（无冲突） |
| `getInvalidCells()` | 获取所有冲突单元格 |
| `isWon()` | 检查是否完成且正确 |
| `clone()` | 克隆当前状态 |
| `toJSON()` / `createSudokuFromJSON()` | 序列化/反序列化 |

**设计要点：**
- 使用闭包封装内部状态，`currentGrid` 和 `initialGrid` 对外不可直接访问
- `getGrid()` 返回深拷贝，防止外部直接修改内部状态
- 初始数字（`initialGrid` 中非零的单元格）不可修改

### 2.2 Game

**职责：**
- 持有当前 `Sudoku` 实例
- 管理历史记录（用于 Undo / Redo）
- 提供 `undo()` / `redo()` 接口
- 对外提供面向 UI 的游戏操作入口

**核心方法：**

| 方法 | 说明 |
|------|------|
| `getSudoku()` | 获取当前 Sudoku 实例 |
| `guess(move)` | 执行填数并记录历史 |
| `undo()` | 撤销上一步操作 |
| `redo()` | 重做下一步操作 |
| `canUndo()` / `canRedo()` | 检查是否可撤销/重做 |
| `toJSON()` / `createGameFromJSON()` | 序列化/反序列化 |

### 2.3 历史管理策略

- 每次成功填数后，保存当前 Sudoku 的快照（clone）
- 使用数组存储历史，`historyIndex` 标记当前位置
- Undo/Redo 通过切换 `historyIndex` 实现
- 新操作会清除当前位置之后的 redo 历史

**为什么存储快照而不是操作？**

存储完整快照的优点：
- 实现简单，不需要复杂的回滚逻辑
- 每次操作都保存完整状态，保证一致性
- 避免了操作逆运算的复杂性

Trade-off：
- 内存占用相对较高（每步操作存储完整 9x9 网格）
- 可在未来改为差分/增量策略以优化

### 2.4 Move 是值对象还是实体对象？

**Move 是值对象。**

原因：
- Move 只表示一次用户操作（row, col, value）
- 没有唯一标识，不需要生命周期管理
- 两个 Move 如果 row、col、value 相同，则它们等价
- 适合作为轻量级数据结构传递

---

## 三、领域对象如何被消费

### 3.1 View 层直接消费的是什么？

View 层**不直接消费** `Game` 或 `Sudoku`，而是消费 **Store Adapter** 暴露的响应式状态。

```
View (Svelte 组件)
    │
    │ $userGrid, $invalidCells, $gameWon 等
    ▼
Store Layer (stores/grid.js 等)
    │
    │ 内部持有 Game 实例
    ▼
Domain Layer (Game → Sudoku)
```

**具体来说：**

- 组件通过 `import { userGrid, grid, invalidCells, gameWon } from '@sudoku/stores/grid'` 读取数据
- 对 UI 的写入操作调用适配层的命令函数（例如 `setGuess()`, `undo()`, `redo()`）

### 3.2 View 层拿到的数据是什么？

| Store | 类型 | 说明 |
|-------|------|------|
| `userGrid` | `writable<number[][]>` | 当前用户填写的网格（UI 渲染来源） |
| `grid` | `writable<number[][]>` | 初始谜题网格（用于判断哪些格子是用户可填的） |
| `invalidCells` | `writable<string[]>` | 冲突单元格列表（用于高亮错误） |
| `gameWon` | `writable<boolean>` | 游戏是否胜利 |
| `gamePaused` | `writable<boolean>` | 游戏是否暂停 |

### 3.3 用户操作如何进入领域对象？

用户操作通过 `game.js` 适配层进入领域对象：

**1. 开始游戏：**

```javascript
// 组件调用
game.startNew(difficulty);

// 内部流程 (game.js)
function startNew(difficultyValue) {
  resetTimer();
  resetHints();
  resetGameState();
  startNewGame(difficultyValue);  // → createSudoku → createGame
  startTimer();
}

// stores/grid.js
export function initGame(puzzle) {
  const sudoku = createSudoku(puzzle);
  game = createGame({ sudoku });
  // ...
}
```

**2. 填数操作：**

```javascript
// 组件调用 (Keyboard.svelte)
setGuess($cursor, num);

// stores/grid.js
export function setGuess(cursor, value) {
  game.guess({ row: cursor.y, col: cursor.x, value });  // 调用领域对象
  userGrid.set(game.getSudoku().getGrid());              // 更新响应式状态
  invalidCells.set(game.getSudoku().getInvalidCells());
}
```

**3. Undo / Redo：**

```javascript
// 组件调用 (Actions.svelte)
import { undo, redo, canUndo, canRedo } from '@sudoku/game';

function handleUndo() {
  undo();
}

// game.js
function undo() {
  const game = getGame();
  if (game && game.canUndo()) {
    game.undo();  // 调用领域对象
    userGrid.set(game.getSudoku().getGrid());      // 更新 UI
    invalidCells.set(game.getSudoku().getInvalidCells());
  }
}
```

### 3.4 领域对象变化后，Svelte 为什么会更新？

关键在于 **Store 的响应式机制**：

1. 领域对象（Game/Sudoku）本身**不是响应式的**
2. Store 层（`stores/grid.js`）内部持有 Game 实例，并创建 `writable` stores
3. 当用户操作触发领域对象变化后，Store 层**显式调用 `.set()` 更新** writable store
4. Svelte 的 `$store` 语法会自动订阅 store，当 store 值变化时触发组件重新渲染

```javascript
// stores/grid.js 中的关键代码
export function setGuess(cursor, value) {
  // 1. 调用领域对象修改状态
  game.guess({ row: cursor.y, col: cursor.x, value });
  
  // 2. 显式更新响应式 store（触发 UI 更新）
  const newGrid = game.getSudoku().getGrid();
  userGrid.set(newGrid);  // ← 这里触发 Svelte 响应式更新
  invalidCells.set(game.getSudoku().getInvalidCells());
}
```

---

## 四、响应式机制说明

### 4.1 依赖的机制

本项目主要依赖：
- **`writable` store**：创建可订阅的响应式状态
- **`$store` 语法**：组件中自动订阅/取消订阅 store
- **显式 `.set()` 调用**：领域对象变化后手动更新 store

**为什么不使用 `$:` reactive statements？**

本项目的数据流是单向的：领域对象 → store → UI。当领域对象变化时，我们通过显式调用 `.set()` 来更新 store，这种方式：
- 更加明确和可控
- 避免了 reactive statement 的隐式依赖追踪问题
- 便于调试和理解数据流

### 4.2 哪些数据是响应式暴露给 UI 的？

| 数据 | 响应式暴露方式 | 说明 |
|------|---------------|------|
| `userGrid` | writable store | 当前网格状态，UI 直接渲染 |
| `grid` | writable store | 初始谜题，用于判断用户可填区域 |
| `invalidCells` | writable store | 冲突单元格，用于高亮显示 |
| `gameWon` | writable store | 胜利状态，触发结束弹窗 |
| `gamePaused` | writable store | 暂停状态，控制界面交互 |

### 4.3 哪些状态留在领域对象内部？

| 数据 | 存储位置 | 说明 |
|------|---------|------|
| `currentGrid` / `initialGrid` | Sudoku 内部闭包 | 网格数据，只能通过方法访问 |
| `history` / `historyIndex` | Game 内部闭包 | 历史记录，对 UI 不可见 |

这些状态不直接暴露给 UI，只能通过领域对象的方法访问（如 `getGrid()`, `canUndo()`）。

### 4.4 如果直接 mutate 内部对象会出什么问题？

**问题 1：Svelte 无法检测到变化**

```javascript
// ❌ 错误做法：直接修改内部数组
function setGuess(cursor, value) {
  game.getSudoku().currentGrid[cursor.y][cursor.x] = value;  // 直接修改
  // 没有 .set() 调用，UI 不会更新！
}
```

**原因：** Svelte 的响应式基于**赋值检测**，直接修改对象内部属性或数组元素不会触发更新。只有当 store 的值被 `.set()` 替换时，Svelte 才会通知订阅者。

**问题 2：破坏领域对象的封装**

```javascript
// ❌ 错误做法：外部直接访问内部状态
const grid = game.getSudoku().currentGrid;  // 如果暴露了内部引用
grid[y][x] = 5;  // 外部可以直接修改，绕过验证逻辑
```

这会绕过 Sudoku 的验证逻辑（如初始数字不可修改），导致数据不一致。

**正确做法：**

```javascript
// ✅ 正确做法：通过方法修改，返回新值，更新 store
game.guess({ row, col, value });              // 通过方法修改
const newGrid = game.getSudoku().getGrid();   // 获取副本
userGrid.set(newGrid);                         // 更新 store 触发 UI
```

---

## 五、深入理解 Svelte 响应式机制

### 5.1 为什么修改对象内部字段后，界面不一定自动更新？

Svelte 的响应式系统基于**变量赋值**检测，而不是对象属性变化检测。

```javascript
let obj = { count: 0 };

function increment() {
  obj.count++;  // ❌ Svelte 不会检测到这个变化
}

function incrementCorrect() {
  obj = { ...obj, count: obj.count + 1 };  // ✅ 赋值会触发更新
}
```

对于 store：
```javascript
const store = writable({ count: 0 });

// ❌ 错误：直接修改
store.update(s => { s.count++; return s; });  // 虽然 update 了，但如果组件使用 $store 且检测不到变化，可能不更新

// ✅ 正确：返回新对象
store.update(s => ({ ...s, count: s.count + 1 }));  // 返回新对象确保更新
```

### 5.2 为什么直接改二维数组元素，有时 Svelte 不会按预期刷新？

数组是引用类型，修改元素不会改变数组引用：

```javascript
let grid = [[1, 2, 3], [4, 5, 6]];

grid[0][0] = 9;  // ❌ 引用没变，Svelte 可能不更新

grid = [...grid];  // ✅ 创建新引用，触发更新
// 或
grid = grid.map((row, i) => i === 0 ? [...row] : row);  // 更精细的控制
```

**本项目的解决方案：**

`Sudoku.getGrid()` 返回深拷贝，每次调用都是新数组：
```javascript
getGrid() {
  return deepCloneGrid(currentGrid);  // 返回新数组
}
```

### 5.3 为什么 store 可以被 `$store` 消费？

`$store` 是 Svelte 的语法糖，编译时会自动：

1. 在组件初始化时调用 `store.subscribe(callback)`
2. 在组件销毁时调用 `unsubscribe()`
3. 创建一个响应式变量，当 store 值变化时自动更新

编译前：
```svelte
<script>
  import { userGrid } from './stores/grid.js';
</script>

<div>{$userGrid[0][0]}</div>
```

编译后（简化）：
```javascript
let $userGrid;
const unsubscribe = userGrid.subscribe(value => {
  $userGrid = value;
  // 触发组件重新渲染
});

// 组件销毁时
onDestroy(unsubscribe);
```

### 5.4 为什么 `$:` 有时会更新，有时不会更新？

`$:` 是 Svelte 的 reactive statement，它依赖的变量变化时才会执行。

**不会更新的情况：**

```javascript
let obj = { value: 0 };

$: doubled = obj.value * 2;  // 依赖 obj.value

obj.value = 5;  // ❌ 不会触发，因为 obj 引用没变
obj = { value: 5 };  // ✅ 会触发
```

**间接依赖问题：**

```javascript
let a = 1;
let b = a;

$: doubled = b * 2;  // 依赖 b，不是 a

a = 2;  // ❌ 不会触发 doubled 更新
b = a;  // ✅ 这样才会触发
```

### 5.5 为什么"间接依赖"可能导致 reactive statement 不触发？

Reactive statement 只追踪**直接出现在语句中**的变量：

```javascript
let items = [{ name: 'a' }];

$: firstItem = items[0];  // 依赖 items

items[0].name = 'b';  // ❌ 不触发，items 引用未变
items = [...items];   // ✅ 触发
```

**本项目的避免策略：**

不依赖 reactive statement 来追踪领域对象变化，而是显式调用 `.set()` 更新 store，确保数据流清晰可控。

---

## 六、改进说明

### 6.1 相比 HW1 的改进

| 改进点 | HW1 问题 | 改进方案 |
|--------|---------|---------|
| 序列化兼容性 | 使用 CommonJS `require`，ES 模块环境下报错 | 改为 ES 模块 `import` |
| 职责分离 | 部分逻辑散落在组件中 | 统一到 `game.js` 适配层 |
| 响应式边界 | 不清晰 | 明确 Store 层为响应式边界 |
| 接入程度 | 领域对象只在测试中可用 | 真正接入 Svelte 游戏流程 |

### 6.2 HW1 做法不足以支撑真实接入的原因

1. **领域对象孤立存在**：HW1 中的 Sudoku/Game 仅在测试中使用，UI 没有真正消费
2. **缺少适配层**：没有将领域对象状态转换为 Svelte 可消费的响应式状态
3. **模块系统不统一**：使用 `require` 导致在 ES 模块环境下无法运行
4. **直接操作数组**：组件直接修改二维数组，绕过了领域对象的验证逻辑

### 6.3 新设计的 Trade-offs

**优点：**
- 领域对象完全独立于框架，可独立测试
- 响应式边界清晰，便于理解和维护
- 支持未来迁移到其他框架（只需重写 Store 层）
- 数据流单向，便于调试

**缺点：**
- 需要手动调用 `.set()` 更新 UI，可能遗漏
- 增加了一层抽象，代码量略有增加
- 历史记录存储完整快照，内存占用相对较高

---

## 七、迁移到 Svelte 5 的考量

如果将来迁移到 Svelte 5：

**最稳定的层：Domain Layer**
- Sudoku / Game 是纯 JavaScript 对象，与框架无关
- 无需任何修改即可继续使用

**最可能改动的层：Store Layer**
- Svelte 5 引入 runes（`$state`, `$derived`）
- writable store 可能被 reactive class 替代
- 但 Adapter Layer（game.js）的接口可保持不变

**迁移策略：**
1. 保持 Domain Layer 不变
2. 将 Store Layer 改为使用 Svelte 5 的 reactive primitives
3. UI 组件逐步迁移到新的响应式语法

---

## 八、序列化 / 反序列化设计

### 8.1 序列化字段

**Sudoku.toJSON():**
```javascript
{
  initialGrid: number[][],  // 初始谜题
  currentGrid: number[][]   // 当前状态
}
```

**Game.toJSON():**
```javascript
{
  sudoku: SudokuJSON,       // 当前数独状态
  history: SudokuJSON[],    // 历史记录
  historyIndex: number      // 当前位置
}
```

### 8.2 不序列化的字段

- `internalGame`（适配层中的私有引用）：恢复时重新创建
- UI 状态（`gamePaused`, `timer` 等）：由适配层在恢复时重新计算

### 8.3 反序列化过程

```javascript
// 从 JSON 恢复 Sudoku
export function createSudokuFromJSON(json) {
  const sudoku = createSudoku(json.initialGrid);
  
  // 恢复当前状态
  for (let y = 0; y < 9; y++) {
    for (let x = 0; x < 9; x++) {
      if (json.currentGrid[y][x] !== json.initialGrid[y][x]) {
        sudoku.guess({ row: y, col: x, value: json.currentGrid[y][x] });
      }
    }
  }
  return sudoku;
}

// 从 JSON 恢复 Game
export function createGameFromJSON(json) {
  const history = json.history.map(h => createSudokuFromJSON(h));
  // ... 重建带有完整历史的 Game
}
```

---

## 九、核心代码引用

### 9.1 领域对象创建流程

```javascript:src/stores/grid.js:23-32
export function initGame(puzzle) {
  const sudoku = createSudoku(puzzle);
  game = createGame({ sudoku });
  initialGrid = puzzle;
  
  grid.set(puzzle);
  userGrid.set(sudoku.getGrid());
  invalidCells.set([]);
}
```

### 9.2 响应式更新关键代码

```javascript:src/stores/grid.js:53-68
export function setGuess(cursor, value) {
  if (!game) return;
  
  if (initialGrid && initialGrid[cursor.y][cursor.x] !== 0) {
    return;
  }
  
  game.guess({ row: cursor.y, col: cursor.x, value });
  
  const newGrid = game.getSudoku().getGrid();
  userGrid.set(newGrid);
  invalidCells.set(game.getSudoku().getInvalidCells());
}
```

### 9.3 Undo/Redo 实现

```javascript:src/game.js:94-103
function undo() {
  const game = getGame();
  if (game && game.canUndo()) {
    game.undo();
    
    const { userGrid, invalidCells } = require('./stores/grid.js');
    userGrid.set(game.getSudoku().getGrid());
    invalidCells.set(game.getSudoku().getInvalidCells());
  }
}
```

---

## 十、总结

本设计通过 **Store Adapter 模式**，成功将领域对象（Sudoku/Game）接入 Svelte 游戏流程：

1. **Domain Layer**：纯业务逻辑，框架无关
2. **Store Layer**：持有领域对象，暴露响应式状态
3. **Adapter Layer**：协调操作，连接 UI 与 Domain
4. **UI Layer**：消费响应式状态，触发领域对象方法

这种分层设计确保了：
- 领域对象的独立性和可测试性
- Svelte 响应式机制的正确使用
- 未来框架迁移的灵活性
