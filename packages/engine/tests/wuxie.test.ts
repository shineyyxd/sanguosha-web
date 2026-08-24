import { describe, expect, it } from 'vitest';
import {
  Game,
  drive,
  makeCard,
  type AskRequest,
  type AskResponse,
  type Controller,
} from '../src/index.js';

function setup(names = ['甲', '乙']) {
  const game = new Game({ playerNames: names });
  return { game, players: game.players };
}

function controller(fn: (ask: AskRequest) => AskResponse): Controller {
  return { onAsk: fn };
}

describe('【无懈可击】', () => {
  it('锦囊被无懈抵消：无中生有不摸牌，两张牌都进弃牌堆', () => {
    const { game, players } = setup();
    const [a, b] = players;
    const wuzhong = makeCard('wuzhong');
    const wuxie = makeCard('wuxie');
    a.hand = [wuzhong];
    b.hand = [wuxie];

    drive(
      game.useTrick(a, wuzhong),
      controller((ask) =>
        ask.kind === 'response' && ask.wants === 'wuxie' ? { cardId: wuxie.id } : { pass: true },
      ),
      game,
    );

    expect(a.hand).toHaveLength(0); // 没摸牌
    expect(b.hand).toHaveLength(0); // 无懈已打出
    expect(game.discard).toContain(wuzhong);
    expect(game.discard).toContain(wuxie);
  });

  it('反无懈使原锦囊生效：甲无懈反乙的无懈，无中生有摸 2 张', () => {
    const { game, players } = setup();
    const [a, b] = players;
    const wuzhong = makeCard('wuzhong');
    const wuxieA = makeCard('wuxie');
    const wuxieB = makeCard('wuxie');
    a.hand = [wuzhong, wuxieA];
    b.hand = [wuxieB];

    const wuxieAsks: string[] = [];
    let aCountered = false;
    drive(
      game.useTrick(a, wuzhong),
      controller((ask) => {
        if (ask.kind !== 'response' || ask.wants !== 'wuxie') return { pass: true };
        wuxieAsks.push(ask.playerId);
        // 第一轮甲放弃；乙无懈后甲反无懈
        if (ask.playerId === a.id && !aCountered && wuxieAsks.length > 1) {
          aCountered = true;
          return { cardId: wuxieA.id };
        }
        if (ask.playerId === b.id) return { cardId: wuxieB.id };
        return { pass: true };
      }),
      game,
    );

    expect(wuxieAsks).toEqual([a.id, b.id, a.id]); // 甲 → 乙 → 甲（反无懈）
    expect(a.hand).toHaveLength(2); // 无中生有生效，摸 2 张
    expect(b.hand).toHaveLength(0);
    expect(game.discard).toContain(wuxieA);
    expect(game.discard).toContain(wuxieB);
  });

  it('多人按座次依次询问：南蛮入侵逐目标求无懈，只保护被无懈的目标', () => {
    const { game, players } = setup(['甲', '乙', '丙']);
    const [a, b, c] = players;
    const nanman = makeCard('nanman');
    const wuxieA = makeCard('wuxie');
    const wuxieB = makeCard('wuxie');
    const wuxieB2 = makeCard('wuxie');
    a.hand = [nanman, wuxieA];
    b.hand = [wuxieB, wuxieB2]; // 两张：保护自己用一张，之后仍会被询问
    c.hand = []; // 丙没有无懈也没有杀

    const wuxieAsks: string[] = [];
    const shaAsks: string[] = [];
    let bProtected = false;
    drive(
      game.useTrick(a, nanman),
      controller((ask) => {
        if (ask.kind !== 'response') return { pass: true };
        if (ask.wants === 'sha') {
          shaAsks.push(ask.playerId);
          return { pass: true }; // 都没杀，掉血
        }
        // 无懈询问
        wuxieAsks.push(ask.playerId);
        // 乙在被南蛮指定时为自己打无懈（第二轮询问轮到乙时）
        if (ask.playerId === b.id && ask.targetId === b.id && !bProtected) {
          bProtected = true;
          return { cardId: wuxieB.id };
        }
        return { pass: true };
      }),
      game,
    );

    // 目标乙的无懈链：甲放弃 → 乙保护自己 → 从乙下家再问甲放弃（丙没无懈被跳过）
    // 目标丙的无懈链：甲放弃 → 乙（targetId 是丙）放弃
    expect(wuxieAsks).toEqual([a.id, b.id, a.id, a.id, b.id]);
    expect(shaAsks).toEqual([c.id]); // 乙被无懈保护，只有丙被求杀
    expect(b.hp).toBe(4);
    expect(c.hp).toBe(3);
    expect(a.hp).toBe(4); // 使用者不受影响
    expect(b.hand).toHaveLength(1); // 只用掉一张无懈
  });

  it('【无懈可击】不能主动使用', () => {
    const { game, players } = setup();
    expect(game.canPlay(players[0], makeCard('wuxie'))).not.toBeNull();
  });
});
