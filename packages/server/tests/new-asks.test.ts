/**
 * 新询问类型的服务器端保障：
 * - 新询问类型（choose-option / give-card / judge-retrial / guanxing）的超时兜底与托管机器人应答；
 * - 选将池扩到 25 个武将（第四批：司马懿/吕布/诸葛亮/大乔/陆逊，标准包齐）；
 * - 机器人客户端用新武将打完一局身份局（不卡死、不出错）。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Game, IMPLEMENTED_GENERAL_IDS, makeCard, type AskRequest } from '../../engine/src/index.js';
import { botResponse } from '../src/bot.js';
import { timeoutResponseFor } from '../src/session.js';
import { SERVER_EVENTS, type GameOverEvent } from '../src/protocol.js';
import {
  attachBot,
  closeAll,
  setupPlayers,
  startGame,
  startTestServer,
  waitFor,
  type TestServer,
} from './helpers.js';

describe('新询问类型的兜底', () => {
  const game = new Game({ playerNames: ['甲', '乙'] });
  const chooseOption: AskRequest = {
    kind: 'choose-option',
    playerId: 'p1',
    skillId: 'ganglie',
    options: [
      { id: 'discard', label: '弃置两张手牌' },
      { id: 'damage', label: '受到 1 点伤害' },
    ],
  };
  const giveCard: AskRequest = {
    kind: 'give-card',
    playerId: 'p1',
    card: makeCard('sha'),
    targetIds: ['p1', 'p2'],
    skillId: 'yiji',
  };
  const judgeRetrial: AskRequest = {
    kind: 'judge-retrial',
    playerId: 'p1',
    card: makeCard('sha', { suit: 'spade', rank: 5 }),
    reason: 'lebu',
    skillId: 'guicai',
  };
  const guanxing: AskRequest = {
    kind: 'guanxing',
    playerId: 'p1',
    cards: [makeCard('sha'), makeCard('shan')],
    skillId: 'guanxing',
  };

  it('超时兜底：choose-option 默认第一项，give-card/改判/观星默认放弃', () => {
    expect(timeoutResponseFor(game, chooseOption)).toEqual({ choice: 'discard' });
    expect(timeoutResponseFor(game, giveCard)).toEqual({ pass: true });
    expect(timeoutResponseFor(game, judgeRetrial)).toEqual({ pass: true }); // 不改判
    expect(timeoutResponseFor(game, guanxing)).toEqual({ pass: true }); // 全部回顶
  });

  it('托管机器人：choose-option 选第一项，give-card/改判/观星放弃', () => {
    expect(botResponse(game, chooseOption)).toEqual({ choice: 'discard' });
    expect(botResponse(game, giveCard)).toEqual({ pass: true });
    expect(botResponse(game, judgeRetrial)).toEqual({ pass: true });
    expect(botResponse(game, guanxing)).toEqual({ pass: true });
  });
});

describe('选将池', () => {
  it('已实现武将扩到 25 个（标准包齐；选将候选从中抽取）', () => {
    expect(IMPLEMENTED_GENERAL_IDS).toHaveLength(25);
    for (const id of ['zhangfei', 'xuzhu', 'xiahoudun', 'guojia', 'zhenji', 'huatuo', 'lvmeng', 'zhouyu']) {
      expect(IMPLEMENTED_GENERAL_IDS).toContain(id);
    }
    for (const id of ['liubei', 'sunquan', 'diaochan', 'sunshangxiang', 'huangyueying']) {
      expect(IMPLEMENTED_GENERAL_IDS).toContain(id);
    }
    for (const id of ['simayi', 'lvbu', 'zhugeliang', 'daqiao', 'luxun']) {
      expect(IMPLEMENTED_GENERAL_IDS).toContain(id);
    }
  });
});

describe('新武将全机器人对局', () => {
  let ts: TestServer;
  beforeEach(async () => {
    ts = await startTestServer();
  });
  afterEach(async () => {
    await ts.server.close();
  });

  it('郭嘉/夏侯惇/甄姬/张飞身份局自动打完（覆盖 give-card 与 choose-option 兜底）', async () => {
    const clients = await setupPlayers(ts.url, 4);
    const overs = clients.map((c) =>
      waitFor<GameOverEvent>(c.socket, SERVER_EVENTS.gameOver, undefined, 60_000),
    );
    for (const c of clients) attachBot(c);
    await startGame(clients[0], clients.slice(1), {
      seed: 7,
      generals: ['guojia', 'xiahoudun', 'zhenji', 'zhangfei'],
      roles: ['lord', 'rebel', 'loyalist', 'renegade'],
    });

    const [over] = await Promise.all(overs);
    expect(over.winSide).not.toBeNull();
    await closeAll(ts.server, ...clients.map((c) => c.socket));
  }, 70_000);

  it('刘备/孙权/貂蝉/孙尚香身份局自动打完（覆盖第三批主动技的机器人策略）', async () => {
    const clients = await setupPlayers(ts.url, 4);
    const overs = clients.map((c) =>
      waitFor<GameOverEvent>(c.socket, SERVER_EVENTS.gameOver, undefined, 60_000),
    );
    for (const c of clients) attachBot(c);
    await startGame(clients[0], clients.slice(1), {
      seed: 11,
      generals: ['liubei', 'sunquan', 'diaochan', 'sunshangxiang'],
      roles: ['lord', 'rebel', 'loyalist', 'renegade'],
    });

    const [over] = await Promise.all(overs);
    expect(over.winSide).not.toBeNull();
    await closeAll(ts.server, ...clients.map((c) => c.socket));
  }, 70_000);

  it('司马懿/吕布/诸葛亮/大乔/陆逊 5 人身份局自动打完（覆盖改判/双闪/观星/流离/连营的机器人兜底）', async () => {
    const clients = await setupPlayers(ts.url, 5);
    const overs = clients.map((c) =>
      waitFor<GameOverEvent>(c.socket, SERVER_EVENTS.gameOver, undefined, 60_000),
    );
    for (const c of clients) attachBot(c);
    await startGame(clients[0], clients.slice(1), {
      seed: 13,
      generals: ['simayi', 'lvbu', 'zhugeliang', 'daqiao', 'luxun'],
      roles: ['lord', 'loyalist', 'rebel', 'rebel', 'renegade'],
    });

    const [over] = await Promise.all(overs);
    expect(over.winSide).not.toBeNull();
    await closeAll(ts.server, ...clients.map((c) => c.socket));
  }, 70_000);
});
