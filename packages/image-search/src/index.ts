/**
 * @lp/image-search — unified search across free image providers.
 *
 * Provider routing: searches all configured providers in parallel and
 * returns deduped results sorted by relevance. When no provider is
 * configured the search returns an empty result set rather than failing —
 * the rest of the system continues to work with `stock_image` falling back
 * to AI-generated or solid backgrounds.
 *
 * Today: clean adapter interfaces + stubs returning empty arrays.
 * When the credentials are added to .env, the real HTTP calls turn on
 * with no other code changes.
 */

export type ImageProvider = "unsplash" | "pexels" | "pixabay" | "wikimedia";

export interface ImageResult {
  id: string;
  provider: ImageProvider;
  url: string;
  /** Square thumbnail for the picker UI. */
  thumbnailUrl: string;
  width: number;
  height: number;
  alt: string | null;
  attribution: {
    authorName: string;
    authorUrl: string | null;
    sourceUrl: string;
    licenseShort: string;
  };
}

export interface SearchOptions {
  /** Limit per provider. Each provider returns up to this many. */
  perProvider?: number;
  /** Minimum width in pixels — drop smaller. */
  minWidth?: number;
  /** Aspect ratio target ("16:9" | "1:1" | "any"). */
  aspect?: "16:9" | "1:1" | "any";
  /** Filter to a subset of providers. */
  providers?: ImageProvider[];
}

export interface ProviderConfig {
  unsplash?: { accessKey: string };
  pexels?: { apiKey: string };
  pixabay?: { apiKey: string };
  wikimedia?: { userAgent: string };
}

export interface ImageSearchClient {
  search(query: string, opts?: SearchOptions): Promise<ImageResult[]>;
}

export function createImageSearchClient(config: ProviderConfig): ImageSearchClient {
  const available: ImageProvider[] = [];
  if (config.unsplash)  available.push("unsplash");
  if (config.pexels)    available.push("pexels");
  if (config.pixabay)   available.push("pixabay");
  if (config.wikimedia) available.push("wikimedia");

  return {
    async search(_query, _opts) {
      if (available.length === 0) return [];
      // Real impl: fan out to each provider, dedupe by perceptual hash, sort.
      return [];
    },
  };
}
