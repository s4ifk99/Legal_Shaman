const DEFAULT_YOUTUBE_URL = "https://www.youtube.com/@LegalShaman";
const DEFAULT_TRUSTPILOT_URL = "https://www.trustpilot.com/review/www.legalshaman.com";

export const youtubeUrl =
  process.env.NEXT_PUBLIC_YOUTUBE_URL?.trim() || DEFAULT_YOUTUBE_URL;

export const trustpilotUrl =
  process.env.NEXT_PUBLIC_TRUSTPILOT_URL?.trim() || DEFAULT_TRUSTPILOT_URL;
