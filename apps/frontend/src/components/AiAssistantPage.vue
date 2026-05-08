<script setup lang="ts">
import { useAiAssistant } from '../composables/useAiAssistant';

const {
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
} = useAiAssistant();
</script>

<template>
  <main class="layout">
    <section class="panel">
      <h2>对局初始化</h2>
      <div class="grid-2">
        <label>
          <span>我方职业</span>
          <select v-if="aiHeroClassOptions.length > 0" v-model="form.heroClass">
            <option v-for="item in aiHeroClassOptions" :key="`my-${item.value}`" :value="item.value">{{ item.label }}</option>
          </select>
          <input v-else v-model="form.heroClass" type="text" />
        </label>
        <label>
          <span>敌方职业</span>
          <select v-if="aiHeroClassOptions.length > 0" v-model="form.enemyClass">
            <option v-for="item in aiHeroClassOptions" :key="`enemy-${item.value}`" :value="item.value">{{ item.label }}</option>
          </select>
          <input v-else v-model="form.enemyClass" type="text" />
        </label>
      </div>

      <div class="grid-2">
        <label>
          <span>策略目标</span>
          <select v-model="form.goal">
            <option v-for="option in goalOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
        <label>
          <span>AI 提供商</span>
          <select v-model="form.provider">
            <option value="google">Google Gemini</option>
            <option value="deepseek">DeepSeek</option>
          </select>
        </label>
      </div>

      <div class="grid-2">
        <label>
          <span>初始我方场面（每行: 名称|攻击|生命|描述）</span>
          <textarea v-model="myBoardText" rows="4" placeholder="例如：水元素|3|6|攻击后冻结" />
        </label>
        <label>
          <span>初始敌方场面（每行: 名称|攻击|生命|描述）</span>
          <textarea v-model="enemyBoardText" rows="4" placeholder="例如：白银之手新兵|1|1|" />
        </label>
      </div>

      <label>
        <span>补充信息</span>
        <textarea v-model="form.notes" rows="3" placeholder="例如：已知奥秘、对手形态、关键牌已交情况" />
      </label>

      <hr style="margin: 16px 0; border: none; border-top: 1px solid #ccc;" />

      <div style="background: #f5f5f5; padding: 12px; border-radius: 4px;">
        <h3 style="margin-top: 0;">使用套牌</h3>
        <label style="display: flex; gap: 8px; align-items: center;">
          <span style="flex-shrink: 0; min-width: 80px;">套牌编码</span>
          <input 
            v-model="form.deckCode" 
            type="text" 
            placeholder="粘贴暴雪套牌编码 (AAECAf0E...)"
            style="flex: 1;"
          />
        </label>
        <p style="font-size: 12px; color: #666; margin-top: 8px;">
          从 Hearthstone Deck Tracker 或暴雪官网复制套牌编码。加载后初始手牌将从套牌中随机抽取。
        </p>
        <button 
          v-if="form.deckCode.trim()"
          :disabled="isLoadingDeck"
          style="background: #f0ad4e; border: 1px solid #ec971f; color: white; padding: 8px 16px; border-radius: 4px; cursor: pointer;"
          @click="loadDeckCards"
        >
          {{ isLoadingDeck ? '加载中...' : `加载套牌 (${deckCards.length} 张卡牌)` }}
        </button>
      </div>

      <div class="actions-row">
        <button class="cta" :disabled="isLoadingOptions" @click="initSimulation">
          {{ isLoadingOptions ? '初始化中...' : '初始化并生成AI选项' }}
        </button>
        <button class="secondary" :disabled="isLoadingRecommendation" @click="getAICoach">
          {{ isLoadingRecommendation ? '分析中...' : '获取AI运营建议' }}
        </button>
      </div>

      <p v-if="errorMsg" class="error">{{ errorMsg }}</p>
    </section>

    <section class="panel">
      <h2>回合模拟</h2>

      <div v-if="gameState" class="state-box">
        <p>回合：T{{ gameState.turn }} | {{ gameState.isPlayerFirst ? '你是先手' : '你是后手' }}</p>
        <p>血量：我方 {{ gameState.myHealth }} / 敌方 {{ gameState.enemyHealth }}</p>
        <p>水晶：我方 {{ gameState.myManaCrystals }} / 敌方 {{ gameState.enemyManaCrystals }}</p>
        <p>手牌：我方 {{ gameState.myHand.length }} / 敌方 {{ gameState.enemyHandCount }}</p>
        <p>硬币：{{ gameState.playerHasCoin ? '我方有' : '我方无' }}</p>

        <div class="chips">
          <span
            v-for="card in gameState.myHand"
            :key="card.id"
            class="chip"
            :title="`${card.name} (${card.cost})\n${card.text}`"
            @mouseenter="(e) => handleCardHover(card, e as MouseEvent)"
            @mouseleave="hideCardPreview"
          >
            {{ card.name }}({{ card.cost }})
          </span>
        </div>

        <div class="board-row">
          <div>
            <p class="mini-title">我方场面</p>
            <div class="chips">
              <span
                v-for="minion in gameState.myBoard"
                :key="minion.id"
                class="chip minion"
                :title="minionTooltip(minion)"
                @mouseenter="(e) => handleMinionHover(minion, e as MouseEvent)"
                @mouseleave="hideCardPreview"
              >
                {{ minion.name }} {{ minion.attack }}/{{ minion.health }}
              </span>
            </div>
          </div>
          <div>
            <p class="mini-title">敌方场面</p>
            <div class="chips">
              <span
                v-for="minion in gameState.enemyBoard"
                :key="minion.id"
                class="chip minion"
                :title="minionTooltip(minion)"
                @mouseenter="(e) => handleMinionHover(minion, e as MouseEvent)"
                @mouseleave="hideCardPreview"
              >
                {{ minion.name }} {{ minion.attack }}/{{ minion.health }}
              </span>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="placeholder">尚未初始化对局。</div>

      <div v-if="turnOptions.length > 0" class="options-box">
        <h3>AI 回合选项</h3>
        <p v-if="bestOption" class="best-line">最优推荐：{{ bestOption.title }}</p>
        <p v-if="gameResult.isGameOver" class="best-line">对局已结束，请重新初始化。</p>

        <label v-for="option in turnOptions" :key="option.id" class="option-item">
          <input v-model="selectedOptionId" type="radio" name="option" :value="option.id" />
          <div>
            <p class="option-title">
              {{ option.title }}
              <span v-if="option.isBest" class="best-tag">最优推荐</span>
            </p>
            <p class="option-detail">{{ option.detail }}</p>
            <p class="option-expected">预期：{{ option.expected }} · 风险：{{ option.risk }}</p>
          </div>
        </label>

        <button class="cta" :disabled="isSimulating || !selectedOptionId || gameResult.isGameOver" @click="runSelectedTurn">
          {{ isSimulating ? '模拟中...' : '执行本回合并推进' }}
        </button>
      </div>

      <div class="log-box">
        <h3>对局日志</h3>
        <ul>
          <li v-for="(line, index) in battleLog" :key="index">{{ line }}</li>
        </ul>
      </div>

      <div v-if="recommendation" class="coach-box">
        <h3>AI 辅助建议</h3>
        <p>风险等级：{{ riskText }}</p>
        <p>{{ recommendation.summary }}</p>
        <p>运营主线：{{ recommendation.operationStrategy.corePlan }}</p>
        <p>资源计划：{{ recommendation.operationStrategy.economyPlan }}</p>
      </div>
    </section>

    <!-- 卡牌预览浮层 -->
    <div
      v-if="cardPreview"
      class="card-preview"
      :style="{
        left: previewPosition.x + 'px',
        top: previewPosition.y + 'px',
      }"
    >
      <div v-if="previewLoading" class="card-preview-loading">加载中...</div>
      <div v-else class="card-preview-content">
        <img
          v-if="cardPreview.imageUrl"
          :src="cardPreview.imageUrl"
          :alt="cardPreview.name"
          class="card-image"
        />
        <div v-else-if="cardPreview.raw?.image" class="card-no-image">
          {{ cardPreview.name }}
        </div>
        <div class="card-info">
          <p class="card-name">{{ cardPreview.name }}</p>
          <p v-if="cardPreview.cardLevel" class="card-rarity">{{ cardPreview.cardLevel }}</p>
          <p v-if="cardPreview.flavorText" class="card-flavor">{{ cardPreview.flavorText }}</p>
        </div>
      </div>
    </div>
  </main>
</template>

<style scoped>
.layout {
  width: min(1480px, 100%);
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1.1fr 1fr;
  gap: 20px;
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

.grid-2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.actions-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.cta {
  width: 100%;
  margin-top: 8px;
  background: linear-gradient(120deg, #f0ad3d, #ffcb70);
  color: #181410;
  font-weight: 700;
  cursor: pointer;
}

.secondary {
  width: 100%;
  margin-top: 8px;
  cursor: pointer;
}

.error {
  color: #ff8f8f;
  margin-top: 10px;
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
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.chip {
  padding: 5px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  font-size: 12px;
}

.minion {
  background: rgba(240, 173, 61, 0.22);
}

.mini-title {
  margin-top: 10px;
  color: rgba(235, 246, 255, 0.78);
}

.board-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
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

.best-line {
  color: #ffd791;
  margin-bottom: 8px;
}

.best-tag {
  font-size: 11px;
  padding: 2px 6px;
  margin-left: 8px;
  border-radius: 999px;
  background: #ffd791;
  color: #402700;
}

.option-detail,
.option-expected {
  color: rgba(235, 246, 255, 0.78);
}

.log-box ul {
  margin: 8px 0 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.card-preview {
  position: fixed;
  pointer-events: none;
  z-index: 9999;
  transform: translate(-50%, -100%);
}

.card-preview-loading {
  /* background: rgba(15, 28, 40, 0.95); */
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 12px;
  padding: 20px;
  color: #f2f8ff;
  text-align: center;
  min-width: 120px;
}

.card-preview-content {
  /* background: rgba(15, 28, 40, 0.95); */
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 12px;
  overflow: hidden;
  /* box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3); */
  max-width: 280px;
}

.card-image {
  width: 100%;
  height: auto;
  display: block;
  max-height: 360px;
  object-fit: cover;
}

.card-no-image {
  background: rgba(100, 100, 100, 0.3);
  padding: 60px 20px;
  text-align: center;
  color: #f2f8ff;
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.card-info {
  padding: 12px;
  background: rgba(8, 18, 28, 0.8);
}

.card-name {
  font-weight: 700;
  color: #ffd791;
  margin-bottom: 4px;
}

.card-rarity {
  font-size: 11px;
  color: rgba(235, 246, 255, 0.6);
  margin-bottom: 4px;
}

.card-flavor {
  font-size: 11px;
  color: rgba(235, 246, 255, 0.5);
  font-style: italic;
  line-height: 1.4;
}

@media (max-width: 980px) {
  .layout,
  .grid-2,
  .actions-row,
  .board-row {
    grid-template-columns: 1fr;
  }
}
</style>
