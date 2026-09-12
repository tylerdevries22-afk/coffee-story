'use client';

import { useActionState } from 'react';

import { scheduleDropAction } from '@/app/(console)/drops/actions';
import { DROP_ACTION_IDLE } from '@/lib/drop-action-state';

export type DropMenuItemOption = { readonly id: string; readonly name: string };

/**
 * The "Schedule a drop" card. `drops.item_id` is a required foreign key, so
 * the item field is a select over the brand's own menu rather than free
 * text -- a brand with no menu items yet has nothing to drop.
 *
 * Hero image upload and the auto-drafted announcement campaign are not wired
 * up yet: menu photography is its own contract (docs/MENU-IMAGERY.md) and an
 * auto-drafted campaign needs its own defaults, both out of scope for making
 * this button actually schedule a drop. Both controls stay visible but
 * disabled rather than silently accepting input that goes nowhere.
 */
export function ScheduleDropForm({ menuItems }: { readonly menuItems: readonly DropMenuItemOption[] }) {
  const [state, submit, pending] = useActionState(scheduleDropAction, DROP_ACTION_IDLE);

  if (menuItems.length === 0) {
    return (
      <div className="card">
        <h2>Schedule a drop</h2>
        <div className="notice">Add a menu item first -- a drop always features one.</div>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Schedule a drop</h2>
      <form action={submit} aria-busy={pending}>
        <label className="field">Item
          <select name="itemId" defaultValue="" required>
            <option value="" disabled>Choose an item</option>
            {menuItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="field">Starts<input type="datetime-local" name="startsAt" required /></label>
        <label className="field">Ends<input type="datetime-local" name="endsAt" required /></label>
        <label className="field">Hero image<input type="file" accept="image/*" disabled /></label>
        <label className="field">
          <input type="checkbox" disabled style={{ display: 'inline', width: 'auto' }} />
          {' '}Draft the announcement campaign automatically (coming soon)
        </label>
        {state.kind === 'error' ? <div className="notice danger" role="alert">{state.message}</div> : null}
        {state.kind === 'success' ? <div className="notice" role="status">{state.message}</div> : null}
        <button className="button" type="submit" disabled={pending}>{pending ? 'Scheduling…' : 'Schedule'}</button>
      </form>
    </div>
  );
}
