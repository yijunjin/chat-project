import type {
  HearthstoneCardDetailResponse,
  HearthstoneCardSearchRequest,
  HearthstoneCardSearchResponse,
  HearthstoneDeckRequest,
  HearthstoneDeckResponse,
  HearthstoneGameState,
  HearthstoneMetadataResponse,
  HearthstoneOpeningHandRequest,
  HearthstoneOpeningHandResponse,
  HearthstoneRecommendRequest,
  HearthstoneRecommendResponse,
  ReplayTurnAiDebugResponse,
  ReplaySessionDetail,
  ReplaySessionSummary,
  HearthstoneSimulateTurnRequest,
  HearthstoneSimulateTurnResponse,
  HearthstoneTurnOptionsResponse,
} from '../types/hearthstone';

export async function fetchHearthstoneRecommendation(
  payload: HearthstoneRecommendRequest,
): Promise<HearthstoneRecommendResponse> {
  const response = await fetch('/api/hearthstone/recommend', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`请求失败: ${response.status}`);
  }

  return (await response.json()) as HearthstoneRecommendResponse;
}

export async function fetchTurnOptions(payload: {
  state: HearthstoneGameState;
  provider?: 'deepseek' | 'google';
}): Promise<HearthstoneTurnOptionsResponse> {
  const response = await fetch('/api/hearthstone/turn-options', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`获取选项失败: ${response.status}`);
  }

  return (await response.json()) as HearthstoneTurnOptionsResponse;
}

export async function simulateTurn(
  payload: HearthstoneSimulateTurnRequest,
): Promise<HearthstoneSimulateTurnResponse> {
  const response = await fetch('/api/hearthstone/simulate-turn', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`模拟回合失败: ${response.status}`);
  }

  return (await response.json()) as HearthstoneSimulateTurnResponse;
}

export async function searchCards(
  payload: HearthstoneCardSearchRequest,
): Promise<HearthstoneCardSearchResponse> {
  const response = await fetch('/api/hearthstone/cards/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`卡牌搜索失败: ${response.status}`);
  }

  return (await response.json()) as HearthstoneCardSearchResponse;
}

export async function fetchCardDetail(payload: {
  cardSlug?: string;
  cardId?: string;
  cardName?: string;
  cardType?: string;
  cardCost?: number;
  locale?: string;
}): Promise<HearthstoneCardDetailResponse> {
  const response = await fetch('/api/hearthstone/cards/detail', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`卡牌详情获取失败: ${response.status}`);
  }

  return (await response.json()) as HearthstoneCardDetailResponse;
}

export async function fetchCardsByIds(payload: {
  ids: string[];
  locale?: string;
  pageSize?: number;
}): Promise<HearthstoneCardSearchResponse> {
  const response = await fetch('/api/hearthstone/cards/by-ids', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`关联卡牌获取失败: ${response.status}`);
  }

  return (await response.json()) as HearthstoneCardSearchResponse;
}

export async function fetchOpeningHand(
  payload: HearthstoneOpeningHandRequest,
): Promise<HearthstoneOpeningHandResponse> {
  const response = await fetch('/api/hearthstone/cards/opening-hand', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`开局手牌获取失败: ${response.status}`);
  }

  return (await response.json()) as HearthstoneOpeningHandResponse;
}

export async function fetchMetadata(payload?: {
  locale?: string;
}): Promise<HearthstoneMetadataResponse> {
  const response = await fetch('/api/hearthstone/metadata', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload || {}),
  });

  if (!response.ok) {
    throw new Error(`元数据获取失败: ${response.status}`);
  }

  return (await response.json()) as HearthstoneMetadataResponse;
}

export async function fetchDeck(payload: HearthstoneDeckRequest): Promise<HearthstoneDeckResponse> {
  const response = await fetch('/api/hearthstone/deck', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`套牌加载失败: ${response.status}`);
  }

  return (await response.json()) as HearthstoneDeckResponse;
}

export async function fetchReplaySessions(limit = 10): Promise<ReplaySessionSummary[]> {
  const response = await fetch(`/api/hearthstone/replays?limit=${encodeURIComponent(String(limit))}`);
  if (!response.ok) {
    throw new Error(`回放列表加载失败: ${response.status}`);
  }
  return (await response.json()) as ReplaySessionSummary[];
}

export async function fetchReplayDetail(sessionId: string): Promise<ReplaySessionDetail> {
  const response = await fetch(`/api/hearthstone/replays/${encodeURIComponent(sessionId)}`);
  if (!response.ok) {
    throw new Error(`回放详情加载失败: ${response.status}`);
  }
  return (await response.json()) as ReplaySessionDetail;
}

export async function fetchReplayTurnRecommendation(
  sessionId: string,
  turnNumber: number,
  provider: 'deepseek' | 'google' = 'google',
): Promise<ReplayTurnAiDebugResponse> {
  const query = new URLSearchParams({
    turn: String(turnNumber),
    provider,
  });
  const response = await fetch(
    `/api/hearthstone/replays/${encodeURIComponent(sessionId)}/recommendation?${query.toString()}`,
  );
  if (!response.ok) {
    throw new Error(`回放建议分析失败: ${response.status}`);
  }
  return (await response.json()) as ReplayTurnAiDebugResponse;
}