import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { toast } from 'sonner';
import {
  ShieldCheck, Globe, Cube, CloudArrowUp, Phone, Lightning, ChartBar, Lock,
  ArrowUpRight, Check, EnvelopeSimple, ChatCircleDots, BriefcaseMetal, Scales,
} from '@phosphor-icons/react';

const LOGO_URL =
  'https://customer-assets.emergentagent.com/job_77b30401-d314-4df8-b00a-60fb542707e3/artifacts/gzs8xexa_ChatGPT%20Image%20May%2022%2C%202026%2C%2002_57_04%20PM.png';

const SOLUTIONS = [
  { icon: Phone, title: 'Communication Management', desc: 'Unified platforms for voice, messaging, and digital communications across global operations.' },
  { icon: ChartBar, title: 'Billing Platforms', desc: 'Multi-currency billing & revenue management with automated invoicing and real-time analytics.' },
  { icon: CloudArrowUp, title: 'Web-Based Dashboards', desc: 'Intuitive, secure dashboards with full visibility into your services and operational metrics.' },
  { icon: Cube, title: 'Cloud Infrastructure', desc: 'Scalable cloud-hosted solutions on international infrastructure with low latency, high availability.' },
  { icon: Globe, title: 'Global Connectivity', desc: 'Seamless integration with telecommunications networks and providers across regions.' },
  { icon: Lock, title: 'Security & Compliance', desc: 'Enterprise-grade security protocols and compliance frameworks for international business.' },
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

export default function Landing() {
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
    <div className="min-h-screen bg-white text-[#111827]">
      {/* Nav */}
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <img src={LOGO_URL} alt="Axistra" className="w-9 h-9" />
            <div>
              <div className="font-display font-bold tracking-tight text-axistra-green leading-none">AXISTRA</div>
              <div className="text-[9px] uppercase tracking-[0.2em] text-gray-500 mt-0.5">Technologies — FZCO</div>
            </div>
          </Link>
          <nav className="hidden md:flex items-center gap-7 text-sm">
            <a href="#solutions" className="text-gray-700 hover:text-axistra-green">Solutions</a>
            <a href="#services" className="text-gray-700 hover:text-axistra-green">Services</a>
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
            <div className="lg:col-span-3">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-xs uppercase tracking-[0.18em] mb-6">
                <ShieldCheck size={14} weight="duotone" className="text-axistra-gold" />
                <span>Trusted by enterprises worldwide</span>
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
                  { label: 'Enterprise Security', sub: 'SOC 2 Compliant' },
                  { label: '99.99% Uptime', sub: 'SLA Guaranteed' },
                  { label: 'Multi-Region', sub: 'Global Reach' },
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
              <div className="relative">
                <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-[var(--axistra-gold)]/30 to-transparent blur-2xl" />
                <img src={LOGO_URL} alt="Axistra Shield" className="relative w-80 h-80 object-contain" />
              </div>
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
                <Detail label="UAE Registration" value="IFZA Free Zone, Dubai, UAE" />
                <Detail label="Corporate TRN" value="105415374500001" mono />
                <Detail label="Established" value="2022" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-5">
            {[
              { icon: Globe, k: 'Countries Served', v: 'Multi-region' },
              { icon: BriefcaseMetal, k: 'Enterprise Clients', v: 'Growing' },
              { icon: ChartBar, k: 'Platforms Operated', v: '24×7' },
              { icon: Scales, k: 'Compliance', v: 'UAE / SOC 2' },
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
                By submitting this form, you agree to our <a href="#" className="text-axistra-green underline">Privacy Policy</a> and <a href="#" className="text-axistra-green underline">Terms</a>.
              </p>
              <button disabled={submitting} className="btn-primary inline-flex items-center gap-2" data-testid="lead-submit-btn">
                {submitting ? 'Sending…' : 'Send Message'} <ArrowUpRight size={14} />
              </button>
            </div>
          </form>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[var(--axistra-green)] text-white py-12">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 grid md:grid-cols-3 gap-8">
          <div>
            <div className="flex items-center gap-2.5">
              <img src={LOGO_URL} alt="Axistra" className="w-9 h-9 bg-white rounded p-0.5" />
              <div>
                <div className="font-display font-bold tracking-tight">AXISTRA</div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-axistra-gold">Technologies — FZCO</div>
              </div>
            </div>
            <p className="text-sm text-gray-300 mt-4 max-w-sm leading-relaxed">
              Innovate · Connect · Grow.<br />Cloud communications and SaaS platforms for global enterprises.
            </p>
          </div>
          <div className="text-sm text-gray-300 leading-relaxed">
            <div className="font-display text-white mb-2">Headquarters</div>
            IFZA Free Zone, Dubai<br />United Arab Emirates<br />
            <span className="font-mono text-xs text-axistra-gold mt-2 block">TRN 105415374500001</span>
          </div>
          <div className="text-sm text-gray-300 leading-relaxed">
            <div className="font-display text-white mb-2">Quick links</div>
            <div className="space-y-1">
              <a href="#solutions" className="block hover:text-axistra-gold">Solutions</a>
              <a href="#services" className="block hover:text-axistra-gold">Services</a>
              <a href="#contact" className="block hover:text-axistra-gold">Contact</a>
              <Link to="/login" className="block hover:text-axistra-gold">Portal Login</Link>
            </div>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-6 lg:px-10 mt-10 pt-6 border-t border-white/10 text-[11px] text-gray-400 flex flex-wrap justify-between gap-3">
          <span>© {new Date().getFullYear()} AXISTRA TECHNOLOGIES — FZCO. All rights reserved.</span>
          <span>Innovate · Connect · Grow</span>
        </div>
      </footer>

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
