<template>
  <div class="live-page-shell">
    <div class="top-toolbar">
      <div class="toolbar-left">
        <div class="connection-badge" :class="isConnected ? 'connected' : 'disconnected'">
          <span class="dot" />
          <span>{{ isConnected ? '实时连接中' : '实时未连接' }}</span>
        </div>
        <span v-if="errorMsg" class="error-text">{{ errorMsg }}</span>
      </div>

      <div class="toolbar-replay">
        <label class="toolbar-select-wrap">
          <span>历史对局</span>
          <select class="toolbar-select" :value="selectedReplaySessionId" @change="handleReplaySessionChange">
            <option value="">不使用回放</option>
            <option v-for="session in replaySessions" :key="session.sessionId" :value="session.sessionId">
              {{ session.sessionId }} · {{ formatSessionTime(session.startedAt) }}
            </option>
          </select>
        </label>
        <template v-if="hasReplayLoaded">
          <button class="toolbar-btn" :disabled="replayLoading || !hasPrevReplayTurn" @click="prevReplayTurn()">上一回合</button>
          <button class="toolbar-btn" :disabled="replayLoading || !hasNextReplayTurn" @click="nextReplayTurn()">下一回合</button>
          <button
            class="toolbar-btn primary"
            :disabled="replayRecommendationLoading || !currentReplayTurn"
            @click="analyzeReplayTurn('google')"
          >
            {{ replayRecommendationLoading ? '分析中…' : '分析本回合AI' }}
          </button>
        </template>
      </div>
    </div>

    <div class="workspace-grid">
      <div class="main-column">
        <div class="state-banner">
          <div>
            <div class="state-title">{{ sceneTitle }}</div>
            <div class="state-subtitle">{{ sceneSubtitle }}</div>
          </div>
          <div v-if="displayState" class="turn-badge" :class="{ myturn: displayState.isMyTurn }">
            <span>第 {{ displayState.turnNumber }} 回合</span>
            <span class="turn-state">{{ displayState.isMyTurn ? '我方行动' : '等待对手' }}</span>
            <span class="game-status">{{ displayStatusLabel }}</span>
          </div>
        </div>

        <div v-if="!displayState" class="idle-hint">
          <p>{{ selectedReplaySessionId ? '正在准备回放局面…' : '等待对局开始或选择历史对局。' }}</p>
          <p class="hint-sub">回放模式会把该回合战场、手牌和 AI 建议直接投影到主区域。</p>
        </div>

        <template v-else>
          <div class="match-header">
            <div class="player-label me">
              <span class="name">{{ displayState.playerName || '我方' }}</span>
              <div class="seat-row">
                <span class="seat" v-if="displayState.isPlayerFirst !== null">{{ displayState.isPlayerFirst ? '先手' : '后手' }}</span>
                <span class="coin" v-if="displayState.playerHasCoin === true">硬币</span>
              </div>
              <span class="hp">❤ {{ displayState.myHeroHp }}<span v-if="displayState.myHeroArmor > 0"> + {{ displayState.myHeroArmor }} 护甲</span></span>
              <span class="mana">💧 {{ displayState.myMana }} / {{ displayState.myMaxMana }}</span>
              <span class="hand-count">🃏 {{ displayState.myHandCount }} 张手牌</span>
            </div>
            <div class="player-label opp">
              <span class="name">{{ displayState.opponentName || '对手' }}</span>
              <span class="hp">❤ {{ displayState.opponentHeroHp }}<span v-if="displayState.opponentHeroArmor > 0"> + {{ displayState.opponentHeroArmor }} 护甲</span></span>
              <span class="mana">💧 {{ displayState.opponentMana }} / {{ displayState.opponentMaxMana }}</span>
              <span class="hand-count">🃏 {{ displayState.opponentHandCount }} 张手牌</span>
            </div>
          </div>

          <div class="battlefield">
            <div class="board opp-board">
              <span class="board-label">对手战场</span>
              <div class="minions">
                <div v-for="m in displayState.opponentBoard" :key="m.entityId" class="minion-oval" :class="{ location: isLocation(m.type) }">
                  <div class="minion-oval-body">
                    <img v-if="cardMap[m.cardId]?.imageUrl" class="minion-art" :src="cardMap[m.cardId].imageUrl" :alt="displayCardName(m.cardId, m.name)" />
                    <div class="minion-overlay">
                      <div class="minion-name-small">{{ displayCardName(m.cardId, m.name) }}</div>
                      <div v-if="!isLocation(m.type)" class="minion-stats-row">
                        <span class="m-atk">{{ m.attack }}</span>
                        <span class="m-sep">/</span>
                        <span class="m-hp">{{ m.health }}</span>
                      </div>
                      <div v-else class="location-hp">{{ m.health }}</div>
                    </div>
                  </div>
                  <div class="minion-popup">
                    <img v-if="cardMap[m.cardId]?.imageUrl" :src="cardMap[m.cardId].imageUrl" />
                    <div class="popup-name">{{ displayCardName(m.cardId, m.name) }}</div>
                    <div class="popup-type">{{ boardEntityLabel(m.type) }}</div>
                    <div class="popup-stats-text">{{ boardEntityStats(m) }}</div>
                    <div v-if="displayCardText(m.cardId)" class="popup-desc">{{ displayCardText(m.cardId) }}</div>
                  </div>
                </div>
                <div v-if="displayState.opponentBoard.length === 0" class="empty-board">（空）</div>
              </div>
            </div>

            <div class="board-divider" />

            <div class="board my-board">
              <span class="board-label">我方战场</span>
              <div class="minions">
                <div v-for="m in displayState.myBoard" :key="m.entityId" class="minion-oval" :class="{ exhausted: m.exhausted, location: isLocation(m.type) }">
                  <div class="minion-oval-body">
                    <img v-if="cardMap[m.cardId]?.imageUrl" class="minion-art" :src="cardMap[m.cardId].imageUrl" :alt="displayCardName(m.cardId, m.name)" />
                    <div class="minion-overlay">
                      <div class="minion-name-small">{{ displayCardName(m.cardId, m.name) }}</div>
                      <div v-if="!isLocation(m.type)" class="minion-stats-row">
                        <span class="m-atk">{{ m.attack }}</span>
                        <span class="m-sep">/</span>
                        <span class="m-hp">{{ m.health }}</span>
                      </div>
                      <div v-else class="location-hp">{{ m.health }}</div>
                      <div v-if="m.exhausted && !isLocation(m.type)" class="exhausted-dot" title="疲劳" />
                    </div>
                  </div>
                  <div class="minion-popup">
                    <img v-if="cardMap[m.cardId]?.imageUrl" :src="cardMap[m.cardId].imageUrl" />
                    <div class="popup-name">{{ displayCardName(m.cardId, m.name) }}</div>
                    <div class="popup-type">{{ boardEntityLabel(m.type) }}</div>
                    <div class="popup-stats-text">{{ boardEntityStats(m) }}</div>
                    <div v-if="displayCardText(m.cardId)" class="popup-desc">{{ displayCardText(m.cardId) }}</div>
                  </div>
                </div>
                <div v-if="displayState.myBoard.length === 0" class="empty-board">（空）</div>
              </div>
            </div>
          </div>

          <div class="hand-area">
            <span class="board-label">我方手牌（{{ displayState.myHandCount }} 张）</span>
            <div class="hand-cards">
              <div v-for="c in displayState.myHand" :key="c.entityId" class="hand-card">
                <template v-if="cardMap[c.cardId]?.imageUrl">
                  <img class="hand-card-img" :src="cardMap[c.cardId].imageUrl" :alt="displayCardName(c.cardId, c.name, c.entityId)" />
                  <div class="hand-card-tooltip">
                    <img :src="cardMap[c.cardId].imageUrl" class="hand-tooltip-img" />
                    <div class="hand-tooltip-meta">
                      <div class="hand-tooltip-name">{{ displayCardName(c.cardId, c.name, c.entityId) }}</div>
                      <div class="hand-tooltip-type">{{ displayCardType(c.cardId, c.type) }}</div>
                      <div v-if="c.attack > 0 || c.health > 0" class="hand-tooltip-stats">{{ c.attack }} / {{ c.health }}</div>
                      <div v-if="displayCardText(c.cardId)" class="hand-tooltip-text">{{ displayCardText(c.cardId) }}</div>
                    </div>
                  </div>
                </template>
                <template v-else>
                  <div class="hand-card-text-body">
                    <div class="card-cost">{{ c.cost }}</div>
                    <div class="card-id">{{ displayCardName(c.cardId, c.name, c.entityId) }}</div>
                    <div class="card-type">{{ displayCardType(c.cardId, c.type) }}</div>
                    <div v-if="displayCardText(c.cardId)" class="card-text">{{ displayCardText(c.cardId) }}</div>
                    <div v-if="c.attack > 0 || c.health > 0" class="card-stats">{{ c.attack }} / {{ c.health }}</div>
                  </div>
                </template>
              </div>
              <div v-if="displayState.myHand.length === 0" class="empty-board">（无手牌）</div>
            </div>
          </div>

          <div class="ai-panel">
            <div class="ai-panel-header">
              <span>{{ selectedReplaySessionId ? '回放 AI 建议' : '实时 AI 建议' }}</span>
              <span v-if="activeRecommendation" class="badge" :class="`risk-${activeRecommendation.risk}`">风险: {{ activeRiskLabel }}</span>
              <span v-if="activeRecommendation" class="badge badge-source">
                {{ activeRecommendation.aiMeta.provider }} · {{ activeRecommendation.aiMeta.mode === 'llm' ? '模型' : '规则' }}
              </span>
            </div>
            <div v-if="activeRecommendationError" class="record-error">{{ activeRecommendationError }}</div>
            <div v-else-if="selectedReplaySessionId && replayRecommendationLoading" class="record-hint">正在分析该回合局面…</div>
            <div v-else-if="activeRecommendation" class="ai-content">
              <div class="ai-summary">{{ activeRecommendation.summary }}</div>
              <div class="ai-meta-row">
                <span>目标: {{ activeGoalLabel }}</span>
                <span>置信度: {{ (activeRecommendation.confidence * 100).toFixed(0) }}%</span>
                <span>耗时: {{ activeRecommendation.aiMeta.latencyMs }}ms</span>
              </div>
              <div class="ai-lethal" :class="{ hot: activeRecommendation.lethal.lethalNow }">
                <span v-if="activeRecommendation.lethal.lethalNow">当前回合存在斩杀</span>
                <span v-else-if="activeRecommendation.lethal.lethalInTwoTurns">两回合斩杀窗口已打开</span>
                <span v-else>暂无稳定斩杀窗口</span>
                <span>
                  场攻 {{ activeRecommendation.lethal.myBoardAttack }} + 估算手伤 {{ activeRecommendation.lethal.estimatedHandBurst }} =
                  {{ activeRecommendation.lethal.estimatedTotalDamage }}
                </span>
              </div>
              <div class="ai-actions">
                <div v-for="action in activeRecommendation.actions" :key="action.step" class="ai-action-item">
                  <div class="ai-action-top">
                    <span class="step">步骤 {{ action.step }} · {{ action.title }}</span>
                    <span class="confidence">{{ (action.confidence * 100).toFixed(0) }}%</span>
                  </div>
                  <div class="detail">{{ action.detail }}</div>
                  <div class="reason">{{ action.reason }}</div>
                </div>
              </div>
              <div class="ai-next-plan">下回合预案: {{ activeRecommendation.nextTurnPlan }}</div>
            </div>
            <div v-else-if="selectedReplaySessionId" class="record-hint">点击“分析本回合AI”开始离线调试建议。</div>
            <div v-else-if="autoRecommendation" class="ai-content">{{ autoRecommendation }}</div>
            <div v-else class="ai-content ai-waiting">等待实时对局或选择回放对局。</div>
          </div>
        </template>
      </div>

      <aside class="log-sidebar">
        <div class="log-header">
          <span>对局日志</span>
          <div class="log-tabs">
            <button :class="{ active: logTab === 'all' }" @click="logTab = 'all'">全部</button>
            <button :class="{ active: logTab === 'me' }" @click="logTab = 'me'">我方</button>
            <button :class="{ active: logTab === 'opponent' }" @click="logTab = 'opponent'">对方</button>
          </div>
        </div>
        <div class="log-meta-bar">{{ logPanelMeta }}</div>
        <div class="log-body">
          <div v-if="replayLoading" class="record-hint">回放加载中…</div>
          <div v-else-if="replayError" class="record-error">{{ replayError }}</div>
          <ul v-else-if="displayLogs.length > 0" class="record-actions compact">
            <li v-for="item in displayLogs" :key="item.id" class="record-action-item stacked">
              <div class="record-action-row">
                <span class="record-action-type" :class="item.kindClass">{{ item.label }}</span>
                <span class="record-action-side" :class="item.sideClass">{{ item.sideText }}</span>
                <span class="record-action-main">
                  <a
                    v-if="item.cardId"
                    href="#"
                    class="record-card-link"
                    @click.prevent="openLogCardPreview(item.action)"
                    @mouseenter="showLogCardHover(item.action, $event)"
                    @mousemove="moveLogCardHover($event)"
                    @mouseleave="hideLogCardHover"
                  >
                    {{ item.title }}
                    <span v-if="cardMap[item.cardId]" class="record-card-popup">
                      <img v-if="cardMap[item.cardId].imageUrl" :src="cardMap[item.cardId].imageUrl" />
                      <span class="record-card-popup-name">{{ cardMap[item.cardId].name }}</span>
                      <span v-if="cardMap[item.cardId].text" class="record-card-popup-text">{{ cardMap[item.cardId].text }}</span>
                    </span>
                  </a>
                  <span v-else>{{ item.title }}</span>
                </span>
              </div>
              <div v-if="item.subtitle" class="record-action-subtitle">{{ item.subtitle }}</div>
            </li>
          </ul>
          <div v-else class="record-hint">{{ selectedReplaySessionId ? '当前回合没有可识别的玩家主动作。' : '选择历史对局后，这里会显示当前回合的玩家操作日志。' }}</div>
        </div>
      </aside>
    </div>

    <div
      v-if="hoverLogCard"
      class="log-hover-preview"
      :style="{ left: hoverLogCardPosition.x + 'px', top: hoverLogCardPosition.y + 'px' }"
    >
      <img v-if="hoverLogCard.imageUrl" :src="hoverLogCard.imageUrl" :alt="hoverLogCard.name" class="log-hover-preview-image" />
      <div class="log-hover-preview-name">{{ hoverLogCard.name }}</div>
      <div v-if="hoverLogCard.text" class="log-hover-preview-text">{{ hoverLogCard.text }}</div>
    </div>

    <div v-if="previewLogCard" class="card-modal" @click="closeLogCardPreview">
      <div class="card-modal-inner" @click.stop>
        <button class="card-modal-close" @click="closeLogCardPreview">关闭</button>
        <img v-if="previewLogCard.imageUrl" :src="previewLogCard.imageUrl" :alt="previewLogCard.name" class="card-modal-image" />
        <div class="card-modal-name">{{ previewLogCard.name }}</div>
        <div v-if="previewLogCard.text" class="card-modal-text">{{ previewLogCard.text }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useLiveGame } from '../composables/useLiveGame';
import type { HearthstoneCard, LiveGameEvent, ReplayAction } from '../types/hearthstone';

const {
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
  loadReplaySessions,
  selectReplaySession,
  prevReplayTurn,
  nextReplayTurn,
  ensureReplayActionCard,
  analyzeReplayTurn,
} = useLiveGame();

onMounted(() => {
  connect();
  void loadReplaySessions(10);
});

const hasNextReplayTurn = computed(() => {
  if (!replayDetail.value) {
    return false;
  }
  return replayTurnIndex.value < replayDetail.value.turns.length - 1;
});

const hasPrevReplayTurn = computed(() => replayTurnIndex.value > 0);
const hasReplayLoaded = computed(() => !!selectedReplaySessionId.value && !!replayDetail.value);

const replayVisualState = computed<LiveGameEvent | null>(() => {
  if (!replayDebugState.value?.snapshot) {
    return null;
  }
  return {
    ...replayDebugState.value.snapshot,
    autoRecommendation: replayRecommendation.value?.summary,
    recommendation: replayRecommendation.value || undefined,
  };
});

const livePlayingState = computed(() => {
  const state = liveState.value;
  if (!state) {
    return null;
  }
  if (state.gameStatus === 'playing' || state.gameStatus === 'mulligan') {
    return state;
  }
  return null;
});

const displayState = computed(() => replayVisualState.value || livePlayingState.value);

const displayStatusLabel = computed(() => {
  if (selectedReplaySessionId.value) {
    return '回放调试';
  }
  const s = liveState.value?.gameStatus;
  if (!s || s === 'idle') return '等待对局';
  if (s === 'mulligan') return '开局换牌';
  if (s === 'playing') return '对局进行中';
  if (s === 'game_over') return '对局结束';
  return '';
});

const activeRecommendation = computed(() => replayRecommendation.value || recommendation.value);

const activeRecommendationError = computed(() => selectedReplaySessionId.value ? replayRecommendationError.value : '');

const activeRiskLabel = computed(() => {
  if (!activeRecommendation.value) return '';
  if (activeRecommendation.value.risk === 'low') return '低';
  if (activeRecommendation.value.risk === 'high') return '高';
  return '中';
});

const activeGoalLabel = computed(() => {
  if (!activeRecommendation.value) return '';
  if (activeRecommendation.value.goal === 'survival') return '保命';
  if (activeRecommendation.value.goal === 'burst') return '斩杀';
  if (activeRecommendation.value.goal === 'value') return '运营';
  return '节奏';
});

const sceneTitle = computed(() => {
  if (selectedReplaySessionId.value) {
    return `回放调试 · 第 ${replayDebugState.value?.turnNumber || currentReplayTurn.value?.turnNumber || 0} 回合`;
  }
  return '实时对局';
});

const sceneSubtitle = computed(() => {
  if (selectedReplaySessionId.value) {
    return replayDebugState.value?.source === 'my_turn_snapshot'
      ? '已加载该回合我方操作前快照，可直接调试 AI 建议。'
      : '已加载该回合状态快照。';
  }
  return liveState.value?.isMyTurn ? '当前为我方回合，实时建议会自动更新。' : '未选择回放时，此区域展示实时对局。';
});

const replayPlayerActions = computed(() => {
  const actions = currentReplayTurn.value?.actions || [];
  const primary = actions.filter((action) => {
    if (action.kind === 'turn_start' || action.kind === 'damage') {
      return false;
    }
    if (action.actor === 'GameEntity') {
      return false;
    }
    if (action.kind === 'other' && !action.cardId && !action.cardName) {
      return false;
    }
    return true;
  });

  const filtered = primary.length > 0 ? primary : actions.filter((action) => action.kind !== 'turn_start' && action.kind !== 'damage');

  const finalActions: ReplayAction[] = [];
  const seenKeys = new Set<string>();

  for (const action of filtered) {
    const actorIdMatch = action.actor.match(/id=(\d+)/);
    const actorId = actorIdMatch ? actorIdMatch[1] : action.actor;
    const cardIdent = action.cardId || action.cardName || '';
    
    let key = '';
    if (action.kind === 'play' || action.kind === 'spell') {
      key = `p_s_${actorId}_${cardIdent}`;
    } else if (action.kind === 'attack') {
      key = `a_${actorId}_${action.target || ''}`;
    } else {
      key = `o_${action.kind}_${actorId}_${cardIdent}_${action.target || ''}`;
    }

    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    finalActions.push(action);
  }

  return finalActions
    .map((action, index) => ({
      side: inferActionSide(action),
      id: `${action.index}-${index}`,
      cardId: action.cardId,
      action,
      label: compactActionLabel(action),
      kindClass: `kind-${action.kind}`,
      sideText: sideText(inferActionSide(action)),
      sideClass: `side-${inferActionSide(action)}`,
      title: replayCardName(action),
      subtitle: buildActionSubtitle(action),
    }));
});

const previewLogCard = ref<HearthstoneCard | null>(null);
const hoverLogCard = ref<HearthstoneCard | null>(null);
const hoverLogCardPosition = ref({ x: 0, y: 0 });

const logTab = ref<'all' | 'me' | 'opponent'>('all');

const displayLogs = computed(() => {
  if (logTab.value === 'all') return replayPlayerActions.value;
  return replayPlayerActions.value.filter((a) => a.side === logTab.value);
});

const logPanelMeta = computed(() => {
  if (!selectedReplaySessionId.value) {
    return '右侧显示当前回合玩家操作';
  }
  return `第 ${currentReplayTurn.value?.turnNumber || 0} 回合 · ${displayLogs.value.length} 条主动作`;
});

function formatSessionTime(value: string): string {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('zh-CN', { hour12: false });
}

function compactActionLabel(action: ReplayAction): string {
  if (action.kind === 'play') return '出牌';
  if (action.kind === 'attack') return '攻击';
  if (action.kind === 'spell') return '法术';
  if (action.kind === 'power') return '触发';
  return '动作';
}

function inferActionSide(action: ReplayAction): 'me' | 'opponent' | 'unknown' {
  if (action.side && action.side !== 'unknown') {
    return action.side;
  }

  const snapshot = displayState.value;
  if (!snapshot) {
    return 'unknown';
  }

  // CardID mapping
  if (action.cardId) {
    const myCardIds = new Set([
      ...snapshot.myHand.map((item) => item.cardId),
      ...snapshot.myBoard.map((item) => item.cardId),
    ]);
    const oppCardIds = new Set(snapshot.opponentBoard.map((item) => item.cardId));
    if (myCardIds.has(action.cardId)) {
      return 'me';
    }
    if (oppCardIds.has(action.cardId)) {
      return 'opponent';
    }
  }

  // Name mapping
  const actor = cleanEntityName(action.actor).toLowerCase();
  const myName = (snapshot.playerName || '').toLowerCase();
  const oppName = (snapshot.opponentName || '').toLowerCase();
  
  if (myName && actor.includes(myName)) {
    return 'me';
  }
  if (oppName && actor.includes(oppName)) {
    return 'opponent';
  }

  return 'unknown';
}

function sideText(side: 'me' | 'opponent' | 'unknown'): string {
  if (side === 'me') return '我方';
  if (side === 'opponent') return '对方';
  return '未知';
}

function cleanEntityName(raw: string): string {
  if (!raw) return '';
  // Match entityName=XXX or just the name part before metadata
  const nameMatch = raw.match(/entityName=([^\]\s]+)/i);
  if (nameMatch && nameMatch[1] && nameMatch[1] !== 'UNKNOWN') {
    return nameMatch[1];
  }
  if (raw.includes('UNKNOWN')) return '未知实体';
  
  // Strip [id=... cardId=... type=...]
  let cleaned = raw.replace(/\[.*?\]/g, '').trim();
  // Strip common Hearthstone entity prefixes if any
  cleaned = cleaned.replace(/^(Player|GameEntity|Hero)\s+/i, '');
  
  return cleaned || '未知实体';
}

function replayCardName(action: ReplayAction): string {
  if (action.cardId && cardMap.value[action.cardId]?.name) {
    return cardMap.value[action.cardId].name;
  }
  if (action.cardName) {
    return cleanEntityName(action.cardName);
  }
  if (action.cardId) {
    return cleanEntityName(action.cardId);
  }
  return cleanEntityName(action.actor) || '未知实体';
}

function buildActionSubtitle(action: ReplayAction): string {
  const parts: string[] = [];
  
  if (action.target && action.target !== '0') {
    parts.push(`目标: ${cleanEntityName(action.target)}`);
  }

  // Handle enhanced block data
  if (action.damageEvents && action.damageEvents.length > 0) {
    const dmgSummary = action.damageEvents
      .map(e => `${cleanEntityName(e.entity)}受${e.damage}点`)
      .join(', ');
    parts.push(`伤害: ${dmgSummary}`);
  } else if (action.damage !== undefined) {
    parts.push(`造成伤害: ${action.damage}`);
  }

  if (action.spawned && action.spawned.length > 0) {
    parts.push(`生成: ${action.spawned.map(cleanEntityName).join(', ')}`);
  }

  if (action.deaths && action.deaths.length > 0) {
    parts.push(`死亡: ${action.deaths.map(cleanEntityName).join(', ')}`);
  }
  
  if (action.raw) {
    if (/Discover/i.test(action.raw)) parts.push('发现卡牌');
    if (/Draw/i.test(action.raw)) parts.push('抽牌');
  }

  return parts.join(' · ');
}

function handleReplaySessionChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  void selectReplaySession(value);
}

function showLogCardHover(action: ReplayAction, event: MouseEvent): void {
  if (!action.cardId) {
    return;
  }
  void ensureReplayActionCard(action);
  const card = cardMap.value[action.cardId];
  if (!card?.imageUrl) {
    return;
  }
  hoverLogCard.value = card;
  moveLogCardHover(event);
}

function moveLogCardHover(event: MouseEvent): void {
  if (!hoverLogCard.value) {
    return;
  }
  const panelWidth = 280;
  const panelHeight = 420;
  let x = event.clientX + 18;
  let y = event.clientY - panelHeight / 2;
  if (x + panelWidth > window.innerWidth - 8) {
    x = event.clientX - panelWidth - 18;
  }
  if (x < 8) {
    x = 8;
  }
  if (y < 8) {
    y = 8;
  }
  if (y + panelHeight > window.innerHeight - 8) {
    y = window.innerHeight - panelHeight - 8;
  }
  hoverLogCardPosition.value = { x, y };
}

function hideLogCardHover(): void {
  hoverLogCard.value = null;
}

function openLogCardPreview(action: ReplayAction): void {
  if (!action.cardId) {
    return;
  }
  const card = cardMap.value[action.cardId];
  if (!card || !card.imageUrl) {
    void ensureReplayActionCard(action);
    return;
  }
  previewLogCard.value = card;
}

function closeLogCardPreview(): void {
  previewLogCard.value = null;
}

function displayCardName(cardId: string, fallbackName?: string, entityId?: number): string {
  if (cardMap.value[cardId]?.name) return cardMap.value[cardId].name;
  if (fallbackName && fallbackName.trim() && !fallbackName.startsWith('UNKNOWN ENTITY')) return fallbackName;
  if (cardId) return cardId;
  return entityId ? `未揭示(#${entityId})` : '未揭示';
}

function displayCardText(cardId: string): string {
  return cardMap.value[cardId]?.text?.trim() || '';
}

function displayCardType(cardId: string, fallbackType: string): string {
  if (cardMap.value[cardId]?.type) return cardMap.value[cardId].type;
  if (!fallbackType || fallbackType === 'unknown') return '未识别';
  return fallbackType;
}

function isLocation(type: string): boolean {
  return type === 'location';
}

function boardEntityLabel(type: string): string {
  if (type === 'location') return '地标';
  if (type === 'minion') return '随从';
  return type || '实体';
}

function boardEntityStats(entity: { type: string; attack: number; health: number; cooldown: number | null }): string {
  if (entity.type === 'location') {
    return entity.cooldown !== null ? `剩余 ${entity.health} · 冷却 ${entity.cooldown}` : `剩余 ${entity.health}`;
  }
  return `${entity.attack} / ${entity.health}`;
}
</script>

<style scoped>
.live-page-shell {
  height: calc(100vh - 96px);
  overflow: hidden;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: #1a1a2e;
  color: #e0e0e0;
}

.top-toolbar {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-end;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.connection-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  padding: 6px 10px;
  border-radius: 999px;
}

.connection-badge.connected { background: #1a3a2a; color: #4caf50; }
.connection-badge.disconnected { background: #3a1a1a; color: #f44336; }

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}

.toolbar-replay {
  display: flex;
  gap: 10px;
  align-items: flex-end;
  flex-wrap: wrap;
}

.toolbar-select-wrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 360px;
}

.toolbar-select-wrap span {
  font-size: 12px;
  color: #a7b6d3;
}

.toolbar-select,
.toolbar-btn {
  height: 36px;
  border-radius: 8px;
  border: 1px solid #314a7a;
  background: #0c1629;
  color: #d5def0;
  padding: 0 12px;
}

.toolbar-btn {
  cursor: pointer;
}

.toolbar-btn.primary {
  border-color: #4c6fc7;
  background: linear-gradient(180deg, #324a86, #22345c);
}

.error-text {
  color: #f19494;
  font-size: 12px;
}

.workspace-grid {
  flex: 1;
  min-height: 0;
  height: calc(100vh - 170px);
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 16px;
}

.main-column,
.log-sidebar {
  min-height: 0;
  border-radius: 14px;
  border: 1px solid #233a61;
  background: rgba(11, 20, 37, 0.92);
}

.main-column {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
}

.log-sidebar {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.log-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 14px 14px 10px;
  font-size: 14px;
  font-weight: 600;
}

.log-tabs {
  display: flex;
  gap: 4px;
}

.log-tabs button {
  background: transparent;
  border: none;
  color: #8ea2c9;
  cursor: pointer;
  padding: 2px 6px;
  font-size: 11px;
  border-radius: 4px;
}

.log-tabs button.active {
  background: rgba(255, 255, 255, 0.1);
  color: #f2f8ff;
}

.log-meta-bar {
  padding: 0 14px 10px;
  font-size: 11px;
  color: #8ea2c9;
  text-align: right;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.log-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 14px 14px;
}

.state-banner {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
}

.state-title {
  font-size: 18px;
  font-weight: 700;
}

.state-subtitle {
  margin-top: 4px;
  font-size: 12px;
  color: #90a4c7;
}

.turn-badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  background: #0d0d1a;
  border-radius: 8px;
  padding: 10px 16px;
  min-width: 120px;
  font-size: 13px;
}

.turn-badge.myturn { box-shadow: 0 0 12px #ffd54f88; }
.turn-badge .turn-state { font-size: 12px; color: #ffd54f; }
.turn-badge .game-status { font-size: 11px; color: #aaa; }

.idle-hint {
  text-align: center;
  padding: 72px 20px;
  color: #93a0b5;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.02);
}

.hint-sub { font-size: 12px; margin-top: 8px; }

.match-header {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  background: #16213e;
  border-radius: 10px;
  padding: 14px 18px;
}

.player-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 14px;
}

.player-label.opp { align-items: flex-end; }
.player-label .name { font-weight: 600; font-size: 15px; }

.seat-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.seat,
.coin,
.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11px;
}

.seat { background: rgba(255, 213, 79, 0.16); color: #ffd54f; }
.coin { background: rgba(255, 183, 77, 0.18); color: #ffb74d; }
.player-label .hp { color: #ef9a9a; }
.player-label .mana { color: #90caf9; }
.player-label .hand-count { color: #ce93d8; }

.battlefield,
.hand-area,
.ai-panel {
  background: #16213e;
  border-radius: 10px;
  padding: 14px;
}

.battlefield {
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: visible;
}

.board { display: flex; flex-direction: column; gap: 8px; }
.board-label { font-size: 12px; color: #aaa; }
.minions { display: flex; flex-wrap: wrap; gap: 8px; }

.minion-oval {
  position: relative;
  width: 80px;
  flex-shrink: 0;
  cursor: pointer;
}

.minion-oval-body {
  width: 80px;
  height: 96px;
  border-radius: 50%;
  border: 2px solid #2a5a8c;
  overflow: hidden;
  background: #1a3a5c;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.minion-oval:hover .minion-oval-body { box-shadow: 0 0 10px #4a8abcaa; }
.minion-oval.exhausted .minion-oval-body { opacity: 0.55; border-color: #555; }

.minion-oval.location .minion-oval-body {
  border-radius: 14px;
  border-color: #6e57a5;
  background: #3b315d;
  height: 80px;
}

.minion-art {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center 20%;
  opacity: 0.72;
}

.minion-overlay {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  padding: 4px;
}

.minion-name-small {
  font-size: 9px;
  color: #fff;
  text-align: center;
  text-shadow: 0 1px 3px #000, 0 0 6px #000;
  line-height: 1.2;
  max-width: 72px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  word-break: break-all;
}

.minion-stats-row {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 13px;
  font-weight: bold;
  margin-top: 4px;
}

.m-atk { color: #ffe082; text-shadow: 0 1px 3px #000; }
.m-sep { color: #bbb; font-size: 10px; }
.m-hp  { color: #ff8a80; text-shadow: 0 1px 3px #000; }

.location-hp {
  font-size: 13px;
  color: #ce93d8;
  font-weight: bold;
  margin-top: 4px;
  text-shadow: 0 1px 3px #000;
}

.exhausted-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #aaa;
  margin-top: 3px;
}

.minion-oval:hover .minion-popup { display: flex; }

.minion-popup {
  display: none;
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  background: #0d1b2a;
  border: 1px solid #2a5a8c;
  border-radius: 10px;
  padding: 8px;
  gap: 6px;
  flex-direction: column;
  align-items: center;
  width: 164px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.75);
  pointer-events: none;
}

.minion-popup img { width: 148px; border-radius: 6px; }
.popup-name { font-size: 12px; font-weight: 600; color: #e0e0e0; text-align: center; }
.popup-type { font-size: 11px; color: #c7b6ff; text-align: center; }
.popup-stats-text { font-size: 12px; font-weight: bold; color: #ffe082; text-align: center; }
.popup-desc { font-size: 10px; color: #9fb3d9; text-align: center; line-height: 1.4; }

.board-divider {
  height: 1px;
  background: #1a4a8a;
  margin: 4px 0;
}

.empty-board { color: #555; font-size: 12px; padding: 8px; }

.hand-area {
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: visible;
}

.hand-cards {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: flex-end;
}

.hand-card {
  position: relative;
  flex-shrink: 0;
  cursor: pointer;
}

.hand-card-img {
  width: 72px;
  display: block;
  border-radius: 6px;
  border: 1px solid #2e3a6a;
  transition: filter 0.15s;
}

.hand-card:hover .hand-card-img { filter: brightness(1.15); }

.hand-cost-badge {
  position: absolute;
  top: 4px;
  left: 4px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #1565c0;
  color: #fff;
  font-weight: bold;
  font-size: 12px;
  line-height: 22px;
  text-align: center;
  border: 1px solid #42a5f5;
  box-shadow: 0 1px 4px rgba(0,0,0,0.6);
  z-index: 1;
}

.hand-card:hover .hand-card-tooltip { display: flex; }

.hand-card-tooltip {
  display: none;
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  background: #0d1b2a;
  border: 1px solid #2e3a6a;
  border-radius: 10px;
  padding: 8px;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 200px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.75);
  pointer-events: none;
}

.hand-tooltip-img { width: 184px; border-radius: 8px; }
.hand-tooltip-meta { width: 100%; }
.hand-tooltip-name { font-size: 12px; font-weight: 600; color: #e0e0e0; text-align: center; }
.hand-tooltip-type { font-size: 11px; color: #aaa; text-align: center; }
.hand-tooltip-stats { font-size: 12px; font-weight: bold; color: #ef9a9a; text-align: center; }
.hand-tooltip-text { font-size: 10px; color: #9fb3d9; line-height: 1.4; text-align: center; margin-top: 4px; }

.hand-card-text-body {
  background: #1e2a4a;
  border: 1px solid #2e3a6a;
  border-radius: 8px;
  padding: 8px 10px;
  min-width: 80px;
  text-align: center;
  font-size: 12px;
}

.ai-panel {
  background: #0d1b2a;
  border: 1px solid #1a3a5c;
}

.ai-panel-header {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 600;
  margin-bottom: 10px;
  font-size: 14px;
}

.badge.risk-low { background: rgba(56, 142, 60, 0.25); color: #a5d6a7; }
.badge.risk-medium { background: rgba(251, 140, 0, 0.25); color: #ffcc80; }
.badge.risk-high { background: rgba(211, 47, 47, 0.25); color: #ef9a9a; }
.badge-source { background: rgba(144, 202, 249, 0.2); color: #90caf9; }

.ai-content {
  font-size: 13px;
  line-height: 1.6;
  color: #ddd;
  white-space: pre-wrap;
}

.ai-summary { font-weight: 600; color: #fff4cf; margin-bottom: 8px; }

.ai-meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 12px;
  color: #cfd8dc;
  margin-bottom: 8px;
}

.ai-lethal {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 8px;
  padding: 8px;
  border-radius: 8px;
  background: rgba(255, 224, 130, 0.08);
  color: #ffe082;
  font-size: 12px;
}

.ai-lethal.hot {
  background: rgba(211, 47, 47, 0.18);
  color: #ffccbc;
}

.ai-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ai-action-item {
  padding: 8px;
  border-left: 3px solid #ffcc80;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.03);
}

.ai-action-top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  margin-bottom: 4px;
}

.ai-action-top .step { color: #ffe082; }
.ai-action-top .confidence { color: #b3e5fc; }
.ai-action-item .detail { color: #eceff1; font-size: 13px; }
.ai-action-item .reason { color: #b0bec5; font-size: 12px; margin-top: 3px; }
.ai-next-plan { margin-top: 8px; font-size: 12px; color: #c5e1a5; }
.ai-waiting { color: #666; font-style: italic; }

.record-hint { font-size: 12px; color: #95a3bf; }
.record-error { font-size: 12px; color: #f19494; }

.record-actions {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.record-actions.compact {
  gap: 8px;
}

.record-action-item {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  color: #d7e0f0;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
}

.record-action-item.stacked {
  flex-direction: column;
  align-items: stretch;
}

.record-action-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.record-action-type {
  min-width: 48px;
  color: #9fc0ff;
}

.record-action-type.kind-play {
  color: #9ad1ff;
  background: rgba(80, 150, 220, 0.16);
  border: 1px solid rgba(80, 150, 220, 0.3);
  padding: 2px 8px;
  border-radius: 999px;
}

.record-action-type.kind-attack {
  color: #ffb6b6;
  background: rgba(210, 72, 72, 0.16);
  border: 1px solid rgba(210, 72, 72, 0.3);
  padding: 2px 8px;
  border-radius: 999px;
}

.record-action-type.kind-spell {
  color: #d8c6ff;
  background: rgba(130, 90, 210, 0.16);
  border: 1px solid rgba(130, 90, 210, 0.3);
  padding: 2px 8px;
  border-radius: 999px;
}

.record-action-type.kind-power {
  color: #ffd791;
  background: rgba(255, 215, 145, 0.12);
  border: 1px solid rgba(255, 215, 145, 0.32);
  padding: 2px 8px;
  border-radius: 999px;
}

.record-action-type.kind-other {
  color: #b8c8df;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  padding: 2px 8px;
  border-radius: 999px;
}

.record-action-side {
  min-width: 42px;
  text-align: center;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 11px;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.record-action-side.side-me {
  color: #a5d6a7;
  background: rgba(76, 175, 80, 0.15);
}

.record-action-side.side-opponent {
  color: #ffcc80;
  background: rgba(251, 140, 0, 0.15);
}

.record-action-side.side-unknown {
  color: #cfd8dc;
  background: rgba(255, 255, 255, 0.08);
}

.record-action-main {
  position: relative;
  flex: 1;
}

.record-action-subtitle {
  padding-left: 56px;
  color: #b8c8df;
  line-height: 1.45;
}

.record-card-link {
  color: #7dc4ff;
  text-decoration: underline;
  text-decoration-color: rgba(125, 196, 255, 0.35);
}

.record-card-link:hover { color: #a8dbff; }

.record-card-popup {
  display: none;
  position: absolute;
  left: 0;
  top: calc(100% + 8px);
  z-index: 1200;
  width: 220px;
  padding: 8px;
  border-radius: 8px;
  border: 1px solid #3a5f98;
  background: #0a1425;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.7);
  color: #d8e2f5;
  pointer-events: none;
}

.record-card-link:hover .record-card-popup {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.record-card-popup img { width: 100%; border-radius: 6px; }
.record-card-popup-name { font-size: 12px; font-weight: 600; }
.record-card-popup-text { font-size: 11px; line-height: 1.45; color: #9fb3d9; }

.log-hover-preview {
  position: fixed;
  width: 280px;
  z-index: 2100;
  border: 1px solid #3a5f98;
  border-radius: 10px;
  background: #0a1425;
  padding: 8px;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.6);
  pointer-events: none;
}

.log-hover-preview-image {
  width: 100%;
  border-radius: 8px;
}

.log-hover-preview-name {
  margin-top: 8px;
  font-size: 12px;
  font-weight: 700;
  color: #e6efff;
}

.log-hover-preview-text {
  margin-top: 4px;
  font-size: 11px;
  color: #b8c8df;
  line-height: 1.45;
}

.card-modal {
  position: fixed;
  inset: 0;
  z-index: 2200;
  background: rgba(0, 0, 0, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.card-modal-inner {
  width: min(480px, 92vw);
  background: #0a1425;
  border: 1px solid #3a5f98;
  border-radius: 12px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.card-modal-close {
  align-self: flex-end;
  height: 30px;
  border-radius: 8px;
  border: 1px solid #445c8f;
  background: #162646;
  color: #dbe8ff;
  padding: 0 10px;
  cursor: pointer;
}

.card-modal-image {
  width: 100%;
  border-radius: 10px;
}

.card-modal-name {
  font-size: 14px;
  font-weight: 700;
  color: #e6efff;
}

.card-modal-text {
  font-size: 12px;
  color: #b8c8df;
  line-height: 1.55;
}

@media (max-width: 1180px) {
  .workspace-grid {
    grid-template-columns: 1fr;
    height: auto;
  }

  .log-sidebar {
    min-height: 320px;
  }
}

@media (max-width: 860px) {
  .top-toolbar,
  .toolbar-replay,
  .state-banner,
  .match-header {
    grid-template-columns: 1fr;
    display: grid;
  }

  .toolbar-select-wrap {
    min-width: 0;
  }

  .player-label.opp {
    align-items: flex-start;
  }
}
</style>