// Camera / photo-library pictures, shrunk so they upload quickly on mobile data. Returns a JPEG data URL,
// or null if the driver cancelled.
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

export async function pickPhoto({ source = 'camera', maxSize = 1280, square = false } = {}) {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('Camera access is off for Choice Delivery. Turn it on in your phone settings.');
  }
  const options = { mediaTypes: ['images'], quality: 0.8, allowsEditing: square, aspect: square ? [1, 1] : undefined };
  const shot = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (shot.canceled || !shot.assets?.[0]) return null;
  const a = shot.assets[0];
  const ctx = ImageManipulator.manipulate(a.uri);
  if (Math.max(a.width || 0, a.height || 0) > maxSize) ctx.resize(a.width >= a.height ? { width: maxSize } : { height: maxSize });
  const img = await ctx.renderAsync();
  const out = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.7, base64: true });
  return `data:image/jpeg;base64,${out.base64}`;
}
