import { Injectable } from '@nestjs/common';
import {
  HearthstoneCard,
  HearthstoneCardDetailField,
  HearthstoneMetadataClass,
  HearthstoneRelatedCard,
  HearthstoneMetadataSet,
} from '../types/hearthstone';

type Region = 'us' | 'eu' | 'kr' | 'tw' | 'cn';

@Injectable()
export class BlizzardService {
  private accessToken = '';
  private tokenExpireAt = 0;
  private readonly cardCache = new Map<string, { expiresAt: number; cards: HearthstoneCard[] }>();
  private readonly metadataCache = new Map<
    string,
    {
      expiresAt: number;
      classes: HearthstoneMetadataClass[];
      sets: HearthstoneMetadataSet[];
    }
  >();
  private readonly detailCache = new Map<
    string,
    {
      expiresAt: number;
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
    }
  >();
  private hsJsonCardsById = new Map<string, Record<string, unknown>>();
  private hsJsonExpireAt = 0;

  private readonly clientId = process.env.BLIZZARD_CLIENT_ID || '';
  private readonly clientSecret = process.env.BLIZZARD_CLIENT_SECRET || '';
  private readonly region = (process.env.BLIZZARD_REGION || 'us') as Region;
  private readonly defaultLocale = process.env.BLIZZARD_LOCALE || 'zh_CN';

  async getMetadata(params: {
    locale?: string;
  }): Promise<{ classes: HearthstoneMetadataClass[]; sets: HearthstoneMetadataSet[] } | null> {
    if (!this.clientId || !this.clientSecret) {
      return null;
    }

    const locale = params.locale || this.defaultLocale;
    const cacheKey = `metadata|${locale}`;
    const hit = this.metadataCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) {
      return {
        classes: hit.classes,
        sets: hit.sets,
      };
    }

    try {
      const token = await this.getAccessToken();
      if (!token) {
        return null;
      }

      const apiBase = this.getApiBase();
      const url = new URL(`${apiBase}/hearthstone/metadata`);
      url.searchParams.set('locale', locale);

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as {
        classes?: unknown[];
        sets?: unknown[];
      };

      const classes = this.normalizeMetadataClasses(data.classes || []);
      const sets = this.normalizeMetadataSets(data.sets || []);

      if (classes.length === 0 || sets.length === 0) {
        return null;
      }

      this.metadataCache.set(cacheKey, {
        expiresAt: Date.now() + 30 * 60 * 1000,
        classes,
        sets,
      });

      return {
        classes,
        sets,
      };
    } catch {
      return null;
    }
  }

  async searchCards(params: {
    query?: string;
    class?: string;
    cardSet?: 'standard' | 'wild';
    type?: 'spell' | 'minion' | 'weapon' | 'location' | 'hero';
    manaCost?: string;
    sort?: string;
    page?: number;
    pageSize?: number;
    locale?: string;
  }): Promise<HearthstoneCard[]> {
    const query = (params.query || '').trim();
    const heroClassSlug = this.mapHeroClass(params.class || '');
    const cardSet = params.cardSet === 'standard' || params.cardSet === 'wild' ? params.cardSet : '';
    const cardType = this.normalizeCardType(params.type);
    const manaCost = this.normalizeManaCost(params.manaCost);
    const page = this.clampNumber(params.page, 1, 50, 1);
    const pageSize = this.clampNumber(params.pageSize, 1, 450, 450);
    const locale = params.locale || 'en_US';
    const sort = (params.sort || 'manaCost:asc,name:asc,classes:asc,groupByClass:asc').trim();

    const cacheKey = `${query}|${heroClassSlug}|${cardSet}|${cardType}|${manaCost}|${sort}|${page}|${pageSize}|${locale}`;
    const hit = this.cardCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.cards;
    }

    const url = new URL('https://hearthstone.blizzard.com/en-us/api/cards');
    url.searchParams.set('locale', locale);
    url.searchParams.set('page', String(page));
    url.searchParams.set('pageSize', String(pageSize));
    url.searchParams.set('sort', sort);
    if (heroClassSlug) {
      url.searchParams.set('class', heroClassSlug);
    }
    if (cardSet) {
      url.searchParams.set('set', cardSet);
    }
    if (cardType) {
      url.searchParams.set('type', cardType);
    }
    if (manaCost) {
      url.searchParams.set('manaCost', manaCost);
    }
    if (query) {
      url.searchParams.set('textFilter', query);
      // Include both collectible and non-collectible cards for live-log IDs/tokens.
      url.searchParams.set('collectible', '0,1');
    }

    const response = await fetch(url.toString());

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as { cards?: unknown[] } | unknown[];
    const rawCards = Array.isArray(data)
      ? data
      : Array.isArray((data as { cards?: unknown[] })?.cards)
        ? ((data as { cards?: unknown[] }).cards || [])
        : [];
    let cards = this.normalizeCards(rawCards);

    if (query) {
      const q = query.toLowerCase();
      const likelyCardIdQuery = this.looksLikeCardId(query);
      if (!likelyCardIdQuery) {
        cards = cards.filter((item) => item.name.toLowerCase().includes(q));
      }
    }

    this.cardCache.set(cacheKey, {
      expiresAt: Date.now() + 5 * 60 * 1000,
      cards,
    });

    return cards;
  }

  async searchCardsByIds(params: {
    ids: string[];
    locale?: string;
    pageSize?: number;
  }): Promise<HearthstoneCard[]> {
    const ids = (params.ids || []).map((item) => String(item || '').trim()).filter((item) => !!item);
    if (ids.length === 0) {
      return [];
    }

    const locale = params.locale || 'zh_CN';
    const pageSize = this.clampNumber(params.pageSize, 1, 450, 450);
    const cacheKey = `ids|${ids.join(',')}|${locale}|${pageSize}`;
    const hit = this.cardCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.cards;
    }

    const url = new URL('https://hearthstone.blizzard.com/en-us/api/cards');
    url.searchParams.set('ids', ids.join(','));
    url.searchParams.set('pageSize', String(pageSize));
    url.searchParams.set('locale', locale);

    const response = await fetch(url.toString());
    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as { cards?: unknown[] } | unknown[];
    const rawCards = Array.isArray(data)
      ? data
      : Array.isArray((data as { cards?: unknown[] })?.cards)
        ? ((data as { cards?: unknown[] }).cards || [])
        : [];

    const cards = this.normalizeCards(rawCards)
      .filter((item) => ids.includes(item.id))
      .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));

    this.cardCache.set(cacheKey, {
      expiresAt: Date.now() + 5 * 60 * 1000,
      cards,
    });

    return cards;
  }

  async fetchDeck(params: { code: string; locale?: string }): Promise<HearthstoneCard[]> {
    const deckCode = (params.code || '').trim();
    if (!deckCode) {
      return [];
    }

    const locale = params.locale || 'en_US';
    const cacheKey = `deck|${deckCode}|${locale}`;
    const hit = this.cardCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.cards;
    }

    try {
      const url = new URL('https://hearthstone.blizzard.com/en-us/api/cards/deck');
      url.searchParams.set('code', deckCode);
      url.searchParams.set('locale', locale);

      const response = await fetch(url.toString());
      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as { cards?: unknown[] } | unknown[];
      const rawCards = Array.isArray(data)
        ? data
        : Array.isArray((data as { cards?: unknown[] })?.cards)
          ? ((data as { cards?: unknown[] }).cards || [])
          : [];

      const cards = this.normalizeCards(rawCards);

      this.cardCache.set(cacheKey, {
        expiresAt: Date.now() + 10 * 60 * 1000,
        cards,
      });

      return cards;
    } catch {
      return [];
    }
  }

  async getCardDetail(params: {
    cardSlug?: string;
    cardId?: string;
    cardName?: string;
    cardType?: string;
    cardCost?: number;
    locale?: string;
  }): Promise<{
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
  } | null> {
    if (!this.clientId || !this.clientSecret) {
      return null;
    }

    const locale = params.locale || this.defaultLocale || 'en_US';
    const cardSlug = (params.cardSlug || '').trim();
    const cardId = (params.cardId || '').trim();
    const cardName = (params.cardName || '').trim();
    const cacheKey = `detail|${cardSlug}|${cardId}|${cardName}|${params.cardType || ''}|${params.cardCost ?? ''}|${locale}`;
    const hit = this.detailCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) {
      return {
        cardId: hit.cardId,
        slug: hit.slug,
        name: hit.name,
        imageUrl: hit.imageUrl,
        flavorText: hit.flavorText,
        cardLevel: hit.cardLevel,
        artistName: hit.artistName,
        relatedCards: hit.relatedCards,
        details: hit.details,
        raw: hit.raw,
      };
    }

    try {
      const token = await this.getAccessToken();
      if (!token) {
        return null;
      }

      const normalizedIdCandidates = cardId ? this.buildCardIdCandidates(cardId) : [];
      const pathCandidates = [cardSlug, cardId, ...normalizedIdCandidates]
        .map((item) => (item || '').trim())
        .filter((item, index, arr) => !!item && arr.indexOf(item) === index);
      if (pathCandidates.length === 0) {
        return null;
      }

      const locales = [locale, 'en_US', this.defaultLocale]
        .filter((item, index, arr) => !!item && arr.indexOf(item) === index);

      const apiBase = this.getApiBase();
      for (const path of pathCandidates) {
        for (const activeLocale of locales) {
          const raw = await this.fetchCardRawByPath({
            apiBase,
            token,
            path,
            locale: activeLocale,
          });
          if (!raw) {
            continue;
          }
          const normalized = this.normalizeCardDetail(raw, path);
          if (!normalized) {
            continue;
          }

          const childIds = this.extractChildIds(raw);
          const relatedCards = await this.fetchRelatedCards({
            apiBase,
            token,
            childIds,
            localeCandidates: locales,
          });

          normalized.relatedCards = relatedCards;

          this.detailCache.set(cacheKey, {
            expiresAt: Date.now() + 20 * 60 * 1000,
            ...normalized,
          });

          return normalized;
        }
      }

      if (cardName) {
        const matched = await this.findBestCardByName({
          cardName,
          cardType: params.cardType,
          cardCost: params.cardCost,
          locale,
        });
        if (matched) {
          const nameCandidates = [matched.id, matched.slug]
            .map((item) => (item || '').trim())
            .filter((item, index, arr) => !!item && arr.indexOf(item) === index);

          for (const path of nameCandidates) {
            for (const activeLocale of locales) {
              const raw = await this.fetchCardRawByPath({
                apiBase,
                token,
                path,
                locale: activeLocale,
              });
              if (!raw) {
                continue;
              }
              const normalized = this.normalizeCardDetail(raw, path);
              if (!normalized) {
                continue;
              }

              const childIds = this.extractChildIds(raw);
              const relatedCards = await this.fetchRelatedCards({
                apiBase,
                token,
                childIds,
                localeCandidates: locales,
              });

              normalized.relatedCards = relatedCards;

              this.detailCache.set(cacheKey, {
                expiresAt: Date.now() + 20 * 60 * 1000,
                ...normalized,
              });

              return normalized;
            }
          }
        }
      }

      const hsJsonResolved = await this.resolveByHsJson({
        cardId,
        cardName,
        cardType: params.cardType,
        cardCost: params.cardCost,
        locale,
      });
      if (hsJsonResolved) {
        this.detailCache.set(cacheKey, {
          expiresAt: Date.now() + 20 * 60 * 1000,
          ...hsJsonResolved,
        });
        return hsJsonResolved;
      }

      return null;
    } catch {
      return null;
    }
  }

  private toHsJsonLocale(locale: string): string {
    const raw = (locale || '').toLowerCase();
    if (raw.startsWith('zh')) return 'zhCN';
    if (raw.startsWith('en')) return 'enUS';
    return 'enUS';
  }

  private hsJsonTypeToInternal(value: unknown): 'spell' | 'minion' | 'weapon' | 'location' | 'hero' | null {
    const raw = String(value || '').toUpperCase();
    if (raw === 'SPELL') return 'spell';
    if (raw === 'MINION') return 'minion';
    if (raw === 'WEAPON') return 'weapon';
    if (raw === 'LOCATION') return 'location';
    if (raw === 'HERO') return 'hero';
    return null;
  }

  private async ensureHsJsonCards(locale: string): Promise<void> {
    if (this.hsJsonCardsById.size > 0 && this.hsJsonExpireAt > Date.now()) {
      return;
    }

    const hsLocale = this.toHsJsonLocale(locale);
    const url = `https://api.hearthstonejson.com/v1/latest/${hsLocale}/cards.json`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`hsjson fetch failed: ${response.status}`);
    }
    const data = (await response.json()) as unknown[];
    const map = new Map<string, Record<string, unknown>>();
    for (const item of data) {
      if (!item || typeof item !== 'object') continue;
      const card = item as Record<string, unknown>;
      const id = String(card.id || '').trim();
      if (!id) continue;
      map.set(id, card);
    }
    this.hsJsonCardsById = map;
    this.hsJsonExpireAt = Date.now() + 12 * 60 * 60 * 1000;
  }

  private buildHsJsonImageUrl(cardId: string, locale: string): string {
    const hsLocale = this.toHsJsonLocale(locale);
    return `https://art.hearthstonejson.com/v1/render/latest/${hsLocale}/512x/${encodeURIComponent(cardId)}.png`;
  }

  private async resolveByHsJson(params: {
    cardId?: string;
    cardName?: string;
    cardType?: string;
    cardCost?: number;
    locale: string;
  }): Promise<{
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
  } | null> {
    try {
      await this.ensureHsJsonCards(params.locale);
    } catch {
      return null;
    }

    const candidateIds = [
      ...this.buildCardIdCandidates((params.cardId || '').trim()),
      ...this.buildCardIdCandidates((params.cardName || '').trim()),
    ].filter((item, index, arr) => !!item && arr.indexOf(item) === index);

    let raw: Record<string, unknown> | null = null;
    for (const id of candidateIds) {
      const hit = this.hsJsonCardsById.get(id);
      if (hit) {
        raw = hit;
        break;
      }
    }

    if (!raw && params.cardName && !this.looksLikeCardId(params.cardName)) {
      const targetName = this.normalizeLookupName(params.cardName);
      const byType = this.normalizeLookupType(params.cardType);
      const targetCost = typeof params.cardCost === 'number' ? this.clampNumber(params.cardCost, 0, 20, -1) : null;

      let best: Record<string, unknown> | null = null;
      let bestScore = -1;
      for (const card of this.hsJsonCardsById.values()) {
        const name = this.normalizeLookupName(String(card.name || ''));
        if (!name) continue;
        let score = 0;
        if (name === targetName) score += 100;
        else if (name.includes(targetName) || targetName.includes(name)) score += 40;

        const mappedType = this.hsJsonTypeToInternal(card.type);
        if (byType && mappedType === byType) score += 15;
        if (targetCost !== null && Number(card.cost) === targetCost) score += 10;

        if (score > bestScore) {
          bestScore = score;
          best = card;
        }
      }
      raw = best;
    }

    if (!raw) {
      return null;
    }

    const id = String(raw.id || '').trim();
    const name = String(raw.name || '').trim();
    if (!id || !name) {
      return null;
    }

    const details = Object.entries(raw)
      .map(([key, value]) => {
        const normalized = this.stringifyDetailValue(value);
        if (!normalized) return null;
        return {
          key,
          value: key === 'text' || key === 'flavor' ? this.cleanText(normalized) : normalized,
        } as HearthstoneCardDetailField;
      })
      .filter((item): item is HearthstoneCardDetailField => !!item)
      .slice(0, 60);

    return {
      cardId: id,
      slug: id,
      name,
      imageUrl: this.buildHsJsonImageUrl(id, params.locale),
      flavorText: this.cleanText(String(raw.flavor || raw.flavorText || '')),
      cardLevel: this.stringifyDetailValue(raw.rarity) || '-',
      artistName: this.stringifyDetailValue(raw.artist) || '-',
      relatedCards: [],
      details,
      raw,
    };
  }

  private normalizeLookupName(value: string): string {
    return value.replace(/\s+/g, '').toLowerCase();
  }

  private looksLikeCardId(value: string): boolean {
    const raw = (value || '').trim();
    return !!raw && /_/.test(raw) && /^[A-Za-z0-9_]+$/.test(raw);
  }

  private buildCardIdCandidates(cardId: string): string[] {
    const raw = (cardId || '').trim();
    if (!raw) return [];

    const out: string[] = [];
    const push = (v: string) => {
      const value = (v || '').trim();
      if (!value) return;
      if (!out.includes(value)) out.push(value);
    };

    const pushForms = (v: string) => {
      push(v);
      push(v.toLowerCase());
      push(v.toLowerCase().replace(/_/g, '-'));
    };

    pushForms(raw);

    // Token/variant suffix candidates, e.g. CATA_479t3 -> CATA_479
    const trimTokenSuffix = raw.replace(/t\d+[a-z]*$/i, '');
    if (trimTokenSuffix && trimTokenSuffix !== raw) {
      pushForms(trimTokenSuffix);
    }

    const trimBareToken = raw.replace(/t$/i, '');
    if (trimBareToken && trimBareToken !== raw) {
      pushForms(trimBareToken);
    }

    const trimSingleVariant = raw.replace(/([A-Za-z]+_\d+)[A-Za-z]$/i, '$1');
    if (trimSingleVariant && trimSingleVariant !== raw) {
      pushForms(trimSingleVariant);
    }

    return out;
  }

  private normalizeLookupType(value?: string): 'spell' | 'minion' | 'weapon' | 'location' | 'hero' | undefined {
    if (!value) return undefined;
    const raw = value.trim().toLowerCase();
    if (raw === 'spell' || raw === 'minion' || raw === 'weapon' || raw === 'location' || raw === 'hero') {
      return raw;
    }
    return undefined;
  }

  private async findBestCardByName(params: {
    cardName: string;
    cardType?: string;
    cardCost?: number;
    locale: string;
  }): Promise<HearthstoneCard | null> {
    const byType = this.normalizeLookupType(params.cardType);
    const queryCandidates = this.looksLikeCardId(params.cardName)
      ? this.buildCardIdCandidates(params.cardName)
      : [params.cardName];

    const merged: HearthstoneCard[] = [];
    for (const query of queryCandidates) {
      const cards = await this.searchCards({
        query,
        type: byType,
        locale: params.locale,
        page: 1,
        pageSize: 100,
      });
      for (const card of cards) {
        if (!merged.some((item) => item.id === card.id)) {
          merged.push(card);
        }
      }
    }

    const cards = merged;

    if (cards.length === 0) {
      return null;
    }

    const targetName = this.normalizeLookupName(params.cardName);
    const targetCost = typeof params.cardCost === 'number' ? this.clampNumber(params.cardCost, 0, 20, -1) : null;
    const targetIdCandidates = this.looksLikeCardId(params.cardName)
      ? this.buildCardIdCandidates(params.cardName).map((item) => this.normalizeLookupName(item.replace(/-/g, '_')))
      : [];

    let best: HearthstoneCard | null = null;
    let bestScore = -1;
    for (const card of cards) {
      let score = 0;
      const normalizedCardName = this.normalizeLookupName(card.name || '');
      if (normalizedCardName === targetName) {
        score += 100;
      } else if (normalizedCardName.includes(targetName) || targetName.includes(normalizedCardName)) {
        score += 40;
      }

      if (byType && card.type === byType) {
        score += 15;
      }

      if (targetCost !== null && card.cost === targetCost) {
        score += 10;
      }

      const normalizedCardId = this.normalizeLookupName(String(card.id || '').replace(/-/g, '_'));
      const normalizedSlug = this.normalizeLookupName(String(card.slug || '').replace(/-/g, '_'));
      if (targetIdCandidates.includes(normalizedCardId)) {
        score += 120;
      }
      if (targetIdCandidates.some((candidate) => normalizedSlug.includes(candidate))) {
        score += 80;
      }

      if (score > bestScore) {
        bestScore = score;
        best = card;
      }
    }

    return best;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && this.tokenExpireAt > Date.now()) {
      return this.accessToken;
    }

    if (!this.clientId || !this.clientSecret) {
      return '';
    }

    const oauthBase = this.getOauthBase();
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
    });

    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const response = await fetch(`${oauthBase}/oauth/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    if (!response.ok) {
      return '';
    }

    const data = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };

    if (!data.access_token) {
      return '';
    }

    this.accessToken = data.access_token;
    const ttl = typeof data.expires_in === 'number' ? data.expires_in : 3600;
    this.tokenExpireAt = Date.now() + Math.max(300, ttl - 120) * 1000;
    return this.accessToken;
  }

  private normalizeCards(rawCards: unknown[]): HearthstoneCard[] {
    return rawCards
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const card = item as {
          id?: unknown;
          slug?: unknown;
          name?: unknown;
          manaCost?: unknown;
          text?: unknown;
          flavorText?: unknown;
          cardTypeId?: unknown;
          minionTypeId?: unknown;
          minionTypeName?: unknown;
          classId?: unknown;
          className?: unknown;
          cardSetId?: unknown;
          cardSetName?: unknown;
          rarityId?: unknown;
          rarityName?: unknown;
          collectible?: unknown;
          craftingCost?: unknown;
          dustValue?: unknown;
          artistName?: unknown;
          childIds?: unknown;
          cropImage?: unknown;
          image?: unknown;
        };
        if (typeof card.id !== 'number' && typeof card.id !== 'string') {
          return null;
        }
        if (typeof card.name !== 'string' || !card.name.trim()) {
          return null;
        }
        const mappedType = this.mapCardType(card.cardTypeId);
        if (!mappedType) {
          return null;
        }
        return {
          id: String(card.id),
          slug: typeof card.slug === 'string' ? card.slug : undefined,
          name: card.name,
          cost: this.clampNumber(card.manaCost as number, 0, 20, 0),
          text: this.cleanText(typeof card.text === 'string' ? card.text : ''),
          type: mappedType,
          cropImageUrl: typeof card.cropImage === 'string' ? card.cropImage : undefined,
          imageUrl: typeof card.image === 'string' ? card.image : undefined,
          flavorText: this.cleanText(typeof card.flavorText === 'string' ? card.flavorText : ''),
          artistName: typeof card.artistName === 'string' ? card.artistName : undefined,
          classId: typeof card.classId === 'number' ? card.classId : undefined,
          className: typeof card.className === 'string' ? card.className : undefined,
          cardSetId: typeof card.cardSetId === 'number' ? card.cardSetId : undefined,
          cardSetName: typeof card.cardSetName === 'string' ? card.cardSetName : undefined,
          rarityId: typeof card.rarityId === 'number' ? card.rarityId : undefined,
          rarityName: typeof card.rarityName === 'string' ? card.rarityName : undefined,
          collectible: typeof card.collectible === 'boolean' ? card.collectible : undefined,
          craftingCost: typeof card.craftingCost === 'number' ? card.craftingCost : undefined,
          dustValue: typeof card.dustValue === 'number' ? card.dustValue : undefined,
          minionTypeId: typeof card.minionTypeId === 'number' ? card.minionTypeId : undefined,
          minionTypeName: typeof card.minionTypeName === 'string' ? card.minionTypeName : undefined,
          cardTypeId: typeof card.cardTypeId === 'number' ? card.cardTypeId : undefined,
          childIds: Array.isArray(card.childIds)
            ? card.childIds
              .map((item) => (typeof item === 'number' || typeof item === 'string' ? String(item) : ''))
              .filter((item) => !!item)
            : undefined,
        } as HearthstoneCard;
      })
      .filter((item): item is NonNullable<typeof item> => !!item);
  }

  private normalizeMetadataClasses(rawClasses: unknown[]): HearthstoneMetadataClass[] {
    return rawClasses
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const cls = item as { id?: unknown; slug?: unknown; name?: unknown };
        if (typeof cls.id !== 'number') {
          return null;
        }
        if (typeof cls.slug !== 'string' || !cls.slug.trim()) {
          return null;
        }
        if (typeof cls.name !== 'string' || !cls.name.trim()) {
          return null;
        }
        return {
          id: cls.id,
          slug: cls.slug,
          name: cls.name,
        } as HearthstoneMetadataClass;
      })
      .filter((item): item is HearthstoneMetadataClass => !!item)
      .sort((a, b) => a.id - b.id);
  }

  private normalizeMetadataSets(rawSets: unknown[]): HearthstoneMetadataSet[] {
    return rawSets
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const set = item as { id?: unknown; slug?: unknown; name?: unknown };
        if (typeof set.id !== 'number') {
          return null;
        }
        if (typeof set.slug !== 'string' || !set.slug.trim()) {
          return null;
        }
        if (typeof set.name !== 'string' || !set.name.trim()) {
          return null;
        }
        return {
          id: set.id,
          slug: set.slug,
          name: set.name,
        } as HearthstoneMetadataSet;
      })
      .filter((item): item is HearthstoneMetadataSet => !!item)
      .sort((a, b) => a.id - b.id);
  }

  private cleanText(text: string): string {
    return text
      .replace(/<[^>]+>/g, '')
      .replace(/\[x\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private normalizeCardDetail(
    raw: Record<string, unknown>,
    requestedPath: string,
  ): {
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
  } | null {
    const idValue = raw.id;
    const nameValue = raw.name;
    if ((typeof idValue !== 'number' && typeof idValue !== 'string') || typeof nameValue !== 'string') {
      return null;
    }

    const details = Object.entries(raw)
      .map(([key, value]) => {
        const normalized = this.stringifyDetailValue(value);
        if (!normalized) {
          return null;
        }
        return {
          key,
          value: key === 'text' || key === 'flavorText' ? this.cleanText(normalized) : normalized,
        } as HearthstoneCardDetailField;
      })
      .filter((item): item is HearthstoneCardDetailField => !!item)
      .slice(0, 60);

    return {
      cardId: String(idValue),
      slug: typeof raw.slug === 'string' && raw.slug ? raw.slug : requestedPath,
      name: nameValue,
      imageUrl: typeof raw.image === 'string' ? raw.image : undefined,
      flavorText: this.cleanText(this.stringifyDetailValue(raw.flavorText) || ''),
      cardLevel: this.stringifyDetailValue(raw.rarityName) || this.stringifyDetailValue(raw.rarityId) || '-',
      artistName: this.stringifyDetailValue(raw.artistName) || '-',
      relatedCards: [],
      details,
      raw,
    };
  }

  private async fetchCardRawByPath(params: {
    apiBase: string;
    token: string;
    path: string;
    locale: string;
  }): Promise<Record<string, unknown> | null> {
    const url = new URL(`${params.apiBase}/hearthstone/cards/${encodeURIComponent(params.path)}`);
    url.searchParams.set('locale', params.locale);
    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${params.token}`,
      },
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as Record<string, unknown>;
  }

  private extractChildIds(raw: Record<string, unknown>): string[] {
    const childIds = raw.childIds;
    if (!Array.isArray(childIds)) {
      return [];
    }
    return childIds
      .map((item) => {
        if (typeof item === 'number' || typeof item === 'string') {
          return String(item);
        }
        return '';
      })
      .filter((item, index, arr) => !!item && arr.indexOf(item) === index)
      .slice(0, 8);
  }

  private async fetchRelatedCards(params: {
    apiBase: string;
    token: string;
    childIds: string[];
    localeCandidates: string[];
  }): Promise<HearthstoneRelatedCard[]> {
    if (params.childIds.length === 0) {
      return [];
    }

    const tasks = params.childIds.map(async (id) => {
      for (const locale of params.localeCandidates) {
        const raw = await this.fetchCardRawByPath({
          apiBase: params.apiBase,
          token: params.token,
          path: id,
          locale,
        });
        if (!raw) {
          continue;
        }
        const name = this.stringifyDetailValue(raw.name);
        if (!name) {
          continue;
        }
        return {
          id: String(raw.id ?? id),
          name,
          cost: this.clampNumber(Number(raw.manaCost), 0, 20, 0),
          cropImageUrl: this.stringifyDetailValue(raw.cropImage) || undefined,
          imageUrl: this.stringifyDetailValue(raw.image) || undefined,
        } as HearthstoneRelatedCard;
      }
      return null;
    });

    const resolved = await Promise.all(tasks);
    return resolved.filter((item): item is HearthstoneRelatedCard => !!item);
  }

  private stringifyDetailValue(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return '';
      }
      const primitiveItems = value
        .map((item) => this.stringifyDetailValue(item))
        .filter((item) => !!item);
      return primitiveItems.join(', ');
    }
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      if (typeof obj.name === 'string') {
        return obj.name;
      }
      try {
        return JSON.stringify(obj);
      } catch {
        return '';
      }
    }
    return '';
  }

  private mapCardType(cardTypeId: unknown): 'spell' | 'minion' | 'weapon' | 'location' | 'hero' | null {
    const id = Number(cardTypeId);
    if (id === 3) {
      return 'hero';
    }
    if (id === 4) {
      return 'minion';
    }
    if (id === 5) {
      return 'spell';
    }
    if (id === 7) {
      return 'weapon';
    }
    if (id === 39) {
      return 'location';
    }
    return null;
  }

  private normalizeCardType(
    value?: 'spell' | 'minion' | 'weapon' | 'location' | 'hero',
  ): string {
    if (!value) {
      return '';
    }
    const allowed = ['spell', 'minion', 'weapon', 'location', 'hero'];
    return allowed.includes(value) ? value : '';
  }

  private mapHeroClass(heroClass: string): string {
    const raw = heroClass.trim().toLowerCase();
    const mapping: Record<string, string> = {
      mage: 'mage',
      法师: 'mage',
      druid: 'druid',
      德鲁伊: 'druid',
      paladin: 'paladin',
      骑士: 'paladin',
      warrior: 'warrior',
      战士: 'warrior',
      priest: 'priest',
      牧师: 'priest',
      rogue: 'rogue',
      潜行者: 'rogue',
      hunter: 'hunter',
      猎人: 'hunter',
      shaman: 'shaman',
      萨满: 'shaman',
      warlock: 'warlock',
      术士: 'warlock',
      demonhunter: 'demonhunter',
      恶魔猎手: 'demonhunter',
      deathknight: 'deathknight',
      死亡骑士: 'deathknight',
    };
    return mapping[raw] || '';
  }

  private normalizeManaCost(value?: string): string {
    const raw = (value || '').trim();
    if (!raw) {
      return '';
    }
    const normalized = raw
      .split(',')
      .map((item) => item.trim())
      .filter((item) => /^\d{1,2}\^?$/.test(item));
    return normalized.join(',');
  }

  private getApiBase(): string {
    if (this.region === 'cn') {
      return 'https://gateway.battlenet.com.cn';
    }
    return `https://${this.region}.api.blizzard.com`;
  }

  private getOauthBase(): string {
    if (this.region === 'cn') {
      return 'https://www.battlenet.com.cn';
    }
    return 'https://oauth.battle.net';
  }

  private clampNumber(
    value: number,
    min: number,
    max: number,
    fallback: number,
  ): number {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, Math.round(value)));
  }
}
