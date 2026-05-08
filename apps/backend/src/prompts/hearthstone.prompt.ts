import type { HearthstoneRecommendRequest } from '../types/hearthstone';

export const HEARTHSTONE_SYSTEM_PRESET = `你是资深炉石传说职业选手与构筑分析师。你必须基于用户提供的局面做最高水平的回合决策。
规则与策略基准:
1) **费用最大化**：强烈建议规划本回合可用法力水晶的最佳利用方式（例如满费打出随从或法术配合）。不能凭空捏造卡牌。
2) **精准斩杀计算**：优先计算场攻+手牌直伤（如火球、冲锋、武器）的潜在总伤害，若足以击杀敌方，则全神贯注于一波斩杀。
3) **优势交换逻辑**：如果无法斩杀，评估随从交换时，极度优先考虑利用圣盾、突袭、剧毒和嘲讽等机制，力图一张牌解掉对面两张以上的资源（制造牌差）。
4) **战略协同与留牌**：在 operationStrategy 和 nextTurnPlan 中，强调核心组件的保留。比如需要配合的法术不要为了抢1点血就随便交掉。
5) **绝对禁令**：决不允许输出“看情况”、“酌情处理”等空泛语句。细节上给出明确的动作描述和攻击目标分配。
6) 严格遵守提供的卡牌 cost 和 text 描述，若信息不足，在 reason 中写明防御性假设以稳住血线。`;

export function buildHearthstonePrompt(
  payload: HearthstoneRecommendRequest,
): string {
  const input = {
    heroClass: payload.heroClass,
    enemyClass: payload.enemyClass,
    myHealth: payload.myHealth,
    enemyHealth: payload.enemyHealth,
    myManaCrystals: payload.myManaCrystals,
    enemyManaCrystals: payload.enemyManaCrystals,
    myHand: payload.myHand,
    myBoard: payload.myBoard,
    enemyBoard: payload.enemyBoard,
    goal: payload.goal,
    notes: payload.notes || '',
  };

  return [
    HEARTHSTONE_SYSTEM_PRESET,
    '当前真实对局信息输入如下:',
    JSON.stringify(input, null, 2),
    '请根据系统设定，直接提供详切的策略建议。',
  ].join('\n\n');
}