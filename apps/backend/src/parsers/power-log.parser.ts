/**
 * Stateless Power.log line parser.
 * Each call to parseLine() returns a structured event or null if the line is not relevant.
 *
 * Context rules for tag attribution:
 *   FULL_ENTITY / SHOW_ENTITY blocks open a "current entity" context.
 *   Indented "    tag=X value=Y" lines belong to that entity until a new top-level line appears.
 */

export type PowerLogEvent =
  | { type: 'create_game' }
  | { type: 'full_entity'; entityId: number; cardId: string }
  | { type: 'show_entity'; entityId: number; cardId: string }
  | { type: 'change_entity'; entityId: number; cardId: string }
  | { type: 'entity_hint'; entityId: number; cardId: string }
  | { type: 'entity_tag'; entityId: number; tag: string; value: string }
  | { type: 'tag_change'; entityRef: string; tag: string; value: string }
  | { type: 'block_start'; blockType: string; entityRef: string }
  | { type: 'block_end' }
  | { type: 'player_info'; playerId: number; playerName: string }
  | { type: 'player_entity_create'; entityId: number; playerId: number }
  | { type: 'game_info'; gameType: string; formatType: string }
  | { type: 'step_change'; step: string };

/** Mutable parse-context kept by the caller (PowerLogParser instance) */
interface ParseContext {
  currentEntityId: number | null;
  inEntityBlock: boolean;
}

export class PowerLogParser {
  private ctx: ParseContext = { currentEntityId: null, inEntityBlock: false };

  private extractEntityId(entityRef: string): number | null {
    const trimmed = entityRef.trim();
    if (/^\d+$/.test(trimmed)) {
      return parseInt(trimmed, 10);
    }
    const bracketIdMatch = trimmed.match(/\bid=(\d+)\b/);
    if (bracketIdMatch) {
      return parseInt(bracketIdMatch[1], 10);
    }
    const entityIdMatch = trimmed.match(/\bEntityID=(\d+)\b/);
    if (entityIdMatch) {
      return parseInt(entityIdMatch[1], 10);
    }
    return null;
  }

  reset(): void {
    this.ctx = { currentEntityId: null, inEntityBlock: false };
  }

  parseLine(line: string): PowerLogEvent | null {
    // Strip the timestamp prefix:  "D HH:MM:SS.NNNNNNN MethodName() - content"
    // We only care about the content after the last " - "
    const dashIdx = line.indexOf(' - ');
    if (dashIdx === -1) return null;

    // Check which method contextualises the line
    const methodPart = line.substring(0, dashIdx);
    const content = line.substring(dashIdx + 3).trim();

    // ── GameState.DebugPrintGame() lines ─────────────────────────────────────
    if (methodPart.includes('DebugPrintGame')) {
      return this.parseGameInfoLine(content);
    }

    // ── GameState.DebugPrintOptions() lines ─────────────────────────────────
    if (methodPart.includes('DebugPrintOptions')) {
      return this.parseOptionsLine(content);
    }

    // Only process DebugPrintPower / PowerTaskList lines
    const isPower =
      methodPart.includes('DebugPrintPower') ||
      methodPart.includes('PowerTaskList');

    if (!isPower) return null;

    // Ignore the nested PowerTaskList CREATE_GAME marker. The authoritative
    // game boundary is the top-level GameState.DebugPrintPower() line.
    if (
      content === 'CREATE_GAME' &&
      methodPart.includes('PowerTaskList') &&
      !methodPart.includes('GameState')
    ) {
      return null;
    }

    return this.parsePowerContent(content);
  }

  private parseGameInfoLine(content: string): PowerLogEvent | null {
    // PlayerID=1, PlayerName=易君#5408
    const playerMatch = content.match(/PlayerID=(\d+),\s*PlayerName=(.+)$/);
    if (playerMatch) {
      return {
        type: 'player_info',
        playerId: parseInt(playerMatch[1], 10),
        playerName: playerMatch[2].trim(),
      };
    }
    const gameTypeMatch = content.match(/GameType=(.+)$/);
    if (gameTypeMatch) {
      return { type: 'game_info', gameType: gameTypeMatch[1].trim(), formatType: '' };
    }
    return null;
  }

  private parsePowerContent(content: string): PowerLogEvent | null {
    // CREATE_GAME
    if (content === 'CREATE_GAME') {
      this.ctx.currentEntityId = null;
      this.ctx.inEntityBlock = false;
      return { type: 'create_game' };
    }

    // Player EntityID=X PlayerID=Y GameAccountId=[...] (inside CREATE_GAME block)
    const playerEntityMatch = content.match(/^Player\s+EntityID=(\d+)\s+PlayerID=(\d+)/);
    if (playerEntityMatch) {
      const entityId = parseInt(playerEntityMatch[1], 10);
      this.ctx.currentEntityId = entityId;
      this.ctx.inEntityBlock = true;
      return {
        type: 'player_entity_create',
        entityId,
        playerId: parseInt(playerEntityMatch[2], 10),
      };
    }

    // GameEntity EntityID=X (inside CREATE_GAME block)
    const gameEntityMatch = content.match(/^GameEntity\s+EntityID=(\d+)/);
    if (gameEntityMatch) {
      const entityId = parseInt(gameEntityMatch[1], 10);
      this.ctx.currentEntityId = entityId;
      this.ctx.inEntityBlock = true;
      return null; // just update context, no event needed
    }

    // BLOCK_END
    if (content === 'BLOCK_END') {
      this.ctx.inEntityBlock = false;
      return { type: 'block_end' };
    }

    // BLOCK_START BlockType=X Entity=Y ...
    const blockStartMatch = content.match(
      /^BLOCK_START\s+BlockType=(\S+)\s+Entity=(.+?)(?:\s+\w+=|$)/,
    );
    if (blockStartMatch) {
      this.ctx.inEntityBlock = false;
      return {
        type: 'block_start',
        blockType: blockStartMatch[1],
        entityRef: blockStartMatch[2],
      };
    }

    // FULL_ENTITY - Creating ID=N CardID=X
    // FULL_ENTITY - Updating [entityName=... id=N ...] CardID=X
    const fullEntityMatch = content.match(
      /^FULL_ENTITY - (?:Creating ID=(\d+)|Updating (.+?))\s+CardID=(\S*)/,
    );
    if (fullEntityMatch) {
      const entityId = fullEntityMatch[1]
        ? parseInt(fullEntityMatch[1], 10)
        : this.extractEntityId(fullEntityMatch[2] ?? '');
      if (entityId === null) {
        this.ctx.inEntityBlock = false;
        return null;
      }
      this.ctx.currentEntityId = entityId;
      this.ctx.inEntityBlock = true;
      return {
        type: 'full_entity',
        entityId,
        cardId: fullEntityMatch[3] ?? '',
      };
    }

    // SHOW_ENTITY - Updating Entity=N CardID=X
    const showEntityMatch = content.match(
      /^SHOW_ENTITY - Updating Entity=(.+?)\s+CardID=(\S*)/,
    );
    if (showEntityMatch) {
      const entityId = this.extractEntityId(showEntityMatch[1]);
      if (entityId === null) {
        this.ctx.inEntityBlock = false;
        return null;
      }
      this.ctx.currentEntityId = entityId;
      this.ctx.inEntityBlock = true;
      return {
        type: 'show_entity',
        entityId,
        cardId: showEntityMatch[2],
      };
    }

    const changeEntityMatch = content.match(
      /^CHANGE_ENTITY - Updating Entity=(.+?)\s+CardID=(\S*)/,
    );
    if (changeEntityMatch) {
      const entityId = this.extractEntityId(changeEntityMatch[1]);
      if (entityId === null) {
        this.ctx.inEntityBlock = false;
        return null;
      }
      this.ctx.currentEntityId = entityId;
      this.ctx.inEntityBlock = true;
      return {
        type: 'change_entity',
        entityId,
        cardId: changeEntityMatch[2],
      };
    }

    // TAG_CHANGE Entity=X tag=Y value=Z  (top-level, not indented inside an entity block)
    const tagChangeMatch = content.match(
      /^TAG_CHANGE\s+Entity=(.+?)\s+tag=(\S+)\s+value=(\S*)/,
    );
    if (tagChangeMatch) {
      this.ctx.inEntityBlock = false;
      return {
        type: 'tag_change',
        entityRef: tagChangeMatch[1],
        tag: tagChangeMatch[2],
        value: tagChangeMatch[3],
      };
    }

    // "tag=X value=Y" lines inside a FULL_ENTITY / SHOW_ENTITY / Player block.
    // Note: content is already .trim()-ped so there is NO leading whitespace.
    const indentedTagMatch = content.match(/^tag=(\S+)\s+value=(\S*)/);
    if (indentedTagMatch && this.ctx.inEntityBlock && this.ctx.currentEntityId !== null) {
      return {
        type: 'entity_tag',
        entityId: this.ctx.currentEntityId,
        tag: indentedTagMatch[1],
        value: indentedTagMatch[2] ?? '',
      };
    }
    return null;
  }

  private parseOptionsLine(content: string): PowerLogEvent | null {
    const entityHintMatch = content.match(/mainEntity=\[[^\]]*\bid=(\d+)\b[^\]]*\bcardId=([^\s\]]*)/);
    if (!entityHintMatch) return null;
    const entityId = parseInt(entityHintMatch[1], 10);
    if (isNaN(entityId)) return null;
    const cardId = (entityHintMatch[2] ?? '').trim();
    if (!cardId) return null;
    return {
      type: 'entity_hint',
      entityId,
      cardId,
    };
  }
}
