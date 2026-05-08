<script setup lang="ts">
import { onMounted } from 'vue';
import { useCardGallery } from '../composables/useCardGallery';

const {
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
} = useCardGallery();

onMounted(() => {
  if (searchedCards.value.length === 0) {
    void doCardSearch();
  }
});
</script>

<template>
  <main class="gallery-layout">
    <section class="panel">
      <h2>卡牌图鉴</h2>

      <div class="grid-2">
        <label>
          <span>关键词</span>
          <input
            v-model="cardSearchKeyword"
            type="text"
            placeholder="输入卡牌名关键字，按回车搜索"
            @keyup.enter="doCardSearch"
          />
        </label>
        <label>
          <span>职业</span>
          <select v-model="cardHeroClassFilter" @change="onSearchControlChange">
            <option v-for="item in heroClassOptions" :key="item.label" :value="item.value">{{ item.label }}</option>
          </select>
        </label>
      </div>

      <div class="grid-3">
        <label>
          <span>卡牌类型</span>
          <select v-model="cardTypeFilter" @change="onSearchControlChange">
            <option v-for="item in cardTypeOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
        </label>
        <label>
          <span>卡池模式</span>
          <select v-model="cardSetFilter" @change="onSearchControlChange">
            <option v-for="item in cardSetOptions" :key="`set-${item.value}`" :value="item.value">{{ item.label }}</option>
          </select>
        </label>
        <label>
          <span>费用筛选</span>
          <select v-model="cardCostFilter" @change="onSearchControlChange">
            <option value="all">全部费用</option>
            <option :value="0">0 费</option>
            <option :value="1">1 费</option>
            <option :value="2">2 费</option>
            <option :value="3">3 费</option>
            <option :value="4">4 费</option>
            <option :value="5">5 费</option>
            <option :value="6">6 费</option>
            <option :value="7">7 费</option>
            <option :value="8">8 费</option>
            <option :value="9">9 费</option>
            <option value="10+">10+ 费</option>
          </select>
        </label>
        <label>
          <span>每页数量</span>
          <select v-model.number="cardPageSize" @change="onSearchControlChange">
            <option :value="450">450</option>
          </select>
        </label>
      </div>

      <div class="actions-row">
        <button class="search-btn" :disabled="isSearchingCards" @click="doCardSearch">
          {{ isSearchingCards ? '搜索中...' : '搜索卡牌' }}
        </button>
        <div class="pager">
          <button class="secondary pager-btn" :disabled="isSearchingCards || cardPage <= 1" @click="changeCardPage(-1)">上一页</button>
          <span class="pager-text">第 {{ cardPage }} 页</span>
          <button class="secondary pager-btn" :disabled="isSearchingCards" @click="changeCardPage(1)">下一页</button>
        </div>
      </div>

      <p class="tip">查询到 {{ searchedCards.length }} 张卡牌</p>
      <p v-if="isSearchingCards" class="tip">正在加载卡牌...</p>
      <p v-else-if="filteredSearchedCards.length === 0" class="tip">暂无结果。</p>
      <template v-else>
        <section
          v-for="group in groupedCards"
          :key="group.classId ?? 'neutral'"
          class="class-group"
        >
          <div class="class-group-header">
            <span class="class-group-divider"></span>
            <span class="class-group-title">{{ group.className }}</span>
            <span class="class-group-divider"></span>
          </div>
          <div class="card-grid">
            <article
              v-for="card in group.cards"
              :key="card.id"
              class="card-item"
              @mousemove="handleCardHoverMove($event)"
              @mouseleave="resetCardHoverEffect($event)"
              @click="openCardZoom(card, $event)"
            >
              <div v-if="card.imageUrl" class="card-thumb-wrap">
                <img :src="card.imageUrl" :alt="card.name" class="card-thumb" />
              </div>
              <div v-else class="card-thumb-fallback">
                <p class="card-name">{{ card.name }}</p>
                <p class="card-meta">暂无官方图</p>
              </div>
            </article>
          </div>
        </section>
      </template>
    </section>
  </main>

  <div
    v-if="zoomPreview"
    class="zoom-overlay"
    @contextmenu.prevent="e => e.stopPropagation()"
  >
    <button class="zoom-close-btn" @click.stop="closeCardZoom">×</button>
    <button class="zoom-nav-btn zoom-nav-prev" :disabled="!canZoomPrev" @click.stop="openAdjacentZoomCard(-1, $event)">‹</button>
    <button class="zoom-nav-btn zoom-nav-next" :disabled="!canZoomNext" @click.stop="openAdjacentZoomCard(1, $event)">›</button>
    <div
      class="zoom-card"
      @click.stop
    >
      <div class="zoom-content">
        <div
          class="zoom-image-wrap"
          @mousemove="handleCardHoverMove($event)"
          @mouseleave="resetCardHoverEffect($event)"
        >
          <img :src="zoomPreview.card.imageUrl" :alt="zoomPreview.card.name" class="zoom-image" />
        </div>

        <aside class="zoom-detail-panel">
          <p class="zoom-title">{{ zoomDetail?.name || zoomPreview.card.name }}</p>
          <p v-if="zoomDetail?.flavorText" class="zoom-flavor">{{ zoomDetail.flavorText }}</p>

          <p v-if="zoomDetailLoading" class="zoom-tip">正在加载卡牌详情...</p>
          <p v-else-if="zoomDetailError" class="zoom-tip error">{{ zoomDetailError }}</p>

          <template v-else-if="zoomDetail">
            <p v-if="detailValue(['text']) !== '-'" class="zoom-card-text">{{ detailValue(['text']) }}</p>

            <ul class="zoom-props-list">
              <li v-if="resolveCardType() !== '-'">
                <strong>类型:</strong> {{ resolveCardType() }}
              </li>
              <li v-if="detailValue(['minionTypeName', 'minionTypeId']) !== '-'">
                <strong>随从类型:</strong> {{ detailValue(['minionTypeName', 'minionTypeId']) }}
              </li>
              <li v-if="resolveRarity() !== '-'">
                <strong>稀有度:</strong> {{ resolveRarity() }}
              </li>
              <li v-if="resolveSetName() !== '-'">
                <strong>拓展包:</strong> {{ resolveSetName() }}
              </li>
              <li v-if="resolveClassName() !== '-'">
                <strong>职业:</strong> {{ resolveClassName() }}
              </li>
              <li v-if="detailValue(['craftingCost']) !== '-'">
                <strong>费用:</strong> {{ detailValue(['craftingCost']) }}
              </li>
              <li v-if="detailValue(['dustValue']) !== '-'">
                <strong>分解:</strong> {{ detailValue(['dustValue']) }}
              </li>
              <li v-if="zoomDetail.artistName && zoomDetail.artistName !== '-'">
                <strong>画师:</strong> <span class="artist-link">{{ zoomDetail.artistName }}</span>
              </li>
            </ul>

            <div v-if="zoomDetail.relatedCards.length > 0" class="zoom-related-section">
              <p class="zoom-related-label">相关卡牌:</p>
              <div class="zoom-related-names">
                <span
                  v-for="item in zoomDetail.relatedCards"
                  :key="`rel-${item.id}`"
                  class="related-name-wrap"
                  @mouseenter="showRelatedCardPreview(item)"
                  @mouseleave="hideRelatedCardPreview"
                >
                  <span class="related-name-link">{{ item.name }}</span>
                  <div v-if="relatedCardPreview?.id === item.id && relatedCardPreview.imageUrl" class="related-card-preview">
                    <img
                      :src="relatedCardPreview.imageUrl"
                      :alt="relatedCardPreview.name"
                      class="related-card-preview-image"
                    >
                  </div>
                </span>
              </div>
            </div>
          </template>
        </aside>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gallery-layout {
  width: min(1680px, 100%);
  margin: 0 auto;
  display: block;
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

.grid-3 {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.actions-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.pager {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.pager-btn {
  margin-top: 0;
  width: auto;
}

.pager-text {
  font-size: 12px;
  color: rgba(235, 246, 255, 0.82);
}

.secondary {
  width: 100%;
  margin-top: 8px;
  cursor: pointer;
}

.search-btn {
  width: 100%;
  margin-top: 8px;
  cursor: pointer;
  border-radius: 12px;
  border: 1px solid rgba(255, 215, 145, 0.85);
  background: linear-gradient(120deg, rgba(255, 215, 145, 0.28), rgba(255, 180, 90, 0.22));
  color: #ffe9c2;
  font-weight: 700;
}

.error {
  color: #ff8f8f;
  margin-top: 10px;
}

.tip {
  margin-top: 8px;
  color: rgba(235, 246, 255, 0.75);
}

.class-group {
  margin-top: 24px;
}

.class-group-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.class-group-divider {
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(200, 170, 100, 0.6), transparent);
}

.class-group-title {
  flex-shrink: 0;
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: #e8c97a;
  text-shadow: 0 0 8px rgba(232, 201, 122, 0.5);
  padding: 4px 16px;
  border: 1px solid rgba(200, 170, 100, 0.4);
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.3);
}

.card-grid {
  margin-top: 10px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 10px;
}

.card-item {
  --card-rotate-x: 0deg;
  --card-rotate-y: 0deg;
  --card-scale: 1;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 6px;
  background: rgba(255, 255, 255, 0.03);
  perspective: 1200px;
}

.card-name {
  font-weight: 700;
}

.card-meta {
  margin-top: 4px;
  font-size: 12px;
  color: rgba(235, 246, 255, 0.75);
}

.card-thumb-wrap {
  width: 100%;
  background: transparent;
}

.card-thumb {
  display: block;
  width: 100%;
  aspect-ratio: 1 / 1.4;
  object-fit: contain;
  transform: rotateX(var(--card-rotate-x)) rotateY(var(--card-rotate-y)) scale3d(var(--card-scale), var(--card-scale), var(--card-scale));
  transform-origin: center center;
  transition: transform 300ms ease, filter 300ms ease;
  will-change: transform;
  backface-visibility: hidden;
}

.card-item:hover .card-thumb {
  filter: brightness(1.05) drop-shadow(0 16px 24px rgba(0, 0, 0, 0.32));
}

.card-thumb-fallback {
  width: 100%;
  min-height: 150px;
  border-radius: 8px;
  padding: 12px;
  background: radial-gradient(circle at top right, rgba(255, 215, 145, 0.24), rgba(8, 18, 28, 0.95));
}

.zoom-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.64);
  backdrop-filter: blur(4px);
}

.zoom-card {
  position: relative;
  width: min(900px, 96vw);
  max-height: 92vh;
  border-radius: 16px;
  overflow: hidden;
}

.zoom-close-btn {
  position: absolute;
  top: 16px;
  right: 20px;
  z-index: 40;
  width: 34px;
  height: 34px;
  border-radius: 999px;
  border: 1px solid rgba(255, 215, 145, 0.8);
  background: rgba(12, 20, 30, 0.86);
  color: #ffd891;
  font-size: 22px;
  line-height: 1;
  padding: 0;
  cursor: pointer;
}

.zoom-nav-btn {
  position: absolute;
  top: 50%;
  z-index: 35;
  width: 44px;
  height: 64px;
  border-radius: 12px;
  border: 1px solid rgba(255, 215, 145, 0.8);
  background: rgba(12, 20, 30, 0.8);
  color: #ffd891;
  font-size: 32px;
  line-height: 1;
  padding: 0;
  transform: translateY(-50%);
  cursor: pointer;
}

.zoom-nav-prev {
  left: calc(50% - 500px);
}

.zoom-nav-next {
  right: calc(50% - 500px);
}

.zoom-nav-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.zoom-content {
  display: grid;
  grid-template-columns: minmax(260px, 380px) 1fr;
  gap: 0;
  max-height: 92vh;
}

.zoom-image-wrap {
  --card-rotate-x: 0deg;
  --card-rotate-y: 0deg;
  --card-scale: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  perspective: 1200px;
}

.zoom-image {
  display: block;
  width: 100%;
  aspect-ratio: 1 / 1.4;
  object-fit: contain;
  transform: rotateX(var(--card-rotate-x)) rotateY(var(--card-rotate-y)) scale3d(var(--card-scale), var(--card-scale), var(--card-scale));
  transform-origin: center center;
  transition: transform 300ms ease, filter 300ms ease;
  will-change: transform;
}

.zoom-image-wrap:hover .zoom-image {
  filter: brightness(1.04);
}

.zoom-detail-panel {
  border-left: 1px solid rgba(255, 255, 255, 0.12);
  padding: 20px 24px;
  overflow-y: auto;
}

.zoom-title {
  font-size: 22px;
  font-weight: 700;
  color: #fff;
  letter-spacing: 0.01em;
  margin: 0;
}

.zoom-flavor {
  margin-top: 8px;
  color: rgba(235, 246, 255, 0.75);
  font-size: 14px;
  line-height: 1.55;
}

.zoom-tip {
  margin-top: 12px;
  font-size: 13px;
  color: rgba(235, 246, 255, 0.82);
}

.zoom-card-text {
  margin-top: 14px;
  font-size: 14px;
  line-height: 1.65;
  color: rgba(235, 246, 255, 0.95);
  white-space: pre-wrap;
}

.zoom-props-list {
  margin-top: 16px;
  list-style: disc;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.zoom-props-list li {
  font-size: 13px;
  color: rgba(235, 246, 255, 0.85);
  line-height: 1.5;
}

.zoom-props-list strong {
  color: #fff;
  font-weight: 600;
}

.artist-link {
  color: #6bbfff;
}

.zoom-related-section {
  position: relative;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.14);
}

.zoom-related-label {
  font-size: 13px;
  font-weight: 600;
  color: rgba(235, 246, 255, 0.85);
  margin: 0 0 8px;
}

.zoom-related-names {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
}

.related-name-wrap {
  position: relative;
  display: inline-flex;
}

.related-name-link {
  color: #6bbfff;
  font-size: 13px;
  cursor: pointer;
  padding: 2px 0;
  text-decoration: underline;
  text-decoration-color: rgba(107, 191, 255, 0.5);
  font-family: inherit;
}

.related-name-link:hover {
  color: #a8d8ff;
}

.related-card-preview {
  position: absolute;
  left: 0;
  bottom: 12px;
  z-index: 20;
  width: min(240px, 32vw);
  padding: 8px;
  border-radius: 18px;
  pointer-events: none;
}

.related-card-preview-image {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 14px;
}

@media (max-width: 980px) {
  .grid-2,
  .grid-3,
  .actions-row,
  .card-grid {
    grid-template-columns: 1fr;
  }

  .pager {
    justify-content: flex-start;
  }
}

@media (max-width: 780px) {
  .zoom-content {
    grid-template-columns: 1fr;
  }

  .zoom-detail-panel {
    border-left: 0;
    border-top: 1px solid rgba(255, 255, 255, 0.12);
    max-height: 44vh;
  }

  .related-card-preview {
    left: 50%;
    bottom: calc(100% + 12px);
    width: min(220px, 72vw);
    transform: translateX(-50%);
  }

  .zoom-nav-btn {
    width: 38px;
    height: 56px;
    font-size: 28px;
  }
}
</style>
