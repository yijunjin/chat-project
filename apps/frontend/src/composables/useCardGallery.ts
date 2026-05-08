import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  fetchCardsByIds,
  fetchMetadata,
  searchCards,
} from '../services/hearthstoneApi';
import { CardType, CLASS_SLUG_ORDER, Rarity } from '../Enum';
import type {
  HearthstoneCard,
  HearthstoneCardDetailResponse,
  HearthstoneRelatedCard,
} from '../types/hearthstone';

export function useCardGallery() {
  const searchedCards = ref<HearthstoneCard[]>([]);
  const cardSearchKeyword = ref('');
  const cardHeroClassFilter = ref('');
  const cardSetFilter = ref<'all' | 'standard' | 'wild'>('all');
  const metadataClasses = ref<Array<{ id: number; slug: string; name: string }>>([]);
  const metadataSets = ref<Array<{ id: number; slug: string; name: string }>>([]);
  const isSearchingCards = ref(false);
  const cardPage = ref(1);
  const cardPageSize = ref(450);
  const cardTypeFilter = ref<'all' | CardType.Spell | CardType.Minion | CardType.Weapon | CardType.Location | CardType.Hero>('all');
  const cardCostFilter = ref<number | '10+' | 'all'>('all');

  const zoomPreview = ref<{
    card: HearthstoneCard;
  } | null>(null);
  const zoomDetail = ref<HearthstoneCardDetailResponse | null>(null);
  const relatedCardPreview = ref<HearthstoneRelatedCard | null>(null);
  const zoomCardIndex = ref(-1);
  const zoomDetailLoading = ref(false);
  const zoomDetailError = ref('');

  const heroClassOptions = computed(() => {
    return [
      { label: '全部职业', value: '' },
      ...metadataClasses.value.map((item) => ({
        label: item.name,
        value: item.slug,
      })),
    ];
  });

  const cardSetOptions = computed(() => {
    const dynamic = metadataSets.value
      .filter((item) => item.slug === 'standard' || item.slug === 'wild')
      .map((item) => ({
        label: item.name,
        value: item.slug as 'standard' | 'wild',
      }));

    const fallback = [
      { label: '标准', value: 'standard' as const },
      { label: '狂野', value: 'wild' as const },
    ];

    return [{ label: '全部卡池', value: 'all' as const }, ...(dynamic.length > 0 ? dynamic : fallback)];
  });

  const cardTypeOptions = [
    { label: '全部', value: 'all' as const },
    { label: '法术', value: CardType.Spell as const },
    { label: '随从', value: CardType.Minion as const },
    { label: '武器', value: CardType.Weapon as const },
    { label: '地标', value: CardType.Location as const },
    { label: '英雄', value: CardType.Hero as const },
  ];

  const filteredSearchedCards = computed(() => {
    return searchedCards.value.filter((card) => {
      const byType = cardTypeFilter.value === 'all' || card.type === cardTypeFilter.value;
      const byCost = cardCostFilter.value === 'all'
        ? true
        : cardCostFilter.value === '10+'
          ? card.cost >= 10
          : card.cost === cardCostFilter.value;
      return byType && byCost;
    });
  });

  const groupedCards = computed(() => {
    const map = new Map<number | null, { classId: number | null; classSlug: string; className: string; cards: typeof filteredSearchedCards.value }>();
    for (const card of filteredSearchedCards.value) {
      const key = card.classId ?? null;
      if (!map.has(key)) {
        const meta = metadataClasses.value.find((c) => c.id === card.classId);
        const name = meta?.name || card.className || '中立';
        const slug = meta?.slug || '';
        map.set(key, { classId: key, classSlug: slug, className: name, cards: [] });
      }
      map.get(key)!.cards.push(card);
    }

    return [...map.values()].sort((a, b) => {
      if (a.classId === null) return 1;
      if (b.classId === null) return -1;
      const ai = (CLASS_SLUG_ORDER as readonly string[]).indexOf(a.classSlug);
      const bi = (CLASS_SLUG_ORDER as readonly string[]).indexOf(b.classSlug);
      return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
    });
  });

  const orderedDisplayCards = computed(() => groupedCards.value.flatMap((group) => group.cards));
  const canZoomPrev = computed(() => zoomCardIndex.value > 0);
  const canZoomNext = computed(() => zoomCardIndex.value >= 0 && zoomCardIndex.value < orderedDisplayCards.value.length - 1);

  function resolveManaCostParam(): string | undefined {
    if (cardCostFilter.value === 'all') {
      return undefined;
    }
    if (cardCostFilter.value === '10+') {
      return '10^';
    }
    return String(cardCostFilter.value);
  }

  function resolveCardTypeParam(): CardType.Spell | CardType.Minion | CardType.Weapon | CardType.Location | CardType.Hero | undefined {
    if (cardTypeFilter.value === 'all') {
      return undefined;
    }
    return cardTypeFilter.value;
  }

  function detailValue(keys: string[]): string {
    const detailMap = new Map((zoomDetail.value?.details || []).map((item) => [item.key, item.value]));
    for (const key of keys) {
      const value = detailMap.get(key);
      if (value && String(value).trim()) {
        return value;
      }
    }
    return '-';
  }

  function buildZoomDetailFromCard(
    card: HearthstoneCard,
    relatedCards: HearthstoneRelatedCard[] = [],
  ): HearthstoneCardDetailResponse {
    const details: Array<{ key: string; value: string }> = [];
    const pushDetail = (key: string, value: unknown) => {
      if (value === null || value === undefined || value === '') {
        return;
      }
      details.push({ key, value: String(value) });
    };

    pushDetail('text', card.text || '');
    pushDetail('minionTypeName', card.minionTypeName);
    pushDetail('minionTypeId', card.minionTypeId);
    pushDetail('classId', card.classId);
    pushDetail('className', card.className);
    pushDetail('cardSetId', card.cardSetId);
    pushDetail('cardSetName', card.cardSetName);
    pushDetail('craftingCost', card.craftingCost);
    pushDetail('dustValue', card.dustValue);
    pushDetail('collectible', card.collectible === undefined ? undefined : (card.collectible ? '是' : '否'));
    pushDetail('cardTypeId', card.cardTypeId);

    return {
      cardId: card.id,
      slug: card.slug || card.id,
      name: card.name,
      imageUrl: card.imageUrl,
      flavorText: card.flavorText || '',
      cardLevel: String(card.rarityId ?? '-'),
      artistName: card.artistName || '-',
      relatedCards,
      details,
      raw: card as unknown as Record<string, unknown>,
      source: 'blizzard',
    };
  }

  function toRelatedCards(cards: HearthstoneCard[]): HearthstoneRelatedCard[] {
    return cards.map((item) => ({
      id: item.id,
      name: item.name,
      cost: item.cost,
      cropImageUrl: item.cropImageUrl,
      imageUrl: item.imageUrl,
    }));
  }

  async function loadRelatedCardsByCard(card: HearthstoneCard): Promise<HearthstoneRelatedCard[]> {
    const childIds = (card.childIds || []).map((item) => String(item)).filter((item) => !!item);
    if (childIds.length === 0) {
      return [];
    }

    const relatedRes = await fetchCardsByIds({
      ids: childIds,
      pageSize: 450,
      locale: 'zh_CN',
    });

    return toRelatedCards(relatedRes.cards).filter((item) => item.id !== card.id);
  }

  function resolveCardType(): string {
    const type = zoomPreview.value?.card.type;
    if (type && type !== CardType.Coin) {
      const typeMap: Partial<Record<CardType, string>> = {
        [CardType.Minion]: '随从',
        [CardType.Spell]: '法术',
        [CardType.Weapon]: '武器',
        [CardType.Location]: '地标',
        [CardType.Hero]: '英雄',
        [CardType.HeroPower]: '英雄技能',
      };
      return typeMap[type] || type;
    }
    return detailValue(['cardTypeName', 'cardTypeId']);
  }

  function resolveRarity(): string {
    const card = zoomPreview.value?.card;
    if (!card) return '-';
    const rarityMap: Record<number, string> = {
      [Rarity.Free]: '免费',
      [Rarity.Common]: '普通',
      [Rarity.Rare]: '稀有',
      [Rarity.Epic]: '史诗',
      [Rarity.Legendary]: '传说',
    };
    if (card.rarityId !== undefined && rarityMap[card.rarityId]) {
      return rarityMap[card.rarityId];
    }
    return card.rarityName || '-';
  }

  function resolveClassName(): string {
    const detailMap = new Map((zoomDetail.value?.details || []).map((d) => [d.key, d.value]));
    const classId = detailMap.get('classId');
    if (classId) {
      const found = metadataClasses.value.find((c) => String(c.id) === classId);
      if (found) return found.name;
    }
    return detailMap.get('className') || '-';
  }

  function resolveSetName(): string {
    const detailMap = new Map((zoomDetail.value?.details || []).map((d) => [d.key, d.value]));
    const setId = detailMap.get('cardSetId');
    if (setId) {
      const found = metadataSets.value.find((s) => String(s.id) === setId);
      if (found) return found.name;
    }
    return detailMap.get('cardSetName') || '-';
  }

  function handleCardHoverMove(event: MouseEvent) {
    const target = event.currentTarget as HTMLElement | null;
    if (!target) {
      return;
    }

    const rect = target.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const isTop = y < rect.height / 2;
    const isLeft = x < rect.width / 2;

    const rotateX = isTop ? 12 : -12;
    const rotateY = isLeft ? -12 : 12;

    target.style.setProperty('--card-rotate-x', `${rotateX}deg`);
    target.style.setProperty('--card-rotate-y', `${rotateY}deg`);
    target.style.setProperty('--card-scale', '1.035');
  }

  function resetCardHoverEffect(event: MouseEvent) {
    const target = event.currentTarget as HTMLElement | null;
    if (!target) {
      return;
    }

    target.style.setProperty('--card-rotate-x', '0deg');
    target.style.setProperty('--card-rotate-y', '0deg');
    target.style.setProperty('--card-scale', '1');
  }

  async function doCardSearch() {
    isSearchingCards.value = true;
    try {
      const res = await searchCards({
        query: cardSearchKeyword.value,
        class: cardHeroClassFilter.value,
        cardSet: cardSetFilter.value === 'all' ? undefined : cardSetFilter.value,
        type: resolveCardTypeParam(),
        manaCost: resolveManaCostParam(),
        sort: 'manaCost:asc,name:asc,classes:asc,groupByClass:asc',
        page: cardPage.value,
        pageSize: cardPageSize.value,
        locale: 'zh_CN',
      });
      searchedCards.value = res.cards;
    }
    catch {
      searchedCards.value = [];
    }
    finally {
      isSearchingCards.value = false;
    }
  }

  async function onSearchControlChange() {
    cardPage.value = 1;
    await doCardSearch();
  }

  async function changeCardPage(step: number) {
    const next = Math.max(1, cardPage.value + step);
    cardPage.value = next;
    await doCardSearch();
  }

  async function openCardZoom(card: HearthstoneCard, event: MouseEvent) {
    if (!card.imageUrl) {
      return;
    }
    event.preventDefault();

    const index = orderedDisplayCards.value.findIndex((item) => item.id === card.id);
    zoomCardIndex.value = index;
    await openZoomByCard(card);
  }

  async function openZoomByCard(card: HearthstoneCard) {
    zoomPreview.value = {
      card,
    };

    zoomDetail.value = buildZoomDetailFromCard(card, []);
    relatedCardPreview.value = null;
    zoomDetailError.value = '';
    const childIds = (card.childIds || []).filter((item) => !!item);
    if (childIds.length === 0) {
      zoomDetailLoading.value = false;
      return;
    }

    zoomDetailLoading.value = true;
    try {
      const relatedCards = await loadRelatedCardsByCard(card);
      if (zoomPreview.value?.card.id === card.id) {
        zoomDetail.value = buildZoomDetailFromCard(card, relatedCards);
      }
    }
    catch (error) {
      zoomDetailError.value = error instanceof Error ? error.message : String(error);
    }
    finally {
      zoomDetailLoading.value = false;
    }
  }

  async function openAdjacentZoomCard(step: -1 | 1, event?: MouseEvent) {
    event?.preventDefault();
    event?.stopPropagation();
    if (zoomCardIndex.value < 0) {
      return;
    }
    const nextIndex = zoomCardIndex.value + step;
    if (nextIndex < 0 || nextIndex >= orderedDisplayCards.value.length) {
      return;
    }
    const target = orderedDisplayCards.value[nextIndex];
    if (!target) {
      return;
    }
    zoomCardIndex.value = nextIndex;
    await openZoomByCard(target);
  }

  function closeCardZoom() {
    zoomPreview.value = null;
    zoomDetail.value = null;
    relatedCardPreview.value = null;
    zoomCardIndex.value = -1;
    zoomDetailLoading.value = false;
    zoomDetailError.value = '';
  }

  function showRelatedCardPreview(card: HearthstoneRelatedCard) {
    relatedCardPreview.value = card.imageUrl ? card : null;
  }

  function hideRelatedCardPreview() {
    relatedCardPreview.value = null;
  }

  function onGlobalKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      closeCardZoom();
      return;
    }
    if (!zoomPreview.value) {
      return;
    }
    if (event.key === 'ArrowLeft' && canZoomPrev.value) {
      void openAdjacentZoomCard(-1);
      return;
    }
    if (event.key === 'ArrowRight' && canZoomNext.value) {
      void openAdjacentZoomCard(1);
    }
  }

  async function loadGalleryMetadata() {
    try {
      const res = await fetchMetadata({ locale: 'zh_CN' });
      metadataClasses.value = res.classes;
      metadataSets.value = res.sets;
    }
    catch {
      metadataClasses.value = [];
      metadataSets.value = [];
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', onGlobalKeydown);
    void loadGalleryMetadata();
  });

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onGlobalKeydown);
  });

  return {
    searchedCards,
    cardSearchKeyword,
    cardHeroClassFilter,
    cardSetFilter,
    isSearchingCards,
    cardPage,
    cardPageSize,
    cardTypeFilter,
    cardCostFilter,
    zoomPreview,
    zoomDetail,
    relatedCardPreview,
    zoomDetailLoading,
    zoomDetailError,
    heroClassOptions,
    cardSetOptions,
    cardTypeOptions,
    filteredSearchedCards,
    groupedCards,
    canZoomPrev,
    canZoomNext,
    detailValue,
    resolveCardType,
    resolveRarity,
    resolveClassName,
    resolveSetName,
    handleCardHoverMove,
    resetCardHoverEffect,
    doCardSearch,
    onSearchControlChange,
    changeCardPage,
    openCardZoom,
    openAdjacentZoomCard,
    closeCardZoom,
    showRelatedCardPreview,
    hideRelatedCardPreview,
  };
}
