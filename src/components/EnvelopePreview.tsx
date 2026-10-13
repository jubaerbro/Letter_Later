import { View } from 'react-native';
import type { Envelope as EnvelopeData } from '@shared/domain/reveal.ts';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { Envelope } from './Envelope';
import { Text } from './ui/Text';

/** Exactly what the recipient will see in their mailbox before the opening day. */
export function EnvelopePreview({ envelope, opensLabel }: { envelope: EnvelopeData; opensLabel: string }) {
  const { colors } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`Preview of what they will see: ${envelope.from ? `From ${envelope.from}` : 'From someone special'}. ${envelope.subject ? `Subject: ${envelope.subject}.` : ''} ${envelope.preview ? `Note: ${envelope.preview}.` : ''} Opens ${opensLabel}.`}
      style={{ alignItems: 'center', gap: space.sm, padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceSunken }}
    >
      <Text variant="caption" color="muted">
        WHAT THEY’LL SEE WHILE THEY WAIT
      </Text>
      <Envelope width={190} initial={envelope.from?.[0]} />
      <Text variant="heading" center>
        {envelope.from ? `From ${envelope.from}` : 'From someone special'}
      </Text>
      {envelope.fromHandle && (
        <Text variant="small" color="muted">
          @{envelope.fromHandle}
        </Text>
      )}
      {envelope.subject && (
        <Text variant="bodyStrong" center>
          “{envelope.subject}”
        </Text>
      )}
      {envelope.preview && (
        <Text variant="body" color="inkSoft" center style={{ fontStyle: 'italic' }}>
          {envelope.preview}
        </Text>
      )}
      <Text variant="small" color="inkSoft">
        Opens {opensLabel}
      </Text>
    </View>
  );
}
