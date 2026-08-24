/**
 * 驱动层接口：把引擎产出的 AskRequest 翻译成玩家输入。
 * CLI demo、单元测试、将来的 Socket.IO 服务器都是 Controller 的实现者。
 */

import type { Game } from './game.js';
import type { AskRequest, AskResponse } from './asks.js';

export interface Controller {
  onAsk(ask: AskRequest, game: Game): AskResponse;
}

/** 驱动一个 generator 流程直到结束，返回其返回值。 */
export function drive<T>(
  flow: Generator<AskRequest, T, AskResponse>,
  controller: Controller,
  game: Game,
): T {
  let step = flow.next();
  while (!step.done) {
    step = flow.next(controller.onAsk(step.value, game));
  }
  return step.value;
}
