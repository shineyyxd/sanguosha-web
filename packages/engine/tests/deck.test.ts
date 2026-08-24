import { describe, expect, it } from 'vitest';
import {
  STANDARD_CARDS,
  Standard108Deck,
  buildStandard108Cards,
  type Card,
} from '../src/index.js';

describe('标准版 108 张牌堆', () => {
  it('构成与数据一致：108 张，每种牌数量/花色点数正确', () => {
    const cards = buildStandard108Cards();
    expect(cards).toHaveLength(108);
    for (const entry of STANDARD_CARDS) {
      const ofName = cards.filter((c) => c.name === entry.id);
      expect(ofName).toHaveLength(entry.count);
      expect(ofName.map((c) => `${c.suit}${c.rank}`).sort()).toEqual(
        entry.suitsDistribution
          .map((t) => {
            const suitMap: Record<string, string> = {
              黑桃: 'spade',
              红桃: 'heart',
              梅花: 'club',
              方块: 'diamond',
            };
            return `${suitMap[t.slice(0, 2)]}${t.slice(2)}`;
          })
          .sort(),
      );
    }
    // 每张牌 id 唯一
    expect(new Set(cards.map((c) => c.id)).size).toBe(108);
  });

  it('同种子洗牌结果可复现，不同种子不同', () => {
    // 牌 id 全局自增，跨实例不可比；比较 (name,suit,rank) 序列
    const take = (seed: number) => {
      const d = new Standard108Deck(seed);
      return Array.from({ length: 20 }, () => {
        const c = d.draw();
        return `${c.name}-${c.suit}-${c.rank}`;
      });
    };
    expect(take(42)).toEqual(take(42));
    expect(take(42)).not.toEqual(take(43));
  });

  it('摸空时把弃牌堆洗回牌堆', () => {
    const deck = new Standard108Deck(7);
    const discard: Card[] = [];
    deck.bindDiscard(discard);

    const drawn = Array.from({ length: 108 }, () => deck.draw());
    expect(deck.remaining).toBe(0);
    expect(deck.reshuffleCount).toBe(0);

    // 弃掉其中 10 张，再摸应触发重洗且摸到的牌来自弃牌堆
    discard.push(...drawn.slice(0, 10));
    const recycled = deck.draw();
    expect(deck.reshuffleCount).toBe(1);
    expect(drawn.slice(0, 10).map((c) => c.id)).toContain(recycled.id);
    // 重洗后共能再摸 10 张，随后（弃牌堆空）报错
    for (let i = 0; i < 9; i++) deck.draw();
    expect(() => deck.draw()).toThrow();
  });
});
