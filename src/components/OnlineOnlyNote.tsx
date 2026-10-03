import React from 'react';
import { OfflineNote } from './ui';
import { useOnline } from './useOnline';

/**
 * For screens whose saves go straight to the server (not through the offline
 * queue): says so while offline, before the user fills anything in. The
 * screen also disables its save buttons with `useOnline()`.
 */
export function OnlineOnlyNote({ text }: { text: string }) {
  const online = useOnline();
  return online ? null : <OfflineNote text={text} />;
}
