# con-oo-Lzm2642 - Review

## Review 结论

当前实现已经把 `Sudoku` / `Game` 部分接入到 Svelte store 与界面流程中，方向上符合“View 真正消费领域对象”的要求；但领域建模和接线层之间存在多个核心断点，尤其是历史快照、序列化恢复、hint 业务语义，以及若干 Svelte API 对接失配。这些问题会直接影响 Undo/Redo、暂停/恢复、提示、选格等真实游戏流程，因此整体质量还不能算稳定可靠。

## 总体评价

| 维度 | 评价 |
| --- | --- |
| OOP | fair |
| JS Convention | poor |
| Sudoku Business | poor |
| OOD | poor |

## 缺点

### 1. clone() 丢失原始题面，导致历史快照语义错误

- 严重程度：core
- 位置：src/domain/Sudoku.js:176-177; src/domain/Game.js:27,52,69,83
- 原因：`clone()` 通过 `createSudoku(currentGrid)` 重建对象，把“当前盘面”误当成了 `initialGrid`。而 `Game` 的 history 又完全依赖这个 clone 结果存快照，因此用户填过的格子在撤销/重做后的快照里会被当成不可修改的 givens，Undo/Redo 与题面不可变规则都会失真。

### 2. createGameFromJSON() 恢复出的对象与真实历史脱节

- 严重程度：core
- 位置：src/domain/Game.js:140-180
- 原因：该函数最终返回的是对 `createGame(...)` 结果的浅覆盖对象，只重写了读取方法，没有把 `guess/undo/redo/canUndo/canRedo` 绑定到重建后的 `history`。恢复后的 `Game` 读到的是一套历史，写操作却作用在另一套闭包状态上，序列化契约实际上没有成立。

### 3. 提示功能没有基于解答模型，业务语义错误

- 严重程度：core
- 位置：src/stores/grid.js:85-145; src/components/Controls/ActionBar/Actions.svelte:23-32
- 原因：注释写的是“自动填入正确答案”，但实现只是从 1-9 中选第一个当前不冲突的数。数独里“局部不冲突”不等于“正确答案”，这会把错误数字作为 hint 写入盘面，直接破坏游戏业务语义。

### 4. Svelte 接线依赖了不存在的 named export

- 严重程度：core
- 位置：src/game.js:141-154,168-181; src/components/Header/Buttons.svelte:3-12; src/components/Controls/ActionBar/Timer.svelte:2-9; src/components/Modal/Types/GameOver.svelte:2-17
- 原因：`src/game.js` 只命名导出了 `pause()` / `resume()`，没有命名导出 `pauseGame` / `resumeGame`；但多个 `.svelte` 文件使用了 `import { pauseGame, resumeGame } from '@sudoku/game'`。按 ESM 静态导入规则，这条接线本身就不成立，暂停/恢复流程至少存在构建级风险。

### 5. 自定义 store 改写了 set 语义，并与组件调用不兼容

- 严重程度：major
- 位置：src/stores/cursor.js:34-36; src/components/Board/Cell.svelte:39
- 原因：`cursor` 原本是 Svelte writable，组件按 `set(x, y)` 的光标 API 在调用；但这里把 `.set` 改成了接收单个对象的位置更新函数。结果调用点和实现签名不一致，既不符合 Svelte store 的惯例，也会让点击选格这条交互链变得不可靠。

### 6. UI 操作入口分裂，真实流程没有统一消费 Game adapter

- 严重程度：major
- 位置：src/components/Controls/Keyboard.svelte:2,21,29-32; src/components/Controls/ActionBar/Actions.svelte:3,29-31; src/game.js:1-6,82-92,155-165
- 原因：项目已经有 `src/game.js` 作为 UI 与领域对象的桥梁，但键盘输入和 hint 仍直接调用 `stores/grid.js` / `stores/hints.js`。这让“用户操作 -> Game -> Sudoku -> 响应式视图”的链路不统一，胜利判断、计时器停止、候选数清理等流程只能靠组件各自拼接，应用层职责边界比较混乱。

### 7. keyboardDisabled 不再表达真实可输入状态

- 严重程度：major
- 位置：src/stores/keyboard.js:1-15; src/components/Controls/Keyboard.svelte:11-35,91-99; src/components/Controls/ActionBar/Actions.svelte:50
- 原因：本地实现把 `keyboardDisabled` 降成了一个普通 `writable(false)`，且在项目内没有看到任何地方更新它；但组件仍把它当作“当前是否允许输入/提示”的派生真相使用。这样一来，暂停状态、选格状态与按钮禁用状态会脱节，游戏流程约束没有被稳定建模到 Svelte 层。

## 优点

### 1. Sudoku 对输入边界和内部状态做了防御性封装

- 位置：src/domain/Sudoku.js:17-38,58-67
- 原因：构造时校验了 9x9 和 0-9 约束，读取网格时返回深拷贝，避免外部直接拿到内部二维数组后随意 mutate。

### 2. 历史管理的基本职责被放进了 Game

- 位置：src/domain/Game.js:43-57
- 原因：`guess()` 中先截断 redo 分支，再追加新快照，说明作者意识到 Undo/Redo 应由 `Game` 负责，而不是散落在组件事件里。

### 3. 采用了面向 Svelte 的 store adapter 方案

- 位置：src/stores/grid.js:4-5,12-23,38-46
- 原因：store 内部持有 `Game`，对外暴露 `userGrid`、`invalidCells` 等可订阅状态，基本符合作业推荐的 Store Adapter 接入方式。

### 4. 开始新局的主流程已经接入领域对象

- 位置：src/components/Modal/Types/Welcome.svelte:16-24; src/game.js:43-79; src/stores/grid.js:52-63
- 原因：欢迎弹窗启动新局后，会进入 `startNew/startCustom -> startNewGame/startCustomGame -> createSudoku/createGame` 的链路，说明领域对象并非只存在于测试。

### 5. 棋盘渲染消费的是响应式视图状态

- 位置：src/components/Board/index.svelte:40-52
- 原因：`Board` 通过 `$userGrid`、`$invalidCells`、`$grid` 渲染当前局面与冲突高亮，UI 展示至少没有再直接操作裸二维数组。

## 补充说明

- 本次结论仅基于对 `src/domain/*` 及其直接相关的 Svelte/store 接入文件的静态阅读，没有运行 test、build，也没有做实际界面交互验证。
- 关于 `pauseGame/resumeGame` 导入不匹配、`cursor.set` 签名不匹配等判断，来自 ESM/Svelte 接口的静态比对；虽然我没有实际编译，但按当前源码形态它们属于高风险问题。
- `createGameFromJSON()` 的问题主要是领域 API 设计质量问题；静态阅读中没有看到它被当前 UI 主流程消费，因此该条结论不依赖运行时是否触发。
- 本 review 没有扩展到无关目录；`src/node_modules/@sudoku/*` 仅被用来辅助核对当前 `src/` 接线是否与现有 Svelte 调用约定一致，最终评价对象仍然只针对 `src/domain/*` 和关联接入代码。
