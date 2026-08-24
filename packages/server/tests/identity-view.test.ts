/**
 * 身份视角过滤（buildPublicState 纯函数单测）：
 * 主公公开、本人可见、阵亡者亮出、对局结束全员亮出；1v1 无身份。
 */

import { describe, expect, it } from 'vitest';
import { DIAOCHAN, Game, InfiniteDeck, LIUBEI, type Role } from '../../engine/src/index.js';
import { buildPublicState } from '../src/view.js';

const ROLES: Role[] = ['lord', 'loyalist', 'rebel', 'renegade', 'rebel'];

function makeGame() {
  return new Game({
    playerNames: ['主', '忠', '反甲', '内', '反乙'],
    roles: ROLES,
    deck: new InfiniteDeck(['sha']),
  });
}

function viewAs(game: Game, seat: number) {
  return buildPublicState(game, game.players[seat], { code: 'TEST', pendingPlayerId: null, logs: [] });
}

describe('身份视角过滤', () => {
  it('忠臣视角：主公公开，其他人身份不可见，本人可见', () => {
    const game = makeGame();
    const view = viewAs(game, 1);
    expect(view.players.map((p) => p.role)).toEqual(['lord', 'loyalist', null, null, null]);
    expect(view.me.role).toBe('loyalist');
  });

  it('反贼看不到内奸身份，内奸也看不到反贼身份', () => {
    const game = makeGame();
    const rebelView = viewAs(game, 2);
    expect(rebelView.players[3].role).toBeNull(); // 内奸对反贼不可见
    expect(rebelView.players[4].role).toBeNull(); // 同伙反贼也不可见
    const renegadeView = viewAs(game, 3);
    expect(renegadeView.players[2].role).toBeNull();
    expect(renegadeView.players[3].role).toBe('renegade'); // 本人可见
  });

  it('阵亡者身份公开', () => {
    const game = makeGame();
    game.kill(game.players[3], game.players[0]); // 主公杀内奸
    const view = viewAs(game, 2); // 反贼视角
    expect(view.players[3].role).toBe('renegade');
    expect(view.players[4].role).toBeNull(); // 活着的反贼仍隐藏
  });

  it('对局结束后全员亮身份', () => {
    const game = makeGame();
    game.kill(game.players[0], game.players[2]); // 主公死 → 游戏结束
    expect(game.over).toBe(true);
    const view = viewAs(game, 2);
    expect(view.players.map((p) => p.role)).toEqual(ROLES);
  });

  it('主公体力上限 +1 体现在公开状态里', () => {
    const game = makeGame();
    const view = viewAs(game, 2);
    expect(view.players[0].maxHp).toBe(5); // 白板 4 血 + 主公 1
    expect(view.players[1].maxHp).toBe(4);
  });

  it('1v1（无身份）role 全为 null', () => {
    const game = new Game({ playerNames: ['甲', '乙'], deck: new InfiniteDeck(['sha']) });
    const view = buildPublicState(game, game.players[0], {
      code: 'TEST',
      pendingPlayerId: null,
      logs: [],
    });
    expect(view.players.every((p) => p.role === null)).toBe(true);
    expect(view.me.role).toBeNull();
  });
});

describe('势力与性别的公开透出', () => {
  it('PublicPlayer 带 kingdom/gender（任何视角可见）；白板势力为 null', () => {
    const game = new Game({
      playerNames: ['甲', '乙'],
      generals: [LIUBEI, DIAOCHAN],
      deck: new InfiniteDeck(['sha']),
    });
    const view = viewAs(game, 0);
    expect(view.players[0].kingdom).toBe('shu');
    expect(view.players[0].gender).toBe('male');
    expect(view.players[1].kingdom).toBe('qun');
    expect(view.players[1].gender).toBe('female');

    const blankGame = new Game({ playerNames: ['甲', '乙'], deck: new InfiniteDeck(['sha']) });
    const blankView = viewAs(blankGame, 0);
    expect(blankView.players[0].kingdom).toBeNull();
    expect(blankView.players[0].gender).toBe('male'); // 白板默认男性
  });
});
