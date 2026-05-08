import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PowerLogParser } from '../parsers/power-log.parser';
import { GameStateMachine } from '../state/game-state-machine';
import type {
  HearthstoneRecommendRequest,
  LiveGameEvent,
  ReplayAction,
  ReplayActionKind,
  ReplaySessionDetail,
  ReplaySessionSummary,
  ReplayTurn,
} from '../types/hearthstone';

interface ReplayCacheEntry {
  mtimeMs: number;
  detail: ReplaySessionDetail;
}

@Injectable()
export class GameReplayService {
  private readonly logRoot: string;
  private readonly myPlayerName: string;
  private readonly cache = new Map<string, ReplayCacheEntry>();

  constructor() {
    this.logRoot = process.env.HS_LOG_PATH ?? 'F:\\Hearthstone\\Logs';
    this.myPlayerName = process.env.HS_PLAYER_NAME ?? '';
  }

  listRecentSessions(limit = 10): ReplaySessionSummary[] {
    if (!fs.existsSync(this.logRoot)) {
      return [];
    }

    const dirs = fs
      .readdirSync(this.logRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a))
      .slice(0, Math.max(1, Math.min(100, limit)));

    return dirs.map((sessionId) => this.buildSessionSummary(sessionId));
  }

  getSessionDetail(sessionId: string): ReplaySessionDetail {
    const safeSessionId = this.sanitizeSessionId(sessionId);
    if (!safeSessionId) {
      throw new Error('invalid session id');
    }

    const summary = this.buildSessionSummary(safeSessionId);
    const logPath = this.resolveSessionLogPath(safeSessionId);
    if (!logPath) {
      return {
        session: summary,
        turns: [],
        totalActions: 0,
      };
    }

    const mtimeMs = fs.statSync(logPath).mtimeMs;
    const cacheHit = this.cache.get(safeSessionId);
    if (cacheHit && cacheHit.mtimeMs === mtimeMs) {
      return cacheHit.detail;
    }

    const text = fs.readFileSync(logPath, 'utf8');
    const detail = this.parseReplayLog(safeSessionId, text);
    this.cache.set(safeSessionId, {
      mtimeMs,
      detail,
    });
    if (this.cache.size > 50) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    return detail;
  }

  buildReplayRecommendationRequest(
    sessionId: string,
    turnNumber: number,
  ): {
    source: 'my_turn_snapshot' | 'state_snapshot';
    snapshot: LiveGameEvent;
    request: HearthstoneRecommendRequest;
  } {
    const safeSessionId = this.sanitizeSessionId(sessionId);
    if (!safeSessionId) {
      throw new Error('invalid session id');
    }
    if (!Number.isFinite(turnNumber) || turnNumber <= 0) {
      throw new Error('invalid turn number');
    }

    const logPath = this.resolveSessionLogPath(safeSessionId);
    if (!logPath) {
      throw new Error('replay log not found');
    }

    const text = fs.readFileSync(logPath, 'utf8');
    const snapshots = this.collectTurnSnapshots(text);
    const preferMyTurn = snapshots.myTurnSnapshots.get(turnNumber);
    const fallbackTurn = snapshots.stateSnapshots.get(turnNumber);
    const snapshot = preferMyTurn || fallbackTurn;
    if (!snapshot) {
      throw new Error(`turn ${turnNumber} snapshot not found`);
    }

    return {
      source: preferMyTurn ? 'my_turn_snapshot' : 'state_snapshot',
      snapshot,
      request: this.toRecommendRequest(snapshot),
    };
  }

  private parseReplayLog(sessionId: string, text: string): ReplaySessionDetail {
    const turns = new Map<number, ReplayTurn>();
    const players = new Map<number, string>();
    let myPlayerId: number | null = null;
    let turnNumber = 1;
    let actionIndex = 0;
    let activeAction: ReplayAction | null = null;

    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (!line) continue;

      // ── 1. Parse DebugPrintGame lines for player name mapping ─────────────
      //    Format: "D hh:mm:ss GameState.DebugPrintGame() - PlayerID=N, PlayerName=XXX"
      if (line.includes('DebugPrintGame()')) {
        const gameContent = this.extractContent(line);
        const gpMatch = gameContent?.match(/^PlayerID=(\d+),\s*PlayerName=(.+)$/);
        if (gpMatch?.[1] && gpMatch?.[2]) {
          const pid = Number.parseInt(gpMatch[1], 10);
          const pname = gpMatch[2].trim();
          players.set(pid, pname);
          // Match by battle tag number (#NNNN) which survives encoding corruption
          if (myPlayerId === null && this.myPlayerName) {
            const myTagNum = this.myPlayerName.match(/#(\d+)/)?.[1];
            const lineTagNum = pname.match(/#(\d+)/)?.[1];
            if (myTagNum && lineTagNum && myTagNum === lineTagNum) {
              myPlayerId = pid;
            } else if (this.normalizeName(pname) === this.normalizeName(this.myPlayerName)) {
              myPlayerId = pid;
            }
          }
        }
        continue;
      }

      // ── 2. Only process GameState.DebugPrintPower() lines (skip PowerTaskList duplicates) ──
      if (!line.includes('GameState.DebugPrintPower()')) continue;

      const content = this.extractContent(line);
      if (!content) continue;

      // ── 3. Player mapping from DebugPrintPower (e.g. CREATE_GAME) ──────────
      const playerMatch = content.match(/PlayerID=(\d+),\s*PlayerName=(.+)$/);
      if (playerMatch?.[1] && playerMatch?.[2]) {
        const playerId = Number.parseInt(playerMatch[1], 10);
        const playerName = playerMatch[2].trim();
        players.set(playerId, playerName);
        if (this.myPlayerName && this.normalizeName(playerName) === this.normalizeName(this.myPlayerName)) {
          myPlayerId = playerId;
        }
      }

      // ── 4. Turn tracking ────────────────────────────────────────────────────
      const turnMatch = content.match(/^TAG_CHANGE\s+Entity=.+?\s+tag=TURN\s+value=(\d+)/);
      if (turnMatch?.[1]) {
        turnNumber = Number.parseInt(turnMatch[1], 10) || turnNumber;
        this.pushTurnAction(turns, turnNumber, {
          index: ++actionIndex,
          kind: 'turn_start',
          side: 'unknown',
          actor: `回合 ${turnNumber}`,
          raw: content,
        });
        activeAction = null;
        continue;
      }

      // ── 5. Block end ────────────────────────────────────────────────────────
      if (content.startsWith('BLOCK_END')) {
        activeAction = null;
        continue;
      }

      // ── 6. Block start ───────────────────────────────────────────────────────
      const blockMatch = content.match(/^BLOCK_START\s+BlockType=(\S+)\s+Entity=(.+?)\s+EffectCardId=/);
      if (blockMatch) {
        const blockType = blockMatch[1].toUpperCase();
        const entityRef = (blockMatch[2] || '').trim();
        
        // Extract Target from full content
        const targetMatch = content.match(/\bTarget=(.+?)(?:\s+SubOption=|$)/);
        const targetRef = targetMatch?.[1]?.trim();
        
        const cardId = this.extractCardId(entityRef);
        const cardName = this.extractEntityName(entityRef);

        // Use player= field directly - this is the most reliable side indicator
        const side = this.resolveSideByPlayerField(entityRef, myPlayerId);
        
        const action: ReplayAction = {
          index: ++actionIndex,
          kind: this.mapBlockType(blockType),
          side,
          actor: this.humanizeEntityRef(entityRef) || cardName || cardId || '未知实体',
          target: (targetRef && targetRef !== '0') ? this.humanizeEntityRef(targetRef) : undefined,
          cardId: cardId || undefined,
          cardName: cardName || undefined,
          spawned: [],
          damageEvents: [],
          deaths: [],
          raw: content,
        };
        this.pushTurnAction(turns, turnNumber, action);
        activeAction = action;
        continue;
      }

      // ── 7. Collect inner block events ────────────────────────────────────────
      if (activeAction) {
        // Spawned entities (SHOW_ENTITY or FULL_ENTITY with real cardId)
        const showMatch = content.match(/^(?:FULL_ENTITY - Creating|SHOW_ENTITY - Updating)\s+Entity=(.+?)\s+CardID=(\S+)/);
        if (showMatch) {
          const eName = this.extractEntityName(showMatch[1]) || showMatch[2];
          if (eName && eName !== 'UNKNOWN' && showMatch[2] && showMatch[2].length > 1) {
            activeAction.spawned?.push(eName);
          }
        }
        
        // Damage events
        const dmgTag = content.match(/^TAG_CHANGE\s+Entity=(.+?)\s+tag=DAMAGE\s+value=(\d+)/);
        if (dmgTag) {
          const dmgRef = (dmgTag[1] || '').trim();
          const dmgVal = Number.parseInt(dmgTag[2], 10);
          const dmgName = this.humanizeEntityRef(dmgRef);
          if (Number.isFinite(dmgVal) && dmgVal > 0) {
            activeAction.damageEvents?.push({ entity: dmgName, damage: dmgVal });
          }
        }

        // Death events (zone -> GRAVEYARD)
        const zoneMatch = content.match(/^TAG_CHANGE\s+Entity=(.+?)\s+tag=ZONE\s+value=GRAVEYARD/);
        if (zoneMatch) {
          const deadRef = (zoneMatch[1] || '').trim();
          const deadName = this.humanizeEntityRef(deadRef);
          activeAction.deaths?.push(deadName);
        }
      }
    }

    const turnList = [...turns.values()]
      .sort((a, b) => a.turnNumber - b.turnNumber)
      .map((turn) => ({
        ...turn,
        actionCount: turn.actions.length,
      }));

    return {
      session: this.buildSessionSummary(sessionId),
      turns: turnList,
      totalActions: turnList.reduce((sum, turn) => sum + turn.actions.length, 0),
    };
  }

  private collectTurnSnapshots(text: string): {
    stateSnapshots: Map<number, LiveGameEvent>;
    myTurnSnapshots: Map<number, LiveGameEvent>;
  } {
    const parser = new PowerLogParser();
    const machine = new GameStateMachine(this.myPlayerName);
    machine.setSilent(true);

    const stateSnapshots = new Map<number, LiveGameEvent>();
    const myTurnSnapshots = new Map<number, LiveGameEvent>();

    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const event = parser.parseLine(trimmed);
      if (!event) {
        continue;
      }
      machine.processEvent(event);
      const snapshot = machine.buildLiveEvent('state_update');
      if (snapshot.gameStatus !== 'playing' || snapshot.turnNumber <= 0) {
        continue;
      }
      stateSnapshots.set(snapshot.turnNumber, snapshot);
      if (snapshot.isMyTurn) {
        myTurnSnapshots.set(snapshot.turnNumber, snapshot);
      }
    }

    return {
      stateSnapshots,
      myTurnSnapshots,
    };
  }

  private toRecommendRequest(event: LiveGameEvent): HearthstoneRecommendRequest {
    return {
      heroClass: this.heroClassFromCardId(event.myHeroCardId),
      enemyClass: this.heroClassFromCardId(event.opponentHeroCardId),
      myHealth: event.myHeroHp + event.myHeroArmor,
      enemyHealth: event.opponentHeroHp + event.opponentHeroArmor,
      myManaCrystals: event.myMana,
      enemyManaCrystals: event.opponentMana,
      myHand: event.myHand.map((card) => ({
        id: card.cardId || `entity-${card.entityId}`,
        name: card.name || card.cardId || `未知卡牌#${card.entityId}`,
        cost: card.cost,
        text: card.name || card.cardId || '',
        type: this.normalizeCardType(card.type),
      })),
      myBoard: event.myBoard.map((entity) => ({
        id: entity.cardId || `entity-${entity.entityId}`,
        name: entity.name || entity.cardId || `未知随从#${entity.entityId}`,
        attack: entity.attack,
        health: entity.health,
        maxHealth: entity.maxHealth,
      })),
      enemyBoard: event.opponentBoard.map((entity) => ({
        id: entity.cardId || `entity-${entity.entityId}`,
        name: entity.name || entity.cardId || `未知随从#${entity.entityId}`,
        attack: entity.attack,
        health: entity.health,
        maxHealth: entity.maxHealth,
      })),
      goal: this.estimateGoal(event),
      notes: `回放对局 第${event.turnNumber}回合`,
      provider: 'deepseek',
    };
  }

  private estimateGoal(event: LiveGameEvent): HearthstoneRecommendRequest['goal'] {
    const myBoardAttack = event.myBoard.reduce((sum, item) => sum + Math.max(0, item.attack), 0);
    const pressureGap = event.opponentBoard.length - event.myBoard.length;
    if (event.opponentHeroHp + event.opponentHeroArmor <= myBoardAttack + 4) {
      return 'burst';
    }
    if (event.myHeroHp + event.myHeroArmor <= 12 || pressureGap >= 2) {
      return 'survival';
    }
    if (event.myMana >= 7 && event.myHandCount >= 5) {
      return 'value';
    }
    return 'tempo';
  }

  private normalizeCardType(
    type: string,
  ): 'spell' | 'minion' | 'weapon' | 'location' | 'hero' | 'hero-power' | 'coin' {
    const raw = (type || '').toLowerCase();
    if (raw === 'spell') return 'spell';
    if (raw === 'minion') return 'minion';
    if (raw === 'weapon') return 'weapon';
    if (raw === 'location') return 'location';
    if (raw === 'hero') return 'hero';
    if (raw === 'hero_power' || raw === 'hero-power' || raw === 'hero power') {
      return 'hero-power';
    }
    if (raw === 'coin') return 'coin';
    return 'spell';
  }

  private heroClassFromCardId(cardId?: string): string {
    const id = (cardId || '').toUpperCase();
    if (!id) return 'unknown';
    if (id.startsWith('HERO_01')) return 'warrior';
    if (id.startsWith('HERO_02')) return 'shaman';
    if (id.startsWith('HERO_03')) return 'rogue';
    if (id.startsWith('HERO_04')) return 'paladin';
    if (id.startsWith('HERO_05')) return 'hunter';
    if (id.startsWith('HERO_06')) return 'druid';
    if (id.startsWith('HERO_07')) return 'warlock';
    if (id.startsWith('HERO_08')) return 'mage';
    if (id.startsWith('HERO_09')) return 'priest';
    if (id.startsWith('HERO_10')) return 'demonhunter';
    if (id.startsWith('HERO_11')) return 'deathknight';
    return 'unknown';
  }

  private pushTurnAction(turns: Map<number, ReplayTurn>, turnNumber: number, action: ReplayAction): void {
    if (!turns.has(turnNumber)) {
      turns.set(turnNumber, {
        turnNumber,
        actions: [],
        actionCount: 0,
        myActionCount: 0,
        opponentActionCount: 0,
      });
    }
    const turn = turns.get(turnNumber);
    if (!turn) {
      return;
    }
    turn.actions.push(action);
    if (action.side === 'me') {
      turn.myActionCount += 1;
    } else if (action.side === 'opponent') {
      turn.opponentActionCount += 1;
    }
  }

  private mapBlockType(blockType: string): ReplayActionKind {
    if (blockType === 'PLAY') {
      return 'play';
    }
    if (blockType === 'ATTACK') {
      return 'attack';
    }
    if (blockType === 'POWER') {
      return 'power';
    }
    return 'other';
  }

  private extractContent(line: string): string {
    const dashIdx = line.indexOf(' - ');
    if (dashIdx === -1) {
      return '';
    }
    return line.substring(dashIdx + 3).trim();
  }

  private extractField(content: string, fieldName: string): string | null {
    const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}=(.+?)(?:\\s+\\w+=|$)`);
    const match = content.match(regex);
    if (!match?.[1]) {
      return null;
    }
    return match[1].trim();
  }

  private extractCardId(entityRef: string): string {
    const match = entityRef.match(/\bcardId=([^\s\]]+)/);
    if (!match?.[1]) {
      return '';
    }
    return match[1].trim();
  }

  private extractEntityName(entityRef: string): string {
    const match = entityRef.match(/\bentityName=(.+?)\sid=\d+/);
    if (!match?.[1]) {
      return '';
    }
    return match[1].trim();
  }

  private resolveSide(
    entityRef: string,
    players: Map<number, string>,
    myPlayerId: number | null,
  ): 'me' | 'opponent' | 'unknown' {
    const ownerPlayerId = this.extractPlayerId(entityRef);
    if (ownerPlayerId !== null && myPlayerId !== null) {
      return ownerPlayerId === myPlayerId ? 'me' : 'opponent';
    }

    const normalizedEntity = this.normalizeName(entityRef);
    const normalizedMe = this.normalizeName(this.myPlayerName);
    if (normalizedEntity && normalizedMe && normalizedEntity.includes(normalizedMe)) {
      return 'me';
    }

    for (const [, player] of players) {
      const normalizedPlayer = this.normalizeName(player);
      if (!normalizedPlayer || !normalizedEntity.includes(normalizedPlayer)) {
        continue;
      }
      if (normalizedMe && normalizedPlayer === normalizedMe) {
        return 'me';
      }
      return 'opponent';
    }

    return 'unknown';
  }

  /** Resolve side by reading the player= field inside entity brackets.
   *  e.g. "[entityName=foo id=56 zone=PLAY zonePos=2 cardId=DINO_434 player=2]"
   *  This is the most reliable indicator in GameState.DebugPrintPower lines.
   */
  private resolveSideByPlayerField(
    entityRef: string,
    myPlayerId: number | null,
  ): 'me' | 'opponent' | 'unknown' {
    if (myPlayerId === null) return 'unknown';
    const playerMatch = entityRef.match(/\bplayer=(\d+)\b/i);
    if (!playerMatch?.[1]) return 'unknown';
    const pid = Number.parseInt(playerMatch[1], 10);
    return pid === myPlayerId ? 'me' : 'opponent';
  }

  private extractPlayerId(entityRef: string): number | null {
    const match = entityRef.match(/\bplayer=(\d+)\b/i);
    if (!match?.[1]) {
      return null;
    }
    const value = Number.parseInt(match[1], 10);
    return Number.isFinite(value) ? value : null;
  }

  private humanizeEntityRef(entityRef: string): string {
    const named = this.extractEntityName(entityRef);
    if (named) {
      return named;
    }
    const cardId = this.extractCardId(entityRef);
    if (cardId) {
      return cardId;
    }
    const trimmed = (entityRef || '').trim();
    if (!trimmed || trimmed === 'GameEntity') {
      return '未知实体';
    }
    return trimmed;
  }

  private normalizeName(name: string): string {
    return name
      .replace(/#\d+$/u, '')
      .replace(/\s+/g, '')
      .trim()
      .toLowerCase();
  }

  private buildSessionSummary(sessionId: string): ReplaySessionSummary {
    const sessionPath = path.join(this.logRoot, sessionId);
    const logPath = this.resolveSessionLogPath(sessionId);
    const stat = fs.existsSync(sessionPath) ? fs.statSync(sessionPath) : null;
    const logStat = logPath && fs.existsSync(logPath) ? fs.statSync(logPath) : null;

    return {
      sessionId,
      startedAt: this.parseSessionStartTime(sessionId, stat),
      updatedAt: (logStat || stat)?.mtime.toISOString() || new Date(0).toISOString(),
      hasPowerLog: !!logPath,
      sizeBytes: logStat?.size || 0,
    };
  }

  private resolveSessionLogPath(sessionId: string): string | null {
    const folderPath = path.join(this.logRoot, sessionId);
    const powerLog = path.join(folderPath, 'Power.log');
    if (fs.existsSync(powerLog)) {
      return powerLog;
    }
    const powerOld = path.join(folderPath, 'Power_old.log');
    if (fs.existsSync(powerOld)) {
      return powerOld;
    }
    return null;
  }

  private parseSessionStartTime(sessionId: string, fallbackStat: fs.Stats | null): string {
    const match = sessionId.match(/^(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})$/);
    if (!match) {
      return fallbackStat?.birthtime.toISOString() || new Date(0).toISOString();
    }

    const year = Number.parseInt(match[1], 10);
    const month = Number.parseInt(match[2], 10) - 1;
    const day = Number.parseInt(match[3], 10);
    const hour = Number.parseInt(match[4], 10);
    const minute = Number.parseInt(match[5], 10);
    const second = Number.parseInt(match[6], 10);
    return new Date(year, month, day, hour, minute, second).toISOString();
  }

  private sanitizeSessionId(value: string): string {
    const normalized = (value || '').trim();
    if (!normalized || normalized.includes('..') || normalized.includes('\\') || normalized.includes('/')) {
      return '';
    }
    return normalized;
  }
}
