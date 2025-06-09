import { E131Universe } from './e.131-universe';
import { RGBColor } from './rgb-color';
import { VTTMessage } from './vtt-message';

export interface VTTAmbilightMessage extends VTTMessage {
  type: 'ambilight';
  target: string | number;
  universe: E131Universe;
  colors: RGBColor[];
}
