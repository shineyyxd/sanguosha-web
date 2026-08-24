/**
 * @sanguosha/client —— Phaser 3 网页客户端。
 *
 * 结构：
 * - protocol.ts     协议类型（拷贝自 server，见文件头同步说明）
 * - core/client.ts  ClientCore：协议接入层（socket 封装 + 会话状态机），不依赖 Phaser
 * - core/vm.ts      视图模型：PublicState/AskRequest → 渲染与交互派生数据，纯逻辑可单测
 * - scenes/         Phaser 场景：大厅 / 房间 / 牌桌
 * - ui/widgets.ts   纯色卡牌与按钮组件
 * - smoke/          无头机器人冒烟脚本（tsx 运行）
 */

export { ClientCore } from './core/client.js';
export type { CoreSnapshot, CurrentAsk, SocketLike, StorageLike } from './core/client.js';
