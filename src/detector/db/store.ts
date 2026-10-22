// Only the plain fact types the page reader returns.
export type Source = 'page' | 'key' | 'you';

export type ChannelFacts = {
  channelId: string;
  handle?: string | null;
  name?: string | null;
  avatar?: string | null;
  followers?: number | null;
  videoCount?: number | null;
  country?: string | null; // About facts (2026-10-04)
  joinedAt?: string | null; // YYYY-MM-DD
  totalViews?: number | null;
  topics?: string[] | null; // YouTube's topic labels for the channel (your key), e.g. "Video game culture"
  source: Source;
};

export type VideoFacts = {
  videoId: string;
  title?: string | null;
  format?: 'long' | 'short' | null;
  postedAt?: string | null; // exact date (ISO), when known
  postedText?: string | null; // what the page showed, e.g. "3 weeks ago"
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  durationS?: number | null; // from your YouTube key
  paid?: boolean | null; // YouTube's own "includes paid promotion" label
  sponsor?: string | null; // the brand named in the description's first lines (no AI), e.g. CodeRabbit
  sponsorSite?: string | null; // that brand's web address from the same line, e.g. coderabbit.ai
  sponsorAt?: number | null; // where the sponsor's ad starts, in seconds (its chapter), when known
  sponsorDoor?: string | null; // the door word for that sponsor's link (see lib/door.ts); null = not checked
  sponsorEnd?: number | null;
  source: Source;
};
