# data/reference — 标准包参考数据

## 来源

提取自开源项目**无名杀**（仓库 [libnoname/noname](https://github.com/libnoname/noname)）：

- 武将：`apps/core/character/standard/`（`character.js` 定义 + `translate.js` 技能名与描述 + `sort.js` 的 `standard_2008` 名单）
- 卡牌：`apps/core/card/standard.js`（`translate` 段的牌名与效果描述 + `list` 段的牌堆花色点数构成）

提取日期：2026-08-22（对应 noname 仓库 main 分支当日版本）。

## 许可证提醒

无名杀以 **GPL-3.0** 发布。本目录**只含事实性游戏数据**（武将名、势力、体力、技能名与文字描述、卡牌名、花色点数、效果描述），不包含、也不允许从其源码复制任何代码。技能/卡牌描述为游戏规则的事实性文字，照原文收录以保持数据准确。

## standard-generals.json

标准包（2008 版）全部 25 名武将：魏 7 / 蜀 7 / 吴 8 / 群 3。字段：

- `id`：拼音标识（如 `caocao`）
- `name`：武将名（`zhenji` 按标准包通用名记作「甄姬」；noname 现版本译名为「甄宓」）
- `kingdom`：`wei` / `shu` / `wu` / `qun`
- `hp`：体力上限
- `skills[]`：`id`（拼音）、`name`（技能名）、`description`（技能原文描述；主公技照实收录，描述中带「主公技」前缀）

## standard-cards.json

标准包牌堆全部 32 种卡牌，共 108 张（含 EX 牌寒冰剑、仁王盾）。字段：

- `id`：拼音标识（如 `sha`）
- `name`：牌名
- `type`：`basic`（基本牌）/ `trick`（锦囊牌）/ `equip`（装备牌）
- `subtype`：仅装备牌和延时锦囊有；装备牌为 `weapon` / `armor` / `horse_plus`（+1 马）/ `horse_minus`（-1 马）；`lebu`、`shandian` 标注 `subtype: "delay"`（延时类锦囊，noname 中 type 为 `delay`）
- `description`：效果原文描述
- `count`：牌堆中张数
- `suits_distribution`：每张牌的花色点数列表（数字：A=1，J=11，Q=12，K=13）

数量速查：杀 30、闪 15、桃 8；武器 9 种 10 张（诸葛连弩 2）、防具 2 种 3 张（八卦阵 2）、+1 马 3、-1 马 3。
