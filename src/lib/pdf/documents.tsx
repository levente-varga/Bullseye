import path from "node:path";
import { Document, Font, Image, Link, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { DRAFT_LABELS, type CvDraft, type LetterDraft } from "../draft-types";
import type { Profile } from "../types";

/**
 * The built-in CV and cover letter templates: one column, real text, standard headings,
 * so applicant tracking systems read them. Geist (the app's font, SIL OFL) is embedded:
 * the PDF base fonts lack letters like ő, ű and å.
 */

const FONTS = path.join(process.cwd(), "src/lib/pdf/fonts");
Font.register({
  family: "Geist",
  fonts: [
    { src: path.join(FONTS, "Geist-Regular.ttf") },
    { src: path.join(FONTS, "Geist-Italic.ttf"), fontStyle: "italic" },
    { src: path.join(FONTS, "Geist-Medium.ttf"), fontWeight: 500 },
    { src: path.join(FONTS, "Geist-SemiBold.ttf"), fontWeight: 600 },
  ],
});
// Long words stay whole: the default splits them with hyphens.
Font.registerHyphenationCallback((word) => [word]);

const INK = "#1a1a1a";
const MUTED = "#5c5c5c";
const RULE = "#d9d9d9";
const ACCENT = "#9e4c03"; // the app's deep burnt orange

const s = StyleSheet.create({
  page: { fontFamily: "Geist", fontSize: 9.5, lineHeight: 1.4, color: INK, paddingVertical: 40, paddingHorizontal: 46 },
  header: { flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 14 },
  name: { fontSize: 20, fontWeight: 600, lineHeight: 1.15 },
  headline: { fontSize: 11, color: ACCENT, fontWeight: 500, marginTop: 2 },
  contact: { fontSize: 8.5, color: MUTED, marginTop: 5 },
  photo: { width: 62, height: 62, borderRadius: 31, objectFit: "cover" },
  section: { marginTop: 12 },
  heading: { fontSize: 8, fontWeight: 600, color: ACCENT, letterSpacing: 1.2, textTransform: "uppercase", paddingBottom: 3, borderBottomWidth: 0.6, borderBottomColor: RULE, marginBottom: 6 },
  item: { marginBottom: 7 },
  itemHead: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  itemTitle: { fontWeight: 600 },
  itemMeta: { color: MUTED, fontSize: 8.5 },
  bullet: { flexDirection: "row", marginTop: 1.5 },
  bulletDot: { width: 9, color: MUTED },
  bulletText: { flex: 1 },
  para: { marginBottom: 9 },
  link: { color: MUTED, textDecoration: "none" },
});

/** "2023-06" → "Jun 2023" in the draft's language ("jún. 2023", "juni 2023"); "2022" stays. */
const monthYear = (d: string, language: string) => {
  const m = d.match(/^(\d{4})-(\d{2})$/);
  if (!m) return d;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)).toLocaleDateString(language, { month: "short", year: "numeric", timeZone: "UTC" });
};
const dates = (a: string, b: string, present: string, language: string) =>
  [monthYear(a, language), b === "present" ? present : monthYear(b, language)].filter(Boolean).join(" – ");

/** "https://github.com/me" → "github.com/me" for the contact line. */
const bare = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

function Contact({ profile }: { profile: Profile }) {
  const parts: { text: string; href?: string }[] = [
    profile.email && { text: profile.email, href: `mailto:${profile.email}` },
    profile.phone && { text: profile.phone },
    profile.location && { text: profile.location },
    ...[profile.linkedin_url, profile.github_url, profile.website_url, ...profile.links].filter(Boolean).map((u) => ({ text: bare(u), href: u })),
  ].filter((p): p is { text: string; href?: string } => Boolean(p));
  // Each item is its own box, so a wrap falls between items, never inside one or on a separator.
  return (
    <View style={{ ...s.contact, flexDirection: "row", flexWrap: "wrap", columnGap: 12, rowGap: 1 }}>
      {parts.map((p, i) =>
        p.href ? (
          <Link key={i} src={p.href} style={s.link}>
            {p.text}
          </Link>
        ) : (
          <Text key={i}>{p.text}</Text>
        ),
      )}
    </View>
  );
}

function Header({ profile, headline, photo }: { profile: Profile; headline: string; photo: Photo | null }) {
  return (
    <View style={s.header}>
      {/* eslint-disable-next-line jsx-a11y/alt-text -- a PDF image, not an <img>: react-pdf has no alt */}
      {photo && <Image src={photo} style={s.photo} />}
      <View style={{ flex: 1 }}>
        <Text style={s.name}>{profile.full_name || "Your name"}</Text>
        {headline && <Text style={s.headline}>{headline}</Text>}
        <Contact profile={profile} />
      </View>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.heading} minPresenceAhead={40}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <>
      {items.map((b, i) => (
        <View key={i} style={s.bullet} wrap={false}>
          <Text style={s.bulletDot}>•</Text>
          <Text style={s.bulletText}>{b}</Text>
        </View>
      ))}
    </>
  );
}

type Photo = { data: Buffer; format: "jpg" | "png" };

function CvDocument({ cv, profile, language, photo }: { cv: CvDraft; profile: Profile; language: string; photo: Photo | null }) {
  const L = DRAFT_LABELS[language] ?? DRAFT_LABELS.en;
  return (
    <Document title={`${profile.full_name} – CV`} author={profile.full_name} language={language}>
      <Page size="A4" style={s.page}>
        <Header profile={profile} headline={cv.headline} photo={photo} />
        {cv.summary && (
          <Section title={L.summary}>
            <Text>{cv.summary}</Text>
          </Section>
        )}
        {cv.experiences.length > 0 && (
          <Section title={L.experience}>
            {cv.experiences.map((e, i) => (
              <View key={i} style={s.item}>
                <View style={s.itemHead} wrap={false}>
                  <Text>
                    <Text style={s.itemTitle}>{e.title}</Text>
                    <Text style={{ color: MUTED }}> · {e.company}</Text>
                  </Text>
                  <Text style={s.itemMeta}>{[dates(e.start, e.end, L.present, language), e.location].filter(Boolean).join(" · ")}</Text>
                </View>
                <Bullets items={e.highlights} />
              </View>
            ))}
          </Section>
        )}
        {cv.projects.length > 0 && (
          <Section title={L.projects}>
            {cv.projects.map((p, i) => (
              <View key={i} style={s.item} wrap={false}>
                <Text>
                  <Text style={s.itemTitle}>{p.name}</Text>
                  {p.url && (
                    <Link src={p.url} style={s.link}>
                      {"  "}
                      {bare(p.url)}
                    </Link>
                  )}
                </Text>
                <Text>{p.description}</Text>
              </View>
            ))}
          </Section>
        )}
        {cv.education.length > 0 && (
          <Section title={L.education}>
            {cv.education.map((d, i) => (
              <View key={i} style={s.item} wrap={false}>
                <View style={s.itemHead}>
                  <Text>
                    <Text style={s.itemTitle}>{d.degree}</Text>
                    <Text style={{ color: MUTED }}> · {d.school}</Text>
                  </Text>
                  <Text style={s.itemMeta}>{dates(d.start, d.end, L.present, language)}</Text>
                </View>
                {d.details && <Text style={{ color: MUTED }}>{d.details}</Text>}
              </View>
            ))}
          </Section>
        )}
        {cv.skills.length > 0 && (
          <Section title={L.skills}>
            <Text>{cv.skills.join("  ·  ")}</Text>
          </Section>
        )}
        {cv.languages.length > 0 && (
          <Section title={L.languages}>
            <Text>{cv.languages.map((l) => (l.level ? `${l.language} (${l.level})` : l.language)).join("  ·  ")}</Text>
          </Section>
        )}
      </Page>
    </Document>
  );
}

function LetterDocument(props: { letter: LetterDraft; profile: Profile; language: string; company: string; jobTitle: string }) {
  const { letter, profile } = props;
  const today = new Date().toLocaleDateString(props.language, { day: "numeric", month: "long", year: "numeric" });
  return (
    <Document title={`${profile.full_name} – ${props.jobTitle}`} author={profile.full_name} language={props.language}>
      <Page size="A4" style={{ ...s.page, fontSize: 10.5, lineHeight: 1.5, paddingVertical: 56, paddingHorizontal: 64 }}>
        <Header profile={profile} headline={profile.headline} photo={null} />
        <View style={{ marginTop: 18, marginBottom: 22 }}>
          <Text style={{ color: MUTED }}>{today}</Text>
          {props.company && <Text style={{ marginTop: 8, fontWeight: 500 }}>{props.company}</Text>}
          <Text style={{ color: MUTED }}>{props.jobTitle}</Text>
        </View>
        <Text style={s.para}>{letter.greeting}</Text>
        {letter.paragraphs.map((p, i) => (
          <Text key={i} style={s.para}>
            {p}
          </Text>
        ))}
        <Text style={{ marginTop: 6 }}>{letter.closing}</Text>
        <Text style={{ fontWeight: 600, marginTop: 2 }}>{profile.full_name}</Text>
      </Page>
    </Document>
  );
}

export const renderCvPdf = (cv: CvDraft, profile: Profile, language: string, photo: Photo | null) =>
  renderToBuffer(<CvDocument cv={cv} profile={profile} language={language} photo={photo} />);

export const renderLetterPdf = (letter: LetterDraft, profile: Profile, language: string, company: string, jobTitle: string) =>
  renderToBuffer(<LetterDocument letter={letter} profile={profile} language={language} company={company} jobTitle={jobTitle} />);
