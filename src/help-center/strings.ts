/** Every visible string in the help-center template. Override any subset via
 *  `HelpCenterOptions.strings` — these defaults are the shipped design copy.
 *  This is the brand-voice / i18n escape hatch: no string in the UI is
 *  hardcoded anywhere else. */
export interface HelpCenterStrings {
  /** Sidebar brand suffix ("Acme Help"); the whole brand text when no name is set. */
  brandSuffix: string;
  /** Small line under the brand name in the sidebar. */
  brandTagline: string;
  /** Sidebar primary button: start a fresh conversation. */
  newQuestion: string;
  /** Sidebar search field placeholder. */
  searchGuides: string;
  /** Sidebar library group heading. */
  libraryHeading: string;
  /** Topbar Contact button + footer link. */
  contactLabel: string;

  /** Topbar title prefix ("Help") and the welcome / conversation suffixes. */
  topbarTitle: string;
  topbarWelcome: string;
  topbarConversation: string;

  /** Home landing greeting. */
  eyebrow: string;
  heroTitle: string;
  lede: string;
  /** Kicker shown over the inline media player ("Featured walkthrough"). */
  featuredLabel: string;
  /** Open-in-theater button on the inline player. */
  theaterLabel: string;
  /** Play cue on the inline hero — clicking opens the theater ("Watch walkthrough"). */
  watchLabel: string;
  /** Topbar button shown during a conversation; returns to the home landing. */
  backToGuides: string;
  askPlaceholder: string;
  askButton: string;
  popularLabel: string;

  /** Conversation thread. */
  assistantName: string;
  assistantTag: string;
  composerPlaceholder: string;
  /** Note under the bottom composer. */
  composerNote: string;
  errorText: string;

  /** Structured answer pieces. */
  /** Clip-card kicker prefix; rendered as "Answer clip · cued 0:06". */
  clipKicker: string;
  clipCuedLabel: string;
  /** Clip-card call-to-action. */
  playLabel: string;
  /** Steps-mirror heading. */
  stepsInClip: string;
  /** Related-walkthroughs playlist heading. */
  relatedHeading: string;
  /** Answer action buttons (titles). */
  helpfulLabel: string;
  notHelpfulLabel: string;
  copyLabel: string;
  /** No-match lead when the gallery is offered as a fallback. */
  noMatchBrowse: string;

  /** Card / row footer suffix: "1:04 · 4 steps". */
  stepsSuffix: string;

  /** Theater / player. */
  nowPlaying: string;
  stepsHeading: string;
  upNext: string;
  autoplayLabel: string;
  closeLabel: string;

  /** Footer badge prefix; the "Daymo" brand name itself is not configurable. */
  builtWith: string;
}

export const DEFAULT_STRINGS: HelpCenterStrings = {
  brandSuffix: "Help",
  brandTagline: "Support center",
  newQuestion: "Ask a new question",
  searchGuides: "Search guides",
  libraryHeading: "Video guides",
  contactLabel: "Contact",

  topbarTitle: "Help",
  topbarWelcome: "welcome",
  topbarConversation: "conversation",

  eyebrow: "Help Center",
  heroTitle: "How can we help?",
  lede: "Watch a quick walkthrough, or just ask — answers come cued to the exact moment.",
  featuredLabel: "Featured walkthrough",
  theaterLabel: "Theater",
  watchLabel: "Watch walkthrough",
  backToGuides: "Back to guides",
  askPlaceholder: "Ask anything — e.g. how do I…?",
  askButton: "Send",
  popularLabel: "Popular searches",

  assistantName: "Assistant",
  assistantTag: "Daymo",
  composerPlaceholder: "Ask a follow-up…",
  composerNote: "Answers are shown as clips cued to the moment — powered by Daymo",
  errorText: "Couldn't reach the assistant. Try again.",

  clipKicker: "Answer clip",
  clipCuedLabel: "cued",
  playLabel: "Play",
  stepsInClip: "Steps in this clip",
  relatedHeading: "Related walkthroughs",
  helpfulLabel: "Helpful",
  notHelpfulLabel: "Not helpful",
  copyLabel: "Copy",
  noMatchBrowse: "I don't have a clip for that one yet — but here are the walkthroughs I can show you right now:",

  stepsSuffix: "steps",

  nowPlaying: "Now playing",
  stepsHeading: "Steps",
  upNext: "Up next",
  autoplayLabel: "Autoplay",
  closeLabel: "Close",

  builtWith: "Built with",
};
