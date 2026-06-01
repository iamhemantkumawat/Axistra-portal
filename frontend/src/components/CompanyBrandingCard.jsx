import React, { useEffect, useState } from 'react';
import api from '../lib/api';
import { Field } from './Atoms';
import { ImageSquare, Stamp, Signature, TrashSimple } from '@phosphor-icons/react';
import { toast } from 'sonner';

/**
 * Settings card to upload the Director's signature and company seal PNGs.
 * These are stored base64-encoded in `app_settings.company_branding` and
 * embedded into every Offer Letter, Board Resolution and Salary Slip.
 */
export default function CompanyBrandingCard() {
  const [branding, setBranding] = useState({});
  const [busy, setBusy] = useState(false);

  const load = () => api.get('/payroll/branding').then((r) => setBranding(r.data || {}));
  useEffect(() => { load(); }, []);

  const save = async (patch) => {
    setBusy(true);
    try {
      const { data } = await api.post('/payroll/branding', patch);
      setBranding(data);
      toast.success('Branding updated');
    } catch (err) { toast.error(err.response?.data?.message || 'Save failed'); }
    finally { setBusy(false); }
  };

  const onFile = (key) => (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/^image\//.test(f.type)) { toast.error('Please upload a PNG/JPG image'); return; }
    if (f.size > 800_000) { toast.error('Image must be <800KB — please optimize first'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = String(reader.result || '').split(',')[1];
      save({ [key]: b64 });
    };
    reader.readAsDataURL(f);
  };

  const clear = (key) => save({ [key]: null });

  return (
    <div className="card-axistra p-6 lg:col-span-2" data-testid="company-branding-card">
      <h3 className="font-display text-lg font-semibold flex items-center gap-2 mb-1">
        <ImageSquare size={20} weight="duotone" className="text-axistra-green" /> Company Branding
      </h3>
      <p className="text-xs text-gray-500 mb-4">
        Used on Offer Letters, Board Resolutions and Salary Slips. PNGs work best with transparent backgrounds.
      </p>

      <div className="grid md:grid-cols-3 gap-4">
        <Field label="Director Name">
          <input
            type="text"
            defaultValue={branding.director_name || 'Hemant Kumawat'}
            onBlur={(e) => save({ director_name: e.target.value })}
            className="input-axistra"
            data-testid="branding-director-name-input"
          />
        </Field>
        <BrandingSlot
          label="Director Signature (PNG)"
          icon={<Signature size={18} weight="duotone" className="text-axistra-gold" />}
          base64={branding.director_signature}
          onUpload={onFile('director_signature')}
          onClear={() => clear('director_signature')}
          testId="branding-signature"
          busy={busy}
        />
        <BrandingSlot
          label="Company Seal (PNG)"
          icon={<Stamp size={18} weight="duotone" className="text-axistra-gold" />}
          base64={branding.company_seal}
          onUpload={onFile('company_seal')}
          onClear={() => clear('company_seal')}
          testId="branding-seal"
          busy={busy}
        />
      </div>
    </div>
  );
}

function BrandingSlot({ label, icon, base64, onUpload, onClear, testId, busy }) {
  return (
    <div className="border border-dashed border-gray-300 rounded-md p-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-gray-500 mb-2">{icon}{label}</div>
      {base64 ? (
        <div className="space-y-2">
          <img
            src={`data:image/png;base64,${base64}`}
            alt={label}
            className="h-20 max-w-full object-contain bg-white border border-gray-100 rounded"
            data-testid={`${testId}-preview`}
          />
          <div className="flex gap-2">
            <label className="text-xs text-axistra-green hover:underline cursor-pointer">
              Replace
              <input type="file" accept="image/*" className="hidden" onChange={onUpload} disabled={busy} data-testid={`${testId}-replace`} />
            </label>
            <button onClick={onClear} disabled={busy} className="text-xs text-red-600 hover:underline inline-flex items-center gap-1" data-testid={`${testId}-clear`}>
              <TrashSimple size={11} /> Remove
            </button>
          </div>
        </div>
      ) : (
        <label className="block cursor-pointer text-center py-6 text-sm text-gray-500 hover:text-axistra-green hover:bg-gray-50 rounded">
          <input type="file" accept="image/*" className="hidden" onChange={onUpload} disabled={busy} data-testid={`${testId}-upload`} />
          Click to upload
          <div className="text-[10px] mt-1">PNG/JPG · &lt;800KB</div>
        </label>
      )}
    </div>
  );
}
