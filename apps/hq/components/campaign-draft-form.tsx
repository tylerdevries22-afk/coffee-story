'use client';

import { useActionState } from 'react';

import { saveCampaignDraftAction } from '@/app/(console)/campaigns/actions';
import { CAMPAIGN_ACTION_IDLE } from '@/lib/campaign-action-state';

/**
 * The "New campaign" card. Saving here only ever writes status 'draft' --
 * there is no send-now path on this form, and the copy says so rather than
 * implying one.
 */
export function CampaignDraftForm() {
  const [state, submit, pending] = useActionState(saveCampaignDraftAction, CAMPAIGN_ACTION_IDLE);

  return (
    <div className="card">
      <h2>New campaign</h2>
      <form action={submit} aria-busy={pending}>
        <div className="grid-2">
          <div>
            <label className="field">Name<input name="name" required maxLength={160} placeholder="Weekend drop reminder" /></label>
            <label className="field">Channel
              <select name="channel" defaultValue="push">
                <option value="push">push</option>
                <option value="sms">sms</option>
                <option value="email">email</option>
              </select>
            </label>
            <label className="field">Audience
              <select name="audience" defaultValue="all">
                <option value="all">Everyone</option>
                <option value="lapsed_30">Lapsed 30 days</option>
                <option value="loyalty_500">Loyalty 500+ points</option>
                <option value="last_drop">Ordered the last drop</option>
              </select>
            </label>
            <label className="field">Schedule<input type="datetime-local" name="scheduledAt" /></label>
          </div>
          <div>
            <label className="field">Subject (email only)<input name="subject" maxLength={200} placeholder="It's back" /></label>
            <label className="field">Message
              <textarea name="message" rows={6} required maxLength={4000} placeholder="The Honey Lavender Latte returns Friday…" />
            </label>
          </div>
        </div>
        {state.kind === 'error' ? <div className="notice danger" role="alert">{state.message}</div> : null}
        {state.kind === 'success' ? <div className="notice" role="status">{state.message}</div> : null}
        <button className="button" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save draft'}</button>
      </form>
    </div>
  );
}
