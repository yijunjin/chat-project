import { computed, onMounted, reactive, ref } from 'vue';
import {
  fetchCardDetail,
  fetchDeck,
  fetchHearthstoneRecommendation,
  fetchMetadata,
  fetchOpeningHand,
  fetchTurnOptions,
  searchCards,
  simulateTurn,
} from '../services/hearthstoneApi';
import { CardType } from '../Enum';
import type {
  HearthstoneCard,
  HearthstoneCardDetailResponse,
  HearthstoneGameState,
  HearthstoneMetadataClass,
  HearthstoneMinion,
  HearthstoneRecommendRequest,
  HearthstoneRecommendResponse,
  HearthstoneTurnOption,
  StrategyGoal,
} from '../types/hearthstone';

const coinCard: HearthstoneCard = {
  id: 'coin',
  name: '幸运币',
  cost: 0,
  text: '在本回合获得 1 点法力水晶。',
  type: CardType.Coin,
};

export function useAiAssistant() {
  const form = reactive({
    heroClass: 'mage',
    enemyClass: 'paladin',
    goal: 'tempo' as StrategyGoal,
    notes: '',
    provider: 'google' as 'deepseek' | 'google',
    deckCode: '',
  });

  const myBoardText = ref('');
  const enemyBoardText = ref('');
  const gameState = ref<HearthstoneGameState | null>(null);
  const turnOptions = ref<HearthstoneTurnOption[]>([]);
  const selectedOptionId = ref<HearthstoneTurnOption['id'] | null>(null);
  const battleLog = ref<string[]>([]);
  const recommendation = ref<HearthstoneRecommendResponse | null>(null);
  const gameResult = ref<{ isGameOver: boolean; winner: 'player' | 'enemy' | 'none' }>({
    isGameOver: false,
    winner: 'none',
  });

  const isLoadingOptions = ref(false);
  const isSimulating = ref(false);
  const isLoadingRecommendation = ref(false);
  const isLoadingDeck = ref(false);
  const errorMsg = ref('');

  const metadataClasses = ref<HearthstoneMetadataClass[]>([]);
  const cardSource = ref<'blizzard' | 'fallback'>('fallback');
  const deckCards = ref<HearthstoneCard[]>([]);

  // 卡牌预览相关
  const cardDetailCache = new Map<string, HearthstoneCardDetailResponse>();
  const cardPreview = ref<HearthstoneCardDetailResponse | null>(null);
  const previewPosition = ref({ x: 0, y: 0 });
  const previewLoading = ref(false);

  const goalOptions: Array<{ label: string; value: StrategyGoal }> = [
    { label: '节奏压制', value: 'tempo' },
    { label: '防守求生', value: 'survival' },
    { label: '爆发斩杀', value: 'burst' },
    { label: '资源运营', value: 'value' },
  ];

  const aiHeroClassOptions = computed(() => {
    return metadataClasses.value.map((item) => ({
      label: item.name,
      value: item.slug,
    }));
  });

  const bestOption = computed(() => turnOptions.value.find((option) => option.isBest) || null);

  const riskText = computed(() => {
    if (!recommendation.value) {
      return '-';
    }
    const map = { low: '低风险', medium: '中风险', high: '高风险' } as const;
    return map[recommendation.value.risk];
  });

  function randInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function parseMinionLine(line: string, prefix: string, index: number): HearthstoneMinion | null {
    const text = line.trim();
    if (!text) {
      return null;
    }
    const [nameRaw, atkRaw, hpRaw, descRaw] = text.split('|').map((item) => item.trim());
    if (!nameRaw) {
      return null;
    }
    const attack = Math.max(0, Math.min(20, Number(atkRaw || 2)));
    const health = Math.max(1, Math.min(20, Number(hpRaw || 2)));
    return {
      id: `${prefix}-${index}-${Date.now()}-${randInt(100, 999)}`,
      name: nameRaw,
      attack,
      health,
      maxHealth: health,
      keywords: [],
      description: descRaw || '',
    };
  }

  function parseBoardText(input: string, prefix: string): HearthstoneMinion[] {
    return input
      .split('\n')
      .map((line, index) => parseMinionLine(line, prefix, index))
      .filter((item): item is HearthstoneMinion => !!item)
      .slice(0, 7);
  }

  function minionTooltip(minion: HearthstoneMinion): string {
    const base = `${minion.name} ${minion.attack}/${minion.health}`;
    return minion.description ? `${base}\n${minion.description}` : base;
  }

  async function loadDeckCards(): Promise<void> {
    if (!form.deckCode.trim()) {
      deckCards.value = [];
      cardSource.value = 'fallback';
      return;
    }

    isLoadingDeck.value = true;
    errorMsg.value = '';
    try {
      const res = await fetchDeck({
        code: form.deckCode.trim(),
        locale: 'zh_CN',
      });
      deckCards.value = res.cards;
      cardSource.value = res.source;
    }
    catch (error) {
      errorMsg.value = error instanceof Error ? error.message : '套牌加载失败';
      deckCards.value = [];
    }
    finally {
      isLoadingDeck.value = false;
    }
  }

  async function buildInitialState(): Promise<HearthstoneGameState> {
    const isPlayerFirst = Math.random() < 0.5;
    
    let myHand: HearthstoneCard[] = [];
    
    if (deckCards.value.length > 0) {
      // 从套牌中随机选择初始手牌
      const drawCount = isPlayerFirst ? 3 : 4;
      const shuffled = [...deckCards.value].sort(() => Math.random() - 0.5);
      myHand = shuffled.slice(0, drawCount);
    } else {
      // 使用开局手牌API
      const openingRes = await fetchOpeningHand({
        heroClass: form.heroClass,
        isPlayerFirst,
        locale: 'zh_CN',
      });
      myHand = openingRes.cards.length > 0
        ? openingRes.cards
        : !isPlayerFirst
          ? [{ ...coinCard, id: `coin-${Date.now()}-${randInt(100, 999)}` }]
          : [];
      cardSource.value = openingRes.source;
    }

    return {
      turn: 1,
      isPlayerFirst,
      playerHasCoin: !isPlayerFirst,
      heroClass: form.heroClass,
      enemyClass: form.enemyClass,
      myHealth: 30,
      enemyHealth: 30,
      myManaCrystals: 0,
      enemyManaCrystals: 0,
      myHand,
      enemyHandCount: isPlayerFirst ? 4 : 3,
      myBoard: parseBoardText(myBoardText.value, 'my-init'),
      enemyBoard: parseBoardText(enemyBoardText.value, 'enemy-init'),
      goal: form.goal,
      notes: form.notes,
    };
  }

  async function initSimulation() {
    errorMsg.value = '';
    recommendation.value = null;
    isLoadingOptions.value = true;
    try {
      const initial = await buildInitialState();
      const optionsRes = await fetchTurnOptions({
        state: initial,
        provider: form.provider,
      });
      gameState.value = initial;
      turnOptions.value = optionsRes.options;
      selectedOptionId.value = optionsRes.options.find((item) => item.isBest)?.id || optionsRes.options[0]?.id || null;
      battleLog.value = [
        `对局初始化: ${initial.isPlayerFirst ? '你是先手(3张)' : '你是后手(4张+幸运币)'}`,
        '起始血量 30/30，双方水晶 0/0。',
        `卡牌来源: ${cardSource.value === 'blizzard' ? '暴雪开发者API' : '本地兜底数据'}`,
      ];
      gameResult.value = {
        isGameOver: false,
        winner: 'none',
      };
    }
    catch (error) {
      errorMsg.value = error instanceof Error ? error.message : String(error);
    }
    finally {
      isLoadingOptions.value = false;
    }
  }

  async function runSelectedTurn() {
    if (!gameState.value || !selectedOptionId.value) {
      return;
    }

    errorMsg.value = '';
    isSimulating.value = true;
    try {
      const selectedOption = turnOptions.value.find((option) => option.id === selectedOptionId.value);
      const res = await simulateTurn({
        state: gameState.value,
        optionId: selectedOptionId.value,
        selectedOption,
        provider: form.provider,
      });

      gameState.value = res.updatedState;
      turnOptions.value = res.nextOptions;
      selectedOptionId.value = res.nextOptions.find((item) => item.isBest)?.id || res.nextOptions[0]?.id || null;
      gameResult.value = res.gameResult;

      battleLog.value = [
        `T${res.updatedState.turn - 1} 我方: ${res.playerActionSummary}`,
        `T${res.updatedState.turn - 1} 对手: ${res.enemyActionSummary}`,
        ...res.actionTrace.map((item) => `动作链: ${item.source} -> ${item.target} (${item.effect})`),
        ...res.randomEvents.map((event) => `随机: ${event}`),
        ...(res.gameResult.isGameOver
          ? [`对局结束: ${res.gameResult.winner === 'player' ? '我方胜利' : res.gameResult.winner === 'enemy' ? '对手胜利' : '平局'}`]
          : []),
        ...battleLog.value,
      ].slice(0, 24);
    }
    catch (error) {
      errorMsg.value = error instanceof Error ? error.message : String(error);
    }
    finally {
      isSimulating.value = false;
    }
  }

  async function getAICoach() {
    if (!gameState.value) {
      errorMsg.value = '请先初始化对局。';
      return;
    }

    errorMsg.value = '';
    recommendation.value = null;
    isLoadingRecommendation.value = true;

    try {
      const payload: HearthstoneRecommendRequest = {
        heroClass: gameState.value.heroClass,
        enemyClass: gameState.value.enemyClass,
        myHealth: gameState.value.myHealth,
        enemyHealth: gameState.value.enemyHealth,
        myManaCrystals: gameState.value.myManaCrystals,
        enemyManaCrystals: gameState.value.enemyManaCrystals,
        myHand: gameState.value.myHand,
        myBoard: gameState.value.myBoard,
        enemyBoard: gameState.value.enemyBoard,
        goal: gameState.value.goal,
        notes: gameState.value.notes,
        provider: form.provider,
      };
      recommendation.value = await fetchHearthstoneRecommendation(payload);
    }
    catch (error) {
      errorMsg.value = error instanceof Error ? error.message : String(error);
    }
    finally {
      isLoadingRecommendation.value = false;
    }
  }

  async function loadAiMetadata() {
    try {
      const res = await fetchMetadata({ locale: 'zh_CN' });
      metadataClasses.value = res.classes;
    }
    catch {
      metadataClasses.value = [];
    }
  }

  async function handleCardHover(card: HearthstoneCard, event: MouseEvent) {
    // 如果已有缓存，直接显示
    if (cardDetailCache.has(card.id)) {
      const cached = cardDetailCache.get(card.id);
      if (cached) {
        cardPreview.value = cached;
        updatePreviewPosition(event);
        return;
      }
    }

    // 只有有图片的卡牌才展示预览
    if (!card.imageUrl && !card.cropImageUrl) {
      return;
    }

    previewLoading.value = true;
    try {
      const detail = await fetchCardDetail({
        cardId: card.id,
        locale: 'zh_CN',
      });
      cardDetailCache.set(card.id, detail);
      cardPreview.value = detail;
      updatePreviewPosition(event);
    }
    catch {
      // 预览失败，仍显示基本信息
      cardPreview.value = {
        cardId: card.id,
        slug: card.slug || card.id,
        name: card.name,
        imageUrl: card.imageUrl,
        flavorText: card.flavorText || '',
        cardLevel: '',
        artistName: '',
        relatedCards: [],
        details: [],
        raw: {},
        source: 'fallback',
      };
      updatePreviewPosition(event);
    }
    finally {
      previewLoading.value = false;
    }
  }

  function updatePreviewPosition(event: MouseEvent) {
    const target = event.currentTarget as HTMLElement | null;
    if (!target) return;

    const rect = target.getBoundingClientRect();
    let x = rect.left + rect.width / 2;
    let y = rect.top - 10;

    // 防止溢出屏幕
    const previewWidth = 280;
    const previewHeight = 380;
    if (x + previewWidth / 2 > window.innerWidth) {
      x = window.innerWidth - previewWidth / 2 - 10;
    }
    if (x - previewWidth / 2 < 0) {
      x = previewWidth / 2 + 10;
    }
    if (y - previewHeight < 0) {
      y = rect.bottom + 10;
    }

    previewPosition.value = { x, y };
  }

  function hideCardPreview() {
    cardPreview.value = null;
  }

  async function handleMinionHover(minion: HearthstoneMinion, event: MouseEvent) {
    // 通过随从名称搜索卡牌
    const cacheKey = `minion-${minion.name}`;
    if (cardDetailCache.has(cacheKey)) {
      const cached = cardDetailCache.get(cacheKey);
      if (cached) {
        cardPreview.value = cached;
        updatePreviewPosition(event);
        return;
      }
    }

    previewLoading.value = true;
    try {
      // 通过卡牌查询API搜索同名卡牌
      const searchResult = await searchCards({
        query: minion.name,
        locale: 'zh_CN',
        pageSize: 10,
      });

      if (searchResult.cards.length > 0) {
        const matchedCard = searchResult.cards.find((c) => c.name === minion.name) || searchResult.cards[0];
        
        // 获取卡牌详情
        const detail = await fetchCardDetail({
          cardId: matchedCard.id,
          locale: 'zh_CN',
        });
        cardDetailCache.set(cacheKey, detail);
        cardPreview.value = detail;
        updatePreviewPosition(event);
      } else {
        // 没找到卡牌，显示随从基本信息
        cardPreview.value = {
          cardId: `minion-${minion.id}`,
          slug: minion.name,
          name: minion.name,
          imageUrl: undefined,
          flavorText: minion.description || '',
          cardLevel: '',
          artistName: '',
          relatedCards: [],
          details: [
            { key: '攻击', value: String(minion.attack) },
            { key: '生命', value: String(minion.health) },
          ],
          raw: { attack: minion.attack, health: minion.health },
          source: 'fallback',
        };
        updatePreviewPosition(event);
      }
    }
    catch {
      // 预览失败，显示基本信息
      cardPreview.value = {
        cardId: `minion-${minion.id}`,
        slug: minion.name,
        name: minion.name,
        imageUrl: undefined,
        flavorText: minion.description || '',
        cardLevel: '',
        artistName: '',
        relatedCards: [],
        details: [],
        raw: {},
        source: 'fallback',
      };
      updatePreviewPosition(event);
    }
    finally {
      previewLoading.value = false;
    }
  }

  onMounted(() => {
    void loadAiMetadata();
  });

  return {
    form,
    myBoardText,
    enemyBoardText,
    gameState,
    turnOptions,
    selectedOptionId,
    battleLog,
    recommendation,
    gameResult,
    isLoadingOptions,
    isSimulating,
    isLoadingRecommendation,
    isLoadingDeck,
    deckCards,
    cardPreview,
    previewPosition,
    previewLoading,
    errorMsg,
    goalOptions,
    aiHeroClassOptions,
    bestOption,
    riskText,
    minionTooltip,
    handleCardHover,
    handleMinionHover,
    hideCardPreview,
    loadDeckCards,
    initSimulation,
    runSelectedTurn,
    getAICoach,
  };
}
