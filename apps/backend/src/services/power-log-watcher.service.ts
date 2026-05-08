import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { StringDecoder } from 'string_decoder';
import { PowerLogParser } from '../parsers/power-log.parser';
import { GameStateMachine } from '../state/game-state-machine';
import type { LiveGameEvent } from '../types/hearthstone';

/** All active SSE clients */
type SseClient = {
  id: number;
  res: import('express').Response;
};

/** Delays (ms) for retrying folder attachment when Power.log does not exist yet */
const FOLDER_RETRY_DELAYS = [1000, 2000, 4000, 8000];

@Injectable()
export class PowerLogWatcherService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PowerLogWatcherService.name);

  /** Log root directory from HS_LOG_PATH env */
  private logRoot: string;
  /** Configured account name for self-identification */
  private myPlayerName: string;

  private parser = new PowerLogParser();
  stateMachine: GameStateMachine;

  /** Currently watched Power.log path */
  private currentLogPath: string | null = null;
  private currentLogFd: number | null = null;
  private currentOffset = 0;
  private pendingLineFragment = '';
  private utf8Decoder = new StringDecoder('utf8');

  /** Poll interval handle */
  private pollInterval: NodeJS.Timeout | null = null;
  /** Directory watch handle */
  private dirWatcher: fs.FSWatcher | null = null;

  /** SSE client registry */
  private clients = new Map<number, SseClient>();
  private nextClientId = 1;
  /** Heartbeat interval to keep SSE connections alive */
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.logRoot = process.env.HS_LOG_PATH ?? 'F:\\Hearthstone\\Logs';
    this.myPlayerName = process.env.HS_PLAYER_NAME ?? '';
    this.stateMachine = new GameStateMachine(this.myPlayerName);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  onApplicationBootstrap(): void {
    this.stateMachine.on('state_changed', (event: LiveGameEvent) => {
      this.broadcast(event);
    });
    this.stateMachine.on('my_turn_start', (event: LiveGameEvent) => {
      this.broadcast(event);
    });

    this.startWatching();
    this.startHeartbeat();
  }

  onApplicationShutdown(): void {
    this.stopWatching();
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  // ── Directory watching (detect new game session folder) ───────────────────

  private startWatching(): void {
    if (!fs.existsSync(this.logRoot)) {
      this.logger.warn(`HS_LOG_PATH does not exist: ${this.logRoot}. Watcher disabled.`);
      return;
    }

    // Attach to the most recent session folder immediately
    const latestFolder = this.findLatestSessionFolder();
    if (latestFolder) {
      this.attachToFolderWithRetry(latestFolder, 0);
    }

    // Watch for new sub-folders (new game sessions)
    try {
      this.dirWatcher = fs.watch(this.logRoot, (eventType, filename) => {
        if (eventType === 'rename' && filename) {
          const candidate = path.join(this.logRoot, filename);
          // Retry with backoff: the folder is created before Power.log is written
          setTimeout(() => {
            if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
              this.logger.log(`New session folder detected: ${candidate}`);
              this.attachToFolderWithRetry(candidate, 0);
            }
          }, 500);
        }
      });
    } catch (err) {
      this.logger.error(`Failed to watch log root: ${err}`);
    }
  }

  private stopWatching(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.dirWatcher) {
      this.dirWatcher.close();
      this.dirWatcher = null;
    }
    this.closeCurrentFd();
  }

  private closeCurrentFd(): void {
    if (this.currentLogFd !== null) {
      try { fs.closeSync(this.currentLogFd); } catch { /* ignore */ }
      this.currentLogFd = null;
    }
    this.currentOffset = 0;
    this.pendingLineFragment = '';
    this.utf8Decoder.end();
    this.utf8Decoder = new StringDecoder('utf8');
  }

  // ── Session folder helpers ─────────────────────────────────────────────────

  private findLatestSessionFolder(): string | null {
    try {
      const entries = fs.readdirSync(this.logRoot, { withFileTypes: true });
      const dirs = entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort()
        .reverse(); // Lexicographic descending = most recent first (YYYY_MM_DD_HH_MM_SS)
      if (dirs.length === 0) return null;
      return path.join(this.logRoot, dirs[0]);
    } catch {
      return null;
    }
  }

  /** Attach to a folder, retrying if Power.log does not exist yet */
  private attachToFolderWithRetry(folderPath: string, attempt: number): void {
    const logPath = path.join(folderPath, 'Power.log');
    if (!fs.existsSync(logPath)) {
      if (attempt < FOLDER_RETRY_DELAYS.length) {
        const delay = FOLDER_RETRY_DELAYS[attempt];
        this.logger.log(
          `Power.log not ready in ${folderPath}, retrying in ${delay}ms (attempt ${attempt + 1}/${FOLDER_RETRY_DELAYS.length})`,
        );
        setTimeout(() => this.attachToFolderWithRetry(folderPath, attempt + 1), delay);
      } else {
        this.logger.warn(`Power.log never appeared in ${folderPath}, giving up`);
      }
      return;
    }
    this.attachToFolder(folderPath);
  }

  private attachToFolder(folderPath: string): void {
    // Prefer active Power.log; fall back to Power_old.log
    let logPath = path.join(folderPath, 'Power.log');
    if (!fs.existsSync(logPath)) {
      logPath = path.join(folderPath, 'Power_old.log');
      if (!fs.existsSync(logPath)) {
        this.logger.warn(`No Power.log found in ${folderPath}`);
        return;
      }
    }

    if (logPath === this.currentLogPath) return; // already attached

    this.logger.log(`[PowerLogWatcher] Watching: ${logPath}`);
    this.closeCurrentFd();
    this.currentLogPath = logPath;
    this.currentOffset = 0;
    this.pendingLineFragment = '';
    this.utf8Decoder = new StringDecoder('utf8');
    this.parser.reset();
    this.stateMachine.reset();

    // Open for reading; read entire existing content first (history) in silent mode
    try {
      this.currentLogFd = fs.openSync(logPath, 'r');
      this.stateMachine.setSilent(true);
      this.readNewLines(); // Catch up on existing content without broadcasting every line
      this.stateMachine.setSilent(false);
    } catch (err) {
      this.logger.error(`Cannot open ${logPath}: ${err}`);
      this.stateMachine.setSilent(false);
      return;
    }

    // Start or restart poll interval
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.pollInterval = setInterval(() => this.readNewLines(), 200);
  }

  // ── File tail-read ─────────────────────────────────────────────────────────

  private readNewLines(): void {
    if (this.currentLogFd === null || this.currentLogPath === null) return;

    let size: number;
    try {
      size = fs.statSync(this.currentLogPath).size;
    } catch {
      return;
    }

    if (size <= this.currentOffset) {
      // Check if the file was replaced (new game in same folder)
      if (size < this.currentOffset) {
        this.logger.log('Power.log truncated, resetting offset');
        this.currentOffset = 0;
        this.pendingLineFragment = '';
        this.utf8Decoder.end();
        this.utf8Decoder = new StringDecoder('utf8');
        this.parser.reset();
        this.stateMachine.reset();
      }
      return;
    }

    const bytesToRead = size - this.currentOffset;
    const buf = Buffer.alloc(bytesToRead);
    let bytesRead: number;
    try {
      bytesRead = fs.readSync(this.currentLogFd, buf, 0, bytesToRead, this.currentOffset);
    } catch {
      return;
    }
    this.currentOffset += bytesRead;

    const chunk = this.utf8Decoder.write(buf.subarray(0, bytesRead));
    const text = this.pendingLineFragment + chunk;
    const lines = text.split(/\r?\n/);
    this.pendingLineFragment = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const event = this.parser.parseLine(trimmed);
        if (event) {
          this.stateMachine.processEvent(event);
        }
      } catch (err) {
        this.logger.debug(`Parse error on line "${trimmed.slice(0, 80)}": ${err}`);
      }
    }
  }

  // ── SSE client management ──────────────────────────────────────────────────

  addClient(res: import('express').Response): number {
    const id = this.nextClientId++;
    this.clients.set(id, { id, res });
    this.logger.log(`SSE client #${id} connected (total: ${this.clients.size})`);

    // Send current snapshot immediately
    const snapshot = this.stateMachine.buildLiveEvent('state_update');
    this.sendToClient(res, snapshot);

    return id;
  }

  removeClient(id: number): void {
    this.clients.delete(id);
    this.logger.log(`SSE client #${id} disconnected (total: ${this.clients.size})`);
  }

  private broadcast(event: LiveGameEvent): void {
    if (this.clients.size === 0) return;
    for (const client of this.clients.values()) {
      this.sendToClient(client.res, event);
    }
  }

  /** Send SSE comment heartbeat every 15s to prevent proxy/browser timeouts */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      for (const client of this.clients.values()) {
        try {
          client.res.write(': heartbeat\n\n');
        } catch { /* client disconnected */ }
      }
    }, 15_000);
  }

  private sendToClient(res: import('express').Response, event: LiveGameEvent): void {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      // Client disconnected; removal handled by 'close' event on the Request
    }
  }

  /** Returns a snapshot of the current game state */
  getCurrentState(): LiveGameEvent {
    return this.stateMachine.buildLiveEvent('state_update');
  }

  /** Returns a rich debug snapshot for diagnosing state mismatches */
  getDebugSnapshot(): Record<string, unknown> {
    return {
      logRoot: this.logRoot,
      currentLogPath: this.currentLogPath,
      currentOffset: this.currentOffset,
      pendingLineFragmentLength: this.pendingLineFragment.length,
      sseClientCount: this.clients.size,
      myPlayerNameConfig: this.myPlayerName,
      stateMachine: this.stateMachine.getDebugSnapshot(),
    };
  }
}
