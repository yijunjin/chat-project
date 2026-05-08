import { computed, onUnmounted, ref } from 'vue';
import {
  fetchCardDetail,
  fetchReplayDetail,
  fetchReplaySessions,
  fetchReplayTurnRecommendation,
} from '../services/hearthstoneApi';
import { CardType } from '../Enum';
import type {
  HearthstoneCard,
  LiveGameEvent,
  LiveRecommendationEnvelope,
  ReplayAction,
  ReplayTurnAiDebugResponse,
  ReplaySessionDetail,
  ReplaySessionSummary,
  ReplayTurn,
} from '../types/hearthstone';

const SSE_URL = '/api/hearthstone/live-events';
const SNAPSHOT_URL = '/api/hearthstone/live-state';

export function useLiveGame() {
  const liveState = ref<LiveGameEvent | null>(null);
  const isConnected = ref(false);
  const autoRecommendation = ref('');
  const recommendation = ref<LiveRecommendationEnvelope | null>(null);
  const errorMsg = ref('');
  const cardMap = ref<Record<string, HearthstoneCard>>({});
  const replaySessions = ref<ReplaySessionSummary[]>([]);
  const replayDetail = ref<ReplaySessionDetail | null>(null);
  const selectedReplaySessionId = ref('');
  const replayTurnIndex = ref(0);
  const replayLoading = ref(false);
  const replayError = ref('');
  const replayRecommendation = ref<LiveRecommendationEnvelope | null>(null);
  const replayDebugState = ref<ReplayTurnAiDebugResponse | null>(null);
  const replayRecommendationLoading = ref(false);
  const replayRecommendationError = ref('');

  const currentReplayTurn = computed<ReplayTurn | null>(() => {
    if (!replayDetail.value) {
      return null;
    }
    return replayDetail.value.turns[replayTurnIndex.value] || null;
  });

  let eventSource: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingCardIds = new Set<string>();

  async function ensureCardById(
    cardId: string,
    hint?: { name?: string; type?: string; cost?: number },
  ): Promise<void> {
    if (!cardId || cardMap.value[cardId] || pendingCardIds.has(cardId)) {
      return;
    }
    pendingCardIds.add(cardId);
    try {
      const detail = await fetchCardDetail({
        cardId,
        cardName: hint?.name,
        cardType: hint?.type,
        cardCost: hint?.cost,
        locale: 'zh_CN',
      });
      cardMap.value = {
        ...cardMap.value,
        [cardId]: {
          id: cardId,
          name: detail.name || hint?.name || cardId,
          cost: hint?.cost ?? 0,
          text: detail.flavorText || '',
          type: (hint?.type as HearthstoneCard['type']) || CardType.Spell,
          imageUrl: detail.imageUrl,
        },
      };
    } catch {
      cardMap.value = {
        ...cardMap.value,
        [cardId]: {
          id: cardId,
          name: hint?.name || cardId,
          cost: hint?.cost ?? 0,
          text: '',
          type: (hint?.type as HearthstoneCard['type']) || CardType.Spell,
        },
      };
    } finally {
      pendingCardIds.delete(cardId);
    }
  }

  async function hydrateCards(event: LiveGameEvent): Promise<void> {
    const idHints = new Map<string, { name?: string; type?: string; cost?: number }>();
    for (const card of event.myHand) {
      const current = idHints.get(card.cardId) || {};
      idHints.set(card.cardId, {
        name: current.name || card.name,
        type: current.type || card.type,
        cost: card.cost,
      });
    }
    for (const card of [...event.myBoard, ...event.opponentBoard]) {
      const current = idHints.get(card.cardId) || {};
      idHints.set(card.cardId, {
        name: current.name || card.name,
        type: current.type || card.type,
        cost: current.cost,
      });
    }

    const ids = [
      ...event.myHand.map((card) => card.cardId),
      ...event.myBoard.map((card) => card.cardId),
      ...event.opponentBoard.map((card) => card.cardId),
    ]
      .filter((cardId) => !!cardId)
      .filter((cardId, index, array) => array.indexOf(cardId) === index)
      .filter((cardId) => !cardMap.value[cardId] && !pendingCardIds.has(cardId));

    if (ids.length === 0) return;

    await Promise.all(ids.map((id) => ensureCardById(id, idHints.get(id))));
  }

  async function hydrateReplayTurnCards(turn: ReplayTurn | null): Promise<void> {
    if (!turn) {
      return;
    }
    const tasks: Promise<void>[] = [];
    for (const action of turn.actions) {
      if (!action.cardId) {
        continue;
      }
      tasks.push(
        ensureCardById(action.cardId, {
          name: action.cardName,
          type: 'spell',
        }),
      );
    }
    await Promise.all(tasks);
  }

  async function loadReplaySessions(limit = 10): Promise<void> {
    replayLoading.value = true;
    replayError.value = '';
    try {
      replaySessions.value = await fetchReplaySessions(limit);
    } catch (err) {
      replayError.value = `回放列表加载失败: ${String(err)}`;
    } finally {
      replayLoading.value = false;
    }
  }

  async function selectReplaySession(sessionId: string): Promise<void> {
    if (!sessionId) {
      replayDetail.value = null;
      selectedReplaySessionId.value = '';
      replayTurnIndex.value = 0;
      replayDebugState.value = null;
      replayRecommendation.value = null;
      return;
    }
    replayLoading.value = true;
    replayError.value = '';
    try {
      const detail = await fetchReplayDetail(sessionId);
      replayDetail.value = detail;
      selectedReplaySessionId.value = sessionId;
      replayTurnIndex.value = 0;
      await hydrateReplayTurnCards(detail.turns[0] || null);
      await analyzeReplayTurn('google');
    } catch (err) {
      replayError.value = `回放详情加载失败: ${String(err)}`;
    } finally {
      replayLoading.value = false;
    }
  }

  async function nextReplayTurn(): Promise<void> {
    if (!replayDetail.value || replayDetail.value.turns.length === 0) {
      return;
    }
    if (replayTurnIndex.value >= replayDetail.value.turns.length - 1) {
      return;
    }
    replayTurnIndex.value += 1;
    await hydrateReplayTurnCards(replayDetail.value.turns[replayTurnIndex.value] || null);
    await analyzeReplayTurn('google');
  }

  async function prevReplayTurn(): Promise<void> {
    if (!replayDetail.value || replayDetail.value.turns.length === 0) {
      return;
    }
    if (replayTurnIndex.value <= 0) {
      return;
    }
    replayTurnIndex.value -= 1;
    await hydrateReplayTurnCards(replayDetail.value.turns[replayTurnIndex.value] || null);
    await analyzeReplayTurn('google');
  }

  async function ensureReplayActionCard(action: ReplayAction): Promise<void> {
    if (!action.cardId) {
      return;
    }
    await ensureCardById(action.cardId, {
      name: action.cardName,
      type: 'spell',
    });
  }

  async function analyzeReplayTurn(provider: 'deepseek' | 'google' = 'google'): Promise<void> {
    replayRecommendationError.value = '';
    if (!selectedReplaySessionId.value || !currentReplayTurn.value) {
      replayDebugState.value = null;
      replayRecommendation.value = null;
      return;
    }
    replayRecommendationLoading.value = true;
    try {
      const res = await fetchReplayTurnRecommendation(
        selectedReplaySessionId.value,
        currentReplayTurn.value.turnNumber,
        provider,
      );
      await hydrateCards(res.snapshot);
      await Promise.all([
        ...res.request.myHand.map((card) => ensureCardById(card.id, {
          name: card.name,
          type: card.type,
          cost: card.cost,
        })),
        ...res.request.myBoard.map((card) => ensureCardById(card.id, {
          name: card.name,
          type: 'minion',
        })),
        ...res.request.enemyBoard.map((card) => ensureCardById(card.id, {
          name: card.name,
          type: 'minion',
        })),
      ]);
      replayDebugState.value = res;
      replayRecommendation.value = res.recommendation;
    } catch (err) {
      replayDebugState.value = null;
      replayRecommendation.value = null;
      replayRecommendationError.value = `回放建议分析失败: ${String(err)}`;
    } finally {
      replayRecommendationLoading.value = false;
    }
  }

  function connect(): void {
    disconnect(); // clean any existing connection

    try {
      eventSource = new EventSource(SSE_URL);

      eventSource.onopen = () => {
        isConnected.value = true;
        errorMsg.value = '';
      };

      eventSource.onmessage = (e: MessageEvent) => {
        try {
          const event: LiveGameEvent = JSON.parse(e.data as string);
          const previous = liveState.value;
          liveState.value = event;
          void hydrateCards(event);
          if (event.recommendation) {
            recommendation.value = event.recommendation;
          }
          if (event.autoRecommendation) {
            autoRecommendation.value = event.autoRecommendation;
          } else if (
            !event.isMyTurn ||
            event.gameStatus !== 'playing' ||
            previous?.turnNumber !== event.turnNumber
          ) {
            autoRecommendation.value = '';
            recommendation.value = null;
          }
        } catch {
          /* ignore malformed packets */
        }
      };

      eventSource.onerror = () => {
        // onerror fires on transient issues too; only reconnect when the browser
        // has fully closed the connection (CLOSED state).
        if (eventSource?.readyState === EventSource.CLOSED) {
          isConnected.value = false;
          eventSource = null;
          // Auto-reconnect after 5 seconds
          reconnectTimer = setTimeout(() => {
            if (eventSource === null) connect();
          }, 5000);
        }
      };
    } catch (err) {
      errorMsg.value = `连接失败: ${String(err)}`;
    }
  }

  function disconnect(): void {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    isConnected.value = false;
  }

  /** Fetch a one-time snapshot (used after reconnect) */
  async function fetchSnapshot(): Promise<void> {
    try {
      const res = await fetch(SNAPSHOT_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const snapshot = (await res.json()) as LiveGameEvent;
      liveState.value = snapshot;
      void hydrateCards(snapshot);
      if (snapshot.recommendation) {
        recommendation.value = snapshot.recommendation;
      }
      if (snapshot.autoRecommendation) {
        autoRecommendation.value = snapshot.autoRecommendation;
      } else if (!snapshot.isMyTurn || snapshot.gameStatus !== 'playing') {
        autoRecommendation.value = '';
        recommendation.value = null;
      }
    } catch (err) {
      errorMsg.value = `快照拉取失败: ${String(err)}`;
    }
  }

  onUnmounted(disconnect);

  return {
    liveState,
    isConnected,
    autoRecommendation,
    recommendation,
    cardMap,
    errorMsg,
    replaySessions,
    replayDetail,
    selectedReplaySessionId,
    replayTurnIndex,
    replayLoading,
    replayError,
    replayRecommendation,
    replayDebugState,
    replayRecommendationLoading,
    replayRecommendationError,
    currentReplayTurn,
    connect,
    disconnect,
    fetchSnapshot,
    loadReplaySessions,
    selectReplaySession,
    prevReplayTurn,
    nextReplayTurn,
    ensureReplayActionCard,
    analyzeReplayTurn,
  };
}
