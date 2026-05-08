import { z } from 'zod';

export const HearthstoneActionSchema = z.object({
  step: z.number().describe("操作步骤序号，从1开始递增"),
  title: z.string().describe("该步操作的简明标题（例如：火球术解场）"),
  detail: z.string().describe("该步操作的详细说明，必须指出明确的目标和动机"),
  reason: z.string().describe("采取该操作的深层次原因和战略考量"),
  confidence: z.number().min(0).max(1).describe("此推荐操作的置信度，范围0~1")
});

export const HearthstoneRecommendResponseSchema = z.object({
  summary: z.string().describe("当前回合局面的整体评估与策略一句话摘要"),
  risk: z.enum(['low', 'medium', 'high']).describe("当前局面的生存风险评级：低/中/高"),
  actions: z.array(HearthstoneActionSchema).min(1).max(5).describe("推荐玩家在本回合执行的操作步骤列表"),
  nextTurnPlan: z.string().describe("为下一回合准备的延续性策略规划"),
  operationStrategy: z.object({
    corePlan: z.string().describe("整局游戏核心获胜计划的微调与重申"),
    economyPlan: z.string().describe("资源差、法力水晶利用及手牌厚度的管理建议"),
    keyCardsToKeep: z.array(z.string()).describe("目前手牌中极具价值、绝对不要轻易打出的关键牌名"),
    avoidPlays: z.array(z.string()).describe("本回合严禁或极度不推荐的坏操作、伏笔打法")
  })
});

export const HearthstoneTurnOptionSchema = z.object({
  id: z.enum(['control', 'burst', 'develop']).describe("打法流派ID：控场(control)、直伤爆发(burst)或铺场展开(develop)"),
  title: z.string().describe("该打法流派的凝练标题"),
  detail: z.string().describe("该打法流派的具体实施动作，包括出牌顺序、攻击目标选择等"),
  expected: z.string().describe("执行此打法后，预期场面和血量会发生的有利变化"),
  risk: z.enum(['low', 'medium', 'high']).describe("实施该打法流派所需承担的风险"),
  isBest: z.boolean().describe("这一项是否为本阶段最优选项（三个选项中有且仅能有一个为true）")
});

export const HearthstoneTurnOptionsResponseSchema = z.object({
  options: z.array(HearthstoneTurnOptionSchema).length(3).describe("分别为三套风格迥异的操作选项")
});

export const MinionSchema = z.object({
  id: z.string(),
  name: z.string(),
  attack: z.number(),
  health: z.number(),
  maxHealth: z.number(),
  keywords: z.array(z.string()).optional(),
  description: z.string().optional()
});

export const EnemySimOutputSchema = z.object({
  playerActionSummary: z.string().describe("总结玩家刚刚执行的一系列动作"),
  enemyActionSummary: z.string().describe("总结AI模拟出的最优应对出牌和反制手段"),
  randomEvents: z.array(z.string()).describe("模拟出的回合内发生的随机事件影响（如随机伤害分配）"),
  actionTrace: z.array(z.object({
    source: z.string(),
    target: z.string(),
    effect: z.string()
  })).describe("本回合关键动作链，记录施法源、目标和产生的效果"),
  stateDelta: z.object({
    myHealthChange: z.number().describe("玩家英雄血量变化量，负数为扣血，正数为回血"),
    enemyHealthChange: z.number().describe("敌方英雄血量变化量"),
    myHandDelta: z.number().describe("玩家手牌数量变化量（通常为抽牌或被特殊效果弃牌带来的改变）"),
    enemyHandDelta: z.number().describe("敌方手牌数量变化量（随从出牌通常减少）"),
    myBoardRemoveCount: z.number().describe("玩家场上被移除的随从数量"),
    myBoardAdd: z.array(MinionSchema).describe("玩家场上新增的随从实体列表"),
    enemyBoardRemoveCount: z.number().describe("敌方场上被移除的随从数量"),
    enemyBoardAdd: z.array(MinionSchema).describe("敌方场上新增的随从实体列表")
  }).describe("由于敌方模拟回合引发的双方场面净变化指标")
});
