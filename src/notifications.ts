import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from './navigation';
import { useStore } from './store/useStore';

/**
 * Chat push notifications in the app: how they show while the app is open,
 * and opening the right thread when one is tapped (send-push puts
 * `{type: 'chat', conversationId}` in the payload). Native only.
 */

/** Lets code outside React (a notification tap) navigate. Passed to NavigationContainer. */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/** The conversation open on screen now — its own notifications aren't shown. */
let openConversationId: string | null = null;
export function setOpenConversation(id: string | null) {
  openConversationId = id;
}

/** A tapped chat waiting for navigation to be ready / the user to be signed in. */
let pendingChat: string | null = null;

function chatConversationOf(n: Notifications.Notification): string | null {
  const d = n.request.content.data as { type?: unknown; conversationId?: unknown } | undefined;
  return d?.type === 'chat' && typeof d.conversationId === 'string' ? d.conversationId : null;
}

function openChat(conversationId: string): boolean {
  const st = useStore.getState();
  if (!navigationRef.isReady() || !st.sessionUserId) return false;
  const conv = st.conversations.find((c) => c.id === conversationId);
  const otherId = conv && (conv.participantA === st.sessionUserId ? conv.participantB : conv.participantA);
  const counterpartName = st.users.find((u) => u.id === otherId)?.name;
  navigationRef.navigate('ChatThread', { conversationId, counterpartName });
  return true;
}

/** Opens a chat tapped while signed out / before navigation was ready. Call
 * when navigation becomes ready and when a user signs in. */
export function flushPendingChat() {
  if (pendingChat && openChat(pendingChat)) pendingChat = null;
}

let installed = false;

export function installNotificationHandlers() {
  if (installed || Platform.OS === 'web') return;
  installed = true;

  // While the app is open: show the banner, except for the thread on screen.
  Notifications.setNotificationHandler({
    handleNotification: async (n) => {
      const visible = chatConversationOf(n) == null || chatConversationOf(n) !== openConversationId;
      return { shouldShowBanner: visible, shouldShowList: visible, shouldPlaySound: visible, shouldSetBadge: false };
    },
  });

  if (Platform.OS === 'android') {
    // Expo pushes go to the "default" channel; high importance makes them heads-up.
    void Notifications.setNotificationChannelAsync('default', {
      name: 'Pesan',
      importance: Notifications.AndroidImportance.HIGH,
    }).catch(() => undefined);
  }

  const onTap = (r: Notifications.NotificationResponse) => {
    const conversationId = chatConversationOf(r.notification);
    if (!conversationId) return;
    if (!openChat(conversationId)) pendingChat = conversationId;
    // Handled — don't reopen it on the next app start.
    void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
  };
  Notifications.addNotificationResponseReceivedListener(onTap);
  // The app was launched by tapping a notification.
  void Notifications.getLastNotificationResponseAsync()
    .then((r) => r && onTap(r))
    .catch(() => undefined);
}
