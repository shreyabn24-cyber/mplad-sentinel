import type { Metadata } from 'next';
import './globals.css';
import StitchHeader from '@/components/StitchHeader';
import LegalNoticeBanner from '@/components/LegalNoticeBanner';
import { AuthProvider } from '@/lib/auth';
import { LanguageProvider } from '@/lib/languageContext';

// The old description said "Powered by Ministry of Statistics & Programme
// Implementation" and the title called this a "Public Project Monitoring &
// Citizen Verification Portal". This is a student research prototype on
// publicly available parliamentary data. Presenting it as a government-operated
// portal is the most serious claim on the site, because a reader would
// reasonably treat a `.gov`-style footer and a ministry attribution as evidence
// of official status. The attribution now names what the data actually is, and
// says plainly that no office operates this.
export const metadata: Metadata = {
  title: 'MPLADS Sentinel — Research Prototype on Public Parliament Data',
  description:
    'A research prototype that analyses a public parliamentary dataset of MPLADS works and ranks them for human review. Not a government system; it issues no determinations, documents, or filings.',
  keywords: 'MPLADS, MP Local Area Development, public parliament data, research prototype, data provenance',
  openGraph: {
    title: 'MPLADS Sentinel — Research Prototype',
    description:
      'Analysis of a public parliamentary dataset of MPLADS works. A research prototype, not a government system.',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/*
          Google Fonts — Public Sans, Noto Sans, Material Symbols

          The `@next/next/no-page-custom-font` warning below is suppressed
          deliberately, and only here.

          That rule guards `pages/_document.js`, where a <link> in the head is
          reloaded per navigation. There is no `_document` in this app: it is
          App Router, and this <head> is rendered once in the root layout, so
          the stylesheet is fetched once for the whole session. The warning does
          not describe a defect here.

          The rule's suggested remedy, `next/font`, downloads the font files at
          build time. That would add a network dependency to the build and break
          it in the air-gapped environment this prototype is developed in, so
          the stylesheet link stays.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@600;700&family=Noto+Sans:wght@400;600;700&family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-surface text-body-md text-on-surface min-h-screen">
        {/*
          One sticky chrome block, not two. LegalNoticeBanner and StitchHeader
          were each given their own `sticky top-0 z-50`, so whichever rendered
          second painted over the first and the banner was invisible on a
          normal viewport; a `pt-[144px]` on <main> was then added to clear a
          stack height nobody had measured, and it did not clear this one
          because the banner sits above the header in document order. The
          header was `fixed` on top of that, which pinned it to the top of the
          viewport regardless.

          Fixed instead: the pair is a single `sticky top-0` block, the header
          inside it is `relative`, and <main> is a sibling with no top
          padding. The block's own height is measured by the browser, so the
          two bars cannot overlap and no hard-coded offset can drift when the
          font-size control changes the header height. The block must wrap
          only the chrome: a sticky element that also wrapped the page body
          would pin the whole document and stop it scrolling.

          The providers sit outside the sticky block rather than inside it, and
          they must stay there: nesting them in the block left <main> outside
          AuthProvider, so every client page using useAuth() threw "useAuth must
          be used within an AuthProvider" while prerendering and six routes
          failed to export.
        */}
        <LanguageProvider>
          <AuthProvider>
            <div className="sticky top-0 z-50 w-full">
              <LegalNoticeBanner />
              <StitchHeader />
            </div>
            <main className="w-full min-h-[60vh] bg-surface">{children}</main>
          </AuthProvider>
        </LanguageProvider>

        {/* Footer */}
        <footer className="bg-primary text-on-primary mt-12">
          <div className="max-w-container-max mx-auto px-gutter-desktop py-space-2xl">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-space-xl">
              <div>
                <div className="flex items-center gap-space-sm mb-space-md">
                  <div className="h-10 w-10 rounded-lg bg-primary-container flex items-center justify-center">
                    <span className="material-symbols-outlined text-on-primary-container text-[20px]">account_balance</span>
                  </div>
                  <div>
                    <div className="font-bold text-sm" style={{ fontFamily: "'Public Sans', sans-serif" }}>MPLADS Sentinel</div>
                    <div className="text-xs text-primary-fixed-dim">Research prototype</div>
                  </div>
                </div>
                <p className="text-xs text-primary-fixed-dim leading-relaxed">
                  An independent research prototype. It analyses a public parliamentary dataset of
                  Members of Parliament Local Area Development Scheme (MPLADS) works. It is not
                  operated by, endorsed by, or connected to MoSPI, any State government, or any
                  district office, and it is not a system of record for any of them.
                </p>
              </div>
              <div>
                <h3 className="font-label-md text-label-md text-primary-fixed mb-space-md">Quick Links</h3>
                <ul className="space-y-2 text-xs text-primary-fixed-dim">
                  <li><a href="/works" className="hover:text-on-primary transition-colors">Browse Projects</a></li>
                  <li><a href="/map" className="hover:text-on-primary transition-colors">Constituency Map</a></li>
                  <li><a href="/reports" className="hover:text-on-primary transition-colors">Data Sources</a></li>
                  <li><a href="/citizen" className="hover:text-on-primary transition-colors">Submit Citizen Report</a></li>
                  <li><a href="/help" className="hover:text-on-primary transition-colors">Help &amp; FAQ</a></li>
                </ul>
              </div>
              <div>
                <h3 className="font-label-md text-label-md text-primary-fixed mb-space-md">Sources and limits</h3>
                <ul className="space-y-2 text-xs text-primary-fixed-dim">
                  <li>MPLADS works: public parliament data (ODbL), a dated snapshot</li>
                  <li>National aggregates: MoSPI published tiles, as fetched</li>
                  <li>A risk score is a review aid, never a finding</li>
                  <li>Nothing here is a determination, order, or filing</li>
                </ul>
              </div>
            </div>
            <div className="border-t border-primary-container/40 mt-space-xl pt-space-md flex flex-col md:flex-row items-center justify-between gap-2 text-xs text-primary-fixed-dim">
              {/*
                This read "© 2026 Ministry of Statistics & Programme Implementation,
                Government of India. All rights reserved." — a copyright and
                ownership claim over a government ministry on a prototype nobody
                at MoSPI operates. It is not a typo to tidy; it is a false
                statement of authority and ownership.
              */}
              <span>
                Research prototype. No government body operates, endorses, or is affiliated with
                this project.
              </span>
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">science</span>
                Analysis of public parliament data — SIH PS 26102
              </span>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
