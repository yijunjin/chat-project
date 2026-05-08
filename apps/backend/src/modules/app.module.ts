import { Module } from '@nestjs/common';
import { AppController } from '../controllers/app.controller';
import { AppService } from '../services/app.service';
import { BlizzardService } from '../services/blizzard.service';
import { GameLiveController } from '../controllers/game-live.controller';
import { PowerLogWatcherService } from '../services/power-log-watcher.service';
import { GameReplayService } from '../services/game-replay.service';

@Module({
  imports: [],
  controllers: [AppController, GameLiveController],
  providers: [AppService, BlizzardService, PowerLogWatcherService, GameReplayService],
})
export class AppModule {}
