import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAppRoute } from '../navigation';
import { setOpenConversation } from '../notifications';
import { Btn, Empty, Input, OfflineNote, StickyFooter } from '../components/ui';
import { useOnline } from '../components/useOnline';
import { C, T } from '../theme';
import { useCurrentUser, useStore } from '../store/useStore';
import { fmtDateTime } from '../utils/format';

/** Message thread (PRD §17). Online-required send (no offline queue — an
 * intentionally new, unscoped-for-now queue class per the PRD review note);
 * a failed send shows a dialog rather than silently dropping the message. */
export default function ChatThreadScreen() {
  const route = useAppRoute<'ChatThread'>();
  const me = useCurrentUser()!;
  const conversationId: string = route.params?.conversationId;
  const counterpartName: string = route.params?.counterpartName ?? '';
  const allMessages = useStore((s) => s.messages);
  const sendMessage = useStore((s) => s.sendMessage);
  const markMessagesRead = useStore((s) => s.markMessagesRead);

  const online = useOnline();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const thread = useMemo(
    () => allMessages.filter((m) => m.conversationId === conversationId).sort((a, b) => a.createdAt - b.createdAt),
    [allMessages, conversationId],
  );

  // Pull anything realtime missed (e.g. messages sent while the app was in the
  // background) every time the thread is opened.
  const refreshChat = useStore((s) => s.refreshChat);
  useFocusEffect(
    useCallback(() => {
      void refreshChat();
      // While this thread is on screen its own push notifications aren't shown.
      setOpenConversation(conversationId);
      return () => setOpenConversation(null);
    }, [refreshChat, conversationId]),
  );

  useEffect(() => {
    markMessagesRead(conversationId);
  }, [conversationId, thread.length]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setText('');
    try {
      await sendMessage(conversationId, body);
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    } catch {
      setText(body); // restore so the user doesn't lose what they typed
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={scrollRef}
        tabIndex={0}
        role="main"
        contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 90, maxWidth: 700, width: '100%', alignSelf: 'center' }}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
        {thread.length === 0 ? (
          <Empty icon="chatbubbles-outline" text={`Belum ada pesan dengan ${counterpartName || 'lawan bicara'}. Tulis pesan pertama di bawah.`} />
        ) : (
          thread.map((m) => {
            const mine = m.senderId === me.id;
            return (
              <View key={m.id} style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
                <View
                  style={{
                    maxWidth: '80%',
                    backgroundColor: mine ? C.primary : C.card,
                    borderWidth: mine ? 0 : 1,
                    borderColor: C.border,
                    borderRadius: 14,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                  }}
                >
                  <Text style={[T.body, { color: mine ? C.onPrimary : C.text }]}>{m.body}</Text>
                </View>
                <Text style={[T.meta, { marginTop: 2 }]}>{fmtDateTime(m.createdAt)}</Text>
              </View>
            );
          })
        )}
      </ScrollView>

      <StickyFooter>
        {!online && <OfflineNote text="Offline — pesan bisa dikirim lagi setelah ada koneksi." />}
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <Input
              placeholder="Tulis pesan..."
              value={text}
              onChangeText={setText}
              onSubmitEditing={send}
              returnKeyType="send"
              accessibilityLabel={`Pesan untuk ${counterpartName || 'lawan bicara'}`}
            />
          </View>
          <Btn title="Kirim" onPress={send} disabled={busy || !text.trim() || !online} loading={busy} small />
        </View>
      </StickyFooter>
    </View>
  );
}
