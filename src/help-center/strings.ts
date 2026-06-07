/** Every visible string in the help-center template. Override any subset via
 *  `HelpCenterOptions.strings` — these defaults are the shipped design copy.
 *  This is the brand-voice / i18n escape hatch: no string in the UI is
 *  hardcoded anywhere else. */
export interface HelpCenterStrings {
  /** Appbar brand suffix ("Acme Help"); the whole brand text when no name is set. */
  brandSuffix: string;
  navBrowse: string;
  navAsk: string;
  contactLabel: string;
  eyebrow: string;
  heroTitle: string;
  lede: string;
  askPlaceholder: string;
  askButton: string;
  popularLabel: string;
  assistantName: string;
  assistantTag: string;
  errorText: string;
  galleryHeading: string;
  gallerySub: string;
  /** Card footer: "1:04 · 4 steps". */
  stepsSuffix: string;
  stepsHeading: string;
  closeLabel: string;
  fabLabel: string;
  footAllVideos: string;
  footContact: string;
  /** Footer badge prefix; the "Daymo" brand name itself is not configurable. */
  builtWith: string;
}

export const DEFAULT_STRINGS: HelpCenterStrings = {
  brandSuffix: "Help",
  navBrowse: "Browse videos",
  navAsk: "Ask",
  contactLabel: "Contact",
  eyebrow: "Help Center",
  heroTitle: "How can we help?",
  lede: "Search the video guides below, or just ask — answers come with a clip cued to the exact moment.",
  askPlaceholder: "Ask: how do I…?",
  askButton: "Ask",
  popularLabel: "Popular:",
  assistantName: "Assistant",
  assistantTag: "Daymo",
  errorText: "Couldn't reach the assistant. Try again.",
  galleryHeading: "Video guides",
  gallerySub: "Short walkthroughs for everything you can do.",
  stepsSuffix: "steps",
  stepsHeading: "Steps",
  closeLabel: "Close",
  fabLabel: "Ask a question",
  footAllVideos: "All videos",
  footContact: "Contact support",
  builtWith: "Built with",
};
