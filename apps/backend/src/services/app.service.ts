import { Injectable } from '@nestjs/common';
import { getLlm } from '../agents/index';
import { buildHearthstonePrompt } from '../prompts/hearthstone.prompt';
import {
  buildEnemySimPrompt,
  buildTurnOptionsPrompt,
} from '../prompts/hearthstone-turn.prompt';
import {
  HearthstoneAction,
  HearthstoneCard,
  HearthstoneCardDetailRequest,
  HearthstoneCardDetailResponse,
  HearthstoneCardsByIdsRequest,
  HearthstoneCardSearchRequest,
  HearthstoneCardSearchResponse,
  HearthstoneDeckRequest,
  HearthstoneDeckResponse,
  HearthstoneGameState,
  HearthstoneMetadataRequest,
  HearthstoneMetadataResponse,
  HearthstoneMinion,
  HearthstoneOpeningHandRequest,
  HearthstoneOpeningHandResponse,
  HearthstoneRecommendRequest,
  HearthstoneRecommendResponse,
  HearthstoneSimulateTurnRequest,
  HearthstoneSimulateTurnResponse,
  HearthstoneTurnOption,
  HearthstoneTurnOptionsRequest,
  HearthstoneTurnOptionsResponse,
  LiveLethalInfo,
  LiveRecommendationEnvelope,
} from '../types/hearthstone';
import { BlizzardService } from './blizzard.service';
import {
  EnemySimOutputSchema,
  HearthstoneRecommendResponseSchema,
  HearthstoneTurnOptionsResponseSchema,
} from '../types/schemas';
@Injectable()
export class AppService {
  private readonly liveRecommendationCache = new Map<
    string,
    { updatedAt: number; recommendation: LiveRecommendationEnvelope }
  >();
  private readonly liveCacheTtlMs = 15_000;

  constructor(private readonly blizzardService: BlizzardService) {}

  getHello(): string {
    return JSON.stringify('Hello World!');
  }

  async searchOfficialCards(
    request: HearthstoneCardSearchRequest,
  ): Promise<HearthstoneCardSearchResponse> {
    const cards = await this.blizzardService.searchCards({
      query: request.query,
      class: request.class,
      cardSet: request.cardSet,
      type: request.type,
      manaCost: request.manaCost,
      sort: request.sort,
      page: request.page,
      pageSize: request.pageSize,
      locale: request.locale,
    });

    return {
      cards,
      source: 'blizzard',
    };
  }

  async searchCardsByIds(
    request: HearthstoneCardsByIdsRequest,
  ): Promise<HearthstoneCardSearchResponse> {
    const ids = (request.ids || []).map((item) => String(item || '').trim()).filter((item) => !!item);
    if (ids.length === 0) {
      return {
        cards: [],
        source: 'blizzard',
      };
    }

    const cards = await this.blizzardService.searchCardsByIds({
      ids,
      locale: request.locale,
      pageSize: request.pageSize,
    });

    return {
      cards,
      source: 'blizzard',
    };
  }

  async getCardDetail(
    request: HearthstoneCardDetailRequest,
  ): Promise<HearthstoneCardDetailResponse> {
    const result = await this.blizzardService.getCardDetail({
      cardSlug: request.cardSlug,
      cardId: request.cardId,
      cardName: request.cardName,
      cardType: request.cardType,
      cardCost: request.cardCost,
      locale: request.locale,
    });

    if (result) {
      return {
        ...result,
        source: 'blizzard',
      };
    }

    return {
      cardId: request.cardId || request.cardSlug || 'unknown',
      slug: request.cardSlug || request.cardId || 'unknown',
      name: request.cardName || request.cardId || request.cardSlug || '未知卡牌',
      flavorText: '暂无背景文本',
      cardLevel: '-',
      artistName: '-',
      relatedCards: [],
      details: [
        { key: 'cost', value: '0' },
        { key: 'type', value: 'unknown' },
        { key: 'text', value: '未能从官方接口解析该卡牌详情' },
      ],
      raw: {
        id: request.cardId || request.cardSlug || 'unknown',
        name: request.cardName || request.cardId || request.cardSlug || '未知卡牌',
        cost: 0,
        type: 'unknown',
        text: '未能从官方接口解析该卡牌详情',
      },
      source: 'fallback',
    };
  }

  async getMetadata(
    request: HearthstoneMetadataRequest,
  ): Promise<HearthstoneMetadataResponse> {
    const data = await this.blizzardService.getMetadata({
      locale: request.locale,
    });

    if (data && data.classes.length > 0 && data.sets.length > 0) {
      return {
        ...data,
        source: 'blizzard',
      };
    }

    return {
      classes: this.getFallbackMetadataClasses(),
      sets: this.getFallbackMetadataSets(),
      source: 'fallback',
    };
  }

  async getOpeningHand(
    request: HearthstoneOpeningHandRequest,
  ): Promise<HearthstoneOpeningHandResponse> {
    const drawCount = request.isPlayerFirst ? 3 : 4;
    const cards = await this.blizzardService.searchCards({
      class: request.heroClass,
      page: 1,
      pageSize: 30,
      locale: request.locale,
    });

    let opening = this.pickRandomCards(cards, drawCount);
    let source: 'blizzard' | 'fallback' = 'blizzard';

    if (opening.length < drawCount) {
      opening = this.pickRandomCards(this.getFallbackCards(request.heroClass), drawCount);
      source = 'fallback';
    }

    if (!request.isPlayerFirst) {
      opening.push({
        id: `coin-${Date.now()}`,
        name: '幸运币',
        cost: 0,
        text: '在本回合获得 1 点法力水晶。',
        type: 'coin',
      });
    }

    return {
      cards: opening,
      source,
    };
  }

  async getDeck(request: HearthstoneDeckRequest): Promise<HearthstoneDeckResponse> {
    const cards = await this.blizzardService.fetchDeck({
      code: request.code,
      locale: request.locale,
    });

    if (cards.length > 0) {
      return {
        cards,
        source: 'blizzard',
      };
    }

    const fallback = this.getFallbackCards('');
    return {
      cards: fallback.slice(0, 30),
      source: 'fallback',
    };
  }

  async testAgent(prompt?: string, provider?: string): Promise<string> {
    const input = prompt?.trim() || 'Tell me a joke about programming.';
    const llm = getLlm(provider);
    const res = await llm.invoke(input);
    return typeof res?.content === 'string' ? res.content : JSON.stringify(res);
  }

  buildLiveFallbackRecommendation(
    request: HearthstoneRecommendRequest,
    generationId: number,
  ): LiveRecommendationEnvelope {
    const normalized = this.normalizeRequest(request);
    const goal = this.deriveLiveGoal(normalized);
    const livePayload: HearthstoneRecommendRequest = {
      ...normalized,
      goal,
    };
    const lethal = this.calculateLiveLethal(livePayload);
    const cacheKey = this.buildLiveCacheKey(livePayload, lethal);
    const fallback = this.buildFallbackRecommendation(livePayload, 'rule-engine');
    return this.toLiveEnvelope(fallback, {
      generationId,
      cacheKey,
      goal,
      lethal,
      latencyMs: 1,
    });
  }

  async recommendLiveGamePlan(
    request: HearthstoneRecommendRequest,
    options: {
      generationId: number;
      timeoutMs?: number;
      providers?: Array<'deepseek' | 'google'>;
    },
  ): Promise<LiveRecommendationEnvelope> {
    const startedAt = Date.now();
    const normalized = this.normalizeRequest(request);
    const goal = this.deriveLiveGoal(normalized);
    const livePayload: HearthstoneRecommendRequest = {
      ...normalized,
      goal,
    };

    const lethal = this.calculateLiveLethal(livePayload);
    const cacheKey = this.buildLiveCacheKey(livePayload, lethal);
    const cached = this.liveRecommendationCache.get(cacheKey);
    if (cached && Date.now() - cached.updatedAt <= this.liveCacheTtlMs) {
      return {
        ...cached.recommendation,
        goal,
        lethal,
        aiMeta: {
          ...cached.recommendation.aiMeta,
          generationId: options.generationId,
          cacheKey,
          latencyMs: Date.now() - startedAt,
        },
      };
    }

    const timeoutMs = this.clampNumber(options.timeoutMs ?? 900, 300, 2000, 900);
    const providers = this.normalizeProviderOrder(options.providers);
    const attempts = providers.map((provider) =>
      this.withTimeout(
        this.recommendHearthstonePlan({
          ...livePayload,
          provider,
        }),
        timeoutMs,
      ),
    );

    let chosen: HearthstoneRecommendResponse;
    try {
      const llmOnlyAttempts = attempts.map((attempt) =>
        attempt.then((result) => {
          if (result.aiMeta.mode === 'llm') {
            return result;
          }
          throw new Error('fallback');
        }),
      );
      chosen = await Promise.any(llmOnlyAttempts);
    } catch {
      try {
        chosen = await Promise.any(attempts);
      } catch {
        chosen = this.buildFallbackRecommendation(livePayload, 'rule-engine');
      }
    }

    const envelope = this.toLiveEnvelope(chosen, {
      generationId: options.generationId,
      cacheKey,
      goal,
      lethal,
      latencyMs: Date.now() - startedAt,
    });
    this.liveRecommendationCache.set(cacheKey, {
      updatedAt: Date.now(),
      recommendation: envelope,
    });
    this.compactLiveRecommendationCache();

    return envelope;
  }

  async recommendHearthstonePlan(
    request: HearthstoneRecommendRequest,
  ): Promise<HearthstoneRecommendResponse> {
    const payload = this.normalizeRequest(request);
    const provider = payload.provider || 'google';

    try {
      const llm = getLlm(provider);
      const prompt = buildHearthstonePrompt(payload);
      const llmWithStruct = llm.withStructuredOutput(HearthstoneRecommendResponseSchema);
      const result = await llmWithStruct.invoke(prompt);
      
      if (result) {
        return {
          ...result,
          aiMeta: {
            provider,
            mode: 'llm',
          },
        };
      }
    } catch (e) {
      // Fallback to deterministic recommendation when model invocation or parsing fails.
    }

    return this.buildFallbackRecommendation(payload, provider);
  }

  async getTurnOptions(
    request: HearthstoneTurnOptionsRequest,
  ): Promise<HearthstoneTurnOptionsResponse> {
    const state = this.normalizeGameState(request.state);
    const provider = request.provider || 'google';

    try {
      const llm = getLlm(provider);
      const prompt = buildTurnOptionsPrompt(state);
      const llmWithStruct = llm.withStructuredOutput(HearthstoneTurnOptionsResponseSchema);
      const result = await llmWithStruct.invoke(prompt);
      
      if (result && result.options) {
        return {
          options: this.ensureSingleBest(result.options as HearthstoneTurnOption[]),
          aiMeta: {
            provider,
            mode: 'llm',
          },
        };
      }
    } catch {
      // Fallback to deterministic options when model invocation or parsing fails.
    }

    return {
      options: this.ensureSingleBest(this.buildTurnOptions(state)),
      aiMeta: {
        provider,
        mode: 'fallback-rule',
      },
    };
  }

  async simulateTurn(
    request: HearthstoneSimulateTurnRequest,
  ): Promise<HearthstoneSimulateTurnResponse> {
    const state = this.normalizeGameState(request.state);
    const optionId = request.optionId || 'develop';
    const provider = request.provider || 'deepseek';

    const options = this.ensureSingleBest(this.buildTurnOptions(state));
    const selectedOption =
      request.selectedOption ||
      options.find((option) => option.id === optionId) ||
      options[0];

    const llmResult = await this.simulateWithLlm(state, selectedOption, provider);
    if (llmResult) {
      return llmResult;
    }

    return this.simulateByRule(state, selectedOption, provider);
  }

  private async simulateWithLlm(
    state: HearthstoneGameState,
    selectedOption: HearthstoneTurnOption,
    provider: 'deepseek' | 'google',
  ): Promise<HearthstoneSimulateTurnResponse | null> {
    try {
      const llm = getLlm(provider);
      const prompt = buildEnemySimPrompt(state, selectedOption);
      const llmWithStruct = llm.withStructuredOutput(EnemySimOutputSchema);
      const enemyTurn: any = await llmWithStruct.invoke(prompt);
      
      if (!enemyTurn) {
        return null;
      }

      const applied = this.applyLlmStateDelta(state, enemyTurn.stateDelta);
      const updatedState = this.endTurnAndDraw(applied);
      const nextOptionsRes = await this.getTurnOptions({
        state: updatedState,
        provider,
      });

      return {
        updatedState,
        playerActionSummary: enemyTurn.playerActionSummary,
        enemyActionSummary: enemyTurn.enemyActionSummary,
        randomEvents: enemyTurn.randomEvents || [],
        actionTrace: enemyTurn.actionTrace || [],
        gameResult: this.getGameResult(updatedState),
        nextOptions: nextOptionsRes.options,
      };
    } catch {
      return null;
    }
  }

  private async simulateByRule(
    state: HearthstoneGameState,
    selectedOption: HearthstoneTurnOption,
    provider: 'deepseek' | 'google',
  ): Promise<HearthstoneSimulateTurnResponse> {
    const randomEvents: string[] = [];

    const playerState = this.applyPlayerAction(state, selectedOption, randomEvents);
    const enemyState = this.applyEnemyBestResponse(playerState, randomEvents);
    const updatedState = this.endTurnAndDraw(enemyState);

    const nextOptionsRes = await this.getTurnOptions({
      state: updatedState,
      provider,
    });

    return {
      updatedState,
      playerActionSummary: `你执行了 ${selectedOption.title}。`,
      enemyActionSummary: this.enemySummary(updatedState),
      randomEvents,
      actionTrace: [
        {
          source: '我方行动',
          target: '敌方局面',
          effect: selectedOption.title,
        },
        {
          source: '对手行动',
          target: '我方局面',
          effect: '最优应对',
        },
      ],
      gameResult: this.getGameResult(updatedState),
      nextOptions: nextOptionsRes.options,
    };
  }

  private endTurnAndDraw(state: HearthstoneGameState): HearthstoneGameState {
    return this.normalizeGameState({
      ...state,
      turn: state.turn + 1,
      myManaCrystals: Math.min(10, state.myManaCrystals + 1),
      enemyManaCrystals: Math.min(10, state.enemyManaCrystals + 1),
      myHand: this.drawCard(state.myHand, '我方补牌'),
      enemyHandCount: Math.min(10, state.enemyHandCount + 1),
    });
  }

  private buildFallbackRecommendation(
    payload: HearthstoneRecommendRequest,
    provider: string,
  ): HearthstoneRecommendResponse {
    const actions: HearthstoneAction[] = [];

    const pressureGap = payload.enemyBoard.length - payload.myBoard.length;
    const lethalWindow = payload.enemyHealth <= payload.myManaCrystals + 3;
    const lowHealth = payload.myHealth <= 12;
    const hasAoEHint = payload.myHand.some((card) =>
      /(flamestrike|consecration|whirlwind|brawl|清场|aoe)/i.test(card.name),
    );

    if (lowHealth || payload.goal === 'survival') {
      actions.push({
        step: actions.length + 1,
        title: '稳住血线',
        detail: '优先解场，避免无意义抢脸。保留嘲讽/回血资源。',
        reason: `当前血量 ${payload.myHealth}，进入高风险区间。`,
        confidence: 0.91,
      });
    }

    if (pressureGap >= 2 && hasAoEHint) {
      actions.push({
        step: actions.length + 1,
        title: '使用清场牌反打节奏',
        detail: '先计算敌方最高威胁随从，尽量一张牌换两张以上价值。',
        reason: `敌方场面数量领先 ${pressureGap}，手牌疑似有清场能力。`,
        confidence: 0.87,
      });
    }

    if (lethalWindow && payload.goal !== 'survival') {
      actions.push({
        step: actions.length + 1,
        title: '尝试两回合内斩杀线',
        detail: '先打直伤和高攻击随从，保留最少必要的解牌。',
        reason: `敌方血量 ${payload.enemyHealth}，接近可斩杀阈值。`,
        confidence: 0.83,
      });
    }

    if (actions.length === 0) {
      actions.push({
        step: 1,
        title: '争取资源差',
        detail: '优先做出高费曲线与高质量交换，逼迫对手先解你的核心随从。',
        reason: '当前局面均势，适合滚雪球建立资源优势。',
        confidence: 0.76,
      });
    }

    const risk = this.calcRisk(payload.myHealth, pressureGap);
    return {
      summary: `${payload.heroClass} 对阵 ${payload.enemyClass}，建议以${this.goalText(payload.goal)}为主线。`,
      risk,
      actions,
      nextTurnPlan:
        risk === 'high'
          ? '下回合继续优先防守，若未解掉核心威胁则放弃贪牌。'
          : '下回合根据抽牌决定转守为攻，保持法力利用率接近满费。',
      operationStrategy: {
        corePlan: '先确保场面不崩，再根据手牌质量决定转进攻时机。',
        economyPlan: '尽量避免亏费与低效交换，优先制造资源差。',
        keyCardsToKeep: payload.myHand.slice(0, 2).map((item) => item.name),
        avoidPlays: ['在没有斩杀的前提下过早交完爆发', '忽略敌方场面累计伤害'],
      },
      aiMeta: {
        provider,
        mode: 'fallback-rule',
      },
    };
  }

  private toLiveEnvelope(
    result: HearthstoneRecommendResponse,
    extras: {
      generationId: number;
      cacheKey: string;
      goal: HearthstoneRecommendRequest['goal'];
      lethal: LiveLethalInfo;
      latencyMs: number;
    },
  ): LiveRecommendationEnvelope {
    return {
      summary: result.summary,
      risk: result.risk,
      actions: result.actions,
      nextTurnPlan: result.nextTurnPlan,
      operationStrategy: result.operationStrategy,
      confidence: this.calcRecommendationConfidence(result),
      goal: extras.goal,
      lethal: extras.lethal,
      aiMeta: {
        provider: result.aiMeta.provider,
        mode: result.aiMeta.mode,
        generationId: extras.generationId,
        cacheKey: extras.cacheKey,
        latencyMs: Math.max(1, extras.latencyMs),
      },
    };
  }

  private calcRecommendationConfidence(result: HearthstoneRecommendResponse): number {
    if (!result.actions.length) {
      return 0.62;
    }
    const avg =
      result.actions.reduce((sum, action) => sum + this.clampConfidence(action.confidence), 0) /
      result.actions.length;
    const riskPenalty = result.risk === 'high' ? 0.1 : result.risk === 'medium' ? 0.04 : 0;
    return this.clampConfidence(avg - riskPenalty);
  }

  private clampConfidence(value: number): number {
    if (!Number.isFinite(value)) {
      return 0.6;
    }
    return Math.max(0.05, Math.min(0.99, Number(value.toFixed(2))));
  }

  private deriveLiveGoal(payload: HearthstoneRecommendRequest): HearthstoneRecommendRequest['goal'] {
    const pressureGap = payload.enemyBoard.length - payload.myBoard.length;
    const lethal = this.calculateLiveLethal(payload);
    if (lethal.lethalNow || lethal.lethalInTwoTurns || payload.enemyHealth <= 12) {
      return 'burst';
    }
    if (payload.myHealth <= 12 || pressureGap >= 2) {
      return 'survival';
    }
    if (payload.myManaCrystals >= 7 && payload.myHand.length >= 5) {
      return 'value';
    }
    return 'tempo';
  }

  private calculateLiveLethal(payload: HearthstoneRecommendRequest): LiveLethalInfo {
    const myBoardAttack = payload.myBoard.reduce(
      (sum, minion) => sum + this.clampNumber(minion.attack, 0, 40, 0),
      0,
    );
    const burstCards = payload.myHand
      .map((card) => ({
        damage: this.estimateSpellDamage(card),
        cost: this.clampNumber(card.cost, 0, 20, 0),
      }))
      .filter((card) => card.damage > 0)
      .sort((a, b) => (b.damage / Math.max(1, b.cost)) - (a.damage / Math.max(1, a.cost)));

    let manaLeft = payload.myManaCrystals;
    let estimatedHandBurst = 0;
    for (const card of burstCards) {
      if (card.cost <= manaLeft) {
        manaLeft -= card.cost;
        estimatedHandBurst += card.damage;
      }
    }

    const estimatedTotalDamage = myBoardAttack + estimatedHandBurst;
    const lethalNow = estimatedTotalDamage >= payload.enemyHealth;
    const lethalInTwoTurns = estimatedTotalDamage + myBoardAttack >= payload.enemyHealth;

    return {
      lethalNow,
      lethalInTwoTurns,
      myBoardAttack,
      estimatedHandBurst,
      estimatedTotalDamage,
    };
  }

  private estimateSpellDamage(card: HearthstoneCard): number {
    const name = (card.name || '').toLowerCase();
    const text = (card.text || '').toLowerCase();
    if (/fireball|火球|pyroblast|炎爆/.test(name)) {
      return /炎爆|pyroblast/.test(name) ? 10 : 6;
    }
    if (/frostbolt|寒冰箭/.test(name)) {
      return 3;
    }
    if (/kill command|杀戮命令/.test(name)) {
      return 5;
    }
    if (/moonfire|月火术/.test(name)) {
      return 1;
    }

    const damageMatch = text.match(/造成\s*(\d+)\s*点伤害/u) || text.match(/deal\s*(\d+)\s*damage/u);
    if (damageMatch?.[1]) {
      return this.clampNumber(parseInt(damageMatch[1], 10), 0, 20, 0);
    }
    return 0;
  }

  private buildLiveCacheKey(
    payload: HearthstoneRecommendRequest,
    lethal: LiveLethalInfo,
  ): string {
    const boardHash = [
      ...payload.myBoard.map((item) => `${item.id}:${item.attack}/${item.health}`),
      ...payload.enemyBoard.map((item) => `${item.id}:${item.attack}/${item.health}`),
    ].join('|');
    const handHash = payload.myHand.map((card) => `${card.id}:${card.cost}`).join('|');
    return [
      payload.heroClass,
      payload.enemyClass,
      payload.myHealth,
      payload.enemyHealth,
      payload.myManaCrystals,
      payload.enemyManaCrystals,
      lethal.lethalNow ? 'L1' : 'L0',
      lethal.lethalInTwoTurns ? 'L2' : 'Lx',
      boardHash,
      handHash,
    ].join('#');
  }

  private normalizeProviderOrder(
    providers?: Array<'deepseek' | 'google'>,
  ): Array<'deepseek' | 'google'> {
    const result: Array<'deepseek' | 'google'> = [];
    const source = providers && providers.length > 0 ? providers : ['deepseek', 'google'];
    for (const provider of source) {
      if ((provider === 'deepseek' || provider === 'google') && !result.includes(provider)) {
        result.push(provider);
      }
    }
    if (result.length === 0) {
      return ['deepseek', 'google'];
    }
    return result;
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`timeout:${timeoutMs}`));
      }, timeoutMs);
      promise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  private compactLiveRecommendationCache(): void {
    if (this.liveRecommendationCache.size <= 120) {
      return;
    }
    const now = Date.now();
    for (const [key, value] of this.liveRecommendationCache.entries()) {
      if (now - value.updatedAt > this.liveCacheTtlMs) {
        this.liveRecommendationCache.delete(key);
      }
    }
  }

  private buildTurnOptions(state: HearthstoneGameState): HearthstoneTurnOption[] {
    const handHint = state.myHand.slice(0, 2).map((card) => card.name).join(' + ') || '低费法术';
    const pressureGap = state.enemyBoard.length - state.myBoard.length;

    return [
      {
        id: 'control',
        title: `${handHint} 解场控节奏`,
        detail: '优先处理敌方最高攻击随从，再补上低费站场。',
        expected: '降低敌方场攻并减少我方下回合压力。',
        risk: pressureGap >= 2 ? 'medium' : 'low',
        isBest: pressureGap >= 1,
      },
      {
        id: 'burst',
        title: '直伤压血抢斩杀窗口',
        detail: '以直伤和场攻压低敌方血量，争取两回合斩杀。',
        expected: '逼迫对手转入防守，压缩其资源操作空间。',
        risk: state.myHealth <= 14 ? 'high' : 'medium',
        isBest: state.enemyHealth <= state.myManaCrystals + 8,
      },
      {
        id: 'develop',
        title: '铺场运营保资源曲线',
        detail: '优先站场和过牌，保证后续回合持续输出能力。',
        expected: '提高后续资源质量并形成滚雪球场面。',
        risk: 'medium',
        isBest: false,
      },
    ];
  }

  private ensureSingleBest(options: HearthstoneTurnOption[]): HearthstoneTurnOption[] {
    const ranked = options.map((item) => ({ ...item }));
    const bestList = ranked.filter((item) => item.isBest);
    if (bestList.length === 1) {
      return ranked;
    }

    for (const item of ranked) {
      item.isBest = false;
    }

    const score = (risk: HearthstoneTurnOption['risk']): number => {
      if (risk === 'low') {
        return 3;
      }
      if (risk === 'medium') {
        return 2;
      }
      return 1;
    };

    ranked.sort((a, b) => score(b.risk) - score(a.risk));
    ranked[0].isBest = true;

    const byId = new Map(ranked.map((item) => [item.id, item]));
    return options.map((item) => byId.get(item.id) || item);
  }

  private normalizeTurnOptions(data: unknown): HearthstoneTurnOption[] {
    if (!data || typeof data !== 'object') {
      return [];
    }

    const options = (data as { options?: unknown[] }).options;
    if (!Array.isArray(options)) {
      return [];
    }

    const map: Record<HearthstoneTurnOption['id'], HearthstoneTurnOption | null> = {
      control: null,
      burst: null,
      develop: null,
    };

    for (const item of options) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const option = item as Partial<HearthstoneTurnOption>;
      if (option.id !== 'control' && option.id !== 'burst' && option.id !== 'develop') {
        continue;
      }

      const risk =
        option.risk === 'low' || option.risk === 'medium' || option.risk === 'high'
          ? option.risk
          : 'medium';

      if (
        typeof option.title === 'string' &&
        typeof option.detail === 'string' &&
        typeof option.expected === 'string'
      ) {
        map[option.id] = {
          id: option.id,
          title: option.title.slice(0, 70),
          detail: option.detail.slice(0, 220),
          expected: option.expected.slice(0, 140),
          risk,
          isBest: option.isBest === true,
        };
      }
    }

    const result = [map.control, map.burst, map.develop].filter(
      (item): item is HearthstoneTurnOption => !!item,
    );
    return this.ensureSingleBest(result);
  }

  private normalizeEnemyTurnOutput(data: unknown): {
    playerActionSummary: string;
    enemyActionSummary: string;
    randomEvents: string[];
    actionTrace: Array<{
      source: string;
      target: string;
      effect: string;
    }>;
    stateDelta: {
      myHealthChange: number;
      enemyHealthChange: number;
      myHandDelta: number;
      enemyHandDelta: number;
      myBoardRemoveCount: number;
      myBoardAdd: HearthstoneMinion[];
      enemyBoardRemoveCount: number;
      enemyBoardAdd: HearthstoneMinion[];
    };
  } | null {
    if (!data || typeof data !== 'object') {
      return null;
    }

    const value = data as {
      playerActionSummary?: unknown;
      enemyActionSummary?: unknown;
      randomEvents?: unknown;
      stateDelta?: Record<string, unknown>;
    };

    if (
      typeof value.playerActionSummary !== 'string' ||
      typeof value.enemyActionSummary !== 'string' ||
      !Array.isArray(value.randomEvents) ||
      !value.stateDelta ||
      typeof value.stateDelta !== 'object'
    ) {
      return null;
    }

    const s = value.stateDelta;
    const safeNumber = (input: unknown, min: number, max: number): number => {
      if (typeof input !== 'number' || Number.isNaN(input)) {
        return 0;
      }
      return Math.min(max, Math.max(min, Math.round(input)));
    };

    return {
      playerActionSummary: value.playerActionSummary,
      enemyActionSummary: value.enemyActionSummary,
      randomEvents: value.randomEvents
        .filter((item): item is string => typeof item === 'string')
        .slice(0, 4),
      actionTrace: Array.isArray((value as { actionTrace?: unknown }).actionTrace)
        ? ((value as { actionTrace: unknown[] }).actionTrace
          .map((item) => {
            if (!item || typeof item !== 'object') {
              return null;
            }
            const trace = item as { source?: unknown; target?: unknown; effect?: unknown };
            if (
              typeof trace.source !== 'string' ||
              typeof trace.target !== 'string' ||
              typeof trace.effect !== 'string'
            ) {
              return null;
            }
            return {
              source: trace.source,
              target: trace.target,
              effect: trace.effect,
            };
          })
          .filter((item): item is NonNullable<typeof item> => !!item)
          .slice(0, 6))
        : [],
      stateDelta: {
        myHealthChange: safeNumber(s.myHealthChange, -12, 8),
        enemyHealthChange: safeNumber(s.enemyHealthChange, -12, 8),
        myHandDelta: safeNumber(s.myHandDelta, -3, 2),
        enemyHandDelta: safeNumber(s.enemyHandDelta, -3, 2),
        myBoardRemoveCount: safeNumber(s.myBoardRemoveCount, 0, 4),
        myBoardAdd: this.normalizeMinionList(s.myBoardAdd, 'my-add'),
        enemyBoardRemoveCount: safeNumber(s.enemyBoardRemoveCount, 0, 4),
        enemyBoardAdd: this.normalizeMinionList(s.enemyBoardAdd, 'enemy-add'),
      },
    };
  }

  private applyLlmStateDelta(
    state: HearthstoneGameState,
    delta: {
      myHealthChange: number;
      enemyHealthChange: number;
      myHandDelta: number;
      enemyHandDelta: number;
      myBoardRemoveCount: number;
      myBoardAdd: HearthstoneMinion[];
      enemyBoardRemoveCount: number;
      enemyBoardAdd: HearthstoneMinion[];
    },
  ): HearthstoneGameState {
    const next: HearthstoneGameState = {
      ...state,
      myHand: [...state.myHand],
      myBoard: [...state.myBoard],
      enemyBoard: [...state.enemyBoard],
    };

    next.myHealth = Math.min(40, Math.max(0, next.myHealth + delta.myHealthChange));
    next.enemyHealth = Math.min(40, Math.max(0, next.enemyHealth + delta.enemyHealthChange));

    if (delta.myHandDelta < 0) {
      next.myHand = next.myHand.slice(Math.abs(delta.myHandDelta));
    }
    if (delta.myHandDelta > 0) {
      for (let i = 0; i < delta.myHandDelta; i += 1) {
        next.myHand = this.drawCard(next.myHand, '我方随机补牌');
      }
    }

    next.enemyHandCount = Math.min(10, Math.max(0, next.enemyHandCount + delta.enemyHandDelta));

    if (delta.myBoardRemoveCount > 0) {
      next.myBoard = next.myBoard.slice(delta.myBoardRemoveCount);
    }
    if (delta.enemyBoardRemoveCount > 0) {
      next.enemyBoard = next.enemyBoard.slice(delta.enemyBoardRemoveCount);
    }

    next.myBoard = [...next.myBoard, ...delta.myBoardAdd].slice(0, 7);
    next.enemyBoard = [...next.enemyBoard, ...delta.enemyBoardAdd].slice(0, 7);

    return next;
  }

  private applyPlayerAction(
    state: HearthstoneGameState,
    option: HearthstoneTurnOption,
    randomEvents: string[],
  ): HearthstoneGameState {
    const next: HearthstoneGameState = {
      ...state,
      myHand: [...state.myHand],
      myBoard: [...state.myBoard],
      enemyBoard: [...state.enemyBoard],
    };

    if (next.myHand.length > 0) {
      next.myHand.shift();
    }

    if (option.id === 'control') {
      const removeCount = Math.min(next.enemyBoard.length, this.randInt(1, 2));
      next.enemyBoard = next.enemyBoard.slice(removeCount);
      next.enemyHealth = Math.max(0, next.enemyHealth - this.randInt(1, 2));
      randomEvents.push(`你通过解场处理了对手 ${removeCount} 个随从。`);
      return next;
    }

    if (option.id === 'burst') {
      const damage = this.randInt(4, 8);
      next.enemyHealth = Math.max(0, next.enemyHealth - damage);
      randomEvents.push(`你选择抢脸，本回合造成 ${damage} 点伤害。`);
      return next;
    }

    next.myBoard.push(this.createMinion('我方衍生体', this.randInt(2, 4), this.randInt(2, 4), 'my-dev'));
    randomEvents.push('你选择铺场运营，场面厚度提升。');
    return next;
  }

  private applyEnemyBestResponse(
    state: HearthstoneGameState,
    randomEvents: string[],
  ): HearthstoneGameState {
    const next: HearthstoneGameState = {
      ...state,
      myHand: [...state.myHand],
      myBoard: [...state.myBoard],
      enemyBoard: [...state.enemyBoard],
      enemyHandCount: Math.max(0, state.enemyHandCount - 1),
    };

    const shouldClear = next.myBoard.length >= 3;
    const shouldFace = next.myHealth <= 14 || (next.myBoard.length === 0 && next.enemyBoard.length > 0);

    if (shouldClear) {
      const removeCount = Math.min(next.myBoard.length, this.randInt(1, 2));
      next.myBoard = next.myBoard.slice(removeCount);
      randomEvents.push(`对手最优应对: 解掉了你 ${removeCount} 个随从。`);
      return next;
    }

    if (shouldFace) {
      const damage = this.randInt(3, 7);
      next.myHealth = Math.max(0, next.myHealth - damage);
      randomEvents.push(`对手最优应对: 抢脸造成 ${damage} 点伤害。`);
      return next;
    }

    next.enemyBoard.push(this.createMinion('敌方站场随从', this.randInt(2, 5), this.randInt(2, 5), 'enemy-dev'));
    randomEvents.push('对手最优应对: 继续铺场扩大压力。');
    return next;
  }

  private drawCard(hand: HearthstoneCard[], prefix: string): HearthstoneCard[] {
    if (hand.length >= 10) {
      return hand;
    }
    return [
      ...hand,
      {
        id: `${prefix}-${this.randInt(1000, 9999)}`,
        name: `${prefix}${this.randInt(1, 30)}`,
        cost: this.randInt(1, 8),
        text: '占位卡牌描述，后续可接入真实卡池。',
        type: 'spell',
      },
    ];
  }

  private enemySummary(state: HearthstoneGameState): string {
    if (state.myHealth <= 12) {
      return '对手识别你血线较低，继续施压抢脸。';
    }
    if (state.myBoard.length <= 1 && state.enemyBoard.length >= 2) {
      return '对手认为场面优势已建立，选择扩大场攻。';
    }
    return '对手采取稳健应对，兼顾解场与节奏推进。';
  }

  private normalizeGameState(state: HearthstoneGameState): HearthstoneGameState {
    return {
      turn: this.clampNumber(state.turn, 1, 30, 1),
      isPlayerFirst: state.isPlayerFirst !== false,
      playerHasCoin: !!state.playerHasCoin,
      heroClass: state.heroClass?.trim() || '未知职业',
      enemyClass: state.enemyClass?.trim() || '未知职业',
      myHealth: this.clampNumber(state.myHealth, 0, 40, 30),
      enemyHealth: this.clampNumber(state.enemyHealth, 0, 40, 30),
      myManaCrystals: this.clampNumber(state.myManaCrystals, 0, 10, 0),
      enemyManaCrystals: this.clampNumber(state.enemyManaCrystals, 0, 10, 0),
      myHand: this.normalizeCardList(state.myHand),
      enemyHandCount: this.clampNumber(state.enemyHandCount, 0, 10, 4),
      myBoard: this.normalizeMinionList(state.myBoard, 'my-board'),
      enemyBoard: this.normalizeMinionList(state.enemyBoard, 'enemy-board'),
      goal: state.goal || 'tempo',
      notes: state.notes || '',
    };
  }

  private normalizeRequest(
    request: HearthstoneRecommendRequest,
  ): HearthstoneRecommendRequest {
    return {
      heroClass: request.heroClass?.trim() || '未知职业',
      enemyClass: request.enemyClass?.trim() || '未知职业',
      myHealth: this.clampNumber(request.myHealth, 0, 40, 30),
      enemyHealth: this.clampNumber(request.enemyHealth, 0, 40, 30),
      myManaCrystals: this.clampNumber(request.myManaCrystals, 0, 10, 0),
      enemyManaCrystals: this.clampNumber(request.enemyManaCrystals, 0, 10, 0),
      myHand: this.normalizeCardList(request.myHand),
      myBoard: this.normalizeMinionList(request.myBoard, 'my-board'),
      enemyBoard: this.normalizeMinionList(request.enemyBoard, 'enemy-board'),
      goal: request.goal || 'tempo',
      notes: request.notes || '',
      provider: request.provider || 'deepseek',
    };
  }

  private normalizeCardList(list: unknown): HearthstoneCard[] {
    if (!Array.isArray(list)) {
      return [];
    }
    return list
      .map((item, index) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const card = item as Partial<HearthstoneCard>;
        if (typeof card.name !== 'string') {
          return null;
        }
        const type: HearthstoneCard['type'] =
          card.type === 'spell' ||
          card.type === 'minion' ||
          card.type === 'weapon' ||
          card.type === 'location' ||
          card.type === 'hero' ||
          card.type === 'hero-power' ||
          card.type === 'coin'
            ? card.type
            : 'spell';
        return {
          id: typeof card.id === 'string' ? card.id : `card-${index}-${this.randInt(100, 999)}`,
          name: card.name,
          cost: this.clampNumber(card.cost as number, 0, 20, 1),
          text: typeof card.text === 'string' ? card.text : '暂无描述',
          type,
        };
      })
      .filter((item): item is HearthstoneCard => !!item)
      .slice(0, 10);
  }

  private normalizeMinionList(list: unknown, prefix: string): HearthstoneMinion[] {
    if (!Array.isArray(list)) {
      return [];
    }
    return list
      .map((item, index) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const minion = item as Partial<HearthstoneMinion>;
        if (typeof minion.name !== 'string') {
          return null;
        }
        const maxHealth = this.clampNumber(minion.maxHealth as number, 1, 20, 3);
        const health = this.clampNumber(minion.health as number, 1, maxHealth, maxHealth);
        return {
          id: typeof minion.id === 'string' ? minion.id : `${prefix}-${index}-${this.randInt(100, 999)}`,
          name: minion.name,
          attack: this.clampNumber(minion.attack as number, 0, 20, 2),
          health,
          maxHealth,
          keywords: Array.isArray(minion.keywords)
            ? minion.keywords.filter((v): v is string => typeof v === 'string').slice(0, 4)
            : [],
          description: typeof minion.description === 'string' ? minion.description : '',
        };
      })
        .filter((item): item is NonNullable<typeof item> => !!item)
      .slice(0, 7);
  }

  private createMinion(
    name: string,
    attack: number,
    health: number,
    prefix: string,
  ): HearthstoneMinion {
    return {
      id: `${prefix}-${this.randInt(1000, 9999)}`,
      name,
      attack,
      health,
      maxHealth: health,
      keywords: [],
      description: '',
    };
  }

  private readModelContent(content: unknown): string {
    if (typeof content === 'string') {
      return content;
    }
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (typeof part === 'string') {
            return part;
          }
          if (
            part &&
            typeof part === 'object' &&
            'text' in part &&
            typeof (part as { text?: unknown }).text === 'string'
          ) {
            return (part as { text: string }).text;
          }
          return '';
        })
        .join('\n');
    }
    return String(content || '');
  }

  private parseModelJson(text: string): unknown {
    const direct = text.trim();
    if (!direct) {
      return null;
    }

    try {
      return JSON.parse(direct);
    } catch {
      const fenced = direct.match(/```json\s*([\s\S]*?)\s*```/i);
      if (fenced?.[1]) {
        try {
          return JSON.parse(fenced[1]);
        } catch {
          return null;
        }
      }

      const start = direct.indexOf('{');
      const end = direct.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(direct.slice(start, end + 1));
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  private isValidRecommendation(data: unknown): data is HearthstoneRecommendResponse {
    if (!data || typeof data !== 'object') {
      return false;
    }

    const value = data as Partial<HearthstoneRecommendResponse>;
    const validRisk = value.risk === 'low' || value.risk === 'medium' || value.risk === 'high';
    const validActions =
      Array.isArray(value.actions) &&
      value.actions.length > 0 &&
      value.actions.every((action) => {
        const item = action as Partial<HearthstoneAction>;
        return (
          typeof item.step === 'number' &&
          typeof item.title === 'string' &&
          typeof item.detail === 'string' &&
          typeof item.reason === 'string' &&
          typeof item.confidence === 'number'
        );
      });

    const strategy =
      value.operationStrategy as HearthstoneRecommendResponse['operationStrategy'] | undefined;

    const validStrategy =
      !!strategy &&
      typeof strategy.corePlan === 'string' &&
      typeof strategy.economyPlan === 'string' &&
      Array.isArray(strategy.keyCardsToKeep) &&
      Array.isArray(strategy.avoidPlays);

    return (
      typeof value.summary === 'string' &&
      validRisk &&
      validActions &&
      typeof value.nextTurnPlan === 'string' &&
      validStrategy
    );
  }

  private clampNumber(
    value: number,
    min: number,
    max: number,
    fallback: number,
  ): number {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, Math.round(value)));
  }

  private calcRisk(
    myHealth: number,
    pressureGap: number,
  ): 'low' | 'medium' | 'high' {
    if (myHealth <= 10 || pressureGap >= 3) {
      return 'high';
    }
    if (myHealth <= 16 || pressureGap >= 1) {
      return 'medium';
    }
    return 'low';
  }

  private goalText(goal: HearthstoneRecommendRequest['goal']): string {
    const map: Record<HearthstoneRecommendRequest['goal'], string> = {
      tempo: '节奏压制',
      survival: '防守求生',
      burst: '爆发斩杀',
      value: '资源运营',
    };
    return map[goal] || map.tempo;
  }

  private randInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private pickRandomCards(cards: HearthstoneCard[], count: number): HearthstoneCard[] {
    if (cards.length === 0 || count <= 0) {
      return [];
    }
    const pool = [...cards];
    const result: HearthstoneCard[] = [];
    for (let i = 0; i < count && pool.length > 0; i += 1) {
      const index = this.randInt(0, pool.length - 1);
      const picked = pool.splice(index, 1)[0];
      result.push({
        ...picked,
        id: `${picked.id}-${Date.now()}-${i}`,
      });
    }
    return result;
  }

  private getFallbackMetadataClasses(): Array<{ id: number; slug: string; name: string }> {
    return [
      { id: 1, slug: 'demonhunter', name: '恶魔猎手' },
      { id: 2, slug: 'druid', name: '德鲁伊' },
      { id: 3, slug: 'hunter', name: '猎人' },
      { id: 4, slug: 'mage', name: '法师' },
      { id: 5, slug: 'paladin', name: '骑士' },
      { id: 6, slug: 'priest', name: '牧师' },
      { id: 7, slug: 'rogue', name: '潜行者' },
      { id: 8, slug: 'shaman', name: '萨满' },
      { id: 9, slug: 'warlock', name: '术士' },
      { id: 10, slug: 'warrior', name: '战士' },
      { id: 11, slug: 'deathknight', name: '死亡骑士' },
    ];
  }

  private getFallbackMetadataSets(): Array<{ id: number; slug: string; name: string }> {
    return [
      { id: 1, slug: 'standard', name: '标准' },
      { id: 2, slug: 'wild', name: '狂野' },
    ];
  }

  private getFallbackCards(heroClass?: string): HearthstoneCard[] {
    const fallback: HearthstoneCard[] = [
      {
        id: 'fallback-arcane-missiles',
        name: '奥术飞弹',
        cost: 1,
        text: '随机造成 3 点伤害，分配到敌方角色。',
        type: 'spell',
      },
      {
        id: 'fallback-fireball',
        name: '火球术',
        cost: 4,
        text: '造成 6 点伤害。',
        type: 'spell',
      },
      {
        id: 'fallback-frostbolt',
        name: '寒冰箭',
        cost: 2,
        text: '造成 3 点伤害并冻结目标。',
        type: 'spell',
      },
      {
        id: 'fallback-water-elemental',
        name: '水元素',
        cost: 4,
        text: '3/6，造成伤害会冻结目标。',
        type: 'minion',
      },
      {
        id: 'fallback-polymorph',
        name: '变形术',
        cost: 4,
        text: '将一个随从变形为 1/1 的绵羊。',
        type: 'spell',
      },
    ];

    if (heroClass && /德鲁伊|druid/i.test(heroClass)) {
      return [
        {
          id: 'fallback-wild-growth',
          name: '野性成长',
          cost: 3,
          text: '获得 1 个空的法力水晶。',
          type: 'spell',
        },
        {
          id: 'fallback-innervate',
          name: '激活',
          cost: 0,
          text: '本回合获得 1 点法力水晶。',
          type: 'spell',
        },
        ...fallback,
      ];
    }
    return fallback;
  }

  private getGameResult(state: HearthstoneGameState): {
    isGameOver: boolean;
    winner: 'player' | 'enemy' | 'none';
  } {
    if (state.myHealth <= 0 && state.enemyHealth <= 0) {
      return {
        isGameOver: true,
        winner: 'none',
      };
    }
    if (state.enemyHealth <= 0) {
      return {
        isGameOver: true,
        winner: 'player',
      };
    }
    if (state.myHealth <= 0) {
      return {
        isGameOver: true,
        winner: 'enemy',
      };
    }
    return {
      isGameOver: false,
      winner: 'none',
    };
  }
}
