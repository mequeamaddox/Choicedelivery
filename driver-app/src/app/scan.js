// Scan a package barcode at pickup: finds the matching shipment (by its reference number), assigns it
// to you if it's open, and marks the pickup done.
import { useRef, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { api } from '../lib/client';
import { Button, ErrorBox, Muted, Notice } from '../components/ui';

export default function Scan() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const handled = useRef(false);

  const onScan = async ({ data }) => {
    if (handled.current || !data) return;
    handled.current = true;
    setBusy(true); setError(null);
    try {
      const order = await api.scan(data);
      router.replace(`/job/${order.id}`);
    } catch (e) {
      setError(e);
      setTimeout(() => { handled.current = false; }, 1500); // let them try again
    } finally { setBusy(false); }
  };

  if (!permission) return null;
  if (!permission.granted) {
    return (
      <View style={{ padding: 20, gap: 12 }}>
        <Muted>Choice Delivery needs the camera to scan package barcodes.</Muted>
        <Button title="Allow camera" onPress={requestPermission} />
      </View>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView style={{ flex: 1 }} facing="back" onBarcodeScanned={busy ? undefined : onScan}
        barcodeScannerSettings={{ barcodeTypes: ['code128', 'code39', 'code93', 'ean13', 'ean8', 'upc_a', 'upc_e', 'qr', 'datamatrix', 'pdf417', 'itf14', 'codabar'] }} />
      <View style={{ padding: 16, gap: 10, backgroundColor: '#fff' }}>
        {busy ? <Notice tone="blue">Looking up that shipment…</Notice> : <Muted>Point the camera at the package barcode.</Muted>}
        <ErrorBox error={error} />
      </View>
    </View>
  );
}
