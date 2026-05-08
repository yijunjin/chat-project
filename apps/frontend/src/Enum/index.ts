export const enum MonsterType {
  // 龙
  Dragon = "Dragon",
  // 野兽
  Beast = "Beast",
  // 元素
  Elemental = "Elemental",
  // 机械
  Mech = "Mech",
  // 恶魔
  Demon = "Demon",
  // 海盗
  Pirate = "Pirate",
  // 鱼人
  Murloc = "Murloc",
}

export const enum CardType {
  // 随从
  Minion = "minion",
  // 法术
  Spell = "spell",
  // 武器
  Weapon = "weapon",
  // 地标
  Location = "location",
  // 英雄
  Hero = "hero",
  // 英雄技能
  HeroPower = "hero-power",
  // 幸运币
  Coin = "coin",
}

export const enum Rarity {
  // 免费
  Free = 1,
  // 普通
  Common = 2,
  // 稀有
  Rare = 3,
  // 史诗
  Epic = 4,
  // 传说
  Legendary = 5,
}

// 职业分区展示顺序，按此数组先后排列
export const CLASS_SLUG_ORDER = [
  'deathknight',  // 死亡骑士
  'demonhunter',  // 恶魔猎手
  'druid',        // 德鲁伊
  'hunter',       // 猎人
  'mage',         // 法师
  'paladin',      // 圣骑士
  'priest',       // 牧师
  'rogue',        // 潜行者
  'shaman',       // 萨满
  'warlock',      // 术士
  'warrior',      // 战士
] as const;
