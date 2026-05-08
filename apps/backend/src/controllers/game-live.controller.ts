import { Controller, Get, Logger, Param, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PowerLogWatcherService } from '../services/power-log-watcher.service';
import { AppService } from '../services/app.service';
import { GameReplayService } from '../services/game-replay.service';
import type { LiveGameEvent } from '../types/hearthstone';
import type { HearthstoneRecommendRequest } from '../types/hearthstone';
import type { LiveRecommendationEnvelope } from '../types/hearthstone';
import type { ReplaySessionDetail, ReplaySessionSummary } from '../types/hearthstone';
import type { ReplayTurnAiDebugResponse } from '../types/hearthstone';

@Controller('hearthstone')
export class GameLiveController {
  private readonly logger = new Logger(GameLiveController.name);

  constructor(
    private readonly watcher: PowerLogWatcherService,
    private readonly appService: AppService,
    private readonly replayService: GameReplayService,
  ) {}

  @Get('replays')
  getReplaySessions(@Query('limit') limit?: string): ReplaySessionSummary[] {
    const parsedLimit = Number.parseInt(limit || '10', 10);
    const safeLimit = Number.isFinite(parsedLimit) ? parsedLimit : 10;
    return this.replayService.listRecentSessions(safeLimit);
  }

  @Get('replays/:sessionId')
  getReplayDetail(@Param('sessionId') sessionId: string): ReplaySessionDetail {
    return this.replayService.getSessionDetail(sessionId);
  }

  @Get('replays/:sessionId/recommendation')
  async getReplayTurnRecommendation(
    @Param('sessionId') sessionId: string,
    @Query('turn') turn?: string,
    @Query('provider') provider?: string,
  ): Promise<ReplayTurnAiDebugResponse> {
    const parsedTurn = Number.parseInt(turn || '1', 10);
    const safeTurn = Number.isFinite(parsedTurn) && parsedTurn > 0 ? parsedTurn : 1;
    const safeProvider = this.parseProvider(provider);
    const replayRequest = this.replayService.buildReplayRecommendationRequest(sessionId, safeTurn);

    const recommendation = await this.appService.recommendLiveGamePlan(
      {
        ...replayRequest.request,
        provider: safeProvider,
      },
      {
        generationId: 1,
        timeoutMs: 1200,
        providers: [safeProvider],
      },
    );

    return {
      sessionId,
      turnNumber: safeTurn,
      source: replayRequest.source,
      snapshot: replayRequest.snapshot,
      request: replayRequest.request,
      recommendation,
    };
  }

  /** REST snapshot – usable as fallback or for polling */
  @Get('live-state')
  getLiveState(): LiveGameEvent {
    return this.watcher.getCurrentState();
  }

  /** Debug snapshot – exposes internal mapping for troubleshooting */
  @Get('live-debug')
  getLiveDebug(): Record<string, unknown> {
    return this.watcher.getDebugSnapshot();
  }

  /** SSE stream – pushes every game state change to connected clients */
  @Get('live-events')
  async liveEvents(@Req() req: Request, @Res() res: Response): Promise<void> {
    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Nginx compatibility
    res.flushHeaders();

    const clientId = this.watcher.addClient(res);
    let latestGeneration = 0;
    let lastRecommendedTurn: number | null = null;

    const trySendRecommendation = async (turnEvent: LiveGameEvent): Promise<void> => {
      if (!(turnEvent.gameStatus === 'playing' && turnEvent.isMyTurn)) {
        return;
      }

      if (lastRecommendedTurn === turnEvent.turnNumber) {
        return;
      }

      lastRecommendedTurn = turnEvent.turnNumber;
      const generation = ++latestGeneration;
      const request = this.buildLiveRecommendationRequest(turnEvent);

      try {
        const quickRecommendation = this.appService.buildLiveFallbackRecommendation(
          request,
          generation,
        );
        this.sendRecommendationIfFresh(res, turnEvent, generation, quickRecommendation, latestGeneration);

        const refinedRecommendation = await this.appService.recommendLiveGamePlan(request, {
          generationId: generation,
          timeoutMs: 900,
          providers: ['deepseek', 'google'],
        });
        this.sendRecommendationIfFresh(
          res,
          turnEvent,
          generation,
          refinedRecommendation,
          latestGeneration,
          quickRecommendation,
        );
      } catch (err) {
        this.logger.debug(`Auto-recommendation failed: ${err}`);
      }
    };

    const snapshot = this.watcher.getCurrentState();
    await trySendRecommendation(snapshot);

    // Hook into my_turn_start to auto-trigger AI recommendation
    const onMyTurn = async (event: LiveGameEvent) => {
      await trySendRecommendation(event);
    };

    this.watcher.stateMachine.on('my_turn_start', onMyTurn);

    req.on('close', () => {
      this.watcher.stateMachine.off('my_turn_start', onMyTurn);
      this.watcher.removeClient(clientId);
    });
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private buildLiveRecommendationRequest(event: LiveGameEvent): HearthstoneRecommendRequest {
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
      notes: `实时对局 第${event.turnNumber}回合`,
      provider: 'deepseek',
    };
  }

  private sendRecommendationIfFresh(
    res: Response,
    turnEvent: LiveGameEvent,
    generation: number,
    recommendation: LiveRecommendationEnvelope,
    latestGeneration: number,
    previous?: LiveRecommendationEnvelope,
  ): void {
    if (generation !== latestGeneration) {
      return;
    }

    const latest = this.watcher.getCurrentState();
    if (
      latest.turnNumber !== turnEvent.turnNumber ||
      latest.gameStatus !== 'playing' ||
      !latest.isMyTurn
    ) {
      return;
    }

    if (previous && !this.isRecommendationUpgrade(previous, recommendation)) {
      return;
    }

    const enriched: LiveGameEvent = {
      ...latest,
      autoRecommendation: recommendation.summary,
      recommendation,
    };
    try {
      res.write(`data: ${JSON.stringify(enriched)}\n\n`);
    } catch {
      // client disconnected
    }
  }

  private isRecommendationUpgrade(
    previous: LiveRecommendationEnvelope,
    next: LiveRecommendationEnvelope,
  ): boolean {
    if (next.aiMeta.mode === 'llm' && previous.aiMeta.mode !== 'llm') {
      return true;
    }
    if (next.confidence - previous.confidence >= 0.08) {
      return true;
    }
    return false;
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

  private parseProvider(provider?: string): 'deepseek' | 'google' {
    if ((provider || '').toLowerCase() === 'google') {
      return 'google';
    }
    return 'deepseek';
  }
}
