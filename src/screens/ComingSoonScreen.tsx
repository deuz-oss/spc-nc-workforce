import React from 'react';
import { useRoute } from '@react-navigation/native';
import { ComingSoon } from '../components/ui';

/**
 * Generic placeholder pushed for any module deferred to Phase 2/3/4 (PRD §16)
 * — 7 report modules, Nutrition Quiz, chat, TL/ARCO validation console,
 * scorecards, Reckitt dashboard. Keeps navigation coherent end-to-end for
 * Phase 1 without pretending the business logic exists yet.
 */
export default function ComingSoonScreen() {
  const route = useRoute<any>();
  const { title, phase, note } = route.params ?? {};
  return <ComingSoon title={title ?? 'Segera Hadir'} phase={phase ?? 'Phase berikutnya'} note={note} />;
}
