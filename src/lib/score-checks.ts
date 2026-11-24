/** The parts of the fit the scorer rates 0-10 (see scoring.ts), shared with the Inbox display. */
export const CHECKS = [
  { key: "role", label: "Role", weight: 30, about: "the kind of work and title vs the target roles" },
  { key: "skills", label: "Skills", weight: 25, about: "required skills and stack vs the career" },
  { key: "seniority", label: "Level", weight: 20, about: "required years and level vs the career's dates and titles" },
  { key: "location", label: "Location", weight: 15, about: "place and remote terms vs target locations and where the candidate lives" },
  { key: "taste", label: "Taste", weight: 10, about: "stated preferences and the traits of past approves and skips" },
] as const;
export type CheckKey = (typeof CHECKS)[number]["key"];
