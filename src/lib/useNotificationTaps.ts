import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';

/** Opens the related letter when someone taps a push notification. */
export function useNotificationTaps(enabled: boolean) {
  const last = Notifications.useLastNotificationResponse();
  useEffect(() => {
    const letterId = last?.notification.request.content.data?.letterId;
    if (enabled && typeof letterId === 'string') router.push(`/letter/${letterId}`);
  }, [last, enabled]);
}
