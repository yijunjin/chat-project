import { CardType, Rarity } from '../Enum';

export { CardType, Rarity };

export type StrategyGoal = 'tempo' | 'survival' | 'burst' | 'value';

export interface HearthstoneCard {
  id: string;
  slug?: string;
  name: string;
  cost: number;
  text: string;
  type: CardType;
  imageUrl?: string;
  cropImageUrl?: string;
  flavorText?: string;
  artistName?: string;
  classId?: number;
  className?: string;
  cardSetId?: number;
  cardSetName?: string;
  rarityId?: number;
  rarityName?: string;
  collectible?: boolean;
  craftingCost?: number;
  dustValue?: number;
  minionTypeId?: number;
  minionTypeName?: string;
  cardTypeId?: number;
  childIds?: string[];
}

export interface HearthstoneMinion {
  id: string;
  name: string;
  attack: number;
  health: number;
  maxHealth: number;
  keywords?: string[];
  description?: string;
}

export interface HearthstoneRecommendRequest {
  heroClass: string;
  enemyClass: string;
  myHealth: number;
  enemyHealth: number;
  myManaCrystals: number;
  enemyManaCrystals: number;
  myHand: HearthstoneCard[];
  myBoard: HearthstoneMinion[];
  enemyBoard: HearthstoneMinion[];
  goal: StrategyGoal;
  notes?: string;
  provider?: 'deepseek' | 'google';
}

export interface HearthstoneAction {
  step: number;
  title: string;
  detail: string;
  reason: string;
  confidence: number;
}

export interface LiveLethalInfo {
  lethalNow: boolean;
  lethalInTwoTurns: boolean;
  myBoardAttack: number;
  estimatedHandBurst: number;
  estimatedTotalDamage: number;
}

export interface HearthstoneRecommendResponse {
  summary: string;
  risk: 'low' | 'medium' | 'high';
  actions: HearthstoneAction[];
  nextTurnPlan: string;
  operationStrategy: {
    corePlan: string;
    economyPlan: string;
    keyCardsToKeep: string[];
    avoidPlays: string[];
  };
  aiMeta: {
    provider: string;
    mode: 'llm' | 'fallback-rule';
  };
}

export interface LiveRecommendationEnvelope extends HearthstoneRecommendResponse {
  confidence: number;
  goal: StrategyGoal;
  lethal: LiveLethalInfo;
  aiMeta: {
    provider: string;
    mode: 'llm' | 'fallback-rule';
    latencyMs: number;
    generationId: number;
    cacheKey: string;
  };
}

export interface HearthstoneGameState {
  turn: number;
  isPlayerFirst: boolean;
  playerHasCoin: boolean;
  heroClass: string;
  enemyClass: string;
  myHealth: number;
  enemyHealth: number;
  myManaCrystals: number;
  enemyManaCrystals: number;
  myHand: HearthstoneCard[];
  enemyHandCount: number;
  myBoard: HearthstoneMinion[];
  enemyBoard: HearthstoneMinion[];
  goal: StrategyGoal;
  notes?: string;
}

export interface HearthstoneTurnOption {
  id: 'control' | 'burst' | 'develop';
  title: string;
  detail: string;
  expected: string;
  risk: 'low' | 'medium' | 'high';
  isBest: boolean;
}

export interface HearthstoneTurnOptionsResponse {
  options: HearthstoneTurnOption[];
  aiMeta: {
    provider: string;
    mode: 'llm' | 'fallback-rule';
  };
}

export interface HearthstoneSimulateTurnResponse {
  updatedState: HearthstoneGameState;
  playerActionSummary: string;
  enemyActionSummary: string;
  randomEvents: string[];
  actionTrace: Array<{
    source: string;
    target: string;
    effect: string;
  }>;
  gameResult: {
    isGameOver: boolean;
    winner: 'player' | 'enemy' | 'none';
  };
  nextOptions: HearthstoneTurnOption[];
}

export interface HearthstoneSimulateTurnRequest {
  state: HearthstoneGameState;
  optionId: HearthstoneTurnOption['id'];
  selectedOption?: HearthstoneTurnOption;
  provider?: 'deepseek' | 'google';
}

export interface HearthstoneCardSearchRequest {
  query?: string;
  class?: string;
  cardSet?: 'standard' | 'wild';
  type?: CardType.Spell | CardType.Minion | CardType.Weapon | CardType.Location | CardType.Hero;
  manaCost?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
  locale?: string;
}

export interface HearthstoneCardSearchResponse {
  cards: HearthstoneCard[];
  source: 'blizzard' | 'fallback';
}

export interface HearthstoneCardDetailField {
  key: string;
  value: string;
}

export interface HearthstoneRelatedCard {
  id: string;
  name: string;
  cost: number;
  cropImageUrl?: string;
  imageUrl?: string;
}

export interface HearthstoneCardDetailResponse {
  cardId: string;
  slug: string;
  name: string;
  imageUrl?: string;
  flavorText: string;
  cardLevel: string;
  artistName: string;
  relatedCards: HearthstoneRelatedCard[];
  details: HearthstoneCardDetailField[];
  raw: Record<string, unknown>;
  source: 'blizzard' | 'fallback';
}

export interface HearthstoneMetadataClass {
  id: number;
  slug: string;
  name: string;
}

export interface HearthstoneMetadataSet {
  id: number;
  slug: string;
  name: string;
}

export interface HearthstoneMetadataResponse {
  classes: HearthstoneMetadataClass[];
  sets: HearthstoneMetadataSet[];
  source: 'blizzard' | 'fallback';
}

// ─── Live Game Types ──────────────────────────────────────────────────────────

export type GameStatus = 'idle' | 'mulligan' | 'playing' | 'game_over';

export interface LiveGameEvent {
  type: 'state_update' | 'my_turn_start' | 'game_start' | 'game_over';
  gameStatus: GameStatus;
  isMyTurn: boolean;
  isPlayerFirst: boolean | null;
  playerHasCoin: boolean | null;
  turnNumber: number;
  playerName: string;
  opponentName: string;
  myPlayerId: number | null;
  myHeroHp: number;
  myHeroArmor: number;
  myMana: number;
  myMaxMana: number;
  opponentMana: number;
  opponentMaxMana: number;
  myHandCount: number;
  myHand: Array<{ entityId: number; cardId: string; name: string; cost: number; attack: number; health: number; type: string }>;
  myBoard: Array<{ entityId: number; cardId: string; name: string; type: string; attack: number; health: number; maxHealth: number; exhausted: boolean; cooldown: number | null }>;
  opponentHeroHp: number;
  opponentHeroArmor: number;
  opponentHandCount: number;
  opponentBoard: Array<{ entityId: number; cardId: string; name: string; type: string; attack: number; health: number; maxHealth: number; cooldown: number | null }>;
  myHeroCardId?: string;
  opponentHeroCardId?: string;
  autoRecommendation?: string;
  recommendation?: LiveRecommendationEnvelope;
}

export interface HearthstoneOpeningHandRequest {
  heroClass: string;
  isPlayerFirst: boolean;
  locale?: string;
}

export interface HearthstoneOpeningHandResponse {
  cards: HearthstoneCard[];
  source: 'blizzard' | 'fallback';
}

export interface HearthstoneDeckRequest {
  code: string;
  locale?: string;
}

export interface HearthstoneDeckResponse {
  cards: HearthstoneCard[];
  hero?: string;
  source: 'blizzard' | 'fallback';
}

export type ReplayActionKind =
  | 'turn_start'
  | 'play'
  | 'attack'
  | 'spell'
  | 'power'
  | 'damage'
  | 'other';

export interface ReplayAction {
  index: number;
  kind: ReplayActionKind;
  side: 'me' | 'opponent' | 'unknown';
  actor: string;
  target?: string;
  cardId?: string;
  cardName?: string;
  damage?: number;
  spawned?: string[];
  damageEvents?: { entity: string; damage: number }[];
  deaths?: string[];
  raw: string;
}

export interface ReplayTurn {
  turnNumber: number;
  actions: ReplayAction[];
  actionCount: number;
  myActionCount: number;
  opponentActionCount: number;
}

export interface ReplaySessionSummary {
  sessionId: string;
  startedAt: string;
  updatedAt: string;
  hasPowerLog: boolean;
  sizeBytes: number;
}

export interface ReplaySessionDetail {
  session: ReplaySessionSummary;
  turns: ReplayTurn[];
  totalActions: number;
}

export interface ReplayTurnAiDebugResponse {
  sessionId: string;
  turnNumber: number;
  source: 'my_turn_snapshot' | 'state_snapshot';
  snapshot: LiveGameEvent;
  request: HearthstoneRecommendRequest;
  recommendation: LiveRecommendationEnvelope;
}