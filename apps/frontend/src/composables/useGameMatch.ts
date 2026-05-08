import { computed, reactive, ref } from 'vue';
import {
  fetchCardsByIds,
  fetchDeck,
  fetchHearthstoneRecommendation,
  fetchTurnOptions,
  simulateTurn,
} from '../services/hearthstoneApi';
import type {
  HearthstoneCard,
  HearthstoneGameState,
  HearthstoneMinion,
  HearthstoneRecommendRequest,
  HearthstoneRecommendResponse,
  HearthstoneTurnOption,
} from '../types/hearthstone';

function pickRandomCards(cards: HearthstoneCard[], count: number): HearthstoneCard[] {
  const pool = [...cards];
  const picked: HearthstoneCard[] = [];

  while (pool.length > 0 && picked.length < count) {
    const index = Math.floor(Math.random() * pool.length);
    picked.push(pool[index]);
    pool.splice(index, 1);
  }

  return picked;
}

function inferHeroClass(cards: HearthstoneCard[], fallback: string): string {
  const fromName = cards.find((item) => !!item.className)?.className;
  if (!fromName) {
    return fallback;
  }

  const map: Record<string, string> = {
    mage: 'mage',
    paladin: 'paladin',
    warrior: 'warrior',
    druid: 'druid',
    priest: 'priest',
    rogue: 'rogue',
    hunter: 'hunter',
    shaman: 'shaman',
    warlock: 'warlock',
    demonhunter: 'demonhunter',
    deathknight: 'deathknight',
    法师: 'mage',
    圣骑士: 'paladin',
    战士: 'warrior',
    德鲁伊: 'druid',
    牧师: 'priest',
    潜行者: 'rogue',
    猎人: 'hunter',
    萨满: 'shaman',
    术士: 'warlock',
    恶魔猎手: 'demonhunter',
    死亡骑士: 'deathknight',
  };

  return map[fromName.toLowerCase()] || fallback;
}

export function useGameMatch() {
  const coinCardCache = ref<HearthstoneCard | null>(null);

  const form = reactive({
    playerDeckCode: 'AAECAZICBM6eBtb6BqqBB5SXBw2unwSB1ATggQf3gQeIgwewhwfAhwekiQeqrwfWwAfXwAfbwAfswAcAAA==',
    enemyDeckCode: 'AAECAaoICMODB4KYB9umB9+mB+WmB9C/B4LUB5vUBwuF1ATTvgbmlgf1rAexsAe8sQePvgfDwAfGwAfJwAf3wAcAAA==',
  });

  const aiProvider: 'deepseek' | 'google' = 'google';
  const defaultGoal: HearthstoneGameState['goal'] = 'tempo';

  const playerDeck = ref<HearthstoneCard[]>([]);
  const enemyDeck = ref<HearthstoneCard[]>([]);
  const gameState = ref<HearthstoneGameState | null>(null);
  const turnOptions = ref<HearthstoneTurnOption[]>([]);
  const selectedOptionId = ref<HearthstoneTurnOption['id'] | null>(null);
  const recommendation = ref<HearthstoneRecommendResponse | null>(null);
  const battleLog = ref<string[]>([]);
  const gameResult = ref<{ isGameOver: boolean; winner: 'player' | 'enemy' | 'none' }>({
    isGameOver: false,
    winner: 'none',
  });

  const isLoadingPlayerDeck = ref(false);
  const isLoadingEnemyDeck = ref(false);
  const isStarting = ref(false);
  const isRunningTurn = ref(false);
  const isLoadingCoach = ref(false);
  const isDeepThinking = ref(false);
  const errorMsg = ref('');
  const draggingCardId = ref<string | null>(null);
  const optionSource = ref<'fast-rule' | 'llm'>('fast-rule');
  const recommendationSource = ref<'fast-rule' | 'llm'>('fast-rule');
  const deepRequestSeq = ref(0);

  const bestOption = computed(() => turnOptions.value.find((item) => item.isBest) || null);

  const riskText = computed(() => {
    if (!recommendation.value) {
      return '-';
    }
    const map = { low: '低风险', medium: '中风险', high: '高风险' } as const;
    return map[recommendation.value.risk];
  });

  function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`timeout(${timeoutMs}ms)`));
      }, timeoutMs);
      promise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  function sumBoardAttack(minions: HearthstoneMinion[]): number {
    return minions.reduce((sum, item) => sum + Math.max(0, item.attack || 0), 0);
  }

  function buildFastTurnOptions(state: HearthstoneGameState): HearthstoneTurnOption[] {
    const enemyPressure = state.enemyBoard.length - state.myBoard.length;
    const totalAttack = sumBoardAttack(state.myBoard);
    const burstPotential = totalAttack + state.myManaCrystals;
    const canThreatenLethal = state.enemyHealth <= burstPotential + 2;

    const control: HearthstoneTurnOption = {
      id: 'control',
      title: '优先解场稳住节奏',
      detail: enemyPressure > 0
        ? '先清理敌方高威胁随从，再补低费站场。'
        : '保留解牌，进行一换一并控住场面节奏。',
      expected: '降低敌方反打强度，保证下回合可操作空间。',
      risk: 'low',
      isBest: false,
    };

    const burst: HearthstoneTurnOption = {
      id: 'burst',
      title: '压血制造斩杀线',
      detail: canThreatenLethal
        ? '优先打脸并保留关键伤害牌，争取两回合结束。'
        : '在不亏场的前提下压低敌方血线。',
      expected: '逼迫对手转防守，削弱其下回合主动性。',
      risk: canThreatenLethal ? 'medium' : 'high',
      isBest: false,
    };

    const develop: HearthstoneTurnOption = {
      id: 'develop',
      title: '铺场与资源运营',
      detail: '优先打满法力并补充站场，保留高价值资源。',
      expected: '提升中后续回合资源密度与场面厚度。',
      risk: 'medium',
      isBest: false,
    };

    const options = [control, burst, develop];
    const best = canThreatenLethal ? 'burst' : enemyPressure > 0 ? 'control' : 'develop';
    return options.map((item) => ({
      ...item,
      isBest: item.id === best,
    }));
  }

  function buildFastRecommendation(state: HearthstoneGameState): HearthstoneRecommendResponse {
    const enemyPressure = state.enemyBoard.length - state.myBoard.length;
    const lowHealth = state.myHealth <= 12;
    const totalAttack = sumBoardAttack(state.myBoard);
    const canThreatenLethal = state.enemyHealth <= totalAttack + state.myManaCrystals + 2;

    const summary = canThreatenLethal
      ? '当前可以制造斩杀压力，优先规划两回合伤害。'
      : enemyPressure > 0
        ? '敌方场面领先，先解场稳住节奏再转进攻。'
        : '当前局面可控，优先打满费用建立场面优势。';

    const risk: 'low' | 'medium' | 'high' = lowHealth ? 'high' : enemyPressure > 1 ? 'medium' : 'low';

    return {
      summary,
      risk,
      actions: [
        {
          step: 1,
          title: '先做可执行动作',
          detail: enemyPressure > 0 ? '优先交换或解牌处理对手威胁。' : '优先站场并维持费用利用率。',
          reason: '保证本回合收益最大化并减少对手反打空间。',
          confidence: 0.72,
        },
        {
          step: 2,
          title: canThreatenLethal ? '布局斩杀线' : '保留关键资源',
          detail: canThreatenLethal ? '将伤害尽量转化为打脸压力。' : '避免过度交资源，保证后续回合续航。',
          reason: '确保下回合仍有主动权。',
          confidence: 0.68,
        },
      ],
      nextTurnPlan: canThreatenLethal ? '若对手未解干净场面，下回合优先计算斩杀。' : '下回合继续围绕场面交换与费用曲线推进。',
      operationStrategy: {
        corePlan: canThreatenLethal ? '压血并保持威胁' : '控场并扩大战场优势',
        economyPlan: '尽量打满当前费用，避免无收益空过。',
        keyCardsToKeep: ['高价值解牌', '关键斩杀组件'],
        avoidPlays: ['无意义抢脸', '过度亏牌交换'],
      },
      aiMeta: {
        provider: 'fast-local',
        mode: 'fallback-rule',
      },
    };
  }

  function syncFastLayer(state: HearthstoneGameState) {
    const fastOptions = buildFastTurnOptions(state);
    turnOptions.value = fastOptions;
    selectedOptionId.value = fastOptions.find((item) => item.isBest)?.id || fastOptions[0]?.id || null;
    optionSource.value = 'fast-rule';

    recommendation.value = buildFastRecommendation(state);
    recommendationSource.value = 'fast-rule';
  }

  async function runDeepLayer(state: HearthstoneGameState) {
    const requestId = deepRequestSeq.value + 1;
    deepRequestSeq.value = requestId;
    isDeepThinking.value = true;

    const [deepOptions, deepReco] = await Promise.allSettled([
      withTimeout(fetchTurnOptions({
        state,
        provider: aiProvider,
      }), 1800),
      withTimeout(fetchHearthstoneRecommendation(buildRecommendPayload(state)), 2200),
    ]);

    if (deepRequestSeq.value !== requestId) {
      return;
    }

    if (deepOptions.status === 'fulfilled' && deepOptions.value.options.length > 0) {
      turnOptions.value = deepOptions.value.options;
      selectedOptionId.value = deepOptions.value.options.find((item) => item.isBest)?.id || deepOptions.value.options[0]?.id || null;
      optionSource.value = 'llm';
    }

    if (deepReco.status === 'fulfilled') {
      recommendation.value = deepReco.value;
      recommendationSource.value = 'llm';
    }

    if (deepRequestSeq.value === requestId) {
      isDeepThinking.value = false;
    }
  }

  async function getCoinCard(): Promise<HearthstoneCard> {
    if (coinCardCache.value) {
      return coinCardCache.value;
    }

    try {
      const res = await fetchCardsByIds({
        ids: ['1746'],
        locale: 'zh_CN',
        pageSize: 450,
      });
      const coin = res.cards.find((item) => String(item.id) === '1746') || res.cards[0];
      if (coin) {
        coinCardCache.value = coin;
        return coin;
      }
    }
    catch {
      // 使用兜底硬币，保证后手一定能显示在手牌中。
    }

    const fallbackCoin: HearthstoneCard = {
      id: '1746',
      name: '幸运币',
      cost: 0,
      text: '在本回合获得 1 点法力水晶。',
      type: 'coin' as HearthstoneCard['type'],
    };
    coinCardCache.value = fallbackCoin;
    return fallbackCoin;
  }

  async function loadPlayerDeck() {
    if (!form.playerDeckCode.trim()) {
      errorMsg.value = '请输入我方套牌编码。';
      return;
    }

    errorMsg.value = '';
    isLoadingPlayerDeck.value = true;
    try {
      const res = await fetchDeck({
        code: form.playerDeckCode.trim(),
        locale: 'zh_CN',
      });
      playerDeck.value = res.cards;
      battleLog.value = [`我方套牌已加载: ${res.cards.length} 张`, ...battleLog.value].slice(0, 30);
    }
    catch (error) {
      errorMsg.value = error instanceof Error ? error.message : String(error);
    }
    finally {
      isLoadingPlayerDeck.value = false;
    }
  }

  async function loadEnemyDeck() {
    if (!form.enemyDeckCode.trim()) {
      errorMsg.value = '请输入敌方套牌编码。';
      return;
    }

    errorMsg.value = '';
    isLoadingEnemyDeck.value = true;
    try {
      const res = await fetchDeck({
        code: form.enemyDeckCode.trim(),
        locale: 'zh_CN',
      });
      enemyDeck.value = res.cards;
      battleLog.value = [`敌方套牌已加载: ${res.cards.length} 张`, ...battleLog.value].slice(0, 30);
    }
    catch (error) {
      errorMsg.value = error instanceof Error ? error.message : String(error);
    }
    finally {
      isLoadingEnemyDeck.value = false;
    }
  }

  function buildRecommendPayload(state: HearthstoneGameState): HearthstoneRecommendRequest {
    return {
      heroClass: state.heroClass,
      enemyClass: state.enemyClass,
      myHealth: state.myHealth,
      enemyHealth: state.enemyHealth,
      myManaCrystals: state.myManaCrystals,
      enemyManaCrystals: state.enemyManaCrystals,
      myHand: state.myHand,
      myBoard: state.myBoard,
      enemyBoard: state.enemyBoard,
      goal: state.goal,
      notes: state.notes,
      provider: aiProvider,
    };
  }

  async function refreshCoach() {
    if (!gameState.value) {
      return;
    }

    isLoadingCoach.value = true;
    try {
      await runDeepLayer(gameState.value);
    }
    catch {
      // 保持当前极速建议，不清空。
    }
    finally {
      isLoadingCoach.value = false;
    }
  }

  async function refreshTurnOptions() {
    if (!gameState.value || gameResult.value.isGameOver) {
      return;
    }

    syncFastLayer(gameState.value);
    void runDeepLayer(gameState.value);
  }

  function buildMinionFromCard(card: HearthstoneCard): HearthstoneMinion {
    const text = card.text || '';
    const keywords: string[] = [];
    if (/taunt|嘲讽/i.test(text)) {
      keywords.push('taunt');
    }
    if (/divine shield|圣盾/i.test(text)) {
      keywords.push('divine-shield');
    }
    if (/rush|突袭/i.test(text)) {
      keywords.push('rush');
    }
    if (/charge|冲锋/i.test(text)) {
      keywords.push('charge');
    }

    return {
      id: `minion-${card.id}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name: card.name,
      attack: Math.max(1, Math.min(12, card.cost + 1)),
      health: Math.max(1, Math.min(12, card.cost + 1)),
      maxHealth: Math.max(1, Math.min(12, card.cost + 1)),
      keywords,
      description: card.text,
    };
  }

  function applyEnemyOpeningMove(state: HearthstoneGameState): HearthstoneGameState {
    const lowCostMinion = enemyDeck.value.find((card) => card.type === 'minion' && card.cost <= 1);
    if (lowCostMinion) {
      const enemyBoard = state.enemyBoard.length < 7
        ? [...state.enemyBoard, buildMinionFromCard(lowCostMinion)]
        : state.enemyBoard;
      battleLog.value = [`敌方先手: ${lowCostMinion.name} 上场`, ...battleLog.value].slice(0, 30);
      return {
        ...state,
        enemyBoard,
        enemyManaCrystals: 1,
      };
    }

    battleLog.value = ['敌方先手: 英雄技能压制', ...battleLog.value].slice(0, 30);
    return {
      ...state,
      myHealth: Math.max(1, state.myHealth - 1),
      enemyManaCrystals: 1,
    };
  }

  async function startMatch() {
    if (playerDeck.value.length === 0 || enemyDeck.value.length === 0) {
      errorMsg.value = '请先导入双方套牌后再开始。';
      return;
    }

    errorMsg.value = '';
    isStarting.value = true;
    recommendation.value = null;
    try {
      const isPlayerFirst = Math.random() < 0.5;
      const playerDrawCount = isPlayerFirst ? 3 : 4;
      const enemyDrawCount = isPlayerFirst ? 4 : 3;
      const myHand = pickRandomCards(playerDeck.value, playerDrawCount);

      if (!isPlayerFirst) {
        const coin = await getCoinCard();
        myHand.push({
          ...coin,
          id: `1746-${Date.now()}`,
        });
      }

      const initialState: HearthstoneGameState = {
        turn: 1,
        isPlayerFirst,
        playerHasCoin: !isPlayerFirst,
        heroClass: inferHeroClass(playerDeck.value, 'mage'),
        enemyClass: inferHeroClass(enemyDeck.value, 'paladin'),
        myHealth: 30,
        enemyHealth: 30,
        myManaCrystals: 0,
        enemyManaCrystals: 0,
        myHand,
        enemyHandCount: enemyDrawCount,
        myBoard: [],
        enemyBoard: [],
        goal: defaultGoal,
        notes: '',
      };

      const adjustedState = !isPlayerFirst
        ? applyEnemyOpeningMove(initialState)
        : initialState;

      gameState.value = adjustedState;
      syncFastLayer(adjustedState);
      gameResult.value = {
        isGameOver: false,
        winner: 'none',
      };
      battleLog.value = [
        `对局开始: ${isPlayerFirst ? '你先手' : '你后手'}`,
        `我方手牌 ${myHand.length} 张${!isPlayerFirst ? '（含幸运币）' : ''}，敌方起手 ${enemyDrawCount} 张`,
        ...battleLog.value,
      ];

      void runDeepLayer(adjustedState);
    }
    catch (error) {
      errorMsg.value = error instanceof Error ? error.message : String(error);
    }
    finally {
      isStarting.value = false;
    }
  }

  async function runPlayerTurn() {
    if (!gameState.value || !selectedOptionId.value || gameResult.value.isGameOver) {
      return;
    }

    errorMsg.value = '';
    isRunningTurn.value = true;
    try {
      const selectedOption = turnOptions.value.find((item) => item.id === selectedOptionId.value);
      const res = await simulateTurn({
        state: gameState.value,
        optionId: selectedOptionId.value,
        selectedOption,
        provider: aiProvider,
      });

      gameState.value = res.updatedState;
      syncFastLayer(res.updatedState);
      gameResult.value = res.gameResult;
      battleLog.value = [
        `T${res.updatedState.turn - 1} 我方: ${res.playerActionSummary}`,
        `T${res.updatedState.turn - 1} AI对手: ${res.enemyActionSummary}`,
        ...res.randomEvents.map((item) => `随机: ${item}`),
        ...(res.gameResult.isGameOver
          ? [`对局结束: ${res.gameResult.winner === 'player' ? '我方胜利' : res.gameResult.winner === 'enemy' ? 'AI对手胜利' : '平局'}`]
          : []),
        ...battleLog.value,
      ].slice(0, 30);

      void runDeepLayer(res.updatedState);
    }
    catch (error) {
      errorMsg.value = error instanceof Error ? error.message : String(error);
    }
    finally {
      isRunningTurn.value = false;
    }
  }

  async function takeOverByAi() {
    if (!gameState.value || gameResult.value.isGameOver) {
      return;
    }

    errorMsg.value = '';
    isRunningTurn.value = true;
    try {
      const optionsRes = await fetchTurnOptions({
        state: gameState.value,
        provider: aiProvider,
      });
      const aiChoice = optionsRes.options.find((item) => item.isBest) || optionsRes.options[0];
      if (!aiChoice) {
        return;
      }

      const res = await simulateTurn({
        state: gameState.value,
        optionId: aiChoice.id,
        selectedOption: aiChoice,
        provider: aiProvider,
      });

      gameState.value = res.updatedState;
      turnOptions.value = res.nextOptions;
      selectedOptionId.value = res.nextOptions.find((item) => item.isBest)?.id || res.nextOptions[0]?.id || null;
      gameResult.value = res.gameResult;

      battleLog.value = [
        `T${res.updatedState.turn - 1} AI接管: ${aiChoice.title}`,
        `T${res.updatedState.turn - 1} 我方: ${res.playerActionSummary}`,
        `T${res.updatedState.turn - 1} AI对手: ${res.enemyActionSummary}`,
        ...battleLog.value,
      ].slice(0, 30);

      await refreshCoach();
    }
    catch (error) {
      errorMsg.value = error instanceof Error ? error.message : String(error);
    }
    finally {
      isRunningTurn.value = false;
    }
  }

  function startDragCard(cardId: string) {
    draggingCardId.value = cardId;
  }

  function clearDragCard() {
    draggingCardId.value = null;
  }

  async function playDraggedCardToBoard(): Promise<boolean> {
    if (!draggingCardId.value || !gameState.value || gameResult.value.isGameOver) {
      return false;
    }

    const handIndex = gameState.value.myHand.findIndex((item) => item.id === draggingCardId.value);
    if (handIndex < 0) {
      draggingCardId.value = null;
      return false;
    }

    const card = gameState.value.myHand[handIndex];
    if (card.type !== 'minion') {
      errorMsg.value = '当前仅支持拖拽随从上场。';
      draggingCardId.value = null;
      return false;
    }
    if (gameState.value.myBoard.length >= 7) {
      errorMsg.value = '我方战场已满(7)。';
      draggingCardId.value = null;
      return false;
    }

    const nextHand = [...gameState.value.myHand];
    nextHand.splice(handIndex, 1);
    const nextBoard = [...gameState.value.myBoard, buildMinionFromCard(card)];

    gameState.value = {
      ...gameState.value,
      myHand: nextHand,
      myBoard: nextBoard,
      myManaCrystals: Math.max(0, gameState.value.myManaCrystals - Math.max(0, card.cost)),
    };
    draggingCardId.value = null;
    battleLog.value = [`拖拽出牌: ${card.name} 上场`, ...battleLog.value].slice(0, 30);

    await refreshTurnOptions();
    return true;
  }

  return {
    form,
    playerDeck,
    enemyDeck,
    gameState,
    turnOptions,
    selectedOptionId,
    recommendation,
    battleLog,
    gameResult,
    isLoadingPlayerDeck,
    isLoadingEnemyDeck,
    isStarting,
    isRunningTurn,
    isLoadingCoach,
    isDeepThinking,
    optionSource,
    recommendationSource,
    draggingCardId,
    errorMsg,
    bestOption,
    riskText,
    loadPlayerDeck,
    loadEnemyDeck,
    startMatch,
    runPlayerTurn,
    takeOverByAi,
    startDragCard,
    clearDragCard,
    playDraggedCardToBoard,
    refreshCoach,
  };
}
