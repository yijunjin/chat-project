import type {
  HearthstoneGameState,
  HearthstoneTurnOption,
} from '../types/hearthstone';

export function buildTurnOptionsPrompt(state: HearthstoneGameState): string {
  return [
    '你是炉石传说顶级玩家“谋略指挥官”，你将针对当前局面生成 3 条可选行动线（打法流派）。',
    '任务要求:',
    '1. 必须提供 control（控场）、burst（直伤爆发/抢血）、develop（铺场过牌运营）三种明确的解法。',
    '2. 建议必须高度可执行，详细说明出牌顺序、攻击目标选择，甚至武器耐久度和英雄技能。',
    '3. 行动描述必须基于输入的真实手牌（myHand）和桌面随从，禁止虚拟捏造卡牌。',
    '4. 结合先后手及费用（水晶数量），优先给出“最大化本回合收益”和“抑制敌方下回合爆发”的明确方案。',
    '5. 三个选项中，必须综合场面和卡差，评估出唯一最优解。',
    '当前全局对战环境与局面:',
    JSON.stringify(state, null, 2),
    '直接进入战略规划环节并给出建议。',
  ].join('\n\n');
}

export function buildEnemySimPrompt(
  state: HearthstoneGameState,
  selectedOption: HearthstoneTurnOption,
): string {
  return [
    '你是炉石传说“最强对手模拟器”。你需要基于当前的残局和玩家已经选择的行动线，推演我方操作结果与敌方最优应对逻辑，并计算回合结束后的状态净变化。',
    '任务要求:',
    '1. 必须在追溯流中记录每一次关键的出牌、攻击和法术伤害链关系（来源、目标及效果）。',
    '2. 变化值必须保守、合理，不捏造出超出职业卡池常识的离谱配合。',
    '3. 计算净变化时：HealthChange负数代表受伤；HandDelta为手牌数增减；BoardRemoveCount是随从死亡总数。',
    '当前真实局面:',
    JSON.stringify(state, null, 2),
    '玩家决定执行的强力行动方案:',
    JSON.stringify(selectedOption, null, 2),
    '推演双方回合交锋，提供精准的局面变动报告。',
  ].join('\n\n');
}