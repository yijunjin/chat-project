import { EventEmitter } from 'events';
import type { PowerLogEvent } from '../parsers/power-log.parser';
import type { GameStatus, LiveGameEvent } from '../types/hearthstone';

interface PlayerRecord {
  playerId: number;
  playerName: string;
  /** EntityID of the Player entity (EntityID=2 / 3) */
  entityId: number | null;
  tags: Record<string, string>;
}

interface EntitySnapshot {
  id: number;
  cardId: string;
  displayName: string;
  tags: Record<string, string>;
}

const TAG = {
  ZONE: 'ZONE',
  CONTROLLER: 'CONTROLLER',
  CARDTYPE: 'CARDTYPE',
  FIRST_PLAYER: 'FIRST_PLAYER',
  LOCATION_ACTION_COOLDOWN: 'LOCATION_ACTION_COOLDOWN',
  HEALTH: 'HEALTH',
  DAMAGE: 'DAMAGE',
  ATK: 'ATK',
  COST: 'COST',
  ARMOR: 'ARMOR',
  EXHAUSTED: 'EXHAUSTED',
  RESOURCES: 'RESOURCES',
  RESOURCES_USED: 'RESOURCES_USED',
  TURN: 'TURN',
  CURRENT_PLAYER: 'CURRENT_PLAYER',
  PLAYER_ID: 'PLAYER_ID',
  PLAYSTATE: 'PLAYSTATE',
  STEP: 'STEP',
  STATE: 'STATE',
  ZONE_POSITION: 'ZONE_POSITION',
};

const ZONE = {
  DECK: 'DECK',
  HAND: 'HAND',
  PLAY: 'PLAY',
  GRAVEYARD: 'GRAVEYARD',
  SETASIDE: 'SETASIDE',
};

const CARDTYPE = {
  PLAYER: 'PLAYER',
  HERO: 'HERO',
  MINION: 'MINION',
  LOCATION: 'LOCATION',
  SPELL: 'SPELL',
  WEAPON: 'WEAPON',
  HERO_POWER: 'HERO_POWER',
  GAME: 'GAME',
};

export class GameStateMachine extends EventEmitter {
  private entities = new Map<number, EntitySnapshot>();
  /** PlayerID (1 or 2) → PlayerRecord */
  private byPlayerId = new Map<number, PlayerRecord>();
  /** Entity ID (2 or 3) → PlayerRecord */
  private byEntityId = new Map<number, PlayerRecord>();

  private myPlayerEntityId: number | null = null;
  private myPlayerName: string;

  private currentTurn = 0;
  private currentPlayerEntityId: number | null = null;
  private gameStatus: GameStatus = 'idle';

  /** When true, no SSE events are emitted (used during initial log replay) */
  private silentMode = false;
  /** Pending debounce timer for state_update events */
  private debounceTimer: ReturnType<typeof setImmediate> | null = null;

  constructor(myPlayerName: string) {
    super();
    this.myPlayerName = myPlayerName;
  }

  private normalizePlayerName(name: string): string {
    return name
      .replace(/#\d+$/u, '')
      .replace(/\s+/g, '')
      .trim()
      .toLowerCase();
  }

  private isNamedEntityRef(entityRef: string): boolean {
    const trimmed = entityRef.trim();
    return trimmed !== '' && trimmed !== 'GameEntity' && !/^\d+$/.test(trimmed) && !trimmed.startsWith('[');
  }

  private findPlayerRecByName(name: string): PlayerRecord | null {
    const normalized = this.normalizePlayerName(name);
    for (const rec of this.byPlayerId.values()) {
      if (rec.playerName && this.normalizePlayerName(rec.playerName) === normalized) {
        return rec;
      }
    }
    return null;
  }

  private findUnknownPlayerRec(): PlayerRecord | null {
    for (const rec of this.byPlayerId.values()) {
      if (!rec.playerName || rec.playerName === 'UNKNOWN HUMAN PLAYER') {
        return rec;
      }
    }
    return null;
  }

  private tryInferMyPlayerEntity(): void {
    if (this.myPlayerEntityId !== null) return;
    if (!this.myPlayerName.trim()) return;
    if (this.findPlayerRecByName(this.myPlayerName)) return;
    const unknown = this.findUnknownPlayerRec();
    if (unknown?.entityId !== null && unknown?.entityId !== undefined) {
      this.myPlayerEntityId = unknown.entityId;
    }
  }

  private resolveEntityId(entityRef: string): number | null {
    const trimmed = entityRef.trim();
    if (trimmed === 'GameEntity') return 1;
    if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);

    const bracketIdMatch = trimmed.match(/\bid=(\d+)\b/);
    if (bracketIdMatch) return parseInt(bracketIdMatch[1], 10);

    const entityIdMatch = trimmed.match(/\bEntityID=(\d+)\b/);
    if (entityIdMatch) return parseInt(entityIdMatch[1], 10);

    const namedRec = this.findPlayerRecByName(trimmed);
    if (namedRec?.entityId !== null && namedRec?.entityId !== undefined) {
      return namedRec.entityId;
    }

    if (this.normalizePlayerName(trimmed) === this.normalizePlayerName(this.myPlayerName)) {
      return this.myPlayerEntityId;
    }

    const unknown = this.findUnknownPlayerRec();
    if (unknown?.entityId !== null && unknown?.entityId !== undefined) {
      return unknown.entityId;
    }

    const opponentRec = Array.from(this.byPlayerId.values()).find(
      (rec) => rec.entityId !== null && rec.entityId !== this.myPlayerEntityId,
    );
    return opponentRec?.entityId ?? null;
  }

  private assignPlayerName(entityId: number | null, playerName: string): void {
    if (entityId === null || !this.isNamedEntityRef(playerName)) return;
    const rec = this.byEntityId.get(entityId);
    if (!rec) return;
    if (!rec.playerName || rec.playerName === 'UNKNOWN HUMAN PLAYER') {
      rec.playerName = playerName.trim();
    }
    if (this.normalizePlayerName(playerName) === this.normalizePlayerName(this.myPlayerName)) {
      this.myPlayerEntityId = entityId;
    }
  }

  private isPlayerEntity(entityId: number, entity: EntitySnapshot | undefined): boolean {
    if (!entity) return entityId === 2 || entityId === 3;
    return entity.tags[TAG.CARDTYPE] === CARDTYPE.PLAYER || entityId === 2 || entityId === 3;
  }

  private extractCardIdFromEntityRef(entityRef: string): string | null {
    if (!entityRef.startsWith('[')) return null;
    const m = entityRef.match(/\bcardId=([^\s\]]*)/);
    if (!m) return null;
    const cardId = (m[1] ?? '').trim();
    return cardId || null;
  }

  private extractEntityNameFromEntityRef(entityRef: string): string | null {
    if (!entityRef.startsWith('[')) return null;
    const m = entityRef.match(/\bentityName=(.+?)\sid=\d+/);
    if (!m) return null;
    const name = (m[1] ?? '').trim();
    if (!name || name.startsWith('UNKNOWN ENTITY')) return null;
    return name;
  }

  reset(): void {
    this.entities.clear();
    this.byPlayerId.clear();
    this.byEntityId.clear();
    this.myPlayerEntityId = null;
    this.currentTurn = 0;
    this.currentPlayerEntityId = null;
    this.gameStatus = 'idle';
    if (this.debounceTimer !== null) {
      clearImmediate(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  setSilent(silent: boolean): void {
    this.silentMode = silent;
  }

  /** Emit state_update with debounce — batches rapid tag-change floods into one event */
  private scheduleStateUpdate(): void {
    if (this.silentMode) return;
    if (this.debounceTimer !== null) return;
    this.debounceTimer = setImmediate(() => {
      this.debounceTimer = null;
      this.emit('state_changed', this.buildLiveEvent('state_update'));
    });
  }

  processEvent(event: PowerLogEvent): void {
    switch (event.type) {
      case 'create_game':
        this.reset();
        this.gameStatus = 'idle';
        break;

      case 'full_entity': {
        this.entities.set(event.entityId, {
          id: event.entityId,
          cardId: event.cardId,
          displayName: '',
          tags: {},
        });
        break;
      }

      case 'show_entity': {
        const existing = this.entities.get(event.entityId);
        if (existing) {
          existing.cardId = event.cardId;
        } else {
          this.entities.set(event.entityId, {
            id: event.entityId,
            cardId: event.cardId,
            displayName: '',
            tags: {},
          });
        }
        break;
      }

      case 'change_entity': {
        const existing = this.entities.get(event.entityId);
        if (existing) {
          existing.cardId = event.cardId;
        } else {
          this.entities.set(event.entityId, {
            id: event.entityId,
            cardId: event.cardId,
            displayName: '',
            tags: {},
          });
        }
        break;
      }

      case 'entity_hint': {
        const existing = this.entities.get(event.entityId);
        if (existing) {
          if (!existing.cardId) {
            existing.cardId = event.cardId;
          }
        } else {
          this.entities.set(event.entityId, {
            id: event.entityId,
            cardId: event.cardId,
            displayName: '',
            tags: {},
          });
        }
        break;
      }

      case 'entity_tag': {
        const entity = this.entities.get(event.entityId);
        if (entity) {
          entity.tags[event.tag] = event.value;
          // If this is a PLAYER entity and we get PLAYER_ID, build the mapping
          if (event.tag === TAG.PLAYER_ID && this.isPlayerEntity(event.entityId, entity)) {
            const playerId = parseInt(event.value, 10);
            let rec = this.byPlayerId.get(playerId);
            if (!rec) {
              rec = { playerId, playerName: '', entityId: event.entityId, tags: {} };
              this.byPlayerId.set(playerId, rec);
            }
            rec.entityId = event.entityId;
            this.byEntityId.set(event.entityId, rec);
            // Propagate _isMe if name was matched earlier
            if ((rec as any)._isMe) {
              this.myPlayerEntityId = event.entityId;
            }
          }
          const rec = this.byEntityId.get(event.entityId);
          if (rec) {
            rec.tags[event.tag] = event.value;
          }
        }
        break;
      }

      case 'player_info': {
        let rec = this.byPlayerId.get(event.playerId);
        if (!rec) {
          rec = { playerId: event.playerId, playerName: event.playerName, entityId: null, tags: {} };
          this.byPlayerId.set(event.playerId, rec);
        } else {
          rec.playerName = event.playerName;
        }
        if (rec.entityId !== null) {
          this.byEntityId.set(rec.entityId, rec);
        }
        // Identify my player
        if (this.normalizePlayerName(event.playerName) === this.normalizePlayerName(this.myPlayerName)) {
          if (rec.entityId !== null) {
            this.myPlayerEntityId = rec.entityId;
          }
          // Store for resolving later when entityId is set
          (rec as any)._isMe = true;
        }
        this.tryInferMyPlayerEntity();
        break;
      }

      case 'player_entity_create': {
        // Map EntityID ↔ PlayerID immediately (before DebugPrintGame player_info arrives)
        if (!this.entities.has(event.entityId)) {
          this.entities.set(event.entityId, { id: event.entityId, cardId: '', displayName: '', tags: { [TAG.CARDTYPE]: CARDTYPE.PLAYER } });
        }
        let rec = this.byPlayerId.get(event.playerId);
        if (!rec) {
          rec = { playerId: event.playerId, playerName: '', entityId: event.entityId, tags: {} };
          this.byPlayerId.set(event.playerId, rec);
        } else {
          rec.entityId = event.entityId;
        }
        this.byEntityId.set(event.entityId, rec);
        if (!this.myPlayerName && event.playerId === 1 && this.myPlayerEntityId === null) {
          this.myPlayerEntityId = event.entityId;
        }
        this.tryInferMyPlayerEntity();
        break;
      }

      case 'tag_change': {
        this.handleTagChange(event.entityRef, event.tag, event.value);
        break;
      }

      case 'step_change': {
        if (event.step === 'BEGIN_MULLIGAN') {
          this.gameStatus = 'mulligan';
          if (!this.silentMode) this.emit('state_changed', this.buildLiveEvent('state_update'));
        }
        if (event.step === 'MAIN_READY') {
          if (this.gameStatus !== 'playing') {
            this.gameStatus = 'playing';
          }
          if (this.isMyTurn() && !this.silentMode) {
            this.emit('my_turn_start', this.buildLiveEvent('my_turn_start'));
            return;
          }
        }
        break;
      }

      case 'game_info':
      case 'block_start':
      case 'block_end':
        break;
    }
  }

  private handleTagChange(entityRef: string, tag: string, value: string): void {
    const entityId = this.resolveEntityId(entityRef);
    this.assignPlayerName(entityId, entityRef);
    let entity = entityId === null ? undefined : this.entities.get(entityId);
    const namedPlayerRec = this.isNamedEntityRef(entityRef) ? this.findPlayerRecByName(entityRef) : null;
    const cardIdFromRef = this.extractCardIdFromEntityRef(entityRef);

    if (!entity && entityId !== null) {
      entity = { id: entityId, cardId: cardIdFromRef ?? '', displayName: '', tags: {} };
      this.entities.set(entityId, entity);
    }

    const entityNameFromRef = this.extractEntityNameFromEntityRef(entityRef);
    if (entity) {
      entity.tags[tag] = value;
      if ((!entity.cardId || entity.cardId === '') && cardIdFromRef) {
        entity.cardId = cardIdFromRef;
      }
      if (entityNameFromRef) {
        entity.displayName = entityNameFromRef;
      }
    }
    if (namedPlayerRec) {
      namedPlayerRec.tags[tag] = value;
      if (namedPlayerRec.entityId !== null && this.normalizePlayerName(entityRef) === this.normalizePlayerName(this.myPlayerName)) {
        this.myPlayerEntityId = namedPlayerRec.entityId;
      }
    }

    // If this is a PLAYER entity resolving entityId after player_info
    if (entityId !== null && entity && tag === TAG.PLAYER_ID && this.isPlayerEntity(entityId, entity)) {
      const playerId = parseInt(value, 10);
      let rec = this.byPlayerId.get(playerId);
      if (!rec) {
        rec = { playerId, playerName: '', entityId, tags: {} };
        this.byPlayerId.set(playerId, rec);
      }
      rec.entityId = entityId;
      this.byEntityId.set(entityId, rec);
      if ((rec as any)._isMe) {
        this.myPlayerEntityId = entityId;
      }
    }

    // TURN change (on game entity 1)
    if (tag === TAG.TURN) {
      this.currentTurn = parseInt(value, 10);
    }

    if (tag === TAG.STEP) {
      if (value === 'BEGIN_MULLIGAN') {
        this.gameStatus = 'mulligan';
        if (!this.silentMode) this.emit('state_changed', this.buildLiveEvent('state_update'));
        return;
      }
      if (value === 'MAIN_READY' && this.gameStatus !== 'playing') {
        this.gameStatus = 'playing';
      }
      if (value === 'MAIN_READY' && this.isMyTurn() && !this.silentMode) {
        this.emit('my_turn_start', this.buildLiveEvent('my_turn_start'));
        return;
      }
    }

    // CURRENT_PLAYER tag change (on the Player entity)
    if (tag === TAG.CURRENT_PLAYER && value === '1') {
      this.currentPlayerEntityId = namedPlayerRec?.entityId ?? entityId;
      if (this.isMyTurn() && this.gameStatus === 'playing' && !this.silentMode) {
        this.emit('my_turn_start', this.buildLiveEvent('my_turn_start'));
        return;
      }
    }
    // PLAYSTATE (win/lose)
    if (tag === TAG.PLAYSTATE && (value === 'WON' || value === 'LOST' || value === 'CONCEDED')) {
      this.gameStatus = 'game_over';
      if (!this.silentMode) this.emit('state_changed', this.buildLiveEvent('game_over'));
      return;
    }

    // STATE=RUNNING → game started (Entity=1 or Entity=GameEntity)
    if (tag === TAG.STATE && value === 'RUNNING' && (entityRef === '1' || entityRef === 'GameEntity')) {
      this.gameStatus = 'playing';
      if (!this.silentMode) this.emit('state_changed', this.buildLiveEvent('game_start'));
      return;
    }

    this.scheduleStateUpdate();
  }

  isMyTurn(): boolean {
    if (this.myPlayerEntityId === null) return false;
    return this.currentPlayerEntityId === this.myPlayerEntityId;
  }

  buildLiveEvent(
    type: LiveGameEvent['type'],
    autoRecommendation?: string,
  ): LiveGameEvent {
    const fallbackSelfRec = this.myPlayerName.trim()
      ? null
      : (this.byPlayerId.get(1) ?? null);
    const entityMappedSelfRec = this.myPlayerEntityId !== null
      ? (this.byEntityId.get(this.myPlayerEntityId) || null)
      : null;
    const myPlayerRec = this.findPlayerRecByName(this.myPlayerName)
      ?? entityMappedSelfRec
      ?? this.findUnknownPlayerRec()
      ?? fallbackSelfRec;
    const myEid = myPlayerRec?.entityId ?? this.myPlayerEntityId;
    const myController = myEid !== null
      ? (this.controllerOfEntityId(myEid) ?? myPlayerRec?.playerId ?? null)
      : (myPlayerRec?.playerId ?? null);
    const oppController = myController !== null ? (myController === 1 ? 2 : 1) : null;

    const myHeroEntity = this.findHero(myController);
    const oppHeroEntity = this.findHero(oppController);

    const oppPlayerRec = oppController !== null
      ? (this.findPlayerRecByController(oppController)
        ?? Array.from(this.byPlayerId.values()).find((rec) => rec.playerId !== myPlayerRec?.playerId) ?? null)
      : (Array.from(this.byPlayerId.values()).find((rec) => rec.playerId !== myPlayerRec?.playerId) ?? null);

    const myPlayerEntity = myEid !== null ? this.entities.get(myEid) : undefined;
    const oppPlayerEntity = oppPlayerRec?.entityId !== null && oppPlayerRec?.entityId !== undefined
      ? this.entities.get(oppPlayerRec.entityId)
      : undefined;

    const isMyTurnNow = myEid !== null && this.currentPlayerEntityId === myEid;
    const myIsFirst = this.readFirstPlayerTag(myPlayerRec, myPlayerEntity);
    const oppIsFirst = this.readFirstPlayerTag(oppPlayerRec, oppPlayerEntity);
    const playerHasCoin = myIsFirst === true
      ? false
      : myIsFirst === false
        ? true
        : this.hasSeenCoin(myController)
          ? true
          : this.hasSeenCoin(oppController)
            ? false
            : oppIsFirst === true
              ? true
              : oppIsFirst === false
                ? false
                : null;
    const isPlayerFirst = myIsFirst !== null
      ? myIsFirst
      : playerHasCoin === true
        ? false
        : playerHasCoin === false
          ? true
          : null;

    // Mana is on the Player entity (not Hero entity)
    const myTotalMana = parseInt(myPlayerRec?.tags[TAG.RESOURCES] ?? myPlayerEntity?.tags[TAG.RESOURCES] ?? '0', 10);
    const myUsedMana = parseInt(myPlayerRec?.tags[TAG.RESOURCES_USED] ?? myPlayerEntity?.tags[TAG.RESOURCES_USED] ?? '0', 10);
    const myMana = Math.max(0, myTotalMana - myUsedMana);
    const myMaxMana = myTotalMana;
    const opponentTotalMana = parseInt(oppPlayerRec?.tags[TAG.RESOURCES] ?? oppPlayerEntity?.tags[TAG.RESOURCES] ?? '0', 10);
    const opponentUsedMana = parseInt(oppPlayerRec?.tags[TAG.RESOURCES_USED] ?? oppPlayerEntity?.tags[TAG.RESOURCES_USED] ?? '0', 10);
    const opponentMana = Math.max(0, opponentTotalMana - opponentUsedMana);
    const opponentMaxMana = opponentTotalMana;

    const myBoard = this.getBoardEntities(myController);
    const oppBoard = this.getBoardEntities(oppController);
    const myHand = this.getHand(myController);

    return {
      type,
      gameStatus: this.gameStatus,
      isMyTurn: isMyTurnNow,
      isPlayerFirst,
      playerHasCoin,
      turnNumber: this.currentTurn,
      playerName: myPlayerRec?.playerName || this.myPlayerName || '',
      opponentName: oppPlayerRec?.playerName ?? '',
      myPlayerId: myEid,
      myHeroHp: myHeroEntity
        ? Math.max(
            0,
            parseInt(myHeroEntity.tags[TAG.HEALTH] ?? '30', 10) -
              parseInt(myHeroEntity.tags[TAG.DAMAGE] ?? '0', 10),
          )
        : 30,
      myHeroArmor: myHeroEntity ? parseInt(myHeroEntity.tags[TAG.ARMOR] ?? '0', 10) : 0,
      myMana,
      myMaxMana,
      opponentMana,
      opponentMaxMana,
      myHandCount: myHand.length,
      myHand,
      myBoard,
      opponentHeroHp: oppHeroEntity
        ? Math.max(
            0,
            parseInt(oppHeroEntity.tags[TAG.HEALTH] ?? '30', 10) -
              parseInt(oppHeroEntity.tags[TAG.DAMAGE] ?? '0', 10),
          )
        : 30,
      opponentHeroArmor: oppHeroEntity ? parseInt(oppHeroEntity.tags[TAG.ARMOR] ?? '0', 10) : 0,
      opponentHandCount: this.countHand(oppController),
      opponentBoard: oppBoard.map(({ exhausted: _e, ...rest }) => rest),
      myHeroCardId: myHeroEntity?.cardId || undefined,
      opponentHeroCardId: oppHeroEntity?.cardId || undefined,
      autoRecommendation,
    };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private controllerOfEntityId(entityId: number): number | null {
    const entity = this.entities.get(entityId);
    if (!entity) return null;
    const v = entity.tags[TAG.CONTROLLER];
    return v ? parseInt(v, 10) : null;
  }

  private findHero(controller: number | null): EntitySnapshot | undefined {
    if (controller === null) return undefined;
    for (const e of this.entities.values()) {
      if (
        e.tags[TAG.CARDTYPE] === CARDTYPE.HERO &&
        e.tags[TAG.CONTROLLER] === String(controller) &&
        e.tags[TAG.ZONE] === ZONE.PLAY
      ) {
        return e;
      }
    }
    return undefined;
  }

  private findPlayerRecByController(controller: number): PlayerRecord | null {
    for (const rec of this.byPlayerId.values()) {
      if (rec.entityId !== null) {
        const entity = this.entities.get(rec.entityId);
        if (entity && entity.tags[TAG.CONTROLLER] === String(controller)) {
          return rec;
        }
      }
    }
    // Fallback: match by playerId
    return this.byPlayerId.get(controller) ?? null;
  }

  private getBoardEntities(
    controller: number | null,
  ): Array<{ entityId: number; cardId: string; name: string; type: string; attack: number; health: number; maxHealth: number; exhausted: boolean; cooldown: number | null }> {
    if (controller === null) return [];
    const result: Array<{ entityId: number; cardId: string; name: string; type: string; attack: number; health: number; maxHealth: number; exhausted: boolean; cooldown: number | null }> = [];
    for (const e of this.entities.values()) {
      if (
        (e.tags[TAG.CARDTYPE] === CARDTYPE.MINION || e.tags[TAG.CARDTYPE] === CARDTYPE.LOCATION) &&
        e.tags[TAG.CONTROLLER] === String(controller) &&
        e.tags[TAG.ZONE] === ZONE.PLAY
      ) {
        const maxHp = parseInt(e.tags[TAG.HEALTH] ?? '0', 10);
        const dmg = parseInt(e.tags[TAG.DAMAGE] ?? '0', 10);
        const cardType = (e.tags[TAG.CARDTYPE] ?? 'UNKNOWN').toLowerCase();
        result.push({
          entityId: e.id,
          cardId: e.cardId,
          name: e.displayName || e.cardId,
          type: cardType,
          attack: cardType === 'location' ? 0 : parseInt(e.tags[TAG.ATK] ?? '0', 10),
          health: Math.max(0, maxHp - dmg),
          maxHealth: maxHp,
          exhausted: e.tags[TAG.EXHAUSTED] === '1',
          cooldown: this.parseNullableInt(e.tags[TAG.LOCATION_ACTION_COOLDOWN]),
        });
      }
    }
    return result.sort(
      (a, b) =>
        (parseInt(this.entities.get(a.entityId)?.tags[TAG.ZONE_POSITION] ?? '0', 10)) -
        (parseInt(this.entities.get(b.entityId)?.tags[TAG.ZONE_POSITION] ?? '0', 10)),
    );
  }

  private getHand(
    controller: number | null,
  ): Array<{ entityId: number; cardId: string; name: string; cost: number; attack: number; health: number; type: string }> {
    if (controller === null) return [];
    const result: Array<{ entityId: number; cardId: string; name: string; cost: number; attack: number; health: number; type: string }> = [];
    for (const e of this.entities.values()) {
      if (
        e.tags[TAG.CONTROLLER] === String(controller) &&
        e.tags[TAG.ZONE] === ZONE.HAND
      ) {
        result.push({
          entityId: e.id,
          cardId: e.cardId,
          name: e.displayName || e.cardId,
          cost: parseInt(e.tags[TAG.COST] ?? '0', 10),
          attack: parseInt(e.tags[TAG.ATK] ?? '0', 10),
          health: parseInt(e.tags[TAG.HEALTH] ?? '0', 10),
          type: (e.tags[TAG.CARDTYPE] ?? 'unknown').toLowerCase(),
        });
      }
    }
    return result.sort(
      (a, b) =>
        parseInt(this.entities.get(a.entityId)?.tags[TAG.ZONE_POSITION] ?? '0', 10) -
        parseInt(this.entities.get(b.entityId)?.tags[TAG.ZONE_POSITION] ?? '0', 10),
    );
  }

  private countHand(controller: number | null): number {
    if (controller === null) return 0;
    let count = 0;
    for (const e of this.entities.values()) {
      if (e.tags[TAG.CONTROLLER] === String(controller) && e.tags[TAG.ZONE] === ZONE.HAND) {
        count++;
      }
    }
    return count;
  }

  private readFirstPlayerTag(rec: PlayerRecord | null, entity: EntitySnapshot | undefined): boolean | null {
    const value = rec?.tags[TAG.FIRST_PLAYER] ?? entity?.tags[TAG.FIRST_PLAYER];
    if (value === '1') return true;
    if (value === '0') return false;
    return null;
  }

  private hasSeenCoin(controller: number | null): boolean {
    if (controller === null) return false;
    for (const e of this.entities.values()) {
      if (e.cardId === 'GAME_005' && e.tags[TAG.CONTROLLER] === String(controller)) {
        return true;
      }
    }
    return false;
  }

  private parseNullableInt(value: string | undefined): number | null {
    if (value === undefined || value === '') return null;
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }

  getDebugSnapshot(): Record<string, unknown> {
    const importantTags = [
      TAG.CARDTYPE,
      TAG.CONTROLLER,
      TAG.PLAYER_ID,
      TAG.CURRENT_PLAYER,
      TAG.FIRST_PLAYER,
      TAG.PLAYSTATE,
      TAG.TURN,
      TAG.RESOURCES,
      TAG.RESOURCES_USED,
      'MAXRESOURCES',
      'HERO_ENTITY',
    ];

    const players = Array.from(this.byPlayerId.values()).map((rec) => {
      const tagSummary: Record<string, string> = {};
      for (const key of importantTags) {
        if (rec.tags[key] !== undefined) {
          tagSummary[key] = rec.tags[key];
        }
      }
      return {
        playerId: rec.playerId,
        playerName: rec.playerName,
        entityId: rec.entityId,
        tags: tagSummary,
      };
    });

    const trackedEntityIds = Array.from(
      new Set(
        [
          this.myPlayerEntityId,
          this.currentPlayerEntityId,
          ...players.map((p) => p.entityId),
        ].filter((id): id is number => typeof id === 'number'),
      ),
    );

    const trackedEntities = trackedEntityIds.map((id) => {
      const entity = this.entities.get(id);
      if (!entity) {
        return { id, exists: false };
      }
      const tagSummary: Record<string, string> = {};
      for (const key of importantTags) {
        if (entity.tags[key] !== undefined) {
          tagSummary[key] = entity.tags[key];
        }
      }
      return {
        id,
        exists: true,
        cardId: entity.cardId,
        tags: tagSummary,
      };
    });

    return {
      myPlayerNameConfig: this.myPlayerName,
      myPlayerEntityId: this.myPlayerEntityId,
      currentPlayerEntityId: this.currentPlayerEntityId,
      currentTurn: this.currentTurn,
      gameStatus: this.gameStatus,
      isMyTurn: this.isMyTurn(),
      playerRecords: players,
      trackedEntities,
      liveState: this.buildLiveEvent('state_update'),
    };
  }
}
