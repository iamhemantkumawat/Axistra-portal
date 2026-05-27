import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck } from '@phosphor-icons/react';
import PublicFooter from '../components/PublicFooter';
import { useSeo } from '../lib/seo';
import { COMPANY, BUSINESS_ACTIVITIES, CONTACTS } from './legal-content';

const LOGO_URL = '/axistra-header-logo-2026.png';

const Section = ({ title, children }) => (
  <section className="card-axistra p-7">
    <h2 className="font-display text-2xl font-semibold tracking-tight">{title}</h2>
    <div className="mt-4 space-y-3 text-sm leading-relaxed text-gray-600">{children}</div>
  </section>
);

const PublicHeader = () => (
  <header className="site-header-animated sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-gray-100">
    <div className="max-w-7xl mx-auto px-6 lg:px-10 h-16 flex items-center justify-between">
      <Link to="/" className="flex items-center">
        <img src={LOGO_URL} alt="Axistra Technologies" className="h-11 w-auto object-contain" />
      </Link>
      <div className="flex items-center gap-2">
        <Link to="/#contact" className="btn-secondary text-sm">Contact</Link>
        <Link to="/login" className="btn-primary text-sm">Login</Link>
      </div>
    </div>
  </header>
);

const LegalShell = ({ eyebrow, title, intro, children }) => (
  <div className="site-shell min-h-screen bg-white text-[#111827]">
    <PublicHeader />
    <main>
      <section className="relative overflow-hidden bg-gradient-to-br from-[#0A5C3E] via-[#0d6a48] to-[#084a32] text-white">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 py-20 relative">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-xs uppercase tracking-[0.18em] mb-6">
              <ShieldCheck size={14} weight="duotone" className="text-axistra-gold" />
              <span>{eyebrow}</span>
            </div>
            <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold leading-[1.05] tracking-tight">{title}</h1>
            <p className="mt-6 text-base lg:text-lg text-gray-200 max-w-2xl leading-relaxed">{intro}</p>
          </div>
        </div>
      </section>
      <section className="py-20 bg-[var(--axistra-bg)]">
        <div className="max-w-5xl mx-auto px-6 lg:px-10 space-y-5">{children}</div>
      </section>
    </main>
    <PublicFooter />
  </div>
);

export function PrivacyPolicy() {
  useSeo({
    title: `Privacy Policy | ${COMPANY.name}`,
    description: `${COMPANY.name} privacy policy for website visitors, SaaS platform users, billing records, support requests, and international cloud software operations.`,
    path: '/privacy-policy',
    keywords: 'Axistra privacy policy, UAE SaaS privacy policy, cloud software privacy, platform data protection',
  });

  return (
    <LegalShell
      eyebrow="Privacy & Data Protection"
      title="Privacy Policy"
      intro={`${COMPANY.name} explains how personal data is collected, used, stored, protected, and shared when visitors and customers interact with our website, SaaS platforms, billing systems, and support channels.`}
    >
      <Section title="1. Company and Controller Details">
        <p>{COMPANY.name} acts as the data controller for personal data collected through this website and platform services unless a separate customer agreement designates Axistra as a processor.</p>
        <p>Registered address: {COMPANY.address}. Legal and privacy contact: <a href={`mailto:${CONTACTS.legal}`} className="text-axistra-green underline">{CONTACTS.legal}</a>.</p>
      </Section>

      <Section title="2. Personal Data We May Collect">
        <ul className="list-disc pl-5 space-y-2">
          <li>Contact details such as name, business email, company name, phone, and inquiry details.</li>
          <li>Account and platform information, including login records, dashboard activity, role assignments, and support history.</li>
          <li>Billing, subscription, usage, recharge, invoice, and payment reference records.</li>
          <li>Onboarding, KYC, company-document, address-proof, risk-review, and compliance-screening information where required for account eligibility.</li>
          <li>Technical data such as IP address, browser data, device information, logs, cookies, and security events.</li>
        </ul>
      </Section>

      <Section title="3. How We Use Data">
        <p>We use personal data to provide and secure access to software dashboards, manage subscriptions and account balances, process billing and customer support, improve platform reliability, investigate abuse, maintain audit records, and meet legal or contractual obligations.</p>
      </Section>

      <Section title="4. Hosting and International Processing">
        <p>Axistra is incorporated in the United Arab Emirates while platform hosting and technical operations may use international cloud environments. By using our services, customers acknowledge that data may be processed in multiple jurisdictions with appropriate technical and contractual safeguards.</p>
      </Section>

      <Section title="5. Payments and Business Records">
        <p>Payment records, billing records, invoice references, account balances, and transaction metadata are maintained for accounting, reconciliation, dispute handling, compliance monitoring, and lawful business operations.</p>
      </Section>

      <Section title="6. Onboarding, KYC, and Restricted Regions">
        <p>Axistra applies strict onboarding and may request KYC documents, company records, address proof, source-of-funds notes, or enhanced due diligence for higher-risk, higher-volume, or suspicious activity.</p>
        <p>Axistra does not onboard or provide services to customers, end users, businesses, or operations located in the United States or Canada.</p>
      </Section>

      <Section title="7. Sharing and Retention">
        <p>We do not sell personal data. Data may be shared with cloud hosting providers, payment and compliance service providers, professional advisors, and competent authorities when required by law. Personal data is retained only as long as needed for services, security, accounting, disputes, and legal obligations.</p>
      </Section>

      <Section title="8. Security Controls">
        <p>We apply access controls, monitoring, retention controls, encryption in transit where applicable, incident handling, and operational safeguards appropriate to the nature of our platforms and records.</p>
      </Section>

      <Section title="9. Contact">
        <p>For privacy requests, corrections, access requests, or legal notices, contact <a href={`mailto:${CONTACTS.legal}`} className="text-axistra-green underline">{CONTACTS.legal}</a>.</p>
      </Section>
    </LegalShell>
  );
}

export function TermsAndConditions() {
  useSeo({
    title: `Terms & Conditions | ${COMPANY.name}`,
    description: `${COMPANY.name} terms and conditions for cloud communications software, SaaS dashboards, subscriptions, payments, acceptable use, and platform access.`,
    path: '/terms-and-conditions',
    keywords: 'Axistra terms and conditions, SaaS terms UAE, cloud communications platform terms, hosted PBX software terms',
  });

  return (
    <LegalShell
      eyebrow="Legal Terms"
      title="Terms & Conditions"
      intro={`These Terms govern access to and use of software services, dashboards, account tools, billing systems, and online platforms provided by ${COMPANY.name}.`}
    >
      <Section title="1. Company Scope">
        <p>{COMPANY.name} develops and operates cloud-based communications software and SaaS platforms for international clients, including hosted PBX management systems, telecom billing software, SIP account management tools, and secure online dashboards.</p>
        <p>Licensed activities include: {BUSINESS_ACTIVITIES.join('; ')}.</p>
      </Section>

      <Section title="2. Telecommunications Scope Disclaimer">
        <p>Axistra does not operate telecommunications infrastructure inside the UAE and does not provide regulated telecommunications services within the UAE. Axistra operates as a software and technology platform provider for international customers.</p>
      </Section>

      <Section title="3. Platform Access and Accounts">
        <p>Platform access may be provided through subscriptions, account recharge models, onboarding agreements, or tailored commercial contracts. Customers are responsible for maintaining accurate account information and protecting credentials.</p>
        <p>All customers are subject to eligibility review, strict onboarding rules, and KYC or enhanced due diligence where Axistra determines it is required.</p>
      </Section>

      <Section title="4. Restricted Regions">
        <p>Axistra does not onboard or provide services to customers, end users, businesses, or operations located in the United States or Canada. Customers must not access or resell Axistra services into restricted regions.</p>
      </Section>

      <Section title="5. Billing, Payments, and Digital Assets">
        <p>Customers subscribe to services and recharge platform balances online. Billing records, usage logs, invoices, and account balances are maintained in Axistra systems for reconciliation and reporting.</p>
        <p>Where digital asset payments are accepted, transaction records may be logged and reconciled before settlement or conversion activities through exchange and banking channels.</p>
      </Section>

      <Section title="6. Acceptable Use">
        <p>Customers must not use the platform for unlawful, abusive, fraudulent, infringing, spam, harmful, sanctioned, or prohibited activities. Axistra may suspend, restrict, or terminate accounts where misuse, legal risk, security concerns, or payment issues are identified.</p>
      </Section>

      <Section title="7. Intellectual Property">
        <p>The platform, software, interfaces, content, documentation, workflows, and related technology are owned by Axistra or licensed to Axistra. No rights are granted except as expressly stated in applicable customer agreements.</p>
      </Section>

      <Section title="8. Availability and Maintenance">
        <p>Axistra may update, maintain, suspend, or modify platform features to improve security, compliance, performance, or reliability. Planned maintenance is scheduled to minimize customer impact where possible.</p>
      </Section>

      <Section title="9. Limitation of Liability">
        <p>To the maximum extent permitted by law, Axistra is not liable for indirect, incidental, special, consequential, or punitive damages, including business interruption, loss of profits, loss of data, or service disruption arising from platform use.</p>
      </Section>

      <Section title="10. Governing Law and Contact">
        <p>These Terms are intended to align with applicable UAE legal frameworks for digital business operations and international SaaS delivery. Legal notices should be sent to <a href={`mailto:${CONTACTS.legal}`} className="text-axistra-green underline">{CONTACTS.legal}</a>.</p>
      </Section>
    </LegalShell>
  );
}
