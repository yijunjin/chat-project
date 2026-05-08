<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { searchCards } from '../services/hearthstoneApi';
import { useGameMatch } from '../composables/useGameMatch';
import type { HearthstoneCard } from '../types/hearthstone';

type PreviewTarget = {
  name: string;
  imageUrl?: string;
  cropImageUrl?: string;
};

const {
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
  errorMsg,
  bestOption,
  riskText,
  optionSource,
  recommendationSource,
  loadPlayerDeck,
  loadEnemyDeck,
  startMatch,
  runPlayerTurn,
  draggingCardId,
  startDragCard,
  clearDragCard,
  playDraggedCardToBoard,
  refreshCoach,
} = useGameMatch();

const deckPreviewOpen = ref(false);
const deckPreviewTitle = ref('');
const deckPreviewCards = ref<typeof playerDeck.value>([]);
const hoverPreviewCard = ref<PreviewTarget | null>(null);
const hoverPreviewPosition = ref({ x: 0, y: 0 });
const minionImageMap = ref<Record<string, { imageUrl?: string; cropImageUrl?: string }>>({});
const minionLoadingNames = new Set<string>();

const deckPreviewEntries = computed(() => {
  const map = new Map<string, { card: HearthstoneCard; count: number }>();

  for (const card of deckPreviewCards.value) {
    const key = String(card.id || `${card.name}-${card.cost}`);
    const current = map.get(key);
    if (current) {
      current.count += 1;
      continue;
    }
    map.set(key, {
      card,
      count: 1,
    });
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.card.cost !== b.card.cost) {
      return a.card.cost - b.card.cost;
    }
    return a.card.name.localeCompare(b.card.name, 'zh-CN');
  });
});

const enemyBoardVisuals = computed(() => {
  const board = gameState.value?.enemyBoard || [];
  return board.map((item) => ({
    ...item,
    imageUrl: minionImageMap.value[item.name]?.imageUrl,
    cropImageUrl: minionImageMap.value[item.name]?.cropImageUrl,
  }));
});

const myBoardVisuals = computed(() => {
  const board = gameState.value?.myBoard || [];
  return board.map((item) => ({
    ...item,
    imageUrl: minionImageMap.value[item.name]?.imageUrl,
    cropImageUrl: minionImageMap.value[item.name]?.cropImageUrl,
  }));
});

const boardNameKey = computed(() => {
  const myNames = (gameState.value?.myBoard || []).map((item) => item.name).join('|');
  const enemyNames = (gameState.value?.enemyBoard || []).map((item) => item.name).join('|');
  return `${myNames}#${enemyNames}`;
});

watch(
  boardNameKey,
  () => {
    void hydrateMinionImages();
  },
  { immediate: true },
);

async function hydrateMinionImages() {
  const board = [
    ...(gameState.value?.myBoard || []),
    ...(gameState.value?.enemyBoard || []),
  ];
  const names = Array.from(new Set(board.map((item) => item.name).filter((item) => !!item)));
  const missing = names.filter((name) => !(name in minionImageMap.value) && !minionLoadingNames.has(name));
  if (missing.length === 0) {
    return;
  }

  await Promise.all(missing.map(async (name) => {
    minionLoadingNames.add(name);
    try {
      const result = await searchCards({
        query: name,
        locale: 'zh_CN',
        pageSize: 20,
      });
      const exact = result.cards.find((item) => item.name === name) || result.cards[0];
      minionImageMap.value = {
        ...minionImageMap.value,
        [name]: {
          imageUrl: exact?.imageUrl,
          cropImageUrl: exact?.cropImageUrl,
        },
      };
    }
    catch {
      minionImageMap.value = {
        ...minionImageMap.value,
        [name]: {},
      };
    }
    finally {
      minionLoadingNames.delete(name);
    }
  }));
}

function openDeckPreview(type: 'player' | 'enemy') {
  if (type === 'player') {
    deckPreviewTitle.value = '我方套牌内容';
    deckPreviewCards.value = playerDeck.value;
  }
  else {
    deckPreviewTitle.value = '敌方套牌内容';
    deckPreviewCards.value = enemyDeck.value;
  }
  deckPreviewOpen.value = true;
}

function closeDeckPreview() {
  deckPreviewOpen.value = false;
  hoverPreviewCard.value = null;
}

function updateHoverPreviewPosition(event: MouseEvent) {
  const previewWidth = 280;
  const previewHeight = 390;
  let x = event.clientX + 18;
  let y = event.clientY - previewHeight / 2;

  if (x + previewWidth > window.innerWidth - 8) {
    x = event.clientX - previewWidth - 18;
  }
  if (x < 8) {
    x = 8;
  }
  if (y < 8) {
    y = 8;
  }
  if (y + previewHeight > window.innerHeight - 8) {
    y = window.innerHeight - previewHeight - 8;
  }

  hoverPreviewPosition.value = { x, y };
}

function showHoverPreview(card: PreviewTarget, event: MouseEvent) {
  if (!card.imageUrl && !card.cropImageUrl) {
    return;
  }
  hoverPreviewCard.value = card;
  updateHoverPreviewPosition(event);
}

function moveHoverPreview(event: MouseEvent) {
  if (!hoverPreviewCard.value) {
    return;
  }
  updateHoverPreviewPosition(event);
}

function hideHoverPreview() {
  hoverPreviewCard.value = null;
}

function keywordLabel(keyword?: string): string {
  if (!keyword) {
    return '';
  }
  const map: Record<string, string> = {
    taunt: '嘲讽',
    'divine-shield': '圣盾',
    rush: '突袭',
    charge: '冲锋',
  };
  return map[keyword] || keyword;
}

async function onBoardDrop() {
  await playDraggedCardToBoard();
}
</script>

<template>
  <main class="match-layout">
    <section class="panel panel-main">
      <h2>游戏对局页面</h2>

      <div class="deck-grid">
        <label>
          <span>我方套牌编码</span>
          <input v-model="form.playerDeckCode" type="text" placeholder="粘贴我方 deck code (AAE...)" />
          <div class="inline-actions">
            <button class="secondary" :disabled="isLoadingPlayerDeck" @click="loadPlayerDeck">
              {{ isLoadingPlayerDeck ? '加载中...' : `加载我方套牌 (${playerDeck.length})` }}
            </button>
            <button class="ghost" :disabled="playerDeck.length === 0" @click="openDeckPreview('player')">查看套牌</button>
          </div>
        </label>

        <label>
          <span>敌方套牌编码</span>
          <input v-model="form.enemyDeckCode" type="text" placeholder="粘贴敌方 deck code (AAE...)" />
          <div class="inline-actions">
            <button class="secondary" :disabled="isLoadingEnemyDeck" @click="loadEnemyDeck">
              {{ isLoadingEnemyDeck ? '加载中...' : `加载敌方套牌 (${enemyDeck.length})` }}
            </button>
            <button class="ghost" :disabled="enemyDeck.length === 0" @click="openDeckPreview('enemy')">查看套牌</button>
          </div>
        </label>
      </div>

      <div class="actions-row">
        <button class="cta" :disabled="isStarting || playerDeck.length === 0 || enemyDeck.length === 0" @click="startMatch">
          {{ isStarting ? '进入对局中...' : '进入对局' }}
        </button>
      </div>

      <p v-if="errorMsg" class="error">{{ errorMsg }}</p>

      <div v-if="gameState" class="state-box">
        <div class="hero-row enemy">
          <div>
            <p class="hero-title">AI对手</p>
            <p>职业: {{ gameState.enemyClass }} · 血量: {{ gameState.enemyHealth }} · 水晶: {{ gameState.enemyManaCrystals }}</p>
            <p>手牌: {{ gameState.enemyHandCount }}</p>
          </div>
        </div>

        <div class="turn-banner">T{{ gameState.turn }} · {{ gameState.isPlayerFirst ? '你先手' : '你后手' }}</div>

        <div class="hero-row player">
          <div>
            <p class="hero-title">我方</p>
            <p>职业: {{ gameState.heroClass }} · 血量: {{ gameState.myHealth }} · 水晶: {{ gameState.myManaCrystals }}</p>
            <p>硬币: {{ gameState.playerHasCoin ? '有' : '无' }}</p>
          </div>
        </div>

        <div class="board-wrap">
          <div class="board-block">
            <p class="board-title">敌方战场</p>
            <TransitionGroup name="minion-pop" tag="div" class="minion-lane">
              <article
                v-for="minion in enemyBoardVisuals"
                :key="minion.id"
                class="minion-egg"
                @mouseenter="(event) => showHoverPreview(minion, event as MouseEvent)"
                @mousemove="(event) => moveHoverPreview(event as MouseEvent)"
                @mouseleave="hideHoverPreview"
              >
                <img v-if="minion.cropImageUrl || minion.imageUrl" :src="minion.cropImageUrl || minion.imageUrl" :alt="minion.name" />
                <div v-else class="minion-fallback">{{ minion.name.slice(0, 1) }}</div>
                <span class="minion-stat atk">{{ minion.attack }}</span>
                <span class="minion-stat hp">{{ minion.health }}</span>
                <span v-if="minion.keywords?.[0]" class="minion-keyword">{{ keywordLabel(minion.keywords[0]) }}</span>
              </article>
            </TransitionGroup>
          </div>

          <div class="board-block droppable" :class="{ dropping: !!draggingCardId }" @dragover.prevent @drop.prevent="onBoardDrop">
            <p class="board-title">我方战场</p>
            <TransitionGroup name="minion-pop" tag="div" class="minion-lane">
              <article
                v-for="minion in myBoardVisuals"
                :key="minion.id"
                class="minion-egg"
                @mouseenter="(event) => showHoverPreview(minion, event as MouseEvent)"
                @mousemove="(event) => moveHoverPreview(event as MouseEvent)"
                @mouseleave="hideHoverPreview"
              >
                <img v-if="minion.cropImageUrl || minion.imageUrl" :src="minion.cropImageUrl || minion.imageUrl" :alt="minion.name" />
                <div v-else class="minion-fallback">{{ minion.name.slice(0, 1) }}</div>
                <span class="minion-stat atk">{{ minion.attack }}</span>
                <span class="minion-stat hp">{{ minion.health }}</span>
                <span v-if="minion.keywords?.[0]" class="minion-keyword">{{ keywordLabel(minion.keywords[0]) }}</span>
              </article>
            </TransitionGroup>
            <p v-if="draggingCardId" class="drop-tip">拖到此区域上场</p>
          </div>
        </div>

        <p class="hand-title">我方手牌</p>
        <div class="hand-grid">
          <article
            v-for="card in gameState.myHand"
            :key="card.id"
            class="hand-card"
            draggable="true"
            @dragstart="startDragCard(card.id)"
            @dragend="clearDragCard"
            @mouseenter="(event) => showHoverPreview(card, event as MouseEvent)"
            @mousemove="(event) => moveHoverPreview(event as MouseEvent)"
            @mouseleave="hideHoverPreview"
          >
            <img v-if="card.cropImageUrl || card.imageUrl" :src="card.cropImageUrl || card.imageUrl" :alt="card.name" />
            <div v-else class="hand-fallback">{{ card.name.slice(0, 1) }}</div>
            <span class="hand-cost">{{ card.cost }}</span>
          </article>
        </div>
      </div>

      <div v-if="turnOptions.length > 0" class="options-box">
        <h3>当前可选动作</h3>
        <p class="mode-line">
          路线来源：{{ optionSource === 'llm' ? '深度建议' : '极速建议' }}
          <span v-if="isDeepThinking"> · 深度分析中...</span>
        </p>
        <p v-if="bestOption" class="best-line">AI最优建议动作：{{ bestOption.title }}</p>
        <p v-if="gameResult.isGameOver" class="best-line">对局已结束。</p>

        <label v-for="item in turnOptions" :key="item.id" class="option-item">
          <input v-model="selectedOptionId" type="radio" name="match-option" :value="item.id" />
          <div>
            <p class="option-title">{{ item.title }}</p>
            <p class="option-detail">{{ item.detail }}</p>
            <p class="option-meta">预期: {{ item.expected }} · 风险: {{ item.risk }}</p>
          </div>
        </label>

        <div class="actions-row">
          <button class="cta" :disabled="isRunningTurn || !selectedOptionId || gameResult.isGameOver" @click="runPlayerTurn">
            {{ isRunningTurn ? '回合推进中...' : '按当前选择推进回合' }}
          </button>
          <button class="secondary" :disabled="isLoadingCoach || !gameState" @click="refreshCoach">
            {{ isLoadingCoach ? '建议生成中...' : '刷新AI建议' }}
          </button>
        </div>
      </div>

      <div class="log-box">
        <h3>对局日志</h3>
        <ul>
          <li v-for="(line, index) in battleLog" :key="index">{{ line }}</li>
        </ul>
      </div>
    </section>

    <aside class="panel panel-coach">
      <h2>实时 AI 辅助</h2>
      <p class="muted">已嵌入对局页面。每次场面变化都会刷新最优建议。</p>

      <button class="secondary" :disabled="isLoadingCoach || !gameState" @click="refreshCoach">
        {{ isLoadingCoach ? '建议生成中...' : '手动刷新建议' }}
      </button>

      <div v-if="recommendation" class="coach-box">
        <p class="mode-line">
          建议来源：{{ recommendationSource === 'llm' ? '深度建议' : '极速建议' }}
          <span v-if="isDeepThinking"> · 深度分析中...</span>
        </p>
        <p>风险等级：{{ riskText }}</p>
        <p class="coach-summary">{{ recommendation.summary }}</p>
        <p>运营主线：{{ recommendation.operationStrategy.corePlan }}</p>
        <p>资源计划：{{ recommendation.operationStrategy.economyPlan }}</p>
        <p>下回合计划：{{ recommendation.nextTurnPlan }}</p>
      </div>

      <div v-else class="placeholder">开始对局后将在这里显示实时建议。</div>
    </aside>

    <div v-if="deckPreviewOpen" class="deck-modal" @click.self="closeDeckPreview">
      <div class="deck-modal-content">
        <div class="deck-modal-header">
          <h3>{{ deckPreviewTitle }}</h3>
          <button class="ghost" @click="closeDeckPreview">关闭</button>
        </div>
        <div class="deck-card-list">
          <article
            v-for="entry in deckPreviewEntries"
            :key="`${entry.card.id}-${entry.card.name}`"
            class="deck-card-item"
            @mouseenter="(event) => showHoverPreview(entry.card, event as MouseEvent)"
            @mousemove="(event) => moveHoverPreview(event as MouseEvent)"
            @mouseleave="hideHoverPreview"
          >
            <span class="deck-card-cost-badge">{{ entry.card.cost }}</span>
            <img
              v-if="entry.card.cropImageUrl || entry.card.imageUrl"
              class="deck-card-thumb"
              :src="entry.card.cropImageUrl || entry.card.imageUrl"
              :alt="entry.card.name"
            />
            <div v-else class="no-image">无图</div>
            <span v-if="entry.count > 1" class="deck-card-count-badge">×{{ entry.count }}</span>
          </article>
        </div>
      </div>
    </div>

    <div
      v-if="hoverPreviewCard"
      class="deck-hover-floating"
      :style="{
        left: `${hoverPreviewPosition.x}px`,
        top: `${hoverPreviewPosition.y}px`,
      }"
    >
      <img
        :src="hoverPreviewCard.imageUrl || hoverPreviewCard.cropImageUrl"
        :alt="hoverPreviewCard.name"
        class="deck-hover-floating-image"
      />
    </div>
  </main>
</template>

<style scoped>
.match-layout {
  width: min(1500px, 100%);
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1.2fr 0.8fr;
  gap: 18px;
}

.panel {
  backdrop-filter: blur(6px);
  background: rgba(15, 28, 40, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 18px;
  padding: 20px;
}

h2,
h3,
p {
  margin: 0;
}

label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
}

span {
  font-size: 13px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

input,
select,
textarea,
button {
  border-radius: 12px;
  border: 1px solid rgba(155, 206, 255, 0.3);
  background: rgba(8, 18, 28, 0.95);
  color: #f2f8ff;
  padding: 10px 12px;
  font: inherit;
}

.deck-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.inline-actions {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
}

.actions-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 8px;
}

.cta {
  width: 100%;
  background: linear-gradient(120deg, #f0ad3d, #ffcb70);
  color: #181410;
  font-weight: 700;
  cursor: pointer;
}

.secondary {
  width: 100%;
  cursor: pointer;
}

.ghost {
  width: auto;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  background: rgba(255, 255, 255, 0.08);
  color: #f2f8ff;
  cursor: pointer;
}

.error {
  margin-top: 10px;
  color: #ff8f8f;
}

.state-box,
.options-box,
.log-box,
.coach-box,
.placeholder {
  margin-top: 12px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 12px;
  padding: 12px;
}

.chips {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.board-wrap {
  margin-top: 10px;
  display: grid;
  gap: 10px;
}

.board-block {
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  padding: 8px;
  background: rgba(5, 12, 20, 0.35);
}

.board-block.droppable {
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.board-block.droppable.dropping {
  border-color: rgba(130, 215, 255, 0.8);
  box-shadow: inset 0 0 0 1px rgba(130, 215, 255, 0.45);
}

.board-title {
  color: rgba(236, 247, 255, 0.82);
  margin-bottom: 8px;
  font-size: 12px;
}

.minion-lane {
  min-height: 86px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.minion-egg {
  position: relative;
  width: 66px;
  height: 82px;
  border-radius: 34px;
  border: 2px solid rgba(195, 220, 255, 0.55);
  overflow: hidden;
  background: radial-gradient(circle at 40% 25%, rgba(225, 238, 255, 0.2), rgba(43, 79, 120, 0.15));
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12), 0 4px 10px rgba(0, 0, 0, 0.35);
}

.minion-keyword {
  position: absolute;
  top: 4px;
  left: 50%;
  transform: translateX(-50%);
  padding: 0 6px;
  height: 16px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  background: rgba(255, 228, 145, 0.92);
  color: #553100;
  border: 1px solid rgba(95, 60, 10, 0.25);
}

.minion-egg img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.minion-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(235, 246, 255, 0.9);
  font-weight: 700;
}

.minion-stat {
  position: absolute;
  bottom: 2px;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.5);
}

.minion-stat.atk {
  left: 3px;
  background: rgba(210, 64, 39, 0.95);
}

.minion-stat.hp {
  right: 3px;
  background: rgba(56, 150, 77, 0.95);
}

.hero-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-radius: 10px;
  padding: 10px;
  border: 1px solid rgba(255, 255, 255, 0.15);
}

.hero-row.enemy {
  background: rgba(186, 74, 74, 0.2);
}

.hero-row.player {
  margin-top: 8px;
  background: rgba(91, 145, 210, 0.2);
}

.hero-title {
  font-weight: 700;
  margin-bottom: 4px;
}

.turn-banner {
  text-align: center;
  margin-top: 8px;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(255, 215, 145, 0.15);
  border: 1px solid rgba(255, 215, 145, 0.5);
  color: #ffd791;
  font-weight: 700;
}

.hand-title {
  margin-top: 10px;
  color: rgba(235, 246, 255, 0.85);
}

.hand-grid {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.drop-tip {
  margin-top: 6px;
  text-align: center;
  font-size: 11px;
  color: rgba(130, 215, 255, 0.9);
}

.hand-card {
  position: relative;
  width: 68px;
  height: 68px;
  border-radius: 8px;
  border: 1px solid rgba(168, 207, 255, 0.45);
  overflow: hidden;
  background: rgba(255, 255, 255, 0.05);
  cursor: pointer;
}

.hand-card:active {
  opacity: 0.75;
}

.minion-pop-enter-active {
  animation: minion-pop-in 0.28s ease-out;
}

@keyframes minion-pop-in {
  0% {
    transform: translateY(8px) scale(0.88);
    box-shadow: 0 0 0 rgba(130, 215, 255, 0);
    filter: brightness(0.9);
  }
  65% {
    transform: translateY(-2px) scale(1.04);
    box-shadow: 0 0 14px rgba(130, 215, 255, 0.55);
    filter: brightness(1.12);
  }
  100% {
    transform: translateY(0) scale(1);
    box-shadow: 0 0 0 rgba(130, 215, 255, 0);
    filter: brightness(1);
  }
}

.hand-card img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.hand-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(235, 246, 255, 0.92);
  font-weight: 700;
}

.hand-cost {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  background: rgba(15, 33, 61, 0.95);
  color: #7cc3ff;
  border: 1px solid rgba(124, 195, 255, 0.65);
}

.chip {
  padding: 5px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  font-size: 12px;
}

.best-line {
  color: #ffd791;
  margin-bottom: 8px;
}

.mode-line {
  margin-bottom: 8px;
  color: rgba(130, 215, 255, 0.9);
  font-size: 12px;
}

.option-item {
  flex-direction: row;
  gap: 10px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 10px;
  padding: 8px;
}

.option-title {
  font-weight: 700;
}

.option-detail,
.option-meta,
.muted {
  color: rgba(235, 246, 255, 0.78);
}

.coach-summary {
  margin-bottom: 8px;
  color: #ffd791;
}

.log-box ul {
  margin: 8px 0 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.deck-modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 2000;
}

.deck-modal-content {
  width: 188px;
  max-height: calc(100vh - 24px);
  overflow: auto;
  background: linear-gradient(180deg, rgba(21, 28, 39, 0.98), rgba(9, 13, 19, 0.98));
  border: 1px solid rgba(255, 220, 140, 0.18);
  border-radius: 10px;
  padding: 8px;
  box-shadow: 0 16px 44px rgba(0, 0, 0, 0.42);
}

.deck-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  padding: 0 2px;
}

.deck-modal-header h3 {
  font-size: 13px;
  font-weight: 700;
}

.deck-card-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.deck-card-item {
  position: relative;
  overflow: hidden;
  border-radius: 7px;
  border: 1px solid rgba(255, 214, 133, 0.14);
  background:
    linear-gradient(90deg, rgba(0, 0, 0, 0.48) 0%, rgba(0, 0, 0, 0.16) 42%, rgba(255, 255, 255, 0.04) 100%),
    rgba(255, 255, 255, 0.03);
  padding: 3px;
  cursor: pointer;
  transition: transform 0.14s ease, border-color 0.14s ease, box-shadow 0.14s ease;
}

.deck-card-item::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, rgba(255, 193, 87, 0.12), transparent 42%, rgba(255, 255, 255, 0.04));
  opacity: 0.45;
  pointer-events: none;
}

.deck-card-cost-badge,
.deck-card-count-badge {
  position: absolute;
  top: 50%;
  z-index: 3;
  min-width: 24px;
  height: 24px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transform: translateY(-50%);
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
  backdrop-filter: blur(4px);
}

.deck-card-cost-badge {
  left: 6px;
  background: linear-gradient(180deg, rgba(253, 243, 213, 0.98), rgba(228, 197, 112, 0.96));
  color: #5e3b00;
  border: 1px solid rgba(85, 54, 0, 0.35);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.deck-card-count-badge {
  right: 6px;
  padding: 0 7px;
  min-width: 30px;
  background: linear-gradient(180deg, rgba(83, 55, 16, 0.96), rgba(40, 25, 6, 0.96));
  color: #ffcf62;
  border: 1px solid rgba(255, 206, 98, 0.3);
}

.deck-card-thumb {
  width: 100%;
  height: 38px;
  object-fit: cover;
  display: block;
  border-radius: 5px;
  filter: saturate(1.04) contrast(1.02);
}

.no-image {
  width: 100%;
  height: 38px;
  display: flex;
  justify-content: center;
  align-items: center;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 5px;
  color: rgba(255, 255, 255, 0.6);
  font-size: 11px;
}

.deck-card-item:hover {
  transform: translateX(2px);
  border-color: rgba(255, 211, 122, 0.36);
  box-shadow: inset 0 0 0 1px rgba(255, 211, 122, 0.12);
}

.deck-hover-floating {
  position: fixed;
  z-index: 2400;
  width: 280px;
  pointer-events: none;
  filter: drop-shadow(0 22px 36px rgba(0, 0, 0, 0.5));
}

.deck-hover-floating-image {
  width: 100%;
  display: block;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.22);
}

@media (max-width: 1024px) {
  .match-layout,
  .deck-grid,
  .actions-row {
    grid-template-columns: 1fr;
  }
}
</style>
