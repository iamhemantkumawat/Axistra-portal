import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { toast } from 'sonner';
import PublicFooter from '../components/PublicFooter';
import { useSeo } from '../lib/seo';
import {
  ShieldCheck, Globe, Cube, CloudArrowUp, Phone, Lightning, ChartBar, Lock,
  ArrowUpRight, Check, EnvelopeSimple, ChatCircleDots, BriefcaseMetal, Scales,
} from '@phosphor-icons/react';

const LOGO_URL = '/axistra-header-logo-2026.png';

const SOLUTIONS = [
  { icon: Phone, title: 'Communication Management', desc: 'Unified platforms for voice, messaging, and digital communications across global operations.' },
  { icon: ChartBar, title: 'Billing Platforms', desc: 'Multi-currency billing & revenue management with automated invoicing and real-time analytics.' },
  { icon: CloudArrowUp, title: 'Web-Based Dashboards', desc: 'Intuitive, secure dashboards with full visibility into your services and operational metrics.' },
  { icon: Cube, title: 'Cloud Infrastructure', desc: 'Scalable cloud-hosted solutions on international infrastructure with low latency, high availability.' },
  { icon: Globe, title: 'Global Connectivity', desc: 'Seamless integration with telecommunications networks and providers across eligible international regions.' },
  { icon: Lock, title: 'Security & Compliance', desc: 'Enterprise-grade security protocols, strict onboarding, KYC checks, and compliance frameworks for international business.' },
];

const SERVICES = [
  {
    num: '01', title: 'SaaS Platform Development',
    desc: 'Custom cloud-based software solutions tailored to your business — from architecture to deployment and ongoing support.',
    points: ['Multi-tenant architecture', 'API-first design', 'Horizontal scalability', 'White-label options'],
  },
  {
    num: '02', title: 'Communication Infrastructure',
    desc: 'End-to-end communication systems that integrate seamlessly with your technology stack and global operations.',
    points: ['Voice & messaging APIs', 'Real-time routing', 'Quality monitoring', 'Carrier integrations'],
  },
  {
    num: '03', title: 'Enterprise Integration',
    desc: 'Seamless integration services connecting your platforms with third-party systems and regional providers.',
    points: ['ERP integration', 'CRM connectivity', 'Payment gateways', 'Custom webhooks'],
  },
];

const PRICING = [
  {
    name: 'Starter',
    target: 'Early-stage operators and small teams',
    details: 'Entry-level platform onboarding with core dashboard and account management capabilities.',
    features: ['Core platform access', 'Basic account and service management', 'Standard support channel', 'Monthly usage reporting'],
  },
  {
    name: 'Growth',
    target: 'Scaling service businesses',
    details: 'Expanded management controls, billing workflows, and operational visibility for growing teams.',
    features: ['Advanced billing and usage controls', 'Multi-user operational workflows', 'Priority support queue', 'Enhanced reporting and reconciliation'],
  },
  {
    name: 'Enterprise',
    target: 'High-volume international operations',
    details: 'Custom platform architecture, compliance-oriented controls, and commercial terms for large-scale deployments.',
    features: ['Custom onboarding and architecture planning', 'Enterprise account governance', 'Dedicated technical-commercial coordination', 'Contracted service and escalation framework'],
  },
];

const INDUSTRIES = [
  { name: 'Telecom Service Platforms', desc: 'Software tooling for international telecom-oriented operations requiring account control, service management, and billing visibility.' },
  { name: 'Managed Communications Providers', desc: 'Cloud dashboard capabilities for providers managing distributed communication services across multiple customer entities.' },
  { name: 'Technology Resellers and Aggregators', desc: 'Operational platforms for teams that bundle digital communication services and need structured account governance.' },
  { name: 'B2B Digital Infrastructure Businesses', desc: 'Scalable software infrastructure support for businesses delivering international SaaS-enabled communication products.' },
  { name: 'Multi-Market Service Operators', desc: 'Centralized control systems for organizations operating customer portfolios across Europe, the Middle East, Asia-Pacific, and other eligible markets, excluding the United States and Canada.' },
  { name: 'Compliance-Oriented Service Teams', desc: 'Software environments focused on auditability, operational controls, and platform accountability across international workflows.' },
];

const CASE_STUDIES = [
  {
    title: 'International Provider Onboarding',
    challenge: 'A cross-border communications operator required a unified software layer for account provisioning, service oversight, and billing transparency.',
    outcome: 'Axistra deployed dashboard-centered service management with centralized account controls and usage visibility.',
  },
  {
    title: 'Billing Workflow Consolidation',
    challenge: 'A multi-entity client needed cleaner reconciliation between recharge activity, usage records, and internal finance workflows.',
    outcome: 'Axistra implemented structured billing controls and reporting views for faster financial verification cycles.',
  },
  {
    title: 'Scalable Dashboard Governance',
    challenge: 'A growing service business required role-based operational governance for multiple internal users and customer portfolios.',
    outcome: 'Axistra enabled role-aware dashboard management and process-aligned service administration patterns.',
  },
];

const FAQS = [
  ['What does Axistra provide?', 'Axistra provides cloud-based communications software and SaaS management platforms, including hosted PBX management tools, telecom billing software, SIP account controls, and secure web dashboards.'],
  ['Who are your primary customers?', 'Axistra serves eligible international business clients across multiple regions including Europe, the Middle East, Asia-Pacific, and other approved markets. Axistra does not serve customers or users located in, operating from, or primarily targeting the United States or Canada.'],
  ['Do you serve users in the United States or Canada?', 'No. Axistra does not onboard or provide services to customers, end users, businesses, or operations located in the United States or Canada.'],
  ['Do you provide telecom services inside the UAE?', 'No. Axistra operates as a technology and software platform provider and does not operate telecommunications infrastructure inside the UAE.'],
  ['How do onboarding and account setup work?', 'Every customer must pass eligibility review and strict onboarding checks. KYC, company documents, address proof, source-of-funds notes, or enhanced verification may be requested before or during account use.'],
  ['How does billing and recharge work?', 'Customers subscribe to services and recharge account balances online. Billing and usage records are tracked in platform systems for reconciliation and reporting.'],
  ['Which support channels are available?', 'Operational and technical support is handled through support@axistratech.com. Sales and account expansion inquiries can be sent to sales@axistratech.com.'],
];

const COMPLIANCE = [
  { title: 'Privacy Policy', desc: 'Personal data is collected, used, stored, and protected for website, platform, billing, support, and account-management purposes.' },
  { title: 'Terms & Conditions', desc: 'Platform access is governed by account, subscription, acceptable-use, payment, intellectual-property, and limitation-of-liability terms.' },
  { title: 'Compliance Scope', desc: 'Axistra operates as a software and technology platform provider for eligible international clients, with UAE corporate records and internal billing controls.' },
  { title: 'Restricted Regions', desc: 'Axistra does not serve customers, users, businesses, or operations located in or operating from the United States or Canada.' },
  { title: 'KYC Onboarding', desc: 'Customer access is subject to strict onboarding rules, account review, risk checks, and KYC or enhanced due diligence where required.' },
  { title: 'Security', desc: 'Operational controls include role-based access, infrastructure hardening, monitoring, incident handling, backup practices, and customer security responsibilities.' },
];

const SLA_ITEMS = [
  { severity: 'Priority 1', definition: 'Critical outage or severe platform disruption', response: 'Initial response target: within 1 hour' },
  { severity: 'Priority 2', definition: 'Major functional degradation with active workaround limits', response: 'Initial response target: within 4 business hours' },
  { severity: 'Priority 3', definition: 'Non-critical issue with limited operational impact', response: 'Initial response target: within 1 business day' },
];

export default function Landing() {
  useSeo({
    title: 'AXISTRA TECHNOLOGIES - FZCO | Cloud Communications Software Platform',
    description: 'AXISTRA TECHNOLOGIES - FZCO provides cloud communications software, SaaS platforms, hosted PBX management tools, telecom billing systems, secure dashboards, IT consulting, and digital technology services for international business operations.',
    path: '/',
    keywords: 'AXISTRA TECHNOLOGIES - FZCO, cloud communications software, hosted PBX management, telecom billing software, SIP account management, SaaS platform, IFZA Dubai, cloud infrastructure',
  });

  const [signup, setSignup] = useState({ open: false, first_name: '', last_name: '', email: '', company: '', message: '' });
  const [submitting, setSubmitting] = useState(false);
  const nav = useNavigate();

  const submitLead = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post('/leads', signup);
      toast.success("Thank you! Our team will be in touch shortly.");
      setSignup({ open: false, first_name: '', last_name: '', email: '', company: '', message: '' });
    } catch (err) {
      toast.error(err.response?.data?.message || 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="site-shell min-h-screen bg-white text-[#111827]">
      {/* Nav */}
      <header className="site-header-animated sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center">
            <img src={LOGO_URL} alt="Axistra Technologies" className="h-11 w-auto object-contain" />
          </Link>
          <nav className="hidden md:flex items-center gap-7 text-sm">
            <a href="#solutions" className="text-gray-700 hover:text-axistra-green">Solutions</a>
            <a href="#services" className="text-gray-700 hover:text-axistra-green">Services</a>
            <a href="#pricing" className="text-gray-700 hover:text-axistra-green">Pricing</a>
            <a href="#resources" className="text-gray-700 hover:text-axistra-green">Resources</a>
            <a href="#about" className="text-gray-700 hover:text-axistra-green">About</a>
            <a href="#contact" className="text-gray-700 hover:text-axistra-green">Contact</a>
          </nav>
          <div className="flex items-center gap-2">
            <button onClick={() => setSignup({ ...signup, open: true })} className="btn-secondary text-sm" data-testid="landing-signup-btn">Sign Up</button>
            <button onClick={() => nav('/login')} className="btn-primary text-sm" data-testid="landing-login-btn">Login</button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-[#0A5C3E] via-[#0d6a48] to-[#084a32] text-white">
        <div
          className="absolute inset-0 opacity-15 pointer-events-none"
          style={{
            backgroundImage:
              'radial-gradient(circle at 80% 20%, #D4AF37 0%, transparent 35%), radial-gradient(circle at 10% 80%, #ffffff 0%, transparent 25%)',
          }}
        />
        <div className="max-w-7xl mx-auto px-6 lg:px-10 py-24 lg:py-32 relative">
          <div className="grid lg:grid-cols-5 gap-12 items-center">
            <div className="hero-copy lg:col-span-3">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-xs uppercase tracking-[0.18em] mb-6">
                <ShieldCheck size={14} weight="duotone" className="text-axistra-gold" />
                <span>UAE-registered cloud software company</span>
              </div>
              <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold leading-[1.05] tracking-tight">
                Enterprise <span className="text-[var(--axistra-gold)]">Cloud Infrastructure</span><br />
                for Global Business
              </h1>
              <p className="mt-6 text-base lg:text-lg text-gray-200 max-w-2xl leading-relaxed">
                Scalable SaaS platforms, communication management systems, and secure billing solutions
                designed to power international operations with unmatched reliability.
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <a href="#solutions" className="bg-white text-axistra-green hover:bg-gray-100 px-6 py-3 rounded-md font-semibold text-sm transition inline-flex items-center gap-2" data-testid="hero-explore-btn">
                  Explore Solutions <ArrowUpRight size={16} />
                </a>
                <a href="#contact" className="bg-[var(--axistra-gold)] hover:bg-[var(--axistra-gold-dark)] text-white px-6 py-3 rounded-md font-semibold text-sm transition" data-testid="hero-contact-btn">
                  Contact Sales
                </a>
              </div>

              <div className="mt-14 grid grid-cols-2 sm:grid-cols-4 gap-6 max-w-3xl">
                {[
                  { label: 'Enterprise Security', sub: 'Access controls' },
                  { label: 'High Availability', sub: 'Managed platform' },
                  { label: 'Multi-Region', sub: 'Excludes USA/Canada' },
                  { label: 'UAE-Registered', sub: 'IFZA / Dubai' },
                ].map((s) => (
                  <div key={s.label} className="border-l-2 border-[var(--axistra-gold)] pl-3">
                    <div className="font-display font-semibold text-sm">{s.label}</div>
                    <div className="text-[11px] uppercase tracking-wider text-gray-300 mt-0.5">{s.sub}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-2 hidden lg:flex justify-center">
              <HeroInfrastructureVisual />
            </div>
          </div>
        </div>
      </section>

      {/* Solutions */}
      <section id="solutions" className="py-24 bg-[var(--axistra-bg)]">
        <div className="max-w-7xl mx-auto px-6 lg:px-10">
          <div className="max-w-2xl mb-14">
            <div className="label-xs mb-3">Our Solutions</div>
            <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight">Enterprise Technology<br />That Scales.</h2>
            <p className="mt-5 text-gray-600 leading-relaxed">
              Purpose-built platforms designed to support the complex needs of international
              businesses operating across multiple markets.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {SOLUTIONS.map((s) => {
              const Icon = s.icon;
              return (
                <div key={s.title} className="card-axistra p-7 group" data-testid={`solution-card-${s.title.toLowerCase().replace(/\s+/g, '-')}`}>
                  <div className="w-12 h-12 rounded-lg bg-[var(--axistra-green)] text-white flex items-center justify-center mb-5 group-hover:bg-[var(--axistra-gold)] transition-colors">
                    <Icon size={24} weight="duotone" />
                  </div>
                  <h3 className="font-display text-lg font-semibold tracking-tight">{s.title}</h3>
                  <p className="text-sm text-gray-600 mt-2 leading-relaxed">{s.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Services */}
      <section id="services" className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-6 lg:px-10">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-14">
            <div className="max-w-2xl">
              <div className="label-xs mb-3">Services</div>
              <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight">Technology Services<br />for Global Operations.</h2>
            </div>
            <a href="#contact" className="btn-accent inline-flex items-center gap-2" data-testid="services-contact-btn">Discuss Your Project <ArrowUpRight size={16} /></a>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {SERVICES.map((s) => (
              <div key={s.num} className="border border-gray-200 rounded-lg p-7 hover:border-axistra-green transition-colors" data-testid={`service-card-${s.num}`}>
                <div className="font-mono text-xs text-axistra-gold mb-4">{s.num}</div>
                <h3 className="font-display text-xl font-semibold tracking-tight">{s.title}</h3>
                <p className="text-sm text-gray-600 mt-3 leading-relaxed">{s.desc}</p>
                <ul className="mt-5 space-y-2">
                  {s.points.map((p) => (
                    <li key={p} className="flex items-center gap-2 text-sm">
                      <Check size={14} className="text-axistra-green" weight="bold" />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* About */}
      <section id="about" className="py-24 bg-[var(--axistra-bg)]">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="label-xs mb-3">About Axistra</div>
            <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight">Building the Future of<br />Enterprise Technology.</h2>
            <p className="mt-6 text-gray-700 leading-relaxed">
              AXISTRA TECHNOLOGIES — FZCO specializes in developing and operating cloud-based software platforms and
              communication infrastructure tools for international businesses.
            </p>
            <p className="mt-4 text-gray-600 leading-relaxed">
              Our team brings together deep expertise in telecommunications, enterprise software, and cloud
              architecture to deliver solutions that meet the complex demands of global operations.
            </p>
            <p className="mt-4 text-gray-600 leading-relaxed">
              We focus on building scalable, secure systems that enable organizations to manage digital
              communication services through intuitive online interfaces, supported by enterprise-grade
              infrastructure.
            </p>

            <div className="mt-8 p-6 border-l-4 border-axistra-gold bg-white rounded-r-md">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <Detail label="Registered Entity" value="AXISTRA TECHNOLOGIES — FZCO" />
                <Detail label="Trade License" value="86256" mono />
                <Detail label="Registration No" value="79504" mono />
                <Detail label="Corporate TRN" value="105415374500001" mono />
                <Detail label="Registered Address" value="IFZA Business Park, Dubai Silicon Oasis, Dubai, UAE" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-5">
            {[
              { icon: Globe, k: 'Countries Served', v: 'Multi-region' },
              { icon: BriefcaseMetal, k: 'Enterprise Clients', v: 'Growing' },
              { icon: ChartBar, k: 'Platforms Operated', v: '24×7' },
              { icon: Scales, k: 'Compliance', v: 'UAE / IFZA' },
            ].map((s) => {
              const Icon = s.icon;
              return (
                <div key={s.k} className="card-axistra p-6">
                  <Icon size={28} weight="duotone" className="text-axistra-green" />
                  <div className="mt-4 font-display text-xl font-semibold">{s.v}</div>
                  <div className="label-xs mt-1">{s.k}</div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-6 lg:px-10">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-14">
            <div className="max-w-2xl">
              <div className="label-xs mb-3">Pricing</div>
              <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight">Flexible plans for<br />different operating stages.</h2>
              <p className="mt-5 text-gray-600 leading-relaxed">
                Commercial models are based on operational scale, feature requirements, onboarding scope, and support needs. Final pricing is provided through tailored proposals.
              </p>
            </div>
            <a href="#contact" className="btn-accent inline-flex items-center gap-2" data-testid="pricing-contact-btn">Request Proposal <ArrowUpRight size={16} /></a>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {PRICING.map((plan) => (
              <div key={plan.name} className="card-axistra p-7">
                <div className="font-mono text-xs text-axistra-gold mb-4">{plan.name.toUpperCase()}</div>
                <h3 className="font-display text-xl font-semibold tracking-tight">{plan.target}</h3>
                <p className="text-sm text-gray-600 mt-3 leading-relaxed">{plan.details}</p>
                <ul className="mt-5 space-y-2">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-center gap-2 text-sm">
                      <Check size={14} className="text-axistra-green" weight="bold" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Resources */}
      <section id="resources" className="py-24 bg-[var(--axistra-bg)]">
        <div className="max-w-7xl mx-auto px-6 lg:px-10">
          <div className="max-w-2xl mb-14">
            <div className="label-xs mb-3">Resources</div>
            <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight">Information for buyers,<br />operators, and reviewers.</h2>
            <p className="mt-5 text-gray-600 leading-relaxed">
              These sections summarize Axistra platform scope, service fit, operating model, case examples, eligibility rules, and governance practices for international SaaS operations.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="card-axistra p-7">
              <div className="label-xs mb-3">FAQ</div>
              <div className="space-y-5">
                {FAQS.map(([question, answer]) => (
                  <div key={question} className="border-b border-gray-100 pb-5 last:border-0 last:pb-0">
                    <h3 className="font-display text-lg font-semibold tracking-tight">{question}</h3>
                    <p className="text-sm text-gray-600 mt-2 leading-relaxed">{answer}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-5">
              <div className="card-axistra p-7">
                <div className="label-xs mb-3">Service Status / SLA</div>
                <h3 className="font-display text-xl font-semibold tracking-tight">Availability, response targets, and maintenance communication.</h3>
                <p className="text-sm text-gray-600 mt-3 leading-relaxed">
                  Axistra targets high availability for core platform dashboards and management functions. Planned maintenance is scheduled to minimize operational impact, with customer communication through agreed support channels.
                </p>
                <div className="mt-5 space-y-3">
                  {SLA_ITEMS.map((item) => (
                    <div key={item.severity} className="border border-gray-200 rounded-md p-4">
                      <div className="font-display font-semibold text-sm">{item.severity}</div>
                      <div className="text-xs text-gray-500 mt-1">{item.definition}</div>
                      <div className="text-xs text-axistra-green mt-2 font-semibold">{item.response}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card-axistra p-7">
                <div className="label-xs mb-3">Support Channels</div>
                <p className="text-sm text-gray-600 leading-relaxed">
                  Technical support, commercial requests, legal notices, and privacy questions are routed through the official Axistra email channels listed in the contact section.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Industries */}
      <section id="industries" className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-6 lg:px-10">
          <div className="max-w-2xl mb-14">
            <div className="label-xs mb-3">Industries We Serve</div>
            <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight">Built for structured<br />digital-service operations.</h2>
            <p className="mt-5 text-gray-600 leading-relaxed">
              Axistra platforms are designed for businesses that require communication software operations, account governance, scalable billing workflows, and secure management dashboards.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {INDUSTRIES.map((industry) => (
              <div key={industry.name} className="border border-gray-200 rounded-lg p-7 hover:border-axistra-green transition-colors">
                <Globe size={24} weight="duotone" className="text-axistra-green mb-4" />
                <h3 className="font-display text-lg font-semibold tracking-tight">{industry.name}</h3>
                <p className="text-sm text-gray-600 mt-2 leading-relaxed">{industry.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Case studies */}
      <section id="case-studies" className="py-24 bg-[var(--axistra-bg)]">
        <div className="max-w-7xl mx-auto px-6 lg:px-10">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-14">
            <div className="max-w-2xl">
              <div className="label-xs mb-3">Case Studies</div>
              <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight">Representative platform<br />implementation scenarios.</h2>
            </div>
            <a href="#contact" className="btn-secondary inline-flex items-center gap-2">Discuss Similar Work <ArrowUpRight size={16} /></a>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {CASE_STUDIES.map((study, index) => (
              <div key={study.title} className="card-axistra p-7">
                <div className="font-mono text-xs text-axistra-gold mb-4">{String(index + 1).padStart(2, '0')}</div>
                <h3 className="font-display text-xl font-semibold tracking-tight">{study.title}</h3>
                <p className="text-sm text-gray-600 mt-3 leading-relaxed"><span className="font-semibold text-gray-900">Challenge:</span> {study.challenge}</p>
                <p className="text-sm text-gray-600 mt-3 leading-relaxed"><span className="font-semibold text-gray-900">Outcome:</span> {study.outcome}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Compliance */}
      <section id="compliance" className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-6 lg:px-10">
          <div className="grid lg:grid-cols-5 gap-12">
            <div className="lg:col-span-2">
              <div className="label-xs mb-3">Compliance & Security</div>
              <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight">Clear scope for<br />responsible SaaS operations.</h2>
              <p className="mt-5 text-gray-600 leading-relaxed">
                Axistra maintains public-facing privacy, terms, compliance-scope, restricted-region, onboarding, and security principles for international software delivery and business documentation.
              </p>
              <div className="mt-8 p-6 border-l-4 border-axistra-gold bg-[var(--axistra-bg)] rounded-r-md">
                <Detail label="Legal Entity" value="AXISTRA TECHNOLOGIES — FZCO" />
                <div className="mt-3">
                  <Detail label="Authority" value="Dubai Silicon Oasis / IFZA" />
                </div>
                <div className="mt-3">
                  <Detail label="Primary Business Type" value="Cloud Software, SaaS Infrastructure, IT Consulting & Digital Technology Services" />
                </div>
                <div className="mt-3">
                  <Detail label="Restricted Regions" value="No customers or users located in the United States or Canada" />
                </div>
                <div className="mt-3">
                  <Detail label="Onboarding" value="Strict eligibility review, KYC, and enhanced checks where required" />
                </div>
              </div>
            </div>

            <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-5">
              {COMPLIANCE.map((item) => (
                <div key={item.title} className="card-axistra p-7">
                  <Lock size={24} weight="duotone" className="text-axistra-green mb-4" />
                  <h3 className="font-display text-lg font-semibold tracking-tight">{item.title}</h3>
                  <p className="text-sm text-gray-600 mt-2 leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Contact / sign up */}
      <section id="contact" className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 grid lg:grid-cols-5 gap-12">
          <div className="lg:col-span-2">
            <div className="label-xs mb-3">Get in Touch</div>
            <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight">Let's Discuss<br />Your Project.</h2>
            <p className="mt-5 text-gray-600 leading-relaxed">
              Reach the right AXISTRA TECHNOLOGIES — FZCO team through our official email channels below.
            </p>

            <div className="mt-8 space-y-5">
              <Contact icon={ChatCircleDots} label="General Inquiries" sub="Company & partnerships" email="contact@axistratech.com" />
              <Contact icon={EnvelopeSimple} label="Sales & Commercial" sub="Proposals & subscriptions" email="sales@axistratech.com" />
              <Contact icon={Lightning} label="Customer Support" sub="Technical help & platform" email="support@axistratech.com" />
              <Contact icon={Scales} label="Legal & Compliance" sub="Contracts & privacy" email="legal@axistratech.com" />
            </div>
          </div>

          <form onSubmit={submitLead} className="lg:col-span-3 card-axistra p-8" data-testid="landing-contact-form">
            <h3 className="font-display text-xl font-semibold mb-6">Send us a message</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="label-xs block mb-1.5">First Name</label>
                <input required className="input-axistra" value={signup.first_name} onChange={(e) => setSignup({ ...signup, first_name: e.target.value })} data-testid="lead-first-name" />
              </div>
              <div>
                <label className="label-xs block mb-1.5">Last Name</label>
                <input className="input-axistra" value={signup.last_name} onChange={(e) => setSignup({ ...signup, last_name: e.target.value })} data-testid="lead-last-name" />
              </div>
              <div>
                <label className="label-xs block mb-1.5">Work Email *</label>
                <input required type="email" className="input-axistra" value={signup.email} onChange={(e) => setSignup({ ...signup, email: e.target.value })} data-testid="lead-email" />
              </div>
              <div>
                <label className="label-xs block mb-1.5">Company Name</label>
                <input className="input-axistra" value={signup.company} onChange={(e) => setSignup({ ...signup, company: e.target.value })} data-testid="lead-company" />
              </div>
              <div className="md:col-span-2">
                <label className="label-xs block mb-1.5">How can we help?</label>
                <textarea rows={5} className="input-axistra" value={signup.message} onChange={(e) => setSignup({ ...signup, message: e.target.value })} data-testid="lead-message" />
              </div>
            </div>
            <div className="mt-6 flex items-center justify-between flex-wrap gap-3">
              <p className="text-[11px] text-gray-500 max-w-md">
                By submitting this form, you agree to our <Link to="/privacy-policy" className="text-axistra-green underline">Privacy Policy</Link> and <Link to="/terms-and-conditions" className="text-axistra-green underline">Terms</Link>.
              </p>
              <button disabled={submitting} className="btn-primary inline-flex items-center gap-2" data-testid="lead-submit-btn">
                {submitting ? 'Sending…' : 'Send Message'} <ArrowUpRight size={14} />
              </button>
            </div>
          </form>
        </div>
      </section>

      <PublicFooter />

      {/* Sign-up modal (lead capture) */}
      {signup.open && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" data-testid="signup-modal">
          <div className="bg-white rounded-lg max-w-lg w-full p-8">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="font-display text-2xl font-bold tracking-tight">Get Started</h3>
                <p className="text-sm text-gray-600 mt-1">Tell us about your project — our team will be in touch within one business day.</p>
              </div>
              <button onClick={() => setSignup({ ...signup, open: false })} className="text-gray-400 hover:text-gray-900" data-testid="signup-modal-close">✕</button>
            </div>
            <form onSubmit={submitLead} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <input required placeholder="First name" className="input-axistra" value={signup.first_name} onChange={(e) => setSignup({ ...signup, first_name: e.target.value })} data-testid="signup-first-name" />
                <input placeholder="Last name" className="input-axistra" value={signup.last_name} onChange={(e) => setSignup({ ...signup, last_name: e.target.value })} data-testid="signup-last-name" />
              </div>
              <input required type="email" placeholder="Work email" className="input-axistra" value={signup.email} onChange={(e) => setSignup({ ...signup, email: e.target.value })} data-testid="signup-email" />
              <input placeholder="Company" className="input-axistra" value={signup.company} onChange={(e) => setSignup({ ...signup, company: e.target.value })} data-testid="signup-company" />
              <textarea rows={3} placeholder="What are you looking for?" className="input-axistra" value={signup.message} onChange={(e) => setSignup({ ...signup, message: e.target.value })} data-testid="signup-message" />
              <button disabled={submitting} className="btn-primary w-full py-3" data-testid="signup-submit">{submitting ? 'Sending…' : 'Request Access'}</button>
              <p className="text-xs text-center text-gray-500">Already have a portal account? <Link to="/login" className="text-axistra-green font-semibold hover:underline">Sign in →</Link></p>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const Detail = ({ label, value, mono }) => (
  <div>
    <div className="label-xs">{label}</div>
    <div className={`text-gray-900 mt-1 ${mono ? 'font-mono text-xs' : 'text-sm font-medium'}`}>{value}</div>
  </div>
);

const Contact = ({ icon: Icon, label, sub, email }) => (
  <div className="flex items-start gap-3">
    <div className="w-10 h-10 rounded-lg bg-[var(--axistra-green-light)] text-axistra-green flex items-center justify-center shrink-0">
      <Icon size={18} weight="duotone" />
    </div>
    <div className="text-sm">
      <div className="font-display font-semibold">{label}</div>
      <div className="text-xs text-gray-500 mb-1">{sub}</div>
      <a href={`mailto:${email}`} className="text-axistra-green hover:underline">{email}</a>
    </div>
  </div>
);

const HeroInfrastructureVisual = () => (
  <div className="hero-orbit relative h-96 w-96" aria-hidden="true">
    <div className="hero-glow absolute inset-0 rounded-full bg-[var(--axistra-gold)]/20 blur-2xl" />
    <div className="hero-ring absolute inset-6 rounded-full border border-white/15" />
    <div className="hero-ring hero-ring-delay absolute inset-16 rounded-full border border-[var(--axistra-gold)]/30" />

    <div className="hero-core absolute left-1/2 top-1/2 flex h-32 w-32 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-white shadow-2xl backdrop-blur-md">
      <CloudArrowUp size={54} weight="duotone" />
    </div>

    <div className="hero-node hero-node-a absolute left-8 top-20">
      <Phone size={24} weight="duotone" />
      <span>Voice</span>
    </div>
    <div className="hero-node hero-node-b absolute right-6 top-28">
      <ChartBar size={24} weight="duotone" />
      <span>Billing</span>
    </div>
    <div className="hero-node hero-node-c absolute bottom-16 left-16">
      <Lock size={24} weight="duotone" />
      <span>Secure</span>
    </div>
    <div className="hero-node hero-node-d absolute bottom-20 right-12">
      <Globe size={24} weight="duotone" />
      <span>Global</span>
    </div>
    <div className="hero-node hero-node-e absolute left-1/2 top-2 -translate-x-1/2">
      <Cube size={24} weight="duotone" />
      <span>SaaS</span>
    </div>

    <div className="hero-packet hero-packet-a" />
    <div className="hero-packet hero-packet-b" />
    <div className="hero-packet hero-packet-c" />
  </div>
);
