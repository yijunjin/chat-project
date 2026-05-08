<script setup lang="ts">
import { computed, ref } from 'vue';
import CardGalleryPage from './components/CardGalleryPage.vue';
import GameMatchPage from './components/GameMatchPage.vue';
import LiveGamePage from './components/LiveGamePage.vue';

const activePage = ref<'cards' | 'match' | 'live'>('match');

function switchPage(page: 'cards' | 'match' | 'live') {
  activePage.value = page;
}

const activeComponent = computed(() => {
  if (activePage.value === 'live') return LiveGamePage;
  return activePage.value === 'match' ? GameMatchPage : CardGalleryPage;
});
</script>

<template>
  <div class="page-switch">
    <button class="tab-btn" :class="{ tabActive: activePage === 'match' }" @click="switchPage('match')">游戏对局页面</button>
    <button class="tab-btn" :class="{ tabActive: activePage === 'live' }" @click="switchPage('live')">实时对局</button>
    <button class="tab-btn" :class="{ tabActive: activePage === 'cards' }" @click="switchPage('cards')">卡牌图鉴页面</button>
  </div>

  <KeepAlive>
    <component :is="activeComponent" />
  </KeepAlive>
</template>

<style>
.page-switch {
  width: min(1320px, 100%);
  margin: 0 auto 14px;
  display: flex;
  gap: 10px;
}

.tab-btn {
  width: 100%;
  margin-top: 8px;
  cursor: pointer;
  border-radius: 12px;
  border: 1px solid rgba(155, 206, 255, 0.3);
  background: rgba(8, 18, 28, 0.95);
  color: #f2f8ff;
  padding: 10px 12px;
  font: inherit;
}

.tabActive {
  border-color: rgba(255, 215, 145, 0.9);
  background: rgba(255, 215, 145, 0.12);
}

@media (max-width: 980px) {
  .page-switch {
    width: min(1320px, 100%);
    margin-bottom: 10px;
    flex-direction: column;
  }
}
</style>
