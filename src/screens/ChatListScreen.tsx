import React, { useCallback, useMemo } from 'react';
import { ScrollView } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Badge, Empty, ListRow, SectionHeader } from '../components/ui';
import { C } from '../theme';
import { useCurrentUser, useStore } from '../store/useStore';
import { Conversation, ConversationType } from '../types';
import { fmtDateTime } from '../utils/format';

/**
 * In-app messaging (PRD §17), Phase 4b (PRD §16). Scope: 1:1 NC<->TL and
 * TL<->ARCO only (no group chat, no NC<->ARCO direct threads — PRD §17's
 * default assumption is escalation always routes through the TL first).
 *
 * Conversations are NOT eagerly created for every possible counterpart —
 * only when a thread is actually opened (see onPress below), so an inactive
 * pairing never leaves an empty row in the `conversations` table.
 */

interface CounterpartRow {
  id: string;
  name: string;
  roleLabel: string;
  type: ConversationType;
}

function findConversation(conversations: Conversation[], type: ConversationType, me: string, other: string) {
  return conversations.find(
    (c) => c.type === type && ((c.participantA === me && c.participantB === other) || (c.participantA === other && c.participantB === me)),
  );
}

export default function ChatListScreen() {
  const me = useCurrentUser()!;
  const navigation = useNavigation<any>();
  const users = useStore((s) => s.users);
  const teams = useStore((s) => s.teams);
  const conversations = useStore((s) => s.conversations);
  const messages = useStore((s) => s.messages);
  const ensureConversation = useStore((s) => s.ensureConversation);
  const refreshChat = useStore((s) => s.refreshChat);

  // New messages/conversations that arrived while the app was backgrounded
  // never reach the phone over realtime — re-fetch whenever the tab is shown.
  useFocusEffect(
    useCallback(() => {
      void refreshChat();
    }, [refreshChat]),
  );

  const rows: CounterpartRow[] = useMemo(() => {
    if (me.role === 'nc') {
      const team = teams.find((t) => t.id === me.teamId);
      const tl = team?.tlId ? users.find((u) => u.id === team.tlId) : undefined;
      return tl ? [{ id: tl.id, name: tl.name, roleLabel: 'Team Leader', type: 'nc_tl' as const }] : [];
    }
    if (me.role === 'tl') {
      const ncs = users
        .filter((u) => u.role === 'nc' && u.active && u.teamId === me.teamId)
        .map((u) => ({ id: u.id, name: u.name, roleLabel: 'Nutrition Consultant', type: 'nc_tl' as const }));
      const team = teams.find((t) => t.id === me.teamId);
      const arco = team?.arcoId ? users.find((u) => u.id === team.arcoId) : undefined;
      return arco ? [...ncs, { id: arco.id, name: arco.name, roleLabel: 'Area Coordinator', type: 'tl_arco' as const }] : ncs;
    }
    if (me.role === 'arco') {
      const myTeamIds = new Set(teams.filter((t) => t.arcoId === me.id).map((t) => t.id));
      return users
        .filter((u) => u.role === 'tl' && u.active && u.teamId && myTeamIds.has(u.teamId))
        .map((u) => ({ id: u.id, name: u.name, roleLabel: 'Team Leader', type: 'tl_arco' as const }));
    }
    return [];
  }, [me, users, teams]);

  const openThread = async (row: CounterpartRow) => {
    try {
      const conversationId = await ensureConversation(row.type, row.id);
      navigation.navigate('ChatThread', { conversationId, counterpartName: row.name });
    } catch {
      // ensureConversation already surfaces its own failure via the thrown
      // error's message where relevant; a silent no-op here is acceptable
      // since the row stays tappable and the user can just retry.
    }
  };

  return (
    <ScrollView tabIndex={0} role="main" contentContainerStyle={{ padding: 16, gap: 8, maxWidth: 700, width: '100%', alignSelf: 'center' }}>
      <SectionHeader title="Pesan" subtitle="NC ↔ TL / TL ↔ ARCO (PRD §17)" />
      {rows.length === 0 ? (
        <Empty
          text={
            me.role === 'nc'
              ? 'Tim kamu belum punya Team Leader — chat belum bisa dipakai.'
              : 'Belum ada lawan bicara yang terhubung.'
          }
        />
      ) : (
        rows.map((row) => {
          const convo = findConversation(conversations, row.type, me.id, row.id);
          const convoMessages = convo ? messages.filter((m) => m.conversationId === convo.id) : [];
          // Store order isn't chronological (hydrate order + realtime prepends) — pick the newest explicitly.
          const last = convoMessages.reduce<(typeof convoMessages)[number] | undefined>(
            (newest, m) => (!newest || m.createdAt > newest.createdAt ? m : newest),
            undefined,
          );
          const unread = convoMessages.some((m) => m.senderId !== me.id && m.readAt == null);
          return (
            <ListRow
              key={row.id}
              title={row.name}
              subtitle={last ? `${last.senderId === me.id ? 'Kamu: ' : ''}${last.body}` : row.roleLabel}
              meta={last ? fmtDateTime(last.createdAt) : undefined}
              trailing={unread ? <Badge label="Baru" color={C.accent} /> : undefined}
              onPress={() => openThread(row)}
            />
          );
        })
      )}
    </ScrollView>
  );
}
