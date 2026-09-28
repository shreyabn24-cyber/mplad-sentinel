'use client';

import React, { useState } from 'react';
import Link from 'next/link';

interface FAQ {
  question: string;
  answer: string;
  category: 'CITIZEN' | 'SCHEME' | 'AI' | 'RTI';
}

const FAQS: FAQ[] = [
  {
    category: 'CITIZEN',
    question: 'How do I submit a photo report for a project in my neighborhood?',
    answer:
      'Sign in, then open the citizen desk and choose a work. Attach an on-site photograph and describe what you can see. Your account records the submission, so an auditor reviewing the report can see which account sent it. ' +
      'What the system does not do is verify where you were standing. It computes the distance between the work\'s recorded coordinates and the location your browser reports, and shows that number as a distance — there is no proximity score, no on-site check, and no guarantee that a photo was taken at the site. ' +
      'The coordinates behind each work are village or block centroids from OpenStreetMap, not surveyed work-site GPS, so that distance is a rough indication at best.',
  },
  {
    category: 'CITIZEN',
    question: 'Is my identity protected when I submit a citizen report?',
    answer:
      'No, not in the way that question implies. Submitting requires an account, and the report stores the submitting account id against it. The mobile number on your account is displayed on the office and auditor views so a report can be followed up; it is not shown to the public or to other citizens. ' +
      'Your account password is never stored or displayed anywhere. ' +
      'The old answer to this said reports were "submitted anonymously" and that coordinates and timestamps were "verified". Neither is true: there is no verification of the device or the location, and attaching an account is what anonymity here would contradict.',
  },
  {
    category: 'SCHEME',
    question: 'What is the annual MPLADS entitlement for each Member of Parliament?',
    answer:
      'Under the MPLADS guidelines, each MP has an entitlement of ₹5 Crore per annum (₹25 Crore over a 5-year tenure). Funds are non-lapsable from year to year during the tenure, and uncommitted balances lapse at the conclusion of a parliamentary term. ' +
      'Entitlement is not the same as availability: an MP\'s unspent balance depends on what has actually been sanctioned and expended, and this prototype only shows those figures where it holds a dated source for them. Where it does not, the field says so instead of estimating.',
  },
  {
    category: 'SCHEME',
    question: 'Who executes and sanctions MPLADS works?',
    answer:
      'Members of Parliament can only recommend works. Sanctioning, technical appraisal, tendering, and execution are carried out by the District Authority (District Magistrate / Deputy Commissioner) through designated implementing agencies and registered contractors. ' +
      'This prototype is not connected to that system. It has no sanction record, no tender record, no payment record, and no contractor assignment from any official source, so it shows those as unavailable rather than filling them in.',
  },
  {
    category: 'AI',
    question: 'Does this project analyse satellite imagery to detect ghost works?',
    answer:
      'No. It does not read satellite pixels at all. ' +
      'What it does is look up whether a Sentinel-2 scene covering a work\'s coordinates exists in a public STAC catalogue, and record that a scene search happened. That tells you imagery is available for a location — nothing about what is on the ground. ' +
      'There is no Normalized Difference Built-Up Index, no NDVI, no pre- and post-completion image comparison, and no automatic built-up-change flag. A missing building cannot be detected here, so no work is ever raised to L3 on the strength of imagery.',
  },
  {
    category: 'AI',
    question: 'What does the risk score actually measure?',
    answer:
      'It is an Isolation Forest trained on the public works dataset, and it is a ranking aid for deciding what a human should look at first. A higher score means the record\'s fields look less like the bulk of the dataset. ' +
      'It is not a finding of wrongdoing, and it cannot become one on its own. It does not check ground truth, and a high score has never been confirmed to correspond to an incomplete project. Treat it as a queue, not a verdict.',
  },
  {
    category: 'AI',
    question: 'Why are MP names masked in L1 and L2 alerts on the public portal?',
    answer:
      'Because these are unreviewed signals about a named elected representative, and publishing an allegation of that kind on a prototype with no appeal process would be unfair to the person named. It is a design decision taken in this codebase, not a legal requirement. ' +
      'It is also incomplete: L3 records are not masked, and the review controls are only shown to reviewers. Lower tiers need a real publication standard before names are attached, not a claim of statutory oversight.',
  },
  {
    category: 'RTI',
    question: 'Can I file an RTI application using a reference from this portal?',
    answer:
      'No, and please do not try. There is no "Audit Dossier Reference Number" here, no pre-formatted expenditure breakdown, and no filing mechanism of any kind. Nothing on this site is a document you can quote. ' +
      'A real RTI application is filed with the Public Information Officer of the relevant public authority, under Section 6 of the RTI Act 2005, and you pay a fee there. ' +
      'The work identifier this portal displays is a surrogate computed by hashing the row, because the public dataset publishes no per-work reference number. It is not an official number and it will mean nothing to a PIO. If you want to know why a work was funded or paid, ask the authority that holds the record.',
  },
];

export default function HelpPage() {
  const [activeCategory, setActiveCategory] = useState<string>('ALL');
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const filteredFaqs = FAQS.filter(
    (f) => activeCategory === 'ALL' || f.category === activeCategory
  );

  return (
    <div className="max-w-container-max mx-auto px-gutter-desktop py-space-xl space-y-space-xl">
      {/* ── Header ────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-space-md border-b border-outline-variant/30 pb-space-lg">
        <div>
          <div className="flex items-center gap-space-xs text-xs text-on-surface-variant mb-1 font-label-md">
            <span className="material-symbols-outlined text-[16px] text-primary">help</span>
            <span>What this prototype does and does not do</span>
          </div>
          <h1
            className="text-2xl md:text-3xl font-bold text-primary tracking-tight"
            style={{ fontFamily: "'Public Sans', sans-serif" }}
          >
            Help &amp; FAQ
          </h1>
          <p className="text-sm text-on-surface-variant mt-1 max-w-3xl">
            What the MPLADS dataset contains, what the risk score is worth, and what this site cannot tell you.
          </p>
        </div>
        <div className="flex items-center gap-space-sm shrink-0">
          <Link
            href="/citizen"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-error text-on-error rounded-xl font-label-md text-xs hover:bg-error/90 transition-colors font-semibold"
          >
            <span className="material-symbols-outlined text-[16px]">flag</span>
            <span>Submit a report</span>
          </Link>
        </div>
      </div>

      {/* ── Quick Topic Cards ─────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-md">
        <button
          onClick={() => setActiveCategory('CITIZEN')}
          className={`p-space-md rounded-2xl border text-left transition-all ${
            activeCategory === 'CITIZEN'
              ? 'bg-primary-container text-on-primary-container border-primary'
              : 'bg-surface-container-lowest border-outline-variant/30 hover:border-primary/40'
          }`}
        >
          <div className="w-9 h-9 rounded-xl bg-surface-container flex items-center justify-center mb-2">
            <span className="material-symbols-outlined text-primary text-[20px]">photo_camera</span>
          </div>
          <div className="font-bold text-sm">Submitting a report</div>
          <div className="text-xs opacity-80 mt-1">What is recorded, what is stored, and what is not checked.</div>
        </button>

        <button
          onClick={() => setActiveCategory('SCHEME')}
          className={`p-space-md rounded-2xl border text-left transition-all ${
            activeCategory === 'SCHEME'
              ? 'bg-primary-container text-on-primary-container border-primary'
              : 'bg-surface-container-lowest border-outline-variant/30 hover:border-primary/40'
          }`}
        >
          <div className="w-9 h-9 rounded-xl bg-surface-container flex items-center justify-center mb-2">
            <span className="material-symbols-outlined text-primary text-[20px]">gavel</span>
          </div>
          <div className="font-bold text-sm">MPLADS Scheme Rules</div>
          <div className="text-xs opacity-80 mt-1">Financial limits, guidelines &amp; sanctioned works eligibility.</div>
        </button>

        <button
          onClick={() => setActiveCategory('AI')}
          className={`p-space-md rounded-2xl border text-left transition-all ${
            activeCategory === 'AI'
              ? 'bg-primary-container text-on-primary-container border-primary'
              : 'bg-surface-container-lowest border-outline-variant/30 hover:border-primary/40'
          }`}
        >
          <div className="w-9 h-9 rounded-xl bg-surface-container flex items-center justify-center mb-2">
            <span className="material-symbols-outlined text-primary text-[20px]">satellite_alt</span>
          </div>
          <div className="font-bold text-sm">Satellite &amp; scoring</div>
          <div className="text-xs opacity-80 mt-1">Sentinel-2 scene lookup and a review-ranking score. Radar detection does not exist here.</div>
        </button>

        <button
          onClick={() => setActiveCategory('RTI')}
          className={`p-space-md rounded-2xl border text-left transition-all ${
            activeCategory === 'RTI'
              ? 'bg-primary-container text-on-primary-container border-primary'
              : 'bg-surface-container-lowest border-outline-variant/30 hover:border-primary/40'
          }`}
        >
          <div className="w-9 h-9 rounded-xl bg-surface-container flex items-center justify-center mb-2">
            <span className="material-symbols-outlined text-primary text-[20px]">article</span>
          </div>
          <div className="font-bold text-sm">Filing an RTI application</div>
          <div className="text-xs opacity-80 mt-1">Where to actually file, and why this site cannot do it for you.</div>
        </button>
      </div>

      {/* ── FAQ Accordion Section ─────────────────────────────── */}
      <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-space-lg shadow-card space-y-space-md">
        <div className="flex items-center justify-between border-b border-outline-variant/30 pb-space-sm">
          <h2
            className="text-lg font-bold text-primary"
            style={{ fontFamily: "'Public Sans', sans-serif" }}
          >
            Frequently Asked Questions
          </h2>
          <button
            onClick={() => setActiveCategory('ALL')}
            className="text-xs text-on-surface-variant hover:text-primary font-semibold"
          >
            Show All Questions ({FAQS.length})
          </button>
        </div>

        <div className="space-y-space-sm">
          {filteredFaqs.map((faq, idx) => {
            const isOpen = openIndex === idx;
            return (
              <div
                key={faq.question}
                className="border border-outline-variant/30 rounded-xl overflow-hidden transition-all"
              >
                <button
                  onClick={() => setOpenIndex(isOpen ? null : idx)}
                  className="w-full text-left px-space-md py-space-sm flex items-center justify-between gap-space-md bg-surface-container-low/50 hover:bg-surface-container-low transition-colors"
                >
                  <span className="font-semibold text-sm text-on-surface">{faq.question}</span>
                  <span className="material-symbols-outlined text-[20px] text-on-surface-variant shrink-0">
                    {isOpen ? 'expand_less' : 'expand_more'}
                  </span>
                </button>
                {isOpen && (
                  <div className="px-space-md py-space-sm text-xs text-on-surface-variant leading-relaxed bg-surface-container-lowest border-t border-outline-variant/20">
                    {faq.answer}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Citizen Action Banner ─────────────────────────────── */}
      <div className="bg-primary text-on-primary rounded-2xl p-space-xl flex flex-col md:flex-row items-center justify-between gap-space-lg">
        <div className="space-y-1">
          <h3
            className="text-xl font-bold"
            style={{ fontFamily: "'Public Sans', sans-serif" }}
          >
            Send a report about a work you can see
          </h3>
          <p className="text-xs text-primary-fixed-dim max-w-2xl leading-relaxed">
            Photographs and descriptions from people who visit a site are the only ground-level input this project has, and
            they are read by a human. Nothing is confirmed automatically, and no work here is verified as built.
            This portal is not connected to any e-SAKSHI, sanctions, or payment system.
          </p>
        </div>
        <Link
          href="/citizen"
          className="px-5 py-2.5 bg-secondary text-on-secondary rounded-xl font-label-md text-xs font-bold hover:bg-secondary/90 transition-colors shrink-0 inline-flex items-center gap-2 shadow-md"
        >
          <span className="material-symbols-outlined text-[16px]">verified</span>
          <span>Submit a report</span>
        </Link>
      </div>
    </div>
  );
}
