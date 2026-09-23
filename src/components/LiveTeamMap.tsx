import React from 'react';
import { View } from 'react-native';
import { Empty, H, Muted } from './ui';
import { LeafletMap, MapMarker } from './LeafletMap';
import { C } from '../theme';
import { Store, User, Visit } from '../types';

/**
 * Live map of a TL's/ARCO's team currently-active (not-yet-checked-out)
 * visits — PRD §8 "Live map of team's current check-ins (reuse existing
 * live-map component)". Phase 4a (PRD §16).
 */
export function LiveTeamMap({
  ncUsers,
  visits,
  stores,
}: {
  ncUsers: User[];
  visits: Visit[];
  stores: Store[];
}) {
  const ncIds = new Set(ncUsers.map((u) => u.id));
  const active = visits.filter((v) => !v.checkOutAt && ncIds.has(v.ncId));

  if (!active.length) {
    return (
      <View>
        <H>Peta Live Tim</H>
        <Empty text="Tidak ada anggota tim yang sedang check-in di toko saat ini." />
      </View>
    );
  }

  const markers: MapMarker[] = active.map((v) => {
    const nc = ncUsers.find((u) => u.id === v.ncId);
    const store = stores.find((s) => s.id === v.storeId);
    return {
      lat: v.lat,
      lng: v.lng,
      label: `${nc?.name ?? 'NC'} · ${store?.name ?? 'Toko'}`,
      color: v.geoValid ? C.ok : C.warn,
    };
  });

  return (
    <View style={{ gap: 8 }}>
      <H>Peta Live Tim</H>
      <Muted>{active.length} kunjungan sedang berlangsung.</Muted>
      <LeafletMap markers={markers} height={260} />
    </View>
  );
}
