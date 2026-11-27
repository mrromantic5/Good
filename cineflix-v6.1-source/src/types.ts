/* CineFliX domain models — every UI module consumes only these shapes. */

export type TitleType = 1 | 2; // 1 = movie, 2 = series

export interface Title {
  id: string;
  type: TitleType;
  isSeries: boolean;
  title: string;
  description: string;
  releaseDate: string;
  year: string;
  duration: number; // seconds
  genres: string[];
  country: string;
  rating: number;
  ratingCount: number;
  poster: string;
  posterHue: string;
  backdrop: string;
  trailer: string;
  detailPath: string;
  subtitles: string[];
  corner: string;
  hasResource: boolean;
  dubs: RawDub[];
  bannerImage?: string;
  bannerTitle?: string;
}

export interface Pager { page: number; nextPage: number | null; hasMore: boolean; perPage: number; total: number }
export interface Paged<T> { items: T[]; pager: Pager }

export interface Section { id: string; title: string; kind: 'movie' | 'series'; items: Title[] }

export interface HomeFeed {
  banners: Title[];
  sections: Section[];
  live: Match[];
  liveTitle: string;
  liveUrl: string;
  platforms: string[];
}

export interface Season { se: number; maxEp: number; resolutions: { res: number; epNum: number }[] }
export interface CastMember { id: string; name: string; role: string; avatar: string; type?: number }
export interface Dub { id: string; lang: string; code: string; original: boolean; detailPath: string }
export interface TitleDetail { subject: Title | null; seasons: Season[]; cast: CastMember[]; dubs: Dub[]; locked: boolean }

export interface Stream {
  label: string;
  res: number;      // vertical resolution, e.g. 720
  url: string;
  size: number;     // bytes (0 when unknown)
  format: string;
  alt?: string;     // alternate URL (legacy worker proxy)
}
export interface Subtitle { lang: string; label: string; url: string }
export interface StreamSet {
  streams: Stream[];
  best: Stream | null;
  subtitles: Subtitle[];
  audio: unknown[];
  empty: boolean;
  source: 'moviebox' | 'legacy';
}

export type MatchStatus = 'upcoming' | 'live' | 'ended';
export interface Team { id: string; name: string; short: string; logo: string; score: string; votes: number; winner?: boolean }
export interface Match {
  id: string;
  source: 'moviebox' | 'espn';
  league: string;
  leagueId?: string;
  home: Team;
  away: Team;
  start: number;
  status: MatchStatus;
  statusRaw?: string;
  streamUrl?: string;
  image?: string;
  title?: string;
  clock?: string;
  venue?: string;
}
export interface League { id: string; name: string; short: string }
export interface StandingRow { rank: number; team: string; short: string; logo: string; gp: number; w: number; d: number; l: number; gd: number; pts: number; note: string }
export interface StandingGroup { group: string; rows: StandingRow[] }
export interface MatchSummary {
  events: { minute: string; type: string; text: string; team: string; scoring: boolean }[];
  highlights: { title: string; thumb: string; url: string; duration: number }[];
  stats: { label: string; home: string; away: string }[];
}

/* Raw upstream fragments we read directly (everything else is `any`-free via guards). */
export interface RawDub { subjectId?: string; lanName?: string; lanCode?: string; original?: boolean; detailPath?: string }

export interface ChatXAPUser { id: number | string; username?: string; avatar?: string; [k: string]: unknown }

export interface CFConfig {
  base?: string;
  proxy?: string;
  transport?: 'auto' | 'direct' | 'proxy';
  timeoutMs?: number;
  legacyFallback?: boolean;
  legacyBase?: string;
}

declare global {
  interface Window {
    CF_CONFIG?: CFConfig;
    ChatXAP?: { getAvatarUrl?: (a: string) => string };
    ChatXAPRealtime?: {
      init(): void;
      joinRoom(room: string): void;
      on(ev: string, cb: (d: { movie_id?: string | number }) => void): void;
    };
  }
  interface Navigator {
    connection?: { effectiveType?: string; downlink?: number; saveData?: boolean };
  }
}
