import { useRef } from 'react';
import { Modal, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import SignatureScreen from 'react-native-signature-canvas';
import { colors } from '../lib/theme';
import { Button } from './ui';

// Full-screen signing pad. onDone(dataUrl) with a PNG data URL, or onCancel().
export default function SignatureModal({ visible, title, onDone, onCancel }) {
  const ref = useRef(null);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={{ padding: 16, gap: 4 }}>
          <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text }}>{title}</Text>
          <Text style={{ color: colors.muted }}>Have them sign with a finger in the box.</Text>
        </View>
        <View style={{ flex: 1, marginHorizontal: 16, borderWidth: 1, borderColor: colors.border, borderRadius: 12, overflow: 'hidden' }}>
          <SignatureScreen
            ref={ref}
            onOK={(sig) => onDone(sig)}
            onEmpty={() => {}}
            autoClear={false}
            imageType="image/png"
            trimWhitespace
            webStyle={`.m-signature-pad--footer { display: none; } .m-signature-pad { box-shadow: none; border: none; }
              body, html { height: 100%; }`}
          />
        </View>
        <View style={{ flexDirection: 'row', gap: 10, padding: 16 }}>
          <Button title="Cancel" variant="secondary" onPress={onCancel} style={{ flex: 1 }} />
          <Button title="Clear" variant="secondary" onPress={() => ref.current?.clearSignature()} style={{ flex: 1 }} />
          <Button title="Save" onPress={() => ref.current?.readSignature()} style={{ flex: 1.4 }} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}
