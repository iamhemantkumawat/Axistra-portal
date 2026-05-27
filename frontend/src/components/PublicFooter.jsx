import React from 'react';
import { Link } from 'react-router-dom';
import { COMPANY, BUSINESS_ACTIVITIES } from '../pages/legal-content';

const LOGO_URL = '/axistra-wordmark-darkbg.png';

export default function PublicFooter() {
  return (
    <footer className="bg-[var(--axistra-green)] text-white py-12">
      <div className="max-w-7xl mx-auto px-6 lg:px-10 grid gap-10 md:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="flex items-center">
            <img src={LOGO_URL} alt="Axistra Technologies" className="h-16 w-auto object-contain" />
          </div>
          <p className="text-sm text-gray-300 mt-4 max-w-sm leading-relaxed">
            Innovate · Connect · Grow.<br />Cloud communications software, SaaS infrastructure, IT consulting, and digital technology services.
          </p>
        </div>

        <div className="text-sm text-gray-300 leading-relaxed">
          <div className="font-display text-white mb-3 uppercase tracking-wider text-xs">Company Details</div>
          <div className="mb-3">{COMPANY.address}</div>
          <dl className="space-y-1.5 text-xs">
            <div className="flex gap-2"><dt className="text-axistra-gold w-20 uppercase tracking-wider">License</dt><dd className="font-mono">{COMPANY.license}</dd></div>
            <div className="flex gap-2"><dt className="text-axistra-gold w-20 uppercase tracking-wider">Reg. No</dt><dd className="font-mono">{COMPANY.registration}</dd></div>
            <div className="flex gap-2"><dt className="text-axistra-gold w-20 uppercase tracking-wider">TRN</dt><dd className="font-mono">{COMPANY.trn}</dd></div>
            <div className="flex gap-2"><dt className="text-axistra-gold w-20 uppercase tracking-wider">GIBAN</dt><dd className="font-mono break-all">{COMPANY.giban}</dd></div>
          </dl>
        </div>

        <div className="text-sm text-gray-300 leading-relaxed">
          <div className="font-display text-white mb-2">Business Scope</div>
          <div>{COMPANY.structure}</div>
          <div>{COMPANY.shareCapital}</div>
          <div className="mt-2">{COMPANY.authority}</div>
          <div className="mt-2 text-axistra-gold">Service availability: eligible regions only. No USA/Canada.</div>
          <div className="text-axistra-gold">Strict onboarding and KYC checks apply.</div>
          <ul className="mt-2 space-y-1">
            {BUSINESS_ACTIVITIES.map((activity) => (
              <li key={activity}>{activity}</li>
            ))}
          </ul>
        </div>

        <div className="text-sm text-gray-300 leading-relaxed">
          <div className="font-display text-white mb-2">Links</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <a href="/#solutions" className="hover:text-axistra-gold">Solutions</a>
            <a href="/#services" className="hover:text-axistra-gold">Services</a>
            <a href="/#pricing" className="hover:text-axistra-gold">Pricing</a>
            <a href="/#resources" className="hover:text-axistra-gold">FAQ</a>
            <a href="/#industries" className="hover:text-axistra-gold">Industries</a>
            <a href="/#case-studies" className="hover:text-axistra-gold">Case Studies</a>
            <a href="/#compliance" className="hover:text-axistra-gold">Compliance</a>
            <a href="/#contact" className="hover:text-axistra-gold">Contact</a>
            <Link to="/privacy-policy" className="hover:text-axistra-gold">Privacy Policy</Link>
            <Link to="/terms-and-conditions" className="hover:text-axistra-gold">Terms</Link>
            <Link to="/login" className="hover:text-axistra-gold">Portal Login</Link>
          </div>
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-6 lg:px-10 mt-10 pt-6 border-t border-white/10 text-[11px] text-gray-400 flex flex-wrap justify-between gap-3">
        <span>© {new Date().getFullYear()} {COMPANY.name}. All rights reserved.</span>
        <span>{COMPANY.primaryBusiness}</span>
      </div>
    </footer>
  );
}
