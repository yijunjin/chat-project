import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { AppService } from '../services/app.service';
import {
  HearthstoneCardDetailRequest,
  HearthstoneCardsByIdsRequest,
  HearthstoneCardSearchRequest,
  HearthstoneDeckRequest,
  HearthstoneMetadataRequest,
  HearthstoneOpeningHandRequest,
  HearthstoneRecommendRequest,
  HearthstoneSimulateTurnRequest,
  HearthstoneTurnOptionsRequest,
} from '../types/hearthstone';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('getHello')
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('test-llm')
  async testLlm(
    @Query('prompt') prompt?: string,
    @Query('provider') provider?: string,
  ): Promise<string> {
    return this.appService.testAgent(prompt, provider);
  }

  @Post('hearthstone/recommend')
  recommend(
    @Body() payload: HearthstoneRecommendRequest,
  ) {
    return this.appService.recommendHearthstonePlan(payload);
  }

  @Post('hearthstone/turn-options')
  getTurnOptions(
    @Body() payload: HearthstoneTurnOptionsRequest,
  ) {
    return this.appService.getTurnOptions(payload);
  }

  @Post('hearthstone/simulate-turn')
  simulateTurn(
    @Body() payload: HearthstoneSimulateTurnRequest,
  ) {
    return this.appService.simulateTurn(payload);
  }

  @Post('hearthstone/cards/search')
  searchCards(
    @Body() payload: HearthstoneCardSearchRequest,
  ) {
    return this.appService.searchOfficialCards(payload);
  }

  @Post('hearthstone/cards/by-ids')
  searchCardsByIds(
    @Body() payload: HearthstoneCardsByIdsRequest,
  ) {
    return this.appService.searchCardsByIds(payload || { ids: [] });
  }

  @Post('hearthstone/cards/detail')
  cardDetail(
    @Body() payload: HearthstoneCardDetailRequest,
  ) {
    return this.appService.getCardDetail(payload || {});
  }

  @Post('hearthstone/cards/opening-hand')
  openingHand(
    @Body() payload: HearthstoneOpeningHandRequest,
  ) {
    return this.appService.getOpeningHand(payload);
  }

  @Post('hearthstone/metadata')
  metadata(
    @Body() payload: HearthstoneMetadataRequest,
  ) {
    return this.appService.getMetadata(payload || {});
  }

  @Post('hearthstone/deck')
  deck(
    @Body() payload: HearthstoneDeckRequest,
  ) {
    return this.appService.getDeck(payload);
  }
}
